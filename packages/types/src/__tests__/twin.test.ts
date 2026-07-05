import { describe, expect, it } from "vitest";
import {
  TWIN_EQUIRECT_LODS,
  TWIN_FACES,
  TWIN_LODS,
  TWIN_SCHEMA_ID,
  TwinManifestSchema,
  twinEquirectPath,
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
    const node = bad.nodes[0];
    if (node === undefined) throw new Error("fixture must have one node");
    node.pose.q = [1, 0, 0];
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
    expect(TWIN_EQUIRECT_LODS).toEqual([512, 4096, 8192]);
  });
});

describe("twin/0 imagery modes", () => {
  it("defaults a pre-equirect manifest (no imagery field) to cube-faces", () => {
    const parsed = TwinManifestSchema.parse(validManifest);
    expect(parsed.imagery).toBe("cube-faces");
  });

  it("accepts an equirect manifest with lods [512, 4096, 8192]", () => {
    const parsed = TwinManifestSchema.parse({
      ...validManifest,
      imagery: "equirect",
      lods: [512, 4096, 8192],
    });
    expect(parsed.imagery).toBe("equirect");
    expect(parsed.lods).toEqual([512, 4096, 8192]);
  });

  it("rejects an equirect manifest carrying cube-face lods", () => {
    expect(() =>
      TwinManifestSchema.parse({ ...validManifest, imagery: "equirect" }),
    ).toThrow();
  });

  it("rejects the retired two-tier equirect lods [512, 4096]", () => {
    // One current standard: pre-zoom-tier bundles must be re-forged, not
    // half-parsed — the union no longer carries the two-entry tuple at all.
    expect(() =>
      TwinManifestSchema.parse({
        ...validManifest,
        imagery: "equirect",
        lods: [512, 4096],
      }),
    ).toThrow();
  });

  it("rejects a cube-faces manifest carrying equirect lods", () => {
    expect(() =>
      TwinManifestSchema.parse({ ...validManifest, lods: [512, 4096, 8192] }),
    ).toThrow();
  });

  it("rejects an unknown imagery mode", () => {
    expect(() =>
      TwinManifestSchema.parse({ ...validManifest, imagery: "spherical-harmonics" }),
    ).toThrow();
  });

  it("builds equirect pano paths", () => {
    expect(twinEquirectPath("scan_007", 4096)).toBe("tiles/scan_007/equirect_4096.webp");
    expect(twinEquirectPath("scan_007", 512)).toBe("tiles/scan_007/equirect_512.webp");
    expect(twinEquirectPath("scan_007", 8192)).toBe("tiles/scan_007/equirect_8192.webp");
  });
});

describe("twin/0 optional mesh descriptor", () => {
  const mesh = {
    path: "mesh/dollhouse.glb",
    bytes: 7340032,
    sourceName: "trades-hall-web.glb",
  };

  it("accepts a manifest with a mesh descriptor", () => {
    const parsed = TwinManifestSchema.parse({ ...validManifest, mesh });
    expect(parsed.mesh).toEqual(mesh);
  });

  it("rejects a mesh with a wrong path", () => {
    expect(() =>
      TwinManifestSchema.parse({
        ...validManifest,
        mesh: { ...mesh, path: "mesh/other.glb" },
      }),
    ).toThrow();
  });

  it("still accepts a manifest without a mesh", () => {
    const parsed = TwinManifestSchema.parse(validManifest);
    expect(parsed.mesh).toBeUndefined();
  });
});
