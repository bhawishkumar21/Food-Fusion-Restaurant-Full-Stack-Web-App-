"use client";

import { useEffect, type ReactNode } from "react";
import { KarahiScene } from "@/components/karahi/karahi-scene";
import { Atmosphere } from "@/components/motion/atmosphere";
import { api, normalise } from "@/lib/api";
import { DEMO_MODE } from "@/lib/config";
import { realtime } from "@/lib/realtime";
import { installAudioUnlock, playSelectSound } from "@/lib/sound-fx";
import type { MenuItem } from "@/lib/types";
import { useCartStore } from "@/store/cart-store";
import { useMenuStore } from "@/store/menu-store";
import { useUiStore } from "@/store/ui-store";
import { CartDrawer } from "./cart-drawer";
import { CheckoutModal } from "./checkout-modal";
import { OrderFeedbackModal } from "./order-feedback-modal";
import { MenuSection } from "./menu-section";
import { SiteHeader } from "./site-header";
import { VoiceAgentModal } from "./voice-agent-modal";
import { Toaster } from "@/components/ui/toast";

/** The dish the hero assembles; falls back to the first karahi on the menu. */
const SIGNATURE_NAME = "Chicken Peshawari Karahi";

/**
 * Everything every storefront route shares: live menu, audio, the voice agent,
 * cart drawer, checkout and feedback. Pages render inside it.
 */
export function StorefrontShell({ children }: { children: ReactNode }) {
  useEffect(() => {
    const { setItems, setLoaded, upsert } = useMenuStore.getState();
    api.menu
      .list()
      .then(setItems)
      .finally(setLoaded);
    api.analytics.track("menu_view");
    // Inventory changes (manual 86, daily stock hitting zero) land here instantly.
    void realtime.connect();
    return realtime.on("menu:item-updated", (p) => upsert(normalise.menuItem(p)));
  }, []);

  // Audio: unlock on first gesture; chime whenever the cart grows, whether
  // from a card, the hero CTA, or the voice agent.
  useEffect(() => {
    const removeUnlock = installAudioUnlock();
    const total = (lines: { quantity: number }[]) => lines.reduce((n, l) => n + l.quantity, 0);
    const unsubscribe = useCartStore.subscribe((s, prev) => {
      if (total(s.lines) > total(prev.lines)) playSelectSound();
    });
    return () => {
      removeUnlock();
      unsubscribe();
    };
  }, []);

  return (
    <>
      <Atmosphere />
      <SiteHeader />
      <main className="relative z-10 overflow-x-clip">{children}</main>
      <footer className="relative z-10 border-t px-6 py-10 text-center text-sm text-muted-foreground">
        Food Fusion · 12 Amber Lane · Open daily 5pm–11pm
        {DEMO_MODE && (
          <span className="mt-2 block text-xs text-cream/40">
            Demo mode — open <a className="underline" href="/kitchen" target="_blank">/kitchen</a> in another tab to watch orders arrive live.
          </span>
        )}
      </footer>
      <VoiceAgentModal />
      <CartDrawer />
      <CheckoutModal />
      <OrderFeedbackModal />
      <Toaster />
    </>
  );
}

export function CustomerApp() {
  const signature = useMenuStore(
    (s) => s.items.find((i) => i.name === SIGNATURE_NAME) ?? s.items.find((i) => i.category === "Karahi") ?? null,
  );
  const openVoice = useUiStore((s) => s.openVoice);

  const addSignature = (item: MenuItem) => {
    useCartStore.getState().add(item);
    api.analytics.track("cart_add");
  };

  return (
    <StorefrontShell>
      <KarahiScene signature={signature} onTalk={openVoice} onAddSignature={addSignature} />
      <MenuSection />
    </StorefrontShell>
  );
}
