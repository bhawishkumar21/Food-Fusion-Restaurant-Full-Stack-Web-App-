"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";

// ─── Store ────────────────────────────────────────────────────────────────────

interface ToastItem {
  id: string;
  message: string;
  variant: "success" | "error" | "info";
}

interface ToastState {
  toasts: ToastItem[];
  push: (t: Omit<ToastItem, "id">) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
    }, 3500);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

// ─── Imperative helpers (usable outside React) ────────────────────────────────

export const toast = {
  success: (message: string) => useToastStore.getState().push({ message, variant: "success" }),
  error: (message: string) => useToastStore.getState().push({ message, variant: "error" }),
  info: (message: string) => useToastStore.getState().push({ message, variant: "info" }),
};

// ─── Renderer ─────────────────────────────────────────────────────────────────

const variantStyles: Record<ToastItem["variant"], string> = {
  success: "bg-emerald-950/90 border-emerald-500/40 text-emerald-200",
  error:   "bg-red-950/90   border-red-500/40   text-red-200",
  info:    "bg-zinc-900/90  border-zinc-600/40  text-zinc-200",
};

const variantIcon: Record<ToastItem["variant"], string> = {
  success: "✅",
  error:   "❌",
  info:    "ℹ️",
};

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // mount → fade in
    requestAnimationFrame(() => setVisible(true));
  }, []);

  return (
    <div
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-xl backdrop-blur-md transition-all duration-300 ${variantStyles[item.variant]} ${visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}`}
      role="alert"
    >
      <span className="mt-0.5 shrink-0 text-base leading-none">{variantIcon[item.variant]}</span>
      <span className="flex-1 leading-snug">{item.message}</span>
      <button
        onClick={onDismiss}
        className="ml-2 shrink-0 text-xs opacity-50 hover:opacity-100"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

/** Mount this once in your root layout / shell. */
export function Toaster() {
  const { toasts, dismiss } = useToastStore();

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-24 right-4 z-[9999] flex w-80 flex-col gap-2"
    >
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastCard item={t} onDismiss={() => dismiss(t.id)} />
        </div>
      ))}
    </div>
  );
}

export const ToastRenderer = Toaster;
