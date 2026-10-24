"use client";

import {
  AnimatePresence,
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  type Variants,
} from "framer-motion";
import { Plus, Sparkles } from "lucide-react";
import Image from "next/image";
import { useState, type PointerEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { playHoverSound } from "@/lib/sound-fx";
import type { MenuItem } from "@/lib/types";
import { cn, formatPrice, loadDirect, sizedImage } from "@/lib/utils";

/** House spring for every hover state. */
export const HOVER_SPRING = { type: "spring", stiffness: 300, damping: 20 } as const;
export const STAGGER = 0.08;
/** Max tilt in degrees at the card edges. */
const TILT = { x: 9, y: 11 };
/** Cards in the first screenful cascade in order; later ones stagger across their row. */
const FIRST_SCREEN = 6;

const reveal: Variants = {
  hidden: { opacity: 0, y: 36, scale: 0.97, filter: "blur(8px)" },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    filter: "blur(0px)",
    transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: (i < FIRST_SCREEN ? i : i % 3) * STAGGER },
    // Drop the filter once revealed so 161 cards don't each keep a filter layer.
    transitionEnd: { filter: "none" },
  }),
};

/**
 * Glass menu card: staggered blur-up reveal, cursor-driven 3D tilt and glare,
 * golden border light-sweep, 300/20 spring lift on hover,
 * image zoom, shimmer skeleton while the CDN original downloads, a
 * letter badge when the dish has no photo, and the voice assistant's
 * glowing "Suggested" state.
 */
export function MenuItemCard({
  item,
  index,
  highlighted,
  onAdd,
  priority,
}: {
  item: MenuItem;
  index: number;
  highlighted: boolean;
  onAdd: (item: MenuItem) => void;
  priority?: boolean;
}) {
  const reduce = useReducedMotion();
  const soldOut = !item.isAvailable;
  const [imageLoaded, setImageLoaded] = useState(false);

  // 3D tilt: rotation follows the cursor through the house spring.
  const rotateX = useSpring(0, { stiffness: 300, damping: 20 });
  const rotateY = useSpring(0, { stiffness: 300, damping: 20 });
  const glareX = useMotionValue(50);
  const glareY = useMotionValue(30);
  const glare = useMotionTemplate`radial-gradient(circle at ${glareX}% ${glareY}%, rgb(255 236 200 / 0.16), transparent 55%)`;
  const tiltEnabled = !reduce && !soldOut;

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    if (!tiltEnabled || e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    rotateY.set((px - 0.5) * 2 * TILT.y);
    rotateX.set((0.5 - py) * 2 * TILT.x);
    glareX.set(px * 100);
    glareY.set(py * 100);
  };
  const onPointerLeave = () => {
    rotateX.set(0);
    rotateY.set(0);
  };

  return (
    <motion.article
      custom={index}
      variants={reduce ? undefined : reveal}
      initial={reduce ? false : "hidden"}
      whileInView="show"
      viewport={{ once: true, margin: "0px 0px -8% 0px" }}
      whileHover={soldOut || reduce ? undefined : { y: -10, transition: HOVER_SPRING }}
      onHoverStart={() => !soldOut && playHoverSound()}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      style={{ rotateX, rotateY, transformPerspective: 900 }}
      id={`dish-${item.id}`}
      data-dish-id={item.id}
      data-dish-name={item.name.toLowerCase()}
      className={cn(
        "glass-flat group relative flex flex-col overflow-hidden rounded-[var(--radius-xl)] transition-all duration-500",
        !soldOut && "gold-border",
        highlighted && "border-gold ring-4 ring-gold/70 shadow-[0_0_35px_rgba(229,169,60,0.85)] scale-[1.02]",
        soldOut && "opacity-60",
      )}
      aria-label={`${item.name}, ${formatPrice(item.priceCents)}${soldOut ? ", sold out" : ""}`}
    >
      {tiltEnabled && (
        <motion.div
          aria-hidden
          style={{ background: glare }}
          className="pointer-events-none absolute inset-0 z-[2] opacity-0 mix-blend-screen transition-opacity duration-500 group-hover:opacity-100"
        />
      )}
      <div className={cn("relative aspect-[4/3] overflow-hidden", item.imageUrl && !imageLoaded && "shimmer")}>
        {item.imageUrl ? (
          <Image
            src={sizedImage(item.imageUrl, 900)!}
            alt=""
            fill
            priority={priority}
            unoptimized={loadDirect(item.imageUrl)}
            onLoad={() => setImageLoaded(true)}
            sizes="(min-width: 1280px) 30vw, (min-width: 768px) 45vw, 100vw"
            className={cn(
              // Blur-up: originals arrive soft and sharpen as they settle.
              "object-cover transition-[transform,opacity,filter] duration-[1100ms] ease-[cubic-bezier(.22,1,.36,1)] group-hover:scale-105",
              imageLoaded ? "opacity-100 blur-0" : "scale-105 opacity-0 blur-xl",
              soldOut && "grayscale",
            )}
          />
        ) : (
          // A few dishes have no photo on the source menu yet.
          <div aria-hidden className="grid h-full place-items-center bg-[radial-gradient(circle_at_30%_20%,rgb(229_169_60/0.22),transparent_60%),var(--color-velvet-raised)]">
            <span className="font-display grid size-24 place-items-center rounded-full border border-gold/30 text-5xl text-gold/70">
              {item.name.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
        <div className="warm-vignette pointer-events-none absolute inset-0" />
        <div className="absolute inset-0 bg-gradient-to-t from-velvet via-velvet/10 to-transparent" />

        <div className="absolute left-4 top-4 flex flex-wrap gap-1.5">
          <Badge variant="muted" className="glass border-0 text-cream/90">
            {item.category}
          </Badge>
          {item.badge && <Badge className="glass border-0 text-gold">{item.badge}</Badge>}
        </div>

        <AnimatePresence>
          {highlighted && (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8 }}
              transition={HOVER_SPRING}
              className="absolute right-4 top-4"
            >
              <Badge className="bg-primary text-primary-foreground shadow-lg">
                <Sparkles /> Suggested
              </Badge>
            </motion.div>
          )}
        </AnimatePresence>

        {soldOut && (
          <div className="absolute inset-0 grid place-items-center">
            <span className="rounded-full bg-espresso/80 px-4 py-1.5 text-xs font-semibold uppercase tracking-[var(--tracking-label)] text-cream">
              Sold out tonight
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-5 pt-1">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-lg font-semibold tracking-tight">{item.name}</h3>
          <span className="shrink-0 whitespace-nowrap font-medium tabular-nums text-gold">{formatPrice(item.priceCents)}</span>
        </div>
        <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">{item.description}</p>
        <motion.button
          type="button"
          disabled={soldOut}
          onClick={() => onAdd(item)}
          onHoverStart={playHoverSound}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.95 }}
          transition={HOVER_SPRING}
          className="sweep mt-auto inline-flex h-11 cursor-pointer items-center justify-center gap-2 self-start rounded-full border border-white/10 px-5 text-sm font-medium transition-colors hover:border-gold hover:bg-gold hover:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-4"
        >
          <Plus /> Add to order
        </motion.button>
      </div>
    </motion.article>
  );
}
