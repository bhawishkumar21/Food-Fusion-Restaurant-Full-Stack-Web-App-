/**
 * Procedural Canvas 2D renderer for the Signature Karahi assembly.
 *
 * Everything is drawn from code (no image assets): a clay karahi, marinated
 * meat, tomato halves, green chilies, ginger juliennes, cilantro and ghee
 * droplets. Ingredient sprites are pre-rendered once per size into offscreen
 * canvases, so a frame is ~45 drawImage calls plus the pot: comfortably 60fps.
 *
 * progress 0    → ingredients float, deconstructed, around a tilted pot
 * progress 0.5  → pieces drop in one by one (overshoot + settle = "snap")
 * progress 1    → cooked: gravy, glossy meat, garnish, rising steam
 *
 * All geometry is expressed in units of R (the pot radius) so the scene
 * scales cleanly from a phone card to a 4K hero.
 */

type Kind = "meat" | "tomato" | "chili" | "ginger" | "cilantro" | "ghee";

interface Piece {
  kind: Kind;
  /** Floating position, relative to the scene centre, in R units; z = depth. */
  start: { x: number; y: number; z: number; rot: number };
  /** Resting place inside the pot, in pot space (R units). */
  target: { x: number; y: number; rot: number };
  delay: number;
  spin: number;
  phase: number;
  variant: number;
}

interface Steam {
  x: number;
  y: number;
  age: number;
  life: number;
  size: number;
  seed: number;
}

export type RenderMode = "scroll" | "card";

const COUNTS: Record<Kind, number> = { ghee: 8, tomato: 4, meat: 9, ginger: 9, chili: 5, cilantro: 5 };
/** Sprite size, in R. */
const SIZE: Record<Kind, number> = { meat: 0.36, tomato: 0.3, chili: 0.48, ginger: 0.32, cilantro: 0.3, ghee: 0.11 };
/** When each kind lands (progress), following the real cooking order. */
const WINDOW: Record<Kind, [number, number]> = {
  ghee: [0.16, 0.28],
  tomato: [0.24, 0.38],
  meat: [0.3, 0.5],
  ginger: [0.44, 0.58],
  chili: [0.5, 0.62],
  cilantro: [0.58, 0.7],
};
const FLIGHT = 0.16;
/** Draw order for settled pieces (back → front). */
const LAYER: Kind[] = ["ghee", "tomato", "meat", "chili", "ginger", "cilantro"];
const VARIANTS = 3;
/**
 * Depth of field: each sprite is pre-blurred at a few levels (CSS px) so a
 * frame never pays for a live filter. Pieces far from the focal plane (z = 1)
 * pick a blurrier copy; they sharpen as they fly into the pot.
 */
const BLUR_LEVELS = [0, 1.6, 3.4, 5.6];
const FOCAL_Z = 1;

// ───────────────────────────────────────────────────────────── helpers ──

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** Overshoots then settles: the "snap" when a piece lands. */
const easeOutBack = (t: number, s = 1.5) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Ctx = CanvasRenderingContext2D;

/**
 * Sprite canvases are painted once and reused, so they are pinned to CPU
 * memory (willReadFrequently). GPU-backed canvases can be evicted under
 * memory pressure or when a tab is backgrounded; a lost sprite would come
 * back blank while the per-frame main canvas recovers on its own.
 */
function makeCanvas(px: number) {
  const c = document.createElement("canvas");
  c.width = c.height = Math.max(2, Math.ceil(px));
  c.getContext("2d", { willReadFrequently: true });
  return c;
}

/** Closed smooth blob through jittered polar points. */
function blob(ctx: Ctx, cx: number, cy: number, r: number, rand: () => number, points = 9, jitter = 0.28, squash = 0.78) {
  const pts = Array.from({ length: points }, (_, i) => {
    const a = (i / points) * Math.PI * 2;
    const rr = r * (1 - jitter / 2 + rand() * jitter);
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * squash] as const;
  });
  ctx.beginPath();
  const mid = (i: number) => {
    const a = pts[i % points];
    const b = pts[(i + 1) % points];
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as const;
  };
  const m0 = mid(points - 1);
  ctx.moveTo(m0[0], m0[1]);
  for (let i = 0; i < points; i++) {
    const m = mid(i);
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
  }
  ctx.closePath();
}

// ───────────────────────────────────────────────────── sprite painters ──

