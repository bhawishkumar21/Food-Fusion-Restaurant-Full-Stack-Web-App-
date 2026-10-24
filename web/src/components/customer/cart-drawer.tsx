"use client";

import { AnimatedDialog } from "@/components/ui/dialog";
import { useCartStore } from "@/store/cart-store";
import { CartReview } from "./cart-review";

/** Slide-in order review with the rotary dial. */
export function CartDrawer() {
  const panel = useCartStore((s) => s.panel);
  const open = useCartStore((s) => s.open);
  const viaVoice = useCartStore((s) => s.viaVoice);

  return (
    <AnimatedDialog
      side="right"
      open={panel === "cart"}
      onOpenChange={(o) => open(o ? "cart" : "none")}
      title="Your order"
      description={viaVoice ? "Built with Fusion AI — turn the dial to review each dish." : "Turn the dial to review each dish."}
    >
      <CartReview size={340} onEmptyBrowse={() => open("none")} />
    </AnimatedDialog>
  );
}
