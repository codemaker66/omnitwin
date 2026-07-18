import { describe, expect, it } from "vitest";
import {
  FOUNDRY_INGEST_MANIFEST_V0,
  FoundryIngestManifestV0Schema,
  type FoundryIngestManifestV0,
  type FoundryInputType,
} from "@omnitwin/types";
import { compileLocalFoundryQualityDecisionBoardV0 } from "../local-app.js";

const NOW = "2026-07-15T10:00:00.000Z";
const CAPTURED_ONLY_OPTIONS = {
  hdAppearance: "captured_only" as const,
  includeSemanticInference: false,
  buildOperationalMesh: true,
  buildNeuralRepresentation: false,
};
const AI_REQUESTED_OPTIONS = {
  hdAppearance: "rights_gated_training" as const,
  includeSemanticInference: true,
  buildOperationalMesh: true,
  buildNeuralRepresentation: true,
};

interface AssetFixture {
  readonly id: string;
  readonly relativePath: string;
  readonly inputType: FoundryInputType;
}

function asset(
  fixture: AssetFixture,
  index: number,
) {
  return {
    id: fixture.id,
    sourceRootId: "source-root",
    relativePath: fixture.relativePath,
    inputType: fixture.inputType,
    mediaType: "application/octet-stream",
    sizeBytes: 1_000 + index,
    sha256: `sha256:${index.toString(16).padStart(64, "0")}`,
    immutable: true as const,
    captureState: "official_export" as const,
    accessState: "official_export" as const,
    capturedAt: null,
    coordinateFrameId: null,
    calibrationAssetIds: [],
    parentAssetIds: [],
    rights: {
      basis: "customer_owned" as const,
      commercialUse: "allowed" as const,
      modelTrainingUse: "allowed" as const,
      redistribution: "allowed" as const,
      termsReviewedAt: NOW,
      termsReference: `https://rights.example/${fixture.id}`,
      restrictions: [],
    },
    provenanceClass: "captured" as const,
    evidenceKinds: [],
    inspection: {
      geometryValue: "unknown" as const,
      appearanceValue: "unknown" as const,
      calibrationValue: "unknown" as const,
      scaleValue: "unknown" as const,
      metadataKeys: ["fixture"],
      decisiveNextTest: `Inspect ${fixture.relativePath}.`,
    },
    notes: [],
  };
}

function manifest(fixtures: readonly AssetFixture[]): FoundryIngestManifestV0 {
  return FoundryIngestManifestV0Schema.parse({
    schemaVersion: FOUNDRY_INGEST_MANIFEST_V0,
    projectId: "quality-decision-board",
    createdAt: NOW,
    createdBy: "quality-board@example.test",
    sourceRoots: [{
      id: "source-root",
      kind: "local_directory",
      displayName: "Read-only sources",
      locationRedacted: "FOUNDRY_SOURCE_ROOT",
      caseSensitivity: "insensitive",
      readOnly: true,
    }],
    coordinateFrames: [],
    transforms: [],
    assets: fixtures.map(asset),
    provenanceEdges: [],
    generatedRegions: [],
    legalReviewState: "not_reviewed",
    sourceMutationPermitted: false,
  });
}

function mixedManifest(): FoundryIngestManifestV0 {
  return manifest([
    { id: "point-e57", relativePath: "capture/main.e57", inputType: "generic_e57" },
    { id: "mesh-obj", relativePath: "mesh/source.obj", inputType: "obj" },
    { id: "mesh-glb", relativePath: "mesh/source.glb", inputType: "glb_gltf" },
    { id: "splat-spz", relativePath: "splats/source.spz", inputType: "spz" },
    { id: "splat-sog", relativePath: "splats/runtime.sog", inputType: "sog" },
    { id: "splat-ply", relativePath: "splats/source-gaussian.ply", inputType: "gaussian_ply" },
    { id: "photo-dslr", relativePath: "photos/dslr-001.jpg", inputType: "dslr_image" },
    { id: "photo-generic", relativePath: "photos/reference.png", inputType: "generic_image" },
    { id: "video-walk", relativePath: "video/walkthrough.mp4", inputType: "video" },
  ]);
}

function normalizedText(value: unknown): string {
  return JSON.stringify(value).replaceAll("_", " ").toLowerCase();
}

