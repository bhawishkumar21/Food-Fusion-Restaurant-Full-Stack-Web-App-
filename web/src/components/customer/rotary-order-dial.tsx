"use client";

import { animate, motion, useMotionValue, useReducedMotion, useTransform, type MotionValue, type PanInfo } from "framer-motion";
import Image from "next/image";
import { useEffect, useRef, type KeyboardEvent, type WheelEvent } from "react";
import { playDialSpin, playDialTick } from "@/lib/sound-fx";
import type { MenuItem } from "@/lib/types";
import { cn, formatPrice, loadDirect } from "@/lib/utils";

export interface DialLine {
  item: MenuItem;
  quantity: number;
}

const MIN_SLOTS = 8;
/** Mechanical feel: a stiff spring with a little overshoot, like a dial detent. */
const DETENT = { type: "spring", stiffness: 160, damping: 15, mass: 0.9 } as const;

/**
 * Vintage rotary-telephone dial for order review. Items sit in the finger
 * holes; the dial turns (rotateZ, on a 3D-tilted plane) to bring the focused
 * item up to the gold notch at 12 o'clock.
 *   focused  → scale 1.25, sharp, full opacity, amber glow, details shown
 *   adjacent → scale 0.75, blurred 4px, 40% opacity
 *   far      → hidden
 * `spinToken` changing triggers the full 360° confirmation spin.
 */
