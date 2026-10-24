"use client";

import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "framer-motion";
import { Search, ShoppingBag, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { HOVER_SPRING } from "@/components/motion/menu-item-card";
import { isSoundEnabled, playHoverSound, playSelectSound, setSoundEnabled, subscribeSound } from "@/lib/sound-fx";
import { cn } from "@/lib/utils";
import { resolveCart, useCartStore } from "@/store/cart-store";
import { useMenuStore } from "@/store/menu-store";
import { UserHeaderMenu } from "./user-header-menu";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5 text-lg font-semibold tracking-tight", className)}>
      <span className="font-display grid size-8 place-items-center rounded-full bg-gradient-to-br from-gold to-saffron text-base font-bold italic text-primary-foreground">
        F
      </span>
      <span>
        Food <span className="font-display font-medium italic text-gold">Fusion</span>
      </span>
    </span>
  );
}

export function SiteHeader() {
  // Same resolution as the drawer, so the badge never counts a line the drawer can't show.
  const lines = useCartStore((s) => s.lines);
  const items = useMenuStore((s) => s.items);
  const { count } = resolveCart(lines, items);
  const open = useCartStore((s) => s.open);
  const lastOrder = useCartStore((s) => s.lastOrder);
  const hasOrder = Boolean(lastOrder && !["cancelled", "completed"].includes(lastOrder.status));
  const sound = useSyncExternalStore(subscribeSound, isSoundEnabled, () => true);
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 40));

  const iconButton =
    "grid size-11 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground";

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-40 transition-[background-color,backdrop-filter,border-color] duration-500",
        scrolled ? "border-b bg-espresso/60 backdrop-blur-2xl" : "border-b border-transparent",
      )}
    >
      <div className="mx-auto flex h-18 max-w-7xl items-center justify-between px-6">
        <Link href="/" aria-label="Food Fusion home" onPointerEnter={playHoverSound}>
          <Logo />
        </Link>
        <nav className="flex items-center gap-1">
          <Link href="/menu" onPointerEnter={playHoverSound} className="hidden rounded-full px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground sm:block">
            Menu
          </Link>
          {hasOrder && (
            <Link href="/orders/track" onPointerEnter={playHoverSound} className="hidden rounded-full px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground sm:block">
              Track order
            </Link>
          )}
          <button
            onClick={() => {
              playSelectSound();
              const el = document.getElementById("menu-search-input") as HTMLInputElement | null;
              if (el) {
                el.focus();
                el.scrollIntoView({ behavior: "smooth", block: "center" });
              } else {
                window.location.href = "/menu#menu-search";
              }
            }}
            onPointerEnter={playHoverSound}
            className={iconButton}
            aria-label="Search dishes on menu"
            title="Search dishes ( / )"
          >
            <Search className="size-5" />
          </button>
          <button
            onClick={() => setSoundEnabled(!sound)}
            onPointerEnter={playHoverSound}
            className={iconButton}
            aria-pressed={sound}
            aria-label={sound ? "Mute interface sounds" : "Turn on interface sounds"}
          >
            {sound ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}
          </button>
          <UserHeaderMenu />
          <motion.button
            onClick={() => {
              playSelectSound();
              open("cart");
            }}
            onHoverStart={playHoverSound}
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.95 }}
            transition={HOVER_SPRING}
            className={cn(
              "relative ml-1 grid size-11 cursor-pointer place-items-center rounded-full border backdrop-blur-xl backdrop-saturate-150 transition-[border-color,background-color,box-shadow] duration-300",
              "bg-gradient-to-b from-white/[0.10] to-white/[0.02] shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_10px_30px_-12px_rgb(0_0_0/0.8)]",
              count > 0
                ? "border-gold/35 shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_0_0_4px_rgb(229_169_60/0.08),0_10px_30px_-12px_rgb(229_169_60/0.45)]"
                : "border-white/12 hover:border-gold/40",
            )}
            aria-label={`Open cart, ${count} items`}
          >
            <ShoppingBag className={cn("size-[1.15rem]", count > 0 ? "text-gold" : "text-cream/85")} strokeWidth={1.8} />
            <AnimatePresence>
              {count > 0 && (
                <motion.span
                  key={count}
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 600, damping: 18 }}
                  className="absolute -right-1 -top-1 z-10 grid h-5 min-w-5 place-items-center rounded-full bg-gradient-to-br from-gold to-saffron px-1 text-[0.65rem] font-bold tabular-nums text-primary-foreground shadow-[0_2px_8px_rgb(229_169_60/0.55)] ring-2 ring-espresso/80"
                >
                  {count > 99 ? "99+" : count}
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        </nav>
      </div>
    </header>
  );
}
