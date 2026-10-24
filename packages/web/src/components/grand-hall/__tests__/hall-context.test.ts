import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CARD as BEYOND_CARD } from "../hall-beyond.js";
import { CARD, CITY_SITE_CUT, CITY_WINDOWS, CONTEXT_COORDINATE_LIMIT, CONTEXT_MODEL_URL, parseContextModel } from "../hall-context.js";
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
