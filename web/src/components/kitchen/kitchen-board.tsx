"use client";

import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { BellRing, PanelRightClose, PanelRightOpen, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { StaffShell } from "@/components/shell/staff-shell";
import { Button } from "@/components/ui/button";
import { api, normalise } from "@/lib/api";
import { realtime } from "@/lib/realtime";
import type { MenuItem, Order, OrderStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { playChime, unlockAudio } from "./chime";
import { OrderTicket } from "./order-ticket";
import { StockPanel } from "./stock-panel";

const COLUMNS: { status: OrderStatus; title: string; accent: string }[] = [
  { status: "new", title: "New orders", accent: "bg-gold" },
  { status: "preparing", title: "Preparing", accent: "bg-saffron" },
  { status: "ready", title: "Ready for pickup / delivery", accent: "bg-sage-bright" },
];
const ACTIVE = new Set<OrderStatus>(["new", "preparing", "ready"]);
const FRESH_MS = 60_000;

export function KitchenBoard() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [fresh, setFresh] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [sound, setSound] = useState(false);
  const soundRef = useRef(sound);
  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);
  const [stockOpen, setStockOpen] = useState(true);
  // Clock starts client-side (never during prerender); drives ticket ages.
  const [now, setNow] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const upsertOrder = useCallback((o: Order) => {
    setOrders((prev) => {
      const rest = prev.filter((p) => p.id !== o.id);
      return ACTIVE.has(o.status) ? [...rest, o] : rest;
    });
  }, []);

  useEffect(() => {
    void api.orders.active().then(setOrders).catch((e: Error) => setError(e.message));
    void api.menu.list().then(setMenu);
    void realtime.connect();

    const offs = [
      realtime.on("order:created", (p) => {
        const o = normalise.order(p);
        upsertOrder(o);
        setFresh((f) => ({ ...f, [o.id]: Date.now() }));
        setNow(Date.now());
        if (soundRef.current) playChime();
      }),
      realtime.on("order:updated", (p) => upsertOrder(normalise.order(p))),
      realtime.on("menu:item-updated", (p) => {
        const item = normalise.menuItem(p);
        setMenu((m) => m.map((i) => (i.id === item.id ? item : i)));
      }),
    ];
    // Ticket timers + expiring "NEW" flashes.
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const interval = setInterval(tick, 15_000);
    return () => {
      offs.forEach((off) => off());
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [upsertOrder]);

  const freshIds = Object.entries(fresh).filter(([, t]) => now - t < FRESH_MS).map(([id]) => id);
  const newCount = freshIds.filter((id) => orders.some((o) => o.id === id && o.status === "new")).length;

  const advance = async (order: Order, to: OrderStatus) => {
    setBusy(order.id);
    setError(null);
    upsertOrder({ ...order, status: to }); // optimistic
    setFresh((f) => ({ ...f, [order.id]: 0 }));
    try {
      upsertOrder(await api.orders.setStatus(order.id, to));
    } catch (e) {
      upsertOrder(order);
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(null);
    }
  };

  const toggleStock = async (item: MenuItem, available: boolean) => {
    setMenu((m) => m.map((i) => (i.id === item.id ? { ...i, isAvailable: available } : i)));
    try {
      await api.menu.setAvailability(item.id, available);
    } catch (e) {
      setMenu((m) => m.map((i) => (i.id === item.id ? item : i)));
      setError(e instanceof Error ? e.message : "Stock update failed");
    }
  };

  return (
    <StaffShell
      actions={
        <>
          <Button
            size="sm"
            variant={sound ? "secondary" : "outline"}
            onClick={() => {
              unlockAudio();
              setSound((s) => !s);
            }}
            aria-pressed={sound}
          >
            {sound ? <Volume2 /> : <VolumeX />}
            <span className="hidden sm:inline">{sound ? "Sound on" : "Enable sound"}</span>
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => setStockOpen((s) => !s)} aria-label="Toggle stock panel">
            {stockOpen ? <PanelRightClose /> : <PanelRightOpen />}
          </Button>
        </>
      }
    >
      <AnimatePresence>
        {newCount > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            role="status"
            className="overflow-hidden bg-gold text-primary-foreground"
          >
            <p className="flex items-center justify-center gap-3 py-2.5 text-lg font-black uppercase tracking-wider">
              <BellRing className="size-5 animate-bounce" />
              {newCount} new order{newCount > 1 ? "s" : ""}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {error && <p role="alert" className="bg-ember/20 px-6 py-2 text-sm text-[#FF8E78]">{error}</p>}

      <div className={cn("grid gap-4 p-4 sm:p-6", stockOpen ? "lg:grid-cols-3 xl:grid-cols-[1fr_1fr_1fr_280px]" : "lg:grid-cols-3")}>
        <LayoutGroup>
          {COLUMNS.map((col) => {
            const list = orders
              .filter((o) => o.status === col.status)
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
            return (
              <section key={col.status} aria-label={col.title} className="flex min-h-[50vh] flex-col gap-3 rounded-[var(--radius-xl)] bg-charcoal p-3">
                <header className="flex items-center gap-2 px-1 pt-1">
                  <span className={cn("size-2.5 rounded-full", col.accent)} />
                  <h2 className="font-semibold">{col.title}</h2>
                  <span className="ml-auto rounded-full bg-secondary px-2.5 py-0.5 text-sm font-bold tabular-nums">{list.length}</span>
                </header>
                <AnimatePresence mode="popLayout">
                  {list.map((o) => (
                    <OrderTicket key={o.id} order={o} now={now} isFresh={freshIds.includes(o.id)} busy={busy === o.id} onAdvance={advance} />
                  ))}
                </AnimatePresence>
                {list.length === 0 && <p className="m-auto text-sm text-muted-foreground/60">All clear</p>}
              </section>
            );
          })}
        </LayoutGroup>

        {stockOpen && (
          <div className="lg:col-span-3 xl:col-span-1">
            <StockPanel items={menu} onToggle={toggleStock} />
          </div>
        )}
      </div>
    </StaffShell>
  );
}
