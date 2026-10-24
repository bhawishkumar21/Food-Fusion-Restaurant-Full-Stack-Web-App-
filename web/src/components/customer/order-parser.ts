import type { MenuItem } from "@/lib/types";

/**
 * Strict dish resolution for spoken / typed orders.
 *
 *   resolveDish("buffalo chicken burger") → match: Buffalo Chicken Burger
 *   resolveDish("chicken burger")         → ambiguous: Buffalo…, Crispy Fried…, Ghalib…
 *   resolveDish("chicken tikka")          → match: Chicken Tikka   (exact beats "Chicken Tikka Pizza")
 *   resolveDish("club sandwich")          → match: Ghalib Club Sandwich (the only dish with both words)
 *
 * Rules, in order:
 *  1. Exact name (word-for-word, ignoring order, plurals and "(new)") wins.
 *  2. Otherwise EVERY content word the guest said must appear in the dish
 *     name. Exactly one such dish → match. Several → ambiguous: the agent must
 *     ask, never substitute a "similar" dish.
 *  3. Fuzzy tolerance only absorbs small mishearings / spellings
 *     ("karahee", "peshawri"), never different words.
 */

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, single: 1, two: 2, couple: 2, pair: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, dozen: 12,
};
const FILLER = new Set([
  "add", "please", "and", "the", "of", "me", "get", "give", "i", "id", "i'd", "ill", "i'll", "im", "want", "would", "like",
  "have", "take", "order", "some", "also", "plus", "then", "can", "could", "you", "for", "to", "us", "we", "our", "more",
  "another", "x", "times", "portion", "portions", "plate", "plates", "new", "a", "an", "my", "just", "that", "this", "it", "is",
  "be", "will", "let", "lets", "let's", "put", "in", "on", "cart", "basket",
]);

/** Light phonetic folding so common ASR spellings line up ("karahee" → "karahi"). */
const fold = (w: string) =>
  w
    .replace(/ee/g, "i")
    .replace(/oo/g, "u")
    .replace(/aa/g, "a")
    .replace(/kh/g, "k")
    .replace(/q/g, "k")
    .replace(/ph/g, "f");

/** "karahis" → "karahi", "sandwiches" → "sandwich", "kababs" → "kabab". */
const stem = (w: string) =>
  w.length > 4 && /(ch|sh|s|x)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/\((new)\)/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const contentWords = (s: string) =>
  normalize(s)
    .split(" ")
    .filter((w) => w && !FILLER.has(w) && !/^\d+$/.test(w) && !(w in NUMBER_WORDS))
    .map((w) => fold(stem(w)));

function editDistance(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Same word, allowing a typo/mishearing proportional to length (none for short words). */
function sameWord(said: string, dish: string) {
  if (said === dish) return true;
  const len = Math.min(said.length, dish.length);
  const allowed = len >= 8 ? 2 : len >= 5 ? 1 : 0;
  return allowed > 0 && editDistance(said, dish) <= allowed;
}

export type DishMatch =
  | { kind: "match"; item: MenuItem }
  | { kind: "ambiguous"; query: string; options: MenuItem[] }
  | { kind: "none"; query: string };

/** Every word, in order, numbers as digits: "Deal Two" → "deal 2", "(New)" kept. */
const plainWords = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w in NUMBER_WORDS && !["a", "an", "single", "couple", "pair", "dozen"].includes(w) ? String(NUMBER_WORDS[w]) : w));

export function resolveDish(fragment: string, items: MenuItem[]): DishMatch {
  const said = [...new Set(contentWords(fragment))];
  const query = said.join(" ");

  // 0. The full name said word for word, in order. Only this tells apart
  // "Deal 1" / "Deal 2", "Dry Chicken Chilli (New)" / "Chicken Chilli Dry"
  // (same words) and "Three Milk Cake Slice" / "... (New)". The name must
  // cover everything the guest said, so extra words never get dropped.
  const spoken = ` ${plainWords(fragment).join(" ")} `;
  const verbatim = items
    .map((item) => ({ item, name: plainWords(item.name).join(" "), words: contentWords(item.name) }))
    .filter((d) => d.name && spoken.includes(` ${d.name} `) && said.every((w) => d.words.includes(w)))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (verbatim) return { kind: "match", item: verbatim.item };

  if (!said.length) return { kind: "none", query };

  const scored = items.map((item) => ({ item, words: [...new Set(contentWords(item.name))] }));

  // 1. A literal spoken menu name always wins. Do this *before* phonetic
  // comparison: "Chicken Burger" must never fall through to a neighbouring
  // "Buffalo Chicken Burger" merely because both contain the same words.
  const literal = scored.find(
    (d) => d.words.length === said.length && said.every((w) => d.words.includes(w)),
  );
  if (literal) return { kind: "match", item: literal.item };

  // 2. Same set of words with a limited spelling/ASR tolerance (duplicates
  // on the source menu → first wins).
  const exact = scored.find(
    (d) => d.words.length === said.length && said.every((w) => d.words.some((dw) => sameWord(w, dw))),
  );
  if (exact) return { kind: "match", item: exact.item };

  // 3. Every word the guest said must be in the dish name.
  const candidates = scored
    .filter((d) => said.every((w) => d.words.some((dw) => sameWord(w, dw))))
    .sort((a, b) => a.words.length - b.words.length); // fewest extra words first
  // Collapse duplicate listings of the same dish name.
  const unique = candidates.filter((c, i) => candidates.findIndex((d) => d.item.name === c.item.name) === i);

  if (unique.length === 1) return { kind: "match", item: unique[0].item };
  if (unique.length > 1) return { kind: "ambiguous", query: fragment.trim(), options: unique.slice(0, 4).map((c) => c.item) };
  return { kind: "none", query: fragment.trim() };
}

