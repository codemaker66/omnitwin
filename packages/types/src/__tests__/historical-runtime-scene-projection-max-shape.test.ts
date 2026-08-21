import { describe, expect, it } from "vitest";
import {
  RECONSTRUCTION_SCENE_AUTHORITY_MAP_SCHEMA_VERSION,
  ReconstructionSceneAuthorityMapV0Schema,
  resolveReconstructionSceneAuthorityCoverage,
} from "../reconstruction-review-evidence.js";
import {
  RECONSTRUCTION_RELEASE_SCHEMA_VERSION,
  ReconstructionReleaseManifestSchema,
  computeReconstructionReleaseDigest,
} from "../reconstruction-release.js";
import { TwinManifestSchema } from "../twin.js";

const TRANSFORM = {
  artifactId: "max-shape-transform-v1",
  artifactDigest: "1".repeat(64),
} as const;
const RUNTIME_LAYER = `runtime-layer/v1/${"2".repeat(64)}`;

describe("historical-runtime bounded Scene projection", () => {
  it("normalizes the schema-valid 1,000-node / 64,000-reference shape", () => {
    const nodes = Array.from({ length: 1_000 }, (_, index) => ({
      id: `scan_${String(index).padStart(3, "0")}`,
      index,
      pose: { q: [1, 0, 0, 0], t: [index, 0, 0] },
      floor: 0,
      roomSlug: "max-room",
    }));
    const twin = TwinManifestSchema.parse({
      schema: "twin/0",
      venueSlug: "trades-hall",
      name: "Maximum schema-valid room projection",
      capture: { kind: "matterport-e57", scanCount: nodes.length },
      tier: "planning-grade-5cm",
      upAxis: "z",
      units: "m",
      imagery: "equirect",
      faces: ["front", "back", "left", "right", "up", "down"],
      lods: [512, 4096, 8192],
      generatedAt: "2026-08-20T20:00:00.000Z",
      nodes,
      edges: [],
      entryNodeId: "scan_000",
    });
    const files = [
      {
        path: "manifest.json",
        sha256: "3".repeat(64),
        sizeBytes: 1_024,
        mimeType: "application/json",
        role: "manifest" as const,
      },
      {
        path: "mesh/room.glb",
        sha256: "4".repeat(64),
        sizeBytes: 8_192,
        mimeType: "model/gltf-binary",
        role: "geometry" as const,
      },
    ];
    const release = ReconstructionReleaseManifestSchema.parse({
      schemaVersion: RECONSTRUCTION_RELEASE_SCHEMA_VERSION,
      releaseKind: "venue_twin_v1",
      venueSlug: "trades-hall",
      releaseDigest: computeReconstructionReleaseDigest(files),
      sourceManifestSha256: files[0]?.sha256,
      files,
      fileCount: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
      generatedAt: "2026-08-20T20:01:00.000Z",
    });
    const regions = Array.from({ length: 2_000 }, (_, regionIndex) => ({
      id: `max-room-region-${String(regionIndex).padStart(4, "0")}`,
      label: `Maximum room region ${String(regionIndex)}`,
      scope: {
        kind: "twin_nodes" as const,
        nodeIds: Array.from(
          { length: 32 },
          (_, offset) => `scan_${String((regionIndex * 32 + offset) % 1_000).padStart(3, "0")}`,
        ),
      },
      authorities: {
        geometryAuthority: { kind: "release_file" as const, ref: "mesh/room.glb" },
        appearanceAuthority: { kind: "runtime_layer" as const, ref: RUNTIME_LAYER },
        lightingAuthority: { kind: "none" as const, ref: null },
        physicsAuthority: { kind: "none" as const, ref: null },
        semanticAuthority: { kind: "release_file" as const, ref: "manifest.json" },
        interactionAuthority: { kind: "release_file" as const, ref: "mesh/room.glb" },
        exportAuthority: { kind: "none" as const, ref: null },
      },
      truthStatus: "measured" as const,
      confidenceTier: "layout_grade" as const,
      provenanceRefs: [{
        refType: "artifact" as const,
        ref: `evidence/trades-hall/max-room/${String(regionIndex)}`,
        role: "release-source",
      }],
      reconstructionStrategy: "matterpak_original" as const,
      transformArtifactRef: TRANSFORM,
    }));
    const map = ReconstructionSceneAuthorityMapV0Schema.parse({
      schemaVersion: RECONSTRUCTION_SCENE_AUTHORITY_MAP_SCHEMA_VERSION,
      id: "max-room-scene-map-v1",
      venueSlug: "trades-hall",
      generatedAt: "2026-08-20T20:02:00.000Z",
      regions,
    });

    const startedAt = performance.now();
    const projection = resolveReconstructionSceneAuthorityCoverage({
      map,
      twin,
      release,
      selectedTransform: TRANSFORM,
      spaceSlug: "max-room",
      rejectBoundsCvf: true,
      runtimeLayers: [{ authorityReference: RUNTIME_LAYER }],
    });
    const elapsedMs = performance.now() - startedAt;

    expect(projection.expandedRegionNodeReferenceCount).toBe(64_000);
    expect(projection.expectedTwinNodeIds).toHaveLength(1_000);
    expect(projection.orderedRegions).toHaveLength(2_000);
    expect(projection.normalizedProjectionByteLength).toBeLessThanOrEqual(4_194_304);
    expect(elapsedMs).toBeLessThan(2_000);

    const templateRegion = regions[0];
    expect(templateRegion).toBeDefined();
    const overCapMap = ReconstructionSceneAuthorityMapV0Schema.parse({
      ...map,
      regions: Array.from({ length: 66 }, (_, regionIndex) => ({
        ...templateRegion,
        id: `over-cap-region-${String(regionIndex).padStart(2, "0")}`,
        label: `Over-cap region ${String(regionIndex)}`,
        scope: {
          kind: "twin_nodes" as const,
          nodeIds: nodes
            .slice(0, regionIndex === 65 ? 537 : 1_000)
            .map((node) => node.id),
        },
      })),
    });
    expect(() => resolveReconstructionSceneAuthorityCoverage({
      map: overCapMap,
      twin,
      release,
      selectedTransform: TRANSFORM,
      spaceSlug: "max-room",
      rejectBoundsCvf: true,
      runtimeLayers: [{ authorityReference: RUNTIME_LAYER }],
    })).toThrow("expanded region-node projection exceeds");
  }, 10_000);
});
