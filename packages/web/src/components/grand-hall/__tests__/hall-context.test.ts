import { readFileSync } from "node:fs";
import path from "node:path";
import type { BufferGeometry } from "three";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CARD as BEYOND_CARD } from "../hall-beyond.js";
import {
  CARD, CITY_SITE_CUT, CITY_WINDOWS, CONTEXT_COORDINATE_LIMIT, CONTEXT_MODEL_FRONT_URL, CONTEXT_MODEL_URL, parseContextModel,
} from "../hall-context.js";
import { FRONT_AXIS_X, FRONT_HALF_WIDTH } from "../hall-exterior-spec.js";
import { HALL_PAVEMENT_Y } from "../hall-site.js";
import { HALL_HALF_LENGTH, HALL_HALF_WIDTH, HALL_WALL_THICKNESS } from "../hall-spec.js";

/** A packed model: 'VVCX', version, counts, int16 cm vertices, uint32 indices. */
function pack(vertices: readonly number[], indices: readonly number[], { version = 1, magic = "VVCX", extra = 0 } = {}): ArrayBuffer {
  const vertexCount = vertices.length / 3;
  const buffer = new ArrayBuffer(16 + vertices.length * 2 + indices.length * 4 + extra);
  const view = new DataView(buffer);
  for (let i = 0; i < 4; i++) view.setUint8(i, magic.charCodeAt(i));
  view.setUint32(4, version, true);
  view.setUint32(8, vertexCount, true);
  view.setUint32(12, indices.length, true);
  vertices.forEach((value, i) => { view.setInt16(16 + i * 2, value, true); });
  const indexOffset = 16 + vertices.length * 2;
  indices.forEach((value, i) => { view.setUint32(indexOffset + i * 4, value, true); });
  return buffer;
}

/** One triangle, centimetres. */
const TRIANGLE = [0, 0, 0, 1000, 0, 0, 0, 250, -1200];

