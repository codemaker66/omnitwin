// ---------------------------------------------------------------------------
// glass-structure — how much of the world outside reads through a window
//
// A measure for the Grand Hall's glass at night, from three renders of one
// pose: the frame as the planner draws it, the same frame with the city and
// its street hidden (the plain pane: only the sky and the room's reflection
// in the glass) and the same frame with the panes painted magenta (the glass
// mask). A lit room seen in dark glass gives the pane its reflection whatever
// lies outside, so brightness alone cannot tell a window that shows the street
// from one that shows nothing: an earlier mark (glass pixels at luma 6 or
// more) passed 99% of panes that read as flat plum. What the eye reads as
// "the world outside" is structure: edges, lit windows, lamps, the lines of a
// street. So the measure is the edge energy over the glass, against the plain
// pane's.
//
// Luma is Rec. 709 on the 8-bit sRGB values. Only the glass counts: outside
// the mask each image is filled from the glass around it (normalised
// convolution, a Gaussian of sigma 3 px), so the glazing bars' and frames' own
// edges never count. Then a Gaussian of sigma 1 px (it takes out the night
// dither's per-pixel noise) and the Sobel gradient's magnitude / 8, in levels
// per pixel, averaged over the glass (the mask eroded by 1 px). Boundaries
// reflect, as scipy.ndimage's do, so the numbers are the lane's Python
// harness's (glass_measure.py).
//
//   E   edge energy of the frame over the glass
//   E0  the same of the plain pane
//   R   E / E0: how much more the glass shows with the world outside than without it
//   Eo  edge energy of frame minus plain: the structure the outside adds, alone
//   Lo  mean |frame - plain| over the glass, levels: the light the outside adds
// ---------------------------------------------------------------------------

/** One 8-bit image's luma, row by row. */
export interface LumaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Float64Array;
}

/** The numbers the measure gives for one pose. */
export interface GlassStructure {
  readonly glassPixels: number;
  readonly E: number;
  readonly E0: number;
  readonly R: number;
  readonly Eo: number;
  readonly Lo: number;
  /** The old mark, for comparison: the share of glass pixels at luma 6 or more, and their median. */
  readonly shareAtLeast6: number;
  readonly median: number;
}

/** Rec. 709 luma of RGBA (or RGB with `channels` 3) 8-bit pixels. */
export function lumaOf(pixels: ArrayLike<number>, width: number, height: number, channels = 4): LumaImage {
  const data = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    data[i] = 0.2126 * (pixels[o] ?? 0) + 0.7152 * (pixels[o + 1] ?? 0) + 0.0722 * (pixels[o + 2] ?? 0);
  }
  return { width, height, data };
}

/** The panes painted magenta (R > 200, G < 70, B > 200) as a mask, 1 for glass. */
export function magentaMask(pixels: ArrayLike<number>, width: number, height: number, channels = 4): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    mask[i] = (pixels[o] ?? 0) > 200 && (pixels[o + 1] ?? 255) < 70 && (pixels[o + 2] ?? 0) > 200 ? 1 : 0;
  }
  return mask;
}

/** An index reflected into 0..n-1 (scipy's "reflect": d c b a | a b c d | d c b a). */
function reflect(i: number, n: number): number {
  if (n === 1) return 0;
  const period = 2 * n;
  let k = ((i % period) + period) % period;
  if (k >= n) k = period - 1 - k;
  return k;
}

/** One 1-D correlation along x (axis 1) or y (axis 0), reflecting at the edges. */
function correlate1d(src: Float64Array, width: number, height: number, weights: readonly number[], axis: 0 | 1): Float64Array {
  const out = new Float64Array(width * height);
  const half = (weights.length - 1) / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = 0; k < weights.length; k++) {
        const offset = k - half;
        const sx = axis === 1 ? reflect(x + offset, width) : x;
        const sy = axis === 0 ? reflect(y + offset, height) : y;
        sum += (weights[k] ?? 0) * (src[sy * width + sx] ?? 0);
      }
      out[y * width + x] = sum;
    }
  }
  return out;
}

/** scipy.ndimage.gaussian_filter's kernel: radius round(4 sigma), normalised. */
function gaussianKernel(sigma: number): number[] {
  const radius = Math.floor(4 * sigma + 0.5);
  const kernel: number[] = [];
  let total = 0;
  for (let i = -radius; i <= radius; i++) {
    const value = Math.exp(-0.5 * (i / sigma) ** 2);
    kernel.push(value);
    total += value;
  }
  return kernel.map((value) => value / total);
}

/** A separable Gaussian blur, reflecting at the edges. */
export function gaussianBlur(src: Float64Array, width: number, height: number, sigma: number): Float64Array {
  const kernel = gaussianKernel(sigma);
  return correlate1d(correlate1d(src, width, height, kernel, 0), width, height, kernel, 1);
}

