"use client";

import { AlertTriangle, ArrowRight, CalendarClock, ChefHat, ClipboardList, Minus, PackageX, Plus, Search, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { StatTile } from "@/components/charts/charts";
import { PageHeader } from "@/components/dashboard/owner-pages";
import { StaffShell } from "@/components/shell/staff-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api, normalise } from "@/lib/api";
import { realtime } from "@/lib/realtime";
import { toast } from "@/components/ui/toast";
import type { MenuItem, Order, Reservation, ReservationStatus } from "@/lib/types";
import { cn, minutesSince } from "@/lib/utils";

const LOW_STOCK = 3;
const isoDay = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/**
 * Live menu + order state shared by the manager pages. `isLocallyDirty`
 * lets a page ignore realtime echoes for items it is still saving, so a slow
 * echo of an older save can't overwrite a newer local edit.
 */
function useLiveOps(isLocallyDirty: (id: string) => boolean = () => false) {
  const [menu, setMenu] = useState<MenuItem[] | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const dirtyRef = useRef(isLocallyDirty);
  useEffect(() => {
    dirtyRef.current = isLocallyDirty;
  });
  useEffect(() => {
    api.menu.list().then(setMenu);
    api.orders.active().then(setOrders);
    void realtime.connect();
    const offs = [
      realtime.on("menu:item-updated", (p) => {
        const item = normalise.menuItem(p);
        if (dirtyRef.current(item.id)) return;
        setMenu((m) => m?.map((i) => (i.id === item.id ? item : i)) ?? null);
      }),
      realtime.on("order:created", (p) => setOrders((o) => [...(o ?? []), normalise.order(p)])),
      realtime.on("order:updated", (p) => {
        const order = normalise.order(p);
        setOrders((o) => (o ?? []).map((x) => (x.id === order.id ? order : x)).filter((x) => ["new", "preparing", "ready"].includes(x.status)));
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);
  return { menu, setMenu, orders };
}

// ──────────────────────────────────────────────────────────── overview ──

export function ManagerOverview() {
  const { menu, orders } = useLiveOps();
  const [reservations, setReservations] = useState<Reservation[] | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    api.reservations.list(isoDay()).then(setReservations);
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  const late = (orders ?? []).filter((o) => o.status !== "ready" && now && minutesSince(o.createdAt, now) >= 20);
  const soldOut = (menu ?? []).filter((i) => !i.isAvailable);
  const low = (menu ?? []).filter((i) => i.isAvailable && i.dailyStock !== null && i.dailyStock <= LOW_STOCK);
  const upcoming = (reservations ?? []).filter((r) => ["requested", "confirmed"].includes(r.status));
  const covers = upcoming.reduce((n, r) => n + r.partySize, 0);

  return (
    <StaffShell>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <PageHeader eyebrow="Manager · Today" title="Floor overview" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile icon={<ChefHat />} label="In the kitchen" value={orders ? String(orders.length) : "—"} sub={orders ? `${orders.filter((o) => o.status === "new").length} new · ${orders.filter((o) => o.status === "ready").length} ready` : undefined} />
          <StatTile icon={<AlertTriangle />} label="Running late" value={orders ? String(late.length) : "—"} sub="20+ minutes, not ready" />
          <StatTile icon={<PackageX />} label="Sold out" value={menu ? String(soldOut.length) : "—"} sub={menu ? `${low.length} running low` : undefined} />
          <StatTile icon={<Users />} label="Covers booked" value={reservations ? String(covers) : "—"} sub={reservations ? `${upcoming.length} tables still to seat` : undefined} />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <QuickCard href="/kitchen" icon={<ChefHat />} title="Kitchen queue" description="Live tickets, alerts and the 86 board.">
            {late.length > 0 ? <Badge variant="destructive">{late.length} late</Badge> : <Badge variant="success">On time</Badge>}
          </QuickCard>
          <QuickCard href="/inventory" icon={<ClipboardList />} title="Inventory" description="Availability and today's portion counts.">
            {soldOut.slice(0, 3).map((i) => (
              <Badge key={i.id} variant="muted">{i.name}</Badge>
            ))}
            {low.slice(0, 2).map((i) => (
              <Badge key={i.id} variant="warning">{i.name} · {i.dailyStock} left</Badge>
            ))}
          </QuickCard>
          <QuickCard href="/table-reservations" icon={<CalendarClock />} title="Reservations" description="Tonight's book: confirm, seat, assign tables.">
            {upcoming.slice(0, 3).map((r) => (
              <Badge key={r.id} variant="muted">{timeOf(r.reservedFor)} · {r.partySize}p</Badge>
            ))}
          </QuickCard>
        </div>
      </div>
    </StaffShell>
  );
}

function QuickCard({ href, icon, title, description, children }: { href: string; icon: React.ReactNode; title: string; description: string; children?: React.ReactNode }) {
  return (
    <Link href={href} className="gold-border group relative block overflow-hidden rounded-[var(--radius-lg)] border bg-card p-6 shadow-velvet">
      <div className="flex items-center gap-3 [&_svg]:size-5 [&_svg]:text-gold">
        {icon}
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <ArrowRight className="ml-auto !size-4 !text-muted-foreground transition-transform group-hover:translate-x-1" />
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      <div className="mt-4 flex flex-wrap gap-1.5">{children}</div>
    </Link>
  );
}

// ─────────────────────────────────────────────────────────── inventory ──

const SAVE_DEBOUNCE_MS = 350;

export function InventoryPage() {
  // Per item: a pending debounced save, the number of saves in flight, and the
  // last server-confirmed state (to roll back to if a save fails).
  const pending = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const inflight = useRef(new Map<string, number>());
  const confirmed = useRef(new Map<string, MenuItem>());
  const { menu, setMenu } = useLiveOps((id) => pending.current.has(id) || (inflight.current.get(id) ?? 0) > 0);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => {
    const list = (menu ?? []).filter((i) => !query || i.name.toLowerCase().includes(query.toLowerCase()));
    const map = new Map<string, MenuItem[]>();
    list.forEach((i) => map.set(i.category, [...(map.get(i.category) ?? []), i]));
    return [...map];
  }, [menu, query]);

  /**
   * The screen updates instantly; the server gets one save once the manager
   * pauses (rapid −/+ clicks collapse into a single write of the final count).
   */
  const save = (item: MenuItem, isAvailable: boolean, dailyStock: number | null) => {
    const id = item.id;
    if (!pending.current.has(id) && !inflight.current.get(id)) confirmed.current.set(id, item);
    setMenu((m) => m?.map((i) => (i.id === id ? { ...item, isAvailable, dailyStock } : i)) ?? null);
    setError(null);
    clearTimeout(pending.current.get(id));
    pending.current.set(
      id,
      setTimeout(async () => {
        pending.current.delete(id);
        inflight.current.set(id, (inflight.current.get(id) ?? 0) + 1);
        try {
          const saved = await api.menu.setAvailability(id, isAvailable, dailyStock);
          confirmed.current.set(id, saved);
          // Apply the server's answer only if no newer edit is waiting.
          if (!pending.current.has(id)) setMenu((m) => m?.map((i) => (i.id === id ? saved : i)) ?? null);
          toast.success(`${item.name}: stock updated to ${dailyStock ?? (isAvailable ? "Available" : "Sold out")}`);
        } catch (e) {
          const fallback = confirmed.current.get(id);
          if (fallback && !pending.current.has(id)) setMenu((m) => m?.map((i) => (i.id === id ? fallback : i)) ?? null);
          const msg = e instanceof Error ? e.message : "Update failed";
          setError(msg);
          toast.error(`Could not update ${item.name}: ${msg}`);
        } finally {
          inflight.current.set(id, (inflight.current.get(id) ?? 1) - 1);
        }
      }, SAVE_DEBOUNCE_MS),
    );
  };

  const soldOut = (menu ?? []).filter((i) => !i.isAvailable).length;
  const tracked = (menu ?? []).filter((i) => i.dailyStock !== null).length;

  return (
    <StaffShell>
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <PageHeader eyebrow="Manager · Inventory" title="Today's stock">
          <div className="flex gap-2 text-xs">
            <Badge variant="destructive" className="h-7 px-3">{soldOut} sold out</Badge>
            <Badge variant="muted" className="h-7 px-3">{tracked} counted</Badge>
          </div>
        </PageHeader>
        <p className="text-sm text-muted-foreground">
          Set a portion count to track a dish today: each order takes from it and the dish sells out automatically at zero, on the menu and in the voice agent.
        </p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a dish" aria-label="Find a dish" className="pl-11" />
        </div>
        {error && <p role="alert" className="text-sm text-[#F4A190]">{error}</p>}

        {menu === null ? (
          <div className="h-96 animate-pulse rounded-[var(--radius-lg)] bg-card" />
        ) : (
          groups.map(([category, items]) => (
            <Card key={category}>
              <CardHeader>
                <CardTitle>{category}</CardTitle>
              </CardHeader>
              <CardContent className="divide-y pt-0">
                {items.map((item) => (
                  <StockRow key={item.id} item={item} onSave={save} />
                ))}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </StaffShell>
  );
}

function StockRow({ item, onSave }: { item: MenuItem; onSave: (item: MenuItem, available: boolean, stock: number | null) => void }) {
  const low = item.dailyStock !== null && item.dailyStock <= LOW_STOCK && item.isAvailable;
  const step = (delta: number) => {
    const next = Math.max(0, (item.dailyStock ?? 0) + delta);
    // Counting down to zero sells the dish out; adding stock puts it back on.
    onSave(item, next > 0, next);
  };
  return (
    <div className="flex flex-wrap items-center gap-4 py-3">
      <div className="min-w-40 flex-1">
        <p className={cn("font-medium", !item.isAvailable && "text-[#FF8E78] line-through")}>{item.name}</p>
        <p className="text-xs text-muted-foreground">
          {item.dailyStock === null ? "Not counted" : `${item.dailyStock} portion${item.dailyStock === 1 ? "" : "s"} left`}
          {low && <span className="ml-2 font-semibold text-[#F6C48E]">Running low</span>}
        </p>
      </div>
      <div className="flex items-center gap-1 rounded-full bg-secondary p-1" aria-label={`Portions of ${item.name}`}>
        <Button size="icon-sm" variant="ghost" aria-label={`One fewer ${item.name}`} disabled={!item.dailyStock} onClick={() => step(-1)}>
          <Minus />
        </Button>
        <span className="w-8 text-center text-sm font-semibold tabular-nums">{item.dailyStock ?? "—"}</span>
        <Button size="icon-sm" variant="ghost" aria-label={`One more ${item.name}`} onClick={() => step(item.dailyStock === null ? 10 : 1)}>
          <Plus />
        </Button>
      </div>
      {item.dailyStock !== null && (
        <button onClick={() => onSave(item, true, null)} className="cursor-pointer text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Stop counting
        </button>
      )}
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <Switch checked={item.isAvailable} onCheckedChange={(v) => onSave(item, v, item.dailyStock === 0 && v ? null : item.dailyStock)} aria-label={`${item.name} available`} />
        <span className="w-16">{item.isAvailable ? "On menu" : "Sold out"}</span>
      </label>
    </div>
  );
}

// ──────────────────────────────────────────────────────── reservations ──

const STATUS_STYLE: Record<ReservationStatus, { label: string; variant: "default" | "success" | "warning" | "muted" | "destructive" }> = {
  requested: { label: "Requested", variant: "warning" },
  confirmed: { label: "Confirmed", variant: "default" },
  seated: { label: "Seated", variant: "success" },
  completed: { label: "Completed", variant: "muted" },
  cancelled: { label: "Cancelled", variant: "destructive" },
  no_show: { label: "No-show", variant: "destructive" },
};
/** The next sensible actions for each state. */
const ACTIONS: Record<ReservationStatus, { to: ReservationStatus; label: string; primary?: boolean }[]> = {
  requested: [{ to: "confirmed", label: "Confirm", primary: true }, { to: "cancelled", label: "Decline" }],
  confirmed: [{ to: "seated", label: "Seat", primary: true }, { to: "no_show", label: "No-show" }, { to: "cancelled", label: "Cancel" }],
  seated: [{ to: "completed", label: "Complete", primary: true }],
  completed: [],
  cancelled: [],
  no_show: [],
};

export function ReservationsPage() {
  const [day, setDay] = useState(0);
  const [result, setResult] = useState<{ day: number; rows: Reservation[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = result?.day === day ? result.rows : null;

  useEffect(() => {
    api.reservations
      .list(isoDay(day))
      .then((r) => setResult({ day, rows: r }))
      .catch((e: Error) => setError(e.message));
  }, [day]);

  const update = async (r: Reservation, status: ReservationStatus, tableLabel?: string) => {
    setBusy(r.id);
    setError(null);
    try {
      const next = await api.reservations.update(r.id, status, tableLabel);
      setResult((res) => res && { ...res, rows: res.rows.map((x) => (x.id === r.id ? next : x)) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(null);
    }
  };

  const covers = (rows ?? []).filter((r) => !["cancelled", "no_show"].includes(r.status)).reduce((n, r) => n + r.partySize, 0);

  return (
    <StaffShell>
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <PageHeader eyebrow="Manager · Reservations" title="Table book">
          <div role="radiogroup" aria-label="Day" className="flex gap-1 rounded-full bg-secondary p-1 text-sm">
            {["Today", "Tomorrow", "+2 days"].map((label, i) => (
              <button key={label} role="radio" aria-checked={day === i} onClick={() => setDay(i)} className={cn("h-9 cursor-pointer rounded-full px-4", day === i ? "bg-velvet text-foreground shadow" : "text-muted-foreground")}>
                {label}
              </button>
            ))}
          </div>
        </PageHeader>
        {error && <p role="alert" className="text-sm text-[#F4A190]">{error}</p>}

        <Card>
          <CardHeader>
            <div>
              {/* Dates resolve client-side only, never at prerender time. */}
              <CardTitle>{rows ? new Date(isoDay(day)).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) : " "}</CardTitle>
              <CardDescription>{rows ? `${rows.length} bookings · ${covers} covers` : "Loading…"}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="divide-y pt-0">
            {rows === null ? (
              <div className="h-48 animate-pulse" />
            ) : rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No bookings for this day.</p>
            ) : (
              rows.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-4 py-4">
                  <span className="font-display w-20 text-2xl tabular-nums text-gold">{timeOf(r.reservedFor)}</span>
                  <div className="min-w-44 flex-1">
                    <p className="font-medium">
                      {r.guestName} <span className="text-muted-foreground">· {r.partySize} guests</span>
                    </p>
                    {r.notes && <p className="text-xs text-muted-foreground">{r.notes}</p>}
                  </div>
                  <Badge variant={STATUS_STYLE[r.status].variant}>{STATUS_STYLE[r.status].label}</Badge>
                  <Input
                    defaultValue={r.tableLabel ?? ""}
                    placeholder="Table"
                    aria-label={`Table for ${r.guestName}`}
                    maxLength={10}
                    disabled={["completed", "cancelled", "no_show"].includes(r.status)}
                    onBlur={(e) => e.target.value !== (r.tableLabel ?? "") && void update(r, r.status, e.target.value)}
                    className="h-9 w-20 text-center"
                  />
                  <div className="flex gap-2">
                    {ACTIONS[r.status].map((a) => (
                      <Button key={a.to} size="sm" variant={a.primary ? "default" : "ghost"} disabled={busy === r.id} onClick={() => void update(r, a.to)}>
                        {a.label}
                      </Button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </StaffShell>
  );
}
