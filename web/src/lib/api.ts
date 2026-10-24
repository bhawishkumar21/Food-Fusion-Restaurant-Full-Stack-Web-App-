"use client";

import { API_URL, DEMO_MODE, TENANT_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEFAULT_GUEST_CUSTOMER_ID, isSuperAdminEmail, resolveRole } from "./config";
import { demoDb } from "./demo-db";
import { DEMO_MENU } from "./demo-data";
import { realtime } from "./realtime";
import { getAccessToken, supabaseBrowser } from "./supabase/client";
import type {
  AnalyticsSummary,
  ApiLog,
  ApiUsage,
  EscalationStatus,
  Feedback,
  Fulfilment,
  MenuItem,
  Order,
  AdminOrder,
  OrderStatus,
  Reservation,
  ReservationStatus,
  Role,
  UserSummary,
  Tenant,
} from "./types";

/** Signed ElevenLabs session from the API, incl. the bound voice (overrides). */
export interface VoiceSession {
  signedUrl: string;
  dynamicVariables: Record<string, string>;
  overrides?: {
    agent?: { firstMessage?: string };
    tts?: { voiceId?: string };
    asr?: { keywords?: string[] };
  };
}

// ───────────────────────────────────────────────────────────── transport ──

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { anonymous?: boolean } = {},
): Promise<T> {
  const token = await getAccessToken({ allowAnonymous: init.anonymous });
  const res = await fetch(`${API_URL}/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    const msg = Array.isArray(body.message) ? body.message.join(", ") : body.message;
    throw new ApiError(res.status, msg ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

const t = (path: string) => `/t/${TENANT_ID}${path}`;
const json = (body: unknown) => JSON.stringify(body);
/** Lets demo calls feel like network calls (and exercise loading states). */
const latency = <T>(fn: () => T, ms = 250) =>
  new Promise<T>((resolve, reject) =>
    setTimeout(() => {
      try {
        resolve(fn());
      } catch (e) {
        reject(e);
      }
    }, ms),
  );

// ─────────────────────────────────────────────────────────────── mappers ──
/* eslint-disable @typescript-eslint/no-explicit-any */
const toMenuItem = (r: any): MenuItem => {
  // Correlate with static dataset to guarantee proper category grouping (Karahi, BBQ, Steaks, Deals, etc.)
  const matched = DEMO_MENU.find((m) => m.name.toLowerCase() === (r.name || "").toLowerCase() || m.id === r.id);
  let resolvedCategory = r.category;
  if (!resolvedCategory && r.voice_notes && r.voice_notes.includes("Category: ")) {
    const catMatch = r.voice_notes.match(/Category:\s*([^.]+)/i);
    if (catMatch) resolvedCategory = catMatch[1].trim();
  }
  if (!resolvedCategory) {
    resolvedCategory = matched?.category ?? "Signatures";
  }

  return {
    id: r.id,
    name: r.name,
    description: r.description || matched?.description || "",
    priceCents: r.price_cents,
    imageUrl: r.image_url || matched?.imageUrl || null,
    category: resolvedCategory,
    badge: r.badge ?? matched?.badge ?? null,
    tags: r.tags || [],
    isAvailable: r.is_available !== false,
    voiceNotes: r.voice_notes ?? matched?.voiceNotes ?? null,
    dailyStock: r.daily_stock ?? 999,
  };
};

const toReservation = (r: any): Reservation => ({
  id: r.id,
  reservedFor: r.reserved_for,
  partySize: r.party_size,
  guestName: r.guest_name,
  phone: r.phone,
  notes: r.notes,
  status: r.status,
  tableLabel: r.table_label,
  createdAt: r.created_at,
});

export const toOrder = (r: any): Order => ({
  id: r.id,
  trackingCode: r.tracking_code ?? r.id,
  completedAt: r.completed_at ?? null,
  status: r.status,
  fulfilment: r.fulfilment,
  channel: r.channel,
  notes: r.notes,
  phone: r.phone ?? r.customer_phone ?? null,
  deliveryAddress: r.delivery_address ?? null,
  totalCents: r.total_cents,
  discountCents: r.discount_cents ?? 0,
  promoCode: r.promo_code ?? null,
  createdAt: r.created_at,
  items: (r.order_items ?? []).map((l: any) => ({
    menuItemId: l.menu_item_id,
    name: l.name,
    quantity: l.quantity,
    unitPriceCents: l.unit_price_cents,
  })),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isPromoError = (message: string) => /promo code/i.test(message);
/** Postgres / PostgREST wording → something a guest can act on. */
function promoMessage(message: string) {
  if (/already been used|invalid/i.test(message)) return "That promo code is invalid or has already been used.";
  if (/could not find|does not exist|schema cache/i.test(message)) return "Promo codes aren't enabled yet.";
  if (/failed to fetch|network/i.test(message)) return "Couldn't reach the server — check your connection and try again.";
  return message;
}

/** Notes plus "[Phone: … | Address: …]", so contact details reach the kitchen without extra columns. */
function contactNotes(input: { notes?: string; phoneNumber?: string; deliveryAddress?: string }) {
  const notes = input.notes?.trim() || "";
  const meta = [
    input.phoneNumber?.trim() && `Phone: ${input.phoneNumber.trim()}`,
    input.deliveryAddress?.trim() && `Address: ${input.deliveryAddress.trim()}`,
  ].filter(Boolean);
  return meta.length ? `${notes} [${meta.join(" | ")}]`.trim() : notes;
}

const toFeedback = (r: any): Feedback => ({
  id: r.id,
  orderId: r.order_id,
  rating: r.rating,
  text: r.text,
  source: r.source,
  sentiment: r.sentiment,
  sentimentScore: r.sentiment_score,
  aiSummary: r.ai_summary,
  escalationStatus: r.escalation_status,
  discountCode: r.discount_code,
  createdAt: r.created_at,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Socket payloads arrive in DB shape in live mode; normalise them. */
export const normalise = {
  menuItem: (p: unknown) => (DEMO_MODE ? (p as MenuItem) : toMenuItem(p)),
  order: (p: unknown) => (DEMO_MODE ? (p as Order) : toOrder(p)),
  feedback: (p: unknown) => (DEMO_MODE ? (p as Feedback) : toFeedback(p)),
};

// ─────────────────────────────────────────────────────────────────── API ──

export const api = {
  menu: {
    list: async (): Promise<MenuItem[]> => {
      if (DEMO_MODE) return latency(demoDb.menu, 0);

      // 1. Try NestJS backend
      try {
        const rows = await request<unknown[]>(t("/menu"));
        return rows.map(toMenuItem);
      } catch {
        // NestJS unreachable -> query Supabase directly
      }

      // 2. Direct Supabase query
      const sb = supabaseBrowser();
      if (sb) {
        try {
          const { data, error } = await sb
            .from("menu_items")
            .select("*")
            .eq("tenant_id", TENANT_ID)
            .order("sort_order", { ascending: true });

          if (!error && data && data.length > 0) {
            return data.map(toMenuItem);
          }
        } catch (sbErr) {
          console.warn("Direct Supabase menu fetch notice:", sbErr);
        }
      }

      // 3. Last-resort demoDb fallback
      return demoDb.menu();
    },

    /**
     * Manager inventory: 1-click 86 toggle, optionally with today's portion
     * count (null = stop tracking; undefined = leave as is).
     */
    setAvailability: async (id: string, isAvailable: boolean, dailyStock?: number | null): Promise<MenuItem> => {
      if (DEMO_MODE) {
        return latency(() => demoDb.updateMenuItem(id, { isAvailable, ...(dailyStock !== undefined && { dailyStock }) }));
      }

      // 1. Try NestJS backend
      try {
        return await request(t(`/menu/${id}/availability`), {
          method: "PATCH",
          body: json({ isAvailable, dailyStock }),
        }).then(toMenuItem);
      } catch {
        // Fallback to Supabase direct update
      }

      // 2. Direct Supabase update
      const sb = supabaseBrowser();
      if (sb) {
        try {
          const updatePayload: Record<string, unknown> = { is_available: isAvailable };
          if (dailyStock !== undefined) {
            updatePayload.daily_stock = dailyStock;
            updatePayload.stock_quantity = dailyStock;
          }
          // Use maybeSingle() so it returns null (not an error) when 0 rows match
          const { data, error } = await sb
            .from("menu_items")
            .update(updatePayload)
            .eq("id", id)
            .select()
            .maybeSingle();

          if (!error && data) {
            const mapped = toMenuItem(data);
            // Sync to demoDb for cross-tab broadcasting; ignore if demoDb can't find the item
            try {
              demoDb.updateMenuItem(id, { isAvailable, ...(dailyStock !== undefined && { dailyStock }), name: mapped.name });
            } catch {
              // demoDb is a best-effort local mirror — not fatal
            }
            return mapped;
          }
        } catch (sbErr) {
          console.warn("Direct Supabase menu availability update notice:", sbErr);
        }
      }

      // 3. Fallback to demoDb (pass name from the current local menu state if available)
      return demoDb.updateMenuItem(id, { isAvailable, ...(dailyStock !== undefined && { dailyStock }) });
    },

    /** Owner's menu & voice knowledge-base editor. */
    update: async (id: string, patch: Partial<Pick<MenuItem, "priceCents" | "name" | "description" | "voiceNotes" | "isAvailable">>): Promise<MenuItem> => {
      if (DEMO_MODE) {
        return latency(() => demoDb.updateMenuItem(id, patch));
      }

      // 1. Try NestJS backend
      try {
        return await request(t(`/menu/${id}`), { method: "PATCH", body: json(patch) }).then(toMenuItem);
      } catch {
        // Fallback to Supabase direct update
      }

      // 2. Direct Supabase update
      const sb = supabaseBrowser();
      if (sb) {
        try {
          const dbPatch: Record<string, unknown> = {};
          if (patch.name !== undefined) dbPatch.name = patch.name;
          if (patch.description !== undefined) dbPatch.description = patch.description;
          if (patch.priceCents !== undefined) dbPatch.price_cents = patch.priceCents;
          if (patch.voiceNotes !== undefined) dbPatch.voice_notes = patch.voiceNotes;
          if (patch.isAvailable !== undefined) dbPatch.is_available = patch.isAvailable;

          const { data, error } = await sb
            .from("menu_items")
            .update(dbPatch)
            .eq("id", id)
            .select()
            .single();

          if (!error && data) {
            const mapped = toMenuItem(data);
            demoDb.updateMenuItem(id, patch);
            return mapped;
          }
        } catch (sbErr) {
          console.warn("Direct Supabase menu update notice:", sbErr);
        }
      }

      // 3. Fallback to demoDb
      return demoDb.updateMenuItem(id, patch);
    },
  },

  promo: {
    /** Percent off if the code exists and is unused; throws otherwise. Redemption happens with the order. */
    check: async (code: string): Promise<number> => {
      const clean = code.trim().toUpperCase().replace(/\s*-\s*/g, '-');
      if (!/^[A-Z0-9_-]{3,32}$/.test(clean)) throw new Error("That doesn't look like a valid code.");

      // 1. Try NestJS backend endpoint first
      try {
        const res = await request<{ code: string; percent: number; discount_percent?: number }>(
          t("/promo-codes/validate"),
          {
            method: "POST",
            body: json({ code: clean }),
            anonymous: true,
          },
        );
        if (res && typeof (res.percent ?? res.discount_percent) === "number") {
          return res.percent ?? res.discount_percent!;
        }
      } catch (backendErr) {
        if (backendErr instanceof ApiError) {
          throw new Error(promoMessage(backendErr.message));
        }
        // NestJS unreachable -> fall through to Supabase direct / demoDb
      }

      // 2. Direct Supabase RPC
      if (!DEMO_MODE) {
        const sb = supabaseBrowser();
        if (sb) {
          try {
            const { data, error } = await sb.rpc("check_promo_code", { p_tenant_id: TENANT_ID, p_code: clean });
            if (error) {
              if (/already been used|invalid|expired/i.test(error.message)) {
                throw new Error(promoMessage(error.message));
              }
            } else if (typeof data === "number") {
              return data;
            }
          } catch (sbErr) {
            if (sbErr instanceof Error && /already been used|invalid|expired/i.test(sbErr.message)) {
              throw sbErr;
            }
          }
        }
      }

      // 3. Fallback to demoDb
      return demoDb.checkPromo(clean);
    },
  },

  orders: {
    place: async (input: {
      items: { menuItemId: string; quantity: number; name?: string; unitPriceCents?: number }[];
      fulfilment: Fulfilment;
      notes?: string;
      channel: "web" | "voice";
      phoneNumber?: string;
      deliveryAddress?: string;
      /** Single-use code; the order is rejected rather than charged in full if it's spent. */
      promoCode?: string;
    }): Promise<Order> => {
      if (DEMO_MODE) {
        return latency(() => demoDb.placeOrder(input), 700);
      }

      // 1. Try NestJS API endpoint first
      try {
        return await request(t("/orders"), { method: "POST", body: json(input), anonymous: true }).then(toOrder);
      } catch (err) {
        // A rejected promo code is final; retrying another way would only bypass it.
        if (err instanceof Error && isPromoError(err.message)) throw new Error(promoMessage(err.message));
        console.warn("NestJS order placement unreachable or failed, persisting directly to Supabase:", err);
      }

      // 2a. place_order RPC: prices, stock and the promo code in one transaction.
      const rpc = supabaseBrowser();
      if (rpc && input.items.every((i) => UUID_RE.test(i.menuItemId))) {
        try {
          await getAccessToken({ allowAnonymous: true });
          const { data: orderId, error } = await rpc.rpc("place_order", {
            p_tenant_id: TENANT_ID,
            p_items: input.items.map((i) => ({ menu_item_id: i.menuItemId, quantity: i.quantity })),
            p_fulfilment: input.fulfilment,
            p_notes: contactNotes(input) || null,
            p_channel: input.channel,
            p_promo_code: input.promoCode ?? null,
          });
          if (error) throw new Error(error.message);
          const { data: row } = await rpc
            .from("orders")
            .select("*, order_items(menu_item_id, name, quantity, unit_price_cents)")
            .eq("id", orderId as string)
            .single();
          const order: Order = {
            ...toOrder(row ?? { id: orderId, status: "new", fulfilment: input.fulfilment, channel: input.channel }),
            notes: input.notes?.trim() || null,
            phone: input.phoneNumber?.trim() || null,
            deliveryAddress: input.deliveryAddress?.trim() || null,
          };
          realtime.publish("order:created", order);
          return order;
        } catch (err) {
          if (err instanceof Error && isPromoError(err.message)) throw new Error(promoMessage(err.message));
          if (err instanceof Error && /unavailable:/.test(err.message)) throw new Error(`Sorry — ${err.message.replace(/^.*unavailable:\s*/, "")} just sold out.`);
          console.warn("place_order RPC failed, inserting directly:", err);
        }
      }

      // 2. Direct Supabase persistence
      const sb = supabaseBrowser();
      if (sb) {
        try {
          await getAccessToken({ allowAnonymous: true });
          const { data: userAuth } = await sb.auth.getUser();
          let customerId = userAuth.user?.id;
          if (!customerId) {
            customerId = DEFAULT_GUEST_CUSTOMER_ID;
          }

          if (customerId) {
            // Fetch live menu items to calculate total and snapshot names/prices
            const itemIds = input.items.map((i) => i.menuItemId);
            const { data: menuData } = await sb
              .from("menu_items")
              .select("id, name, price_cents, is_available, daily_stock")
              .in("id", itemIds);

            const menuMap = new Map((menuData ?? []).map((m) => [m.id, m]));
            const lines = input.items.map((line) => {
              let item = menuMap.get(line.menuItemId);
              if (!item) {
                // Also search by matching DEMO_MENU ID or name
                const fallbackDemo = DEMO_MENU.find((d) => d.id === line.menuItemId || (line.name && d.name.toLowerCase() === line.name.toLowerCase()));
                if (fallbackDemo) {
                  item = {
                    id: fallbackDemo.id,
                    name: fallbackDemo.name,
                    price_cents: fallbackDemo.priceCents,
                    is_available: true,
                    daily_stock: 999,
                  };
                }
              }
              const resolvedName = item?.name ?? line.name ?? "Special Item";
              const resolvedPrice = item?.price_cents ?? line.unitPriceCents ?? 1500;
              return {
                menuItemId: line.menuItemId,
                name: resolvedName,
                quantity: line.quantity,
                unitPriceCents: resolvedPrice,
              };
            });

            const totalCents = lines.reduce((sum, l) => sum + l.quantity * l.unitPriceCents, 0);

            const structuredNotes = contactNotes(input);

            const { data: orderRow, error: orderErr } = await sb
              .from("orders")
              .insert({
                tenant_id: TENANT_ID,
                customer_id: customerId,
                status: "new",
                fulfilment: input.fulfilment,
                channel: input.channel,
                notes: structuredNotes || null,
                total_cents: totalCents,
              })
              .select()
              .single();

            if (!orderErr && orderRow) {
              // Insert line items safely with valid UUID or null if foreign key requires it
              if (lines.length > 0) {
                const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                const itemsToInsert = lines.map((l) => ({
                  order_id: (orderRow as { id: string }).id,
                  tenant_id: TENANT_ID,
                  menu_item_id: uuidRegex.test(l.menuItemId) ? l.menuItemId : null,
                  name: l.name,
                  quantity: l.quantity,
                  unit_price_cents: l.unitPriceCents,
                }));
                const { error: itemsErr } = await sb.from("order_items").insert(itemsToInsert);
                if (itemsErr) {
                  console.warn("Failed to insert order_items rows in Supabase:", itemsErr.message);
                }
              }

              // Update customer phone in profile if provided
              if (input.phoneNumber?.trim()) {
                try {
                  await sb.from("profiles").upsert({
                    id: customerId,
                    phone: input.phoneNumber.trim(),
                  });
                } catch {
                  // ignore
                }
              }

              // Redeem the promo against the stored order (atomic single-use check in Postgres).
              let discountCents = 0;
              if (input.promoCode) {
                const { data: off, error: promoErr } = await sb.rpc("redeem_promo_code", {
                  p_order_id: (orderRow as { id: string }).id,
                  p_code: input.promoCode,
                });
                if (promoErr) console.warn("Promo code not applied:", promoErr.message);
                else discountCents = Number(off) || 0;
              }

              // Return fully resolved order
              const createdOrder: Order = {
                id: (orderRow as { id: string }).id,
                trackingCode: (orderRow as { tracking_code?: string; tracking_id?: string; id: string }).tracking_code ?? (orderRow as { tracking_id?: string; id: string }).tracking_id ?? (orderRow as { id: string }).id,
                completedAt: null,
                status: (orderRow as { status: OrderStatus }).status ?? "new",
                fulfilment: input.fulfilment,
                channel: input.channel,
                notes: input.notes?.trim() || null,
                phone: input.phoneNumber?.trim() || null,
                deliveryAddress: input.deliveryAddress?.trim() || null,
                totalCents: totalCents - discountCents,
                discountCents,
                promoCode: discountCents ? input.promoCode!.trim().toUpperCase() : null,
                createdAt: (orderRow as { created_at?: string }).created_at ?? new Date().toISOString(),
                items: lines,
              };

              // Broadcast via local demo/realtime channel and postMessage
              demoDb.placeOrder(input, createdOrder);
              realtime.publish("order:created", createdOrder);
              return createdOrder;
            } else if (orderErr) {
              console.warn("Supabase order insert returned error:", orderErr.message);
            }
          }
        } catch (sbErr) {
          console.warn("Direct Supabase order insert error:", sbErr);
        }
      }

      // 3. Fallback to demoDb
      return demoDb.placeOrder(input);
    },

    active: async (): Promise<Order[]> => {
      if (DEMO_MODE) {
        return latency(() => demoDb.orders(true), 0);
      }
      try {
        const rows = await request<unknown[]>(t("/orders?active=true"));
        return rows.map(toOrder);
      } catch {
        const sb = supabaseBrowser();
        if (sb) {
          try {
            const { data: userAuth } = await sb.auth.getUser();
            const customerId = userAuth.user?.id;
            if (customerId) {
              const { data, error } = await sb
                .from("orders")
                .select("id, tracking_code, completed_at, status, fulfilment, channel, notes, total_cents, created_at, order_items(menu_item_id, name, quantity, unit_price_cents)")
                .eq("customer_id", customerId)
                .in("status", ["new", "preparing", "ready", "out_for_delivery"])
                .order("created_at", { ascending: false });
              if (!error && data && data.length > 0) {
                return data.map(toOrder);
              }
            }
          } catch {
            // ignore
          }
        }
        return demoDb.orders(true);
      }
    },

    get: async (idOrCode: string): Promise<Order> => {
      if (DEMO_MODE) {
        return latency(() => demoDb.order(idOrCode), 0);
      }
      try {
        return await request(t(`/orders/${idOrCode}`)).then(toOrder);
      } catch {
        const sb = supabaseBrowser();
        if (sb) {
          try {
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            let query = sb
              .from("orders")
              .select("id, tracking_code, completed_at, status, fulfilment, channel, notes, total_cents, created_at, customer_id, order_items(menu_item_id, name, quantity, unit_price_cents)");
            if (uuidRegex.test(idOrCode)) {
              query = query.or(`id.eq.${idOrCode},tracking_code.eq.${idOrCode}`);
            } else {
              query = query.eq("tracking_code", idOrCode);
            }
            const { data } = await query.maybeSingle();
            if (data) return toOrder(data);
          } catch {
            // ignore
          }
        }
        return demoDb.order(idOrCode);
      }
    },

    setStatus: async (idOrCode: string, status: OrderStatus): Promise<Order> => {
      if (DEMO_MODE) {
        return latency(() => demoDb.updateOrderStatus(idOrCode, status), 120);
      }
      try {
        return await request(t(`/orders/${idOrCode}/status`), { method: "PATCH", body: json({ status }) }).then(toOrder);
      } catch {
        const sb = supabaseBrowser();
        if (sb) {
          try {
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            let query = sb.from("orders").update({ status });
            if (uuidRegex.test(idOrCode)) {
              query = query.or(`id.eq.${idOrCode},tracking_code.eq.${idOrCode}`);
            } else {
              query = query.eq("tracking_code", idOrCode);
            }
            const { data, error } = await query.select().maybeSingle();
            if (!error && data) {
              const mapped = toOrder(data);
              realtime.publish("order:updated", mapped);
              return mapped;
            }
          } catch {
            // ignore
          }
        }
        const updated = demoDb.updateOrderStatus(idOrCode, status);
        realtime.publish("order:updated", updated);
        return updated;
      }
    },

    cancel: async (idOrCode: string): Promise<Order> => {
      if (DEMO_MODE) {
        return latency(() => demoDb.updateOrderStatus(idOrCode, "cancelled"), 120);
      }
      try {
        return await request(t(`/orders/${idOrCode}/cancel`), { method: "PATCH" }).then(toOrder);
      } catch {
        const sb = supabaseBrowser();
        if (sb) {
          try {
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            let query = sb.from("orders").update({ status: "cancelled" });
            if (uuidRegex.test(idOrCode)) {
              query = query.or(`id.eq.${idOrCode},tracking_code.eq.${idOrCode}`);
            } else {
              query = query.eq("tracking_code", idOrCode);
            }
            const { data, error } = await query.select().maybeSingle();
            if (!error && data) return toOrder(data);
          } catch {
            // ignore
          }
        }
        return demoDb.updateOrderStatus(idOrCode, "cancelled");
      }
    },

    adminActive: async (): Promise<AdminOrder[]> => {
      if (DEMO_MODE) {
        return demoDb.orders(true).map((o) => ({
          ...o,
          customerName: "Customer",
          customerEmail: null,
          customerPhone: o.phone ?? null,
        }));
      }
      try {
        const rows = await request<unknown[]>(t("/orders/admin/active"));
        return rows.map((row) => {
          const record = row as { customer_name?: string | null; customer_email?: string | null; customer_phone?: string | null; phone?: string | null; delivery_address?: string | null };
          return {
            ...toOrder(row),
            customerName: record.customer_name ?? null,
            customerEmail: record.customer_email ?? null,
            customerPhone: record.customer_phone ?? record.phone ?? null,
            phone: record.customer_phone ?? record.phone ?? null,
            deliveryAddress: record.delivery_address ?? null,
          };
        });
      } catch (err) {
        // Fallback 1: Query Supabase directly if NestJS backend is unreachable
        const sb = supabaseBrowser();
        if (sb) {
          try {
            const { data, error } = await sb
              .from("orders")
              .select("id, tracking_code, completed_at, status, fulfilment, channel, notes, total_cents, created_at, customer_id, order_items(menu_item_id, name, quantity, unit_price_cents)")
              .in("status", ["new", "preparing", "ready", "out_for_delivery"])
              .order("created_at", { ascending: false });

            if (!error && data) {
              const customerIds = [...new Set(data.map((d) => d.customer_id).filter(Boolean))];
              let profileMap = new Map<string, { display_name?: string; phone?: string }>();
              if (customerIds.length > 0) {
                const { data: profs } = await sb.from("profiles").select("id, display_name, phone").in("id", customerIds);
                if (profs) {
                  profs.forEach((p) => profileMap.set(p.id, p));
                }
              }
              return data.map((row) => {
                const prof = profileMap.get(row.customer_id);
                // Extract Phone and Address if embedded in notes
                let extractedPhone = prof?.phone ?? null;
                let extractedAddress: string | null = null;
                if (row.notes) {
                  const phoneMatch = row.notes.match(/Phone:\s*([^\s|\]]+)/i);
                  if (phoneMatch && !extractedPhone) extractedPhone = phoneMatch[1];
                  const addrMatch = row.notes.match(/Address:\s*([^\]|]+)/i);
                  if (addrMatch) extractedAddress = addrMatch[1].trim();
                }
                const cleanedNotes = row.notes ? row.notes.replace(/\[(?:Phone:[^\]|]*\|?\s*)?(?:Address:[^\]|]*\|?\s*)?\]/g, "").trim() : null;

                return {
                  ...toOrder({ ...row, notes: cleanedNotes }),
                  customerName: prof?.display_name ?? "Customer",
                  customerEmail: null,
                  customerPhone: extractedPhone,
                  phone: extractedPhone,
                  deliveryAddress: extractedAddress,
                };
              });
            }
          } catch {
            // ignore and fallback to demoDb
          }
        }
        // Fallback 2: demoDb orders
        return demoDb.orders(true).map((o) => ({
          ...o,
          customerName: "Customer",
          customerEmail: null,
          customerPhone: o.phone ?? null,
        }));
      }
    },

    complete: async (idOrCode: string): Promise<Order> => {
      if (DEMO_MODE) {
        const completedOrder = demoDb.updateOrderStatus(idOrCode, "completed");
        realtime.publish("order:updated", completedOrder);
        return completedOrder;
      }
      try {
        const completedOrder = await request(t(`/orders/${idOrCode}/complete`), { method: "PATCH" }).then(toOrder);
        realtime.publish("order:updated", completedOrder);
        return completedOrder;
      } catch {
        // Fallback: update in Supabase directly
        let completedOrder: Order;
        const sb = supabaseBrowser();
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        if (sb) {
          try {
            let query = sb
              .from("orders")
              .update({ status: "completed", completed_at: new Date().toISOString() });
            if (uuidRegex.test(idOrCode)) {
              query = query.or(`id.eq.${idOrCode},tracking_code.eq.${idOrCode}`);
            } else {
              query = query.eq("tracking_code", idOrCode);
            }
            const { data, error } = await query.select().maybeSingle();
            if (!error && data) {
              completedOrder = toOrder(data);
              realtime.publish("order:updated", completedOrder);
              return completedOrder;
            }
          } catch {
            // continue to service role attempt
          }
        }

        // Direct Supabase REST call using service role key if available
        if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
          try {
            const filterParam = uuidRegex.test(idOrCode)
              ? `or=(id.eq.${idOrCode},tracking_code.eq.${idOrCode})`
              : `tracking_code=eq.${encodeURIComponent(idOrCode)}`;
            const res = await fetch(`${SUPABASE_URL}/rest/v1/orders?${filterParam}`, {
              method: "PATCH",
              headers: {
                apikey: SUPABASE_SERVICE_ROLE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                "Content-Type": "application/json",
                Prefer: "return=representation",
              },
              body: JSON.stringify({
                status: "completed",
                completed_at: new Date().toISOString(),
              }),
            });
            if (res.ok) {
              const rows = (await res.json()) as any[];
              if (rows && rows.length > 0) {
                completedOrder = toOrder(rows[0]);
                realtime.publish("order:updated", completedOrder);
                return completedOrder;
              }
            }
          } catch (srErr) {
            console.warn("Direct service-role complete order error:", srErr);
          }
        }

        completedOrder = demoDb.updateOrderStatus(idOrCode, "completed");
        realtime.publish("order:updated", completedOrder);
        return completedOrder;
      }
    },
  },

  feedback: {
    submit: async (input: {
      orderId: string;
      rating: number;
      text: string;
      source: "text" | "voice";
      customerEmail?: string;
      customerName?: string;
    }): Promise<Feedback> => {
      // Resolve authentic customer details from Supabase Auth or provided input
      const sb = supabaseBrowser();
      let resolvedEmail = input.customerEmail?.trim() || "";
      let resolvedName = input.customerName?.trim() || "";

      if (sb) {
        try {
          const { data: userAuth } = await sb.auth.getUser();
          if (userAuth.user?.email && !resolvedEmail) {
            resolvedEmail = userAuth.user.email.trim();
          }
          if (!resolvedName) {
            resolvedName =
              userAuth.user?.user_metadata?.full_name?.trim() ||
              userAuth.user?.user_metadata?.name?.trim() ||
              "";
          }
          const customerId = userAuth.user?.id;
          if (customerId) {
            const { data: prof } = await sb
              .from("profiles")
              .select("display_name, email")
              .eq("id", customerId)
              .maybeSingle();
            if (prof?.email && !resolvedEmail) resolvedEmail = prof.email.trim();
            if (prof?.display_name && !resolvedName) resolvedName = prof.display_name.trim();
          }
        } catch (authErr) {
          console.warn("Notice checking customer auth for feedback:", authErr);
        }
      }

      if (!resolvedName) {
        resolvedName = resolvedEmail ? resolvedEmail.split("@")[0] : "Customer";
      }

      // n8n is notified by the NestJS API (server-side, with the secret). The
      // fallbacks below only persist the review; they can't trigger emails, so
      // say exactly why the API path didn't run.
      let apiFailure = "";
      const offline = () =>
        console.warn(`Feedback saved, but n8n was NOT notified (no email): ${apiFailure}`);

      // 1. Try NestJS backend endpoint first
      try {
        const result = await request(t("/feedback"), {
          method: "POST",
          body: json({
            orderId: input.orderId,
            rating: input.rating,
            text: input.text,
            source: input.source,
            customerEmail: resolvedEmail || undefined,
            customerName: resolvedName || undefined,
          }),
          anonymous: true,
        }).then(toFeedback);
        return result;
      } catch (backendErr) {
        apiFailure =
          backendErr instanceof ApiError
            ? `the API rejected the review (${backendErr.status}: ${backendErr.message}).`
            : `the API at ${API_URL} is unreachable — start it with \`npm run start:dev\` in the project root.`;
      }

      // 2. Direct Supabase persistence
      if (sb) {
        try {
          const { data: userAuth } = await sb.auth.getUser();
          const userId = userAuth.user?.id;
          if (userId) {
            const { data: inserted, error: insertErr } = await sb
              .from("feedback")
              .insert({
                tenant_id: TENANT_ID,
                order_id: input.orderId,
                customer_id: userId,
                rating: input.rating,
                text: input.text,
                source: input.source,
              })
              .select()
              .maybeSingle();

            if (!insertErr && inserted) {
              offline();
              return toFeedback(inserted);
            }
          }
        } catch (sbErr) {
          console.warn("Supabase direct feedback persistence notice:", sbErr);
        }
      }

      // 3. Resilient DemoDB persistence fallback
      const demoResult = demoDb.submitFeedback(input);
      offline();
      return demoResult;
    },

    escalations: (): Promise<Feedback[]> =>
      request<unknown[]>(t("/feedback/escalations"))
        .then((r) => r.map(toFeedback))
        .catch(() => []),

    setEscalation: (id: string, status: EscalationStatus): Promise<Feedback> =>
      request(t(`/feedback/${id}/escalation`), { method: "PATCH", body: json({ status }) }).then(toFeedback),

    issueDiscount: (id: string, percentOff: number): Promise<Feedback> =>
      request(t(`/feedback/${id}/discount`), { method: "POST", body: json({ percentOff }) }).then(toFeedback),
  },

  analytics: {
    summary: (days = 30): Promise<AnalyticsSummary> =>
      request<Record<string, unknown>>(t(`/analytics/summary?days=${days}`))
        .then((r) => ({
          siteVisits: Number(r.site_visits ?? 0),
          revenueCents: Number(r.revenue_cents ?? 0),
          orders: Number(r.orders ?? 0),
          cancelled: Number(r.cancelled ?? 0),
          voiceOrders: Number(r.voice_orders ?? 0),
          avgTicketCents: Number(r.avg_ticket_cents ?? 0),
          revenueByDay: ((r.revenue_by_day as { day: string; revenue_cents: number; orders: number }[]) ?? []).map((d) => ({
            day: d.day,
            revenueCents: Number(d.revenue_cents ?? 0),
            orders: Number(d.orders ?? 0),
          })),
          funnel: (r.funnel as AnalyticsSummary["funnel"]) ?? {},
          sentiment: (r.sentiment as AnalyticsSummary["sentiment"]) ?? {},
        }))
        .catch(() => ({
          siteVisits: 0,
          revenueCents: 0,
          orders: 0,
          cancelled: 0,
          voiceOrders: 0,
          avgTicketCents: 0,
          revenueByDay: [],
          funnel: {},
          sentiment: {},
        })),

    /** Fire-and-forget funnel beacon for drop-off analytics. */
    track(stage: "menu_view" | "cart_add" | "checkout_open") {
      let sessionId = sessionStorage.getItem("ff-session");
      if (!sessionId) sessionStorage.setItem("ff-session", (sessionId = crypto.randomUUID()));
      void fetch(`${API_URL}/api${t("/events")}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: json({ sessionId, stage }),
        keepalive: true,
      }).catch(() => undefined);
    },
  },

  reservations: {
    list: (date?: string): Promise<Reservation[]> =>
      request<unknown[]>(t(`/reservations${date ? `?date=${date}` : ""}`))
        .then((r) => r.map(toReservation))
        .catch(() => []),

    update: (id: string, status: ReservationStatus, tableLabel?: string): Promise<Reservation> =>
      request(t(`/reservations/${id}`), { method: "PATCH", body: json({ status, tableLabel }) }).then(toReservation),
  },

  users: {
    list: async (query = ""): Promise<UserSummary[]> => {
      // 1. Try NestJS backend
      try {
        const res = await request<UserSummary[]>(`/admin/users${query ? `?q=${encodeURIComponent(query)}` : ""}`);
        if (res && res.length > 0) return res;
      } catch {
        // NestJS unreachable -> query Supabase Auth directly
      }

      // 2. Direct Supabase Admin API
      if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
        try {
          const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=50`, {
            headers: {
              apikey: SUPABASE_SERVICE_ROLE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
          });
          if (res.ok) {
            const data = (await res.json()) as { users: any[] };
            const needle = query.trim().toLowerCase();
            return (data.users || [])
              .filter((u) => !u.is_anonymous && (!needle || (u.email ?? "").toLowerCase().includes(needle)))
              .map((u) => {
                const isLocked = isSuperAdminEmail(u.email);
                const assignedRole = resolveRole(u.email, u.app_metadata?.role);
                const isPending = !u.email_confirmed_at && Boolean(u.invited_at);
                return {
                  id: u.id,
                  email: u.email ?? null,
                  role: assignedRole,
                  tenantId: (u.app_metadata?.tenant_id as string | undefined) ?? null,
                  lastSignInAt: u.last_sign_in_at ?? null,
                  createdAt: u.created_at,
                  locked: isLocked,
                  status: isPending ? "pending" : "active",
                  invitedAt: u.invited_at ?? null,
                };
              });
          }
        } catch (sbErr) {
          console.warn("Direct Supabase user list notice:", sbErr);
        }
      }

      // 3. Fallback demo data
      return demoDb.staff().map((s) => ({
        id: s.id,
        email: s.email,
        role: s.role,
        tenantId: s.tenantId,
        lastSignInAt: s.lastSignInAt,
        createdAt: s.createdAt,
        locked: isSuperAdminEmail(s.email),
        status: "active",
      }));
    },

    setRole: async (id: string, role: Extract<Role, "manager" | "staff" | "user">, tenantId: string | null): Promise<unknown> => {
      // 1. Try NestJS backend
      try {
        return await request(`/admin/users/${id}/role`, { method: "PATCH", body: json({ role, tenantId: tenantId ?? undefined }) });
      } catch {
        // Fallback to direct Supabase Admin
      }

      // 2. Direct Supabase Admin API
      if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
        try {
          const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
            method: "PUT",
            headers: {
              apikey: SUPABASE_SERVICE_ROLE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              app_metadata: {
                role,
                tenant_id: role === "user" ? null : tenantId,
              },
            }),
          });
          if (res.ok) {
            demoDb.setStaffRole(id, role, tenantId);
            return { id, role };
          }
        } catch (sbErr) {
          console.warn("Direct Supabase role update notice:", sbErr);
        }
      }

      // 3. Fallback demoDb
      return demoDb.setStaffRole(id, role, tenantId);
    },

    invite: async (email: string, role: Extract<Role, "manager" | "staff">, tenantId?: string): Promise<{ id: string; email: string; inviteLink?: string }> => {
      const cleanEmail = email.trim().toLowerCase();

      // 1. Try NestJS backend invite endpoint if available
      try {
        const res = await request<{ id: string; email: string; inviteLink?: string }>("/admin/users/invite", {
          method: "POST",
          body: json({ email: cleanEmail, role, tenantId: tenantId ?? TENANT_ID }),
        });
        if (res) return res;
      } catch {
        // Fallback to Supabase Admin API
      }

      // 2. Direct Supabase Admin generate_link / invite
      if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
        try {
          const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
          const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
            method: "POST",
            headers: {
              apikey: SUPABASE_SERVICE_ROLE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              type: "invite",
              email: cleanEmail,
              data: {
                role,
                full_name: role.toUpperCase(),
              },
              redirect_to: `${origin}/accept-invite`,
            }),
          });

          if (res.ok) {
            const data = await res.json();
            const userId = data.id;

            // Set app_metadata.role on the created user
            if (userId) {
              await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
                method: "PUT",
                headers: {
                  apikey: SUPABASE_SERVICE_ROLE_KEY,
                  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  app_metadata: {
                    role,
                    tenant_id: tenantId ?? TENANT_ID,
                  },
                }),
              });
            }

            return {
              id: userId,
              email: cleanEmail,
              inviteLink: data.action_link ?? `${origin}/accept-invite`,
            };
          } else {
            const errBody = await res.json().catch(() => ({}));
            throw new Error(errBody.message || errBody.error_description || "Invitation failed.");
          }
        } catch (sbErr) {
          console.warn("Direct Supabase invite notice:", sbErr);
          throw sbErr;
        }
      }

      throw new Error("Unable to send invitation: auth service not configured.");
    },
  },

  voice: {
    session: (): Promise<VoiceSession> => request(t("/voice/session")),
    signedUrl: (): Promise<Pick<VoiceSession, "signedUrl" | "overrides">> => request("/voice/signed-url"),
  },

  admin: {
    tenants: (): Promise<Tenant[]> =>
      request<Record<string, unknown>[]>("/admin/tenants")
        .then((rows) =>
          rows.map((r) => ({
            id: r.id as string,
            name: r.name as string,
            slug: r.slug as string,
            plan: r.plan as Tenant["plan"],
            status: r.status as Tenant["status"],
            menuItems: Number(r.menu_items ?? 0),
            orders30d: Number(r.orders_30d ?? 0),
            revenue30dCents: Number(r.revenue_30d_cents ?? 0),
            createdAt: r.created_at as string,
          })),
        )
        .catch(() => []),

    setTenantStatus: (id: string, status: Tenant["status"]) =>
      request(`/admin/tenants/${id}`, { method: "PATCH", body: json({ status }) }),

    logs: (level?: ApiLog["level"]): Promise<ApiLog[]> =>
      request<Record<string, unknown>[]>(`/admin/logs${level ? `?level=${level}` : ""}`)
        .then((rows) =>
          rows.map((r) => ({
            id: r.id as number,
            tenantId: r.tenant_id as string | null,
            method: r.method as string,
            route: r.route as string,
            status: r.status as number,
            durationMs: r.duration_ms as number,
            level: r.level as ApiLog["level"],
            createdAt: r.created_at as string,
          })),
        )
        .catch(() => []),

    usage: (): Promise<ApiUsage> =>
      request<{ by_day: ApiUsage["byDay"]; by_tenant: Record<string, unknown>[] }>("/admin/usage")
        .then((r) => ({
          byDay: r.by_day ?? [],
          byTenant: (r.by_tenant ?? []).map((x) => ({
            tenantId: x.tenant_id as string | null,
            requests: Number(x.requests ?? 0),
            p95Ms: Math.round(Number(x.p95_ms ?? 0)),
            errorRate: Number(x.error_rate ?? 0),
          })),
        }))
        .catch(() => ({ byDay: [], byTenant: [] })),
  },
};
