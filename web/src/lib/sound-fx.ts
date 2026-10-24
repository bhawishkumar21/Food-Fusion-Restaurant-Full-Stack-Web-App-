"use client";

/**
 * Synthesized UI audio: no files to download, a few hundred bytes of code.
 *
 *   playHoverSound()  — soft 800 Hz sub-click (cards, chips, buttons)
 *   playSelectSound() — warm 1200 Hz harmonic chime (add to cart, category switch)
 *
 * Browsers only allow audio after a user gesture, so nothing plays until the
 * first click/tap/keypress "unlocks" the context. Hovers are throttled so a
 * fast sweep across the grid never turns into a buzz. Preference persists.
 */

const STORAGE_KEY = "ff-sound";
const HOVER_GAP_MS = 70;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let unlocked = false;
let lastHover = 0;
let enabled = readPref();
const listeners = new Set<() => void>();

function readPref() {
  try {
    return typeof localStorage === "undefined" || localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function audio() {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    // A gentle compressor keeps stacked chimes from clipping.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Call once on mount; unlocks audio on the first real user gesture. */
export function installAudioUnlock() {
  if (typeof window === "undefined" || unlocked) return () => {};
  const unlock = () => {
    unlocked = Boolean(audio());
    if (unlocked) remove();
  };
  const remove = () => {
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock);
  return remove;
}

/**
 * Unlock immediately (call from inside a user gesture). Also plays a
 * one-sample silent buffer: iOS only fully unlocks a context that has
 * actually started output during the gesture.
 */
export function unlockAudioNow() {
  if (typeof window === "undefined") return;
  const ac = audio();
  if (!ac) return;
  unlocked = true;
  try {
    const buffer = ac.createBuffer(1, 1, 22050);
    const src = ac.createBufferSource();
    src.buffer = buffer;
    src.connect(ac.destination);
    src.start(0);
  } catch {
    /* ignore: the resume() in audio() is what matters on most browsers */
  }
}

function tone(freq: number, { at = 0, gain = 0.05, decay = 0.3, type = "sine" as OscillatorType, glideTo = 0 } = {}) {
  const ac = ctx!;
  const t = ac.currentTime + at;
  const osc = ac.createOscillator();
  const env = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + decay);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  osc.connect(env).connect(master!);
  osc.start(t);
  osc.stop(t + decay + 0.02);
}

const ready = () => enabled && unlocked && audio() !== null;

export function playHoverSound() {
  if (!ready()) return;
  const now = performance.now();
  if (now - lastHover < HOVER_GAP_MS) return;
  lastHover = now;
  // Short sine "tick" that sags slightly in pitch: felt more than heard.
  tone(800, { gain: 0.022, decay: 0.05, glideTo: 620 });
}

export function playSelectSound() {
  if (!ready()) return;
  // Fundamental + soft octave and fifth partials, slightly staggered = warm bell.
  tone(1200, { gain: 0.05, decay: 0.55 });
  tone(2400, { gain: 0.016, decay: 0.32, at: 0.004 });
  tone(1800, { gain: 0.012, decay: 0.42, at: 0.012, type: "triangle" });
}

/** One mechanical detent click: a bright tick over a soft body thump. */
function click(at: number, gain = 1) {
  tone(2600, { at, gain: 0.03 * gain, decay: 0.018, type: "square" });
  tone(420, { at, gain: 0.04 * gain, decay: 0.04, glideTo: 260 });
}

/** Rotary dial advancing one slot. */
export function playDialTick() {
  if (!ready()) return;
  click(0);
}

/**
 * Full 360° confirmation spin: ratchet clicks accelerate then decelerate over
 * `durationMs`, then the house chime lands as the dial settles.
 */
export function playDialSpin(durationMs = 1100) {
  if (!ready()) return;
  const clicks = 22;
  const d = durationMs / 1000;
  for (let i = 0; i < clicks; i++) {
    // Ease-in-out spacing: dense in the middle of the spin, sparse at the ends.
    const u = i / (clicks - 1);
    const t = d * (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
    click(t, 0.6 + 0.4 * Math.sin(Math.PI * u));
  }
  setTimeout(playSelectSound, durationMs);
}

export function isSoundEnabled() {
  return enabled;
}

export function setSoundEnabled(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    /* private mode: preference lasts for this tab */
  }
  listeners.forEach((fn) => fn());
  if (on) playSelectSound();
}

/** For useSyncExternalStore. */
export function subscribeSound(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
