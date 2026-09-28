import { describe, expect, it } from "vitest";
import { Euler, Matrix4, Quaternion, Vector3, Vector4 } from "three";
import {
  FloorSkinManifestSchema, captureToMaskMatrix, decodeFloorHeights, floorColourGain,
  floorColourModeFromSearch, floorExclusionMatrix, floorSkinManifestUrl, floorSkinTier,
  floorSkinTileGeometry, type FloorSkinManifest,
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

  it("maps a scene-frame point to the mask through an arbitrary chain between the Scene and the floor's group", () => {
    // Neither the Scene nor the floor's group is parented directly under the
    // other with an otherwise-identity chain: the Scene itself is translated,
    // and an intermediate parent between the Scene and the group rotates and
    // translates too. floorExclusionMatrix must still be exact.
    const sceneMatrixWorld = new Matrix4().makeTranslation(10, 0, 0);
    const parentLocal = new Matrix4().compose(
      new Vector3(0, 5, -2),
      new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0)),
      new Vector3(1, 1, 1),
    );
    const groupLocal = new Matrix4().makeTranslation(1, 0, 0); // the group's own position/rotation/scale props
    const groupMatrixWorld = sceneMatrixWorld.clone().multiply(parentLocal).multiply(groupLocal);

    // Texel (col 100, row 50), centre, exactly on the floor plane (height 0).
    const capturePoint = new Vector4(0.505, 1.005, 1, 1);
    const worldPoint = capturePoint.clone().applyMatrix4(groupMatrixWorld);
    const sceneFramePoint = worldPoint.clone().applyMatrix4(new Matrix4().copy(sceneMatrixWorld).invert());

    const matrix = floorExclusionMatrix(manifest, sceneMatrixWorld, groupMatrixWorld);
    const q = sceneFramePoint.clone().applyMatrix4(matrix);

    expect(q.x).toBeCloseTo(100.5 / 400, 5);
    expect(q.y).toBeCloseTo(50.5 / 200, 5);
    expect(q.z).toBeCloseTo(0, 5);
  });
});

describe("floor-skin manifest limits (T-639: the manifest is untrusted input)", () => {
  const parses = (value: unknown): boolean => FloorSkinManifestSchema.safeParse(value).success;

  it("accepts the Grand Hall package's own file names", () => {
    expect(parses({
      ...manifest,
      tiers: { ...manifest.tiers, high: { size: 4096, files: ["albedo-4096-0.webp", "albedo-4096-1.webp"] } },
      height: { ...manifest.height, file: "height-5cm.i16" },
      slab: { ...manifest.slab, file: "slab-mask-1024x512.u8" },
      files: { "albedo-4096-0.webp": "0".repeat(64), "height-5cm.i16": "1".repeat(64), "slab-mask-1024x512.u8": "2".repeat(64) },
    })).toBe(true);
  });

  it.each(["../h0.webp", "tiles/h0.webp", "tiles\\h0.webp", "/h0.webp", ".h0.webp", "-h0.webp", "h 0.webp", "%2e%2e", "https://cdn.example/h0.webp", ""])(
    "refuses the file name %j wherever the package names a file",
    (name) => {
      expect(parses({ ...manifest, tiers: { ...manifest.tiers, high: { size: 200, files: [name, "h1.webp"] } } })).toBe(false);
      expect(parses({ ...manifest, height: { ...manifest.height, file: name } })).toBe(false);
      expect(parses({ ...manifest, slab: { ...manifest.slab, file: name } })).toBe(false);
      expect(parses({ ...manifest, files: { [name]: "0".repeat(64) } })).toBe(false);
    },
  );

  it.each([
    ["17 tiles", { tiles: Array.from({ length: 17 }, () => manifest.tiles[0]) }],
    ["a grid over 65,536 texels wide", { grid: { ...manifest.grid, widthPx: 65_537 } }],
    ["a grid over 65,536 texels high", { grid: { ...manifest.grid, heightPx: 65_537 } }],
    ["a height grid over 4,096 columns", { height: { ...manifest.height, cols: 4_097 } }],
    ["a height grid over 4,096 rows", { height: { ...manifest.height, rows: 4_097 } }],
    ["a slab mask over 4,096 wide", { slab: { ...manifest.slab, width: 4_097 } }],
    ["a slab mask over 4,096 high", { slab: { ...manifest.slab, height: 4_097 } }],
    ["a texture tier over 8,192 texels", { tiers: { ...manifest.tiers, medium: { ...manifest.tiers.medium, size: 8_193 } } }],
    ["a tile that runs past the grid's width", { tiles: [{ col0: 300, row0: 0, cols: 200, rows: 200 }] }],
    ["a tile that runs past the grid's height", { tiles: [{ col0: 0, row0: 100, cols: 200, rows: 200 }] }],
    ["a tile of 200,000 × 200,000 texels", { grid: { ...manifest.grid, widthPx: 65_536, heightPx: 65_536 }, tiles: [{ col0: 0, row0: 0, cols: 200_000, rows: 200_000 }] }],
  ])("refuses %s", (_label, override) => {
    expect(parses({ ...manifest, ...override })).toBe(false);
  });

  it("accepts every limit exactly", () => {
    expect(parses({
      ...manifest,
      tiles: Array.from({ length: 16 }, () => manifest.tiles[0]),
      grid: { ...manifest.grid, widthPx: 65_536, heightPx: 65_536 },
      height: { ...manifest.height, cols: 4_096, rows: 4_096 },
      slab: { ...manifest.slab, width: 4_096, height: 4_096 },
      tiers: { ...manifest.tiers, high: { ...manifest.tiers.high, size: 8_192 } },
    })).toBe(true);
  });

  it("reads a package whose provenance names the source of its matched colour", () => {
    // The builder records which measured ratio `colour.matched` carries.
    expect(parses({ ...manifest, provenance: { ...manifest.provenance, matched: "Arm A render-proof measurement" } })).toBe(true);
  });
});

describe("floor colour choice for Blake's review (T-639)", () => {
  it("shows the photographs as they are by default", () => {
    expect(floorColourModeFromSearch("", true)).toBe("photo");
  });

  it("offers the matched floor where splats may run", () => {
    expect(floorColourModeFromSearch("?floor=matched", true)).toBe("matched");
  });

  it("ignores the query where splats may not run", () => {
    expect(floorColourModeFromSearch("?floor=matched", false)).toBe("photo");
  });
});
