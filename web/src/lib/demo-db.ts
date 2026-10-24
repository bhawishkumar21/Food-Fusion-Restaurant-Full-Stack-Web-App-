"use client";

import { DEMO_MENU, seedFeedback, seedOrders, seedReservations, seedStaff } from "./demo-data";
import { realtime } from "./realtime";
import type {
  Feedback,
  Fulfilment,
  MenuItem,
  Order,
  OrderStatus,
  Reservation,
  ReservationStatus,
  Role,
  UserSummary,
} from "./types";

/**
 * In-browser stand-in for the NestJS API, used only in DEMO_MODE.
 * State is in localStorage (shared by tabs), and every write is broadcast
 * so the Customer, KDS and Dashboard tabs stay in sync like the live system.
 */
interface DemoState {
  menu: MenuItem[];
  orders: Order[];
  feedback: Feedback[];
  reservations: Reservation[];
  staff: UserSummary[];
  /** Promo codes already redeemed (single-use). */
  usedPromos?: string[];
}

/** Demo stand-ins for rows in public.promo_codes. */
const DEMO_PROMOS: Record<string, number> = { WELCOME10: 10, FUSION20: 20 };

// Bump when the demo shape changes so stale localStorage is discarded.
const KEY = "food-fusion-demo-v5";

function load(): DemoState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as DemoState;
  } catch {
    /* storage blocked or corrupt — fall through to a fresh seed */
  }
  return {
    menu: structuredClone(DEMO_MENU),
    orders: seedOrders(),
    feedback: seedFeedback(),
    reservations: seedReservations(),
    staff: seedStaff(),
  };
}

function save(state: DemoState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode: demo still works for this tab */
  }
}

function mutate<T>(fn: (s: DemoState) => T): T {
  const state = load();
  const result = fn(state);
  save(state);
  return result;
}

const NEXT: Record<OrderStatus, OrderStatus[]> = {
  new: ["preparing", "completed", "cancelled"],
  preparing: ["ready", "out_for_delivery", "completed", "cancelled"],
  ready: ["out_for_delivery", "completed"],
  out_for_delivery: ["completed"],
  completed: [],
  cancelled: [],
};

/** Crude stand-in for the n8n sentiment workflow. */
function scoreSentiment(rating: number, text: string) {
  const neg = /(cold|late|rude|wrong|allerg|disappoint|bad|awful|slow|raw|missing)/i.test(text);
  const pos = /(great|amazing|love|delicious|perfect|excellent|fantastic)/i.test(text);
  const score = Math.max(-1, Math.min(1, (rating - 3) / 2 + (pos ? 0.25 : 0) - (neg ? 0.5 : 0)));
  const sentiment = score <= -0.25 ? "negative" : score >= 0.25 ? "positive" : "neutral";
  return { sentiment, score } as const;
}

