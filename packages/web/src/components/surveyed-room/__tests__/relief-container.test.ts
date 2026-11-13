import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseWallRelief } from "../../grand-hall/hall-relief.js";
import { HALL_WALLS } from "../../grand-hall/hall-spec.js";
import { assertReliefIds, isReliefId, parseReliefContainer } from "../relief-container.js";

function shippedRelief(): ArrayBuffer {
  const file = readFileSync(path.resolve("public/rooms/grand-hall/survey-2026-07-11/walls-relief.bin"));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}

interface Entry {
  readonly id: string | readonly number[];
  /** Quantised (u, v, depth) triples. */
  readonly vertices?: readonly number[];
  readonly indices?: readonly number[];
  readonly indexBytes?: number;
  readonly ranges?: readonly number[];
  /** Claimed counts, when they should disagree with the data. */
  readonly vertexCount?: number;
  readonly triangleCount?: number;
}

const align = (offset: number): number => (offset + 3) & ~3;

/** A GHR1 file, written as the tools write it. */
function container(entries: readonly Entry[], count = entries.length): ArrayBuffer {
  const chunks: Uint8Array[] = [];
  const head = new DataView(new ArrayBuffer(8));
  [0x47, 0x48, 0x52, 0x31].forEach((byte, i) => { head.setUint8(i, byte); });
  head.setUint32(4, count, true);
  chunks.push(new Uint8Array(head.buffer));
  for (const entry of entries) {
    const vertices = entry.vertices ?? [0, 0, 0, 65535, 0, 0, 0, 65535, 65535];
    const indices = entry.indices ?? [0, 1, 2];
    const indexBytes = entry.indexBytes ?? 2;
    const header = new DataView(new ArrayBuffer(48));
    const text = entry.id;
    const id = typeof text === "string" ? Array.from({ length: text.length }, (_, i) => text.charCodeAt(i)) : text;
    id.forEach((byte, i) => { header.setUint8(i, byte); });
    header.setUint32(12, entry.vertexCount ?? vertices.length / 3, true);
    header.setUint32(16, entry.triangleCount ?? indices.length / 3, true);
    header.setUint32(20, indexBytes, true);
    (entry.ranges ?? [0, 2, 0, 3, -0.1, 0.1]).forEach((value, i) => { header.setFloat32(24 + i * 4, value, true); });
    chunks.push(new Uint8Array(header.buffer));
    const vertexBytes = new Uint8Array(align(vertices.length * 2));
    new Uint16Array(vertexBytes.buffer, 0, vertices.length).set(vertices);
    chunks.push(vertexBytes);
    const indexData = new Uint8Array(align(indices.length * Math.max(indexBytes, 2)));
    if (indexBytes === 4) new Uint32Array(indexData.buffer, 0, indices.length).set(indices);
    else new Uint16Array(indexData.buffer, 0, indices.length).set(indices);
    chunks.push(indexData);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out.buffer;
}

describe("GHR1 relief container", () => {
  it("reads the Grand Hall's shipped walls-relief.bin exactly as parseWallRelief does", () => {
    const buffer = shippedRelief();
    const hall = parseWallRelief(buffer);
    const room = parseReliefContainer(buffer, { maxEntries: 4 });
    expect([...room.keys()].sort()).toEqual(HALL_WALLS.map((wall) => wall.id).sort());
    for (const wall of HALL_WALLS) {
      const expected = hall.get(wall.id);
      const actual = room.get(wall.id);
      if (expected === undefined || actual === undefined) throw new Error(`no ${wall.id}`);
      expect(actual.id).toBe(wall.id);
      expect(actual.positions.length, wall.id).toBe(expected.positions.length);
      expect(actual.indices.length, wall.id).toBe(expected.indices.length);
      expect(actual.positions.length).toBeGreaterThan(0);
      // Element for element, without a matcher's tolerance.
      expect(actual.positions.every((value, i) => Object.is(value, expected.positions[i])), wall.id).toBe(true);
      expect(actual.indices.every((value, i) => value === expected.indices[i]), wall.id).toBe(true);
    }
    expect(() => { assertReliefIds(room, HALL_WALLS.map((wall) => wall.id)); }).not.toThrow();
  });

  it("reads any 1 to 12 byte ASCII id, with 16- and 32-bit indices", () => {
    const relief = parseReliefContainer(container([
      { id: "fire-r-end" },
      { id: "twelve-bytes", indexBytes: 4 },
      { id: "c" },
    ]));
    expect([...relief.keys()]).toEqual(["fire-r-end", "twelve-bytes", "c"]);
    const mesh = relief.get("twelve-bytes");
    if (mesh === undefined) throw new Error("missing");
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2]);
    expect(Array.from(mesh.positions)).toEqual([0, 0, -0.10000000149011612, 2, 0, -0.10000000149011612, 0, 3, 0.10000000149011612]);
  });

  it("accepts ids by the same rule as the record", () => {
    expect(isReliefId("win-f-end")).toBe(true);
    expect(isReliefId("123456789012")).toBe(true);
    expect(isReliefId("")).toBe(false);
    expect(isReliefId("1234567890123")).toBe(false);
    expect(isReliefId("has space")).toBe(false);
    expect(isReliefId(`caf${String.fromCharCode(0xe9)}`)).toBe(false);
  });

  it.each<[string, () => ArrayBuffer, RegExp, number | null]>([
    ["a file without the magic", () => new Uint8Array([0x47, 0x48, 0x52, 0x32, 0, 0, 0, 0]).buffer, /not a relief file/, null],
    ["a file shorter than its magic and count", () => new Uint8Array([0x47, 0x48]).buffer, /not a relief file/, null],
    ["more entries than allowed", () => container([{ id: "a" }, { id: "b" }]), /2 entries, more than the 1 expected/, 1],
    ["a header cut short", () => container([{ id: "a" }], 2), /truncated header/, null],
    ["an empty id", () => container([{ id: "" }]), /entry 0 has an empty id/, null],
    ["an id with a NUL inside", () => container([{ id: [0x61, 0, 0x62] }]), /NUL inside/, null],
    ["an id that is not ASCII", () => container([{ id: [0x61, 0xe9] }]), /not printable ASCII/, null],
    ["an id given twice", () => container([{ id: "a" }, { id: "a" }]), /entry "a" twice/, null],
    ["an index size of 3 bytes", () => container([{ id: "a", indexBytes: 3 }]), /index size 3/, null],
    ["16-bit indices for more vertices than they reach", () => container([{ id: "a", vertexCount: 70000 }]), /16-bit indices/, null],
    ["a range that does not increase", () => container([{ id: "a", ranges: [0, 2, 3, 3, -0.1, 0.1] }]), /range 3\.\.3/, null],
    ["a range that is not finite", () => container([{ id: "a", ranges: [0, Number.POSITIVE_INFINITY, 0, 3, -0.1, 0.1] }]), /range 0\.\.Infinity/, null],
    ["vertices cut short", () => container([{ id: "a", vertexCount: 300 }], 1), /truncated vertices/, null],
    ["indices cut short", () => container([{ id: "a", triangleCount: 50 }]), /truncated indices/, null],
    ["an index past the vertices", () => container([{ id: "a", indices: [0, 1, 3] }]), /index 3 past 3 vertices/, null],
  ])("refuses %s", (_name, build, message, maxEntries) => {
    const options = { label: "Saloon walls relief", ...(maxEntries === null ? {} : { maxEntries }) };
    expect(() => parseReliefContainer(build(), options)).toThrow(message);
    expect(() => parseReliefContainer(build(), options)).toThrow(/^Saloon walls relief: /);
  });

  it("checks a container holds exactly the expected ids", () => {
    const relief = parseReliefContainer(container([{ id: "front" }, { id: "rear" }]));
    expect(() => { assertReliefIds(relief, ["rear", "front"]); }).not.toThrow();
    expect(() => { assertReliefIds(relief, ["front", "rear", "window"]); }).toThrow(/missing "window"/);
    expect(() => { assertReliefIds(relief, ["front"]); }).toThrow(/unexpected "rear"/);
    expect(() => { assertReliefIds(relief, ["front", "front"]); }).toThrow(/repeat/);
  });
});
