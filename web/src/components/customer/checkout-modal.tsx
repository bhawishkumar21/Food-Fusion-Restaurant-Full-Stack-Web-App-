"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Bike, Check, ChefHat, Loader2, ShoppingBag, Store, UtensilsCrossed } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { AnimatedDialog } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { api, normalise } from "@/lib/api";
import { realtime } from "@/lib/realtime";
import { supabaseBrowser, syncProfile } from "@/lib/supabase/client";
import type { Fulfilment, Order } from "@/lib/types";
import { cn, formatPrice, shortId } from "@/lib/utils";
import { cartTotals, resolveCart, useCartStore } from "@/store/cart-store";
import { useMenuStore } from "@/store/menu-store";

const FULFILMENT: { value: Fulfilment; label: string; hint: string; icon: typeof Store }[] = [
  { value: "pickup", label: "Pickup", hint: "Ready in ~15 min", icon: Store },
  { value: "delivery", label: "Delivery", hint: "30–40 min", icon: Bike },
  { value: "dine_in", label: "Dine-in", hint: "We'll bring it over", icon: UtensilsCrossed },
];

const TRACK: { status: Order["status"]; label: string; icon: typeof Check }[] = [
  { status: "new", label: "Received", icon: ShoppingBag },
  { status: "preparing", label: "Preparing", icon: ChefHat },
  { status: "ready", label: "Ready", icon: Check },
  { status: "out_for_delivery", label: "On the way", icon: Bike },
];

