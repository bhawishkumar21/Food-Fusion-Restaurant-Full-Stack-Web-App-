"use client";

import { motion } from "framer-motion";
import { AudioLines, Bike, Store, UtensilsCrossed } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Order, OrderStatus } from "@/lib/types";
import { cn, minutesSince, shortId } from "@/lib/utils";

const FULFILMENT_ICON = { pickup: Store, delivery: Bike, dine_in: UtensilsCrossed };
const NEXT_ACTION: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  new: { to: "preparing", label: "Start cooking" },
  preparing: { to: "ready", label: "Mark ready" },
  ready: { to: "completed", label: "Handed off" },
};

export function OrderTicket({
  order,
  isFresh,
  now,
  busy,
  onAdvance,
}: {
  order: Order;
  isFresh: boolean;
  now: number;
  busy: boolean;
  onAdvance: (order: Order, to: OrderStatus) => void;
}) {
  const age = minutesSince(order.createdAt, now);
  // Ticket age escalates visually: calm → amber at 10 min → red at 20 min.
  const urgency = order.status === "ready" ? "calm" : age >= 20 ? "late" : age >= 10 ? "warn" : "calm";
  const next = NEXT_ACTION[order.status];
  const Icon = FULFILMENT_ICON[order.fulfilment];

  return (
    <motion.article
      layoutId={order.id}
      layout
      initial={{ opacity: 0, scale: 0.9, y: -20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      className={cn(
        "relative overflow-hidden rounded-[var(--radius-lg)] border-2 bg-velvet p-4",
        urgency === "late" ? "border-ember" : urgency === "warn" ? "border-saffron/70" : "border-cream/10",
        isFresh && "animate-pulse-ring border-gold",
      )}
    >
      <header className="flex items-center gap-3">
        <span className="text-2xl font-bold tabular-nums tracking-tight">{shortId(order.id)}</span>
        {isFresh && <span className="rounded bg-gold px-2 py-0.5 text-xs font-black uppercase tracking-wider text-primary-foreground">New</span>}
        {order.channel === "voice" && <AudioLines className="size-4 text-gold" aria-label="Voice order" />}
        <span className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground">
          <Icon className="size-4" aria-hidden />
          <span className="capitalize">{order.fulfilment.replace("_", "-")}</span>
        </span>
      </header>

      <ul className="mt-3 space-y-1.5 text-lg">
        {order.items.map((l) => (
          <li key={l.menuItemId + l.name} className="flex gap-3">
            <span className="w-8 shrink-0 font-bold tabular-nums text-gold">{l.quantity}×</span>
            <span className="font-medium">{l.name}</span>
          </li>
        ))}
      </ul>

      {order.notes && (
        <p className="mt-3 rounded-md bg-saffron/15 px-3 py-2 text-sm font-medium text-[#F6C48E]">⚠ {order.notes}</p>
      )}

      <footer className="mt-4 flex items-center gap-3">
        <span
          className={cn(
            "text-sm font-semibold tabular-nums",
            urgency === "late" ? "text-[#FF8E78]" : urgency === "warn" ? "text-[#F6C48E]" : "text-muted-foreground",
          )}
        >
          {age} min
        </span>
        {next && (
          <Button
            size="lg"
            variant={order.status === "preparing" ? "success" : order.status === "ready" ? "secondary" : "default"}
            className="ml-auto h-12 rounded-xl text-base"
            disabled={busy}
            onClick={() => onAdvance(order, next.to)}
          >
            {next.label}
          </Button>
        )}
      </footer>
    </motion.article>
  );
}