export function RotaryOrderDial({
  lines,
  active,
  onActive,
  spinToken,
  onSpinComplete,
  size = 360,
  totalLabel,
}: {
  lines: DialLine[];
  active: number;
  onActive: (index: number) => void;
  spinToken: number;
  onSpinComplete: () => void;
  size?: number;
  totalLabel: string;
}) {
  const reduce = Boolean(useReducedMotion());
  const slots = Math.max(lines.length, MIN_SLOTS);
  const step = 360 / slots;
  const radius = size * 0.33;
  const rot = useMotionValue(0);
  const target = useRef(0);
  const panAccum = useRef(0);
  const wheelLock = useRef(0);

  // Turn the shortest way round to the focused slot, like a real dial.
  useEffect(() => {
    const desired = -active * step;
    let next = desired;
    while (next - target.current > 180) next -= 360;
    while (target.current - next > 180) next += 360;
    target.current = next;
    if (reduce) rot.set(next);
    else void animate(rot, next, DETENT);
  }, [active, step, rot, reduce]);

  // Confirmation: one fast full revolution with ratchet sound, then hand off.
  const lastSpin = useRef(spinToken);
  useEffect(() => {
    if (spinToken === lastSpin.current) return;
    lastSpin.current = spinToken;
    if (reduce) return onSpinComplete();
    playDialSpin(1100);
    target.current -= 360;
    const controls = animate(rot, target.current, { duration: 1.1, ease: [0.7, 0, 0.3, 1] });
    void controls.then(onSpinComplete);
    return () => controls.stop();
  }, [spinToken, rot, reduce, onSpinComplete]);

  const move = (delta: number) => {
    if (!lines.length) return;
    playDialTick();
    onActive((active + delta + lines.length) % lines.length);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    }
  };
  const onWheel = (e: WheelEvent) => {
    const now = performance.now();
    if (now - wheelLock.current < 220 || Math.abs(e.deltaY) < 8) return;
    wheelLock.current = now;
    move(e.deltaY > 0 ? 1 : -1);
  };
  const onPan = (_: unknown, info: PanInfo) => {
    panAccum.current += info.delta.x;
    if (Math.abs(panAccum.current) > 46) {
      move(panAccum.current < 0 ? 1 : -1);
      panAccum.current = 0;
    }
  };

  const current = lines[active];

  return (
    <div className="flex flex-col items-center">
      <p className="sr-only" aria-live="polite">
        {current ? `${current.item.name}, ${current.quantity} × ${formatPrice(current.item.priceCents)}. Item ${active + 1} of ${lines.length}.` : ""}
      </p>
      <div className="relative mt-10 [perspective:1000px]" style={{ width: size, height: size }}>
        {/* Gold notch marking the focused (12 o'clock) slot. */}
        <span aria-hidden className="absolute left-1/2 top-[-34px] z-30 -translate-x-1/2 border-x-[9px] border-t-[12px] border-x-transparent border-t-gold drop-shadow-[0_0_8px_rgb(229_169_60/0.8)]" />

        <motion.div
          role="listbox"
          aria-label="Your order — use arrow keys to turn the dial"
          aria-activedescendant={current ? `dial-item-${current.item.id}` : undefined}
          tabIndex={0}
          onKeyDown={onKey}
          onWheel={onWheel}
          onPan={onPan}
          onPanEnd={() => (panAccum.current = 0)}
          className="relative h-full w-full touch-pan-y rounded-full focus-visible:outline-none"
          style={{ rotateX: reduce ? 0 : 20, transformStyle: "preserve-3d" }}
        >
          {/* The rotating dial plate. */}
          <motion.div
            style={{ rotate: rot }}
            className="absolute inset-0 rounded-full border-2 border-gold/60 bg-[radial-gradient(circle_at_35%_30%,#2a2521_0%,#1e1b18_55%,#121010_100%)] shadow-[0_40px_80px_-30px_rgb(0_0_0/0.9),inset_0_0_0_6px_rgb(30_27_24),inset_0_0_0_7px_rgb(229_169_60/0.35),inset_0_10px_30px_rgb(255_255_255/0.05)]"
          >
            {/* Finger holes (decorative where no item sits). */}
            {Array.from({ length: slots }, (_, i) => (
              <span
                key={`hole-${i}`}
                aria-hidden
                className="absolute left-1/2 top-1/2 grid size-[18%] place-items-center rounded-full bg-[#0d0b0a] text-[0.6rem] font-semibold text-cream/20 shadow-[inset_0_3px_8px_rgb(0_0_0/0.9),0_1px_0_rgb(255_255_255/0.06)]"
                style={{ transform: `translate(-50%, -50%) rotate(${i * step}deg) translateY(${-radius}px)` }}
              >
                {i >= lines.length ? (i + 1) % 10 : ""}
              </span>
            ))}
            {lines.map((line, i) => (
              <DialItem
                key={line.item.id}
                line={line}
                angle={i * step}
                radius={radius}
                rot={rot}
                distance={Math.min(Math.abs(i - active), lines.length - Math.abs(i - active))}
                reduce={reduce}
                onSelect={() => {
                  if (i !== active) {
                    playDialTick();
                    onActive(i);
                  }
                }}
              />
            ))}
          </motion.div>
        </motion.div>

        {/* Fixed centre hub + finger stop (they don't turn with the dial). */}
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 z-20 grid size-[34%] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-gold/50 bg-[radial-gradient(circle_at_40%_30%,#2e2925,#151210)] text-center shadow-[0_10px_30px_rgb(0_0_0/0.7),inset_0_0_0_3px_rgb(229_169_60/0.15)]">
          <div>
            <p className="text-[0.6rem] uppercase tracking-[var(--tracking-label)] text-muted-foreground">Total</p>
            <p className="text-base font-semibold tabular-nums text-gold">{totalLabel}</p>
            <p className="text-[0.65rem] text-muted-foreground">
              {lines.reduce((n, l) => n + l.quantity, 0)} items
            </p>
          </div>
        </div>
        <span aria-hidden className="absolute bottom-[14%] right-[9%] z-20 h-[4%] w-[16%] rotate-[-38deg] rounded-full bg-gradient-to-r from-[#8a6420] via-gold to-[#fff1cf] shadow-[0_4px_12px_rgb(0_0_0/0.6)]" />
      </div>
    </div>
  );
}

function DialItem({
  line,
  angle,
  radius,
  rot,
  distance,
  reduce,
  onSelect,
}: {
  line: DialLine;
  angle: number;
  radius: number;
  rot: MotionValue<number>;
  distance: number;
  reduce: boolean;
  onSelect: () => void;
}) {
  // Counter-rotate so the label stays upright wherever the dial is turned.
  const upright = useTransform(rot, (r) => -(r + angle));
  const focused = distance === 0;
  const visible = distance <= 2;
  const { item, quantity } = line;

  return (
    <div
      className="absolute left-1/2 top-1/2"
      style={{ transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(${-radius}px)`, zIndex: 10 - distance }}
    >
      <motion.div style={{ rotate: upright }}>
        <motion.button
          id={`dial-item-${item.id}`}
          role="option"
          aria-selected={focused}
          aria-label={`${item.name}, ${quantity} × ${formatPrice(item.priceCents)}`}
          tabIndex={-1}
          onClick={onSelect}
          animate={{
            scale: focused ? 1.25 : 0.75,
            opacity: !visible ? 0 : focused ? 1 : 0.4,
            filter: reduce || focused ? "blur(0px)" : "blur(4px)",
          }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          className={cn(
            "flex w-[96px] cursor-pointer flex-col items-center gap-1 rounded-2xl border p-2 text-center backdrop-blur-md",
            focused
              ? "border-gold bg-velvet/90 shadow-[0_0_0_1px_rgb(229_169_60/0.6),0_0_30px_-4px_rgb(229_169_60/0.7)]"
              : "border-white/10 bg-velvet/70",
            !visible && "pointer-events-none",
          )}
        >
          <span className="relative block size-10 overflow-hidden rounded-full border border-white/10">
            {item.imageUrl ? (
              <Image src={item.imageUrl} alt="" fill sizes="40px" loading="eager" unoptimized={loadDirect(item.imageUrl)} className="object-cover" />
            ) : (
              <span className="font-display grid h-full place-items-center bg-velvet-raised text-lg text-gold/80">{item.name.charAt(0).toUpperCase()}</span>
            )}
          </span>
          <span className="line-clamp-2 text-[0.62rem] font-semibold leading-tight">{item.name}</span>
          <span className="text-[0.6rem] tabular-nums text-gold">
            {quantity} × {formatPrice(item.priceCents)}
          </span>
        </motion.button>
      </motion.div>
    </div>
  );
}
