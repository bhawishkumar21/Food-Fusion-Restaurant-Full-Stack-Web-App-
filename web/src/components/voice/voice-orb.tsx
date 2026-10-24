"use client";

import {
  AnimatePresence,
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { BAND_COUNT, type VoiceEngine, type VoiceFrame } from "./voice-engine";

/**
 * The glowing glass orb. One rAF loop samples the engine and writes to motion
 * values / bar transforms directly, so audio-rate animation never re-renders
 * React.
 *   listening  → orb + ripples track mic energy; gold/sage sine soundbars
 *   processing → a fast revolving halo ring
 *   speaking   → layered pulsing aura
 */
export function VoiceOrb({
  engine,
  compact = false,
}: {
  engine: Pick<VoiceEngine, "sample" | "state">;
  compact?: boolean;
}) {
  const reduce = useReducedMotion();
  const level = useMotionValue(0);
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const sampleRef = useRef(engine.sample);
  useEffect(() => {
    sampleRef.current = engine.sample;
  }, [engine.sample]);

  useEffect(() => {
    const frame: VoiceFrame = { level: 0, bands: new Float32Array(BAND_COUNT) };
    let smooth = 0;
    let raf = 0;
    const tick = (now: number) => {
      sampleRef.current(frame);
      smooth += (frame.level - smooth) * 0.22;
      level.set(smooth);
      const t = now / 1000;
      for (let i = 0; i < BAND_COUNT; i++) {
        const el = bars.current[i];
        if (!el) continue;
        // Idle sine shimmer so the bars never sit dead flat while listening.
        const idle = reduce ? 0 : 0.06 + 0.05 * Math.sin(t * 3 + i * 0.55);
        el.style.transform = `scaleY(${Math.min(1, idle + frame.bands[i] * 1.15).toFixed(3)})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [level, reduce]);

  const orbScale = useSpring(useTransform(level, [0, 1], [1, 1.2]), { stiffness: 300, damping: 20 });
  const glow = useTransform(level, [0, 1], [compact ? 16 : 36, compact ? 60 : 150]);
  const glowAlpha = useTransform(level, [0, 1], [0.35, 0.85]);
  const boxShadow = useMotionTemplate`0 0 ${glow}px rgb(229 169 60 / ${glowAlpha}), inset 0 -18px 40px rgb(120 50 0 / 0.55), inset 0 10px 30px rgb(255 240 200 / 0.35)`;

  const { state } = engine;
  const listening = state === "listening";

  return (
    <div className="relative flex flex-col items-center">
      <div className={cn("relative grid place-items-center", compact ? "size-28" : "size-[min(78vw,340px,38vh)]")}>
        {/* Ripples: each lags the voice by a different spring. */}
        {[0, 1, 2].map((i) => (
          <Ripple key={i} level={level} index={i} active={listening || state === "speaking"} />
        ))}

        {/* Speaking: layered aura pulses. */}
        <AnimatePresence>
          {state === "speaking" &&
            [0, 1, 2].map((i) => (
              <motion.span
                key={`aura-${i}`}
                aria-hidden
                className="absolute size-[58%] rounded-full border border-gold/50 bg-[radial-gradient(circle,rgb(229_169_60/0.18),transparent_70%)]"
                initial={{ scale: 1, opacity: 0 }}
                animate={reduce ? { opacity: 0.4 } : { scale: [1, 1.75], opacity: [0.55, 0] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 2.1, repeat: Infinity, delay: i * 0.7, ease: "easeOut" }}
              />
            ))}
        </AnimatePresence>

        {/* Processing: fast revolving halo ring. */}
        <AnimatePresence>
          {(state === "processing" || state === "connecting") && (
            <motion.span
              key="halo"
              aria-hidden
              className="absolute size-[76%] rounded-full"
              style={{
                background: "conic-gradient(from 0deg, transparent 0deg, rgb(229 169 60 / 0.0) 200deg, rgb(229 169 60 / 0.9) 300deg, #fff1cf 340deg, transparent 360deg)",
                WebkitMask: "radial-gradient(circle, transparent 64%, #000 65%, #000 69%, transparent 70%)",
                mask: "radial-gradient(circle, transparent 64%, #000 65%, #000 69%, transparent 70%)",
              }}
              initial={{ opacity: 0, rotate: 0 }}
              animate={{ opacity: 1, rotate: 360 }}
              exit={{ opacity: 0 }}
              transition={{ rotate: { duration: state === "connecting" ? 1.6 : 0.8, repeat: Infinity, ease: "linear" }, opacity: { duration: 0.3 } }}
            />
          )}
        </AnimatePresence>

        {/* Glass shell + amber core. */}
        <div aria-hidden className="absolute size-[62%] rounded-full border border-white/15 bg-white/[0.04] shadow-[0_30px_80px_-20px_rgb(0_0_0/0.8)] backdrop-blur-xl" />
        <motion.div
          aria-hidden
          style={{ scale: orbScale, boxShadow }}
          className="gpu relative size-[48%] rounded-full bg-[radial-gradient(circle_at_34%_28%,#fff3d0_0%,#f3c463_22%,#e5a93c_45%,#b8690f_75%,#4a2006_100%)]"
        >
          {/* Specular highlight + soft caustic for the glass read. */}
          <span className="absolute left-[18%] top-[10%] h-[28%] w-[42%] rotate-[-24deg] rounded-full bg-white/45 blur-md" />
          <span className="absolute bottom-[12%] right-[18%] h-[14%] w-[30%] rounded-full bg-[#ffd98a]/40 blur-md" />
        </motion.div>
      </div>

      {/* Listening: sine soundbars in gold and emerald sage. */}
      <div aria-hidden className={cn("flex items-center gap-[4px] transition-opacity duration-500", compact ? "mt-1 h-8" : "mt-2 h-16", listening ? "opacity-100" : "opacity-25")}>
        {Array.from({ length: BAND_COUNT }, (_, i) => (
          <span
            key={i}
            ref={(el) => {
              bars.current[i] = el;
            }}
            className={cn(
              "block origin-center rounded-full",
              compact ? "h-8 w-[3.5px]" : "h-16 w-[5px]",
              i % 3 === 1
                ? "bg-gradient-to-t from-sage to-sage-bright shadow-[0_0_10px_rgb(46_125_94/0.7)]"
                : "bg-gradient-to-t from-saffron to-gold shadow-[0_0_10px_rgb(229_169_60/0.6)]",
            )}
            style={{ transform: "scaleY(0.08)" }}
          />
        ))}
      </div>
    </div>
  );
}

function Ripple({ level, index, active }: { level: MotionValue<number>; index: number; active: boolean }) {
  const target = useTransform(level, [0, 1], [1, 1.25 + index * 0.22]);
  const scale = useSpring(target, { stiffness: 220 - index * 60, damping: 14 + index * 2 });
  const opacity = useTransform(level, [0, 0.6], [0.12, 0.5 - index * 0.12]);
  return (
    <motion.span
      aria-hidden
      style={{ scale, opacity: active ? opacity : 0.06 }}
      className="absolute size-[56%] rounded-full border border-gold/40"
    />
  );
}
