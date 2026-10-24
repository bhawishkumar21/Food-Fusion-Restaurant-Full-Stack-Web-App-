/**
 * Shared contract for the two voice back-ends behind the Voice Agent modal:
 *  • browser:     Web Speech API (recognition + speech synthesis) with a Web
 *                 Audio AnalyserNode on the microphone. Works with no keys.
 *  • elevenlabs:  ElevenLabs Conversational AI (live mode).
 * The visualizer only ever calls `sample()`, once per animation frame.
 */
export type VoiceState = "idle" | "connecting" | "listening" | "processing" | "speaking" | "error";

export interface Turn {
  id: number;
  role: "user" | "agent";
  text: string;
}

export const BAND_COUNT = 28;

export interface VoiceFrame {
  /** Overall loudness, 0..1 (mic while listening, voice while speaking). */
  level: number;
  /** Per-band energy, 0..1, low → high frequency. Length BAND_COUNT. */
  bands: Float32Array;
}

export interface VoiceEngine {
  kind: "browser" | "elevenlabs";
  state: VoiceState;
  error: string | null;
  /** What the user is saying right now (interim recognition). */
  interim: string;
  turns: Turn[];
  /** False when this browser can't do speech at all (typing still works). */
  supported: boolean;
  start: () => void;
  stop: () => void;
  sendText: (text: string) => void;
  sample: (frame: VoiceFrame) => void;
}

/**
 * Collapses an FFT magnitude array into log-spaced bands (speech energy sits
 * low, so linear bins would waste most bars on silence).
 */
export function toBands(fft: Uint8Array, out: Float32Array, minBin = 2) {
  const max = fft.length;
  const n = out.length;
  for (let i = 0; i < n; i++) {
    const a = Math.floor(minBin * Math.pow(max / minBin, i / n));
    const b = Math.max(a + 1, Math.floor(minBin * Math.pow(max / minBin, (i + 1) / n)));
    let sum = 0;
    for (let k = a; k < b && k < max; k++) sum += fft[k];
    out[i] = Math.min(1, sum / (b - a) / 200);
  }
}

export function levelOf(bands: Float32Array) {
  let s = 0;
  for (const v of bands) s += v * v;
  return Math.min(1, Math.sqrt(s / bands.length) * 1.6);
}
