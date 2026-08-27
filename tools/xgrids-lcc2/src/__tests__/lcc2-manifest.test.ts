import { describe, expect, it } from "vitest";
import {
  Lcc2ManifestSchema,
  lodLevelForTileId,
  parseLcc2Manifest,
  tileIdForSplatFile,
} from "../lcc2-manifest.js";

// A structurally faithful miniature of a real XGRIDS .lcc2: recursive octree
// under `root`, sibling nodes keyed by stringified index, and the flat
// `splatFiles` list that names every tile including the environment shell.
function miniManifest(): unknown {
  return {
    version: "0.0.3",
    name: "XGrids Lcc2 Splats",
    description: "XGrids all rights reserved, GT 0.1.0.6",
    epsg: 0,
    guid: "3494d5d406293b1acf42379db4e7cdd1",
    source: "lcc",
    dataType: "PortalCam",
    offset: [0, 0, 0],
    shift: [0, 0, 0],
    scale: [1, 1, 1],
    fileType: "quality",
    totalSplats: 3933570,
    lodSplats: [2105298, 1045287, 522118, 260867],
    totalLevels: 4,
    virtualLoD: null,
    splatType: ".sog",
    env: {
      type: "splats",
      splatsCount: 3626,
      boundingBox: { min: [-298.5, -247.7, -263.9], max: [230.3, 558.7, 277.9] },
    },
    splatExtraAttributes: null,
    root: {
      id: "0",
      boundingBox: { min: [-12.47, -17.86, -5.02], max: [10.54, 17.89, 4.09] },
      childNum: 1,
      child: {
        "0": {
          id: "0_0",
          boundingBox: { min: [-6.96, -5.6, -3.98], max: [-1.87, -1.86, 1.72] },
          childNum: 0,
          child: {},
        },
      },
      data: { env: { name: 8 } },
      splatFiles: ["data/3dgs/0_0.sog", "data/3dgs/0_7_0_0.sog", "data/3dgs/env.sog"],
      meshFiles: ["data/mesh/0_0_0.ply"],
      bvhFiles: [],
    },
    renderingHints: {
      renderMethod: "splat",
      renderMethodVariant: "default",
      sortingMethod: "gpu",
      cameraModel: "pinhole",
      colorSpace: "srgb",
    },
  };
}

describe("Lcc2ManifestSchema", () => {
  it("accepts a structurally faithful manifest", () => {
    expect(Lcc2ManifestSchema.safeParse(miniManifest()).success).toBe(true);
  });

  it("rejects a manifest whose bounding box min exceeds max", () => {
    const bad = miniManifest() as { root: { boundingBox: { min: number[] } } };
    bad.root.boundingBox.min = [999, 999, 999];
    expect(Lcc2ManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an unknown splat encoding", () => {
    const bad = miniManifest() as { splatType: string };
    bad.splatType = ".exe";
    expect(Lcc2ManifestSchema.safeParse(bad).success).toBe(false);
  });
});

describe("tileIdForSplatFile", () => {
  it("derives the octree node id from a tile path", () => {
    expect(tileIdForSplatFile("data/3dgs/0_7_0_0.sog")).toBe("0_7_0_0");
  });

  it("derives the environment id, which is not an octree node", () => {
    expect(tileIdForSplatFile("data/3dgs/env.sog")).toBe("env");
  });
});

describe("lodLevelForTileId", () => {
  it("treats octree depth as the LOD level, coarsest first", () => {
    expect(lodLevelForTileId("0_0")).toBe(1);
    expect(lodLevelForTileId("0_7_0_0")).toBe(3);
    expect(lodLevelForTileId("0_7_0_0_1_1")).toBe(5);
  });

  it("returns null for the environment shell, which has no LOD depth", () => {
    expect(lodLevelForTileId("env")).toBeNull();
  });
});

describe("parseLcc2Manifest", () => {
  it("reports the parse error rather than throwing on malformed input", () => {
    const result = parseLcc2Manifest("{ not json");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not valid JSON");
  });

  it("returns the validated manifest for good input", () => {
    const result = parseLcc2Manifest(JSON.stringify(miniManifest()));
    expect(result.ok).toBe(true);
    expect(result.manifest?.totalSplats).toBe(3933570);
  });
});
