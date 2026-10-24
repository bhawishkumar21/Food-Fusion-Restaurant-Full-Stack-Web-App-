"use client";

// Exported by the SDK for callers that `await` before `startSession` (as we
// do: fetching the signed URL). It unlocks iOS audio in the capture phase of
// the user's first tap, then hands that context to the next session.
import { installIosAudioUnlockListener } from "@elevenlabs/client/internal/unity";
import { unlockAudioNow } from "@/lib/sound-fx";

let installed = false;

/** Install once, as early as possible (before the user's first tap). */
export function installVoiceAudioUnlock() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  try {
    installIosAudioUnlockListener();
  } catch {
    /* non-iOS or SDK internals changed: the synchronous prime below still runs */
  }
}

/**
 * Call SYNCHRONOUSLY inside the click/tap that opens the voice agent, before
 * any `await`. Browsers only let audio start from inside a user gesture:
 *  • resumes our Web Audio context (UI sounds, analyser)
 *  • speaks a silent utterance, which unlocks speechSynthesis for the
 *    browser voice engine's greeting (Chrome/Safari gate the first speak())
 */
export function primeVoiceAudio() {
  unlockAudioNow();
}
