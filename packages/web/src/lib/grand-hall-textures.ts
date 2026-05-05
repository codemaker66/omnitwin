/**
 * Procedural CanvasTextures for the Grand Hall.
 *
 * Every texture is generated at module-instantiation time from a 2D Canvas
 * — no images shipped, no network IO. The trade-off versus an authored PBR
 * set: smaller bundle, instant load, deterministic look. The cost: textures
 * are still procedural rather than photoreal. This file leans into the real
 * Grand Hall material cues — honey parquet, warm plaster, dark timber
 * wainscot, avodire ceiling, gold frieze, and the dome's trade motifs — while
 * the splat runtime remains future work.
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
// Floor - beige timber panels
// ---------------------------------------------------------------------------

/**
 * Beige timber panel floor. Repeats on the floor as long staggered boards
 * with soft seams, bevels, grain, and wear. The goal is a warm event-floor
 * read instead of the previous dark tile/grid impression.
 */
export function createParquetFloorTexture(): Texture {
  const SIZE = 512;
  const { canvas, ctx } = makeCanvas(SIZE);

  ctx.fillStyle = "#bda275";
  ctx.fillRect(0, 0, SIZE, SIZE);

  const tones = ["#d6c193", "#cdb47e", "#c2a46d", "#dec999", "#b99562", "#d1b985"];
  const BOARD_W = 56;
  const BOARD_L = 256;
  const rows = Math.ceil(SIZE / BOARD_W) + 1;
  const columns = Math.ceil(SIZE / BOARD_L) + 2;

  for (let row = 0; row < rows; row++) {
    const y = row * BOARD_W;
    const rowOffset = row % 2 === 0 ? 0 : -BOARD_L / 2;
    for (let col = -1; col < columns; col++) {
      const x = col * BOARD_L + rowOffset;
      const tone = tones[Math.floor(hash(row, col) * tones.length)] ?? "#cdb47e";
      const boardGrad = ctx.createLinearGradient(x, y, x, y + BOARD_W);
      boardGrad.addColorStop(0, tone);
      boardGrad.addColorStop(0.48, tone);
      boardGrad.addColorStop(1, "#b99d6b");
      ctx.fillStyle = boardGrad;
      ctx.fillRect(x, y, BOARD_L, BOARD_W);

      // recessed seams and subtle bevels around every board
      ctx.fillStyle = "rgba(76,51,23,0.28)";
      ctx.fillRect(x, y, BOARD_L, 1);
      ctx.fillRect(x, y + BOARD_W - 1, BOARD_L, 1);
      ctx.fillRect(x, y, 1, BOARD_W);
      ctx.fillStyle = "rgba(255,245,210,0.18)";
      ctx.fillRect(x + 2, y + 2, BOARD_L - 4, 1);

      // lengthwise grain, knots, and faint sanding streaks
      for (let g = 8; g < BOARD_W - 4; g += 8 + Math.floor(hash(row, col, g) * 6)) {
        ctx.fillStyle = `rgba(88,59,24,${(0.055 + hash(col, row, g + 17) * 0.055).toFixed(3)})`;
        ctx.fillRect(x + 6, y + g, BOARD_L - 12, 1);
      }
      if (hash(row, col, 91) > 0.58) {
        const knotX = x + 42 + hash(row, col, 23) * (BOARD_L - 84);
        const knotY = y + 13 + hash(row, col, 47) * (BOARD_W - 26);
        ctx.beginPath();
        ctx.ellipse(knotX, knotY, 10, 3.5, hash(row, col, 3) * Math.PI, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(100,66,28,0.16)";
        ctx.fill();
        ctx.strokeStyle = "rgba(245,225,180,0.12)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  // amber polish wash and softened walking wear
  const polish = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  polish.addColorStop(0, "rgba(255,239,195,0.16)");
  polish.addColorStop(0.5, "rgba(255,255,255,0.04)");
  polish.addColorStop(1, "rgba(107,72,31,0.12)");
  ctx.fillStyle = polish;
  ctx.fillRect(0, 0, SIZE, SIZE);

  applyNoise(ctx, 0, 0, SIZE, SIZE, 0.025);

  const grad = ctx.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.3, SIZE / 2, SIZE / 2, SIZE * 0.7);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(96,67,28,0.12)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SIZE, SIZE);

  return finalize(canvas, 3.2, 6);
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
// Ceiling — avodire timber coffer grid
// ---------------------------------------------------------------------------

/**
 * West African avodire timber ceiling with a coffered panel grid. The real
 * Grand Hall ceiling is a warm wood field rather than pale plaster; this
 * texture supplies the base timber grain while `GrandHallOrnaments` adds
 * raised coffer beams in geometry.
 */
export function createCeilingPlasterTexture(): Texture {
  const SIZE = 512;
  const { canvas, ctx } = makeCanvas(SIZE);

  const woodGrad = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  woodGrad.addColorStop(0, "#c68a45");
  woodGrad.addColorStop(0.48, "#aa6a31");
  woodGrad.addColorStop(1, "#7d4924");
  ctx.fillStyle = woodGrad;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Long avodire grain lines, slightly meandering so the surface does not
  // read as a flat orange slab.
  for (let y = 0; y < SIZE; y += 12) {
    const alpha = 0.025 + hash(y, 2, 41) * 0.035;
    ctx.strokeStyle = `rgba(55,30,12,${alpha.toFixed(4)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= SIZE; x += 64) {
      const wave = Math.sin((x + y * 0.37) * 0.025) * 3;
      ctx.lineTo(x, y + wave);
    }
    ctx.stroke();
  }

  // Grid of recessed timber panels with darker bevels and gold-warmed high
  // edges. Geometry beams sit over this texture; the painted grid makes the
  // panel fields still read from glancing angles.
  const PANEL = 128;
  for (let x = 0; x < SIZE; x += PANEL) {
    for (let y = 0; y < SIZE; y += PANEL) {
      const panelGrad = ctx.createLinearGradient(x, y, x + PANEL, y + PANEL);
      panelGrad.addColorStop(0, "rgba(240,180,92,0.16)");
      panelGrad.addColorStop(0.5, "rgba(100,52,20,0.06)");
      panelGrad.addColorStop(1, "rgba(30,14,4,0.18)");
      ctx.fillStyle = panelGrad;
      ctx.fillRect(x + 10, y + 10, PANEL - 20, PANEL - 20);

      ctx.strokeStyle = "rgba(52,27,10,0.5)";
      ctx.lineWidth = 5;
      ctx.strokeRect(x + 8, y + 8, PANEL - 16, PANEL - 16);
      ctx.strokeStyle = "rgba(211,164,87,0.28)";
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 15, y + 15, PANEL - 30, PANEL - 30);
    }
  }

  // Small gold rosette per coffer.
  for (let cx = PANEL / 2; cx < SIZE; cx += PANEL) {
    for (let cy = PANEL / 2; cy < SIZE; cy += PANEL) {
      ctx.fillStyle = "rgba(220,176,92,0.35)";
      ctx.beginPath();
      ctx.arc(cx, cy, 14, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(255,220,140,0.18)";
      for (let p = 0; p < 4; p++) {
        const a = (p / 4) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * 22, cy + Math.sin(a) * 22, 10, 5, a, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  applyNoise(ctx, 0, 0, SIZE, SIZE, 0.018);

  return finalize(canvas, 1, 1);
}

// ---------------------------------------------------------------------------
// Dome interior — avodire timber with gold trade motifs
// ---------------------------------------------------------------------------

/**
 * Dome interior texture. Wraps the hemisphere so the U axis goes around
 * the dome and V goes from base to apex. The real Grand Hall dome is framed
 * by gold-leaf trade iconography, so this is drawn as timber ribs with fourteen
 * shield-like motifs around the base.
 */
export function createDomeInteriorTexture(): Texture {
  const SIZE = 1024;
  const HEIGHT = 256;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("2D canvas context unavailable");

  // base — warm timber, darker at the base where the frieze sits
  const baseGrad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  baseGrad.addColorStop(0, "#8a4f22");
  baseGrad.addColorStop(0.48, "#b97633");
  baseGrad.addColorStop(1, "#d9aa60");
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, SIZE, HEIGHT);

  // Fine vertical grain that follows the dome's UV wrap.
  for (let x = 0; x < SIZE; x += 3) {
    const alpha = 0.045 + hash(x, 7, 53) * 0.075;
    ctx.strokeStyle = `rgba(50,24,8,${alpha.toFixed(4)})`;
    ctx.beginPath();
    ctx.moveTo(x, 28);
    ctx.lineTo(x + Math.sin(x * 0.03) * 5, HEIGHT);
    ctx.stroke();
  }

  // Burgundy frieze band at the base with brass borders.
  ctx.fillStyle = "rgba(88,31,25,0.74)";
  ctx.fillRect(0, 0, SIZE, 34);
  ctx.fillStyle = "rgba(216,174,93,0.78)";
  ctx.fillRect(0, 31, SIZE, 7);
  ctx.fillRect(0, 0, SIZE, 5);

  const TRADE_COUNT = 14;
  const segmentW = SIZE / TRADE_COUNT;

  // Gold ribs dividing the dome into fourteen trade panels.
  ctx.strokeStyle = "rgba(221,176,91,0.42)";
  ctx.lineWidth = 2;
  for (let i = 0; i < TRADE_COUNT; i++) {
    const x = i * segmentW;
    ctx.beginPath();
    ctx.moveTo(x, 38);
    ctx.lineTo(x, HEIGHT);
    ctx.stroke();
  }

  // Fourteen simplified shields in the frieze: abstract heraldic marks, not
  // copyrighted or literal trade crests.
  const shieldTones = ["#ead29a", "#c9a45a", "#f0dcc0", "#9f342f"];
  for (let i = 0; i < TRADE_COUNT; i++) {
    const cx = i * segmentW + segmentW / 2;
    const top = 7;
    const w = 28;
    const h = 20;
    ctx.fillStyle = shieldTones[i % shieldTones.length] ?? "#ead29a";
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, top);
    ctx.lineTo(cx + w / 2, top);
    ctx.lineTo(cx + w * 0.38, top + h * 0.6);
    ctx.lineTo(cx, top + h);
    ctx.lineTo(cx - w * 0.38, top + h * 0.6);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(50,24,8,0.45)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,240,170,0.5)";
    ctx.beginPath();
    ctx.moveTo(cx, top + 3);
    ctx.lineTo(cx, top + h - 4);
    ctx.moveTo(cx - w * 0.28, top + h * 0.45);
    ctx.lineTo(cx + w * 0.28, top + h * 0.45);
    ctx.stroke();
  }

  // central oculus highlight — glow ring near apex
  const apexGrad = ctx.createRadialGradient(SIZE / 2, HEIGHT, 0, SIZE / 2, HEIGHT, HEIGHT * 0.46);
  apexGrad.addColorStop(0, "rgba(255,238,180,0.45)");
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
    ctx.fillStyle = `rgba(40,25,10,${a.toFixed(4)})`;
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
