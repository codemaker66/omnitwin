import { describe, expect, it } from "vitest";
import { TwinManifestSchema } from "@omnitwin/types";
import { buildManifest } from "../build-manifest.js";

const rawPoses = {
  "0": { rotation: [0.73, 0.01, -0.01, -0.67] as [number, number, number, number], translation: [0, 0, 1.5] as [number, number, number] },
  "1": { rotation: [0.95, 0.0, -0.02, 0.29] as [number, number, number, number], translation: [0.15, -2.66, 1.49] as [number, number, number] },
};

describe("buildManifest", () => {
  it("emits a schema-valid twin/0 manifest with sorted scan ids", () => {
    const m = buildManifest(rawPoses, {
      venueSlug: "trades-hall", name: "Trades Hall Glasgow",
      tier: "ops-grade-2cm", generatedAt: "2026-07-02T12:00:00.000Z",
    });
    expect(() => TwinManifestSchema.parse(m)).not.toThrow();
    expect(m.nodes.map((n) => n.id)).toEqual(["scan_000", "scan_001"]);
    expect(m.capture).toEqual({ kind: "matterport-e57", scanCount: 2 });
    expect(m.edges.length).toBeGreaterThan(0);
  });

  it("carries a mesh descriptor through verbatim", () => {
    const mesh = {
      path: "mesh/dollhouse.glb",
      bytes: 7340032,
      sourceName: "trades-hall-web.glb",
    } as const;
    const m = buildManifest(rawPoses, {
      venueSlug: "trades-hall", name: "Trades Hall Glasgow",
      tier: "ops-grade-2cm", generatedAt: "2026-07-02T12:00:00.000Z",
      mesh,
    });
    expect(() => TwinManifestSchema.parse(m)).not.toThrow();
    expect(m.mesh).toEqual(mesh);
  });

  it("omits mesh entirely when the option is not provided", () => {
    const m = buildManifest(rawPoses, {
      venueSlug: "trades-hall", name: "Trades Hall Glasgow",
      tier: "ops-grade-2cm", generatedAt: "2026-07-02T12:00:00.000Z",
    });
    expect(m.mesh).toBeUndefined();
    expect("mesh" in m).toBe(false);
  });

  it("defaults to cube-faces imagery with cube lods", () => {
    const m = buildManifest(rawPoses, {
      venueSlug: "trades-hall", name: "Trades Hall Glasgow",
      tier: "ops-grade-2cm", generatedAt: "2026-07-02T12:00:00.000Z",
    });
    expect(m.imagery).toBe("cube-faces");
    expect(m.lods).toEqual([256, 1024]);
  });

  it("equirect imagery flips the lods to [512, 2048] and stays schema-valid", () => {
    const m = buildManifest(rawPoses, {
      venueSlug: "trades-hall", name: "Trades Hall Glasgow",
      tier: "ops-grade-2cm", generatedAt: "2026-07-02T12:00:00.000Z",
      imagery: "equirect",
    });
    expect(m.imagery).toBe("equirect");
    expect(m.lods).toEqual([512, 2048]);
    expect(() => TwinManifestSchema.parse(m)).not.toThrow();
  });
});