export type LooseMatch = DishMatch | { kind: "closest"; query: string; item: MenuItem };

/**
 * resolveDish plus two voice-only fallbacks, for names an agent paraphrases
 * ("Ghalib Signature Burger" for "Ghalib Chicken Burger With Garlic Mayo"):
 *
 *  • the dish currently in focus on screen breaks a tie between options;
 *  • `closest`: no dish has every word, but exactly one has all but one of
 *    them (at least two) including the dish-type word ("burger") — callers
 *    must tell the guest the real name.
 */
export function resolveDishLoose(fragment: string, items: MenuItem[], preferId?: string | null): LooseMatch {
  const strict = resolveDish(fragment, items);
  if (strict.kind === "match") return strict;
  const preferred = preferId ? items.find((i) => i.id === preferId) : undefined;
  if (strict.kind === "ambiguous") {
    return preferred && strict.options.some((o) => o.id === preferred.id) ? { kind: "match", item: preferred } : strict;
  }

  const said = [...new Set(contentWords(fragment))];
  if (said.length < 2) return strict;
  const head = said[said.length - 1];
  const scored = items
    .map((item) => {
      const words = contentWords(item.name);
      return {
        item,
        hasHead: words.some((w) => sameWord(head, w)),
        hits: said.filter((w) => words.some((dw) => sameWord(w, dw))).length,
      };
    })
    .filter((d) => d.hasHead && d.hits >= 2 && d.hits >= said.length - 1);
  const best = Math.max(0, ...scored.map((d) => d.hits));
  const top = scored.filter((d) => d.hits === best);
  const unique = top.filter((c, i) => top.findIndex((d) => d.item.name === c.item.name) === i);

  if (preferred && unique.some((d) => d.item.id === preferred.id)) return { kind: "closest", query: strict.query, item: preferred };
  if (unique.length === 1) return { kind: "closest", query: strict.query, item: unique[0].item };
  if (unique.length > 1) return { kind: "ambiguous", query: fragment.trim(), options: unique.slice(0, 4).map((d) => d.item) };
  return strict;
}

/** Content words of a phrase as the matcher sees them (fillers dropped, folded). */
export const dishWords = contentWords;

function quantityIn(fragment: string): number {
  const digits = fragment.match(/\b(\d{1,2})\b/);
  if (digits) return Math.min(20, Math.max(1, Number(digits[1])));
  for (const w of normalize(fragment).split(" ")) if (NUMBER_WORDS[w]) return NUMBER_WORDS[w];
  return 1;
}

export interface ParsedFragment {
  quantity: number;
  result: DishMatch;
}

/** Splits "2 X and 1 Y, Z" into fragments and resolves each one strictly. */
export function parseOrder(text: string, items: MenuItem[]): ParsedFragment[] {
  return normalize(text.replace(/[,;]/g, " and "))
    .split(/\s(?:and|plus|also|then)\s/)
    .map((f) => f.trim())
    .filter((f) => contentWords(f).length > 0)
    .map((fragment) => ({ quantity: quantityIn(fragment), result: resolveDish(fragment, items) }));
}

/** Convenience: only the confidently matched lines (merged by dish). */
export function parseOrderItems(text: string, items: MenuItem[]) {
  const lines: { item: MenuItem; quantity: number }[] = [];
  for (const { quantity, result } of parseOrder(text, items)) {
    if (result.kind !== "match") continue;
    const existing = lines.find((l) => l.item.id === result.item.id);
    if (existing) existing.quantity = Math.min(20, existing.quantity + quantity);
    else lines.push({ item: result.item, quantity });
  }
  return lines;
}

/** "Which chicken burger: A, B or C?" — what the agent should ask. */
export function clarifyQuestion(result: Extract<DishMatch, { kind: "ambiguous" }>) {
  const names = result.options.map((o) => o.name);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : names[0];
  return `Which one did you mean for "${result.query}": ${list}?`;
}

export const ADD_INTENT = /\b(add|order|get me|i('ll| will| would like)|i want|i'd like|give me|bring|can i (get|have)|we('ll| will) have|take)\b/;
export const REMOVE_INTENT = /\b(remove|drop|take off|delete|no more|cancel)\b/;