export const demoDb = {
  reset() {
    localStorage.removeItem(KEY);
  },

  menu: () => load().menu,

  updateMenuItem(id: string, patch: Partial<MenuItem>) {
    const item = mutate((s) => {
      let i = s.menu.findIndex((m) => m.id === id);

      // If not found by exact ID, the ID might be a Supabase UUID for an item
      // that was seeded into demoDb with a different demo ID. Try to correlate
      // by name from the patch, or by searching DEMO_MENU for a matching demo ID.
      if (i < 0) {
        // Try matching by name (patch may carry it, or we look in DEMO_MENU)
        const nameHint = (patch as MenuItem & { name?: string }).name;
        if (nameHint) {
          i = s.menu.findIndex((m) => m.name.toLowerCase() === nameHint.toLowerCase());
        }
        // Last resort: seed the item from DEMO_MENU using the UUID as new id
        if (i < 0) {
          const demo = DEMO_MENU.find(
            (d) =>
              d.id === id ||
              (nameHint && d.name.toLowerCase() === nameHint.toLowerCase()),
          );
          if (demo) {
            // Upsert with the new Supabase UUID so future lookups by this id work
            s.menu.push({ ...demo, id });
            i = s.menu.length - 1;
          }
        }
      }

      if (i < 0) throw new Error("Menu item not found");
      s.menu[i] = { ...s.menu[i], ...patch };
      return s.menu[i];
    });
    realtime.publish("menu:item-updated", item);
    return item;
  },

  orders: (activeOnly = false) =>
    load().orders.filter((o) => !activeOnly || ["new", "preparing", "ready", "out_for_delivery"].includes(o.status)),

  placeOrder(
    input: {
      items: { menuItemId: string; quantity: number; name?: string; unitPriceCents?: number }[];
      fulfilment: Fulfilment;
      notes?: string;
      channel: "web" | "voice";
      promoCode?: string;
    },
    orderOverride?: Order,
  ) {
    const changedStock: MenuItem[] = [];
    const order = mutate((s) => {
      if (orderOverride) {
        // Prevent duplicate if already in state
        const idx = s.orders.findIndex((o) => o.id === orderOverride.id);
        if (idx >= 0) {
          s.orders[idx] = { ...orderOverride };
        } else {
          s.orders.unshift({ ...orderOverride });
        }
        return orderOverride;
      }

      const lines = input.items.map((l) => {
        // Match by ID or fallback to DEMO_MENU if not found in mutated state
        let m = s.menu.find((x) => x.id === l.menuItemId);
        if (!m) {
          m = DEMO_MENU.find((x) => x.id === l.menuItemId || (l.name && x.name.toLowerCase() === l.name.toLowerCase()));
          if (m) s.menu.push({ ...m });
        }
        const resolvedName = m?.name ?? l.name ?? "Special Dish";
        const resolvedPrice = m?.priceCents ?? l.unitPriceCents ?? 1500;
        if (!m) {
          return { menuItemId: l.menuItemId, name: resolvedName, quantity: l.quantity, unitPriceCents: resolvedPrice };
        }
        // Only block if explicitly marked isAvailable === false
        if (m.isAvailable === false) {
          throw new Error(`Sorry — ${m.name} is currently unavailable.`);
        }
        // Only block if dailyStock is an explicit positive number and requested quantity exceeds it
        if (typeof m.dailyStock === "number" && m.dailyStock > 0 && m.dailyStock < l.quantity) {
          throw new Error(`Only ${m.dailyStock} × ${m.name} left today.`);
        }
        return { menuItemId: m.id, name: resolvedName, quantity: l.quantity, unitPriceCents: resolvedPrice };
      });

      // Decrement stock only if tracked
      for (const l of input.items) {
        const m = s.menu.find((x) => x.id === l.menuItemId);
        if (m && typeof m.dailyStock === "number" && m.dailyStock > 0) {
          m.dailyStock = Math.max(0, m.dailyStock - l.quantity);
          if (m.dailyStock === 0) m.isAvailable = false;
          changedStock.push({ ...m });
        }
      }
      const subtotal = lines.reduce((t, l) => t + l.quantity * l.unitPriceCents, 0);
      const code = input.promoCode?.trim().toUpperCase().replace(/\s*-\s*/g, '-');
      let discountCents = 0;
      if (code) {
        if (s.usedPromos?.includes(code)) {
          throw new Error("That promo code is invalid or has already been used.");
        }
        let pct = DEMO_PROMOS[code];
        if (!pct) {
          const match = code.match(/^(SORRY|THANKYOU|THANK-YOU|THANKS|REFERRAL|REF)(?:(\d{1,2}))?-[A-Z0-9]{3,16}$/i);
          if (match) {
            const prefix = match[1].toUpperCase();
            const isThankYou = prefix.startsWith("THANK") || prefix.startsWith("REF");
            pct = match[2] ? parseInt(match[2], 10) : isThankYou ? 10 : 20;
          }
        }
        if (!pct) {
          throw new Error("That promo code is invalid or has already been used.");
        }
        s.usedPromos = [...(s.usedPromos ?? []), code];
        discountCents = Math.round((subtotal * pct) / 100);
      }
      const o: Order = {
        id: crypto.randomUUID(),
        trackingCode: `ORD-${Math.floor(1000 + Math.random() * 9000)}`,
        completedAt: null,
        status: "new",
        fulfilment: input.fulfilment,
        channel: input.channel,
        notes: input.notes || null,
        totalCents: subtotal - discountCents,
        discountCents,
        promoCode: code && discountCents ? code : null,
        createdAt: new Date().toISOString(),
        items: lines,
      };
      s.orders.unshift(o);
      return o;
    });
    realtime.publish("order:created", order);
    changedStock.forEach((m) => realtime.publish("menu:item-updated", m));
    return order;
  },

  order: (idOrCode: string) => {
    const o = load().orders.find((x) => x.id === idOrCode || x.trackingCode === idOrCode);
    if (!o) throw new Error("Order not found");
    return o;
  },

  reservations: (date?: string) =>
    load()
      .reservations.filter((r) => !date || r.reservedFor.slice(0, 10) === date)
      .sort((a, b) => a.reservedFor.localeCompare(b.reservedFor)),

  checkPromo(code: string) {
    const clean = code.trim().toUpperCase().replace(/\s*-\s*/g, '-');
    if (load().usedPromos?.includes(clean)) {
      throw new Error("That promo code is invalid or has already been used.");
    }
    const pct = DEMO_PROMOS[clean];
    if (pct) return pct;

    const match = clean.match(/^(SORRY|THANKYOU|THANK-YOU|THANKS|REFERRAL|REF)(?:(\d{1,2}))?-[A-Z0-9]{3,16}$/i);
    if (match) {
      const prefix = match[1].toUpperCase();
      const isThankYou = prefix.startsWith("THANK") || prefix.startsWith("REF");
      return match[2] ? parseInt(match[2], 10) : isThankYou ? 10 : 20;
    }

    throw new Error("That promo code is invalid or has already been used.");
  },

  updateReservation(id: string, patch: { status: ReservationStatus; tableLabel?: string }) {
    return mutate((s) => {
      const r = s.reservations.find((x) => x.id === id);
      if (!r) throw new Error("Reservation not found");
      r.status = patch.status;
      if (patch.tableLabel !== undefined) r.tableLabel = patch.tableLabel || null;
      return r;
    });
  },

  staff: () => load().staff,

  setStaffRole(id: string, role: Role, tenantId: string | null) {
    return mutate((s) => {
      const m = s.staff.find((x) => x.id === id);
      if (!m) throw new Error("User not found");
      if (m.id === s.staff[0].id && role !== "super_admin") {
        throw new Error("You cannot remove your own owner access");
      }
      if (role === "manager" && !tenantId) throw new Error("Managers must be assigned to a restaurant");
      m.role = role;
      m.tenantId = role === "user" ? null : tenantId;
      return m;
    });
  },

  updateOrderStatus(idOrCode: string, status: OrderStatus) {
    const order = mutate((s) => {
      const o = s.orders.find((x) => x.id === idOrCode || x.trackingCode === idOrCode);
      if (!o) throw new Error("Order not found");
      // Allow marking as completed or cancelled directly from any state, otherwise validate NEXT
      if (status !== "completed" && status !== "cancelled" && !NEXT[o.status].includes(status)) {
        throw new Error(`Cannot move ${o.status} → ${status}`);
      }
      o.status = status;
      if (status === "completed") o.completedAt = new Date().toISOString();
      return o;
    });
    realtime.publish("order:updated", order);
    return order;
  },

  submitFeedback(input: { orderId: string; rating: number; text: string; source: "text" | "voice" }) {
    const fb: Feedback = {
      id: crypto.randomUUID(),
      ...input,
      sentiment: "pending",
      sentimentScore: null,
      aiSummary: null,
      escalationStatus: null,
      discountCode: null,
      createdAt: new Date().toISOString(),
    };
    mutate((s) => void s.feedback.unshift(fb));

    // Simulate the asynchronous n8n callback.
    setTimeout(() => {
      const { sentiment, score } = scoreSentiment(input.rating, input.text);
      const scored = mutate((s) => {
        const f = s.feedback.find((x) => x.id === fb.id)!;
        Object.assign(f, {
          sentiment,
          sentimentScore: Number(score.toFixed(2)),
          aiSummary: input.text.slice(0, 80),
          escalationStatus: sentiment === "negative" ? "open" : null,
        });
        return f;
      });
      if (sentiment === "negative") realtime.publish("feedback:flagged", scored);
    }, 1500);
    return fb;
  },

  escalations: () =>
    load().feedback.filter((f) => f.sentiment === "negative" && f.escalationStatus !== "resolved"),

  updateFeedback(id: string, patch: Partial<Feedback>) {
    return mutate((s) => {
      const f = s.feedback.find((x) => x.id === id);
      if (!f) throw new Error("Feedback not found");
      Object.assign(f, patch);
      return f;
    });
  },
};
