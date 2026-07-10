import { describe, expect, it } from "vitest";
import {
  FIRST_TABLE,
  INK_WINDOW,
  buildFirstTableStrokes,
  drawnSegments,
  penHead,
  strokesToInkGeometry,
} from "../gold-ink.js";

// ---------------------------------------------------------------------------
// The pen is deterministic: the storyboard fixes stroke counts, order, and
// constant-speed mapping. These tests pin the drawing to the storyboard
// (docs/superpowers/specs/2026-07-10-dressing-storyboard.md).
// ---------------------------------------------------------------------------

const strokes = buildFirstTableStrokes();
const ink = strokesToInkGeometry(strokes);

describe("the storyboard's stroke inventory", () => {
  it("draws beats in order: cloth → settings → centre → company", () => {
    const beats = strokes.map((s) => s.beat);
    const firstIndexOf = (b: string): number => beats.indexOf(b as never);
    expect(firstIndexOf("cloth")).toBe(0);
    expect(firstIndexOf("cloth")).toBeLessThan(firstIndexOf("settings"));
    expect(firstIndexOf("settings")).toBeLessThan(firstIndexOf("centre"));
    expect(firstIndexOf("centre")).toBeLessThan(firstIndexOf("company"));
  });

  it("matches the storyboard counts: 12 cloth, 16 settings, 3 centre, 48 company", () => {
    const count = (b: string): number => strokes.filter((s) => s.beat === b).length;
    expect(count("cloth")).toBe(12);
    expect(count("settings")).toBe(FIRST_TABLE.covers * 2);
    expect(count("centre")).toBe(3);
    expect(count("company")).toBe(FIRST_TABLE.covers * 6);
  });

  it("keeps every point finite and inside the room band", () => {
    for (const s of strokes) {
      for (const [x, y, z] of s.points) {
        expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)).toBe(true);
        expect(y).toBeGreaterThanOrEqual(FIRST_TABLE.floorY - 1e-9);
        expect(y).toBeLessThanOrEqual(0);
        expect(Math.hypot(x - FIRST_TABLE.centre[0], z - FIRST_TABLE.centre[2])).toBeLessThan(2.5);
      }
    }
  });

  it("plates sit on the tabletop, chairs stand on the floor", () => {
    const settings = strokes.filter((s) => s.beat === "settings");
    for (const s of settings) {
      for (const [, y] of s.points) expect(y).toBeGreaterThanOrEqual(FIRST_TABLE.tabletopY);
    }
    const legs = strokes.filter((s) => s.beat === "company" && s.points.length === 2);
    for (const leg of legs) {
      const ys = leg.points.map((p) => p[1]);
      expect(Math.min(...ys)).toBeCloseTo(FIRST_TABLE.floorY, 6);
    }
  });
});

describe("constant pen speed", () => {
  it("cumulative lengths are strictly increasing to the total", () => {
    let prev = 0;
    for (const l of ink.cumulativeLengths) {
      expect(l).toBeGreaterThan(prev);
      prev = l;
    }
    expect(prev).toBeCloseTo(ink.totalLength, 9);
  });

  it("draws nothing before the window and everything after it", () => {
    expect(drawnSegments(ink, 0)).toBe(0);
    expect(drawnSegments(ink, INK_WINDOW.start)).toBe(0);
    expect(drawnSegments(ink, INK_WINDOW.end)).toBe(ink.segmentCount);
    expect(drawnSegments(ink, 1)).toBe(ink.segmentCount);
  });

  it("progress is monotonic and length-weighted (half the ink at half the window)", () => {
    let prev = 0;
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const n = drawnSegments(ink, Math.min(1, p));
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
    const mid = drawnSegments(ink, (INK_WINDOW.start + INK_WINDOW.end) / 2);
    const midLength = ink.cumulativeLengths[mid - 1] ?? 0;
    expect(midLength / ink.totalLength).toBeGreaterThan(0.45);
    expect(midLength / ink.totalLength).toBeLessThan(0.55);
  });
});

describe("the pen nib", () => {
  it("is absent before drawing and after completion", () => {
    expect(penHead(ink, 0)).toBeNull();
    expect(penHead(ink, ink.segmentCount + 1)).toBeNull();
  });

  it("rides the last drawn segment mid-drawing", () => {
    const mid = Math.floor(ink.segmentCount / 2);
    const head = penHead(ink, mid);
    expect(head).not.toBeNull();
    if (head !== null) {
      expect(Number.isFinite(head[0])).toBe(true);
      expect(Math.hypot(head[0] - FIRST_TABLE.centre[0], head[2] - FIRST_TABLE.centre[2])).toBeLessThan(2.5);
    }
  });
});
