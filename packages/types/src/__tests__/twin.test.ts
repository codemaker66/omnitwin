import { describe, expect, it } from "vitest";
import {
  TWIN_FACES,
  TWIN_LODS,
  TWIN_SCHEMA_ID,
  TwinManifestSchema,
  twinTilePath,
} from "../twin.js";

const validManifest = {
  schema: "twin/0",
  venueSlug: "trades-hall",
  name: "Trades Hall Glasgow",
  capture: { kind: "matterport-e57", scanCount: 149 },
  tier: "ops-grade-2cm",
  upAxis: "z",
  units: "m",
  faces: ["front", "back", "left", "right", "up", "down"],
  lods: [256, 1024],
  generatedAt: "2026-07-02T12:00:00.000Z",
  nodes: [
    {
      id: "scan_000",
      index: 0,
      pose: {
        q: [0.7376939654350281, 0.014615842141211033, -0.011572370305657387, -0.6748778820037842],
        t: [0.004310831427574158, 0.008259806782007217, 1.4990558624267578],
      },
      floor: 0,
      roomSlug: null,
    },
  ],
  edges: [{ a: "scan_000", b: "scan_001", distanceM: 2.67 }],
};

describe("twin/0 manifest schema", () => {
  it("accepts a valid manifest", () => {
    expect(TwinManifestSchema.parse(validManifest).schema).toBe(TWIN_SCHEMA_ID);
  });

  it("rejects a wrong schema id", () => {
    expect(() => TwinManifestSchema.parse({ ...validManifest, schema: "twin/1" })).toThrow();
  });

  it("rejects a pose with wrong arity", () => {
    const bad = structuredClone(validManifest);
    bad.nodes[0].pose.q = [1, 0, 0];
    expect(() => TwinManifestSchema.parse(bad)).toThrow();
  });

  it("discriminates capture sources", () => {
    expect(
      TwinManifestSchema.parse({ ...validManifest, capture: { kind: "xgrids-lcc" } }).capture.kind,
    ).toBe("xgrids-lcc");
    expect(() =>
      TwinManifestSchema.parse({ ...validManifest, capture: { kind: "matterport" } }),
    ).toThrow();
  });

  it("builds tile paths", () => {
    expect(twinTilePath("scan_007", "front", 256)).toBe("tiles/scan_007/front_256.webp");
  });

  it("locks faces and lods", () => {
    expect(TWIN_FACES).toEqual(["front", "back", "left", "right", "up", "down"]);
    expect(TWIN_LODS).toEqual([256, 1024]);
  });
});
