"use client";

import { useConversation, useConversationClientTool, type ClientTool } from "@elevenlabs/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type VoiceSession } from "@/lib/api";
import { useMenuStore } from "@/store/menu-store";
import { menuContext, onVoiceMessage, type AssistantTools } from "@/components/customer/assistant-tools";
import { clearVoiceLedger } from "./voice-cart-sync";
import { levelOf, toBands, type Turn, type VoiceEngine, type VoiceFrame, type VoiceState } from "./voice-engine";

const PUBLIC_AGENT_ID = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;

/** Signed URLs are short-lived; refresh a prefetched one after this. */
const SESSION_TTL_MS = 4 * 60_000;
/** Never leave the guest staring at "Connecting…". */
const CONNECT_TIMEOUT_MS = 12_000;

/**
 * ElevenLabs Conversational AI engine (live mode). Must render inside a
 * <ConversationProvider>.
 *
 * Why the greeting used to hang: we awaited the mic prompt and the signed-URL
 * fetch *before* startSession, so the SDK created its audio output outside the
 * user's tap and browsers kept it suspended. Now:
 *  • the SDK's own first-tap iOS unlock is installed (see audio-unlock.ts) and
 *    primeVoiceAudio() runs inside the tap for everyone else;
 *  • the signed session is prefetched, so startSession runs immediately;
 *  • the SDK requests the mic itself (no extra prompt / delay from us);
 *  • the server binds the Food Fusion voice via `overrides.tts.voiceId`;
 *  • a watchdog turns a stalled connection into a clear error.
 */
export function useLiveVoice(tools: AssistantTools): VoiceEngine {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const prefetched = useRef<{ at: number; session: Promise<VoiceSession> } | null>(null);
  const watchdog = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useConversationClientTool("filter_menu", tools.filter_menu as ClientTool);
  useConversationClientTool("highlight_items", tools.highlight_items as ClientTool);
  useConversationClientTool("add_to_cart", tools.add_to_cart as ClientTool);
  useConversationClientTool("add_items", tools.add_items as ClientTool);
  useConversationClientTool("remove_from_cart", tools.remove_from_cart as ClientTool);
  useConversationClientTool("view_cart", tools.view_cart as ClientTool);
  useConversationClientTool("checkout", tools.checkout as ClientTool);

  const conversation = useConversation({
    onConnect: () => clearTimeout(watchdog.current),
    onMessage: (m) => {
      setTurns((t) => [...t.slice(-6), { id: m.event_id ?? Date.now(), role: m.role, text: m.message }]);
      // User finished speaking → "processing" until the agent starts talking.
      setThinking(m.role === "user");

      // Keep the cart and the on-screen focus in step with what was said.
      if (m.message) {
        onVoiceMessage(m.role, m.message, (note) => {
          if (convRef.current.status === "connected") convRef.current.sendContextualUpdate(note);
        });
      }
    },
    onModeChange: ({ mode }) => mode === "speaking" && setThinking(false),
    onError: (message) => {
      clearTimeout(watchdog.current);
      setError(String(message));
    },
  });

  const state: VoiceState =
    error && conversation.status !== "connected"
      ? "error"
      : conversation.status === "connecting"
        ? "connecting"
        : conversation.status !== "connected"
          ? "idle"
          : conversation.isSpeaking
            ? "speaking"
            : thinking
              ? "processing"
              : "listening";

  /** Fetch (or reuse) a signed session so a tap can start talking at once. */
  const session = useCallback(() => {
    const cached = prefetched.current;
    if (cached && Date.now() - cached.at < SESSION_TTL_MS) return cached.session;
    const fresh = !PUBLIC_AGENT_ID
      ? Promise.reject(new Error("NEXT_PUBLIC_ELEVENLABS_AGENT_ID is not configured"))
      : api.voice.signedUrl().then((signed) => ({
          ...signed,
          dynamicVariables: { restaurant_name: "Food Fusion" },
        }));
    prefetched.current = { at: Date.now(), session: fresh };
    fresh.catch(() => (prefetched.current = null));
    return fresh;
  }, []);

  useEffect(() => {
    void session().catch(() => undefined); // warm the cache on mount
  }, [session]);

  // Stock changes mid-call are pushed to the agent as context.
  useEffect(() => {
    if (conversation.status !== "connected") return;
    return useMenuStore.subscribe((s, prev) => {
      for (const item of s.items) {
        const before = prev.items.find((p) => p.id === item.id);
        if (before && before.isAvailable !== item.isAvailable) {
          conversation.sendContextualUpdate(
            `${item.name} (${item.id}) is now ${item.isAvailable ? "AVAILABLE again" : "SOLD OUT — do not offer it"}.`,
          );
        }
      }
    });
  }, [conversation]);

  const convRef = useRef(conversation);
  useEffect(() => {
    convRef.current = conversation;
  }, [conversation]);

  const start = useCallback(async () => {
    setError(null);
    clearVoiceLedger(); // a new conversation starts with no recent adds
    try {
      const sess = await session().catch(() => null);
      prefetched.current = null; // signed URLs are single-use
      clearTimeout(watchdog.current);
      watchdog.current = setTimeout(() => {
        if (convRef.current.status !== "connected") {
          convRef.current.endSession();
          setError("The voice host didn't answer. Check your connection and tap the mic to try again.");
        }
      }, CONNECT_TIMEOUT_MS);

      const items = useMenuStore.getState().items;
      const agentId = PUBLIC_AGENT_ID || "agent_5801m4by5dwzeg695dpmy5ehtwpa";

      if (sess?.signedUrl) {
        conversation.startSession({
          signedUrl: sess.signedUrl,
          connectionType: "websocket",
          overrides: sess.overrides,
          dynamicVariables: { ...sess.dynamicVariables, menu: menuContext(items) },
        });
      } else {
        conversation.startSession({
          agentId,
          connectionType: "websocket",
          dynamicVariables: {
            restaurant_name: "Food Fusion",
            menu: menuContext(items),
          },
        });
      }
    } catch (e) {
      setError(e instanceof Error && e.name === "NotAllowedError" ? "Microphone access was blocked." : "Couldn't reach the voice host.");
    }
  }, [conversation, session]);

  const stop = useCallback(() => {
    clearTimeout(watchdog.current);
    if (convRef.current.status === "connected" || convRef.current.status === "connecting") convRef.current.endSession();
    void session().catch(() => undefined); // ready for the next tap
  }, [session]);

  useEffect(() => () => clearTimeout(watchdog.current), []);

  const sample = useCallback((frame: VoiceFrame) => {
    const c = convRef.current;
    if (c.status !== "connected") {
      frame.bands.fill(0);
      frame.level = 0;
      return;
    }
    toBands(c.isSpeaking ? c.getOutputByteFrequencyData() : c.getInputByteFrequencyData(), frame.bands);
    frame.level = levelOf(frame.bands);
  }, []);

  return {
    kind: "elevenlabs",
    state,
    error,
    interim: "",
    turns,
    supported: true,
    start: () => void start(),
    stop,
    sendText: (text) => {
      setTurns((t) => [...t.slice(-6), { id: Date.now(), role: "user", text }]);
      if (conversation.status === "connected") conversation.sendUserMessage(text);
      else setError("Start the conversation first.");
    },
    sample,
  };
}
