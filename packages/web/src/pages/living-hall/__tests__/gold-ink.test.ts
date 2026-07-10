import { describe, expect, it } from "vitest";
import { TRADES_HALL_ROOM_CAPACITIES } from "../../../lib/trades-hall-venue-truth.js";
import {
  FIRST_TABLE,
  INK_WINDOW,
  buildDressingProgram,
  buildFirstTableStrokes,
  drawnSegments,
  elementSegmentEnds,
  penHead,
  seatsAtSegments,
  strokesToInkGeometry,
  type DressingEventType,
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

describe("dressing programs — beat two, figures from venue truth only", () => {
  const caps = TRADES_HALL_ROOM_CAPACITIES["reception-room"];

  it("wedding: the full first table then six shorthand rounds — 56 seats under the dinner ceiling", () => {
    const program = buildDressingProgram("wedding", caps);
    expect(program.totalSeats).toBe(56);
    expect(program.elements).toHaveLength(7);
    expect(program.seatCeiling).toBe(caps.dinner);
    expect(program.ceilingFormat).toBe("dinner");
    // The opener is beat one verbatim: same strokes prefix.
    const opener = buildFirstTableStrokes();
    expect(program.strokes.slice(0, opener.length)).toEqual(opener);
  });

  it("dinner: two banquets of fifteen a side — exactly the dinner ceiling", () => {
    const program = buildDressingProgram("dinner", caps);
    expect(program.totalSeats).toBe(60);
    expect(program.totalSeats).toBe(caps.dinner);
    expect(program.ceilingFormat).toBe("dinner");
  });

  it("conference: eight rows of ten — exactly the theatre ceiling", () => {
    const program = buildDressingProgram("conference", caps);
    expect(program.totalSeats).toBe(80);
    expect(program.totalSeats).toBe(caps.theatre);
    expect(program.ceilingFormat).toBe("theatre");
  });

  it("no program ever exceeds its venue-truth ceiling", () => {
    for (const t of ["wedding", "dinner", "conference"] as DressingEventType[]) {
      const program = buildDressingProgram(t, caps);
      expect(program.totalSeats).toBeLessThanOrEqual(program.seatCeiling);
    }
  });

  it("the tick counts from zero to the full total, monotonically", () => {
    for (const t of ["wedding", "dinner", "conference"] as DressingEventType[]) {
      const program = buildDressingProgram(t, caps);
      const geometry = strokesToInkGeometry(program.strokes);
      const ends = elementSegmentEnds(program);
      expect(seatsAtSegments(program, ends, 0)).toBe(0);
      expect(seatsAtSegments(program, ends, geometry.segmentCount)).toBe(program.totalSeats);
      let prev = 0;
      for (let p = 0; p <= 1.0001; p += 0.02) {
        const seats = seatsAtSegments(program, ends, drawnSegments(geometry, Math.min(1, p)));
        expect(seats).toBeGreaterThanOrEqual(prev);
        prev = seats;
      }
    }
  });

  it("element segment ends align with the geometry's segment count", () => {
    const program = buildDressingProgram("wedding", caps);
    const geometry = strokesToInkGeometry(program.strokes);
    const ends = elementSegmentEnds(program);
    expect(ends[ends.length - 1]).toBe(geometry.segmentCount);
    for (let i = 1; i < ends.length; i++) {
      expect(ends[i] ?? 0).toBeGreaterThan(ends[i - 1] ?? 0);
    }
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
