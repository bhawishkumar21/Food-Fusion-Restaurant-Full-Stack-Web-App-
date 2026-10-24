"use client";

import { animate, motion, useMotionValue, useReducedMotion, useTransform, type PanInfo } from "framer-motion";
import { Hand, Plus, Smartphone } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { playHoverSound } from "@/lib/sound-fx";
import type { MenuItem } from "@/lib/types";
import { formatPrice } from "@/lib/utils";
import { useKarahiCanvas } from "./use-karahi-canvas";

type OrientationCtor = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<"granted" | "denied"> };
const needsTiltPermission = () =>
  typeof window !== "undefined" && typeof (window.DeviceOrientationEvent as OrientationCtor | undefined)?.requestPermission === "function";
const noop = () => () => {};

/**
 * Mobile fallback for the scroll assembly: the finished karahi on a card you
 * can spin 360° by dragging (it snaps to front or back on release) and that
 * leans with the phone's gyroscope. The back face is a one-tap add-to-order.
 */
export function KarahiCard({ signature, onAddSignature }: { signature: MenuItem | null; onAddSignature: (item: MenuItem) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduce = Boolean(useReducedMotion());
  const spin = useMotionValue(0);
  const tiltX = useMotionValue(0);
  const tiltY = useMotionValue(0);
  const rotateY = useTransform(() => spin.get() + tiltY.get());
  const dragStart = useRef(0);
  const askPermission = useSyncExternalStore(noop, needsTiltPermission, () => false);
  const [tiltOn, setTiltOn] = useState(false);

  useKarahiCanvas(canvasRef, { mode: "card", animate: !reduce });

  // Gyroscope tilt. Android fires immediately; iOS needs a tap-to-allow first.
  useEffect(() => {
    if (reduce || (askPermission && !tiltOn)) return;
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      tiltY.set(Math.max(-22, Math.min(22, e.gamma * 0.5)));
      tiltX.set(Math.max(-14, Math.min(14, (e.beta - 50) * -0.35)));
    };
    window.addEventListener("deviceorientation", onTilt);
    return () => window.removeEventListener("deviceorientation", onTilt);
  }, [reduce, askPermission, tiltOn, tiltX, tiltY]);

  const enableTilt = async () => {
    try {
      const res = await (window.DeviceOrientationEvent as OrientationCtor).requestPermission!();
      setTiltOn(res === "granted");
    } catch {
      setTiltOn(false);
    }
  };

  const onPan = (_: unknown, info: PanInfo) => spin.set(dragStart.current + info.offset.x * 0.6);
  const onPanEnd = (_: unknown, info: PanInfo) => {
    // Carry the flick's momentum, then come to rest on a face (multiples of 180°).
    const projected = spin.get() + info.velocity.x * 0.12;
    animate(spin, Math.round(projected / 180) * 180, { type: "spring", stiffness: 140, damping: 18 });
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="w-full [perspective:1100px]">
        <motion.div
          onPanStart={() => {
            dragStart.current = spin.get();
            playHoverSound();
          }}
          onPan={onPan}
          onPanEnd={onPanEnd}
          style={{ rotateY, rotateX: tiltX, transformStyle: "preserve-3d" }}
          className="relative aspect-[4/5] w-full cursor-grab touch-pan-y [will-change:transform] active:cursor-grabbing"
          role="img"
          aria-label="Signature Karahi. Drag to rotate."
        >
          {/* Front: the cooked karahi, steaming. */}
          {/* Faces use the blur-free glass: backdrop-filter flattens preserve-3d and breaks backface culling. */}
          <div className="glass-flat absolute inset-0 overflow-hidden rounded-[var(--radius-xl)] [backface-visibility:hidden] [transform:rotateY(0deg)_translateZ(1px)]">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_40%,rgb(229_169_60/0.18),transparent_70%)]" />
            <canvas ref={canvasRef} className="absolute inset-0 h-full w-full [filter:drop-shadow(0_18px_18px_rgb(0_0_0/0.75))]" aria-hidden />
            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between p-5">
              <div>
                <p className="eyebrow">Signature</p>
                <p className="font-display text-2xl">{signature?.name ?? "Peshawari Karahi"}</p>
              </div>
              {signature && <span className="text-sm font-semibold tabular-nums text-gold">{formatPrice(signature.priceCents)}</span>}
            </div>
          </div>

          {/* Back: details + add to order. */}
          <div className="glass-flat absolute inset-0 flex flex-col justify-between rounded-[var(--radius-xl)] bg-velvet/95 p-6 [backface-visibility:hidden] [transform:rotateY(180deg)_translateZ(1px)]">
            <div>
              <p className="eyebrow">From the clay pot</p>
              <h3 className="font-display mt-3 text-3xl leading-tight">{signature?.name ?? "Peshawari Karahi"}</h3>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                Ghee, tomato, ginger juliennes and green chili, finished over open flame and topped with fresh cilantro.
              </p>
            </div>
            {signature && (
              <Button size="lg" onClick={() => onAddSignature(signature)} disabled={!signature.isAvailable} onPointerDown={(e) => e.stopPropagation()}>
                <Plus /> Add · {formatPrice(signature.priceCents)}
              </Button>
            )}
          </div>
        </motion.div>
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Hand className="size-3.5" /> Drag to rotate
        </span>
        {askPermission && !tiltOn && !reduce && (
          <button onClick={enableTilt} className="flex h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-cream">
            <Smartphone className="size-3.5" /> Enable tilt
          </button>
        )}
      </div>
    </div>
  );
}
