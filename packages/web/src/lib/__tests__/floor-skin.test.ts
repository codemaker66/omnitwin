import { describe, expect, it } from "vitest";
import { Vector3, Vector4 } from "three";
import {
  FloorSkinManifestSchema, captureToMaskMatrix, decodeFloorHeights, floorColourGain,
  floorSkinManifestUrl, floorSkinTier, floorSkinTileGeometry, type FloorSkinManifest,
} from "../floor-skin.js";

// A 4 m × 2 m floor on z = 1 in the capture frame, 1 cm texels, axes aligned:
// u runs along +y, v along +x, as in the Grand Hall package.
const manifest: FloorSkinManifest = FloorSkinManifestSchema.parse({
  schema: "venviewer.floor-skin.v1", venue: "trades-hall", room: "grand-hall", frame: "capture",
  provenance: { kind: "measured-photographic", arm: "A", source: "test", built: "2026-09-28T00:00:00Z", inputs: {} },
  grid: { widthPx: 400, heightPx: 200, texelM: 0.01, origin: [0, 0, 1], uAxis: [0, 0.01, 0], vAxis: [0.01, 0, 0] },
  plane: { normal: [0, 0, 1], d: 1 },
  tiles: [{ col0: 0, row0: 0, cols: 200, rows: 200 }, { col0: 200, row0: 0, cols: 200, rows: 200 }],
  tiers: { high: { size: 200, files: ["h0.webp", "h1.webp"] }, medium: { size: 100, files: ["m0.webp", "m1.webp"] }, low: { size: 50, files: ["l0.webp", "l1.webp"] } },
  height: { file: "height-5cm.i16", cols: 80, rows: 40, cellPx: 5, unitM: 0.0001, outside: -32768 },
  slab: { file: "slab.u8", width: 8, height: 4, below: 0.15, above: 0.12 },
  colour: { matched: [0.7, 0.6, 0.65] },
  files: {},
});

describe("floor-skin package (T-639)", () => {
  it("resolves a room's package beside its splat tiles, and nothing for other rooms", () => {
    expect(floorSkinManifestUrl("grand-hall", undefined)).toBe("/splats/trades-hall/grand-hall/floor-skin/v1/floor-skin.json");
    expect(floorSkinManifestUrl("grand-hall", "https://cdn.example/splats/")).toBe("https://cdn.example/splats/trades-hall/grand-hall/floor-skin/v1/floor-skin.json");
    expect(floorSkinManifestUrl("saloon", undefined)).toBeNull();
  });

  it("chooses texture tiers by device tier", () => {
    expect(floorSkinTier("high")).toBe("high");
    expect(floorSkinTier("medium")).toBe("medium");
    expect(floorSkinTier("low")).toBe("low");
    expect(floorSkinTier("poster")).toBe("low");
  });

  it("maps a capture-frame point to mask coordinates and plane distance", () => {
    const m = captureToMaskMatrix(manifest);
    // Texel (col 100, row 50) centre is at y = 1.005, x = 0.505; 0.05 m above the plane.
    const q = new Vector4(0.505, 1.005, 1.05, 1).applyMatrix4(m);
    expect(q.x).toBeCloseTo(100.5 / 400, 6);
    expect(q.y).toBeCloseTo(50.5 / 200, 6);
    expect(q.z).toBeCloseTo(0.05, 6);
  });

  it("decodes the height grid and refuses a truncated one", () => {
    const heights = new Int16Array(80 * 40).fill(123);
    expect(decodeFloorHeights(heights.buffer, manifest)[0]).toBe(123);
    expect(() => decodeFloorHeights(new ArrayBuffer(10), manifest)).toThrow("height grid");
  });

  it("builds a tile whose triangles face along the plane normal and follow the height grid", () => {
    const heights = new Int16Array(80 * 40).fill(500); // +0.05 m everywhere
    const geometry = floorSkinTileGeometry(manifest, 1, heights, 50);
    const position = geometry.getAttribute("position");
    const uv = geometry.getAttribute("uv");
    const index = geometry.getIndex();
    if (index === null) throw new Error("expected indexed geometry");
    // Tile 1 spans cols 200..400 in steps of 50 (5 columns) and rows 0..200 (5 rows).
    expect(position.count).toBe(25);
    expect(position.getZ(0)).toBeCloseTo(1.05, 6);
    expect(position.getY(0)).toBeCloseTo(2, 6);
    expect(uv.getX(0)).toBeCloseTo(0, 6);
    expect(uv.getX(4)).toBeCloseTo(1, 6);
    const a = new Vector3().fromBufferAttribute(position, index.getX(0));
    const b = new Vector3().fromBufferAttribute(position, index.getX(1));
    const c = new Vector3().fromBufferAttribute(position, index.getX(2));
    const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).normalize();
    expect(normal.z).toBeCloseTo(1, 6);
  });

  it("offers the photographs as they are, or matched to the splat room", () => {
    expect(floorColourGain(manifest, "photo")).toEqual([1, 1, 1]);
    expect(floorColourGain(manifest, "matched")).toEqual([0.7, 0.6, 0.65]);
  });

  it("refuses a package with the wrong schema", () => {
    expect(FloorSkinManifestSchema.safeParse({ ...manifest, schema: "other" }).success).toBe(false);
  });
});
