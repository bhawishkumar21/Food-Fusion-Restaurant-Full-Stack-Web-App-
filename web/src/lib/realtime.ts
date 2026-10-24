"use client";

import { io, type Socket } from "socket.io-client";
import { API_URL, DEMO_MODE, TENANT_ID } from "./config";
import { getAccessToken } from "./supabase/client";
import type { Feedback, MenuItem, Order } from "./types";

/** Event names shared with src/realtime/realtime.gateway.ts. */
export interface RealtimeEvents {
  "order:created": Order;
  "order:updated": Order;
  "menu:item-updated": MenuItem;
  "feedback:flagged": Feedback;
}
export type RealtimeEvent = keyof RealtimeEvents;
type Handler<E extends RealtimeEvent> = (payload: RealtimeEvents[E]) => void;

/**
 * One transport-agnostic bus.
 *  - Live: Socket.io to the NestJS gateway (staff rooms derived from the JWT).
 *  - Demo: BroadcastChannel, so a KDS tab sees orders placed in a customer tab.
 */
class RealtimeBus {
  private socket: Socket | null = null;
  private channel: BroadcastChannel | null = null;
  private listeners = new Map<RealtimeEvent, Set<(p: unknown) => void>>();
  private connecting: Promise<void> | null = null;

  connect(opts: { orderId?: string } = {}) {
    if (typeof window === "undefined") return Promise.resolve();
    this.channel ??= new BroadcastChannel("food-fusion-realtime");
    this.channel.onmessage = (e: MessageEvent<{ event: RealtimeEvent; payload: unknown }>) =>
      this.dispatch(e.data.event, e.data.payload);

    if (DEMO_MODE) return Promise.resolve();

    this.connecting ??= (async () => {
      try {
        const token = await getAccessToken().catch(() => null);
        this.socket = io(`${API_URL}/realtime`, {
          auth: token ? { token } : {},
          transports: ["websocket"],
          reconnectionAttempts: 3,
          timeout: 4000,
        });
        this.socket.on("connect", () =>
          this.socket?.emit("join", { tenantId: TENANT_ID, orderId: opts.orderId }),
        );
        this.socket.onAny((event: RealtimeEvent, payload) => this.dispatch(event, payload));
      } catch {
        /* Socket server offline: fallback to BroadcastChannel */
      }
    })();
    return this.connecting;
  }

  /** Customers tracking a specific order join its private room. */
  trackOrder(orderId: string) {
    this.socket?.emit("join", { tenantId: TENANT_ID, orderId });
  }

  on<E extends RealtimeEvent>(event: E, handler: Handler<E>) {
    const set = this.listeners.get(event) ?? new Set();
    set.add(handler as (p: unknown) => void);
    this.listeners.set(event, set);
    return () => {
      set.delete(handler as (p: unknown) => void);
    };
  }

  /** Broadcast event across tabs (via BroadcastChannel) and to local listeners. */
  publish<E extends RealtimeEvent>(event: E, payload: RealtimeEvents[E]) {
    try {
      this.channel?.postMessage({ event, payload });
    } catch {
      // ignore
    }
    this.dispatch(event, payload); // BroadcastChannel skips the sender
  }

  get connected() {
    return DEMO_MODE ? this.channel !== null : Boolean(this.socket?.connected);
  }

  private dispatch(event: RealtimeEvent, payload: unknown) {
    this.listeners.get(event)?.forEach((fn) => fn(payload));
  }
}

export const realtime = new RealtimeBus();
