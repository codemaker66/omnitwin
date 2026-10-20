import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ShapeUtils, Vector2 } from "three";
import {
  BEYOND_SPACES,
  LANDING_BALUSTRADE,
  SALOON_DADO,
  distanceToDoorway,
  doorwayFace,
  insideOutline,
  parseFirstFloor,
  type PlanPoint,
} from "../hall-neighbours.js";
import { bodyOutline } from "../hall-wall-body.js";
import { plinthOutline } from "../hall-section.js";
import { HALL_DOORS, HALL_WALL_THICKNESS } from "../hall-spec.js";

const SURVEY = path.resolve("../../tools/grand-hall-survey");

interface ProvenanceDoor {
  readonly opening: string;
  readonly reach: number;
  readonly floorLevel: number | null;
  readonly floor: [number, number][];
  readonly holes: [number, number][][];
  readonly well?: [number, number][];
  readonly source: string;
}

interface Provenance {
  readonly doors: ProvenanceDoor[];
  readonly balustrade: {
    railTop: number; railZ: [number, number];
    newels: { x: [number, number]; z: [number, number]; top: number }[];
    balusters: { centres: number[]; width: number; z: number };
  };
  readonly saloonPanelling: { west: { plaster: number }; east: { plaster: number; top: number; proud: number } };
}

const provenance = JSON.parse(readFileSync(path.join(SURVEY, "measure/beyond-doors.json"), "utf8")) as Provenance;
const firstFloorJson: unknown = JSON.parse(readFileSync(path.resolve("public/rooms/grand-hall/survey-2026-07-11/first-floor-2010.json"), "utf8"));

/** Whether two segments cross (not merely touch at a shared end). */
function crosses(a: PlanPoint, b: PlanPoint, c: PlanPoint, d: PlanPoint): boolean {
  const orient = (p: PlanPoint, q: PlanPoint, r: PlanPoint): number => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = orient(c, d, a);
  const d2 = orient(c, d, b);
  const d3 = orient(a, b, c);
  const d4 = orient(a, b, d);
  return ((d1 > 1e-12 && d2 < -1e-12) || (d1 < -1e-12 && d2 > 1e-12)) && ((d3 > 1e-12 && d4 < -1e-12) || (d3 < -1e-12 && d4 > 1e-12));
}

/** A simple closed polygon: three or more points, no repeated point, a non-zero area, no two edges crossing. */
function expectClosedSimple(outline: readonly PlanPoint[], label: string): void {
  expect(outline.length, label).toBeGreaterThanOrEqual(3);
  let area = 0;
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i];
    const q = outline[(i + 1) % outline.length];
    if (p === undefined || q === undefined) throw new Error("ring");
    expect(Math.hypot(q[0] - p[0], q[1] - p[1]), `${label} edge ${String(i)}`).toBeGreaterThan(1e-4);
    area += p[0] * q[1] - q[0] * p[1];
  }
  expect(Math.abs(area) / 2, label).toBeGreaterThan(0.01);
  for (let i = 0; i < outline.length; i++) {
    for (let j = i + 2; j < outline.length; j++) {
      if (i === 0 && j === outline.length - 1) continue;
      const a = outline[i];
      const b = outline[(i + 1) % outline.length];
      const c = outline[j];
      const d = outline[(j + 1) % outline.length];
      if (a === undefined || b === undefined || c === undefined || d === undefined) continue;
      expect(crosses(a, b, c, d), `${label} edges ${String(i)} and ${String(j)} cross`).toBe(false);
    }
  }
}

