import { describe, expect, it } from "vitest";
import { parseLcc2Manifest } from "../lcc2-manifest.js";
import { roomBundleFromManifest } from "../room-bundle.js";

// The same miniature shape as lcc2-manifest.test.ts. What matters here is
// `lodSplats`: XGRIDS lists the levels finest-first, while tile ids number the
// octree depth coarsest-first ("0_0" is level 1). The bundle must reconcile
// the two so the web can say how many splats a single level actually draws.
function miniManifest(): string {
  return JSON.stringify({
    version: "0.0.3",
    name: "XGrids Lcc2 Splats",
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
    splatType: ".sog",
    env: {
      type: "splats",
      splatsCount: 3626,
      boundingBox: { min: [-298.5, -247.7, -263.9], max: [230.3, 558.7, 277.9] },
    },
    root: {
      id: "0",
      boundingBox: { min: [-12.47, -17.86, -5.02], max: [10.54, 17.89, 4.09] },
      childNum: 0,
      child: {},
      splatFiles: [
        "data/3dgs/0_7_0_0.sog",
        "data/3dgs/env.sog",
        "data/3dgs/0_0.sog",
        "data/3dgs/0_7_0.sog",
        "data/3dgs/0_7_0_0_1.sog",
      ],
    },
  });
}

function bundle() {
  const parsed = parseLcc2Manifest(miniManifest());
  if (!parsed.ok || parsed.manifest === null) throw new Error(parsed.error ?? "unparseable fixture");
  return roomBundleFromManifest("reception-room", parsed.manifest);
}

describe("roomBundleFromManifest", () => {
  it("orders tiles coarsest level first with the environment shell last", () => {
    expect(bundle().tiles.map((tile) => tile.file)).toEqual([
      "0_0.sog", "0_7_0.sog", "0_7_0_0.sog", "0_7_0_0_1.sog", "env.sog",
    ]);
  });

  it("reports splats per level indexed by tile level, coarsest first", () => {
    // lodSplats is finest-first in the manifest; level 1 is the coarsest tile.
    expect(bundle().splatsByLevel).toEqual([260867, 522118, 1045287, 2105298]);
  });

  it("names the finest level and how many splats it alone draws", () => {
    expect(bundle().finestLevel).toBe(4);
    expect(bundle().finestLevelSplats).toBe(2105298);
  });

  it("refuses a manifest with no tile at its declared finest level", () => {
    // Serving the finest level of such a capture would render only the sky.
    const raw = JSON.parse(miniManifest()) as { root: { splatFiles: string[] } };
    raw.root.splatFiles = ["data/3dgs/0_0.sog", "data/3dgs/0_7_0.sog", "data/3dgs/env.sog"];
    const parsed = parseLcc2Manifest(JSON.stringify(raw));
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toMatch(/finest level/);
  });

  it("refuses a manifest whose lodSplats disagree with totalLevels", () => {
    const raw = JSON.parse(miniManifest()) as { lodSplats: number[] };
    raw.lodSplats = [2105298, 1045287];
    const parsed = parseLcc2Manifest(JSON.stringify(raw));
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toMatch(/lodSplats/);
  });
});
