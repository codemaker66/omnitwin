import { describe, expect, it } from "vitest";
import {
  FOUNDRY_INGEST_MANIFEST_V0,
  FoundryIngestManifestV0Schema,
  type FoundryIngestManifestV0,
  type FoundryInputType,
} from "@omnitwin/types";
import {
  compileLocalFoundryProcessingOutlineV0,
  type LocalFoundryProcessingLaneV0,
} from "../local-app.js";

const NOW = "2026-07-15T10:00:00.000Z";
const OPTIONS = {
  hdAppearance: "rights_gated_training" as const,
  includeSemanticInference: true,
  buildOperationalMesh: true,
  buildNeuralRepresentation: true,
};

function asset(
  id: string,
  relativePath: string,
  inputType: FoundryInputType,
  index: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    sourceRootId: "source-root",
    relativePath,
    inputType,
    mediaType: "application/octet-stream",
    sizeBytes: 100 + index,
    sha256: `sha256:${index.toString(16).padStart(64, "0")}`,
    immutable: true as const,
    captureState: "official_export" as const,
    accessState: "official_export" as const,
    capturedAt: null,
    coordinateFrameId: "venue-control",
    calibrationAssetIds: [],
    parentAssetIds: [],
    rights: {
      basis: "customer_owned" as const,
      commercialUse: "allowed" as const,
      modelTrainingUse: "allowed" as const,
      redistribution: "allowed" as const,
      termsReviewedAt: NOW,
      termsReference: `https://rights.example/${id}`,
      restrictions: [],
    },
    provenanceClass: "captured" as const,
    evidenceKinds: [],
    inspection: {
      geometryValue: "high" as const,
      appearanceValue: "medium" as const,
      calibrationValue: "medium" as const,
      scaleValue: "high" as const,
      metadataKeys: ["fixture"],
      decisiveNextTest: `Inspect ${relativePath}.`,
    },
    notes: [],
    ...overrides,
  };
}

function mixedManifest(): FoundryIngestManifestV0 {
  const mask = asset("generated-mask", "generated/mask.json", "evidence_record", 8, {
    captureState: "reference",
    coordinateFrameId: null,
    evidenceKinds: ["mask"],
  });
  const generated = asset("generated-splat", "generated/scene.spz", "spz", 9, {
    captureState: "derived",
    provenanceClass: "generated_cinematic",
    parentAssetIds: ["point-main", "generated-mask"],
  });
  const concept = asset("concept-splat", "concept/scene.spz", "spz", 10, {
    captureState: "derived",
    provenanceClass: "concept_imagination",
    parentAssetIds: ["point-main", "generated-mask"],
  });
  const assets = [
    asset("point-main", "capture.e57", "generic_e57", 1),
    asset("mesh-main", "model.obj", "obj", 2),
    asset("image-main", "images/frame.jpg", "dslr_image", 3),
    asset("video-main", "video/walkthrough.mp4", "video", 4),
    asset("control-main", "survey/control.json", "control_network", 5),
    asset("enhanced-splat", "enhanced/scene.spz", "spz", 6, {
      provenanceClass: "enhanced_captured",
    }),
    asset("opaque-lcc2", "vendor/scene.lcc2", "lcc2", 7),
    mask,
    generated,
    concept,
  ];
  return FoundryIngestManifestV0Schema.parse({
    schemaVersion: FOUNDRY_INGEST_MANIFEST_V0,
    projectId: "project-outline",
    createdAt: NOW,
    createdBy: "outline@example.test",
    sourceRoots: [{
      id: "source-root",
      kind: "local_directory",
      displayName: "Read-only sources",
      locationRedacted: "FOUNDRY_SOURCE_ROOT",
      caseSensitivity: "insensitive",
      readOnly: true,
    }],
    coordinateFrames: [{
      id: "venue-control",
      kind: "venue_control",
      units: "meters",
      handedness: "right",
      upAxis: "z",
      authority: "measured",
      provenanceAssetIds: assets.map((candidate) => candidate.id),
      crs: null,
    }],
    transforms: [],
    assets,
    provenanceEdges: [
      {
        id: "generated-splat-edge",
        operationId: "generated-splat-operation",
        inputAssetIds: ["point-main", "generated-mask"],
        outputAssetId: "generated-splat",
        operationVersion: "v1",
        environmentDigest: `sha256:${"a".repeat(64)}`,
        createdAt: NOW,
      },
      {
        id: "concept-splat-edge",
        operationId: "concept-splat-operation",
        inputAssetIds: ["point-main", "generated-mask"],
        outputAssetId: "concept-splat",
        operationVersion: "v1",
        environmentDigest: `sha256:${"b".repeat(64)}`,
        createdAt: NOW,
      },
    ],
    generatedRegions: [
      {
        id: "generated-splat-region",
        outputAssetId: "generated-splat",
        sourceAssetIds: ["point-main"],
        maskAssetId: "generated-mask",
        provenanceClass: "generated_cinematic",
        modelName: "fixture-model",
        modelVersion: "v1",
        checkpointSha256: `sha256:${"c".repeat(64)}`,
        promptOrConditionDigest: `sha256:${"d".repeat(64)}`,
        confidence: 0.75,
        exportRestrictions: ["Keep generated output separately labelled."],
        truthModeDisclosure:
          "This fixture region is generated appearance and is never measured geometry.",
      },
      {
        id: "concept-splat-region",
        outputAssetId: "concept-splat",
        sourceAssetIds: ["point-main"],
        maskAssetId: "generated-mask",
        provenanceClass: "concept_imagination",
        modelName: "fixture-concept-model",
        modelVersion: "v1",
        checkpointSha256: `sha256:${"e".repeat(64)}`,
        promptOrConditionDigest: `sha256:${"f".repeat(64)}`,
        confidence: 0.5,
        exportRestrictions: ["Keep concept output separately labelled."],
        truthModeDisclosure:
          "This fixture region is concept imagery and is never measured geometry.",
      },
    ],
    legalReviewState: "approved",
    sourceMutationPermitted: false,
  });
}

