"use client";

import { useMemo } from "react";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import type { MenuFilter, MenuItem } from "@/lib/types";
import { formatPrice } from "@/lib/utils";
import { resolveCart, useCartStore } from "@/store/cart-store";
import { activeDish, discussedDishId, matchesSearchQuery, useMenuStore } from "@/store/menu-store";
import {
  ADD_OFFER,
  addedRecently,
  findDishMention,
  followUpQuantity,
  isAddFollowUp,
  recordVoiceAdd,
  scanAgentClaim,
  type AgentClaim,
  type VoiceAddSource,
} from "@/components/voice/voice-cart-sync";
import { ADD_INTENT, clarifyQuestion, dishWords, parseOrder, REMOVE_INTENT, resolveDish, resolveDishLoose } from "./order-parser";

/** Brings a dish card into view (clearing a category filter that hides it). */
export function revealDish(id?: string) {
  const menu = useMenuStore.getState();
  const item = id ? menu.items.find((i) => i.id === id) : undefined;
  if (item && menu.filter !== "all" && menu.filter !== item.category) menu.setFilter("all");
  if (item && menu.searchQuery && !matchesSearchQuery(item, menu.searchQuery)) {
    menu.setSearchQuery("");
  }
  setTimeout(() => {
    const el = id ? document.getElementById(`dish-${id}`) : null;
    (el ?? document.getElementById("menu"))?.scrollIntoView({ behavior: "smooth", block: el ? "center" : "start" });
  }, 80);
}

/**
 * Makes `item` the dish the conversation is about: its card glows until it is
 * added, and "add it" / "yes" / add_to_cart without a name refer to it.
 */
export function focusDish(item: MenuItem) {
  const menu = useMenuStore.getState();
  menu.setFocus(item.id);
  menu.highlight([item.id]);
  revealDish(item.id);
}

/**
 * The one way voice puts a dish in the cart, from a tool call or from the
 * agent's own words (voice-cart-sync). Adds, glows the card gold, scrolls to
 * it and confirms with a toast. Returns false when the other path already
 * added this dish moments ago, so a single request never adds twice.
 */
export function voiceAddToCart(item: MenuItem, quantity: number, source: VoiceAddSource): boolean {
  if (addedRecently(item.id, source)) return false;
  recordVoiceAdd(item.id, source);
  useCartStore.getState().add(item, quantity, true);
  const menu = useMenuStore.getState();
  // Still "the dish we're talking about" (for "add another"), but done glowing.
  menu.setFocus(item.id);
  menu.settleFocus();
  menu.highlight([item.id]);
  revealDish(item.id);
  toast.success(`${quantity > 1 ? `${quantity} × ` : ""}${item.name} added to cart`);
  api.analytics.track("cart_add");
  return true;
}

/**
 * Makes the cart match an agent's "Adding X to your cart" (see
 * voice-cart-sync.ts). Returns a correction for the agent, or null when the
 * cart now agrees with what it said.
 */
export function applyAgentClaim(claim: AgentClaim): string | null {
  const notes: string[] = [];
  for (const { item, quantity, closest } of claim.matches) {
    if (!item.isAvailable) notes.push(`${item.name} is SOLD OUT and was not added — tell the guest.`);
    else {
      voiceAddToCart(item, quantity, "agent");
      if (closest) notes.push(`There is no "${closest}" on the menu; "${item.name}" was added. Use that exact name with the guest.`);
    }
  }
  for (const a of claim.ambiguous) {
    useMenuStore.getState().highlight(a.options.map((o) => o.id));
    revealDish(a.options[0]?.id);
    notes.push(`The cart was NOT updated: ${clarifyQuestion(a)} Ask the guest which one, then call add_to_cart with the exact name.`);
  }
  return notes.length ? notes.join(" ") : null;
}