/** The centroids of a polygon's triangles (three's earcut, as the beyond's geometry triangulates it). */
function triangleCentroids(outline: readonly PlanPoint[], holes: readonly (readonly PlanPoint[])[] = []): PlanPoint[] {
  const contour = outline.map(([x, z]) => new Vector2(x, z));
  const holeRings = holes.map((hole) => hole.map(([x, z]) => new Vector2(x, z)));
  const points = [...contour, ...holeRings.flat()];
  return ShapeUtils.triangulateShape(contour, holeRings).map(([i, j, k]) => {
    const a = points[i ?? -1];
    const b = points[j ?? -1];
    const c = points[k ?? -1];
    if (a === undefined || b === undefined || c === undefined) throw new Error("triangle");
    return [(a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3];
  });
}

describe("the spaces beyond the doors", () => {
  it("are the measured ones, each with its provenance", () => {
    expect(BEYOND_SPACES.map((space) => space.opening)).toEqual(HALL_DOORS.map((door) => door.opening));
    for (const space of BEYOND_SPACES) {
      const measured = provenance.doors.find((door) => door.opening === space.opening);
      expect(measured, space.opening).toBeDefined();
      if (measured === undefined) continue;
      expect(space.floor).toEqual(measured.floor);
      expect(measured.holes).toEqual([]);
      expect(space.well).toEqual(measured.well ?? null);
      expect(space.reach).toBe(measured.reach);
      expect(space.scanLevel).toBe(measured.floorLevel);
      expect(space.source.length).toBeGreaterThan(40);
      expect(measured.source.length).toBeGreaterThan(40);
    }
    // The scan saw beyond the end and main doors; only the plan beyond the other two.
    expect(BEYOND_SPACES.filter((space) => space.scanLevel !== null).map((space) => space.label)).toEqual(["D1", "D2"]);
  });

  it("are closed, simple polygons", () => {
    for (const space of BEYOND_SPACES) {
      expectClosedSimple(space.floor, `${space.label} floor`);
      if (space.well !== null) expectClosedSimple(space.well, `${space.label} well`);
    }
  });

  it("meet each doorway's outer face across its whole width, within 2 cm", () => {
    for (const space of BEYOND_SPACES) {
      const face = doorwayFace(space.opening);
      const width = Math.hypot(face.b[0] - face.a[0], face.b[1] - face.a[1]);
      for (let s = 0.01; s <= width - 0.01; s += 0.02) {
        const t = s / width;
        const p: PlanPoint = [face.a[0] + (face.b[0] - face.a[0]) * t, face.a[1] + (face.b[1] - face.a[1]) * t];
        // Just beyond the face, the floor; 2 cm back into the doorway, none: its edge is within 2 cm of the face.
        const beyond: PlanPoint = [p[0] + face.outward[0] * 0.001, p[1] + face.outward[1] * 0.001];
        expect(insideOutline(space.floor, beyond), `${space.label} at ${s.toFixed(2)} m`).toBe(true);
        const behind: PlanPoint = [p[0] - face.outward[0] * 0.02, p[1] - face.outward[1] * 0.02];
        expect(insideOutline(space.floor, behind), `${space.label} reaches into the doorway at ${s.toFixed(2)} m`).toBe(false);
      }
      expect(distanceToDoorway(face, face.centre)).toBe(0);
    }
  });

  it("never stand where the hall's bodies stand", () => {
    const body = bodyOutline();
    for (const space of BEYOND_SPACES) {
      for (const centroid of triangleCentroids(space.floor)) {
        expect(insideOutline(body, centroid), `${space.label} at ${centroid.map((v) => v.toFixed(3)).join(", ")}`).toBe(false);
      }
    }
  });

  it("keep the landing's balustrade and the Saloon's dado as the scan measured them", () => {
    const b = provenance.balustrade;
    expect(LANDING_BALUSTRADE.railTop).toBe(b.railTop);
    expect([...LANDING_BALUSTRADE.railZ]).toEqual(b.railZ);
    LANDING_BALUSTRADE.newels.forEach((newel, i) => {
      expect([...newel.x]).toEqual(b.newels[i]?.x);
      expect([...newel.z]).toEqual(b.newels[i]?.z);
      expect(newel.top).toBe(b.newels[i]?.top);
    });
    expect(LANDING_BALUSTRADE.balusters.width).toBe(b.balusters.width);
    expect(LANDING_BALUSTRADE.balusters.z).toBe(b.balusters.z);
    // The first and last balusters the mesh resolves inside the newels, at its pitch.
    expect(b.balusters.centres).toContain(LANDING_BALUSTRADE.balusters.first);
    expect(b.balusters.centres).toContain(LANDING_BALUSTRADE.balusters.last);
    const pitch = (LANDING_BALUSTRADE.balusters.last - LANDING_BALUSTRADE.balusters.first) / (LANDING_BALUSTRADE.balusters.count - 1);
    expect(pitch).toBeCloseTo(0.144, 3);
    expect(SALOON_DADO.top).toBe(provenance.saloonPanelling.east.top);
    expect(SALOON_DADO.proud).toBe(provenance.saloonPanelling.east.proud);
  });

  it("put the Saloon's face of the door wall within 3 cm of the scan", () => {
    // The scan's plaster either side of the end door, from the door wall's outer face (its 1.14 m).
    expect(HALL_WALL_THICKNESS.door.thickness).toBe(1.14);
    expect(Math.abs(provenance.saloonPanelling.west.plaster)).toBeLessThanOrEqual(0.03);
    expect(Math.abs(provenance.saloonPanelling.east.plaster)).toBeLessThanOrEqual(0.03);
  });
});

describe("the first floor from the 2010 plan", () => {
  const plan = parseFirstFloor(firstFloorJson);

  it("reads the published plan, every polygon with the plan's paths it came from", () => {
    expect(plan.walls.length).toBeGreaterThan(10);
    expect(plan.floor.length).toBeGreaterThan(0);
    expect(plan.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    for (const polygon of [...plan.walls, ...plan.floor]) {
      expect(polygon.source).toMatch(/^FIRST 2010\.pdf p1/);
      expectClosedSimple(polygon.outline, polygon.id);
    }
    for (const wall of plan.walls) expect(wall.source).toMatch(/drawing paths \d/);
  });

  it("is registered to the scanned Saloon's walls within 0.3 m", () => {
    const saloon = plan.residuals.saloon;
    expect(saloon).toBeDefined();
    expect(saloon?.metres ?? 0).toBeGreaterThan(20);
    expect(saloon?.median ?? 1).toBeLessThanOrEqual(0.3);
    expect(saloon?.p90 ?? 1).toBeLessThanOrEqual(0.3);
    // The hall itself, which every other figure is measured from, closer still.
    expect(plan.residuals.hall?.median ?? 1).toBeLessThanOrEqual(0.06);
  });

  it("never reaches the hall's bodies or its plinth ring", () => {
    const ring = plinthOutline();
    for (const polygon of [...plan.walls, ...plan.floor]) {
      for (const centroid of triangleCentroids(polygon.outline, polygon.holes)) {
        expect(insideOutline(ring, centroid), `${polygon.id} at ${centroid.map((v) => v.toFixed(3)).join(", ")}`).toBe(false);
      }
    }
  });

  it("rejects a malformed file", () => {
    expect(() => parseFirstFloor({})).toThrow(/first floor/);
    const base = firstFloorJson as Record<string, unknown>;
    expect(() => parseFirstFloor({ ...base, version: 2 })).toThrow(/first floor/);
    const walls = [{ id: "w", outline: [[0, 0], [1, 0], [999, 1]], holes: [], source: "x" }];
    expect(() => parseFirstFloor({ ...base, walls })).toThrow(/first floor/);
  });
});
