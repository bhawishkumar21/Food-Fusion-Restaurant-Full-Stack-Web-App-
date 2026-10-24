"use client";

import { motion } from "framer-motion";
import { Check, ChefHat, Loader2, PackageSearch, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, normalise } from "@/lib/api";
import { realtime } from "@/lib/realtime";
import type { Order } from "@/lib/types";
import { cn, formatPrice, shortId } from "@/lib/utils";
import { useCartStore } from "@/store/cart-store";
import { CartReview } from "./cart-review";
import { MenuSection } from "./menu-section";
import { StorefrontShell } from "./customer-app";
import { DEMO_MODE } from "@/lib/config";
import { demoDb } from "@/lib/demo-db";
import { supabaseBrowser } from "@/lib/supabase/client";

function PageTitle({ eyebrow, title, accent }: { eyebrow: string; title: string; accent: string }) {
  return (
    <div className="mx-auto max-w-7xl px-6 pt-28">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="font-display mt-3 text-5xl font-medium sm:text-6xl">
        {title} <span className="italic text-gold">{accent}</span>
      </h1>
    </div>
  );
}

export function MenuPage() {
  return (
    <StorefrontShell>
      <PageTitle eyebrow="Ghalib Cuisine" title="Tonight's" accent="Table" />
      <MenuSection />
    </StorefrontShell>
  );
}

export function CartPage() {
  const router = useRouter();
  return (
    <StorefrontShell>
      <PageTitle eyebrow="Review" title="Your" accent="order" />
      <div className="mx-auto max-w-lg px-6 pb-24 pt-8">
        <div className="glass rounded-[var(--radius-xl)] p-6">
          <CartReview size={400} onEmptyBrowse={() => router.push("/menu")} />
        </div>
      </div>
    </StorefrontShell>
  );
}

const TRACK: { status: Order["status"]; label: string; icon: typeof Check }[] = [
  { status: "new", label: "Received", icon: ShoppingBag },
  { status: "preparing", label: "Preparing", icon: ChefHat },
  { status: "ready", label: "Ready", icon: Check },
  { status: "out_for_delivery", label: "On the way", icon: ShoppingBag },
  { status: "completed", label: "Collected", icon: Check },
];

