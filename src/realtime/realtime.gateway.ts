import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { AuthUser, hasRole, Role } from '../auth/roles';
import { TokenVerifier } from '../auth/token-verifier.service';
import { SupabaseService } from '../supabase/supabase.service';

/** Event names shared with web/src/lib/realtime.ts. */
export const RealtimeEvent = {
  OrderCreated: 'order:created',
  OrderUpdated: 'order:updated',
  MenuItemUpdated: 'menu:item-updated',
  FeedbackFlagged: 'feedback:flagged',
} as const;

const room = {
  /** Everyone looking at this restaurant (live menu, stock changes). */
  public: (tenantId: string) => `tenant:${tenantId}`,
  /** Staff, managers + owner: live order payloads (kitchen queue). */
  staff: (tenantId: string) => `tenant:${tenantId}:staff`,
  /** Owners (super admins) only: feedback escalations. */
  owners: (tenantId: string) => `tenant:${tenantId}:owners`,
  /** A single customer tracking their own order. */
  order: (orderId: string) => `order:${orderId}`,
};

@WebSocketGateway({
  namespace: '/realtime',
  cors: { origin: process.env.WEB_ORIGIN ?? 'http://localhost:3001' },
})
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);
  @WebSocketServer() private readonly server: Server;

  constructor(
    private readonly verifier: TokenVerifier,
    private readonly supabase: SupabaseService,
  ) {}

  /** Staff are placed in their tenant's private rooms based on verified JWT claims. */
  async handleConnection(socket: Socket) {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return; // anonymous viewer: may only join public rooms

    try {
      const user = await this.verifier.verify(token);
      socket.data.user = user;
      if (user.tenantId && hasRole(user.role, Role.Staff)) {
        await socket.join(room.staff(user.tenantId));
        if (user.role === Role.SuperAdmin) {
          await socket.join(room.owners(user.tenantId));
        }
      }
    } catch {
      socket.emit('error', 'unauthorized');
      socket.disconnect(true);
    }
  }

  @SubscribeMessage('join')
  async join(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { tenantId: string; orderId?: string },
  ) {
    await socket.join(room.public(body.tenantId));
    const user = socket.data.user as AuthUser | undefined;

    // Owners can monitor any tenant they open.
    if (user?.role === Role.SuperAdmin) {
      await socket.join([
        room.staff(body.tenantId),
        room.owners(body.tenantId),
      ]);
    }
    // An unguessable UUID is not authorization. Customers can join only their
    // own order room; tenant staff/owners retain operational visibility.
    if (body.orderId && user) {
      const { data } = await this.supabase.admin
        .from('orders')
        .select('customer_id, tenant_id')
        .eq('id', body.orderId)
        .maybeSingle<{ customer_id: string; tenant_id: string }>();
      if (
        data &&
        (data.customer_id === user.id ||
          (hasRole(user.role, Role.Staff) &&
            (user.role === Role.SuperAdmin || data.tenant_id === user.tenantId)))
      ) {
        await socket.join(room.order(body.orderId));
      }
    }
    return { ok: true };
  }

  emitOrderCreated(tenantId: string, order: unknown) {
    this.server
      .to(room.staff(tenantId))
      .emit(RealtimeEvent.OrderCreated, order);
  }

  emitOrderUpdated(tenantId: string, order: { id: string }) {
    this.server
      .to([room.staff(tenantId), room.order(order.id)])
      .emit(RealtimeEvent.OrderUpdated, order);
  }

  /** Stock / price changes fan out to every live menu and voice session. */
  emitMenuItemUpdated(tenantId: string, item: unknown) {
    this.server
      .to(room.public(tenantId))
      .emit(RealtimeEvent.MenuItemUpdated, item);
  }

  emitFeedbackFlagged(tenantId: string, feedback: unknown) {
    this.logger.log(`Negative feedback flagged for tenant ${tenantId}`);
    this.server
      .to(room.owners(tenantId))
      .emit(RealtimeEvent.FeedbackFlagged, feedback);
  }
}