function assetsByLane(lanes: readonly LocalFoundryProcessingLaneV0[]) {
  return new Map(lanes.map((lane) => [
    lane.id,
    lane.representedAssets.map((represented) => represented.assetId),
  ] as const));
}

describe("local Foundry processing outline", () => {
  it("maps every human lane from the shared router and isolates opaque/generated files", () => {
    const manifest = mixedManifest();
    const outline = compileLocalFoundryProcessingOutlineV0(manifest, OPTIONS);
    expect(outline.state).toBe("outline_only");
    if (outline.state !== "outline_only") throw new Error("expected an available outline");

    expect(outline.lanes.map((lane) => lane.id)).toEqual([
      "source_review",
      "point_geometry",
      "mesh_geometry",
      "image_video_reconstruction",
      "alignment_and_operational_geometry",
      "captured_appearance",
      "ai_assistance",
      "learned_visual_representation",
      "review_and_package_only",
    ]);
    const byLane = assetsByLane(outline.lanes);
    expect(byLane.get("point_geometry")).toEqual(["point-main"]);
    expect(byLane.get("mesh_geometry")).toEqual(["mesh-main"]);
    expect(byLane.get("image_video_reconstruction")).toEqual(["image-main", "video-main"]);
    expect(byLane.get("alignment_and_operational_geometry")).toEqual([
      "control-main",
      "image-main",
      "mesh-main",
      "point-main",
      "video-main",
    ]);
    expect(byLane.get("captured_appearance")).toEqual([
      "control-main",
      "image-main",
      "mesh-main",
      "point-main",
      "video-main",
    ]);
    expect(byLane.get("ai_assistance")).toEqual([
      "control-main",
      "enhanced-splat",
      "image-main",
      "mesh-main",
      "point-main",
      "video-main",
    ]);
    expect(byLane.get("learned_visual_representation")).toEqual([
      "control-main",
      "image-main",
      "mesh-main",
      "point-main",
      "video-main",
    ]);
    const reviewOnlyIds = [
      "concept-splat",
      "generated-mask",
      "generated-splat",
      "opaque-lcc2",
    ];
    expect(byLane.get("review_and_package_only")).toEqual(reviewOnlyIds);
    for (const isolatedId of reviewOnlyIds) {
      expect(outline.lanes
        .filter((lane) => lane.representedAssets.some((asset) => asset.assetId === isolatedId))
        .map((lane) => lane.id)).toEqual(["source_review", "review_and_package_only"]);
    }

    expect(new Set(outline.lanes.flatMap(
      (lane) => lane.representedAssets.map((represented) => represented.assetId),
    ))).toEqual(new Set(manifest.assets.map((candidate) => candidate.id)));
    expect(outline.lanes.find((lane) => lane.id === "captured_appearance")).toMatchObject({
      heading: "Captured-appearance enhancement",
      explanation: expect.stringMatching(/enhanced-captured.*outside measured geometry.*separate from AI/u),
    });
    expect(outline.lanes.flatMap((lane) => lane.representedAssets)
      .find((represented) => represented.assetId === "opaque-lcc2"))
      .toEqual({ assetId: "opaque-lcc2", relativePath: "vendor/scene.lcc2" });
    expect(JSON.stringify(outline)).not.toMatch(
      /containerImage|command|workerProfile|jobSpec|recipeSha256/u,
    );
  });

  it("is independent of manifest ordering", () => {
    const manifest = mixedManifest();
    const reordered = FoundryIngestManifestV0Schema.parse({
      ...manifest,
      assets: [...manifest.assets].reverse(),
      provenanceEdges: [...manifest.provenanceEdges].reverse(),
      generatedRegions: [...manifest.generatedRegions].reverse(),
    });
    expect(compileLocalFoundryProcessingOutlineV0(reordered, OPTIONS))
      .toEqual(compileLocalFoundryProcessingOutlineV0(manifest, OPTIONS));
  });

  it("rejects duplicate manifest asset IDs before producing an outline", () => {
    const manifest = mixedManifest();
    const firstAsset = manifest.assets[0];
    if (firstAsset === undefined) throw new Error("missing duplicate-ID fixture asset");
    const duplicate: FoundryIngestManifestV0 = {
      ...manifest,
      assets: [
        ...manifest.assets,
        { ...firstAsset, relativePath: "duplicate/capture.e57" },
      ],
    };
    expect(() => compileLocalFoundryProcessingOutlineV0(duplicate, OPTIONS))
      .toThrow(/assets IDs must be unique/u);
  });
});