export function CheckoutModal() {
  const router = useRouter();
  const { panel, open, raw, viaVoice, clear, lastOrder, setLastOrder, promo, setPromo } = useCartStore(
    useShallow((s) => ({
      panel: s.panel,
      open: s.open,
      raw: s.lines,
      viaVoice: s.viaVoice,
      clear: s.clear,
      lastOrder: s.lastOrder,
      setLastOrder: s.setLastOrder,
      promo: s.promo,
      setPromo: s.setPromo,
    })),
  );
  const items = useMenuStore((s) => s.items);
  const { lines, subtotalCents } = resolveCart(raw, items);
  const { discountCents, totalCents } = cartTotals(subtotalCents, promo);

  const [fulfilment, setFulfilment] = useState<Fulfilment>("pickup");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [notes, setNotes] = useState("");
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Order | null>(null);
  const isOpen = panel === "checkout";

  // Prepopulate phone and address from user profile
  useEffect(() => {
    if (!isOpen) return;
    const client = supabaseBrowser();
    if (!client) return;
    void client.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const metaPhone = data.user.user_metadata?.phone_number ?? data.user.user_metadata?.phone ?? data.user.phone ?? "";
      const metaAddr = data.user.user_metadata?.delivery_address ?? "";
      if (metaPhone) setPhoneNumber((p) => p || metaPhone);
      if (metaAddr) setDeliveryAddress((a) => a || metaAddr);

      const { data: profile } = await client
        .from("profiles")
        .select("*")
        .eq("id", data.user.id)
        .maybeSingle<Record<string, unknown>>();

      if (profile) {
        const pPhone = String(profile.phone_number ?? profile.phone ?? "");
        const pAddr = String(profile.delivery_address ?? profile.address ?? "");
        if (pPhone) setPhoneNumber((p) => p || pPhone);
        if (pAddr) setDeliveryAddress((a) => a || pAddr);
      }
    });
  }, [isOpen]);

  // Live order tracking after placement.
  useEffect(() => {
    if (!placed) return;
    realtime.trackOrder(placed.id);
    return realtime.on("order:updated", (p) => {
      const o = normalise.order(p);
      if (o.id === placed.id) {
        setPlaced(o);
        setLastOrder(o);
      }
    });
  }, [placed?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const placeOrder = async () => {
    if (!phoneNumber.trim()) {
      return setError("Please provide your phone number before placing the order.");
    }
    if (fulfilment === "delivery" && !deliveryAddress.trim()) {
      return setError("Please provide your delivery address for delivery orders.");
    }

    setPlacing(true);
    setError(null);
    try {
      // Sync phone & address to profile if signed in
      const client = supabaseBrowser();
      if (client) {
        const { data: userData } = await client.auth.getUser();
        if (userData.user && !userData.user.is_anonymous) {
          await syncProfile(userData.user, {
            phone_number: phoneNumber.trim(),
            delivery_address: deliveryAddress.trim(),
          }).catch(() => undefined);
        }
      }

      const order = await api.orders.place({
        items: lines.map((l) => ({
          menuItemId: l.item.id,
          quantity: l.quantity,
          name: l.item.name,
          unitPriceCents: l.item.priceCents,
        })),
        fulfilment,
        notes: notes.trim() || undefined,
        channel: viaVoice ? "voice" : "web",
        phoneNumber: phoneNumber.trim() || undefined,
        deliveryAddress: deliveryAddress.trim() || undefined,
        promoCode: promo?.code,
      });
      setPlaced(order);
      setLastOrder(order);
      clear();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Something went wrong. Please try again.";
      // A spent code is dropped so the guest can place the order at full price or try another.
      if (/promo code/i.test(message)) {
        setPromo(null);
        setError(`${message} It has been removed — review the new total and place your order again.`);
      } else {
        setError(message);
      }
    } finally {
      setPlacing(false);
    }
  };

  const close = () => {
    open("none");
    // Reset after the exit animation.
    setTimeout(() => {
      setPlaced(null);
      setShowNote(false);
      setNotes("");
    }, 300);
  };

  const stepIndex = placed ? TRACK.findIndex((t) => t.status === placed.status) : -1;

  return (
    <AnimatedDialog
      open={isOpen}
      onOpenChange={(o) => (o ? open("checkout") : close())}
      title={placed ? "Order confirmed" : "Checkout"}
      description={placed ? `Order ${shortId(placed.id)} · ${formatPrice(placed.totalCents)}` : `${lines.length} dishes · ${formatPrice(totalCents)}`}
    >
      <AnimatePresence mode="wait" initial={false}>
        {!placed ? (
          <motion.div key="form" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="flex flex-col gap-6">
            <fieldset>
              <legend className="mb-3 text-sm font-medium">How would you like it?</legend>
              <div className="grid grid-cols-3 gap-2">
                {FULFILMENT.map(({ value, label, hint, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={fulfilment === value}
                    onClick={() => setFulfilment(value)}
                    className={cn(
                      "relative flex cursor-pointer flex-col items-start gap-1 rounded-[var(--radius-md)] border p-3 text-left transition-colors",
                      fulfilment === value ? "border-primary/70 bg-primary/10" : "hover:border-cream/20",
                    )}
                  >
                    <Icon className={cn("size-5", fulfilment === value ? "text-primary" : "text-muted-foreground")} />
                    <span className="text-sm font-medium">{label}</span>
                    <span className="text-[0.7rem] leading-tight text-muted-foreground">{hint}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Phone Number <span className="text-xs text-gold">(Required for order updates)</span>
                <Input
                  type="tel"
                  required
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="e.g. +92 300 1234567"
                />
              </label>

              {(fulfilment === "delivery" || deliveryAddress) && (
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Delivery Address {fulfilment === "delivery" && <span className="text-xs text-gold">(Required for delivery)</span>}
                  <Input
                    required={fulfilment === "delivery"}
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    placeholder="e.g. House 12, Street 4, Clifton, Karachi"
                  />
                </label>
              )}
            </div>

            {showNote ? (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}>
                <label htmlFor="notes" className="mb-2 block text-sm font-medium">Note for the kitchen</label>
                <Textarea id="notes" autoFocus maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Allergies, spice level, door code…" />
              </motion.div>
            ) : (
              <button type="button" onClick={() => setShowNote(true)} className="cursor-pointer self-start text-sm text-primary underline-offset-4 hover:underline">
                + Add a note for the kitchen
              </button>
            )}

            <ul className="divide-y rounded-[var(--radius-md)] bg-charcoal/50 px-4 text-sm">
              {lines.map((l) => (
                <li key={l.itemId} className="flex justify-between py-2.5">
                  <span>
                    <span className="tabular-nums text-muted-foreground">{l.quantity}×</span> {l.item.name}
                  </span>
                  <span className="tabular-nums">{formatPrice(l.quantity * l.item.priceCents)}</span>
                </li>
              ))}
              {promo && (
                <li className="flex justify-between py-2.5 text-sage-bright">
                  <span>Discount · {promo.code} ({promo.percent}%)</span>
                  <span className="tabular-nums">−{formatPrice(discountCents)}</span>
                </li>
              )}
              <li className="flex justify-between py-2.5 font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{formatPrice(totalCents)}</span>
              </li>
            </ul>

            {error && <p role="alert" className="rounded-[var(--radius-md)] bg-destructive/15 px-4 py-3 text-sm text-[#F4A190]">{error}</p>}

            <Button size="lg" onClick={placeOrder} disabled={placing || lines.length === 0}>
              {placing ? <Loader2 className="animate-spin" /> : null}
              {placing ? "Sending to the kitchen…" : `Place order · ${formatPrice(totalCents)}`}
            </Button>
          </motion.div>
        ) : (
          <motion.div key="placed" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} className="flex flex-col items-center gap-8 py-4 text-center">
            <motion.div
              initial={{ scale: 0, rotate: -40 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 14 }}
              className="grid size-20 place-items-center rounded-full bg-success text-cream shadow-[0_0_60px_-10px_var(--color-sage)]"
            >
              <Check className="size-10" strokeWidth={2.5} />
            </motion.div>

            <ol className="flex w-full items-center" aria-label="Order progress">
              {TRACK.map((step, i) => {
                const done = i <= stepIndex;
                return (
                  <li key={step.status} className="flex flex-1 flex-col items-center gap-2 text-xs" aria-current={i === stepIndex ? "step" : undefined}>
                    <motion.span
                      animate={{ backgroundColor: done ? "#2E7D5E" : "#262220", scale: i === stepIndex ? 1.12 : 1 }}
                      className="grid size-10 place-items-center rounded-full"
                    >
                      <step.icon className={cn("size-4", done ? "text-cream" : "text-muted-foreground")} />
                    </motion.span>
                    <span className={done ? "text-foreground" : "text-muted-foreground"}>{step.label}</span>
                  </li>
                );
              })}
            </ol>

            <p className="text-sm text-muted-foreground">This page updates live as the kitchen works on your order.</p>

            <div className="flex w-full gap-3">
              <Button variant="secondary" className="flex-1" onClick={close}>Done</Button>
              <Button
                className="flex-1"
                onClick={() => {
                  const targetId = placed?.id ?? lastOrder?.id;
                  close();
                  if (targetId) router.push(`/orders/track?id=${encodeURIComponent(targetId)}`);
                }}
                disabled={!placed && !lastOrder}
              >
                Track order
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </AnimatedDialog>
  );
}