/** Grace period for the agent's own tool call to land before we reconcile its words. */
const CLAIM_SETTLE_MS = 1_800;
/** A bare "yes" counts as "add it" only this soon after the agent offered. */
const OFFER_TTL_MS = 30_000;
let lastOfferAt = 0;
const NEGATED = /\b(?:don'?t|do not|no|not|never|without|remove|cancel)\b/i;

/**
 * Every final transcript line of a voice conversation goes through here, so
 * the screen and cart follow the conversation even when the agent doesn't
 * call a tool:
 *
 *  agent "Adding X to your cart."      → X is added (after a short grace period)
 *  agent / guest names one dish         → that dish is in focus (gold glow)
 *  guest "add it" / "add to cart"       → the dish in focus is added
 *  agent "Shall I add it?" guest "yes"  → the dish in focus is added
 *  guest "add the X"                    → X is added straight from their words
 *
 * `notify` sends a contextual update to the agent so it never contradicts
 * the cart.
 */
export function onVoiceMessage(role: "user" | "agent", text: string, notify: (note: string) => void) {
  const menu = useMenuStore.getState();
  const items = menu.items;
  const focus = activeDish(menu);
  const tieBreakId = discussedDishId(menu);

  if (role === "agent") {
    const claim = scanAgentClaim(text, items, { pronounId: focus?.id, tieBreakId });
    if (claim) {
      setTimeout(() => {
        const note = applyAgentClaim(claim);
        if (note) notify(note);
      }, CLAIM_SETTLE_MS);
      return;
    }
    const mention = findDishMention(text, items, tieBreakId);
    if (mention?.kind === "one") focusDish(mention.item);
    else if (mention?.kind === "several") {
      // A list of options: "add it" would be a guess, so drop the focus.
      menu.setFocus(null);
      menu.highlight(mention.items.map((i) => i.id));
    }
    lastOfferAt = ADD_OFFER.test(text) && (mention?.kind === "one" || (!mention && focus)) ? Date.now() : 0;
    return;
  }

  // Guest.
  const mention = findDishMention(text, items, tieBreakId);
  const offered = Date.now() - lastOfferAt < OFFER_TTL_MS;
  if (mention?.kind === "one") {
    focusDish(mention.item);
    if (ADD_INTENT.test(text.toLowerCase()) && !NEGATED.test(text) && !text.trim().endsWith("?")) {
      lastOfferAt = 0;
      addFromConversation(mention.item, followUpQuantity(text), notify);
    }
    return;
  }
  if (!mention && isAddFollowUp(text, offered)) {
    lastOfferAt = 0;
    if (focus) addFromConversation(focus, followUpQuantity(text), notify);
    else notify(`The guest said "${text.trim()}" but no dish is selected on screen. Ask which dish they want.`);
  }
}

function addFromConversation(item: MenuItem, quantity: number, notify: (note: string) => void) {
  if (!item.isAvailable) return notify(`${item.name} is SOLD OUT; nothing was added. Tell the guest and suggest something else.`);
  if (voiceAddToCart(item, quantity, "guest")) {
    notify(`${quantity} × ${item.name} is now in the cart (added from the guest's words). Confirm it; do not add it again.`);
  }
}

/**
 * The bimodal bridge: functions the voice agent calls to drive the visual UI.
 * Register the same names as *client tools* on the ElevenLabs agent:
 *
 *   filter_menu      { category: string }                  // exact category name, or "all"
 *   highlight_items  { item_ids: string }                 // comma-separated ids
 *   add_to_cart      { item_name: string, quantity?: number, item_id?: string }
 *   add_items        { order: string }                     // "2 chicken peshawari karahi and 1 club sandwich"
 *   remove_from_cart { item_name?: string, item_id?: string }
 *   view_cart        {}
 *   checkout         {}
 *
 * Accuracy contract (see order-parser.ts): exact names win; a request that
 * fits several dishes adds nothing and returns `NEEDS_CLARIFICATION: …` so
 * the agent asks. Two voice-only allowances: "it" / no name means the dish in
 * focus on screen (and focus breaks ties), and a paraphrased name that clearly
 * points at one dish ("Ghalib Signature Burger") is added with a note telling
 * the agent the real name.
 */
export function useAssistantTools() {
  return useMemo(() => {
    const menu = () => useMenuStore.getState();
    const cart = () => useCartStore.getState();
    const byId = (id?: string) => (id ? menu().items.find((i) => i.id === id) : undefined);
    const scrollToDish = revealDish;
    const reveal = () => document.getElementById("menu")?.scrollIntoView({ behavior: "smooth" });

    /**
     * The name the guest said is the source of truth; an id is only trusted
     * when it agrees with that name (agents sometimes pick a neighbouring row).
     */
    const pick = (item_name?: string, item_id?: string): { item: MenuItem; note?: string } | { reply: string } => {
      const focused = activeDish(menu());
      // "it" / "this one" / no name at all → the dish on screen.
      if (!dishWords(item_name ?? "").length && !byId(item_id)) {
        return focused
          ? { item: focused }
          : { reply: "NEEDS_CLARIFICATION: no dish is selected on screen. Ask the guest which dish they mean." };
      }
      if (item_name?.trim()) {
        const r = resolveDishLoose(item_name, menu().items, discussedDishId(menu()));
        if (r.kind === "match") return { item: r.item };
        if (r.kind === "closest") {
          return { item: r.item, note: `There is no "${item_name}" on the menu; this is "${r.item.name}". Use that exact name with the guest.` };
        }
        if (r.kind === "ambiguous") {
          menu().highlight(r.options.map((o) => o.id));
          scrollToDish(r.options[0]?.id);
          return { reply: `NEEDS_CLARIFICATION: ${clarifyQuestion(r)} Nothing was added — do not tell the guest it was added; ask them which one.` };
        }
        // The name didn't resolve, but a valid id (e.g. the card on screen) is exact.
        const byIdItem = byId(item_id);
        if (byIdItem) return { item: byIdItem, note: `Matched by id: the dish is "${byIdItem.name}". Use that exact name with the guest.` };
        return { reply: `NOT_ON_MENU: there is no dish called "${item_name}". Offer the closest section instead of guessing.` };
      }
      const item = byId(item_id);
      return item ? { item } : { reply: "NOT_ON_MENU: that dish id isn't on the menu." };
    };

    return {
      filter_menu: ({ category }: { category: string }) => {
        const categories = [...new Set(menu().items.map((i) => i.category))];
        const match: MenuFilter | null = category.trim().toLowerCase() === "all" ? "all" : matchCategory(category, categories);
        if (!match) return `No "${category}" section. Categories are exactly: ${categories.join(", ")}.`;
        menu().setFilter(match);
        reveal();
        const n = match === "all" ? menu().items.length : menu().items.filter((i) => i.category === match).length;
        return match === "all" ? `Showing the full menu, ${n} dishes.` : `Showing ${n} dishes in ${match}.`;
      },

      highlight_items: ({ item_ids }: { item_ids: string }) => {
        const ids = item_ids.split(",").map((s) => s.trim()).filter((id) => byId(id));
        if (ids.length === 1) focusDish(byId(ids[0])!);
        menu().highlight(ids);
        if (ids[0]) scrollToDish(ids[0]);
        else reveal();
        return ids.length ? `Highlighted ${ids.length} dishes on screen.` : "No matching dishes found.";
      },

      add_to_cart: ({ item_name, item_id, quantity = 1 }: { item_name?: string; item_id?: string; quantity?: number }) => {
        const picked = pick(item_name, item_id);
        if ("reply" in picked) return picked.reply;
        const { item } = picked;
        if (!item.isAvailable) return `${item.name} is sold out right now. Suggest an alternative.`;
        const qty = Math.min(20, Math.max(1, Math.round(quantity)));
        const note = "note" in picked && picked.note ? ` ${picked.note}` : "";
        if (!voiceAddToCart(item, qty, "tool")) return `${item.name} was just added from what you said — it is already in the order.${note}`;
        return `Added ${qty} × ${item.name}.${note}`;
      },

      /** Several dishes in one sentence; ambiguous parts are asked about, not guessed. */
      add_items: ({ order }: { order: string }) => {
        const fragments = parseOrder(order, menu().items);
        if (!fragments.length) return "NOT_ON_MENU: I couldn't find any dishes in that. Ask what they'd like.";
        const added: string[] = [];
        const soldOut: string[] = [];
        const questions: string[] = [];
        const missing: string[] = [];
        const highlight: string[] = [];
        for (const { quantity, result } of fragments) {
          if (result.kind === "ambiguous") {
            questions.push(clarifyQuestion(result));
            highlight.push(...result.options.map((o) => o.id));
          } else if (result.kind === "none") {
            missing.push(result.query);
          } else if (!result.item.isAvailable) {
            soldOut.push(result.item.name);
          } else {
            if (addedRecently(result.item.id, "tool")) continue;
            recordVoiceAdd(result.item.id, "tool");
            cart().add(result.item, quantity, true);
            added.push(`${quantity} × ${result.item.name}`);
            highlight.push(result.item.id);
          }
        }
        menu().highlight(highlight);
        if (highlight[0]) scrollToDish(highlight[0]);
        if (added.length) {
          toast.success(`Added to cart: ${added.join(", ")}`);
          api.analytics.track("cart_add");
        }
        const parts: string[] = [];
        if (added.length) parts.push(`Added ${listJoin(added)}.`);
        if (soldOut.length) parts.push(`${listJoin(soldOut)} ${soldOut.length > 1 ? "are" : "is"} sold out right now.`);
        if (missing.length) parts.push(`I couldn't find ${listJoin(missing.map((m) => `"${m}"`))} on the menu.`);
        if (questions.length) parts.push(`NEEDS_CLARIFICATION: ${questions.join(" ")}`);
        return parts.join(" ");
      },

      remove_from_cart: ({ item_name, item_id }: { item_name?: string; item_id?: string }) => {
        const inCart = new Set(cart().lines.map((l) => l.itemId));
        const picked = pick(item_name, item_id);
        if ("reply" in picked) {
          // "Remove the burger" is fine when only one burger is in the cart.
          const r = item_name ? resolveDish(item_name, menu().items.filter((i) => inCart.has(i.id))) : null;
          if (r?.kind !== "match") return picked.reply;
          cart().remove(r.item.id);
          return `Removed ${r.item.name}.`;
        }
        if (!inCart.has(picked.item.id)) return `${picked.item.name} isn't in the order.`;
        cart().remove(picked.item.id);
        return `Removed ${picked.item.name}.`;
      },

      view_cart: () => {
        const { lines, subtotalCents } = resolveCart(cart().lines, menu().items);
        cart().open("cart");
        if (!lines.length) return "The cart is empty.";
        return `${lines.map((l) => `${l.quantity} × ${l.item.name}`).join(", ")}. Subtotal ${formatPrice(subtotalCents)}.`;
      },

      checkout: () => {
        if (!cart().lines.length) return "The cart is empty — add something first.";
        cart().open("checkout");
        api.analytics.track("checkout_open");
        return "Checkout is open on screen. Ask how they'd like to receive the order.";
      },
    };
  }, []);
}

export type AssistantTools = ReturnType<typeof useAssistantTools>;

/** Plain-text menu snapshot sent to the agent as context (exact names only). */
export function menuContext(items: MenuItem[]) {
  return items
    .map((i) => `${i.id} | ${i.name} | ${i.category} | ${formatPrice(i.priceCents)} | ${i.isAvailable ? "AVAILABLE" : "SOLD OUT"}`)
    .join("\n");
}

/**
 * Strict category resolution: an exact name, or the single category that
 * contains every word said. Several fits → no guess (null).
 */
export function matchCategory(query: string, categories: string[]): string | null {
  const words = (s: string) => s.toLowerCase().replace(/&/g, " ").replace(/[^a-z0-9\s']/g, " ").split(/\s+/).filter(Boolean);
  const q = words(query).map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
  if (!q.length || (q.length === 1 && q[0] === "all")) return null;
  const exact = categories.find((c) => words(c).join(" ") === q.join(" "));
  if (exact) return exact;
  const fits = categories.filter((c) => {
    const cw = words(c).map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
    return q.every((w) => cw.includes(w));
  });
  return fits.length === 1 ? fits[0] : null;
}

// ──────────────────────────────────────────────── demo-mode "agent" ──
// When no ElevenLabs agent is configured, requests are understood by a small
// rule-based parser that calls the very same tools — so the bimodal canvas
// can be demonstrated without credentials.

/** Everyday words → the exact category they mean. */
const CATEGORY_SYNONYMS: [RegExp, string][] = [
  [/\b(drinks?|beverages?|juices?|shakes?|lassi|lemonade|cold drinks?)\b/, "Cold Beverages"],
  [/\b(tea|chai|kawah|hot drinks?)\b/, "Hot Beverages"],
  [/\b(desserts?|sweets?|ice ?cream|brownie|kulfi)\b/, "Desserts"],
  [/\b(bbq|barbecue|grill|grilled|kebabs?|kababs?)\b/, "BBQ"],
  [/\b(breads?|naans?|roti|parathas?|chapati)\b/, "Naan, Paratha & Chapati"],
  [/\b(kids?|children|child)\b/, "Kid's Corner"],
  [/\bpizzas?\b/, "Brick Oven Pizza"],
  [/\bsteaks?\b/, "Steaks"],
  [/\b(rice|biryani)\b/, "Rice"],
  [/\b(chef'?s?|recommend\w*|specials?|signature)\b/, "Chef's Recommendation"],
  [/\b(deals?|combos?|bundles?)\b/, "Deals"],
  [/\b(new|latest)\b/, "New Addition"],
  [/\b(starters?|soups?|appetizers?)\b/, "Starters"],
  [/\bkarahis?\b/, "Karahi"],
  [/\bhandis?\b/, "Handi"],
  [/\b(chaat|puri)\b/, "Chaat"],
  [/\b(pasta|burgers?|sandwich(es)?|continental|world)\b/, "Flavors of the World"],
];

/** "a, b and c" */
export const listJoin = (parts: string[]) =>
  parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;

/** Tool replies carry machine prefixes for the LLM agent; the demo voice reads them naturally. */
const speakable = (reply: string) => reply.replace(/\b(NEEDS_CLARIFICATION|NOT_ON_MENU): /g, "");

export function runDemoIntent(text: string, tools: AssistantTools): string {
  const q = text.toLowerCase();
  const items = useMenuStore.getState().items;
  const categories = [...new Set(items.map((i) => i.category))];

  if (/check ?out|pay|place (the |my )?order/.test(q)) return tools.checkout();
  if (/(what('| i)s|show|view).*(cart|basket|order)/.test(q)) return tools.view_cart();
  if (/\b(vegan|vegetarian|gluten|halal|allerg\w*|dairy|nut)\b/.test(q)) {
    return "This menu doesn't list dietary or allergen details, so I can't promise that. Please check with the staff when you order.";
  }

  const fragments = parseOrder(text, items);
  const resolved = fragments.filter((f) => f.result.kind !== "none");
  if (REMOVE_INTENT.test(q) && resolved.length) return speakable(tools.remove_from_cart({ item_name: text.replace(REMOVE_INTENT, "") }));
  if (ADD_INTENT.test(q) && fragments.length) return speakable(tools.add_items({ order: text }));

  if (/\b(all|everything|full menu)\b/.test(q)) return tools.filter_menu({ category: "all" });

  // Naming a dish (no "add") → describe it or ask which one; never pick a lookalike.
  const single = resolveDish(text, items);
  if (single.kind === "match") {
    tools.highlight_items({ item_ids: single.item.id });
    const m = single.item;
    return `${m.name}, ${formatPrice(m.priceCents)}.${m.description ? ` ${m.description}` : ""} Shall I add it?`;
  }
  if (single.kind === "ambiguous") {
    tools.highlight_items({ item_ids: single.options.map((o) => o.id).join(",") });
    return clarifyQuestion(single);
  }

  const category = CATEGORY_SYNONYMS.find(([re]) => re.test(q))?.[1] ?? matchCategory(text, categories);
  if (category && categories.includes(category)) {
    const reply = tools.filter_menu({ category });
    const picks = items.filter((i) => i.isAvailable && i.category === category).slice(0, 3);
    if (picks.length) {
      tools.highlight_items({ item_ids: picks.map((p) => p.id).join(",") });
      return `${reply} The ${picks[0].name} is a good place to start. Shall I add it?`;
    }
    return reply;
  }
  return "Try “show me the BBQ”, “what's for dessert?”, or “add two chicken corn soups”.";
}
