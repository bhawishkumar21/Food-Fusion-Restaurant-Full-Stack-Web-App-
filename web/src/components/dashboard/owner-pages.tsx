"use client";

import { AudioLines, Ban, CalendarCheck, DollarSign, Receipt, ShoppingBag, TrendingUp } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { AreaTrend, FunnelBars, SentimentBar, StatTile, TableView } from "@/components/charts/charts";
import { StaffShell } from "@/components/shell/staff-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { AnalyticsSummary } from "@/lib/types";
import { cn, formatCompactPrice, formatPrice } from "@/lib/utils";
import { EscalationQueue } from "./escalation-queue";
import { MenuEditor } from "./menu-editor";

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

// ───────────────────────────────────────────────────────── shared bits ──

export function PageHeader({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="font-display mt-2 text-4xl font-medium">{title}</h1>
      </div>
      {children}
    </div>
  );
}

function RangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <div role="radiogroup" aria-label="Date range" className="flex gap-1 rounded-full bg-secondary p-1 text-sm">
      {RANGES.map((r) => (
        <button
          key={r}
          role="radio"
          aria-checked={value === r}
          onClick={() => onChange(r)}
          className={cn("h-9 cursor-pointer rounded-full px-4", value === r ? "bg-velvet text-foreground shadow" : "text-muted-foreground")}
        >
          {r}d
        </button>
      ))}
    </div>
  );
}

/** Owner-only aggregate (RLS + @Roles(SuperAdmin) on the API). */
function useAnalytics(days: Range) {
  const [result, setResult] = useState<{ days: number; data: AnalyticsSummary } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.analytics
      .summary(days)
      // Demo data is always 30 days; trim so the range control still behaves.
      .then((d) => setResult({ days, data: { ...d, revenueByDay: d.revenueByDay.slice(-days) } }))
      .catch((e: Error) => setError(e.message));
  }, [days]);
  // Stale data is hidden while a new range loads.
  return { data: result?.days === days ? result.data : null, error };
}

const Skeleton = ({ className }: { className: string }) => <div className={cn("animate-pulse rounded-[var(--radius-md)] bg-secondary", className)} />;

// ─────────────────────────────────────────────────────────── analytics ──