function paintMeat(ctx: Ctx, s: number, rand: () => number, cooked: boolean) {
  const c = s / 2;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = s * 0.06;
  ctx.shadowOffsetY = s * 0.03;
  blob(ctx, c, c, s * 0.38, rand);
  const g = ctx.createRadialGradient(c - s * 0.1, c - s * 0.1, s * 0.04, c, c, s * 0.42);
  if (cooked) {
    g.addColorStop(0, "#a2471f");
    g.addColorStop(0.55, "#6e2a10");
    g.addColorStop(1, "#3a1306");
  } else {
    g.addColorStop(0, "#d4664b");
    g.addColorStop(0.6, "#a8402c");
    g.addColorStop(1, "#6c241a");
  }
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.clip();
  // Fat marbling on raw meat; char on cooked.
  ctx.lineCap = "round";
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    const y = c + (rand() - 0.5) * s * 0.4;
    ctx.moveTo(c - s * 0.3, y);
    ctx.quadraticCurveTo(c, y + (rand() - 0.5) * s * 0.25, c + s * 0.3, y + (rand() - 0.5) * s * 0.15);
    ctx.strokeStyle = cooked ? "rgba(30,8,2,0.45)" : "rgba(244,206,190,0.45)";
    ctx.lineWidth = s * (cooked ? 0.02 : 0.014);
    ctx.stroke();
  }
  // Masala / spice specks.
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = cooked
      ? `rgba(${rand() > 0.5 ? "40,10,2" : "190,90,30"},${0.35 + rand() * 0.4})`
      : `rgba(${rand() > 0.5 ? "217,130,43" : "150,40,20"},${0.45 + rand() * 0.4})`;
    ctx.beginPath();
    ctx.arc(c + (rand() - 0.5) * s * 0.7, c + (rand() - 0.5) * s * 0.55, s * (0.008 + rand() * 0.012), 0, Math.PI * 2);
    ctx.fill();
  }
  // Specular sheen: much stronger once glazed in ghee.
  const sheen = ctx.createRadialGradient(c - s * 0.12, c - s * 0.12, 0, c - s * 0.12, c - s * 0.12, s * 0.22);
  sheen.addColorStop(0, `rgba(255,236,210,${cooked ? 0.45 : 0.22})`);
  sheen.addColorStop(1, "rgba(255,236,210,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, s, s);
  ctx.restore();
}

