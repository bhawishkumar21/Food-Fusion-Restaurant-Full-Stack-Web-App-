"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Disc3, List, Loader2, Minus, Plus, ShoppingBag, Sparkles, Tag, Trash2, X } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { playDialTick } from "@/lib/sound-fx";
import { cn, formatPrice } from "@/lib/utils";
import { cartTotals, resolveCart, useCartStore } from "@/store/cart-store";
import { useMenuStore } from "@/store/menu-store";
import { RotaryOrderDial } from "./rotary-order-dial";

/** Size of an element, so the dial fits the space the drawer leaves it. */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ width: e.contentRect.width, height: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** Vertical space the dial needs besides its own diameter (pointer + focused-item controls). */
const DIAL_CHROME_PX = 170;
/** Below this, the list reads better than a squeezed dial. */
const MIN_DIAL_AREA_PX = 360;

/**
 * Order review shared by the cart drawer and the /cart page: the rotary dial
 * (or a plain list) scrolls on its own, while promo code, totals and Confirm
 * stay pinned at the bottom. Confirm → 360° spin → checkout.
 */
export function CartReview({ size = 340, onEmptyBrowse }: { size?: number; onEmptyBrowse: () => void }) {
  const { raw, setQuantity, remove, viaVoice, open } = useCartStore(
    useShallow((s) => ({ raw: s.lines, setQuantity: s.setQuantity, remove: s.remove, viaVoice: s.viaVoice, open: s.open })),
  );
  const items = useMenuStore((s) => s.items);
  const { lines, subtotalCents } = resolveCart(raw, items);
  const promo = useCartStore((s) => s.promo);
  const { discountCents, totalCents } = cartTotals(subtotalCents, promo);
  const [activeRaw, setActive] = useState(0);
  // null = not chosen yet: pick whichever fits the available height.
  const [chosenView, setView] = useState<"dial" | "list" | null>(null);
  const [spinToken, setSpinToken] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [scrollRef, area] = useSize<HTMLDivElement>();
  const view = chosenView ?? (area && area.height < MIN_DIAL_AREA_PX ? "list" : "dial");
  const dialSize = Math.round(
    Math.max(200, Math.min(size, (area?.width ?? size) - 8, area ? area.height + 48 - DIAL_CHROME_PX : size)),
  );
  // Keep the focus index valid as lines are removed.
  const active = Math.min(activeRaw, Math.max(0, lines.length - 1));
  const focused = lines[active];
  const blocked = lines.some((l) => !l.item.isAvailable);

  const confirm = () => {
    api.analytics.track("checkout_open");
    if (view === "list") return open("checkout");
    setSpinning(true);
    setSpinToken((t) => t + 1);
  };
  const onSpinComplete = useCallback(() => {
    setSpinning(false);
    useCartStore.getState().open("checkout");
  }, []);

  if (!lines.length) {
    return (
      <div className="m-auto flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
        <ShoppingBag className="size-10 text-cream/20" />
        <p>Your table is empty.</p>
        <Button variant="outline" onClick={onEmptyBrowse}>Browse the menu</Button>
      </div>
    );
  }

  return (
    <div className="-m-6 flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-6 pt-6 pb-3">
        <p className="text-sm text-muted-foreground">
          {viaVoice && <Sparkles className="mr-1.5 inline size-3.5 text-gold" />}
          {lines.length} {lines.length === 1 ? "dish" : "dishes"}
        </p>
        <div role="radiogroup" aria-label="Review style" className="flex gap-1 rounded-full bg-secondary p-1">
          {(["dial", "list"] as const).map((v) => (
            <button
              key={v}
              role="radio"
              aria-checked={view === v}
              onClick={() => setView(v)}
              className={cn("flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs", view === v ? "bg-velvet text-foreground" : "text-muted-foreground")}
            >
              {v === "dial" ? <Disc3 className="size-3.5" /> : <List className="size-3.5" />}
              {v === "dial" ? "Dial" : "List"}
            </button>
          ))}
        </div>
      </div>

      {/* Only the dishes scroll; the footer below never leaves the screen. */}
      <div
        ref={scrollRef}
        data-testid="cart-scroll"
        className="min-h-[160px] flex-1 overflow-y-auto overscroll-contain px-6 pb-4 [scrollbar-width:thin]"
      >
        {view === "dial" ? (
          <div className="flex flex-col items-center gap-4">
            <RotaryOrderDial
              lines={lines}
              active={active}
              onActive={setActive}
              spinToken={spinToken}
              onSpinComplete={onSpinComplete}
              size={dialSize}
              totalLabel={formatPrice(totalCents)}
            />

            {/* Focused item controls. */}
            <AnimatePresence mode="wait">
              {focused && (
                <motion.div
                  key={focused.itemId}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex w-full items-center gap-2"
                >
                  <Button size="icon" variant="ghost" aria-label="Previous item" disabled={spinning} onClick={() => { playDialTick(); setActive((active - 1 + lines.length) % lines.length); }}>
                    <ChevronLeft />
                  </Button>
                  <div className="min-w-0 flex-1 text-center">
                    <p className="truncate font-semibold">{focused.item.name}</p>
                    <p className="text-sm tabular-nums text-muted-foreground">
                      {focused.item.isAvailable ? formatPrice(focused.item.priceCents * focused.quantity) : <span className="text-[#F4A190]">Sold out — remove to continue</span>}
                    </p>
                    <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-secondary p-1">
                      <Button size="icon-sm" variant="ghost" aria-label={`One fewer ${focused.item.name}`} onClick={() => setQuantity(focused.itemId, focused.quantity - 1)}>
                        <Minus />
                      </Button>
                      <motion.span key={focused.quantity} initial={{ scale: 1.4 }} animate={{ scale: 1 }} className="w-6 text-center text-sm font-semibold tabular-nums">
                        {focused.quantity}
                      </motion.span>
                      <Button size="icon-sm" variant="ghost" aria-label={`One more ${focused.item.name}`} disabled={!focused.item.isAvailable} onClick={() => setQuantity(focused.itemId, focused.quantity + 1)}>
                        <Plus />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`Remove ${focused.item.name}`} onClick={() => remove(focused.itemId)}>
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                  <Button size="icon" variant="ghost" aria-label="Next item" disabled={spinning} onClick={() => { playDialTick(); setActive((active + 1) % lines.length); }}>
                    <ChevronRight />
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {lines.map(({ itemId, item, quantity }) => (
              <li key={itemId} className="flex items-center gap-3 rounded-[var(--radius-md)] border border-white/5 bg-charcoal/60 p-2.5">
                <span className="relative size-12 shrink-0 overflow-hidden rounded-[var(--radius-sm)] bg-velvet-raised">
                  {item.imageUrl ? (
                    <Image src={item.imageUrl} alt="" fill sizes="48px" unoptimized className="object-cover" />
                  ) : (
                    <span className="font-display grid size-full place-items-center text-lg text-gold/70">{item.name.charAt(0)}</span>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{item.name}</p>
                  <p className="text-sm tabular-nums text-muted-foreground">
                    {item.isAvailable ? formatPrice(item.priceCents * quantity) : <span className="text-[#F4A190]">Sold out</span>}
                  </p>
                </div>
                <div className="flex items-center gap-1 rounded-full bg-secondary p-1">
                  <Button size="icon-sm" variant="ghost" aria-label={`One fewer ${item.name}`} onClick={() => setQuantity(itemId, quantity - 1)}>
                    <Minus />
                  </Button>
                  <span className="w-5 text-center text-sm font-semibold tabular-nums">{quantity}</span>
                  <Button size="icon-sm" variant="ghost" aria-label={`One more ${item.name}`} disabled={!item.isAvailable} onClick={() => setQuantity(itemId, quantity + 1)}>
                    <Plus />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Sticky footer: promo code → totals → Confirm, always in that order. */}
      <div data-testid="cart-footer" className="shrink-0 border-t border-white/10 bg-espresso/60 px-6 pt-3 pb-5 backdrop-blur-xl">
        <PromoCodeField />
        <dl className="mt-3 flex flex-col gap-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="tabular-nums">{formatPrice(subtotalCents)}</dd>
          </div>
          <AnimatePresence initial={false}>
            {promo && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex justify-between overflow-hidden text-sage-bright"
              >
                <dt>Discount · {promo.code} ({promo.percent}%)</dt>
                <dd className="tabular-nums">−{formatPrice(discountCents)}</dd>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="flex items-baseline justify-between">
            <dt className="text-muted-foreground">Total</dt>
            <dd className="text-xl font-semibold tabular-nums">{formatPrice(totalCents)}</dd>
          </div>
        </dl>
        <Button size="lg" className="mt-3 w-full" disabled={blocked || spinning} onClick={confirm}>
          {spinning ? "Dialling the kitchen…" : "Confirm order"}
        </Button>
      </div>
    </div>
  );
}

/** Apply / remove a single-use code. It is only checked here; it is spent when the order is placed. */
function PromoCodeField() {
  const promo = useCartStore((s) => s.promo);
  const setPromo = useCartStore((s) => s.setPromo);
  const [expanded, setExpanded] = useState(false);
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setChecking(true);
    setError(null);
    try {
      const percent = await api.promo.check(code);
      setPromo({ code: code.trim().toUpperCase(), percent });
      setCode("");
      setExpanded(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't check that code.");
    } finally {
      setChecking(false);
    }
  };

  if (promo) {
    return (
      <div className="flex items-center justify-between rounded-full border border-sage/30 bg-sage/10 py-1.5 pr-1.5 pl-4 text-sm">
        <span className="flex items-center gap-2">
          <Tag className="size-4 text-sage-bright" />
          <span className="font-medium tracking-wide">{promo.code}</span>
          <span className="text-muted-foreground">applied</span>
        </span>
        <Button size="icon-sm" variant="ghost" aria-label="Remove promo code" onClick={() => setPromo(null)}>
          <X />
        </Button>
      </div>
    );
  }

  // Collapsed by default: one quiet line, so the dishes keep the space.
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-expanded={false}
        aria-controls="promo-code"
        className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-full px-1 text-sm text-muted-foreground transition-colors hover:text-gold"
      >
        <Tag className="size-4" />
        Apply coupon / promo code
      </button>
    );
  }

  return (
    <form onSubmit={apply} className="flex flex-col gap-1.5">
      <label htmlFor="promo-code" className="sr-only">
        Coupon or promo code
      </label>
      <div className="flex gap-2">
        <Input
          id="promo-code"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            setError(null);
          }}
          placeholder="e.g. WELCOME10"
          autoComplete="off"
          spellCheck={false}
          maxLength={32}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "promo-error" : undefined}
          autoFocus
          className="h-10 min-w-0 flex-1 uppercase tracking-wide"
        />
        <Button type="submit" variant="secondary" className="h-10 shrink-0" disabled={checking || !code.trim()}>
          {checking ? <Loader2 className="animate-spin" /> : "Apply"}
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-10 shrink-0"
          aria-label="Close promo code"
          onClick={() => {
            setExpanded(false);
            setCode("");
            setError(null);
          }}
        >
          <X />
        </Button>
      </div>
      {error && <p id="promo-error" role="alert" className="text-xs text-[#F4A190]">{error}</p>}
    </form>
  );
}
