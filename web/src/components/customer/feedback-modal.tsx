"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Heart, Loader2, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { AnimatedDialog } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { api, normalise } from "@/lib/api";
import { demoDb } from "@/lib/demo-db";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn, shortId } from "@/lib/utils";
import { useCartStore } from "@/store/cart-store";

const RATING_LABEL = ["", "Not good", "Could be better", "It was fine", "Really good", "Exceptional"];

export function OrderFeedbackModal() {
  const { panel, open, lastOrder } = useCartStore(useShallow((s) => ({ panel: s.panel, open: s.open, lastOrder: s.lastOrder })));
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [text, setText] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [isAuthUser, setIsAuthUser] = useState(false);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check current auth user from Supabase and resolve latest completed order if needed
  useEffect(() => {
    if (panel !== "feedback") return;
    const sb = supabaseBrowser();
    if (sb) {
      void sb.auth.getUser().then(async ({ data }) => {
        const email = data.user?.email?.trim();
        if (email && !data.user?.is_anonymous) {
          setCustomerEmail(email);
          setIsAuthUser(true);
        } else {
          setIsAuthUser(false);
        }

        // If user is authenticated, guarantee we review the most recent completed order
        if (data.user?.id) {
          try {
            const { data: dbOrders } = await sb
              .from("orders")
              .select("id, tracking_code, completed_at, status, fulfilment, channel, notes, total_cents, created_at, order_items(menu_item_id, name, quantity, unit_price_cents)")
              .eq("customer_id", data.user.id)
              .order("created_at", { ascending: false })
              .limit(1);

            if (dbOrders && dbOrders.length > 0) {
              const latest = normalise.order(dbOrders[0]);
              useCartStore.getState().setLastOrder(latest);
              return;
            }
          } catch {
            // ignore
          }
        }
      });
    }

    // Fallback: if lastOrder is not yet in store, try fetching from demoDb
    if (!useCartStore.getState().lastOrder) {
      try {
        const recent = demoDb.orders(false);
        if (recent.length > 0) {
          useCartStore.getState().setLastOrder(recent[0]);
        }
      } catch {
        // ignore
      }
    }
  }, [panel]);

  const submit = async () => {
    if (!lastOrder) return;
    if (!isAuthUser && (!customerEmail.trim() || !customerEmail.includes("@"))) {
      setError("Please provide your email address so we can reply.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      await api.feedback.submit({
        orderId: lastOrder.id,
        rating,
        text: text.trim() || `Rated ${rating} out of 5 stars`,
        source: "text",
        customerEmail: customerEmail.trim() || undefined,
      });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send feedback.");
    } finally {
      setSending(false);
    }
  };

  const close = () => {
    open("none");
    setTimeout(() => {
      setRating(0);
      setText("");
      setDone(false);
    }, 300);
  };

  const shown = hover || rating;

  return (
    <AnimatedDialog
      open={panel === "feedback"}
      onOpenChange={(o) => (o ? open("feedback") : close())}
      title={done ? "Thank you" : "How was your meal?"}
      description={lastOrder && !done ? `Order ${shortId(lastOrder.id)}` : undefined}
    >
      <AnimatePresence mode="wait" initial={false}>
        {done ? (
          <motion.div key="done" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-4 py-6 text-center">
            <motion.span initial={{ scale: 0 }} animate={{ scale: [0, 1.25, 1] }} transition={{ duration: 0.5 }}>
              <Heart className="size-12 fill-primary text-primary" />
            </motion.span>
            <p className="max-w-xs text-muted-foreground">
              {rating <= 2
                ? "We're sorry it wasn't right. A manager has been notified and will reach out personally."
                : "Every note is read by our kitchen team. See you again soon."}
            </p>
            <Button variant="secondary" onClick={close}>Close</Button>
          </motion.div>
        ) : (
          <motion.div key="form" className="flex flex-col gap-6">
            <div className="flex flex-col items-center gap-2" onMouseLeave={() => setHover(0)}>
              <div role="radiogroup" aria-label="Rating" className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <motion.button
                    key={n}
                    role="radio"
                    aria-checked={rating === n}
                    aria-label={`${n} star${n > 1 ? "s" : ""}`}
                    whileHover={{ scale: 1.15, rotate: -6 }}
                    whileTap={{ scale: 0.85 }}
                    onMouseEnter={() => setHover(n)}
                    onClick={() => setRating(n)}
                    className="grid size-12 cursor-pointer place-items-center"
                  >
                    <Star className={cn("size-8 transition-colors", n <= shown ? "fill-primary text-primary" : "text-cream/20")} />
                  </motion.button>
                ))}
              </div>
              <p className="h-5 text-sm text-muted-foreground">{RATING_LABEL[shown]}</p>
            </div>

            {/* Progressive disclosure: comments appear once a rating is chosen (one tap). */}
            <AnimatePresence>
              {rating > 0 && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="flex flex-col gap-3 overflow-hidden">
                  <Textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={2000}
                    aria-label="Your comments"
                    rows={4}
                    placeholder="What stood out? Anything we should fix?"
                  />

                  {!isAuthUser && (
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="feedback-email" className="text-xs font-medium text-muted-foreground">
                        Your email <span className="text-primary">*</span> (for manager response & updates)
                      </label>
                      <Input
                        id="feedback-email"
                        type="email"
                        value={customerEmail}
                        onChange={(e) => setCustomerEmail(e.target.value)}
                        placeholder="you@example.com"
                        required
                        className="bg-charcoal/80"
                      />
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {error && <p role="alert" className="text-sm text-[#F4A190]">{error}</p>}

            <Button
              size="lg"
              disabled={
                !rating ||
                sending ||
                !lastOrder ||
                (!isAuthUser && (!customerEmail.trim() || !customerEmail.includes("@")))
              }
              onClick={submit}
            >
              {sending && <Loader2 className="animate-spin" />}
              Send feedback
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </AnimatedDialog>
  );
}

/** @deprecated Import OrderFeedbackModal from order-feedback-modal instead. */
export const FeedbackModal = OrderFeedbackModal;
