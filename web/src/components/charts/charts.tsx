"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * Lightweight SVG charts following the house dataviz rules:
 * thin marks, 4px rounded data-ends on the baseline, recessive grid, one axis,
 * hover tooltips on every mark, text in ink tokens (never series colour),
 * and a table view for every chart.
 */

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p / 2) * 2 * p;
}

function Tooltip({ x, y, children, width }: { x: number; y: number; children: ReactNode; width: number }) {
  // Flip to the left when near the right edge so it never overflows.
  const left = x > width - 160;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 rounded-[var(--radius-sm)] border bg-popover px-3 py-2 text-xs shadow-xl"
      style={{ left: x, top: y, transform: `translate(${left ? "calc(-100% - 12px)" : "12px"}, -50%)` }}
    >
      {children}
    </div>
  );
}

export function TableView({ columns, rows }: { columns: string[]; rows: (string | number)[][] }) {
  return (
    <details className="group mt-3 text-xs">
      <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">View as table</summary>
      <div className="mt-2 max-h-56 overflow-auto rounded-[var(--radius-sm)] border">
        <table className="w-full text-left tabular-nums">
          <thead className="sticky top-0 bg-popover text-muted-foreground">
            <tr>{columns.map((c) => <th key={c} className="px-3 py-2 font-medium">{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t">
                {r.map((cell, j) => <td key={j} className="px-3 py-1.5">{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// ─────────────────────────────────────────────────────── area / trend ──

export function AreaTrend({
  data,
  format,
  label,
  height = 220,
}: {
  data: { x: string; y: number }[];
  format: (v: number) => string;
  label: string;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { t: 12, r: 8, b: 24, l: 66 }; // room for "PKR 800K"
  const w = Math.max(0, width - pad.l - pad.r);
  const h = height - pad.t - pad.b;
  const max = niceMax(Math.max(...data.map((d) => d.y), 0));
  const xAt = (i: number) => pad.l + (data.length <= 1 ? 0 : (i / (data.length - 1)) * w);
  const yAt = (v: number) => pad.t + h - (v / max) * h;
  const line = data.map((d, i) => `${i ? "L" : "M"}${xAt(i)},${yAt(d.y)}`).join("");
  const area = `${line}L${xAt(data.length - 1)},${pad.t + h}L${xAt(0)},${pad.t + h}Z`;
  const ticks = [0, 0.5, 1].map((f) => f * max);
  const labelEvery = Math.ceil(data.length / 6);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - rect.left) / rect.width) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };

  return (
    <div ref={ref} className="relative">
      {width > 0 && data.length > 0 && (
        <svg width={width} height={height} role="img" aria-label={label}>
          <defs>
            <linearGradient id="area-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--color-chart-primary)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--color-chart-primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={pad.l + w} y1={yAt(t)} y2={yAt(t)} stroke="var(--color-chart-grid)" />
              <text x={pad.l - 8} y={yAt(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
                {format(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) =>
            i % labelEvery === 0 ? (
              <text key={d.x} x={xAt(i)} y={height - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                {d.x}
              </text>
            ) : null,
          )}
          <path d={area} fill="url(#area-fill)" />
          <path d={line} fill="none" stroke="var(--color-chart-primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {hover !== null && (
            <g>
              <line x1={xAt(hover)} x2={xAt(hover)} y1={pad.t} y2={pad.t + h} stroke="var(--color-cashmere)" strokeOpacity={0.4} strokeDasharray="3 3" />
              <circle cx={xAt(hover)} cy={yAt(data[hover].y)} r={5} fill="var(--color-chart-primary)" stroke="var(--color-velvet)" strokeWidth={2} />
            </g>
          )}
          <rect x={pad.l} y={pad.t} width={w} height={h} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </svg>
      )}
      {hover !== null && (
        <Tooltip x={xAt(hover)} y={yAt(data[hover].y)} width={width}>
          <p className="text-muted-foreground">{data[hover].x}</p>
          <p className="font-semibold tabular-nums text-foreground">{format(data[hover].y)}</p>
        </Tooltip>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────── funnel bars ──

export function FunnelBars({ steps }: { steps: { label: string; value: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const top = Math.max(...steps.map((s) => s.value), 1);
  return (
    <ol className="flex flex-col gap-3">
      {steps.map((s, i) => {
        const prev = steps[i - 1]?.value;
        const kept = prev ? s.value / prev : 1;
        return (
          <li key={s.label} className="relative" onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span>{s.label}</span>
              <span className="tabular-nums text-muted-foreground">
                {s.value.toLocaleString()}
                {prev ? (
                  <span className={cn("ml-2", 1 - kept > 0.4 && "text-foreground")}>
                    {kept <= 1 ? "−" : "+"}
                    {Math.abs(Math.round((1 - kept) * 100))}%
                  </span>
                ) : null}
              </span>
            </div>
            <div className="h-3 rounded-r-[4px] bg-secondary">
              <div
                className={cn("h-full rounded-r-[4px] bg-chart-primary transition-opacity", hover !== null && hover !== i && "opacity-40")}
                style={{ width: `${(s.value / top) * 100}%` }}
              />
            </div>
            {hover === i && prev ? (
              <p className="absolute right-0 top-full z-10 mt-1 rounded-[var(--radius-sm)] border bg-popover px-2.5 py-1.5 text-xs shadow-xl">
                {Math.round(kept * 100)}% continued from “{steps[i - 1].label}”
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

// ───────────────────────────────────────────── diverging stacked bar ──

const SENTIMENT = [
  { key: "positive", label: "Positive", color: "var(--color-chart-positive)" },
  { key: "neutral", label: "Neutral", color: "var(--color-chart-neutral)" },
  { key: "negative", label: "Negative", color: "var(--color-chart-negative)" },
] as const;

export function SentimentBar({ counts }: { counts: Partial<Record<"positive" | "neutral" | "negative", number>> }) {
  const [hover, setHover] = useState<string | null>(null);
  const total = SENTIMENT.reduce((s, x) => s + (counts[x.key] ?? 0), 0) || 1;
  return (
    <div>
      {/* 2px surface gaps between segments; each segment is a hover target. */}
      <div className="flex h-4 gap-[2px] overflow-hidden rounded-[4px]" role="img" aria-label="AI sentiment split">
        {SENTIMENT.map((s) => {
          const n = counts[s.key] ?? 0;
          if (!n) return null;
          return (
            <div
              key={s.key}
              onPointerEnter={() => setHover(s.key)}
              onPointerLeave={() => setHover(null)}
              className={cn("h-full transition-opacity", hover && hover !== s.key && "opacity-40")}
              style={{ width: `${(n / total) * 100}%`, background: s.color }}
              title={`${s.label}: ${n} (${Math.round((n / total) * 100)}%)`}
            />
          );
        })}
      </div>
      <ul className="mt-4 grid grid-cols-3 gap-2 text-sm">
        {SENTIMENT.map((s) => {
          const n = counts[s.key] ?? 0;
          return (
            <li key={s.key} className="flex flex-col">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="text-lg font-semibold tabular-nums">{Math.round((n / total) * 100)}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ───────────────────────────────────────────────────────────── columns ──

export function ColumnChart({
  data,
  format,
  label,
  detail,
  height = 200,
}: {
  data: { x: string; y: number }[];
  format: (v: number) => string;
  label: string;
  detail?: (i: number) => ReactNode;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { t: 8, r: 0, b: 22, l: 52 };
  const w = Math.max(0, width - pad.l - pad.r);
  const h = height - pad.t - pad.b;
  const max = niceMax(Math.max(...data.map((d) => d.y), 0));
  const slot = data.length ? w / data.length : 0;
  const bw = Math.max(2, slot - 2); // 2px gap between adjacent bars
  const yAt = (v: number) => pad.t + h - (v / max) * h;
  const labelEvery = Math.ceil(data.length / 7);

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label}>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={pad.l} x2={pad.l + w} y1={yAt(f * max)} y2={yAt(f * max)} stroke="var(--color-chart-grid)" />
              <text x={pad.l - 8} y={yAt(f * max)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
                {format(f * max)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = pad.l + i * slot + 1;
            const y = yAt(d.y);
            const bh = pad.t + h - y;
            const r = Math.min(4, bw / 2, bh);
            // Rounded top (data-end), square base on the baseline.
            const path = `M${x},${pad.t + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${pad.t + h}Z`;
            return (
              <g key={d.x} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                <rect x={pad.l + i * slot} y={pad.t} width={slot} height={h} fill="transparent" />
                <path d={path} fill="var(--color-chart-primary)" opacity={hover === null || hover === i ? 1 : 0.4} />
                {i % labelEvery === 0 && (
                  <text x={x + bw / 2} y={height - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                    {d.x}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && (
        <Tooltip x={pad.l + hover * slot + slot / 2} y={yAt(data[hover].y)} width={width}>
          <p className="text-muted-foreground">{data[hover].x}</p>
          <p className="font-semibold tabular-nums text-foreground">{format(data[hover].y)}</p>
          {detail?.(hover)}
        </Tooltip>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────── stat tile ──

export function StatTile({ label, value, sub, icon }: { label: string; value: string; sub?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-lg)] border bg-card p-5 shadow-velvet">
      <p className="flex items-center gap-2 text-sm text-muted-foreground [&_svg]:size-4 [&_svg]:text-primary">
        {icon}
        {label}
      </p>
      <p className="mt-3 text-3xl font-semibold tabular-nums tracking-[var(--tracking-editorial)]">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
