"use client";

import { useReducedMotion } from "framer-motion";
import { useEffect, useRef } from "react";

interface Ember {
  x: number;
  y: number;
  vy: number;
  size: number;
  depth: number;
  phase: number;
  hue: number;
  life: number;
  age: number;
}

/**
 * Fixed ambient layer behind the storefront:
 *  • slowly drifting blurred light blobs (pure CSS transforms, GPU only)
 *  • a canvas of warm embers rising lazily, with scroll parallax by depth
 * It fills the "empty black" between sections without competing with content.
 */
export function Atmosphere() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let w = 0;
    let h = 0;
    let dpr = 1;
    let embers: Ember[] = [];
    let raf = 0;
    let last = performance.now();
    let lastScroll = window.scrollY;

    // One pre-rendered glow sprite; every ember is a tinted, scaled copy.
    const sprite = document.createElement("canvas");
    sprite.width = sprite.height = 64;
    const sc = sprite.getContext("2d")!;
    const g = sc.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,236,190,1)");
    g.addColorStop(0.18, "rgba(255,180,80,0.85)");
    g.addColorStop(0.5, "rgba(217,110,30,0.25)");
    g.addColorStop(1, "rgba(217,110,30,0)");
    sc.fillStyle = g;
    sc.fillRect(0, 0, 64, 64);

    const spawn = (anywhere: boolean): Ember => {
      const depth = 0.3 + Math.random() * 0.7;
      return {
        x: Math.random() * w,
        y: anywhere ? Math.random() * h : h + 20,
        vy: -(6 + Math.random() * 22) * depth,
        size: (3 + Math.random() * 9) * depth,
        depth,
        phase: Math.random() * Math.PI * 2,
        hue: Math.random(),
        life: 9 + Math.random() * 14,
        age: anywhere ? Math.random() * 8 : 0,
      };
    };

    const resize = () => {
      // Embers are soft glows: 1x density looks identical and is 4x fewer pixels on retina.
      dpr = 1;
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const count = Math.round(Math.min(90, (w * h) / 22000));
      embers = Array.from({ length: count }, () => spawn(true));
    };

    const draw = (time: number) => {
      const dt = Math.min(0.05, (time - last) / 1000);
      last = time;
      const scrollDelta = window.scrollY - lastScroll;
      lastScroll = window.scrollY;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      const t = time / 1000;
      for (let i = 0; i < embers.length; i++) {
        const e = embers[i];
        e.age += dt;
        e.y += e.vy * dt - scrollDelta * e.depth * 0.35; // nearer embers parallax more
        e.x += Math.sin(t * 0.6 + e.phase) * 8 * e.depth * dt;
        if (e.age > e.life || e.y < -30 || e.y > h + 40) {
          embers[i] = spawn(e.y > h + 40); // pushed off-screen by fast scroll: reseed anywhere
          continue;
        }
        const fade = Math.min(1, e.age / 2) * Math.min(1, (e.life - e.age) / 3);
        const flicker = 0.65 + 0.35 * Math.sin(t * (3 + e.hue * 4) + e.phase);
        ctx.globalAlpha = fade * flicker * (0.25 + e.depth * 0.5);
        const s = e.size;
        ctx.drawImage(sprite, e.x - s, e.y - s, s * 2, s * 2);
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    if (reduce) {
      // Static, sparse field for reduced motion.
      draw(performance.now());
      cancelAnimationFrame(raf);
    } else {
      raf = requestAnimationFrame(draw);
    }
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reduce) {
        last = performance.now();
        raf = requestAnimationFrame(draw);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reduce]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {/* Mesh light: two warm blobs drifting on long, offset loops. */}
      <div className="gpu absolute -left-[20%] top-[-10%] size-[70vmax] animate-drift-a rounded-full bg-[radial-gradient(circle,rgb(229_169_60/0.10),transparent_60%)] blur-3xl motion-reduce:animate-none" />
      <div className="gpu absolute -right-[25%] bottom-[-20%] size-[80vmax] animate-drift-b rounded-full bg-[radial-gradient(circle,rgb(217_130_43/0.08),transparent_60%)] blur-3xl motion-reduce:animate-none" />
      <canvas ref={canvasRef} className="gpu absolute inset-0 h-full w-full" />
    </div>
  );
}
