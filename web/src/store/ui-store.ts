"use client";

import { create } from "zustand";
import { primeVoiceAudio } from "@/components/voice/audio-unlock";

/** Storefront chrome state that several unrelated components open/close. */
interface UiState {
  voiceOpen: boolean;
  setVoiceOpen: (open: boolean) => void;
  /**
   * Open the voice agent from a click/tap. Primes audio synchronously while
   * the browser still counts it as a user gesture, so the greeting can play.
   */
  openVoice: () => void;
}

export const useUiStore = create<UiState>()((set) => ({
  voiceOpen: false,
  setVoiceOpen: (voiceOpen) => set({ voiceOpen }),
  openVoice: () => {
    primeVoiceAudio();
    set({ voiceOpen: true });
  },
}));
