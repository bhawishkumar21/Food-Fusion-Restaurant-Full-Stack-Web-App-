"use client";

let ctx: AudioContext | null = null;

/** Must be called from a user gesture once (browser autoplay policy). */
export function unlockAudio() {
  ctx ??= new AudioContext();
  void ctx.resume();
}

/** Two-tone bell synthesised with WebAudio — no asset to load, cuts through kitchen noise. */
export function playChime() {
  if (!ctx || ctx.state !== "running") return;
  const now = ctx.currentTime;
  [880, 1318.5].forEach((freq, i) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const t = now + i * 0.18;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(t);
    osc.stop(t + 1);
  });
}