export function AnalyticsPage() {
  const [days, setDays] = useState<Range>(30);
  const { data, error } = useAnalytics(days);

  const funnel = data
    ? [
        { label: "Viewed menu", value: data.funnel.menu_view ?? 0 },
        { label: "Added to cart", value: data.funnel.cart_add ?? 0 },
        { label: "Opened checkout", value: data.funnel.checkout_open ?? 0 },
        { label: "Placed order", value: data.funnel.order_placed ?? 0 },
      ]
    : [];
  const dropOff = funnel[0]?.value ? 1 - funnel[3].value / funnel[0].value : 0;
  const sentimentTotal = data ? Object.values(data.sentiment).reduce((s, n) => s + (n ?? 0), 0) : 0;
  const positive = sentimentTotal ? (data!.sentiment.positive ?? 0) / sentimentTotal : 0;

  return (
    <StaffShell>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <PageHeader eyebrow="Owner · Analytics" title="How guests order">
          <RangePicker value={days} onChange={setDays} />
        </PageHeader>
        {error && <p role="alert" className="text-sm text-[#F4A190]">{error}</p>}

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <StatTile icon={<TrendingUp />} label="Site visits" value={data ? data.siteVisits.toLocaleString() : "—"} sub={`Unique sessions · ${days}d`} />
          <StatTile icon={<ShoppingBag />} label="Orders" value={data ? data.orders.toLocaleString() : "—"} sub={`Last ${days} days`} />
          <StatTile icon={<TrendingUp />} label="Menu → order" value={data && funnel[0].value ? `${Math.round((1 - dropOff) * 100)}%` : "—"} sub="of visitors place an order" />
          <StatTile icon={<AudioLines />} label="Voice-assisted" value={data && data.orders ? `${Math.round((data.voiceOrders / data.orders) * 100)}%` : "—"} sub="built with Fusion AI" />
          <StatTile icon={<CalendarCheck />} label="Positive reviews" value={sentimentTotal ? `${Math.round(positive * 100)}%` : "—"} sub={sentimentTotal ? `${sentimentTotal} scored by AI` : undefined} />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Order funnel</CardTitle>
                <CardDescription>{data ? `${Math.round(dropOff * 100)}% of menu visitors drop off before ordering` : "Visitor drop-off by stage"}</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {data ? (
                <>
                  <FunnelBars steps={funnel} />
                  <TableView columns={["Stage", "Sessions"]} rows={funnel.map((f) => [f.label, f.value])} />
                </>
              ) : (
                <Skeleton className="h-48" />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Customer sentiment</CardTitle>
                <CardDescription>{sentimentTotal ? `${sentimentTotal.toLocaleString()} reviews scored by AI` : "AI-scored reviews"}</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {data ? (
                sentimentTotal === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">No data available yet</div>
                ) : (
                  <SentimentBar counts={data.sentiment} />
                )
              ) : (
                <Skeleton className="h-24" />
              )}
              <p className="mt-6 border-t pt-4 text-xs leading-relaxed text-muted-foreground">
                Every review is scored by the n8n sentiment workflow. Negative reviews land in the escalation queue below within seconds.
              </p>
            </CardContent>
          </Card>
        </div>

        <EscalationQueue />
      </div>
    </StaffShell>
  );
}

// ───────────────────────────────────────────────────────────── finance ──

export function FinancePage() {
  const [days, setDays] = useState<Range>(30);
  const { data, error } = useAnalytics(days);
  const best = data?.revenueByDay.reduce((a, b) => (b.revenueCents > a.revenueCents ? b : a), data.revenueByDay[0]);
  const lostCents = data ? data.cancelled * data.avgTicketCents : 0;

  return (
    <StaffShell>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <PageHeader eyebrow="Owner · Finance" title="Revenue">
          <RangePicker value={days} onChange={setDays} />
        </PageHeader>
        {error && <p role="alert" className="text-sm text-[#F4A190]">{error}</p>}

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile icon={<DollarSign />} label="Gross revenue" value={data ? formatCompactPrice(data.revenueCents) : "—"} sub={`Last ${days} days, excl. cancelled`} />
          <StatTile icon={<Receipt />} label="Average ticket" value={data ? formatPrice(data.avgTicketCents) : "—"} sub={data ? `${data.orders.toLocaleString()} orders` : undefined} />
          <StatTile icon={<TrendingUp />} label="Best day" value={best ? formatCompactPrice(best.revenueCents) : "—"} sub={best ? dayLabel(best.day) : undefined} />
          <StatTile icon={<Ban />} label="Cancelled" value={data ? data.cancelled.toLocaleString() : "—"} sub={data ? `≈ ${formatCompactPrice(lostCents)} not realised` : undefined} />
        </div>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Daily revenue</CardTitle>
              <CardDescription>Gross takings per day, excluding cancelled orders</CardDescription>
            </div>
          </CardHeader>
          <CardContent>{data ? (data.revenueByDay.length === 0 ? <div className="py-12 text-center text-sm text-muted-foreground">No data available yet</div> : <AreaTrend label="Daily revenue" data={data.revenueByDay.map((d) => ({ x: dayLabel(d.day), y: d.revenueCents }))} format={formatCompactPrice} height={260} />) : <Skeleton className="h-[260px]" />}</CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Daily ledger</CardTitle>
              <CardDescription>Newest first</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {data ? (
              data.revenueByDay.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">No data available yet</div>
              ) : (
                <table className="w-full min-w-[480px] text-sm tabular-nums">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="pb-3 font-medium">Day</th>
                      <th className="pb-3 text-right font-medium">Orders</th>
                      <th className="pb-3 text-right font-medium">Avg. ticket</th>
                      <th className="pb-3 text-right font-medium">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.revenueByDay].reverse().map((d) => (
                      <tr key={d.day} className="border-t">
                        <td className="py-2.5">{new Date(`${d.day}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</td>
                        <td className="py-2.5 text-right">{d.orders}</td>
                        <td className="py-2.5 text-right">{formatPrice(d.orders ? d.revenueCents / d.orders : 0)}</td>
                        <td className="py-2.5 text-right font-medium text-gold">{formatPrice(d.revenueCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            ) : (
              <Skeleton className="h-64" />
            )}
          </CardContent>
        </Card>
      </div>
    </StaffShell>
  );
}

// ───────────────────────────────────────────────────────── menu editor ──

export function MenuEditorPage() {
  return (
    <StaffShell>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <PageHeader eyebrow="Owner · Menu" title="Menu & voice knowledge base" />
        <MenuEditor />
      </div>
    </StaffShell>
  );
}
