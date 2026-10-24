"use client";

import { LayoutGroup, motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { RotateCcw, Search, UtensilsCrossed, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { HOVER_SPRING, MenuItemCard } from "@/components/motion/menu-item-card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { playHoverSound, playSelectSound } from "@/lib/sound-fx";
import type { MenuItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useCartStore } from "@/store/cart-store";
import { selectCategories, selectVisibleItems, useMenuStore } from "@/store/menu-store";

export function MenuSection() {
  const loading = !useMenuStore((s) => s.loaded);
  const { filter, setFilter, searchQuery, setSearchQuery, resetSearch, highlighted, glowId } = useMenuStore(
    useShallow((s) => ({
      filter: s.filter,
      setFilter: s.setFilter,
      searchQuery: s.searchQuery,
      setSearchQuery: s.setSearchQuery,
      resetSearch: s.resetSearch,
      highlighted: s.highlighted,
      glowId: s.focus?.glow ? s.focus.id : null,
    })),
  );
  const items = useMenuStore(useShallow(selectVisibleItems));
  const categories = useMenuStore(useShallow(selectCategories));
  const add = useCartStore((s) => s.add);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const sectionRef = useRef<HTMLElement>(null);

  // Keyboard shortcut: Press "/" to focus menu search unless already typing
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes((document.activeElement?.tagName || "").toUpperCase()) &&
        !(document.activeElement as HTMLElement)?.isContentEditable
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // The add-to-cart chime is played centrally (see CustomerApp) so voice adds chime too.
  const onAdd = (item: MenuItem) => {
    add(item);
    api.analytics.track("cart_add");
  };

  const chips = ["all", ...categories];

  return (
    <section ref={sectionRef} id="menu" aria-label="Tonight's Table menu" className="relative mx-auto max-w-7xl scroll-mt-20 px-6 pb-32 pt-10">
      <Watermark target={sectionRef} />
      
      {/* Menu Header with dish counts and live search match feedback */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Tonight&apos;s Table · the full menu</p>
          <h2 className="font-display mt-1 text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
            Explore our <span className="italic text-gold">Cuisine</span>
          </h2>
        </div>
        {!loading && (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            <span className="font-semibold text-foreground">{items.length}</span> {items.length === 1 ? "dish" : "dishes"}
            {filter !== "all" && ` in ${filter}`}
            {searchQuery.trim() && (
              <>
                {" "}matching <span className="font-medium text-gold">&ldquo;{searchQuery.trim()}&rdquo;</span>
              </>
            )}
          </p>
        )}
      </div>

      {/* Sleek, Real-time Menu Search Bar */}
      <div id="menu-search" className="relative mt-6">
        <div className="group relative flex items-center rounded-2xl border border-white/10 bg-white/[0.04] p-1 shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_12px_32px_-12px_rgb(0_0_0/0.7)] backdrop-blur-2xl transition-all duration-300 focus-within:border-gold/50 focus-within:bg-white/[0.07] focus-within:shadow-[inset_0_1px_0_rgb(255_255_255/0.15),0_0_0_3px_rgb(229_169_60/0.12),0_16px_40px_-10px_rgb(229_169_60/0.25)]">
          <div className="grid size-11 shrink-0 place-items-center text-muted-foreground transition-colors group-focus-within:text-gold">
            <Search className="size-5" />
          </div>
          <input
            id="menu-search-input"
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search 170+ dishes by name, category, or description (e.g. Karahi, Burger, Chowmein, Tempura)..."
            aria-label="Search dishes on the menu"
            className="h-11 w-full bg-transparent pr-4 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none sm:text-base [appearance:textfield] [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => {
                playSelectSound();
                resetSearch();
                searchInputRef.current?.focus();
              }}
              className="mr-2 grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground active:scale-95"
              aria-label="Clear search and restore full menu"
              title="Clear search"
            >
              <X className="size-4" />
            </button>
          ) : (
            <div className="mr-3 hidden items-center gap-1 text-xs text-muted-foreground/50 sm:flex pointer-events-none">
              <kbd className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                /
              </kbd>
            </div>
          )}
        </div>
      </div>

      {/* Category chips: one scrollable glass row, sticky under the header. */}
      <LayoutGroup id="menu-filters">
        <div className="sticky top-[4.5rem] z-20 -mx-6 mt-5 px-6 py-3">
          <div
            role="tablist"
            aria-label="Menu categories"
            className="glass flex gap-1 overflow-x-auto rounded-full p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {chips.map((value) => {
              const active = filter === value;
              return (
                <motion.button
                  key={value}
                  role="tab"
                  aria-selected={active}
                  onHoverStart={playHoverSound}
                  onClick={() => {
                    if (!active) playSelectSound();
                    setFilter(value);
                  }}
                  whileTap={{ scale: 0.95 }}
                  transition={HOVER_SPRING}
                  className={cn(
                    "relative flex h-10 shrink-0 cursor-pointer items-center rounded-full px-4 text-sm font-medium transition-colors",
                    active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="activeChip"
                      className="absolute inset-0 rounded-full bg-gradient-to-r from-gold to-saffron shadow-[0_6px_20px_-6px_rgb(229_169_60/0.7)]"
                      transition={HOVER_SPRING}
                    />
                  )}
                  <span className="relative">{value === "all" ? "All" : value}</span>
                </motion.button>
              );
            })}
          </div>
        </div>
      </LayoutGroup>

      {/* Dishes Grid or Clean Empty State */}
      {items.length === 0 && !loading ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="relative z-10 mt-10 flex flex-col items-center justify-center rounded-[var(--radius-xl)] border border-white/10 bg-white/[0.02] px-6 py-16 text-center backdrop-blur-xl"
        >
          <div className="grid size-16 place-items-center rounded-full border border-white/10 bg-white/5 text-gold shadow-[0_0_30px_-6px_rgb(229_169_60/0.3)]">
            <UtensilsCrossed className="size-8" />
          </div>
          <h3 className="font-display mt-5 text-2xl font-medium tracking-tight text-foreground">
            No dishes found
          </h3>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            {searchQuery.trim()
              ? `We couldn't find any dishes matching "${searchQuery.trim()}"${filter !== "all" ? ` in ${filter}` : ""}. Try searching by dish name, category, or another ingredient.`
              : `No dishes are currently available under ${filter}.`}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button
              variant="outline"
              onClick={() => {
                playSelectSound();
                resetSearch();
                searchInputRef.current?.focus();
              }}
              className="rounded-full border-gold/40 text-gold hover:bg-gold/10 hover:text-gold"
            >
              <RotateCcw className="mr-2 size-4" />
              Reset search
            </Button>
          </div>
        </motion.div>
      ) : (
        <div key={`${filter}-${searchQuery ? "search" : "all"}`} className="relative z-10 mt-6 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {loading
            ? Array.from({ length: 6 }, (_, i) => <div key={i} className="shimmer aspect-[4/5] rounded-[var(--radius-xl)]" />)
            : items.map((item, i) => (
                <MenuItemCard
                  key={item.id}
                  item={item}
                  index={i}
                  priority={i < 3}
                  highlighted={highlighted.includes(item.id) || glowId === item.id}
                  onAdd={onAdd}
                />
              ))}
        </div>
      )}
    </section>
  );
}

