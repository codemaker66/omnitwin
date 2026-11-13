import { readFileSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { GLASS_MARKS, lumaOf, magentaMask, measureGlassStructure, meetsGlassMarks, type LumaImage } from "../glass-structure.js";

const W = 24;
const H = 20;

/** An image from a function of (x, y), as luma. */
function image(f: (x: number, y: number) => number, width = W, height = H): LumaImage {
  const data = new Float64Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = f(x, y);
  return { width, height, data };
}

/** Glass in a 16 x 12 rectangle with a glazing bar down x = 12. */
function barredMask(): Uint8Array {
  const mask = new Uint8Array(W * H);
  for (let y = 4; y < 16; y++) for (let x = 4; x < 20; x++) mask[y * W + x] = x === 12 ? 0 : 1;
  return mask;
}

/** The room's reflection in the glass, the same with the street or without it, and a bright bar. */
const reflection = (x: number, y: number): number => (x === 12 ? 200 : 20 + 5 * Math.sin(x * 0.7) + 3 * Math.cos(y * 0.9));
/** Two lit windows across the street, added to the reflection. */
const withWindows = (x: number, y: number): number =>
  reflection(x, y) + (x !== 12 && y >= 6 && y < 10 && x >= 6 && x < 9 ? 90 : 0) + (x !== 12 && y >= 11 && y < 14 && x >= 14 && x < 18 ? 60 : 0);

describe("the glass structure measure", () => {
  it("gives the lane's Python harness's numbers (scipy.ndimage) on the same pane", () => {
    const measure = measureGlassStructure(image(withWindows), image(reflection), barredMask());
    // From glass_measure.py's energy() on the same arrays (22 October 2026).
    expect(measure.glassPixels).toBe(180);
    expect(measure.E).toBeCloseTo(9.74878684012126, 9);
    expect(measure.E0).toBeCloseTo(1.7575560326954784, 9);
    expect(measure.R).toBeCloseTo(5.546785797304009, 9);
    expect(measure.Eo).toBeCloseTo(9.862770962181916, 9);
    expect(measure.Lo).toBeCloseTo(10, 9);
    expect(measure.median).toBeCloseTo(20.63746654884921, 9);
  });

  it("reads a plain pane as itself: the reflection alone adds nothing, however much it shows", () => {
    const measure = measureGlassStructure(image(reflection), image(reflection), barredMask());
    expect(measure.R).toBeCloseTo(1, 12);
    expect(measure.Eo).toBe(0);
    expect(measure.Lo).toBe(0);
    // The old mark passes it all the same.
    expect(measure.shareAtLeast6).toBe(1);
  });

  it("never counts the bars' and frames' own edges, only what the glass shows", () => {
    // Bright bars across dark, featureless glass: edges everywhere at the bars, none in the glass.
    const flat = image((x) => (x === 12 ? 230 : 15));
    expect(measureGlassStructure(flat, flat, barredMask()).E).toBeLessThan(1e-9);
  });

  it("takes out the night dither's per-pixel noise", () => {
    // About ±3% at the dark violet's level, fixed per pixel, as hall-street-light.ts nightDither.
    const dithered = image((x, y) => {
      const noise = (52.9829189 * ((0.06711056 * x + 0.00583715 * y) % 1)) % 1;
      return 20 * (1 + (noise - 0.5) * 0.06);
    });
    const plain = image(() => 20);
    expect(measureGlassStructure(dithered, plain, barredMask()).Eo).toBeLessThan(0.15);
  });

  it("scores light without structure no better than a plain pane", () => {
    // The whole street lit evenly: more light through the glass, nothing more to read.
    const brighter = measureGlassStructure(image((x, y) => reflection(x, y) + (x === 12 ? 0 : 25)), image(reflection), barredMask());
    expect(brighter.Lo).toBeCloseTo(25, 9);
    expect(brighter.R).toBeCloseTo(1, 6);
    expect(meetsGlassMarks(brighter, { R: 1.6, Eo: 0.75 })).toBe(false);
    const windows = measureGlassStructure(image(withWindows), image(reflection), barredMask());
    expect(meetsGlassMarks(windows, { R: 1.6, Eo: 0.75 })).toBe(true);
  });

  it("finds the painted panes and reads luma from RGBA", () => {
    const rgba = new Uint8Array([255, 0, 255, 255, 250, 60, 220, 255, 255, 80, 255, 255, 10, 20, 30, 255]);
    expect(Array.from(magentaMask(rgba, 4, 1))).toEqual([1, 1, 0, 0]);
    const luma = lumaOf(rgba, 4, 1);
    expect(luma.data[3]).toBeCloseTo(0.2126 * 10 + 0.7152 * 20 + 0.0722 * 30, 9);
  });

  it("refuses images of different sizes", () => {
    expect(() => measureGlassStructure(image(reflection), image(reflection, 10, 10), barredMask())).toThrow(/same size/u);
  });
});

/**
 * A pose's glass from the planner itself, packed by the lane's harness
 * (pack_glass_fixture.py): every window of the frame with a 12 px margin, side
 * by side, its frame's and plain pane's luma rounded to 8 bits and its mask.
 * 'VVGS', version 1, uint16 width and height, then zlib(frame, plain, mask).
 */
function packedPose(name: string): { frame: LumaImage; plain: LumaImage; mask: Uint8Array } {
  const bytes = readFileSync(path.resolve("src", "lib", "__tests__", "fixtures", `glass-${name}.bin`));
  expect(bytes.subarray(0, 4).toString("latin1")).toBe("VVGS");
  expect(bytes.readUInt8(4)).toBe(1);
  const width = bytes.readUInt16LE(5);
  const height = bytes.readUInt16LE(7);
  const body = inflateSync(bytes.subarray(9));
  const n = width * height;
  expect(body.byteLength).toBe(3 * n);
  const luma = (offset: number): LumaImage => ({ width, height, data: Float64Array.from(body.subarray(offset, offset + n)) });
  return { frame: luma(0), plain: luma(n), mask: new Uint8Array(body.subarray(2 * n, 3 * n)) };
}

describe("the glass at Blake's night, before and after the surveyed openings", () => {
  // Frames from /plan at 20:41Z on 18 October 2026, desktop, DPR 1, an empty layout: the branch's base
  // (c20bba0d) and the openings across the street. The numbers are glass_measure.py's on the same packed arrays.
  it.each([
    ["room-night-base", "room", false, { E: 1.2141809475749783, E0: 0.8457464567190646, Eo: 0.5064680450411776 }],
    ["room-night-new", "room", true, { E: 1.3944914266003634, E0: 0.8457237316804527, Eo: 0.7681561596326997 }],
    ["opening-night-base", "overview", false, { E: 1.0864893123861632, E0: 0.8260816724693698, Eo: 0.37285286730600836 }],
    ["opening-night-new", "overview", true, { E: 1.2259236828721167, E0: 0.8076017727566026, Eo: 0.5791328276243483 }],
  ] as const)("%s: %s marks met %s", (name, pose, meets, expected) => {
    const { frame, plain, mask } = packedPose(name);
    const measure = measureGlassStructure(frame, plain, mask);
    expect(measure.E).toBeCloseTo(expected.E, 9);
    expect(measure.E0).toBeCloseTo(expected.E0, 9);
    expect(measure.Eo).toBeCloseTo(expected.Eo, 9);
    expect(meetsGlassMarks(measure, GLASS_MARKS[pose])).toBe(meets);
    // The old mark (glass at luma 6 or more) passed both, the plum panes and the lit street alike.
    expect(measure.shareAtLeast6).toBeGreaterThan(0.98);
  });
});
