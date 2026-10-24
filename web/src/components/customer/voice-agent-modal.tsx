"use client";

import { ConversationProvider } from "@elevenlabs/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AudioLines,
  ChevronDown,
  Keyboard,
  Mic,
  MicOff,
  SendHorizontal,
  ShoppingBag,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { VoiceEngine } from "@/components/voice/voice-engine";
import { useLiveVoice } from "@/components/voice/use-live-voice";
import { VoiceOrb } from "@/components/voice/voice-orb";
import { installVoiceAudioUnlock, primeVoiceAudio } from "@/components/voice/audio-unlock";
import { playHoverSound, playSelectSound } from "@/lib/sound-fx";
import { cn } from "@/lib/utils";
import { useCartStore } from "@/store/cart-store";
import { useMenuStore } from "@/store/menu-store";
import { useUiStore } from "@/store/ui-store";
import { useAssistantTools } from "./assistant-tools";

const STATE_LABEL: Record<VoiceEngine["state"], string> = {
  idle: "Tap mic to talk",
  connecting: "Connecting…",
  listening: "Listening",
  processing: "Thinking",
  speaking: "Speaking",
  error: "Voice offline",
};

const SUGGESTIONS = [
  "Chicken Peshawari Karahi",
  "Club Sandwich",
  "Show me the BBQ",
  "What's for dessert?",
];

/**
 * Floating Voice Assistant Dock:
 * Sleek bottom-right floating widget (~380px) that keeps the menu 100% interactive
 * and visible in the background, complete with real-time dish highlights and live transcript.
 */
export function VoiceAgentDock() {
  return (
    <ConversationProvider>
      <LiveVoiceDock />
    </ConversationProvider>
  );
}

// Backwards-compatibility alias in case imported elsewhere
export const VoiceAgentModal = VoiceAgentDock;

function LiveVoiceDock() {
  const tools = useAssistantTools();
  return <VoiceDockStage engine={useLiveVoice(tools)} />;
}

