/**
 * Procedural CanvasTextures for the Grand Hall.
 *
 * Every texture is generated at module-instantiation time from a 2D Canvas
 * — no images shipped, no network IO. The trade-off versus an authored PBR
 * set: smaller bundle, instant load, deterministic look. The cost: textures
 * are stylised rather than photoreal. That fits the venue planner aesthetic
 * (Sims-build-mode-meets-Adam) and keeps the bundle lean.
 *
 * All canvases use additive noise for material variation, deterministic
 * hashing in lieu of a seeded PRNG (so SSR + client render identically),
 * and pre-configured wrap, repeat, and color-space settings — call sites
 * only need to apply them.
 */

import {
  CanvasTexture,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from "three";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    throw new Error("2D canvas context unavailable — texture generation requires DOM");
  }
  return { canvas, ctx };
}

/** Cheap deterministic hash → [0, 1). Used in lieu of a seeded PRNG. */
function hash(x: number, y: number, salt = 0): number {
  const n = Math.sin(x * 12.9898 + y * 78.233 + salt * 37.719) * 43758.5453;
  return n - Math.floor(n);
}

/** Add subtle multiplicative noise to a region for material variation. */
function applyNoise(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  amount: number,
): void {
  const img = ctx.getImageData(x, y, w, h);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const px = (i / 4) % w;
    const py = Math.floor(i / 4 / w);
    const noise = (hash(px, py, x + y) - 0.5) * amount * 255;
    data[i] = Math.max(0, Math.min(255, (data[i] ?? 0) + noise));
    data[i + 1] = Math.max(0, Math.min(255, (data[i + 1] ?? 0) + noise));
    data[i + 2] = Math.max(0, Math.min(255, (data[i + 2] ?? 0) + noise));
  }
  ctx.putImageData(img, x, y);
}

