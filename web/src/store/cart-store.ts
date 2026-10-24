"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MenuItem, Order } from "@/lib/types";

/** What the cart needs to render a line even if the live menu can't resolve it. */
export type CartSnapshot = Pick<MenuItem, "name" | "priceCents" | "imageUrl" | "category">;

export interface CartLine {
  itemId: string;
  quantity: number;
  /** Captured at add time, so a line never vanishes when menu ids/sources differ. */
  snapshot?: CartSnapshot;
}

/** A promo code that has been checked (not yet redeemed; that happens on order). */
export interface AppliedPromo {
  code: string;
  percent: number;
}

type Panel = "none" | "cart" | "checkout" | "feedback";

interface CartState {
  lines: CartLine[];
  /** True once the AI assistant has touched the cart — attributed in analytics. */
  viaVoice: boolean;
  promo: AppliedPromo | null;
  panel: Panel;
  lastOrder: Order | null;
  add: (item: MenuItem, quantity?: number, viaVoice?: boolean) => void;
  setQuantity: (itemId: string, quantity: number) => void;
  remove: (itemId: string) => void;
  clear: () => void;
  setPromo: (promo: AppliedPromo | null) => void;
  open: (panel: Panel) => void;
  setLastOrder: (order: Order | null) => void;
}

const snapshotOf = (item: MenuItem): CartSnapshot => ({
  name: item.name,
  priceCents: item.priceCents,
  imageUrl: item.imageUrl,
  category: item.category,
});

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      lines: [],
      viaVoice: false,
      promo: null,
      panel: "none",
      lastOrder: null,
      add: (item, quantity = 1, viaVoice = false) =>
        set((s) => {
          const existing = s.lines.find((l) => l.itemId === item.id);
          return {
            viaVoice: s.viaVoice || viaVoice,
            lines: existing
              ? s.lines.map((l) =>
                  l.itemId === item.id
                    ? { ...l, quantity: Math.min(20, l.quantity + quantity), snapshot: snapshotOf(item) }
                    : l,
                )
              : [...s.lines, { itemId: item.id, quantity: Math.min(20, quantity), snapshot: snapshotOf(item) }],
          };
        }),
      setQuantity: (itemId, quantity) =>
        set((s) => ({
          lines:
            quantity <= 0
              ? s.lines.filter((l) => l.itemId !== itemId)
              : s.lines.map((l) => (l.itemId === itemId ? { ...l, quantity: Math.min(20, quantity) } : l)),
        })),
      remove: (itemId) => set((s) => ({ lines: s.lines.filter((l) => l.itemId !== itemId) })),
      clear: () => set({ lines: [], viaVoice: false, promo: null }),
      setPromo: (promo) => set({ promo }),
      open: (panel) => set({ panel }),
      setLastOrder: (lastOrder) => set({ lastOrder }),
    }),
    {
      name: "food-fusion-cart-v3",
      partialize: (s) => ({ lines: s.lines, viaVoice: s.viaVoice, promo: s.promo, lastOrder: s.lastOrder }),
    },
  ),
);

/**
 * Joins cart lines with live menu data (prices / stock can change mid-session).
 * A line whose id the live menu doesn't know falls back to its snapshot rather
 * than silently disappearing; the server re-prices everything at checkout.
 */
export function resolveCart(lines: CartLine[], items: MenuItem[]) {
  const resolved = lines.flatMap((l) => {
    const item =
      items.find((i) => i.id === l.itemId) ??
      (l.snapshot && items.find((i) => i.name.toLowerCase() === l.snapshot!.name.toLowerCase())) ??
      (l.snapshot && {
        id: l.itemId,
        description: "",
        badge: null,
        tags: [],
        isAvailable: true,
        voiceNotes: null,
        dailyStock: null,
        ...l.snapshot,
      });
    return item ? [{ ...l, item }] : [];
  });
  const subtotalCents = resolved
    .filter((l) => l.item.isAvailable)
    .reduce((s, l) => s + l.quantity * l.item.priceCents, 0);
  const count = resolved.reduce((s, l) => s + l.quantity, 0);
  return { lines: resolved, subtotalCents, count };
}

/** Discount is taken off the subtotal, before any tax or delivery fee (same rounding as Postgres). */
export function cartTotals(subtotalCents: number, promo: AppliedPromo | null) {
  const discountCents = promo ? Math.round((subtotalCents * promo.percent) / 100) : 0;
  return { subtotalCents, discountCents, totalCents: subtotalCents - discountCents };
}
