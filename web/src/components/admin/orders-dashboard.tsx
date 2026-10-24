"use client";

import { CheckCircle2, Loader2, PackageSearch } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { StaffShell } from "@/components/shell/staff-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { realtime } from "@/lib/realtime";
import { DEMO_MODE } from "@/lib/config";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { AdminOrder, OrderStatus } from "@/lib/types";
import { formatPrice } from "@/lib/utils";
import { toast } from "@/components/ui/toast";

const statusLabel: Record<OrderStatus, string> = { new: "Placed", preparing: "Preparing", ready: "Ready", out_for_delivery: "Out for delivery", completed: "Completed", cancelled: "Cancelled" };

export function OrdersDashboard() {
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    return api.orders.adminActive().then(setOrders).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    void load();
    void realtime.connect();
    const refresh = () => void load();
    const removeCreated = realtime.on("order:created", refresh);
    const removeUpdated = realtime.on("order:updated", refresh);

    // Setup Supabase Realtime channel with postgres_changes listener
    let channel: ReturnType<NonNullable<ReturnType<typeof supabaseBrowser>>["channel"]> | null = null;
    const sb = supabaseBrowser();
    if (!DEMO_MODE && sb) {
      channel = sb
        .channel("public:orders-admin-live")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "orders" },
          () => {
            void load();
          }
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            void load();
          }
        });
    }

    // Fast polling safety net every 3 seconds to guarantee live sync across all tabs/networks
    const interval = setInterval(() => {
      void load();
    }, 3000);

    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      removeCreated();
      removeUpdated();
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
      if (channel) void channel.unsubscribe();
    };
  }, [load]);
  const complete = async (order: AdminOrder) => {
    setBusy(order.id);
    setError(null);
    try {
      // Pass the primary UUID id, or trackingCode as fallback
      await api.orders.complete(order.id || order.trackingCode);
      toast.success(`Order ${order.trackingCode} marked as completed!`);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not complete order.";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  };
  return <StaffShell><div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
    <div><p className="eyebrow">Super admin · Dispatch</p><h1 className="font-display mt-2 text-4xl">Live orders</h1></div>
    {error && <p role="alert" className="text-sm text-[#F4A190]">{error}</p>}
    <Card><CardHeader><div><CardTitle>Active order queue</CardTitle><CardDescription>Updates immediately when an order is placed or completed.</CardDescription></div></CardHeader><CardContent className="overflow-x-auto">
      {!orders ? <div className="h-64 animate-pulse rounded bg-secondary" /> : orders.length === 0 ? <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground"><PackageSearch /><p>No active orders.</p></div> : <table className="w-full min-w-[840px] text-sm"><thead className="border-b text-left text-xs text-muted-foreground"><tr><th className="pb-3">Order</th><th className="pb-3">Customer</th><th className="pb-3">Items</th><th className="pb-3 text-right">Total</th><th className="pb-3">Status</th><th className="pb-3 text-right">Action</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id} className="border-b last:border-0"><td className="py-4 font-medium text-gold">{order.trackingCode}</td><td className="py-4"><p>{order.customerName ?? "Customer"}</p><p className="text-xs text-muted-foreground">{order.customerEmail ?? "No email"}</p>{(order.customerPhone || order.phone) && <p className="text-xs text-gold/80">{order.customerPhone || order.phone}</p>}{order.deliveryAddress && <p className="text-xs text-muted-foreground line-clamp-1">📍 {order.deliveryAddress}</p>}</td><td className="max-w-72 py-4 text-muted-foreground">{order.items.map((item) => `${item.quantity}× ${item.name}`).join(", ")}</td><td className="py-4 text-right font-medium">{formatPrice(order.totalCents)}</td><td className="py-4"><Badge variant={order.status === "new" ? "warning" : "muted"}>{statusLabel[order.status]}</Badge></td><td className="py-4 text-right"><Button size="sm" disabled={busy === order.id} onClick={() => void complete(order)}>{busy === order.id ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}Mark as completed</Button></td></tr>)}</tbody></table>}
    </CardContent></Card></div></StaffShell>;
}
