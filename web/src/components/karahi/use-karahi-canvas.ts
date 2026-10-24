"use client";

import { useEffect, useSyncExternalStore, type RefObject } from "react";
import { KarahiRenderer, type RenderMode } from "./karahi-renderer";

/**
 * Mounts a KarahiRenderer on a canvas, keeps it sized to its parent, and runs
 * a render loop only while the canvas is on screen. With `animate: false`
 * (reduced motion) it draws a single still frame per resize instead.
 */
export function useKarahiCanvas(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  {
    mode,
    animate,
    getProgress = () => 1,
    getPointer = () => ({ x: 0, y: 0 }),
  }: {
    mode: RenderMode;
    animate: boolean;
    getProgress?: () => number;
    getPointer?: () => { x: number; y: number };
  },
) {
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;

    let renderer: KarahiRenderer;
    try {
      renderer = new KarahiRenderer(canvas, mode);
    } catch {
      return; // no canvas support: the surrounding copy still works
    }
    let raf = 0;
    let visible = true;
    const frame = () => {
      renderer.render(getProgress(), performance.now() / 1000, getPointer());
      if (animate && visible) raf = requestAnimationFrame(frame);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    };

    let size = { width: 0, height: 0 };
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!width || !height) return;
      size = { width, height };
      renderer.resize(width, height);
      start();
    });
    ro.observe(host);
    // If the GPU drops the main canvas, rebuild everything once it is back.
    const onRestored = () => {
      if (size.width) renderer.resize(size.width, size.height);
      start();
    };
    canvas.addEventListener("contextrestored", onRestored);

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
      else cancelAnimationFrame(raf);
    });
    io.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener("contextrestored", onRestored);
    };
    // getProgress/getPointer read refs, so they are stable by contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef, mode, animate]);
}

/** SSR-safe media query: the server (and hydration) assume desktop. */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