function finalize(canvas: HTMLCanvasElement, repeatX: number, repeatY: number): Texture {
  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Floor — herringbone parquet
// ---------------------------------------------------------------------------

/**
 * Honey-oak herringbone parquet. Repeats on the floor. Uses several plank
 * tones shuffled deterministically per row so the pattern doesn't read as
 * a mathematical grid.
 */
export function createParquetFloorTexture(): Texture {
  const SIZE = 512;
  const { canvas, ctx } = makeCanvas(SIZE);

  // base — slight undertone so gaps between planks read as recessed
  ctx.fillStyle = "#6e4f2a";
  ctx.fillRect(0, 0, SIZE, SIZE);

  const tones = ["#a87f4f", "#9a7344", "#b78a59", "#956e3f", "#a47a48"];
  const PLANK_W = 64;
  const PLANK_L = 256;

  // herringbone: alternating "horizontal" and "vertical" plank pairs
  const cols = Math.ceil(SIZE / PLANK_W) + 2;
  const rows = Math.ceil(SIZE / PLANK_L) + 2;

  for (let row = -1; row < rows; row++) {
    for (let col = -1; col < cols; col++) {
      const isVertical = (row + col) % 2 === 0;
      const tone = tones[Math.floor(hash(col, row) * tones.length)] ?? "#9a7344";

      ctx.save();
      const cx = col * PLANK_W;
      const cy = row * PLANK_L * 0.5;
      ctx.translate(cx, cy);

      if (isVertical) {
        ctx.fillStyle = tone;
        ctx.fillRect(0, 0, PLANK_W, PLANK_L);

        // grain — vertical streaks
        ctx.globalAlpha = 0.08;
        for (let g = 4; g < PLANK_W; g += 6 + Math.floor(hash(col, row, g) * 4)) {
          ctx.fillStyle = "#3a2611";
          ctx.fillRect(g, 2, 1, PLANK_L - 4);
        }
        // a few brighter highlights
        ctx.globalAlpha = 0.12;
        for (let g = 8; g < PLANK_W; g += 12 + Math.floor(hash(col, row, g + 9) * 6)) {
          ctx.fillStyle = "#d8b478";
          ctx.fillRect(g, 6, 1, PLANK_L - 12);
        }
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = tone;
        ctx.fillRect(0, 0, PLANK_L, PLANK_W);

        ctx.globalAlpha = 0.08;
        for (let g = 4; g < PLANK_W; g += 6 + Math.floor(hash(col, row, g) * 4)) {
          ctx.fillStyle = "#3a2611";
          ctx.fillRect(2, g, PLANK_L - 4, 1);
        }
        ctx.globalAlpha = 0.12;
        for (let g = 8; g < PLANK_W; g += 12 + Math.floor(hash(col, row, g + 9) * 6)) {
          ctx.fillStyle = "#d8b478";
          ctx.fillRect(6, g, PLANK_L - 12, 1);
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
  }

  // Scuff + age noise for realism — keeps it from looking too clean
  applyNoise(ctx, 0, 0, SIZE, SIZE, 0.04);

  // Soft vignette at edges so seams blend at high tile counts
  const grad = ctx.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.3, SIZE / 2, SIZE / 2, SIZE * 0.7);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(40,28,12,0.18)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SIZE, SIZE);

  return finalize(canvas, 5, 5);
}

// ---------------------------------------------------------------------------
// Walls — plaster with subtle horizontal banding
// ---------------------------------------------------------------------------

/**
 * Warm cream plaster wall. Slight horizontal banding suggests panel courses
 * without committing to a hard grid. Noise gives painted-plaster grit.
 */
export function createPlasterWallTexture(): Texture {
  const SIZE = 256;
  const { canvas, ctx } = makeCanvas(SIZE);

  // base cream with subtle vertical fade
  const grad = ctx.createLinearGradient(0, 0, 0, SIZE);
  grad.addColorStop(0, "#f3e7cb");
  grad.addColorStop(1, "#e9dcbe");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // subtle horizontal panel scoring (every ~85 px)
  ctx.strokeStyle = "rgba(120,95,55,0.06)";
  ctx.lineWidth = 1;
  for (let y = 30; y < SIZE; y += 85) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(SIZE, y);
    ctx.stroke();
  }

  applyNoise(ctx, 0, 0, SIZE, SIZE, 0.06);

  return finalize(canvas, 4, 2);
}

// ---------------------------------------------------------------------------
// Ceiling — Adam-style coffer rosette grid
// ---------------------------------------------------------------------------

/**
 * Cream painted plaster ceiling with a faint Adam-style coffered rosette
 * grid. Designed to read as decorated, not flat.
 */
export function createCeilingPlasterTexture(): Texture {
  const SIZE = 512;
  const { canvas, ctx } = makeCanvas(SIZE);

  ctx.fillStyle = "#ece7d8";
  ctx.fillRect(0, 0, SIZE, SIZE);

  // grid of recessed panels
  const PANEL = 128;
  ctx.strokeStyle = "rgba(95,80,50,0.18)";
  ctx.lineWidth = 2;
  for (let x = 0; x <= SIZE; x += PANEL) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, SIZE);
    ctx.stroke();
  }
  for (let y = 0; y <= SIZE; y += PANEL) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(SIZE, y);
    ctx.stroke();
  }

  // central rosette per panel
  for (let cx = PANEL / 2; cx < SIZE; cx += PANEL) {
    for (let cy = PANEL / 2; cy < SIZE; cy += PANEL) {
      ctx.fillStyle = "rgba(184,150,90,0.22)";
      ctx.beginPath();
      ctx.arc(cx, cy, 14, 0, Math.PI * 2);
      ctx.fill();

      // 4 petals
      ctx.fillStyle = "rgba(184,150,90,0.14)";
      for (let p = 0; p < 4; p++) {
        const a = (p / 4) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * 22, cy + Math.sin(a) * 22, 10, 5, a, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  applyNoise(ctx, 0, 0, SIZE, SIZE, 0.04);

  return finalize(canvas, 3, 2);
}

// ---------------------------------------------------------------------------
// Dome interior — Wedgwood blue with gold rosette and ribbed segmentation
// ---------------------------------------------------------------------------

/**
 * Dome interior texture. Wraps the hemisphere so the U axis goes around
 * the dome and V goes from base to apex. Drawn as a polar arrangement:
 * radial gold ribs converging at the apex, gold rosette ring near the base,
 * burgundy frieze band at the very base.
 */
export function createDomeInteriorTexture(): Texture {
  const SIZE = 1024;
  const HEIGHT = 256;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("2D canvas context unavailable");

  // base — pale Wedgwood
  const baseGrad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  baseGrad.addColorStop(0, "#cfd8e1");   // base/edge of dome (V=0)
  baseGrad.addColorStop(1, "#e3e8ee");   // apex
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, SIZE, HEIGHT);

  // burgundy frieze band at very base
  ctx.fillStyle = "rgba(107,42,42,0.45)";
  ctx.fillRect(0, 0, SIZE, 24);
  // brass band above + below the frieze
  ctx.fillStyle = "rgba(184,150,90,0.7)";
  ctx.fillRect(0, 24, SIZE, 6);
  ctx.fillRect(0, 0, SIZE, 4);

  // gold rosette ring near the base — 24 rosettes around the dome
  const RING_Y = HEIGHT * 0.22;
  const N = 24;
  ctx.fillStyle = "rgba(184,150,90,0.55)";
  for (let i = 0; i < N; i++) {
    const cx = (i + 0.5) * (SIZE / N);
    ctx.beginPath();
    ctx.arc(cx, RING_Y, 12, 0, Math.PI * 2);
    ctx.fill();
  }

  // radial ribs — vertical lines spaced every (SIZE/24)
  ctx.strokeStyle = "rgba(184,150,90,0.22)";
  ctx.lineWidth = 2;
  for (let i = 0; i < N; i++) {
    const x = i * (SIZE / N);
    ctx.beginPath();
    ctx.moveTo(x, 36);
    ctx.lineTo(x, HEIGHT);
    ctx.stroke();
  }

  // central oculus highlight — glow ring near apex
  const apexGrad = ctx.createRadialGradient(SIZE / 2, HEIGHT, 0, SIZE / 2, HEIGHT, HEIGHT * 0.4);
  apexGrad.addColorStop(0, "rgba(255,250,220,0.35)");
  apexGrad.addColorStop(1, "rgba(255,250,220,0)");
  ctx.fillStyle = apexGrad;
  ctx.fillRect(0, 0, SIZE, HEIGHT);

  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(1, 1);
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Wainscot oak — vertical panel pattern
// ---------------------------------------------------------------------------

/**
 * Dark oak wainscot texture. Vertical panel divisions at ~70cm centres,
 * subtle grain, deeper recessed verticals between panels.
 */
export function createWainscotOakTexture(): Texture {
  const SIZE = 256;
  const { canvas, ctx } = makeCanvas(SIZE);

  // base oak
  ctx.fillStyle = "#7a5832";
  ctx.fillRect(0, 0, SIZE, SIZE);

  // grain — vertical
  for (let x = 0; x < SIZE; x += 1) {
    const a = 0.06 + hash(x, 0) * 0.06;
    ctx.fillStyle = `rgba(40,25,10,${a})`;
    ctx.fillRect(x, 0, 1, SIZE);
  }

  // panel divisions — deeper grooves every ~64px
  for (let x = 0; x <= SIZE; x += 64) {
    // shadow side
    ctx.fillStyle = "rgba(20,12,4,0.55)";
    ctx.fillRect(x - 2, 0, 2, SIZE);
    // highlight side
    ctx.fillStyle = "rgba(180,140,80,0.18)";
    ctx.fillRect(x, 0, 2, SIZE);
  }

  applyNoise(ctx, 0, 0, SIZE, SIZE, 0.06);
  return finalize(canvas, 6, 1);
}
