"use client";

import { create } from "zustand";
import type { MenuFilter, MenuItem } from "@/lib/types";

interface MenuState {
  items: MenuItem[];
  /** True once the first menu fetch has finished (successfully or not). */
  loaded: boolean;
  filter: MenuFilter;
  searchQuery: string;
  /** Items the voice assistant is currently pointing at. */
  highlighted: string[];
  /**
   * The one dish the voice conversation is about ("add it" means this one).
   * `glow` keeps its card lit until it's added or a while passes.
   */
  focus: { id: string; at: number; glow: boolean } | null;
  setItems: (items: MenuItem[]) => void;
  setLoaded: () => void;
  upsert: (item: MenuItem) => void;
  setFilter: (filter: MenuFilter) => void;
  setSearchQuery: (query: string) => void;
  resetSearch: () => void;
  highlight: (ids: string[]) => void;
  setFocus: (id: string | null) => void;
  /** The focused dish made it into the cart: stop glowing, keep it as context. */
  settleFocus: () => void;
}

/** Context older than this is too stale for "add it". */
export const FOCUS_TTL_MS = 3 * 60_000;
const FOCUS_GLOW_MS = 90_000;
let focusTimer: ReturnType<typeof setTimeout> | undefined;

let highlightTimer: ReturnType<typeof setTimeout> | undefined;

export function matchesSearchQuery(item: MenuItem, query: string): boolean {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const name = item.name.toLowerCase();
  const cat = (item.category || "").toLowerCase();
  const desc = (item.description || "").toLowerCase();
  const badge = (item.badge || "").toLowerCase();

  return name.includes(q) || cat.includes(q) || desc.includes(q) || badge.includes(q);
}

export const useMenuStore = create<MenuState>()((set) => ({
  items: [],
  loaded: false,
  filter: "all",
  searchQuery: "",
  highlighted: [],
  focus: null,
  setItems: (items) => set({ items }),
  setLoaded: () => set({ loaded: true }),
  upsert: (item) =>
    set((s) => ({
      items: s.items.some((i) => i.id === item.id)
        ? s.items.map((i) => (i.id === item.id ? item : i))
        : [...s.items, item],
    })),
  setFilter: (filter) => set({ filter }),
  setSearchQuery: (searchQuery) => {
    const q = searchQuery.trim().toLowerCase();
    set((s) => {
      let nextFilter = s.filter;
      if (q && s.filter !== "all") {
        const matchesInCurrentCategory = s.items.some(
          (i) => i.category === s.filter && matchesSearchQuery(i, q),
        );
        if (!matchesInCurrentCategory) {
          nextFilter = "all";
        }
      }
      return { searchQuery, filter: nextFilter };
    });
  },
  resetSearch: () => set({ searchQuery: "", filter: "all" }),
  highlight: (ids) => {
    clearTimeout(highlightTimer);
    set({ highlighted: ids });
    // Highlights fade on their own so the canvas never stays cluttered.
    highlightTimer = setTimeout(() => set({ highlighted: [] }), 9000);
  },
  setFocus: (id) => {
    clearTimeout(focusTimer);
    if (!id) return set({ focus: null });
    set({ focus: { id, at: Date.now(), glow: true } });
    focusTimer = setTimeout(() => set((s) => (s.focus?.id === id ? { focus: { ...s.focus, glow: false } } : {})), FOCUS_GLOW_MS);
  },
  settleFocus: () => {
    clearTimeout(focusTimer);
    set((s) => (s.focus ? { focus: { ...s.focus, at: Date.now(), glow: false } } : {}));
  },
}));

/** The focused dish, if it's still fresh enough to act on. */
export function activeDish(s: Pick<MenuState, "focus" | "items">): MenuItem | null {
  if (!s.focus || Date.now() - s.focus.at > FOCUS_TTL_MS) return null;
  return s.items.find((i) => i.id === s.focus!.id) ?? null;
}

export const selectVisibleItems = (s: MenuState) => {
  const q = s.searchQuery?.trim().toLowerCase() ?? "";
  return s.items.filter((item) => {
    if (s.filter !== "all" && item.category !== s.filter) return false;
    if (!q) return true;
    return matchesSearchQuery(item, q);
  });
};

/** Categories in menu order (items arrive grouped by category). */
export const selectCategories = (s: MenuState) => [...new Set(s.items.map((i) => i.category))];

/**
 * The dish still being discussed (focused, not yet added). Only this one may
 * break a tie between similar names; once it's in the cart, a generic name
 * like "mutton karahi" must be asked about again, not resolved to it.
 */
export function discussedDishId(s: Pick<MenuState, "focus" | "items">): string | null {
  return s.focus?.glow && activeDish(s) ? s.focus.id : null;
}
