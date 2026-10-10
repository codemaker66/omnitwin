import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from "three";

// ---------------------------------------------------------------------------
// Crafted furniture textures
//
// Small tileable maps made in code, so the furniture downloads nothing: woven
// linen, crushed velvet, the checked chair fabric, mahogany and plywood grain,
// stage felt and the servery's brass grille. Each map is built once per page
// and shared by every crafted model; materials reference the maps and never
// dispose them. Every map carries a stable semantic name, which the instancing
// harvest uses to batch identical materials across items.
//
// Geometry UVs are in metres (crafted-geometry.ts), so each map's repeat is
// its real tile size and one map serves every part at the same texel density.
// ---------------------------------------------------------------------------

export type CraftedTextureId =
  | "linen-normal"
  | "velvet-normal"
  | "check-fabric"
  | "mahogany-grain"
  | "plywood-grain"
  | "felt-normal"
  | "brass-lattice";

interface TextureRecipe {
  /** Pixels per side; a power of two so the map can be mipmapped. */
  readonly size: number;
  /** Metres covered by one tile. */
  readonly tileMetres: number;
  readonly colour: boolean;
  readonly paint: (size: number) => Uint8Array;
}

/** Deterministic hash of an integer lattice point to [0, 1). */
function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Tileable value noise: `cells` lattice cells per tile, sampled at u, v in [0, 1). */
function valueNoise(u: number, v: number, cells: number, seed: number): number {
  const x = u * cells;
  const y = v * cells;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const wrap = (n: number): number => ((n % cells) + cells) % cells;
  const a = hash2(wrap(x0), wrap(y0), seed);
  const b = hash2(wrap(x0 + 1), wrap(y0), seed);
  const c = hash2(wrap(x0), wrap(y0 + 1), seed);
  const d = hash2(wrap(x0 + 1), wrap(y0 + 1), seed);
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

/** Tileable fractal noise in [0, 1). */
function fbm(u: number, v: number, cells: number, octaves: number, seed: number): number {
  let sum = 0;
  let amplitude = 0.5;
  let total = 0;
  let frequency = cells;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += valueNoise(u, v, frequency, seed + octave * 101) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / total;
}

/** Encodes a tileable height field as a tangent-space normal map (+Y up). */
function heightToNormals(height: Float32Array, size: number, strength: number): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  const at = (x: number, y: number): number => height[((y + size) % size) * size + ((x + size) % size)] ?? 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 0.5 * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 0.5 * strength;
      const length = Math.hypot(dx, dy, 1);
      const index = (y * size + x) * 4;
      pixels[index] = Math.round((-dx / length * 0.5 + 0.5) * 255);
      pixels[index + 1] = Math.round((-dy / length * 0.5 + 0.5) * 255);
      pixels[index + 2] = Math.round((1 / length * 0.5 + 0.5) * 255);
      pixels[index + 3] = 255;
    }
  }
  return pixels;
}

function paintHeight(size: number, height: (u: number, v: number) => number, strength: number): Uint8Array {
  const field = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) field[y * size + x] = height((x + 0.5) / size, (y + 0.5) / size);
  }
  return heightToNormals(field, size, strength);
}

type Rgb = readonly [number, number, number];

function hex(colour: number): Rgb {
  return [(colour >> 16) & 255, (colour >> 8) & 255, colour & 255];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.min(1, Math.max(0, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

function paintColour(size: number, colour: (u: number, v: number) => Rgb): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = colour((x + 0.5) / size, (y + 0.5) / size);
      const index = (y * size + x) * 4;
      pixels[index] = Math.round(Math.min(255, Math.max(0, r)));
      pixels[index + 1] = Math.round(Math.min(255, Math.max(0, g)));
      pixels[index + 2] = Math.round(Math.min(255, Math.max(0, b)));
      pixels[index + 3] = 255;
    }
  }
  return pixels;
}

/** Plain weave: threads cross over and under in a checkerboard, with slubs. */
function linenHeight(u: number, v: number): number {
  const threads = 24;
  const tx = u * threads;
  const ty = v * threads;
  const ix = Math.floor(tx);
  const iy = Math.floor(ty);
  const fx = tx - ix;
  const fy = ty - iy;
  const warpOver = ((ix + iy) & 1) === 0;
  const across = warpOver ? Math.sin(Math.PI * fx) : Math.sin(Math.PI * fy);
  const along = warpOver ? Math.sin(Math.PI * fy) : Math.sin(Math.PI * fx);
  const slub = 0.8 + 0.4 * valueNoise(u, v, warpOver ? 6 : 5, warpOver ? 11 : 13);
  return (0.35 + 0.65 * across * (0.55 + 0.45 * along)) * slub;
}

/** Distance (in tile units) to the nearest line of a diagonal lattice with `k` diamonds per tile. */
function latticeDistance(u: number, v: number, k: number): number {
  const a = (u + v) * k;
  const b = (u - v) * k;
  const da = Math.abs(a - Math.round(a));
  const db = Math.abs(b - Math.round(b));
  return Math.min(da, db) / k;
}

