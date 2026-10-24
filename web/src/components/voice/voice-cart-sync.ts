"use client";

import type { MenuItem } from "@/lib/types";
import { dishWords, parseOrder, resolveDishLoose, type DishMatch } from "@/components/customer/order-parser";

/**
 * Keeps what the voice agent *says* and what the cart *holds* in agreement.
 *
 * The agent is supposed to call the add_to_cart / add_items client tools, but
 * LLMs sometimes announce "Adding Mutton Karahi to your cart" without calling
 * a tool (or the tool isn't configured on the agent). The live voice hook
 * feeds every agent sentence through `scanAgentClaim`; dishes it names
 * exactly are added here, and generic names are reported back to the agent so
 * it asks instead of pretending.
 *
 * A short-lived ledger dedupes the two paths, so a tool call plus the agent
 * narrating it adds the dish once (see `addedRecently`).
 */

const LEDGER_WINDOW_MS = 8_000;

/**
 * Which path put a dish in the cart: an agent tool call, the agent narrating
 * ("Adding X…"), or the guest's own words ("add it").
 */
export type VoiceAddSource = "tool" | "agent" | "guest";
const ledger = new Map<string, { at: number; source: VoiceAddSource }>();
/** The same guest request transcribed twice arrives within this. */
const GUEST_REPEAT_MS = 2_500;

export function recordVoiceAdd(itemId: string, source: VoiceAddSource) {
  ledger.set(itemId, { at: Date.now(), source });
}

/** Forget recent adds (a new conversation starts fresh). */
export function clearVoiceLedger() {
  ledger.clear();
}

/**
 * Would adding this dish now duplicate an add that just happened?
 *  • agent narration only describes adds, so it defers to any recent one;
 *  • a tool call defers to adds made from words (the guest's "add it", or the
 *    agent's narration) — the same request; tool after tool is a real "one more";
 *  • the guest's words only defer to the same words transcribed twice.
 */
export function addedRecently(itemId: string, by: VoiceAddSource) {
  const entry = ledger.get(itemId);
  if (!entry) return false;
  const age = Date.now() - entry.at;
  if (age >= LEDGER_WINDOW_MS) return false;
  if (by === "agent") return true;
  if (by === "tool") return entry.source !== "tool";
  return entry.source === "guest" && age < GUEST_REPEAT_MS;
}

/** The agent states that something is (being) put in the order — not a question. */
const ADD_CLAIM =
  /\b(adding|added|i'?ll add|i will add|i'?ve added|i have added|putting|i'?ve put|i have put|i'?ll put|is now in your (cart|order)|are now in your (cart|order)|(is|are) in your (cart|order))\b/i;
/** "Adding X to your cart" → X. */
const CLAIM_CLAUSE =
  /\b(?:adding|added|add|putting|put)\s+(.+?)\s+(?:to|in|into|onto|for)\s+(?:your|the)\s+(?:cart|order|basket|table)\b/i;

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, single: 1, two: 2, couple: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

const norm = (s: string) =>
  ` ${s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()} `;

export interface AgentClaim {
  /** Dishes to add. `closest` = the agent's name wasn't exact; tell it the real one. */
  matches: { item: MenuItem; quantity: number; closest?: string }[];
  /** Generic names that fit several dishes; nothing added for these. */
  ambiguous: Extract<DishMatch, { kind: "ambiguous" }>[];
}

/**
 * Returns null when the sentence doesn't claim an add (or is a question).
 * `focus.pronounId` is the dish "Adding it to your cart" refers to;
 * `focus.tieBreakId` (the dish still being discussed) breaks ties when the
 * agent's name is loose.
 */
export function scanAgentClaim(
  text: string,
  items: MenuItem[],
  focus: { pronounId?: string | null; tieBreakId?: string | null } = {},
): AgentClaim | null {
  const sentence = text.trim();
  if (!ADD_CLAIM.test(sentence)) return null;
  // "Shall I add the karahi?" is an offer, not an action.
  const claimSentences = sentence
    .split(/(?<=[.!?])\s+/)
    .filter((s) => ADD_CLAIM.test(s) && !s.trim().endsWith("?"));
  if (!claimSentences.length) return null;

  const matches: AgentClaim["matches"] = [];
  const ambiguous: AgentClaim["ambiguous"] = [];
  // Longest names first, so "Chicken Tikka Pizza" isn't read as "Chicken Tikka".
  const byLength = [...items].sort((a, b) => b.name.length - a.name.length);

  for (const s of claimSentences) {
    let rest = norm(s);
    for (const item of byLength) {
      const name = norm(item.name);
      const at = rest.indexOf(name);
      if (at === -1) continue;
      matches.push({ item, quantity: quantityBefore(rest.slice(0, at)) });
      rest = `${rest.slice(0, at)} | ${rest.slice(at + name.length)}`;
    }
    if (matches.length) continue;

    // Nothing named exactly: resolve the "adding X to your cart" clause.
    const clause = s.match(CLAIM_CLAUSE)?.[1] ?? "";
    const pronoun = focus.pronounId ? items.find((i) => i.id === focus.pronounId) : undefined;
    if (!dishWords(clause).length) {
      // "Adding it / this / that to your cart" → the dish on screen.
      if (pronoun && clause) matches.push({ item: pronoun, quantity: quantityBefore(norm(clause)) });
      continue;
    }
    for (const f of parseOrder(clause, items)) {
      if (f.result.kind === "match") {
        matches.push({ item: f.result.item, quantity: f.quantity });
        continue;
      }
      const r = resolveDishLoose(f.result.query, items, focus.tieBreakId);
      if (r.kind === "match") matches.push({ item: r.item, quantity: f.quantity });
      else if (r.kind === "closest") matches.push({ item: r.item, quantity: f.quantity, closest: r.query });
      else if (r.kind === "ambiguous") ambiguous.push(r);
    }
  }
  return matches.length || ambiguous.length ? { matches, ambiguous } : null;
}