function VoiceDockStage({ engine }: { engine: VoiceEngine }) {
  const open = useUiStore((s) => s.voiceOpen);
  const setOpen = useUiStore((s) => s.setVoiceOpen);
  const openVoice = useUiStore((s) => s.openVoice);
  const cartCount = useCartStore((s) => s.lines.reduce((n, l) => n + l.quantity, 0));
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [added, setAdded] = useState<{ id: number; label: string }[]>([]);
  const [minimized, setMinimized] = useState(false);
  const engineRef = useRef(engine);

  useEffect(installVoiceAudioUnlock, []);
  useEffect(() => {
    engineRef.current = engine;
  });

  // When opened, automatically start listening
  useEffect(() => {
    if (!open) return;
    if (engineRef.current.supported) engineRef.current.start();
    else setTyping(true);
    return () => engineRef.current.stop();
  }, [open]);

  // Show items dispatched to the cart in real-time
  useEffect(() => {
    if (!open) return;
    let nextId = 0;
    return useCartStore.subscribe((s, prev) => {
      const items = useMenuStore.getState().items;
      for (const line of s.lines) {
        const before = prev.lines.find((l) => l.itemId === line.itemId)?.quantity ?? 0;
        if (line.quantity > before) {
          const name = items.find((i) => i.id === line.itemId)?.name ?? "Item";
          const id = nextId++;
          setAdded((a) => [...a.slice(-2), { id, label: `+${line.quantity - before} ${name}` }]);
          setTimeout(() => setAdded((a) => a.filter((x) => x.id !== id)), 4000);
        }
      }
    });
  }, [open]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    engine.sendText(draft);
    setDraft("");
  };

  const live = engine.state === "listening" || engine.state === "speaking" || engine.state === "processing";
  const lastUser = [...engine.turns].reverse().find((t) => t.role === "user");
  const lastAgent = [...engine.turns].reverse().find((t) => t.role === "agent");

  return (
    <>
      {/* Floating Trigger Button (when dock is closed) */}
      <AnimatePresence>
        {!open && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 20 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            onHoverStart={playHoverSound}
            onClick={() => {
              playSelectSound();
              primeVoiceAudio();
              openVoice();
            }}
            aria-label="Order with AI voice assistant"
            className="fixed bottom-5 right-5 z-40 flex h-14 cursor-pointer items-center gap-2.5 rounded-full bg-gradient-to-br from-gold to-saffron px-5 font-semibold text-primary-foreground shadow-[0_12px_36px_-8px_rgba(229,169,60,0.65)] hover:shadow-[0_16px_40px_-6px_rgba(229,169,60,0.8)] border border-gold/40 backdrop-blur-md sm:bottom-6 sm:right-6"
          >
            <AudioLines className="size-5" />
            <span className="text-sm tracking-wide">Ask Fusion AI</span>
            <span className="flex size-2 rounded-full bg-cream animate-pulse" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Floating Dock Widget (Bottom-Right, non-blocking) */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
              height: minimized ? "auto" : undefined,
            }}
            exit={{ opacity: 0, y: 40, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="fixed bottom-4 right-4 z-50 flex w-[calc(100vw-2rem)] max-w-[380px] flex-col overflow-hidden rounded-[var(--radius-xl)] border border-gold/30 bg-[radial-gradient(ellipse_at_top,rgba(38,34,32,0.95)_0%,rgba(14,12,11,0.98)_100%)] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.85),0_0_30px_rgba(229,169,60,0.15)] backdrop-blur-2xl"
          >
            {/* Header */}
            <header className="flex items-center justify-between border-b border-white/10 px-4 py-3 bg-white/[0.02]">
              <div className="flex items-center gap-2">
                <span className="font-display text-base font-medium text-cream">
                  Fusion <span className="italic text-gold">AI</span>
                </span>
                <span className="flex items-center gap-1.5 rounded-full bg-white/5 px-2 py-0.5 text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      live
                        ? "animate-pulse bg-sage-bright"
                        : engine.state === "error"
                          ? "bg-ember"
                          : "bg-cashmere/50",
                    )}
                  />
                  {STATE_LABEL[engine.state]}
                </span>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setMinimized((m) => !m)}
                  className="grid size-7 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                  aria-label={minimized ? "Expand assistant" : "Minimize assistant"}
                >
                  <ChevronDown className={cn("size-4 transition-transform", minimized && "rotate-180")} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    engine.stop();
                    setOpen(false);
                  }}
                  className="grid size-7 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                  aria-label="Close assistant"
                >
                  <X className="size-4" />
                </button>
              </div>
            </header>

            {/* Collapsible Body */}
            {!minimized && (
              <div className="flex flex-col gap-3 p-4">
                {/* Voice Orb Area */}
                <div className="flex items-center justify-center py-1">
                  <VoiceOrb engine={engine} compact={true} />
                </div>

                {/* Conversation Speech Bubbles */}
                <div className="flex max-h-28 flex-col gap-1.5 overflow-y-auto px-1 text-center [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {engine.interim ? (
                    <p className="text-xs italic text-cream/70 animate-pulse">“{engine.interim}”</p>
                  ) : lastUser ? (
                    <p className="text-xs text-cream/60">You: “{lastUser.text}”</p>
                  ) : null}

                  {lastAgent ? (
                    <motion.p
                      key={lastAgent.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="font-display text-sm leading-snug text-cream"
                    >
                      {lastAgent.text}
                    </motion.p>
                  ) : (
                    <p className="font-display text-sm text-cream/80">
                      {engine.state === "error" ? (
                        <span className="text-ember">{engine.error}</span>
                      ) : (
                        <>What can I get you <span className="italic text-gold">tonight?</span></>
                      )}
                    </p>
                  )}
                </div>

                {/* Added Items Pill notification */}
                <div className="flex min-h-6 flex-wrap justify-center gap-1.5">
                  <AnimatePresence>
                    {added.map((a) => (
                      <motion.span
                        key={a.id}
                        initial={{ opacity: 0, scale: 0.85, y: 4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.85 }}
                        className="flex items-center gap-1 rounded-full border border-sage-bright/40 bg-sage/20 px-2.5 py-0.5 text-xs text-[#9be0c1]"
                      >
                        <ShoppingBag className="size-3" /> {a.label}
                      </motion.span>
                    ))}
                  </AnimatePresence>
                </div>

                {/* Quick Dish Suggestions */}
                {engine.turns.length === 0 && (
                  <div className="flex flex-wrap justify-center gap-1.5 pt-1">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => engine.sendText(s)}
                        className="cursor-pointer rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[0.72rem] text-cream/75 transition-colors hover:border-gold/50 hover:text-gold"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}

                {/* Text Input Form (when typing mode enabled) */}
                <AnimatePresence>
                  {typing && (
                    <motion.form
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      onSubmit={submit}
                      className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/40 p-1"
                    >
                      <input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        autoFocus
                        placeholder="e.g. Add 2 Biryani"
                        className="h-8 min-w-0 flex-1 bg-transparent px-3 text-xs placeholder:text-muted-foreground/60 focus:outline-none"
                      />
                      <button
                        type="submit"
                        aria-label="Send"
                        className="grid size-7 cursor-pointer place-items-center rounded-full bg-gold text-primary-foreground hover:opacity-90"
                      >
                        <SendHorizontal className="size-3.5" />
                      </button>
                    </motion.form>
                  )}
                </AnimatePresence>

                {/* Controls Bar */}
                <footer className="mt-1 flex items-center justify-between border-t border-white/10 pt-2.5">
                  <button
                    type="button"
                    onClick={() => setTyping((t) => !t)}
                    aria-pressed={typing}
                    aria-label="Type message"
                    className="grid size-8 cursor-pointer place-items-center rounded-full border border-white/10 text-muted-foreground transition-colors hover:border-gold/40 hover:text-foreground"
                  >
                    <Keyboard className="size-4" />
                  </button>

                  <motion.button
                    whileTap={{ scale: 0.93 }}
                    onClick={() => {
                      if (live || engine.state === "connecting") return engine.stop();
                      primeVoiceAudio();
                      engine.start();
                    }}
                    disabled={!engine.supported}
                    aria-label={live ? "Mute mic" : "Start speaking"}
                    className={cn(
                      "grid size-12 cursor-pointer place-items-center rounded-full shadow-[0_8px_20px_-4px_rgba(229,169,60,0.6)] transition-all",
                      live
                        ? "bg-cream text-espresso ring-4 ring-gold/40"
                        : "bg-gradient-to-br from-gold to-saffron text-primary-foreground hover:scale-105",
                    )}
                  >
                    {live ? <MicOff className="size-5" /> : <Mic className="size-5" />}
                  </motion.button>

                  <button
                    type="button"
                    onClick={() => useCartStore.getState().open("cart")}
                    aria-label={`Cart, ${cartCount} items`}
                    className="relative grid size-8 cursor-pointer place-items-center rounded-full border border-white/10 text-muted-foreground transition-colors hover:border-gold/40 hover:text-foreground"
                  >
                    <ShoppingBag className="size-4" />
                    {cartCount > 0 && (
                      <motion.span
                        key={cartCount}
                        initial={{ scale: 0.4 }}
                        animate={{ scale: [0.4, 1.35, 1] }}
                        transition={{ duration: 0.45 }}
                        className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-gold px-0.5 text-[0.6rem] font-bold text-primary-foreground shadow-[0_0_10px_rgb(229_169_60/0.7)]"
                      >
                        {cartCount}
                      </motion.span>
                    )}
                  </button>
                </footer>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