const RECIPES: Readonly<Record<CraftedTextureId, TextureRecipe>> = {
  "linen-normal": {
    size: 128,
    tileMetres: 0.04,
    colour: false,
    paint: (size) => paintHeight(size, linenHeight, 2.2),
  },
  "velvet-normal": {
    size: 128,
    tileMetres: 0.22,
    colour: false,
    paint: (size) => paintHeight(size, (u, v) => fbm(u, v, 4, 4, 7), 3.5),
  },
  "check-fabric": {
    size: 256,
    tileMetres: 0.09,
    colour: true,
    paint: (size) => {
      // The checked banquet chair's trellis: bold orange bands crossing on
      // the diagonal over a deep red ground, a fine weave through both.
      const ground = hex(0xb3220f);
      const band = hex(0xf56a2c);
      const shadow = hex(0x8a170a);
      return paintColour(size, (u, v) => {
        const d = latticeDistance(u, v, 2) * 2;
        const weave = 0.9 + 0.14 * linenHeight((u * 3) % 1, (v * 3) % 1);
        const bandMix = 1 - smooth(Math.min(1, Math.max(0, (d - 0.055) / 0.025)));
        const shadowMix = 1 - smooth(Math.min(1, Math.max(0, (d - 0.085) / 0.03)));
        const base = mix(ground, shadow, (shadowMix - bandMix) * 0.6);
        const [r, g, b] = mix(base, band, bandMix);
        return [r * weave, g * weave, b * weave];
      });
    },
  },
  "mahogany-grain": {
    size: 256,
    tileMetres: 0.6,
    colour: true,
    paint: (size) => {
      const dark = hex(0x3a150c);
      const mid = hex(0x5e2414);
      const light = hex(0x7d3519);
      return paintColour(size, (u, v) => {
        // Grain runs along u: long streaks from noise stretched along the board.
        const streak = fbm(u * 0.125, v, 24, 4, 31);
        const figure = fbm(u, v, 3, 3, 37);
        const pores = valueNoise(u, v, 96, 41) > 0.93 ? 0.75 : 1;
        const tone = streak * 0.75 + figure * 0.25;
        const [r, g, b] = tone < 0.5 ? mix(dark, mid, tone * 2) : mix(mid, light, (tone - 0.5) * 2);
        return [r * pores, g * pores, b * pores];
      });
    },
  },
  "plywood-grain": {
    size: 256,
    tileMetres: 0.5,
    colour: true,
    paint: (size) => {
      // A varnished birch-ply face: warm honey with long soft streaks.
      const pale = hex(0xdba266);
      const warm = hex(0xb9773d);
      return paintColour(size, (u, v) => {
        const streak = fbm(u * 0.125, v, 32, 4, 53);
        const cloud = fbm(u, v, 3, 2, 61);
        const fleck = valueNoise(u, v, 128, 59) > 0.95 ? 0.9 : 1;
        const [r, g, b] = mix(pale, warm, streak * 0.75 + cloud * 0.25);
        return [r * fleck, g * fleck, b * fleck];
      });
    },
  },
  "felt-normal": {
    size: 64,
    tileMetres: 0.05,
    colour: false,
    paint: (size) => paintHeight(size, (u, v) => fbm(u, v, 16, 2, 71), 1.6),
  },
  "brass-lattice": {
    size: 256,
    tileMetres: 0.16,
    colour: true,
    paint: (size) => {
      // The servery's decorative grille: brass wires crossing on a diagonal,
      // a small boss at each crossing, a dark cabinet interior behind.
      const brass = hex(0xc9a04a);
      const brassShade = hex(0x8a6a2c);
      const interior = hex(0x20140c);
      return paintColour(size, (u, v) => {
        const d = latticeDistance(u, v, 2) * 2;
        const wire = 1 - smooth(Math.min(1, Math.max(0, (d - 0.022) / 0.018)));
        const a = (u + v) * 2;
        const b = (u - v) * 2;
        const bossDistance = Math.hypot(a - Math.round(a), b - Math.round(b)) / 2;
        const boss = 1 - smooth(Math.min(1, Math.max(0, (bossDistance - 0.03) / 0.015)));
        const metal = Math.max(wire, boss);
        const sheen = 0.75 + 0.25 * Math.sin((u + v) * Math.PI * 8);
        return mix(interior, mix(brassShade, brass, sheen), metal);
      });
    },
  },
};

const cache = new Map<CraftedTextureId, DataTexture>();

/** The shared map for a crafted texture id, built on first use. */
export function craftedTexture(id: CraftedTextureId): Texture {
  const cached = cache.get(id);
  if (cached !== undefined) return cached;
  const recipe = RECIPES[id];
  const texture = new DataTexture(recipe.paint(recipe.size), recipe.size, recipe.size);
  texture.name = `crafted:${id}`;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(1 / recipe.tileMetres, 1 / recipe.tileMetres);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.colorSpace = recipe.colour ? SRGBColorSpace : NoColorSpace;
  texture.needsUpdate = true;
  cache.set(id, texture);
  return texture;
}

/** Metres covered by one tile of a crafted texture. */
export function craftedTextureTileMetres(id: CraftedTextureId): number {
  return RECIPES[id].tileMetres;
}
