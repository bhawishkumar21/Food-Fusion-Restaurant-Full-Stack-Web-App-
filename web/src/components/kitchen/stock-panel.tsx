"use client";

import { Switch } from "@/components/ui/switch";
import type { MenuItem } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 1-click 86 board. Flipping a switch updates the live menu and voice agent in real time. */
export function StockPanel({ items, onToggle }: { items: MenuItem[]; onToggle: (item: MenuItem, available: boolean) => void }) {
  const soldOut = items.filter((i) => !i.isAvailable).length;
  return (
    <aside className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-[var(--tracking-label)] text-muted-foreground">Stock</h2>
        {soldOut > 0 && <span className="text-xs font-semibold text-[#FF8E78]">{soldOut} sold out</span>}
      </div>
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item.id}>
            <label
              className={cn(
                "flex cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-md)] border px-3 py-2.5 transition-colors",
                item.isAvailable ? "bg-velvet" : "border-ember/50 bg-ember/10",
              )}
            >
              <span className={cn("text-sm font-medium", !item.isAvailable && "text-[#FF8E78] line-through")}>{item.name}</span>
              <Switch
                checked={item.isAvailable}
                onCheckedChange={(v) => onToggle(item, v)}
                aria-label={`${item.name} ${item.isAvailable ? "in stock" : "sold out"}`}
              />
            </label>
          </li>
        ))}
      </ul>
    </aside>
  );
}