describe("local Foundry source-aware Quality Decision Board V0", () => {
  it("produces deterministic, evidence-limited strategy cards for a mixed captured source set", () => {
    const source = mixedManifest();
    const board = compileLocalFoundryQualityDecisionBoardV0(
      source,
      AI_REQUESTED_OPTIONS,
    );

    expect(board).toMatchObject({
      meaning: "source_aware_quality_decision_support",
      authority: "none",
      gainEvidence: "unmeasured",
      state: "available",
    });
    if (board.state !== "available") throw new Error("expected an available quality board");

    expect(board.cards.map((card) => card.id)).toEqual([
      "preserve_captured_detail",
      "add_captured_photo_detail",
      "separate_operational_geometry",
      "ai_visual_derivative",
    ]);
    for (const card of board.cards) {
      expect(card).toMatchObject({
        expectedGain: "unmeasured",
        mechanism: expect.any(String),
        canDo: expect.any(String),
        cannotDo: expect.any(String),
        evidenceRequirements: expect.any(Array),
        likelyFailure: expect.any(String),
        decisiveNextTest: expect.any(String),
      });
      expect(card.mechanism.length).toBeGreaterThan(0);
      expect(card.canDo.length).toBeGreaterThan(0);
      expect(card.cannotDo.length).toBeGreaterThan(0);
      expect(card.evidenceRequirements.length).toBeGreaterThan(0);
      expect(card.likelyFailure.length).toBeGreaterThan(0);
      expect(card.decisiveNextTest.length).toBeGreaterThan(0);
    }

    const exactPathById = new Map(
      source.assets.map((candidate) => [candidate.id, candidate.relativePath] as const),
    );
    for (const represented of board.cards.flatMap((card) => card.representedAssets)) {
      expect(represented).toEqual({
        assetId: represented.assetId,
        relativePath: exactPathById.get(represented.assetId),
      });
      expect(represented.relativePath).not.toMatch(/(?:^[/\\]|[A-Za-z]:|(?:^|[/\\])\.\.(?:[/\\]|$))/u);
    }
    expect(board.cards.find((card) => card.id === "preserve_captured_detail")
      ?.representedAssets.map((represented) => represented.assetId)).toEqual([
      "splat-ply",
      "splat-sog",
      "splat-spz",
    ]);

    const serialized = normalizedText(board);
    for (const forbiddenClaim of [
      /\bwill improve\b/u,
      /\bguaranteed gain\b/u,
      /\bhd-ready\b/u,
      /\be57 proves accuracy\b/u,
      /\bproduction-ready\b/u,
      /\brecommended winner\b/u,
    ]) {
      expect(serialized).not.toMatch(forbiddenClaim);
    }
  });

  it("treats a splat-only source as a source-master/runtime comparison, not new physical detail", () => {
    const board = compileLocalFoundryQualityDecisionBoardV0(manifest([
      { id: "only-splat", relativePath: "capture/venue.spz", inputType: "spz" },
    ]), CAPTURED_ONLY_OPTIONS);
    expect(board.state).toBe("available");
    if (board.state !== "available") throw new Error("expected an available quality board");

    const preserve = board.cards.find((card) => card.id === "preserve_captured_detail");
    expect(preserve).toBeDefined();
    if (preserve === undefined) throw new Error("missing preserve-detail strategy");
    expect(preserve.representedAssets).toEqual([
      { assetId: "only-splat", relativePath: "capture/venue.spz" },
    ]);
    expect(normalizedText([preserve.mechanism, preserve.canDo])).toMatch(/runtime/u);
    expect(normalizedText([preserve.mechanism, preserve.canDo])).toMatch(/codec/u);
    expect(normalizedText(preserve.canDo)).toMatch(/preserv|reveal/u);
    expect(normalizedText(preserve.cannotDo)).toMatch(
      /cannot add (?:new )?(?:captured |physical )?detail|does not add (?:new )?(?:captured |physical )?detail/u,
    );
    expect(normalizedText(preserve.decisiveNextTest)).toMatch(
      /source[- ]master.*runtime|runtime.*source[- ]master/u,
    );
    expect(normalizedText(board)).toMatch(/no winner|cannot select a winner|winner is not selected/u);
  });

  it("surfaces E57 plus photo/video fusion only as an unmeasured candidate with decisive gates", () => {
    const board = compileLocalFoundryQualityDecisionBoardV0(manifest([
      { id: "e57", relativePath: "survey/capture.e57", inputType: "generic_e57" },
      { id: "photo", relativePath: "photos/frame.jpg", inputType: "dslr_image" },
      { id: "video", relativePath: "video/walk.mp4", inputType: "video" },
    ]), CAPTURED_ONLY_OPTIONS);
    expect(board.state).toBe("available");
    if (board.state !== "available") throw new Error("expected an available quality board");

    const candidate = board.cards.find((card) => card.id === "add_captured_photo_detail");
    expect(candidate).toMatchObject({ status: "candidate", expectedGain: "unmeasured" });
    if (candidate === undefined) throw new Error("missing captured photo/video candidate");
    const requiredEvidence = normalizedText(candidate.evidenceRequirements);
    expect(requiredEvidence).toMatch(/calibration/u);
    expect(requiredEvidence).toMatch(/registration/u);
    expect(requiredEvidence).toMatch(/control/u);
    expect(requiredEvidence).toMatch(/rights/u);
    expect(requiredEvidence).toMatch(/frozen.*held[- ]?out/u);
    expect(requiredEvidence).toMatch(/fixed[- ]view/u);
    expect(normalizedText([candidate.mechanism, candidate.canDo])).toMatch(/photo|video/u);
    expect(normalizedText(candidate.cannotDo)).toMatch(
      /e57.*(?:type|alone).*(?:does not|cannot|is not).*(?:establish|prove|evidence of).*accuracy|input type.*(?:does not|cannot).*(?:establish|prove).*accuracy/u,
    );
  });

  it("reports manifest-present evidence by state and keeps reviewed transform artifacts visible", () => {
    const base = manifest([
      { id: "e57", relativePath: "survey/capture.e57", inputType: "generic_e57" },
      { id: "photo", relativePath: "photos/frame.jpg", inputType: "dslr_image" },
      { id: "calibration", relativePath: "evidence/calibration.json", inputType: "calibration_bundle" },
      { id: "control", relativePath: "evidence/control.json", inputType: "control_network" },
      { id: "transform", relativePath: "evidence/transform.json", inputType: "manual_evidence" },
      { id: "residual", relativePath: "evidence/residual.json", inputType: "manual_evidence" },
      { id: "attestation", relativePath: "evidence/attestation.json", inputType: "manual_evidence" },
      { id: "fixed-view", relativePath: "evidence/fixed-view.json", inputType: "manual_evidence" },
      { id: "quality-report", relativePath: "evidence/quality.json", inputType: "manual_evidence" },
    ]);
    const evidenceKindsById = new Map<string, readonly string[]>([
      ["calibration", ["calibration_record"]],
      ["transform", ["transform_artifact"]],
      ["residual", ["residual_report"]],
      ["attestation", ["reviewer_attestation"]],
      ["fixed-view", ["fixed_view"]],
      ["quality-report", ["quality_report"]],
    ]);
    const source = FoundryIngestManifestV0Schema.parse({
      ...base,
      assets: base.assets.map((candidate) => ({
        ...candidate,
        coordinateFrameId: candidate.id === "e57"
          ? "frame-e57"
          : candidate.id === "photo"
            ? "frame-photo"
            : null,
        calibrationAssetIds: candidate.id === "photo" ? ["calibration"] : [],
        evidenceKinds: evidenceKindsById.get(candidate.id) ?? [],
      })),
      coordinateFrames: [
        {
          id: "frame-e57",
          kind: "venue_control",
          units: "meters",
          handedness: "right",
          upAxis: "z",
          authority: "measured",
          provenanceAssetIds: ["e57", "control"],
          crs: null,
        },
        {
          id: "frame-photo",
          kind: "camera",
          units: "meters",
          handedness: "right",
          upAxis: "z",
          authority: "registered",
          provenanceAssetIds: ["photo", "calibration"],
          crs: null,
        },
      ],
      transforms: [{
        id: "photo-to-e57",
        sourceFrameId: "frame-photo",
        targetFrameId: "frame-e57",
        operationKind: "affine_similarity",
        matrix: [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
          0, 0, 0, 1,
        ],
        state: "reviewed",
        transformArtifactAssetId: "transform",
        residualReportAssetId: "residual",
        projectionArtifactAssetId: null,
        reviewerAttestationAssetId: "attestation",
        provenanceAssetIds: ["e57", "photo", "control", "calibration"],
      }],
      legalReviewState: "approved",
    });

    const board = compileLocalFoundryQualityDecisionBoardV0(
      source,
      CAPTURED_ONLY_OPTIONS,
    );
    expect(board.state).toBe("available");
    if (board.state !== "available") throw new Error("expected an available quality board");
    const photoCard = board.cards.find((card) => card.id === "add_captured_photo_detail");
    const geometryCard = board.cards.find((card) => card.id === "separate_operational_geometry");
    if (photoCard === undefined || geometryCard === undefined) {
      throw new Error("expected photo and geometry strategies");
    }
    expect(Object.fromEntries(
      photoCard.evidenceRequirements.map((item) => [item.id, item.state]),
    )).toMatchObject({
      camera_calibration: "present_unreviewed",
      declared_transform_artifacts: "reviewed_present",
      photo_video_registration: "not_evaluated",
      control_and_residuals: "not_evaluated",
      source_rights: "reviewed_present",
      held_out_fixed_views: "present_unreviewed",
    });
    expect(geometryCard.representedAssets.map((item) => item.assetId)).toEqual([
      "attestation",
      "calibration",
      "control",
      "e57",
      "photo",
      "residual",
      "transform",
    ]);
    expect(geometryCard.evidenceRequirements.find(
      (item) => item.id === "independent_control",
    )?.state).toBe("not_evaluated");
    expect(geometryCard.evidenceRequirements.find(
      (item) => item.id === "reviewed_transforms",
    )?.state).toBe("not_evaluated");
  });

  it("adds a separately labelled AI-derived visual card only when AI work is requested", () => {
    const source = mixedManifest();
    const capturedOnly = compileLocalFoundryQualityDecisionBoardV0(
      source,
      CAPTURED_ONLY_OPTIONS,
    );
    expect(capturedOnly.state).toBe("available");
    if (capturedOnly.state !== "available") throw new Error("expected an available quality board");
    expect(capturedOnly.cards.some((card) => card.id === "ai_visual_derivative")).toBe(false);

    const requested = compileLocalFoundryQualityDecisionBoardV0(
      source,
      AI_REQUESTED_OPTIONS,
    );
    expect(requested.state).toBe("available");
    if (requested.state !== "available") throw new Error("expected an available quality board");
    const ai = requested.cards.find((card) => card.id === "ai_visual_derivative");
    expect(ai).toMatchObject({ derivativeClass: "ai_derived", expectedGain: "unmeasured" });
    expect(normalizedText(ai)).toMatch(/outside measured geometry/u);
    expect(normalizedText(ai)).toMatch(/real recapture/u);
  });

  it("makes an XGRIDS XBIN source unavailable without a partial board", () => {
    const board = compileLocalFoundryQualityDecisionBoardV0(manifest([
      { id: "opaque-xbin", relativePath: "vendor/venue.xbin", inputType: "xgrids_xbin" },
      { id: "point-e57", relativePath: "capture/main.e57", inputType: "generic_e57" },
    ]), CAPTURED_ONLY_OPTIONS);

    expect(board).toMatchObject({
      state: "unavailable",
      cards: [],
      affectedAssets: [
        { assetId: "opaque-xbin", relativePath: "vendor/venue.xbin" },
      ],
    });
    expect(normalizedText(board)).toMatch(/official export/u);
    expect(normalizedText(board)).toMatch(/vendor/u);
  });

  it("is independent of manifest ordering and rejects duplicate asset IDs", () => {
    const source = mixedManifest();
    const reordered = FoundryIngestManifestV0Schema.parse({
      ...source,
      assets: [...source.assets].reverse(),
    });
    expect(compileLocalFoundryQualityDecisionBoardV0(reordered, AI_REQUESTED_OPTIONS))
      .toEqual(compileLocalFoundryQualityDecisionBoardV0(source, AI_REQUESTED_OPTIONS));

    const first = source.assets[0];
    if (first === undefined) throw new Error("missing duplicate-ID fixture asset");
    const duplicate: FoundryIngestManifestV0 = {
      ...source,
      assets: [
        ...source.assets,
        { ...first, relativePath: "duplicate/capture.e57" },
      ],
    };
    expect(() => compileLocalFoundryQualityDecisionBoardV0(duplicate, AI_REQUESTED_OPTIONS))
      .toThrow(/assets IDs must be unique/u);
  });
});