function paintTomato(ctx: Ctx, s: number, rand: () => number) {
  const c = s / 2;
  const r = s * 0.42;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = s * 0.06;
  ctx.shadowOffsetY = s * 0.03;
  const skin = ctx.createRadialGradient(c, c, r * 0.7, c, c, r);
  skin.addColorStop(0, "#d63a26");
  skin.addColorStop(1, "#8f1a10");
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "#ec5a3e";
  ctx.beginPath();
  ctx.arc(c, c, r * 0.86, 0, Math.PI * 2);
  ctx.fill();
  // Seed chambers.
  const chambers = 4;
  for (let i = 0; i < chambers; i++) {
    const a = (i / chambers) * Math.PI * 2 + rand() * 0.3;
    const x = c + Math.cos(a) * r * 0.45;
    const y = c + Math.sin(a) * r * 0.45;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = "#f58a68";
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.3, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f4d58e";
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.ellipse((k - 1.5) * r * 0.1, (rand() - 0.5) * r * 0.08, r * 0.035, r * 0.022, rand(), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.fillStyle = "#f8b39b";
  ctx.beginPath();
  ctx.arc(c, c, r * 0.16, 0, Math.PI * 2);
  ctx.fill();
  const hi = ctx.createRadialGradient(c - r * 0.4, c - r * 0.45, 0, c - r * 0.4, c - r * 0.45, r * 0.5);
  hi.addColorStop(0, "rgba(255,255,255,0.35)");
  hi.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = hi;
  ctx.fillRect(0, 0, s, s);
}

function paintChili(ctx: Ctx, s: number, rand: () => number) {
  const p0 = { x: s * 0.12, y: s * 0.52 };
  const p1 = { x: s * 0.5, y: s * (0.72 + rand() * 0.12) };
  const p2 = { x: s * 0.9, y: s * 0.36 };
  const at = (t: number) => ({
    x: (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x,
    y: (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y,
  });
  const N = 24;
  const left: { x: number; y: number }[] = [];
  const right: { x: number; y: number }[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = at(t);
    const q = at(Math.min(1, t + 0.01));
    const dx = q.x - p.x || 0.001;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy);
    const w = s * 0.055 * (1 - t * 0.85) * (t < 0.06 ? t / 0.06 : 1) + s * 0.004;
    left.push({ x: p.x - (dy / len) * w, y: p.y + (dx / len) * w });
    right.push({ x: p.x + (dy / len) * w, y: p.y - (dx / len) * w });
  }
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = s * 0.04;
  ctx.shadowOffsetY = s * 0.02;
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  left.forEach((p) => ctx.lineTo(p.x, p.y));
  right.reverse().forEach((p) => ctx.lineTo(p.x, p.y));
  ctx.closePath();
  const g = ctx.createLinearGradient(0, s * 0.35, 0, s * 0.8);
  g.addColorStop(0, "#62b23a");
  g.addColorStop(1, "#22601a");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
  // Highlight ridge.
  ctx.beginPath();
  for (let i = 2; i <= N - 4; i++) {
    const p = at(i / N);
    if (i === 2) ctx.moveTo(p.x, p.y - s * 0.02);
    else ctx.lineTo(p.x, p.y - s * 0.02 * (1 - i / N));
  }
  ctx.strokeStyle = "rgba(220,255,190,0.4)";
  ctx.lineWidth = s * 0.01;
  ctx.lineCap = "round";
  ctx.stroke();
  // Stem.
  ctx.strokeStyle = "#6f7d2c";
  ctx.lineWidth = s * 0.025;
  ctx.beginPath();
  ctx.moveTo(p0.x + s * 0.01, p0.y);
  ctx.quadraticCurveTo(p0.x - s * 0.05, p0.y - s * 0.02, p0.x - s * 0.07, p0.y - s * 0.08);
  ctx.stroke();
}

function paintGinger(ctx: Ctx, s: number, rand: () => number) {
  const w = s * (0.62 + rand() * 0.2);
  const h = s * 0.06;
  ctx.save();
  ctx.translate(s / 2, s / 2);
  ctx.rotate((rand() - 0.5) * 0.2);
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = s * 0.03;
  const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
  g.addColorStop(0, "#f4dba0");
  g.addColorStop(1, "#c99a4f");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, h / 2);
  ctx.fill();
  ctx.restore();
}

function paintCilantro(ctx: Ctx, s: number, rand: () => number) {
  const c = s / 2;
  ctx.strokeStyle = "#5c9238";
  ctx.lineWidth = s * 0.018;
  ctx.lineCap = "round";
  const leaves = 3;
  for (let i = 0; i < leaves; i++) {
    const a = -Math.PI / 2 + (i - 1) * 0.9 + (rand() - 0.5) * 0.3;
    const lx = c + Math.cos(a) * s * 0.24;
    const ly = c + s * 0.12 + Math.sin(a) * s * 0.24;
    ctx.beginPath();
    ctx.moveTo(c, c + s * 0.3);
    ctx.quadraticCurveTo(c, c + s * 0.12, lx, ly);
    ctx.stroke();
    // Scalloped leaf: overlapping lobes.
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(a + Math.PI / 2);
    const lobes = 3;
    for (let k = 0; k < lobes; k++) {
      const la = (k - 1) * 0.75;
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.12);
      g.addColorStop(0, "#58b04a");
      g.addColorStop(1, "#2a7228");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(Math.sin(la) * s * 0.06, -Math.cos(la) * s * 0.05, s * 0.07, s * 0.06, la, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(200,255,180,0.35)";
    ctx.lineWidth = s * 0.008;
    ctx.beginPath();
    ctx.moveTo(0, s * 0.02);
    ctx.lineTo(0, -s * 0.1);
    ctx.stroke();
    ctx.restore();
  }
}

function paintGhee(ctx: Ctx, s: number) {
  const c = s / 2;
  const r = s * 0.4;
  const g = ctx.createRadialGradient(c - r * 0.35, c - r * 0.35, r * 0.05, c, c, r);
  g.addColorStop(0, "#fff2c2");
  g.addColorStop(0.35, "#f2c25a");
  g.addColorStop(0.85, "#c9831f");
  g.addColorStop(1, "rgba(160,95,20,0.6)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.ellipse(c - r * 0.35, c - r * 0.38, r * 0.18, r * 0.11, -0.6, 0, Math.PI * 2);
  ctx.fill();
}

// ──────────────────────────────────────────────────────────── renderer ──

export class KarahiRenderer {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private R = 100;
  private pieces: Piece[] = [];
  private sprites = new Map<string, HTMLCanvasElement>();
  private steamSprite: HTMLCanvasElement | null = null;
  /** Canvas filters are missing in some engines; depth blur is skipped there. */
  private canBlur = false;
  private steam: Steam[] = [];
  private steamClock = 0;
  private lastTime = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private mode: RenderMode,
  ) {
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Canvas 2D not supported");
    this.ctx = ctx;
    this.pieces = this.layoutPieces();
    const probe = makeCanvas(2).getContext("2d")!;
    probe.filter = "blur(1px)";
    this.canBlur = probe.filter === "blur(1px)";
  }

  resize(width: number, height: number) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = width;
    this.h = height;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.R =
      this.mode === "card"
        ? Math.min(width, height) * 0.36
        : Math.min(width * (width < 1024 ? 0.26 : 0.19), height * 0.27);
    this.buildSprites();
  }

  /** Deterministic scatter + resting places so every visit looks the same. */
  private layoutPieces(): Piece[] {
    const rand = rng(1729);
    const pieces: Piece[] = [];
    for (const kind of LAYER) {
      const [a, b] = WINDOW[kind];
      for (let i = 0; i < COUNTS[kind]; i++) {
        let x = 0;
        let y = 0;
        // Float around the pot, never in front of it.
        for (let tries = 0; tries < 60; tries++) {
          x = (rand() * 2 - 1) * 2.7;
          y = -1.55 + rand() * 2.0;
          const behindPot = Math.abs(x) < 1.35 && y > -1.15;
          const overHeroCopy = x < -0.7 && y > 0.2;
          if (!behindPot && !overHeroCopy) break;
        }
        // Rest inside the opening ellipse; garnish sits nearer the top.
        let tx = 0;
        let ty = 0;
        do {
          tx = (rand() * 2 - 1) * 0.78;
          ty = (rand() * 2 - 1) * 0.2;
        } while ((tx / 0.78) ** 2 + (ty / 0.2) ** 2 > 1);
        pieces.push({
          kind,
          start: { x, y, z: 0.6 + rand() * 0.8, rot: rand() * Math.PI * 2 },
          target: { x: tx, y: ty + (kind === "cilantro" ? -0.03 : 0), rot: (rand() - 0.5) * Math.PI },
          delay: a + (b - a) * (i / Math.max(1, COUNTS[kind] - 1)) - FLIGHT / 2,
          spin: (rand() - 0.5) * 0.9,
          phase: rand() * Math.PI * 2,
          variant: i % VARIANTS,
        });
      }
    }
    return pieces;
  }

  private buildSprites() {
    this.sprites.clear();
    for (const kind of Object.keys(SIZE) as Kind[]) {
      const px = SIZE[kind] * this.R * this.dpr * 1.4; // headroom for floating scale
      for (let v = 0; v < VARIANTS; v++) {
        const variants: [string, (c: Ctx, s: number) => void][] =
          kind === "meat"
            ? [
                [`meat-raw-${v}`, (c, s) => paintMeat(c, s, rng(100 + v), false)],
                [`meat-cooked-${v}`, (c, s) => paintMeat(c, s, rng(100 + v), true)],
              ]
            : [
                [
                  `${kind}-${v}`,
                  (c, s) => {
                    const r = rng(200 + v * 7 + kind.length);
                    if (kind === "tomato") paintTomato(c, s, r);
                    else if (kind === "chili") paintChili(c, s, r);
                    else if (kind === "ginger") paintGinger(c, s, r);
                    else if (kind === "cilantro") paintCilantro(c, s, r);
                    else paintGhee(c, s);
                  },
                ],
              ];
        for (const [key, paint] of variants) {
          const canvas = makeCanvas(px);
          paint(canvas.getContext("2d")!, canvas.width);
          this.sprites.set(key, canvas);
          if (!this.canBlur) continue;
          BLUR_LEVELS.forEach((amount, level) => {
            if (!level) return;
            const blurred = makeCanvas(px);
            const bc = blurred.getContext("2d")!;
            bc.filter = `blur(${amount * this.dpr}px)`;
            bc.drawImage(canvas, 0, 0);
            this.sprites.set(`${key}@${level}`, blurred);
          });
        }
      }
    }
    const steam = makeCanvas(128);
    const sc = steam.getContext("2d")!;
    const g = sc.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,248,240,0.9)");
    g.addColorStop(0.5, "rgba(255,248,240,0.35)");
    g.addColorStop(1, "rgba(255,248,240,0)");
    sc.fillStyle = g;
    sc.fillRect(0, 0, 128, 128);
    this.steamSprite = steam;
  }

  /**
   * @param progress 0..1 scroll progress (ignored in card mode)
   * @param time     seconds, for floating/steam
   * @param pointer  -1..1 cursor position for parallax
   */
  render(progress: number, time: number, pointer = { x: 0, y: 0 }) {
    const { ctx, R, w, h } = this;
    const p = this.mode === "card" ? 1 : clamp01(progress);
    const dt = this.lastTime ? Math.min(0.05, time - this.lastTime) : 0.016;
    this.lastTime = time;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Scene centre and pot placement.
    const sceneX = w / 2;
    const sceneY = this.mode === "card" ? h * 0.56 : h * 0.58;
    const settle = easeOutCubic(clamp01(p / 0.26));
    const slide = this.mode === "scroll" && w >= 1024 ? easeInOutCubic(clamp01((p - 0.78) / 0.2)) : 0;
    const bob = (1 - settle) * Math.sin(time * 0.9) * 0.05 * R;
    // Landing impulses make the pot dip slightly each time a piece snaps in.
    let impulse = 0;
    for (const piece of this.pieces) {
      const t = clamp01((p - piece.delay) / FLIGHT);
      if (t > 0.82 && t < 1) impulse += Math.sin(((t - 0.82) / 0.18) * Math.PI);
    }
    const pot = {
      x: lerp(sceneX, w * 0.68, slide) + pointer.x * 10 * (1 - settle),
      y: sceneY + lerp(0.3 * R, 0, settle) + bob + Math.min(impulse, 3) * 0.012 * R,
      scale: lerp(0.82, 1, settle),
      rot: lerp(-0.14, 0, settle),
    };
    const toScreen = (x: number, y: number) => {
      const c = Math.cos(pot.rot);
      const s = Math.sin(pot.rot);
      const px = x * R * pot.scale;
      const py = y * R * pot.scale;
      return { x: pot.x + px * c - py * s, y: pot.y + px * s + py * c };
    };

    const cook = smooth(0.66, 0.94, p);

    // Soft spotlight pool + contact shadow.
    const pool = ctx.createRadialGradient(pot.x, pot.y, R * 0.2, pot.x, pot.y, R * 2.4);
    pool.addColorStop(0, `rgba(229,169,60,${0.07 + cook * 0.06})`);
    pool.addColorStop(1, "rgba(229,169,60,0)");
    ctx.fillStyle = pool;
    ctx.fillRect(0, 0, w, h);
    const shadow = ctx.createRadialGradient(pot.x, pot.y + R * 0.95 * pot.scale, 0, pot.x, pot.y + R * 0.95 * pot.scale, R * 1.3);
    shadow.addColorStop(0, `rgba(0,0,0,${0.4 * settle})`);
    shadow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.translate(pot.x, pot.y + R * 0.95 * pot.scale);
    ctx.scale(1, 0.18);
    ctx.translate(-pot.x, -(pot.y + R * 0.95 * pot.scale));
    ctx.fillStyle = shadow;
    ctx.fillRect(pot.x - R * 1.5, pot.y - R * 0.6, R * 3, R * 3.2);
    ctx.restore();

    // Hearth fire under the pot: drawn before the pot so the bowl occludes the flame tops.
    // Fire ignites as the pot settles onto the hearth.
    this.drawHearth(pot, time, smooth(0.1, 0.3, p) * lerp(0.75, 1, cook));

    // Steam (drawn first so the pot occludes its base: it rises from behind the rim).
    this.updateSteam(dt, smooth(0.55, 1, p), time);
    this.drawSteam(toScreen, pot.scale);

    // Floating pieces that are behind the pot (deeper z) draw before it.
    const flying = this.pieces
      .map((piece) => ({ piece, t: clamp01((p - piece.delay) / FLIGHT) }))
      .filter((f) => f.t < 1);
    const drawFlying = (behind: boolean) => {
      for (const { piece, t } of flying) {
        if (piece.start.z < 1 !== behind) continue;
        this.drawFlyingPiece(piece, t, time, pointer, sceneX, sceneY, toScreen, pot.scale, cook);
      }
    };
    drawFlying(true);

    // Pot, back to front.
    ctx.save();
    ctx.translate(pot.x, pot.y);
    ctx.rotate(pot.rot);
    ctx.scale(pot.scale * R, pot.scale * R);
    this.drawPotBody();
    this.drawInterior();
    // Settled contents, clipped to the opening.
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.9, 0.27, 0, 0, Math.PI * 2);
    ctx.clip();
    this.drawSettled(p, cook, time);
    ctx.restore();
    this.drawRimLip();
    this.drawHandles();
    ctx.restore();

    drawFlying(false);
  }

  // ── pot geometry (unit space: R = 1, rim centre at origin) ──

  private drawPotBody() {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(-1, 0);
    ctx.bezierCurveTo(-0.97, 0.52, -0.5, 0.82, 0, 0.82);
    ctx.bezierCurveTo(0.5, 0.82, 0.97, 0.52, 1, 0);
    ctx.ellipse(0, 0, 1, 0.32, 0, 0, Math.PI, false);
    ctx.closePath();
    const body = ctx.createLinearGradient(-1, 0, 1, 0.6);
    body.addColorStop(0, "#5c2a15");
    body.addColorStop(0.35, "#a65a32");
    body.addColorStop(0.55, "#8e4826");
    body.addColorStop(1, "#3e1a0b");
    ctx.fillStyle = body;
    ctx.fill();
    // Terracotta texture: faint horizontal throwing rings.
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = "rgba(255,210,170,0.06)";
    ctx.lineWidth = 0.012;
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.ellipse(0, 0.12 + i * 0.09, 0.98 - i * 0.07, 0.3 - i * 0.02, 0, 0.1, Math.PI - 0.1);
      ctx.stroke();
    }
    const glow = ctx.createRadialGradient(-0.35, 0.25, 0, -0.35, 0.25, 0.7);
    glow.addColorStop(0, "rgba(255,190,130,0.22)");
    glow.addColorStop(1, "rgba(255,190,130,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(-1, 0, 2, 1);
    ctx.restore();
  }

  private drawInterior() {
    const { ctx } = this;
    ctx.beginPath();
    ctx.ellipse(0, 0, 1, 0.32, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#b8693e";
    ctx.fill();
    const inside = ctx.createRadialGradient(0, 0.08, 0.05, 0, 0, 0.92);
    inside.addColorStop(0, "#2c140a");
    inside.addColorStop(0.7, "#1c0c05");
    inside.addColorStop(1, "#3a1a0c");
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.9, 0.27, 0, 0, Math.PI * 2);
    ctx.fillStyle = inside;
    ctx.fill();
  }

  private drawRimLip() {
    const { ctx } = this;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.95, 0.295, 0, Math.PI * 1.05, Math.PI * 1.95);
    ctx.strokeStyle = "rgba(255,214,170,0.28)";
    ctx.lineWidth = 0.025;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.95, 0.295, 0, Math.PI * 0.08, Math.PI * 0.92);
    ctx.strokeStyle = "rgba(255,214,170,0.14)";
    ctx.lineWidth = 0.02;
    ctx.stroke();
  }

  private drawHandles() {
    const { ctx } = this;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * 1.06, 0.06, 0.13, 0.09, 0, side < 0 ? Math.PI * 0.45 : -Math.PI * 0.55, side < 0 ? Math.PI * 1.55 : Math.PI * 0.55);
      ctx.strokeStyle = "#6e3519";
      ctx.lineWidth = 0.055;
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,200,150,0.25)";
      ctx.lineWidth = 0.015;
      ctx.stroke();
    }
  }

  private sprite(piece: Piece, cooked: boolean, blur = 0) {
    const key = piece.kind === "meat" ? `meat-${cooked ? "cooked" : "raw"}-${piece.variant}` : `${piece.kind}-${piece.variant}`;
    return (blur && this.sprites.get(`${key}@${blur}`)) || this.sprites.get(key)!;
  }

  /** Draws a sprite centred at (x, y) with size in the current transform's units. */
  private blit(img: HTMLCanvasElement, x: number, y: number, size: number, rot: number, alpha = 1, flipX = 1) {
    const { ctx } = this;
    if (alpha <= 0.002) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(flipX, 1);
    const s = size * 1.4;
    ctx.drawImage(img, -s / 2, -s / 2, s, s);
    ctx.restore();
  }

  private drawSettled(p: number, cook: number, time: number) {
    const { ctx } = this;
    const settled = this.pieces.filter((piece) => p >= piece.delay + FLIGHT);
    const byKind = (k: Kind) => settled.filter((s) => s.kind === k).sort((a, b) => a.target.y - b.target.y);

    // Ghee pools at the bottom first.
    for (const g of byKind("ghee")) this.blit(this.sprite(g, false), g.target.x, g.target.y, SIZE.ghee * 1.3, 0, 0.9 * (1 - cook));
    // Tomatoes melt into the masala as it cooks.
    for (const t of byKind("tomato")) this.blit(this.sprite(t, false), t.target.x, t.target.y, SIZE.tomato * 0.85, t.target.rot, 1 - cook * 0.92);
    // Gravy rises.
    if (cook > 0) {
      const gravy = ctx.createRadialGradient(-0.2, -0.05, 0.05, 0, 0, 0.95);
      gravy.addColorStop(0, `rgba(196,74,26,${0.95 * cook})`);
      gravy.addColorStop(0.6, `rgba(140,40,12,${0.95 * cook})`);
      gravy.addColorStop(1, `rgba(70,18,6,${0.95 * cook})`);
      ctx.fillStyle = gravy;
      ctx.beginPath();
      ctx.ellipse(0, 0.01, 0.9, 0.27, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Meat: raw sprite crossfades to glazed, cooked sprite.
    for (const m of byKind("meat")) {
      this.blit(this.sprite(m, false), m.target.x, m.target.y, SIZE.meat * 0.85, m.target.rot, 1 - cook);
      this.blit(this.sprite(m, true), m.target.x, m.target.y, SIZE.meat * 0.85, m.target.rot, cook);
    }
    for (const kind of ["chili", "ginger", "cilantro"] as Kind[]) {
      for (const g of byKind(kind)) this.blit(this.sprite(g, false), g.target.x, g.target.y, SIZE[kind] * 0.85, g.target.rot);
    }
    // Ghee sheen glistening on the surface once cooked.
    if (cook > 0.2) {
      for (const g of byKind("ghee")) {
        const twinkle = 0.55 + 0.45 * Math.sin(time * 2.2 + g.phase);
        ctx.fillStyle = `rgba(255,214,120,${0.35 * cook * twinkle})`;
        ctx.beginPath();
        ctx.ellipse(g.target.x, g.target.y, 0.05, 0.016, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawFlyingPiece(
    piece: Piece,
    t: number,
    time: number,
    pointer: { x: number; y: number },
    sceneX: number,
    sceneY: number,
    toScreen: (x: number, y: number) => { x: number; y: number },
    potScale: number,
    cook: number,
  ) {
    const { R } = this;
    const { start } = piece;
    const e = easeOutBack(t);
    const float = 1 - easeOutCubic(t);
    // Floating: gentle bob, slow tumble, depth parallax with the cursor.
    const bobY = Math.sin(time * 0.8 + piece.phase) * 0.07 * R * start.z * float;
    const par = { x: pointer.x * 26 * start.z * float, y: pointer.y * 18 * start.z * float };
    const sx = sceneX + start.x * R + par.x;
    const sy = sceneY + start.y * R + bobY + par.y;
    const target = toScreen(piece.target.x, piece.target.y);
    // Arc upward before dropping in.
    const lift = Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.45 * R;
    const x = lerp(sx, target.x, Math.min(1, e));
    const y = lerp(sy, target.y, e) - lift;
    const rot = lerp(start.rot + time * piece.spin, piece.target.rot, easeOutCubic(t));
    // Faux 3D tumble: squash on one axis while floating.
    const flip = lerp(0.55 + 0.45 * Math.abs(Math.cos(time * 0.7 * (piece.spin + 0.6) + piece.phase)), 1, easeOutCubic(t));
    const size = SIZE[piece.kind] * R * lerp(start.z, 0.85 * potScale, easeOutCubic(t));
    // Z-distance blur, fading out as the piece lands in focus.
    const defocus = (Math.abs(start.z - FOCAL_Z) / 0.4) * (1 - easeOutCubic(t));
    const img = this.sprite(piece, false, Math.min(BLUR_LEVELS.length - 1, Math.round(defocus * 1.6)));
    this.ctx.save();
    // Depth of field: far pieces are dimmer.
    const alpha = lerp(0.55 + start.z * 0.32, 1, t) * (piece.kind === "tomato" ? 1 - cook * 0.92 : 1);
    this.blit(img, x, y, size, rot, Math.min(1, alpha), flip);
    this.ctx.restore();
  }

  /** Flickering amber glow plus a row of flame tongues licking the bowl. */
  private drawHearth(pot: { x: number; y: number; scale: number }, time: number, intensity: number) {
    const { ctx } = this;
    const R = this.R * pot.scale;
    const baseY = pot.y + 0.86 * R;
    // Layered sines read as organic flicker without noise textures.
    const flick = (k: number) => 0.78 + 0.12 * Math.sin(time * 7.3 + k) + 0.07 * Math.sin(time * 13.1 + k * 2.1) + 0.04 * Math.sin(time * 23.7 + k * 3.7);

    if (intensity <= 0.01) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // Wide warm bloom on the "floor" and the pot underside.
    ctx.save();
    ctx.translate(pot.x, baseY);
    ctx.scale(1, 0.32);
    const bloom = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 1.7);
    bloom.addColorStop(0, `rgba(255,150,50,${0.5 * intensity * flick(0)})`);
    bloom.addColorStop(0.35, `rgba(217,90,20,${0.26 * intensity * flick(1)})`);
    bloom.addColorStop(1, "rgba(120,30,0,0)");
    ctx.fillStyle = bloom;
    ctx.fillRect(-R * 1.8, -R * 1.8, R * 3.6, R * 3.6);
    ctx.restore();

    // Flame tongues.
    const tongues = 9;
    for (let i = 0; i < tongues; i++) {
      const u = i / (tongues - 1) - 0.5;
      const x = pot.x + u * 1.15 * R;
      const hgt = R * (0.42 - Math.abs(u) * 0.38) * flick(i * 1.7) * intensity;
      const wid = R * 0.11 * (1 - Math.abs(u) * 0.6);
      const sway = Math.sin(time * 4.1 + i) * wid * 0.45;
      // Feathered base (no hard edge), white-hot core, fading orange tip.
      const g = ctx.createLinearGradient(0, baseY + R * 0.1, 0, baseY - hgt);
      g.addColorStop(0, "rgba(255,200,120,0)");
      g.addColorStop(0.18, `rgba(255,236,170,${0.6 * intensity})`);
      g.addColorStop(0.5, `rgba(255,140,40,${0.42 * intensity})`);
      g.addColorStop(1, "rgba(200,40,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x - wid, baseY);
      ctx.bezierCurveTo(x - wid, baseY - hgt * 0.45, x + sway - wid * 0.2, baseY - hgt * 0.7, x + sway, baseY - hgt);
      ctx.bezierCurveTo(x + sway + wid * 0.2, baseY - hgt * 0.7, x + wid, baseY - hgt * 0.45, x + wid, baseY);
      // Rounded, teardrop base instead of a flat cut.
      ctx.quadraticCurveTo(x, baseY + wid * 1.4, x - wid, baseY);
      ctx.closePath();
      ctx.fill();
    }

    // Glowing coal bed.
    ctx.translate(pot.x, baseY + R * 0.1);
    ctx.scale(1, 0.18);
    const coals = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.75);
    coals.addColorStop(0, `rgba(255,120,40,${0.55 * intensity * flick(4)})`);
    coals.addColorStop(1, "rgba(150,30,0,0)");
    ctx.fillStyle = coals;
    ctx.fillRect(-R, -R, R * 2, R * 2);
    ctx.restore();
  }

  private updateSteam(dt: number, intensity: number, time: number) {
    if (intensity <= 0) {
      this.steam.length = 0;
      return;
    }
    this.steamClock += dt * intensity * 16;
    while (this.steamClock > 1) {
      this.steamClock -= 1;
      const seed = Math.random();
      this.steam.push({ x: (Math.random() * 2 - 1) * 0.55, y: -0.02, age: 0, life: 2.6 + seed * 1.6, size: 0.18 + seed * 0.12, seed });
    }
    for (const s of this.steam) {
      s.age += dt;
      s.y -= dt * (0.3 + s.seed * 0.15);
      s.x += Math.sin(time * 1.2 + s.seed * 10) * dt * 0.08;
    }
    this.steam = this.steam.filter((s) => s.age < s.life);
  }

  private drawSteam(toScreen: (x: number, y: number) => { x: number; y: number }, potScale: number) {
    if (!this.steamSprite || !this.steam.length) return;
    const { ctx, R } = this;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (const s of this.steam) {
      const k = s.age / s.life;
      const pos = toScreen(s.x, s.y);
      const size = (s.size + k * 0.5) * R * potScale;
      ctx.globalAlpha = Math.sin(Math.PI * k) * 0.09;
      ctx.drawImage(this.steamSprite, pos.x - size / 2, pos.y - size / 2, size, size);
    }
    ctx.restore();
  }
}