describe("parseContextModel", () => {
  it("reads centimetre vertices into metres and keeps the triangles", () => {
    const geometry = parseContextModel(pack(TRIANGLE, [0, 1, 2]));
    expect(Array.from(geometry.getAttribute("position").array)).toEqual([0, 0, 0, 10, 0, 0, 0, 2.5, -12]);
    expect(Array.from(geometry.getIndex()?.array ?? [])).toEqual([0, 1, 2]);
    expect(geometry.boundingSphere).not.toBeNull();
  });

  it.each([
    ["a truncated header", new ArrayBuffer(8), /truncated header/u],
    ["another file", pack(TRIANGLE, [0, 1, 2], { magic: "GLTF" }), /not a city model/u],
    ["another version", pack(TRIANGLE, [0, 1, 2], { version: 2 }), /version 2/u],
    ["a partial triangle", pack(TRIANGLE, [0, 1]), /3 vertices, 2 indices/u],
    ["trailing bytes", pack(TRIANGLE, [0, 1, 2], { extra: 4 }), /bytes, expected/u],
    ["an index past the vertices", pack(TRIANGLE, [0, 1, 3]), /index 3 past 3 vertices/u],
    ["a coordinate beyond the city", pack([0, 0, 0, 32_100, 0, 0, 0, 0, 100], [0, 1, 2]), /coordinate 321 m/u],
  ])("refuses %s", (_name, buffer, message) => {
    expect(() => parseContextModel(buffer)).toThrow(message);
  });

  it("reads the published city model whole, as its provenance counts it", () => {
    const file = path.resolve("public", CONTEXT_MODEL_URL.replace(/^\//u, "").replace(/\?.*$/u, ""));
    const bytes = readFileSync(file);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const geometry = parseContextModel(buffer);
    const provenance: unknown = JSON.parse(readFileSync(file.replace(/\.bin$/u, ".json"), "utf8"));
    const counts = typeof provenance === "object" && provenance !== null && "counts" in provenance ? provenance.counts : null;
    expect(counts).toMatchObject({
      triangles: (geometry.getIndex()?.count ?? 0) / 3,
      vertices: geometry.getAttribute("position").count,
      bytes_raw: bytes.byteLength,
    });
  });
});

describe("the hall's site in the city", () => {
  const file = path.resolve("public", CONTEXT_MODEL_URL.replace(/^\//u, "").replace(/\?.*$/u, ""));

  it("is cut from the window wall's outer face to the back, as the published model's provenance says", () => {
    const provenance: unknown = JSON.parse(readFileSync(file.replace(/\.bin$/u, ".json"), "utf8"));
    const parameters = typeof provenance === "object" && provenance !== null && "parameters" in provenance ? provenance.parameters : null;
    expect(parameters).toMatchObject({ rect_half_x: CITY_SITE_CUT.halfX, rect_front_z: CITY_SITE_CUT.front, rect_half_z: CITY_SITE_CUT.back });
    // The street face: the room's plane plus the window wall's thickness (z -6.245), the cut 5 mm under the
    // wall's foot on the model's centimetre grid, never a crack in front of it.
    const streetFace = -(HALL_HALF_WIDTH + HALL_WALL_THICKNESS.window.thickness);
    expect(CITY_SITE_CUT.front).toBeGreaterThan(streetFace);
    expect(CITY_SITE_CUT.front - streetFace).toBeLessThan(0.01);
    expect(CITY_SITE_CUT.halfX).toBeGreaterThan(HALL_HALF_LENGTH);
  });

  it("emits nothing inside the cut, and its caps at the floor reach its street edge", () => {
    const bytes = readFileSync(file);
    const geometry = parseContextModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const p = geometry.getAttribute("position");
    let inside = 0;
    let onStreetEdge = 0;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      if (Math.abs(x) < CITY_SITE_CUT.halfX - 1e-3 && z > CITY_SITE_CUT.front + 1e-3 && z < CITY_SITE_CUT.back - 1e-3) inside += 1;
      if (Math.abs(x) <= CITY_SITE_CUT.halfX + 1e-3 && Math.abs(z - CITY_SITE_CUT.front) < 1e-3 && Math.abs(p.getY(i)) < 1e-3) onStreetEdge += 1;
    }
    expect(inside).toBe(0);
    expect(onStreetEdge).toBeGreaterThanOrEqual(2);
  });

  it("shares its white card with the hall's Atelier section, which imports it", () => {
    expect(BEYOND_CARD).toBe(CARD);
    expect(CARD.wall).toEqual([0.86, 0.82, 0.76]);
  });
});

const pair = z.tuple([z.number(), z.number()]);
/** What the v3 tests read of merchant-city-v3.json (build_context.py --front-cut). */
const frontProvenanceSchema = z.object({
  counts: z.object({ triangles: z.number(), vertices: z.number(), bytes_raw: z.number() }),
  licence: z.object({ attribution: z.string() }),
  parameters: z.object({
    rect_half_x: z.number(), rect_front_z: z.number(), rect_half_z: z.number(), centre_local: pair, frame_bearing_deg: z.number(),
    front_cut_x: pair, front_cut_z: pair, ground_y: z.number(),
  }),
  street_fronts: z.object({
    runs: z.array(z.object({
      side: z.enum(["north", "south"]),
      segments: z.array(z.object({
        id: z.string(), line: z.object({ point: pair, direction: pair }), ends: z.tuple([pair, pair]), length_m: z.number(),
        walls: z.object({ max_deviation_m: z.number().nullable() }),
      })),
    })),
  }),
});
type FrontSegment = z.infer<typeof frontProvenanceSchema>["street_fronts"]["runs"][number]["segments"][number];

function readModel(url: string): { geometry: BufferGeometry; bytes: Buffer; json: unknown } {
  const file = path.resolve("public", url.replace(/^\//u, "").replace(/\?.*$/u, ""));
  const bytes = readFileSync(file);
  const geometry = parseContextModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const json: unknown = JSON.parse(readFileSync(file.replace(/\.bin$/u, ".json"), "utf8"));
  return { geometry, bytes, json };
}

type Vertex = readonly [number, number, number];
type Triangle = readonly [Vertex, Vertex, Vertex];

/** A model's triangles as vertex triples, metres. */
function triangles(geometry: BufferGeometry): Triangle[] {
  const p = geometry.getAttribute("position");
  const index = geometry.getIndex();
  if (index === null) throw new Error("the model is indexed");
  const vertex = (i: number): Vertex => [p.getX(i), p.getY(i), p.getZ(i)];
  const out: Triangle[] = [];
  for (let t = 0; t < index.count; t += 3) out.push([vertex(index.getX(t)), vertex(index.getX(t + 1)), vertex(index.getX(t + 2))]);
  return out;
}

/**
 * The walls facing the street along a straightened segment (horizontal
 * normal within 30 degrees of its street side, centre within 1 m of its line
 * and between its ends), and their vertices' largest offset from the line.
 */
function streetWalls(tris: readonly Triangle[], segment: FrontSegment): { count: number; worst: number } {
  const [cx, cz] = segment.line.point;
  const [dx, dz] = segment.line.direction;
  const [nx, nz] = [-dz, dx];
  const along = (x: number, z: number): number => (x - cx) * dx + (z - cz) * dz;
  const across = (x: number, z: number): number => (x - cx) * nx + (z - cz) * nz;
  const [t0, t1] = segment.ends.map(([x, z]) => along(x, z)).sort((a, b) => a - b) as [number, number];
  let count = 0;
  let worst = 0;
  for (const [a, b, c] of tris) {
    const e1: Vertex = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2: Vertex = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n: Vertex = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const horizontal = Math.hypot(n[0], n[2]);
    if (horizontal < 1e-9 || Math.abs(n[1]) > 1e-3 * horizontal) continue;
    if ((-(n[0] * nx) - n[2] * nz) / horizontal < Math.cos(Math.PI / 6)) continue;
    const mx = (a[0] + b[0] + c[0]) / 3;
    const mz = (a[2] + b[2] + c[2]) / 3;
    if (along(mx, mz) <= t0 + 0.01 || along(mx, mz) >= t1 - 0.01 || Math.abs(across(mx, mz)) >= 1) continue;
    count += 1;
    for (const v of [a, b, c]) worst = Math.max(worst, Math.abs(across(v[0], v[2])));
  }
  return { count, worst };
}

describe("the city drawn round the measured front (merchant-city-v3)", () => {
  const front = readModel(CONTEXT_MODEL_FRONT_URL);
  const provenance = frontProvenanceSchema.parse(front.json);
  const tris = triangles(front.geometry);
  const { front_cut_x: [fx0, fx1], front_cut_z: [fz0, fz1] } = provenance.parameters;

  it("reads whole, as its provenance counts it, in v2's frame and registration and under its licence", () => {
    expect(provenance.counts).toMatchObject({
      triangles: (front.geometry.getIndex()?.count ?? 0) / 3,
      vertices: front.geometry.getAttribute("position").count,
      bytes_raw: front.bytes.byteLength,
    });
    const v2 = z.object({ parameters: z.object({ centre_local: pair, frame_bearing_deg: z.number() }) }).parse(readModel(CONTEXT_MODEL_URL).json);
    expect(provenance.parameters.centre_local).toEqual(v2.parameters.centre_local);
    expect(provenance.parameters.frame_bearing_deg).toBe(v2.parameters.frame_bearing_deg);
    expect(provenance.licence.attribution).toMatch(/Crown copyright Scottish Government and Fugro \(2020\), OGL v3\.0/u);
  });

  it("keeps the hall's own cut exactly as v2 has it, with nothing inside", () => {
    expect(provenance.parameters).toMatchObject({ rect_half_x: CITY_SITE_CUT.halfX, rect_front_z: CITY_SITE_CUT.front, rect_half_z: CITY_SITE_CUT.back });
    const p = front.geometry.getAttribute("position");
    let inside = 0;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const zc = p.getZ(i);
      if (Math.abs(x) < CITY_SITE_CUT.halfX - 1e-3 && zc > CITY_SITE_CUT.front + 1e-3 && zc < CITY_SITE_CUT.back - 1e-3) inside += 1;
    }
    expect(inside).toBe(0);
  });

  it("cuts the modelled front's footprint 2-3 cm wider at each end, from just behind its back out into the street", () => {
    expect(FRONT_AXIS_X - FRONT_HALF_WIDTH - fx0).toBeGreaterThanOrEqual(0.02);
    expect(FRONT_AXIS_X - FRONT_HALF_WIDTH - fx0).toBeLessThanOrEqual(0.03);
    expect(fx1 - (FRONT_AXIS_X + FRONT_HALF_WIDTH)).toBeGreaterThanOrEqual(0.02);
    expect(fx1 - (FRONT_AXIS_X + FRONT_HALF_WIDTH)).toBeLessThanOrEqual(0.03);
    // The front's back is the room's plane (z -5.295): the cut stands 5 mm behind it.
    expect(fz1).toBeGreaterThan(-HALL_HALF_WIDTH);
    expect(fz1 + HALL_HALF_WIDTH).toBeLessThan(0.01);
    expect(fz0).toBeLessThanOrEqual(-12);
  });

  it("holds nothing above the pavement inside the front cut, and the pavement is there", () => {
    const p = front.geometry.getAttribute("position");
    let inside = 0;
    let raised = 0;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const zc = p.getZ(i);
      if (x > fx0 + 0.005 && x < fx1 - 0.005 && zc > fz0 + 0.005 && zc < fz1 - 0.005) {
        inside += 1;
        if (p.getY(i) > HALL_PAVEMENT_Y + 0.01) raised += 1;
      }
    }
    expect(raised).toBe(0);
    expect(inside).toBeGreaterThan(0);
    // Straight down at points across it (before the door, before both end bays, at its far corners): the highest
    // surface of the model is the pavement.
    const onTriangle = (x: number, zc: number, [a, b, c]: Triangle): boolean => {
      const d = (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]);
      if (Math.abs(d) < 1e-12) return false;
      const s = ((x - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (zc - a[2])) / d;
      const t = ((b[0] - a[0]) * (zc - a[2]) - (x - a[0]) * (b[2] - a[2])) / d;
      return s >= -1e-9 && t >= -1e-9 && s + t <= 1 + 1e-9;
    };
    for (const [x, zc] of [[FRONT_AXIS_X, -7.0], [FRONT_AXIS_X, -9.5], [-13.4, -5.8], [13.4, -5.8], [-15.2, -11.8], [15.2, -6.0]] as const) {
      const below = tris.filter((tri) => tri.every((v) => Math.abs(v[1] - tri[0][1]) < 1e-6) && onTriangle(x, zc, tri)).map((tri) => tri[0][1]);
      expect(below.length, `${String(x)}, ${String(zc)}`).toBeGreaterThan(0);
      expect(Math.max(...below), `${String(x)}, ${String(zc)}`).toBeCloseTo(HALL_PAVEMENT_Y, 6);
    }
    // The blocks beside it end in section walls on the cut's edges.
    const onEdge = (edge: number): number => {
      let count = 0;
      for (let i = 0; i < p.count; i++) if (Math.abs(p.getX(i) - edge) < 0.005 && Math.abs(p.getY(i)) < 0.005 && p.getZ(i) > fz0 && p.getZ(i) < fz1) count += 1;
      return count;
    };
    expect(onEdge(fx0)).toBeGreaterThanOrEqual(2);
    expect(onEdge(fx1)).toBeGreaterThanOrEqual(2);
  });

  it("draws the neighbours' Glassford Street fronts beside it as straight walls, within 2 cm of their lines", () => {
    const segments = provenance.street_fronts.runs.flatMap((run) => run.segments);
    for (const side of ["north", "south"] as const) {
      const run = provenance.street_fronts.runs.find((entry) => entry.side === side);
      expect(run, side).toBeDefined();
      // From the front cut out to the clamp's edge, 44-45 m from the hall's centre.
      expect(run?.segments.reduce((sum, segment) => sum + segment.length_m, 0) ?? 0, side).toBeGreaterThan(25);
    }
    for (const segment of segments) {
      const { count, worst } = streetWalls(tris, segment);
      expect(count, segment.id).toBeGreaterThanOrEqual(2);
      expect(worst, segment.id).toBeLessThanOrEqual(0.02);
      expect(segment.walls.max_deviation_m ?? 1, segment.id).toBeLessThanOrEqual(0.02);
      // Along the street, as a building front runs.
      expect(Math.abs(Math.atan2(segment.line.direction[1], segment.line.direction[0])) * 180 / Math.PI, segment.id).toBeLessThanOrEqual(5);
    }
    // The same measure finds v2's stair-steps there.
    const v2 = triangles(readModel(CONTEXT_MODEL_URL).geometry);
    expect(Math.max(...segments.map((segment) => streetWalls(v2, segment).worst))).toBeGreaterThan(0.1);
  });
});

describe("the city's lit windows", () => {
  it("hash whole-number seeds above zero and below 2^24 anywhere the reader accepts", () => {
    // three's hash reads its seed as an unsigned integer: a negative seed reads
    // as 0 (every window lit across half the city), and a float holds whole
    // numbers exactly only below 2^24.
    const { width, storey, firstStorey, across, blockWidth, block, offset, stride } = CITY_WINDOWS;
    const limit = CONTEXT_COORDINATE_LIMIT;
    // The furthest cells: along a wall at most |(x, z)| from the centre, a storey
    // anywhere from the lowest to the highest coordinate, a block across x + z.
    const cell = Math.ceil((limit * Math.SQRT2) / width) + 1;
    const level = Math.ceil((limit + Math.abs(HALL_PAVEMENT_Y) + firstStorey) / storey) + 1;
    const blocks = Math.ceil((2 * limit) / blockWidth) + 1;
    const spread = cell + level * across + blocks * block;
    expect(offset - spread).toBeGreaterThan(0);
    // Four values a window (lit, brightness, tint, the night look's accent):
    // the seed and the three after it, all within its stride.
    expect((offset + spread) * stride + stride - 1).toBeLessThan(2 ** 24);
    expect(stride).toBeGreaterThanOrEqual(4);
  });
});
