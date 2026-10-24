"use client";

import { Activity, AlertTriangle, Building2, CircleAlert, Info, RefreshCw, Timer } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ColumnChart, StatTile, TableView } from "@/components/charts/charts";
import { StaffShell } from "@/components/shell/staff-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import type { ApiLog, ApiUsage, Tenant } from "@/lib/types";
import { cn, formatCompactPrice } from "@/lib/utils";

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const LEVELS: { value: ApiLog["level"] | undefined; label: string }[] = [
  { value: undefined, label: "All" },
  { value: "error", label: "Errors" },
  { value: "warn", label: "Warnings" },
  { value: "info", label: "Info" },
];
// Status palette is reserved for state and always paired with an icon + label.
const LEVEL_STYLE = {
  error: { icon: CircleAlert, badge: "destructive" },
  warn: { icon: AlertTriangle, badge: "warning" },
  info: { icon: Info, badge: "muted" },
} as const;

export function AdminDashboard() {
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [usage, setUsage] = useState<ApiUsage | null>(null);
  const [logs, setLogs] = useState<ApiLog[] | null>(null);
  const [level, setLevel] = useState<ApiLog["level"] | undefined>();
  const [error, setError] = useState<string | null>(null);

  const loadLogs = useCallback(() => {
    api.admin.logs(level).then(setLogs).catch((e: Error) => setError(e.message));
  }, [level]);

  useEffect(() => {
    api.admin.tenants().then(setTenants).catch((e: Error) => setError(e.message));
    api.admin.usage().then(setUsage).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    loadLogs();
    const id = setInterval(loadLogs, 15_000);
    return () => clearInterval(id);
  }, [loadLogs]);

  const toggleTenant = async (t: Tenant, active: boolean) => {
    const status = active ? "active" : "suspended";
    setTenants((list) => list?.map((x) => (x.id === t.id ? { ...x, status } : x)) ?? null);
    try {
      await api.admin.setTenantStatus(t.id, status);
    } catch (e) {
      setTenants((list) => list?.map((x) => (x.id === t.id ? t : x)) ?? null);
      setError(e instanceof Error ? e.message : "Update failed");
    }
  };

  const tenantName = (id: string | null) => tenants?.find((t) => t.id === id)?.name ?? (id ? id.slice(0, 8) : "Platform");
  const totalReq = usage?.byDay.reduce((s, d) => s + d.requests, 0) ?? 0;
  const totalErr = usage?.byDay.reduce((s, d) => s + d.errors, 0) ?? 0;
  const worstP95 = usage ? Math.max(...usage.byTenant.map((t) => t.p95Ms)) : 0;

  return (
    <StaffShell>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <div>
          <p className="eyebrow">Platform</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[var(--tracking-editorial)]">Super admin</h1>
        </div>
        {error && <p role="alert" className="text-sm text-[#F4A190]">{error}</p>}

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile icon={<Building2 />} label="Active tenants" value={tenants ? String(tenants.filter((t) => t.status === "active").length) : "—"} sub={tenants ? `${tenants.length} total` : undefined} />
          <StatTile icon={<Activity />} label="API requests" value={usage ? compact.format(totalReq) : "—"} sub="Last 14 days" />
          <StatTile
            icon={<CircleAlert />}
            label="Error rate"
            value={usage ? `${((totalErr / Math.max(totalReq, 1)) * 100).toFixed(2)}%` : "—"}
            sub={usage ? `${compact.format(totalErr)} 5xx responses` : undefined}
          />
          <StatTile icon={<Timer />} label="Slowest p95" value={usage ? `${worstP95} ms` : "—"} sub="Across tenants" />
        </div>

        <div className="grid gap-6 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader>
              <div>
                <CardTitle>API requests per day</CardTitle>
                <CardDescription>All tenants, including voice sessions and webhooks</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {usage ? (
                <>
                  <ColumnChart
                    label="API requests per day"
                    data={usage.byDay.map((d) => ({ x: new Date(`${d.day}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }), y: d.requests }))}
                    format={(v) => compact.format(v)}
                    detail={(i) => <p className="text-muted-foreground">{usage.byDay[i].errors} errors</p>}
                  />
                  <TableView columns={["Day", "Requests", "Errors"]} rows={usage.byDay.map((d) => [d.day, d.requests, d.errors])} />
                </>
              ) : (
                <div className="h-[200px] animate-pulse rounded-[var(--radius-md)] bg-secondary" />
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <div>
                <CardTitle>Usage by tenant</CardTitle>
                <CardDescription>14-day totals</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {(!usage || usage.byTenant.length === 0) ? (
                <div className="py-8 text-center text-sm text-muted-foreground">No data available yet</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="pb-2 font-medium">Tenant</th>
                      <th className="pb-2 text-right font-medium">Requests</th>
                      <th className="pb-2 text-right font-medium">p95</th>
                      <th className="pb-2 text-right font-medium">Errors</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {usage.byTenant.map((u) => (
                      <tr key={u.tenantId ?? "platform"} className="border-t">
                        <td className="max-w-36 truncate py-2.5">{tenantName(u.tenantId)}</td>
                        <td className="py-2.5 text-right">{compact.format(u.requests)}</td>
                        <td className="py-2.5 text-right">{u.p95Ms}ms</td>
                        <td className="py-2.5 text-right">
                          {u.errorRate >= 0.005 ? (
                            <Badge variant="destructive"><CircleAlert />{(u.errorRate * 100).toFixed(2)}%</Badge>
                          ) : (
                            `${(u.errorRate * 100).toFixed(2)}%`
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Tenants</CardTitle>
              <CardDescription>Suspending a tenant hides its menu and blocks new orders immediately (enforced in RLS).</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {(!tenants || tenants.length === 0) ? (
              <div className="py-12 text-center text-sm text-muted-foreground">No data available yet</div>
            ) : (
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-3 font-medium">Restaurant</th>
                    <th className="pb-3 font-medium">Plan</th>
                    <th className="pb-3 text-right font-medium">Orders 30d</th>
                    <th className="pb-3 text-right font-medium">Revenue 30d</th>
                    <th className="pb-3 text-right font-medium">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((t) => (
                    <tr key={t.id} className="border-t">
                      <td className="py-3">
                        <p className="font-medium">{t.name}</p>
                        <p className="text-xs text-muted-foreground">{t.slug}</p>
                      </td>
                      <td className="py-3"><Badge variant={t.plan === "enterprise" ? "default" : "outline"} className="capitalize">{t.plan}</Badge></td>
                      <td className="py-3 text-right tabular-nums">{t.orders30d.toLocaleString()}</td>
                      <td className="py-3 text-right tabular-nums">{formatCompactPrice(t.revenue30dCents)}</td>
                      <td className="py-3 text-right">
                        <Switch checked={t.status === "active"} onCheckedChange={(v) => void toggleTenant(t, v)} aria-label={`${t.name} active`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>System logs</CardTitle>
              <CardDescription>Live API log stream · refreshes every 15s</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div role="radiogroup" aria-label="Log level" className="flex gap-1 rounded-full bg-secondary p-1 text-xs">
                {LEVELS.map((l) => (
                  <button
                    key={l.label}
                    role="radio"
                    aria-checked={level === l.value}
                    onClick={() => setLevel(l.value)}
                    className={cn("h-8 cursor-pointer rounded-full px-3", level === l.value ? "bg-velvet text-foreground" : "text-muted-foreground")}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              <Button size="icon-sm" variant="ghost" onClick={loadLogs} aria-label="Refresh logs"><RefreshCw /></Button>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="max-h-[420px] divide-y overflow-y-auto rounded-[var(--radius-md)] bg-charcoal/60 font-mono text-xs">
              {(logs ?? []).map((l) => {
                const style = LEVEL_STYLE[l.level];
                return (
                  <li key={l.id} className="flex items-center gap-3 px-4 py-2">
                    <Badge variant={style.badge} className="w-20 justify-center font-sans uppercase"><style.icon />{l.level}</Badge>
                    <span className="w-20 shrink-0 text-muted-foreground">{new Date(l.createdAt).toLocaleTimeString()}</span>
                    <span className="w-12 shrink-0 font-semibold">{l.method}</span>
                    <span className="min-w-0 flex-1 truncate">{l.route}</span>
                    <span className="hidden w-40 truncate text-muted-foreground md:block">{tenantName(l.tenantId)}</span>
                    <span className="w-10 text-right tabular-nums">{l.status}</span>
                    <span className="w-16 text-right tabular-nums text-muted-foreground">{l.durationMs}ms</span>
                  </li>
                );
              })}
              {logs?.length === 0 && <li className="px-4 py-6 text-center text-muted-foreground">No logs at this level.</li>}
            </ul>
          </CardContent>
        </Card>
      </div>
    </StaffShell>
  );
}
