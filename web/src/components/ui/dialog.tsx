"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Radix Dialog (focus trap, Esc, aria) animated with Framer Motion.
 * `side="right"` turns it into a sheet/drawer.
 */
export function AnimatedDialog({
  open,
  onOpenChange,
  title,
  description,
  side = "center",
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  side?: "center" | "right";
  className?: string;
  children: ReactNode;
}) {
  const sheet = side === "right";
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-espresso/70 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount>
              <motion.div
                className={cn(
                  "glass fixed z-50 flex flex-col overflow-hidden focus:outline-none",
                  sheet
                    ? "inset-y-0 right-0 w-full max-w-md rounded-l-[var(--radius-xl)]"
                    : "inset-x-4 top-1/2 mx-auto max-h-[90dvh] max-w-lg rounded-[var(--radius-xl)]",
                  className,
                )}
                initial={sheet ? { x: "100%" } : { opacity: 0, scale: 0.94, y: "-46%" }}
                animate={sheet ? { x: 0 } : { opacity: 1, scale: 1, y: "-50%" }}
                exit={sheet ? { x: "100%" } : { opacity: 0, scale: 0.96, y: "-48%" }}
                transition={{ type: "spring", stiffness: 380, damping: 34 }}
              >
                <div className="flex items-start justify-between gap-4 px-6 pt-6">
                  <div>
                    <DialogPrimitive.Title className="text-xl font-semibold tracking-[var(--tracking-editorial)]">
                      {title}
                    </DialogPrimitive.Title>
                    {description ? (
                      <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                        {description}
                      </DialogPrimitive.Description>
                    ) : (
                      <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
                    )}
                  </div>
                  <DialogPrimitive.Close
                    className="-mr-2 grid size-10 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    aria-label="Close"
                  >
                    <X className="size-5" />
                  </DialogPrimitive.Close>
                </div>
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">{children}</div>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}
