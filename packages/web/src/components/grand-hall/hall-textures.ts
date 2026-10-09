// ---------------------------------------------------------------------------
// Painted textures for the surfaces the scan cannot show
//
// The walls, floor, ceiling and dome are coloured from the scan's own
// photographs (hall-photos.ts). What remains is painted at load from code,
// matched to them: the mahogany of the main door's leaves, which stood open
// during the scan.
// ---------------------------------------------------------------------------

import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from "three";

type Ctx = CanvasRenderingContext2D;

/** Deterministic PRNG (mulberry32) so every device paints the same room. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(width: number, height: number): { element: HTMLCanvasElement; ctx: Ctx } {
  const element = document.createElement("canvas");
  element.width = Math.max(1, Math.round(width));
  element.height = Math.max(1, Math.round(height));
  const ctx = element.getContext("2d");
  if (ctx === null) throw new Error("2D canvas unavailable for hall textures");
  return { element, ctx };
}

function finish(element: HTMLCanvasElement, repeat: boolean, srgb = true): Texture {
  const texture = new CanvasTexture(element);
  texture.wrapS = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  texture.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  if (srgb) texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function hsl(h: number, s: number, l: number, a = 1): string {
  return `hsla(${h.toFixed(1)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%, ${a.toFixed(3)})`;
}

/** A small tile of fine grain noise, used as a pattern to texture surfaces cheaply. */
function noiseTile(size: number, seed: number, strength: number): HTMLCanvasElement {
  const { element, ctx } = canvas(size, size);
  const image = ctx.createImageData(size, size);
  const random = seededRandom(seed);
  for (let i = 0; i < image.data.length; i += 4) {
    const value = 128 + (random() - 0.5) * 255 * strength;
    image.data[i] = value;
    image.data[i + 1] = value;
    image.data[i + 2] = value;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return element;
}

/** Overlays grain noise with soft-light so it modulates without greying. */
function grain(ctx: Ctx, width: number, height: number, seed: number, alpha: number): void {
  const tile = noiseTile(128, seed, 1);
  const pattern = ctx.createPattern(tile, "repeat");
  if (pattern === null) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = "overlay";
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/** Draws soft, wavy wood-grain strokes along x inside a rectangle. */
function woodGrain(ctx: Ctx, x: number, y: number, w: number, h: number, random: () => number, options: {
  readonly hue: number; readonly sat: number; readonly light: number; readonly lines: number; readonly contrast: number;
}): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  for (let i = 0; i < options.lines; i++) {
    const yy = y + random() * h;
    const dark = random() < 0.62;
    const lightness = options.light + (dark ? -1 : 1) * (4 + random() * 9) * options.contrast;
    ctx.strokeStyle = hsl(options.hue + (random() - 0.5) * 6, options.sat, lightness, 0.16 + random() * 0.32);
    ctx.lineWidth = 0.4 + random() * 1.6;
    ctx.beginPath();
    const waves = 1 + random() * 3;
    const amplitude = random() * h * 0.06;
    const phase = random() * Math.PI * 2;
    for (let s = 0; s <= 24; s++) {
      const xx = x + (s / 24) * w;
      const dy = Math.sin((s / 24) * Math.PI * 2 * waves + phase) * amplitude;
      if (s === 0) ctx.moveTo(xx, yy + dy);
      else ctx.lineTo(xx, yy + dy);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Mahogany
// ---------------------------------------------------------------------------

export function paintWood(quality: number, hue: number, sat: number, light: number, seed: number, figure: boolean): Texture {
  const size = Math.round(512 * quality);
  const { element, ctx } = canvas(size, size);
  ctx.fillStyle = hsl(hue, sat, light);
  ctx.fillRect(0, 0, size, size);
  const random = seededRandom(seed);
  woodGrain(ctx, 0, 0, size, size, random, { hue, sat, light, lines: 260, contrast: 1.1 });
  if (figure) {
    // Ribbon figure of quarter-sawn mahogany: broad soft light bands.
    for (let i = 0; i < 10; i++) {
      const y = random() * size;
      const gradient = ctx.createLinearGradient(0, y - 20, 0, y + 20);
      gradient.addColorStop(0, "rgba(255,200,160,0)");
      gradient.addColorStop(0.5, `rgba(255,190,150,${(0.04 + random() * 0.05).toFixed(3)})`);
      gradient.addColorStop(1, "rgba(255,200,160,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, y - 20, size, 40);
    }
  }
  grain(ctx, size, size, seed + 5, 0.14);
  return finish(element, true);
}

/** Every painted texture the hall's materials need, painted once per page. */
export interface HallTextures {
  readonly mahoganyDark: Texture;
}

export function paintHallTextures(quality: number): HallTextures {
  return {
    mahoganyDark: paintWood(quality, 12, 55, 17, 1889, true),
  };
}

export function disposeHallTextures(textures: HallTextures): void {
  textures.mahoganyDark.dispose();
}
