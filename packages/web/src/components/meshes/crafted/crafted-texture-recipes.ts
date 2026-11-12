// ---------------------------------------------------------------------------
// Crafted furniture textures: the recipes
//
// Small tileable maps made in code, so the furniture downloads nothing: woven
// linen, crushed velvet, the checked chair fabric, mahogany and plywood grain,
// stage felt, the servery's brass grille, the ivory damask, the dance floor's
// parquet. Pure painting, no three.js: crafted-textures.ts makes the maps from
// these on the main thread, and crafted-texture.worker.ts paints them off it.
// ---------------------------------------------------------------------------

export type CraftedTextureId =
  | "linen-normal"
  | "velvet-normal"
  | "check-fabric"
  | "mahogany-grain"
  | "plywood-grain"
  | "felt-normal"
  | "brass-lattice"
  | "damask-colour"
  | "damask-roughness"
  | "leather-normal"
  | "gilt-roughness"
  | "parquet-colour"
  | "parquet-normal"
  | "hex-deck-normal"
  | "contact-spot";

/** One texel, RGBA. */
export type Texel = readonly [number, number, number, number];

/** A tangent-space normal map's level texel (+Y up). */
const FLAT_NORMAL: Texel = [128, 128, 255, 255];

interface TextureRecipe {
  /** Pixels per side; a power of two so the map can be mipmapped. */
  readonly size: number;
  /** Metres covered by one tile. */
  readonly tileMetres: number;
  readonly colour: boolean;
  /**
   * What the map shows until it is painted (crafted-textures.ts paints off
   * the main thread): a normal map lies level; any other map shows its mean,
   * averaged in linear light for colour, which is what its mipmaps converge
   * to, so its painting reads as detail arriving rather than a change of tone.
   * The crafted texture tests hold every rest to its painted mean.
   */
  readonly rest: Texel;
  readonly paint: (size: number) => Uint8Array<ArrayBuffer>;
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
function heightToNormals(height: Float32Array, size: number, strength: number): Uint8Array<ArrayBuffer> {
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

function paintHeight(size: number, height: (u: number, v: number) => number, strength: number): Uint8Array<ArrayBuffer> {
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

function paintColour(size: number, colour: (u: number, v: number) => Rgb): Uint8Array<ArrayBuffer> {
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

/** A damask leaf: where it sits and leans, and its length and breadth (tile units). */
interface LeafShape {
  readonly cx: number;
  readonly cy: number;
  readonly cos: number;
  readonly sin: number;
  readonly length: number;
  readonly width: number;
}

function leafShape(cx: number, cy: number, angle: number, length: number, width: number): LeafShape {
  return { cx, cy, cos: Math.cos(angle), sin: Math.sin(angle), length, width };
}

/** A leaf's signed distance: an ellipse along its lean, pointed at both ends, its midrib cut back to ground. */
function leafDistance(ax: number, y: number, shape: LeafShape): number {
  const dx = ax - shape.cx;
  const dy = y - shape.cy;
  const lx = dx * shape.cos + dy * shape.sin;
  const ly = -dx * shape.sin + dy * shape.cos;
  const taper = Math.max(0.15, 1 - (lx / shape.length) ** 2);
  const body = (Math.hypot(lx / shape.length, ly / (shape.width * Math.sqrt(taper))) - 1) * Math.min(shape.length, shape.width);
  const midrib = 0.0028 - Math.abs(ly);
  return Math.abs(lx) < shape.length * 0.85 ? Math.max(body, midrib) : body;
}

const MEDALLION_LEAVES: readonly LeafShape[] = [leafShape(0.13, 0.085, 0.62, 0.088, 0.034), leafShape(0.125, -0.09, -0.72, 0.082, 0.031)];
const SPRIG_LEAF = leafShape(0.045, -0.03, -0.5, 0.034, 0.013);
/**
 * How far each shape reaches from its centre (tile units): the medallion
 * across and up (its leaves and finials), the sprig all round (its leaf).
 */
const MEDALLION_REACH_X = 0.225;
const MEDALLION_REACH_Y = 0.332;
const SPRIG_REACH = 0.091;

/**
 * The damask's figure, 1 on the satin-woven motif and 0 on the matt ground:
 * a mirrored floral medallion (a five-petal bloom, four leaves, two scrolls
 * and a finial above and below) on a half-drop repeat (one medallion at the
 * tile's corners, one at its centre) with a small sprig between them. Shapes are
 * signed distances in tile units, softened over two pixels.
 *
 * `bounded` skips a shape wherever the point is clear of its reach by more
 * than the softening can carry (a few pixels, since the leaves' and the
 * finials' distances are stretched ellipses): the figure there is ground
 * either way, and painting skips about two thirds of the work.
 */
export function damaskFigure(u: number, v: number, pixel: number, bounded = true): number {
  const margin = bounded ? 4 * pixel : Infinity;
  const medallion = (x: number, y: number): number => {
    if (Math.abs(x) > MEDALLION_REACH_X + margin || Math.abs(y) > MEDALLION_REACH_Y + margin) return 1;
    // Mirror symmetric about the vertical axis, as damask is woven.
    const ax = Math.abs(x);
    const r = Math.hypot(x, y);
    const theta = Math.atan2(y, x);
    // The bloom: five full rounded petals round an open eye, a fine ring of
    // ground inside them, one petal standing straight up so the bloom mirrors too.
    let d = r - 0.085 * (0.7 + 0.3 * Math.abs(Math.cos(2.5 * (theta - Math.PI / 2))));
    const eye = 0.018 - r;
    const ring = 0.0055 - Math.abs(r - 0.05);
    // Two pairs of broad leaves leaning out from the bloom.
    for (const shape of MEDALLION_LEAVES) d = Math.min(d, leafDistance(ax, y, shape));
    // Scrolls: open arcs curling out above and below the leaves.
    const scroll = (cx: number, cy: number, radius: number, from: number, to: number): number => {
      const dx = ax - cx;
      const dy = y - cy;
      const a = Math.atan2(dy, dx);
      return a >= from && a <= to ? Math.abs(Math.hypot(dx, dy) - radius) - 0.0095 : Infinity;
    };
    d = Math.min(d, scroll(0.085, 0.19, 0.056, -2.6, 1.2), scroll(0.08, -0.195, 0.052, -1.2, 2.6));
    // Finials: a teardrop above and a bud below, on the axis.
    d = Math.min(d, Math.hypot(x / 0.034, (y - 0.275) / 0.056) * 0.034 - 0.034);
    d = Math.min(d, Math.hypot(x / 0.026, (y + 0.265) / 0.038) * 0.026 - 0.026);
    // A stem joining the bloom to the finials.
    if (Math.abs(y) < 0.24) d = Math.min(d, ax - 0.0065);
    return Math.max(d, eye, ring);
  };
  /** A sprig between the medallions: a small four-petalled flower with two leaves. */
  const sprig = (x: number, y: number): number => {
    const r = Math.hypot(x, y);
    if (r > SPRIG_REACH + margin) return 1;
    const theta = Math.atan2(y, x);
    const flower = r - 0.032 * (0.65 + 0.35 * Math.abs(Math.cos(2 * theta)));
    return Math.max(Math.min(flower, leafDistance(Math.abs(x), y, SPRIG_LEAF)), 0.007 - r);
  };
  // The half-drop: medallions at the tile's corners and centre, sprigs between.
  const wrap = (value: number): number => value - Math.round(value);
  let d = Math.min(medallion(wrap(u), wrap(v)), medallion(wrap(u - 0.5), wrap(v - 0.5)));
  d = Math.min(d, sprig(wrap(u - 0.5), wrap(v)), sprig(wrap(u), wrap(v - 0.5)));
  // Softened over two pixels: woven figures have no hard edge.
  return 1 - smooth(Math.min(1, Math.max(0, d / (2 * pixel) + 0.5)));
}

/**
 * A dance floor panel's parquet, one whole panel per tile: four by four
 * squares of five oak strips each, the strips of neighbouring squares turned
 * a quarter (the chequer UK hire floors are laid in). Returns the strip's
 * tone (0 to 1, steady along a strip), the grain streak across it, and how
 * near the pixel is to a joint (1 on a joint).
 */
function parquetCell(u: number, v: number, pixel: number): { tone: number; grain: number; joint: number } {
  const squares = 4;
  const strips = 5;
  const su = u * squares;
  const sv = v * squares;
  const iu = Math.floor(su);
  const iv = Math.floor(sv);
  const fu = su - iu;
  const fv = sv - iv;
  // Strips run along u in even squares, along v in odd ones.
  const along = ((iu + iv) & 1) === 0;
  const across = along ? fv : fu;
  const lengthwise = along ? fu : fv;
  const strip = Math.min(strips - 1, Math.floor(across * strips));
  const inStrip = across * strips - strip;
  const tone = hash2(iu * 7 + strip, iv * 13 + (along ? 0 : 5), 211);
  // Grain: streaks along the strip, a long slow figure and fine lines.
  const grainU = along ? u : v;
  const grainV = along ? v : u;
  const grain = fbm(grainU * 0.25 + tone, grainV * 3, 24, 3, 223) * 0.7 + valueNoise(lengthwise + tone * 3, inStrip * 0.6, 4, 227) * 0.3;
  // Joints: between strips, round each square, and at the panel's edge.
  const stripJoint = Math.min(inStrip, 1 - inStrip) / strips / squares;
  const squareJoint = Math.min(fu, 1 - fu, fv, 1 - fv) / squares;
  const distance = Math.min(stripJoint, squareJoint * 0.7);
  const joint = 1 - smooth(Math.min(1, Math.max(0, distance / (pixel * 1.4))));
  return { tone, grain, joint };
}

/**
 * Per-pixel values two maps of one figure share (its colour and its relief
 * or roughness): built for whichever map is painted first, handed to the
 * second and then dropped, so the figure is evaluated once per page.
 */
function pairedField<T>(build: (size: number) => T): (size: number) => T {
  let held: { readonly size: number; readonly value: T } | null = null;
  return (size) => {
    if (held !== null && held.size === size) {
      const { value } = held;
      held = null;
      return value;
    }
    const value = build(size);
    held = { size, value };
    return value;
  };
}

/**
 * The damask's figure at every pixel of a tile. The figure is mirrored about
 * the vertical (f(u, v) = f(1 − u, v)) and repeats on the half drop
 * (f(u, v) = f(u + ½, v + ½)), both exactly at pixel centres, so one
 * quarter of the tile is evaluated and copied to the other three.
 */
export function damaskFigureField(size: number): Float32Array {
  const field = new Float32Array(size * size);
  const half = size / 2;
  for (let y = 0; y < half; y += 1) {
    for (let x = 0; x < half; x += 1) {
      const value = damaskFigure((x + 0.5) / size, (y + 0.5) / size, 1 / size);
      const dropX = x + half;
      const dropY = y + half;
      field[y * size + x] = value;
      field[y * size + (size - 1 - x)] = value;
      field[dropY * size + dropX] = value;
      field[dropY * size + (size - 1 - dropX)] = value;
    }
  }
  return field;
}

const damaskField = pairedField(damaskFigureField);

interface ParquetField {
  readonly tone: Float32Array;
  readonly grain: Float32Array;
  readonly joint: Float32Array;
}

/** The parquet's strips at every pixel of a tile, for its colour and its relief. */
const parquetField = pairedField((size: number): ParquetField => {
  const tone = new Float32Array(size * size);
  const grain = new Float32Array(size * size);
  const joint = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const cell = parquetCell((x + 0.5) / size, (y + 0.5) / size, 1 / size);
      tone[y * size + x] = cell.tone;
      grain[y * size + x] = cell.grain;
      joint[y * size + x] = cell.joint;
    }
  }
  return { tone, grain, joint };
});

/** The pixel a painter's (u, v) sample sits at. */
function pixelAt(u: number, v: number, size: number): number {
  return Math.floor(v * size) * size + Math.floor(u * size);
}

/** Tileable cellular noise: distance to the nearest of `cells` jittered points per side, 0 at a point. */
function cellular(u: number, v: number, cells: number, seed: number): number {
  const x = u * cells;
  const y = v * cells;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let best = Infinity;
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      const cxi = ix + ox;
      const cyi = iy + oy;
      const wx = ((cxi % cells) + cells) % cells;
      const wy = ((cyi % cells) + cells) % cells;
      const px = cxi + hash2(wx, wy, seed);
      const py = cyi + hash2(wx, wy, seed + 17);
      best = Math.min(best, Math.hypot(px - x, py - y));
    }
  }
  return best;
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
    rest: FLAT_NORMAL,
    paint: (size) => paintHeight(size, linenHeight, 2.2),
  },
  "velvet-normal": {
    size: 128,
    tileMetres: 0.22,
    colour: false,
    rest: FLAT_NORMAL,
    paint: (size) => paintHeight(size, (u, v) => fbm(u, v, 4, 4, 7), 3.5),
  },
  "check-fabric": {
    size: 256,
    tileMetres: 0.09,
    colour: true,
    rest: [180, 44, 31, 255],
    paint: (size) => {
      // Trades Hall's checked chair (its Reception Room and Grand Hall
      // photographs): a crimson ground under a fine darker diamond trellis,
      // a small dark diamond at every crossing, a weave through all of it.
      const ground = hex(0xb52a1d);
      const trellis = hex(0x6d1610);
      const lift = hex(0xc8382a);
      return paintColour(size, (u, v) => {
        const d = latticeDistance(u, v, 2) * 2;
        const weave = 0.9 + 0.14 * linenHeight((u * 3) % 1, (v * 3) % 1);
        const line = 1 - smooth(Math.min(1, Math.max(0, (d - 0.012) / 0.014)));
        // Crossings: where both diagonals are near a lattice line.
        const a = (u + v) * 2;
        const b2 = (u - v) * 2;
        const crossing = Math.hypot(a - Math.round(a), b2 - Math.round(b2)) / 2;
        const diamond = 1 - smooth(Math.min(1, Math.max(0, (crossing - 0.035) / 0.02)));
        // The cushion's pile lifts a touch in the middle of each diamond.
        const centre = 1 - smooth(Math.min(1, d / 0.12));
        const base = mix(ground, lift, (1 - centre) * 0.25);
        const [r, g, b] = mix(base, trellis, Math.max(line * 0.75, diamond * 0.9));
        return [r * weave, g * weave, b * weave];
      });
    },
  },
  "mahogany-grain": {
    size: 256,
    tileMetres: 0.6,
    colour: true,
    rest: [93, 36, 20, 255],
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
    rest: [216, 184, 143, 255],
    paint: (size) => {
      // A varnished birch-ply face, as on the supplied trestle and the
      // venue's boardroom tables: pale, faintly pink, long soft streaks.
      const pale = hex(0xe9d2ae);
      const warm = hex(0xc9a072);
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
    rest: FLAT_NORMAL,
    paint: (size) => paintHeight(size, (u, v) => fbm(u, v, 16, 2, 71), 1.6),
  },
  "damask-colour": {
    size: 512,
    tileMetres: 0.5,
    colour: true,
    rest: [243, 238, 228, 255],
    paint: (size) => {
      // Trades Hall's ivory damask: tone on tone, the satin figure a shade
      // paler than the ground, both slubbed by the weave.
      // Light enough to read ivory, not beige, in the hall's warm light.
      const ground = hex(0xf3eee4);
      const figure = hex(0xf8f5ee);
      const field = damaskField(size);
      return paintColour(size, (u, v) => {
        const motif = field[pixelAt(u, v, size)] ?? 0;
        const slub = 0.985 + 0.03 * valueNoise(u, v, 64, 83) - 0.012 * valueNoise(u, v * 0.25, 8, 89);
        const [r, g, b] = mix(ground, figure, motif);
        return [r * slub, g * slub, b * slub];
      });
    },
  },
  "damask-roughness": {
    size: 512,
    tileMetres: 0.5,
    colour: false,
    rest: [198, 198, 198, 255],
    paint: (size) => {
      // Roughness in the green channel (three reads it there): the satin
      // figure catches the light, the twill ground stays matt.
      const field = damaskField(size);
      return paintColour(size, (u, v) => {
        // A gentle step only: in direct sun a glossier figure flashes white.
        const motif = field[pixelAt(u, v, size)] ?? 0;
        const roughness = 0.8 - motif * 0.15 + (valueNoise(u, v, 32, 97) - 0.5) * 0.04;
        const value = roughness * 255;
        return [value, value, value];
      });
    },
  },
  "leather-normal": {
    size: 128,
    tileMetres: 0.06,
    colour: false,
    rest: FLAT_NORMAL,
    // Leatherette: a fine pebbled grain of shallow cells.
    paint: (size) => paintHeight(size, (u, v) => Math.min(1, cellular(u, v, 14, 101) * 1.3) * 0.8 + fbm(u, v, 8, 2, 103) * 0.2, 1.1),
  },
  "gilt-roughness": {
    size: 128,
    tileMetres: 0.35,
    colour: false,
    rest: [95, 95, 95, 255],
    paint: (size) => {
      // Gold paint over resin: a soft cloud of satin and burnish, with a fine
      // speckle of the metallic flake.
      return paintColour(size, (u, v) => {
        const cloud = fbm(u, v, 3, 3, 107);
        const flake = valueNoise(u, v, 96, 109);
        const roughness = 0.3 + cloud * 0.14 + (flake - 0.5) * 0.06;
        const value = roughness * 255;
        return [value, value, value];
      });
    },
  },
  "parquet-colour": {
    size: 512,
    tileMetres: 0.91,
    colour: true,
    rest: [161, 110, 61, 255],
    paint: (size) => {
      // Lacquered oak in honey to amber strips, each its own tone, a hairline
      // of darker wax in every joint.
      const pale = hex(0xc8935a);
      const deep = hex(0x8a5428);
      const joint = hex(0x3a2412);
      const field = parquetField(size);
      return paintColour(size, (u, v) => {
        const at = pixelAt(u, v, size);
        const base = mix(pale, deep, 0.15 + (field.tone[at] ?? 0) * 0.6);
        const [r, g, b] = mix(base, mix(base, deep, 0.55), (field.grain[at] ?? 0) * 0.55);
        return mix([r, g, b], joint, (field.joint[at] ?? 0) * 0.85);
      });
    },
  },
  "parquet-normal": {
    size: 512,
    tileMetres: 0.91,
    colour: false,
    rest: FLAT_NORMAL,
    // Each strip a hair proud of its joints, its grain faintly raised.
    paint: (size) => {
      const field = parquetField(size);
      return paintHeight(size, (u, v) => {
        const at = pixelAt(u, v, size);
        return (1 - (field.joint[at] ?? 0)) * 0.8 + (field.grain[at] ?? 0) * 0.05;
      }, 2.4);
    },
  },
  "hex-deck-normal": {
    size: 128,
    tileMetres: 0.08,
    colour: false,
    rest: FLAT_NORMAL,
    // A staging deck's phenolic anti-slip face: a fine raised hexagon mesh.
    paint: (size) => paintHeight(size, (u, v) => {
      // Hexagonal cells, 7 across and 8 rows a tile (8 × √3/2 ≈ 7, so the
      // cells stay within 1% of regular and the even row count tiles): the
      // height falls from each cell's centre to its rim.
      const columns = 7;
      const rows = 8;
      const x = u * columns;
      const y = v * rows;
      const rowScale = Math.sqrt(3) / 2;
      let best = Infinity;
      const row0 = Math.floor(y);
      for (let dy = -1; dy <= 1; dy += 1) {
        const r = row0 + dy;
        const offset = (((r % rows) + rows) % rows) & 1 ? 0.5 : 0;
        const col0 = Math.floor(x - offset);
        for (let dx = -1; dx <= 1; dx += 1) {
          const cx = col0 + dx + 0.5 + offset;
          const cy = r + 0.5;
          best = Math.min(best, Math.hypot(x - cx, (y - cy) * rowScale));
        }
      }
      return 1 - smooth(Math.min(1, best * 2.1));
    }, 1.6),
  },
  "contact-spot": {
    size: 64,
    // One spot per tile: the quad under a foot carries UVs 0..1 itself.
    tileMetres: 1,
    colour: true,
    rest: [18, 13, 9, 27],
    paint: (size) => {
      // A foot's contact shade: dark at the foot, gone by the spot's rim,
      // falling off as the light a foot shuts out does (a soft square law).
      const pixels = new Uint8Array(size * size * 4);
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const r = Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5) * 2;
          const k = Math.max(0, 1 - r);
          const index = (y * size + x) * 4;
          pixels[index] = 18;
          pixels[index + 1] = 13;
          pixels[index + 2] = 9;
          pixels[index + 3] = Math.round(255 * k * k * (0.55 + 0.45 * k));
        }
      }
      return pixels;
    },
  },
  "brass-lattice": {
    size: 256,
    tileMetres: 0.16,
    colour: true,
    rest: [75, 56, 25, 255],
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

/** Every crafted texture, in the order they are painted ahead of use. */
export const CRAFTED_TEXTURE_IDS = Object.keys(RECIPES) as readonly CraftedTextureId[];

export function isCraftedTextureId(value: unknown): value is CraftedTextureId {
  return typeof value === "string" && Object.hasOwn(RECIPES, value);
}

/** A map's size and tiling, without painting it. */
export function craftedTextureFormat(id: CraftedTextureId): { readonly size: number; readonly tileMetres: number; readonly colour: boolean; readonly rest: Texel } {
  const { size, tileMetres, colour, rest } = RECIPES[id];
  return { size, tileMetres, colour, rest };
}

/** Paints one map: RGBA, `size` x `size`, row by row. */
export function paintCraftedTexture(id: CraftedTextureId): Uint8Array<ArrayBuffer> {
  const recipe = RECIPES[id];
  return recipe.paint(recipe.size);
}

/** A request to the painting worker, and its answer (the pixels transferred). */
export interface CraftedTexturePaintRequest {
  readonly id: number;
  readonly texture: CraftedTextureId;
}

export type CraftedTexturePaintAnswer =
  | { readonly id: number; readonly ok: true; readonly pixels: ArrayBuffer }
  | { readonly id: number; readonly ok: false; readonly error: string };