/** Live status for ?id=…, or the customer's most recent order. */
export function TrackOrderPage() {
  const params = useSearchParams();
  const lastOrder = useCartStore((s) => s.lastOrder);
  const openPanel = useCartStore((s) => s.open);
  const setLastOrder = useCartStore((s) => s.setLastOrder);
  const paramId = params.get("id");
  const [activeOrderId, setActiveOrderId] = useState<string | null>(paramId ?? lastOrder?.id ?? null);
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  // Update timer every second for accurate 5-minute countdown
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Dynamically resolve latest active non-cancelled, non-completed order
  useEffect(() => {
    let isCancelled = false;

    async function resolveLatestOrder() {
      if (paramId) {
        setActiveOrderId(paramId);
        return;
      }

      // 1. Try querying latest active orders for the authenticated customer
      try {
        const activeOrders = await api.orders.active();
        if (!isCancelled && activeOrders && activeOrders.length > 0) {
          // Filter strictly for running orders: new, preparing, ready, out_for_delivery
          const liveOrders = activeOrders.filter(
            (o) => !["cancelled", "completed"].includes(o.status)
          );
          if (liveOrders.length > 0) {
            const sorted = [...liveOrders].sort(
              (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );
            const newest = sorted[0];
            setActiveOrderId(newest.id);
            setOrder(newest);
            setLastOrder(newest);
            setLoading(false);
            return;
          }
        }
      } catch {
        // Continue to fallback checks
      }

      // 2. Direct Supabase query for most recent order of this user (active first, then recently completed)
      const sb = supabaseBrowser();
      if (!DEMO_MODE && sb) {
        try {
          const { data: userAuth } = await sb.auth.getUser();
          if (userAuth.user?.id) {
            // Check for running active order
            const { data: dbOrders } = await sb
              .from("orders")
              .select("id, tracking_code, completed_at, status, fulfilment, channel, notes, total_cents, created_at, order_items(menu_item_id, name, quantity, unit_price_cents)")
              .eq("customer_id", userAuth.user.id)
              .in("status", ["new", "preparing", "ready", "out_for_delivery"])
              .order("created_at", { ascending: false })
              .limit(1);

            if (!isCancelled && dbOrders && dbOrders.length > 0) {
              const latestDbOrder = normalise.order(dbOrders[0]);
              setActiveOrderId(latestDbOrder.id);
              setOrder(latestDbOrder);
              setLastOrder(latestDbOrder);
              setLoading(false);
              return;
            }

            // If no running order, check for recently completed order so customer can review
            const { data: completedDbOrders } = await sb
              .from("orders")
              .select("id, tracking_code, completed_at, status, fulfilment, channel, notes, total_cents, created_at, order_items(menu_item_id, name, quantity, unit_price_cents)")
              .eq("customer_id", userAuth.user.id)
              .eq("status", "completed")
              .order("created_at", { ascending: false })
              .limit(1);

            if (!isCancelled && completedDbOrders && completedDbOrders.length > 0) {
              const latestCompleted = normalise.order(completedDbOrders[0]);
              setActiveOrderId(latestCompleted.id);
              setOrder(latestCompleted);
              setLastOrder(latestCompleted);
              setLoading(false);
              return;
            }
          }
        } catch {
          // ignore
        }
      }

      // 3. Fallback to cart store's lastOrder (allow active or completed, only purge cancelled)
      if (!isCancelled) {
        if (lastOrder && lastOrder.status !== "cancelled") {
          setActiveOrderId(lastOrder.id);
          setOrder(lastOrder);
          setLoading(false);
        } else {
          // Purge cancelled order from store
          if (lastOrder && lastOrder.status === "cancelled") {
            useCartStore.getState().setLastOrder(null);
          }
          setActiveOrderId(null);
          setOrder(null);
          setLoading(false);
        }
      }
    }

    void resolveLatestOrder();
    return () => {
      isCancelled = true;
    };
  }, [paramId]);

  const handleCancel = async () => {
    if (!order) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const updated = await api.orders.cancel(order.id);
      // Immediately clear the cancelled order from active tracking
      setOrder(null);
      setLastOrder(null);
      setActiveOrderId(null);
      // Also sync demoDb state if present
      demoDb.orders(false);
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : "Failed to cancel order.");
    } finally {
      setCancelling(false);
    }
  };

  useEffect(() => {
    if (!activeOrderId) {
      setLoading(false);
      return;
    }
    setLoading(true);

    const syncOrder = async () => {
      try {
        const loaded = await api.orders.get(activeOrderId);
        if (loaded.status === "cancelled") {
          setOrder(null);
          useCartStore.getState().setLastOrder(null);
          setActiveOrderId(null);
        } else {
          setOrder((prev) => {
            // If transition to completed just happened, trigger review prompt
            if (prev && prev.status !== "completed" && loaded.status === "completed") {
              setTimeout(() => useCartStore.getState().open("feedback"), 600);
            }
            return loaded;
          });
          useCartStore.getState().setLastOrder(loaded);
          setMissing(false);
        }
      } catch {
        setMissing(true);
      } finally {
        setLoading(false);
      }
    };

    void syncOrder();

    // 1. Socket.io & BroadcastChannel event listener
    void realtime.connect().then(() => realtime.trackOrder(activeOrderId));
    const removeSocket = realtime.on("order:updated", (p) => {
      const o = normalise.order(p);
      if (o.id === activeOrderId || o.trackingCode === activeOrderId) {
        if (o.status === "cancelled") {
          setOrder(null);
          useCartStore.getState().setLastOrder(null);
          setActiveOrderId(null);
        } else {
          setOrder((prev) => {
            if (prev && prev.status !== "completed" && o.status === "completed") {
              setTimeout(() => useCartStore.getState().open("feedback"), 600);
            }
            return o;
          });
          useCartStore.getState().setLastOrder(o);
        }
      }
    });

    // 2. Supabase Realtime channel listener (listens on both id and tracking_code)
    let channel: ReturnType<NonNullable<ReturnType<typeof supabaseBrowser>>["channel"]> | null = null;
    const sb = supabaseBrowser();
    if (!DEMO_MODE && sb) {
      channel = sb
        .channel(`public:orders-live:${activeOrderId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "orders" },
          (payload) => {
            const updatedRow = payload.new as { id?: string; tracking_code?: string } | undefined;
            if (
              !updatedRow ||
              updatedRow.id === activeOrderId ||
              updatedRow.tracking_code === activeOrderId
            ) {
              void syncOrder();
            }
          }
        )
        .subscribe();
    }

    // 3. Fast polling safety net every 3 seconds for active running orders
    const pollInterval = setInterval(() => {
      void syncOrder();
    }, 3000);

    return () => {
      removeSocket();
      clearInterval(pollInterval);
      if (channel) void channel.unsubscribe();
    };
  }, [activeOrderId]);

  const step = order ? TRACK.findIndex((t) => t.status === order.status) : -1;

  // 5-minute cancellation window logic:
  // Allowed ONLY if status is 'new' or 'preparing' AND elapsed time < 5 minutes (300,000 ms)
  const elapsedMs = order ? now - new Date(order.createdAt).getTime() : Infinity;
  const fiveMinMs = 5 * 60 * 1000;
  const isCancellable = order && (order.status === "new" || order.status === "preparing") && elapsedMs < fiveMinMs;
  const isExpired = order && (order.status === "new" || order.status === "preparing") && elapsedMs >= fiveMinMs;
  const remainingSec = Math.max(0, Math.ceil((fiveMinMs - elapsedMs) / 1000));
  const remainingMinutes = Math.floor(remainingSec / 60);
  const remainingSeconds = remainingSec % 60;

  return (
    <StorefrontShell>
      <PageTitle eyebrow="Order tracking" title="Where's my" accent="food?" />
      <div className="mx-auto max-w-2xl px-6 pb-24 pt-8">
        {loading && !order ? (
          <div className="h-72 animate-pulse rounded-[var(--radius-xl)] bg-card" />
        ) : !activeOrderId || missing ? (
          <div className="glass flex flex-col items-center gap-4 rounded-[var(--radius-xl)] p-10 text-center">
            <PackageSearch className="size-10 text-cream/30" />
            <p className="text-muted-foreground">{missing ? "We couldn't find that active order." : "No active orders to track. Explore our menu!"}</p>
            <Button asChild>
              <Link href="/menu">Browse the menu</Link>
            </Button>
          </div>
        ) : !order ? (
          <div className="h-72 animate-pulse rounded-[var(--radius-xl)] bg-card" />
        ) : (
          <div className="glass rounded-[var(--radius-xl)] p-6 sm:p-8">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xl font-semibold">Order {order.trackingCode || shortId(order.id)}</h2>
              <span className="text-gold">{formatPrice(order.totalCents)}</span>
            </div>

            {/* 5-minute cancellation banner / action */}
            {isCancellable && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-red-500/30 bg-red-500/10 p-3.5">
                <div>
                  <p className="text-sm font-medium text-red-300">Need to cancel?</p>
                  <p className="text-xs text-muted-foreground">
                    Cancellation window closes in {remainingMinutes}:{String(remainingSeconds).padStart(2, "0")}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={cancelling}
                  onClick={handleCancel}
                  className="bg-red-600 font-semibold text-white hover:bg-red-700"
                >
                  {cancelling ? <Loader2 className="animate-spin" /> : null}
                  Cancel Order
                </Button>
              </div>
            )}

            {isExpired && (
              <div className="mt-4 rounded-[var(--radius-md)] border border-white/10 bg-secondary/30 px-3.5 py-2.5 text-xs text-muted-foreground">
                Cancellation window expired (5-min limit).
              </div>
            )}

            {cancelError && (
              <p role="alert" className="mt-3 text-xs text-[#F4A190]">
                {cancelError}
              </p>
            )}

            {order.status === "cancelled" ? (
              <p className="mt-6 rounded-[var(--radius-md)] bg-destructive/15 px-4 py-3 text-[#F4A190]">This order was cancelled.</p>
            ) : (
              <ol className="mt-8 flex items-start" aria-label="Order progress">
                {TRACK.map((t, i) => {
                  const done = i <= step;
                  return (
                    <li key={t.status} className="flex flex-1 flex-col items-center gap-2 text-center text-xs" aria-current={i === step ? "step" : undefined}>
                      <motion.span animate={{ backgroundColor: done ? "#2E7D5E" : "#262220", scale: i === step ? 1.15 : 1 }} className="grid size-11 place-items-center rounded-full">
                        <t.icon className={cn("size-4", done ? "text-cream" : "text-muted-foreground")} />
                      </motion.span>
                      <span className={done ? "text-foreground" : "text-muted-foreground"}>{t.label}</span>
                    </li>
                  );
                })}
              </ol>
            )}
            <ul className="mt-8 divide-y text-sm">
              {order.items.map((l) => (
                <li key={l.menuItemId + l.name} className="flex justify-between py-2.5">
                  <span>
                    <span className="tabular-nums text-muted-foreground">{l.quantity}×</span> {l.name}
                  </span>
                  <span className="tabular-nums">{formatPrice(l.quantity * l.unitPriceCents)}</span>
                </li>
              ))}
            </ul>
            {order.status === "completed" && (
              <div className="mt-8 rounded-[var(--radius-md)] border border-gold/30 bg-gold/10 p-4">
                <p className="font-medium">Order completed — leave feedback</p>
                <p className="mt-1 text-sm text-muted-foreground">Your verified order is ready for a quick review.</p>
                <Button
                  className="mt-4"
                  onClick={() => {
                    useCartStore.getState().setLastOrder(order);
                    openPanel("feedback");
                  }}
                >
                  Rate your meal
                </Button>
              </div>
            )}
            {order.status !== "completed" && order.status !== "cancelled" && (
              <p className="mt-8 rounded-[var(--radius-md)] border border-white/10 bg-secondary/40 px-4 py-3 text-sm text-muted-foreground">Your order is being prepared. Feedback will open once delivered.</p>
            )}
            <p className="mt-6 text-xs text-muted-foreground">This page updates live as the kitchen works on your order.</p>
          </div>
        )}
      </div>
    </StorefrontShell>
  );
}