/** The Sobel gradient's magnitude / 8 (levels per pixel), reflecting at the edges, as scipy's sobel on each axis. */
export function sobelMagnitude(src: Float64Array, width: number, height: number): Float64Array {
  const gx = correlate1d(correlate1d(src, width, height, [-1, 0, 1], 1), width, height, [1, 2, 1], 0);
  const gy = correlate1d(correlate1d(src, width, height, [-1, 0, 1], 0), width, height, [1, 2, 1], 1);
  const out = new Float64Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = Math.hypot(gx[i] ?? 0, gy[i] ?? 0) / 8;
  return out;
}

/** The mask eroded by one pixel (4-neighbours; outside the image counts as not glass, as scipy's border 0). */
export function erode(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      out[i] = mask[i] === 1 && mask[i - 1] === 1 && mask[i + 1] === 1 && mask[i - width] === 1 && mask[i + width] === 1 ? 1 : 0;
    }
  }
  return out;
}

/** The image with every pixel off the glass filled from the glass around it (normalised convolution, sigma 3 px). */
export function fillFromGlass(src: Float64Array, mask: Uint8Array, width: number, height: number, sigma = 3): Float64Array {
  const weight = new Float64Array(mask.length);
  const masked = new Float64Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    weight[i] = mask[i] ?? 0;
    masked[i] = mask[i] === 1 ? (src[i] ?? 0) : 0;
  }
  const w = gaussianBlur(weight, width, height, sigma);
  const v = gaussianBlur(masked, width, height, sigma);
  const out = new Float64Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    const wi = w[i] ?? 0;
    out[i] = mask[i] === 1 ? (src[i] ?? 0) : wi > 1e-6 ? (v[i] ?? 0) / wi : 0;
  }
  return out;
}

/** The mean edge energy of an image over the glass's core. */
export function edgeEnergy(src: Float64Array, mask: Uint8Array, core: Uint8Array, width: number, height: number): number {
  const magnitude = sobelMagnitude(gaussianBlur(fillFromGlass(src, mask, width, height), width, height, 1), width, height);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < core.length; i++) {
    if (core[i] !== 1) continue;
    sum += magnitude[i] ?? 0;
    n += 1;
  }
  return n === 0 ? 0 : sum / n;
}

/** The measure for one pose: its frame, its plain pane and its glass mask, all the same size. */
export function measureGlassStructure(frame: LumaImage, plain: LumaImage, mask: Uint8Array): GlassStructure {
  const { width, height } = frame;
  if (plain.width !== width || plain.height !== height || mask.length !== width * height) {
    throw new Error("glass structure: the frame, the plain pane and the mask must be the same size");
  }
  const core = erode(mask, width, height);
  const difference = new Float64Array(width * height);
  const glass: number[] = [];
  let outsideLight = 0;
  for (let i = 0; i < difference.length; i++) {
    const d = (frame.data[i] ?? 0) - (plain.data[i] ?? 0);
    difference[i] = d;
    if (mask[i] !== 1) continue;
    glass.push(frame.data[i] ?? 0);
    outsideLight += Math.abs(d);
  }
  const E = edgeEnergy(frame.data, mask, core, width, height);
  const E0 = edgeEnergy(plain.data, mask, core, width, height);
  glass.sort((a, b) => a - b);
  const half = Math.floor(glass.length / 2);
  const median = glass.length === 0 ? 0 : glass.length % 2 === 1 ? (glass[half] ?? 0) : ((glass[half - 1] ?? 0) + (glass[half] ?? 0)) / 2;
  return {
    glassPixels: glass.length,
    E,
    E0,
    R: E / Math.max(E0, 1e-6),
    Eo: edgeEnergy(difference, mask, core, width, height),
    Lo: glass.length === 0 ? 0 : outsideLight / glass.length,
    shareAtLeast6: glass.length === 0 ? 0 : glass.filter((value) => value >= 6).length / glass.length,
    median,
  };
}

/** A pose's marks: the least R and Eo that count as the world outside reading through its glass. */
export interface GlassMarks {
  readonly R: number;
  readonly Eo: number;
}

/**
 * The marks at Blake's night (18 October 2026, 20:41Z), desktop at DPR 1:
 * from his room pose toward the windows and from the planner's opening view.
 * Before the surveyed openings across the street (the branch's base, c20bba0d)
 * the room read R 1.44 and Eo 0.48 and the overview R 1.31 and Eo 0.35, in
 * two runs each within 1%; with them, R 1.65 and Eo 0.75, and R 1.51 and Eo
 * 0.56. The marks sit between, nearer the lit, so a change that took the lit
 * openings away, or let the reflection drown them, fails.
 */
export const GLASS_MARKS: { readonly room: GlassMarks; readonly overview: GlassMarks } = {
  room: { R: 1.55, Eo: 0.62 },
  overview: { R: 1.42, Eo: 0.46 },
};

/** Whether a pose's measure meets its marks. */
export function meetsGlassMarks(measure: GlassStructure, marks: GlassMarks): boolean {
  return measure.R >= marks.R && measure.Eo >= marks.Eo;
}