/**
 * Giant editorial type running horizontally behind the grid. It stays pinned
 * in the viewport while the menu scrolls past, the two lines sliding in
 * opposite directions with scroll progress.
 */
function Watermark({ target }: { target: React.RefObject<HTMLElement | null> }) {
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target, offset: ["start end", "end start"] });
  const left = useTransform(scrollYProgress, [0, 1], reduce ? ["0%", "0%"] : ["5%", "-45%"]);
  const right = useTransform(scrollYProgress, [0, 1], reduce ? ["-20%", "-20%"] : ["-45%", "5%"]);
  const line = "font-display whitespace-nowrap text-[clamp(6rem,17vw,16rem)] font-semibold uppercase leading-none tracking-[-0.03em]";
  return (
    <div aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 z-0 w-screen -translate-x-1/2 overflow-hidden">
      <div className="sticky top-0 flex h-svh flex-col justify-center gap-[4vh] overflow-hidden">
        <motion.p style={{ x: left }} className={`gpu ${line} text-cream/[0.035]`}>
          Signature Selection · Signature Selection
        </motion.p>
        <motion.p style={{ x: right }} className={`gpu ${line} bg-gradient-to-r from-gold/[0.06] to-saffron/[0.03] bg-clip-text italic text-transparent`}>
          Ghalib Cuisine · Ghalib Cuisine
        </motion.p>
      </div>
    </div>
  );
}
