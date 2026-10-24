import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { AuthUser } from '../auth/roles';
import { unwrap } from '../common/supabase-result';
import { N8nService } from '../n8n/n8n.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SupabaseService } from '../supabase/supabase.service';
import {
  CreateOrderDto,
  NEXT_STATUS,
  OrderStatus,
  UpdateOrderStatusDto,
} from './orders.dto';

const ORDER_COLUMNS = `id, tenant_id, customer_id, status, fulfilment, channel, notes,
  tracking_code, completed_at, total_cents, discount_cents, promo_code, phone, created_at, updated_at,
  order_items ( id, menu_item_id, name, quantity, unit_price_cents )`;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly realtime: RealtimeGateway,
    private readonly n8n: N8nService,
  ) {}

  /**
   * Prices and availability are resolved inside Postgres (`place_order`), never
   * trusted from the client. The function raises if any item is out of stock.
   */
  async create(user: AuthUser, tenantId: string, dto: CreateOrderDto) {
    const db = this.supabase.forUser(user);
    const cleanPromo = dto.promoCode
      ? dto.promoCode.trim().toUpperCase().replace(/\s*-\s*/g, '-')
      : null;
    const { data: orderId, error } = await db.rpc('place_order', {
      p_tenant_id: tenantId,
      p_items: dto.items.map((i) => ({
        menu_item_id: i.menuItemId,
        quantity: i.quantity,
      })),
      p_fulfilment: dto.fulfilment,
      p_notes: dto.notes ?? null,
      p_channel: dto.channel ?? 'web',
      p_promo_code: cleanPromo,
    });
    if (error) {
      if (cleanPromo) {
        this.logger.warn(`Order placement failed with promo "${cleanPromo}": ${error.message}`);
      }
      throw new BadRequestException(error.message);
    }

    const order = await this.findOne(user, orderId as string);
    this.realtime.emitOrderCreated(tenantId, order);
    return order;
  }

  findOne(user: AuthUser, id: string) {
    return this.supabase
      .forUser(user)
      .from('orders')
      .select(ORDER_COLUMNS)
      .eq('id', id)
      .single()
      .then(unwrap);
  }

  /** Customers see their own orders; staff see the tenant's (enforced by RLS). */
  async list(user: AuthUser, tenantId: string, active: boolean) {
    let q = this.supabase
      .forUser(user)
      .from('orders')
      .select(ORDER_COLUMNS)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true })
      .limit(200);
    if (active) q = q.in('status', ['new', 'preparing', 'ready', 'out_for_delivery']);
    return unwrap(await q);
  }

  /** Super-admin dispatch view with contact data resolved server-side only. */
  async listForAdmin(user: AuthUser, tenantId: string) {
    const orders = await this.list(user, tenantId, true);
    const customerIds = [...new Set(orders.map((order) => order.customer_id as string))];
    const profiles = unwrap(
      await this.supabase.admin
        .from('profiles')
        .select('id, display_name')
        .in('id', customerIds),
    ) as { id: string; display_name: string | null }[];
    const names = new Map(profiles.map((profile) => [profile.id, profile.display_name]));
    const emails = new Map<string, string | null>();
    for (const customerId of customerIds) {
      const result = await this.supabase.admin.auth.admin.getUserById(customerId);
      emails.set(customerId, result.data.user?.email ?? null);
    }
    return orders.map((order) => ({
      ...order,
      customer_name: names.get(order.customer_id as string) ?? null,
      customer_email: emails.get(order.customer_id as string) ?? null,
    }));
  }

  /** Owner-only dispatch completion: one atomic terminal transition. */
  async complete(user: AuthUser, tenantId: string, id: string) {
    const order = unwrap(
      await this.supabase
        .forUser(user)
        .from('orders')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .in('status', ['new', 'preparing', 'ready', 'out_for_delivery'])
        .select(ORDER_COLUMNS)
        .single(),
    );
    if (!order) throw new BadRequestException('Order cannot be completed');
    this.realtime.emitOrderUpdated(tenantId, order);
    void this.notifyCompleted(order);
    return order;
  }

  async updateStatus(
    user: AuthUser,
    tenantId: string,
    id: string,
    dto: UpdateOrderStatusDto,
  ) {
    const current = unwrap(
      await this.supabase
        .forUser(user)
        .from('orders')
        .select('status')
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .single<{ status: OrderStatus }>(),
    );
    if (!NEXT_STATUS[current.status].includes(dto.status)) {
      throw new BadRequestException(
        `Cannot move order from ${current.status} to ${dto.status}`,
      );
    }

    unwrap(
      await this.supabase
        .forUser(user)
        .from('orders')
        .update({ status: dto.status })
        .eq('tenant_id', tenantId)
        .eq('id', id)
        // Optimistic concurrency: two chefs clicking at once can't double-advance.
        .eq('status', current.status)
        .select('id')
        .single(),
    );
    const order = await this.findOne(user, id);
    this.realtime.emitOrderUpdated(tenantId, order);
    if (dto.status === 'completed') void this.notifyCompleted(order);
    return order;
  }

  /**
   * Tells the n8n order workflow (receipt / thank-you email) an order is done.
   * Customer contact details are resolved with the service role, since staff
   * can't read other users' auth records. Never throws.
   */
  private async notifyCompleted(order: Record<string, unknown>) {
    try {
      const customerId = order.customer_id as string;
      const [{ data: auth }, { data: profile }] = await Promise.all([
        this.supabase.admin.auth.admin.getUserById(customerId),
        this.supabase.admin
          .from('profiles')
          .select('display_name, phone')
          .eq('id', customerId)
          .maybeSingle<{ display_name: string | null; phone: string | null }>(),
      ]);
      const email = auth.user?.email?.trim() || '';
      const items = (order.order_items as { name: string; quantity: number; unit_price_cents: number }[]) ?? [];
      if (!email) {
        this.logger.warn(`Order ${order.id as string} completed for a customer with no email (guest/anonymous); n8n cannot email them.`);
      }
      this.n8n.dispatch('order', 'order.completed', {
        order_id: order.id,
        tracking_id: order.tracking_code ?? order.id,
        customer_name: profile?.display_name?.trim() || (email ? email.split('@')[0] : 'Customer'),
        customer_email: email,
        customer_phone: (order.phone as string | null) ?? profile?.phone ?? '',
        items: items.map((i) => ({ name: i.name, quantity: i.quantity, unit_price: i.unit_price_cents / 100 })),
        subtotal_amount: ((order.total_cents as number) + ((order.discount_cents as number) ?? 0)) / 100,
        discount_amount: ((order.discount_cents as number) ?? 0) / 100,
        total_amount: (order.total_cents as number) / 100,
        currency: 'PKR',
        promo_code: order.promo_code ?? null,
        fulfilment: order.fulfilment,
        status: order.status,
        completed_at: order.completed_at ?? new Date().toISOString(),
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.error(`Could not build order.completed payload for ${order.id as string}: ${String(err)}`);
    }
  }

  /**
   * 5-minute time-restricted cancellation.
   * Customers or staff can cancel if status is 'new' or 'preparing' AND
   * NOW() - created_at < 5 minutes.
   */
  async cancel(user: AuthUser, tenantId: string, id: string) {
    const current = unwrap(
      await this.supabase
        .forUser(user)
        .from('orders')
        .select('id, status, created_at')
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .single<{ id: string; status: string; created_at: string }>(),
    );

    if (!['new', 'preparing'].includes(current.status)) {
      throw new BadRequestException(
        `Order in state '${current.status}' cannot be cancelled`,
      );
    }

    const elapsedMs = Date.now() - new Date(current.created_at).getTime();
    const fiveMinutesMs = 5 * 60 * 1000;
    if (elapsedMs >= fiveMinutesMs) {
      throw new BadRequestException(
        'Cancellation window expired (5-min limit).',
      );
    }

    // Cancel order using service-role or user client
    unwrap(
      await this.supabase.admin
        .from('orders')
        .update({ status: 'cancelled' })
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .select('id')
        .single(),
    );

    const order = await this.findOne(user, id);
    this.realtime.emitOrderUpdated(tenantId, order);
    return order;
  }
}