function quantityBefore(prefix: string) {
  const before = prefix.trim().split(" ");
  const qWord = before.at(-1) === "the" ? before.at(-2) : before.at(-1);
  return qWord && /^\d{1,2}$/.test(qWord) ? Math.min(20, Number(qWord)) : (qWord && NUMBER_WORDS[qWord]) || 1;
}

// ─────────────────────────────────────────────── dish mentions & follow-ups ──

export type DishMention =
  | { kind: "one"; item: MenuItem; closest: boolean }
  | { kind: "several"; items: MenuItem[] };

/**
 * Which dish(es) a sentence talks about, tolerating the paraphrases agents
 * use ("the Ghalib Signature Burger"). Scans word windows of 2–6 words and
 * keeps the longest that resolves; exact names beat `closest` guesses.
 */
export function findDishMention(text: string, items: MenuItem[], focusId?: string | null): DishMention | null {
  const words = norm(text).trim().split(" ").filter(Boolean);
  const found: { item: MenuItem; start: number; end: number; exact: boolean }[] = [];
  for (let end = words.length; end > 0; end--) {
    for (let len = Math.min(6, end); len >= 1; len--) {
      const start = end - len;
      if (found.some((f) => start < f.end && end > f.start)) continue; // already covered
      const phrase = words.slice(start, end).join(" ");
      // Numbers count as words here: "Deal 2" is a two-word name.
      const weight = dishWords(phrase).length + words.slice(start, end).filter((w) => /^\d+$/.test(w)).length;
      if (weight < (len === 1 ? 1 : 2)) continue;
      const r = resolveDishLoose(phrase, items, focusId);
      // Single words only count when they *are* a dish name ("Pakora").
      if (r.kind === "match" && (len > 1 || dishWords(r.item.name).length === 1)) {
        found.push({ item: r.item, start, end, exact: true });
        break;
      }
      if (r.kind === "closest" && len >= 3) {
        found.push({ item: r.item, start, end, exact: false });
        break;
      }
    }
  }
  const unique = found.filter((f, i) => found.findIndex((g) => g.item.id === f.item.id) === i);
  if (!unique.length) return null;
  if (unique.length > 1) return { kind: "several", items: unique.reverse().map((f) => f.item) };
  return { kind: "one", item: unique[0].item, closest: !unique[0].exact };
}

/** "Add it", "add to cart", "yes, add this one", "I'll take that". */
const ADD_FOLLOW_UP =
  /^(?:(?:yes|yeah|yep|sure|ok(?:ay)?|great|perfect|please|go ahead)[\s,.!]*)*(?:please\s+)?(?:add|put|order|i'?ll (?:take|have)|get me|give me|i want)\b(?:\s+(?:it|this|that|this one|that one|one|the same|one of (?:those|these)|(?:\d+|two|three|four|five)(?:\s+(?:of\s+)?(?:those|these|them|it|that|more))?))?(?:\s+(?:to|in|into)\s+(?:my|the)?\s*(?:cart|order|basket))?(?:\s+(?:too|as well|please|for me))?[\s.!]*$/i;
/** A bare yes, valid only right after the agent offered to add the focused dish. */
const AFFIRMATION = /^(?:yes|yeah|yep|sure|ok(?:ay)?|please|please do|go ahead|do it|sounds good|perfect)[\s,.!]*(?:please|thanks|thank you)?[\s.!]*$/i;
/** The agent asking whether to add something. */
export const ADD_OFFER = /\b(?:add|order|get you|put)\b[^.?!]*\?\s*$|\b(?:shall|should|can|may) i add\b|\bwould you like (?:me to add|to (?:order|add|try))\b|\bwant me to add\b/i;

export function isAddFollowUp(text: string, afterOffer: boolean) {
  const t = text.trim();
  return ADD_FOLLOW_UP.test(t) || (afterOffer && AFFIRMATION.test(t));
}

/** Quantity in a follow-up: "add two of those" → 2. */
export function followUpQuantity(text: string) {
  const m = norm(text).match(/\b(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\b/);
  if (!m) return 1;
  return /^\d+$/.test(m[1]) ? Math.min(20, Number(m[1])) : NUMBER_WORDS[m[1]] ?? 1;
}
