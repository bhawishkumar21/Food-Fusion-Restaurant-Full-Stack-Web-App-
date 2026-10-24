"use client";

import { useGSAP } from "@gsap/react";
import { useReducedMotion } from "framer-motion";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ArrowDown, AudioLines, Plus } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { playHoverSound } from "@/lib/sound-fx";
import type { MenuItem } from "@/lib/types";
import { cn, formatPrice } from "@/lib/utils";
import { KarahiCard } from "./karahi-card";
import { useKarahiCanvas, useMediaQuery } from "./use-karahi-canvas";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const STEPS = [
  { n: "01", label: "Deconstructed", hint: "Clay karahi, ghee, tomato, marinated meat" },
  { n: "02", label: "Assembling", hint: "Ginger, green chili, cilantro" },
  { n: "03", label: "Served", hint: "Slow-cooked, straight from the fire" },
];

interface SceneProps {
  signature: MenuItem | null;
  onTalk: () => void;
  onAddSignature: (item: MenuItem) => void;
}

/**
 * Landing hero + scroll-driven Signature Karahi assembly.
 *  ≥768px: a pinned scene; GSAP ScrollTrigger scrubs one timeline that drives
 *          both the canvas (via a proxy value) and the DOM copy layers.
 *  <768px: a drag-to-rotate, gyroscope-tilting 360° card instead.
 */
export function KarahiScene(props: SceneProps) {
  const mobile = useMediaQuery("(max-width: 767px)");
  return mobile ? <MobileScene {...props} /> : <DesktopScene {...props} />;
}

function HugeTitle({ className }: { className?: string }) {
  return (
    <h1
      className={cn(
        "kz-title font-display pointer-events-none select-none text-center font-semibold uppercase leading-[0.82] tracking-[-0.04em]",
        "bg-gradient-to-b from-cream via-cream/80 to-gold/40 bg-clip-text text-transparent",
        className,
      )}
    >
      Food
      <br />
      Fusion
    </h1>
  );
}

// ─────────────────────────────────────────────────────────── desktop ──

function DesktopScene({ signature, onTalk, onAddSignature }: SceneProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spotRef = useRef<HTMLDivElement>(null);
  const proxy = useRef({ p: 0 });
  const pointer = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const reduce = Boolean(useReducedMotion());

  useKarahiCanvas(canvasRef, {
    mode: "scroll",
    animate: !reduce,
    getProgress: () => (reduce ? 1 : proxy.current.p),
    getPointer: () => {
      // Ease the parallax target so the floating pieces drift, never jitter.
      const ptr = pointer.current;
      ptr.x += (ptr.tx - ptr.x) * 0.06;
      ptr.y += (ptr.ty - ptr.y) * 0.06;
      return ptr;
    },
  });

  useGSAP(
    () => {
      if (reduce) return;
      const tl = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: { trigger: sectionRef.current, start: "top top", end: "bottom bottom", scrub: 0.8 },
      });
      tl.to(proxy.current, { p: 1, duration: 1 }, 0)
        .to(".kz-hero", { autoAlpha: 0, y: -60, duration: 0.16 }, 0.02)
        .to(".kz-cue", { autoAlpha: 0, duration: 0.06 }, 0.02)
        .to(".kz-title", { scale: 0.84, autoAlpha: 0.14, duration: 0.5 }, 0.06)
        .to(".kz-title", { autoAlpha: 0, duration: 0.12 }, 0.76)
        .fromTo(".kz-steps", { autoAlpha: 0, x: 24 }, { autoAlpha: 1, x: 0, duration: 0.08 }, 0.12)
        .to(".kz-steps", { autoAlpha: 0, duration: 0.08 }, 0.78);
      // Step captions light up in sequence with the assembly.
      const windows: [number, number][] = [
        [0.12, 0.3],
        [0.3, 0.62],
        [0.62, 0.8],
      ];
      windows.forEach(([a, b], i) => {
        tl.fromTo(`.kz-step-${i}`, { opacity: 0.32 }, { opacity: 1, duration: 0.04 }, a).to(`.kz-step-${i}`, { opacity: 0.32, duration: 0.04 }, b - 0.04);
      });
      tl.fromTo(".kz-final", { autoAlpha: 0, x: -48 }, { autoAlpha: 1, x: 0, duration: 0.14, ease: "power2.out" }, 0.84);

      // Cursor spotlight (GPU transforms only, via quickTo).
      const spot = spotRef.current;
      if (!spot || !window.matchMedia("(pointer: fine)").matches) return;
      const toX = gsap.quickTo(spot, "x", { duration: 0.6, ease: "power3" });
      const toY = gsap.quickTo(spot, "y", { duration: 0.6, ease: "power3" });
      const onMove = (e: PointerEvent) => {
        const sticky = Math.min(Math.max(e.clientY, 0), window.innerHeight);
        toX(e.clientX - 280);
        toY(sticky - 280);
        pointer.current.tx = (e.clientX / window.innerWidth) * 2 - 1;
        pointer.current.ty = (sticky / window.innerHeight) * 2 - 1;
      };
      window.addEventListener("pointermove", onMove, { passive: true });
      return () => window.removeEventListener("pointermove", onMove);
    },
    { scope: sectionRef, dependencies: [reduce] },
  );

  return (
    <section ref={sectionRef} aria-label="Signature Karahi" className={cn("relative", reduce ? "h-svh min-h-[680px]" : "h-[380vh]")}>
      <div className="sticky top-0 isolate h-svh min-h-[640px] overflow-hidden">
        {/* Layer 0: massive editorial type, sitting BEHIND the pot. */}
        <div className="absolute inset-0 z-0 grid place-items-center pt-10">
          <HugeTitle className={cn("gpu text-[clamp(6rem,15vw,17rem)]", reduce && "opacity-15")} />
        </div>

        {/* Layer 1: the assembling karahi, lifted off the page by a deep drop shadow. */}
        <div className="gpu absolute inset-0 z-10 [filter:drop-shadow(0_25px_25px_rgb(0_0_0/0.8))]">
          <canvas ref={canvasRef} className="h-full w-full" aria-hidden />
        </div>

        {/* Layer 2: warm spotlight trailing the cursor. */}
        <div
          ref={spotRef}
          aria-hidden
          className="gpu pointer-events-none absolute left-0 top-0 z-20 size-[560px] rounded-full opacity-70 mix-blend-screen"
          style={{ background: "radial-gradient(circle, rgb(229 169 60 / 0.16) 0%, transparent 65%)", transform: "translate(-999px,-999px)" }}
        />

        {/* Layer 3: copy. */}
        <div className={cn("kz-hero absolute inset-x-0 bottom-0 z-30 mx-auto flex max-w-7xl items-end justify-between gap-8 px-6 pb-14", reduce && "hidden")}>
          <div className="max-w-md">
            <p className="eyebrow">Downtown · Open until 11pm</p>
            <p className="mt-4 text-2xl font-medium leading-snug tracking-tight text-cream/90">
              Slow-crafted fusion,{" "}
              <span className="font-display italic text-gold">ordered in a sentence.</span>
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button size="lg" onClick={onTalk} onPointerEnter={playHoverSound}>
                <AudioLines /> Order with voice
              </Button>
              <Button size="lg" variant="outline" asChild onPointerEnter={playHoverSound}>
                <a href="#menu">
                  Browse the menu <ArrowDown />
                </a>
              </Button>
            </div>
          </div>
        </div>
        <p className={cn("kz-cue absolute bottom-6 left-1/2 z-30 hidden -translate-x-1/2 flex-col items-center gap-2 text-center text-[0.65rem] uppercase tracking-[var(--tracking-label)] text-cashmere lg:flex", reduce && "!hidden")}>
          Scroll to assemble the Signature Karahi
          <ArrowDown className="size-3.5 animate-bounce text-gold" />
        </p>

        <ol className={cn("kz-steps invisible absolute right-6 top-1/2 z-30 hidden -translate-y-1/2 flex-col gap-6 lg:flex xl:right-16", reduce && "!hidden")}>
          {STEPS.map((s, i) => (
            <li key={s.n} className={`kz-step-${i} max-w-56 opacity-30`}>
              <span className="font-display text-sm italic text-gold">{s.n}</span>
              <p className="text-lg font-semibold tracking-tight">{s.label}</p>
              <p className="text-xs text-muted-foreground">{s.hint}</p>
            </li>
          ))}
        </ol>

        <FinalPanel
          className={cn("kz-final absolute left-6 top-1/2 z-30 max-w-xl -translate-y-1/2 lg:left-[max(1.5rem,calc((100vw-80rem)/2+1.5rem))]", reduce ? "visible" : "invisible")}
          signature={signature}
          onAddSignature={onAddSignature}
        />
      </div>
    </section>
  );
}

function FinalPanel({
  className,
  signature,
  onAddSignature,
}: {
  className?: string;
  signature: MenuItem | null;
  onAddSignature: (item: MenuItem) => void;
}) {
  return (
    <div className={className}>
      <p className="eyebrow">Signature of the house</p>
      <h2 className="font-display mt-4 text-[clamp(3.5rem,7vw,7rem)] font-medium leading-[0.92]">
        Tonight&apos;s <span className="italic text-gold">Table</span>
      </h2>
      <p className="mt-6 max-w-sm text-base leading-relaxed text-muted-foreground">
        {signature
          ? `${signature.name}: ghee, tomato and green chili, finished over open flame. The rest of the menu waits below.`
          : "A clay-pot karahi, finished over open flame. The full menu waits below."}
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        {signature && (
          <Button size="lg" onClick={() => onAddSignature(signature)} onPointerEnter={playHoverSound} disabled={!signature.isAvailable}>
            <Plus /> Add the Karahi · {formatPrice(signature.priceCents)}
          </Button>
        )}
        <Button size="lg" variant="outline" asChild onPointerEnter={playHoverSound}>
          <a href="#menu">
            Explore the menu <ArrowDown />
          </a>
        </Button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────── mobile ──

function MobileScene({ signature, onTalk, onAddSignature }: SceneProps) {
  return (
    <section aria-label="Signature Karahi" className="relative overflow-hidden px-5 pb-16 pt-24">
      <div className="pointer-events-none absolute inset-x-0 top-20 z-0 flex justify-center opacity-40">
        <HugeTitle className="text-[27vw]" />
      </div>
      <div className="relative z-10 mx-auto mt-10 w-full max-w-sm">
        <KarahiCard signature={signature} onAddSignature={onAddSignature} />
      </div>
      <div className="relative z-10 mt-10 text-center">
        <p className="eyebrow">Downtown · Open until 11pm</p>
        <p className="mt-3 text-xl font-medium tracking-tight">
          Slow-crafted fusion, <span className="font-display italic text-gold">ordered in a sentence.</span>
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <Button size="lg" onClick={onTalk}>
            <AudioLines /> Order with voice
          </Button>
          <Button size="lg" variant="outline" asChild>
            <a href="#menu">
              Browse the menu <ArrowDown />
            </a>
          </Button>
        </div>
        <h2 className="font-display mt-14 text-5xl font-medium leading-none">
          Tonight&apos;s <span className="italic text-gold">Table</span>
        </h2>
      </div>
    </section>
  );
}
