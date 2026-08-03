import { describe, expect, it } from "vitest";
import {
  PHASE_LAYOUT_RUNTIME_ADMISSION_POLICY,
  PHASE_LAYOUT_RUNTIME_BINDING_SCHEMA_VERSION,
  PhaseLayoutHistoricalRuntimeSchema,
  PhaseLayoutRuntimeAvailableBindingSchema,
  PhaseLayoutRuntimeUnavailableBindingSchema,
  historicalRuntimeFromBinding,
  phaseLayoutRuntimeBindingDigest,
  phaseLayoutRuntimeCompositionDigest,
  runtimeTransformArtifactDigest,
  type PhaseLayoutRuntimeAvailableBinding,
  type PhaseLayoutRuntimeUnavailableBinding,
} from "../phase-layout-runtime-binding.js";

const SNAPSHOT_ID = "11111111-1111-4111-8111-111111111111";
const CANONICAL_ID = "22222222-2222-4222-8222-222222222222";
const VENUE_ID = "33333333-3333-4333-8333-333333333333";
const SPACE_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "55555555-5555-4555-8555-555555555555";
const PACKAGE_ID = "66666666-6666-4666-8666-666666666666";
const QA_ROW_ID = "77777777-7777-4777-8777-777777777777";
const TRANSFORM_ROW_ID = "88888888-8888-4888-8888-888888888888";
const ASSET_ID = "99999999-9999-4999-8999-999999999999";

const transformArtifact = {
  id: "grand-hall-cvf-to-arf-v1",
  sourceFrame: "CVF" as const,
  targetFrame: "ARF" as const,
  units: "meters" as const,
  matrix: [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ],
  alignmentMethod: "manual_alignment" as const,
  residualRmseM: null,
  landmarks: [],
  provenance: {
    state: "measured" as const,
    refs: [{ refType: "control_network" as const, ref: "grand-hall-controls-v1", role: "alignment" }],
  },
  creator: { actorType: "pipeline" as const, id: "venue-factory", role: "registration" },
  reviewer: { actorType: "human" as const, id: "reviewer-1", role: "spatial-reviewer" },
  date: "2026-08-03T10:00:00.000Z",
};

function availableBinding(): PhaseLayoutRuntimeAvailableBinding {
  const visualAssets = [{
    memberIndex: 0,
    assetVersionId: ASSET_ID,
    fileName: "grand-hall.sog",
    fileExt: ".sog" as const,
    mimeType: "application/octet-stream",
    sha256: "a".repeat(64),
    sizeBytes: 1_024,
    evidenceStatus: "human_reviewed" as const,
  }];
  const compositionDigest = phaseLayoutRuntimeCompositionDigest({
    runtimePackageId: PACKAGE_ID,
    runtimePackageContentDigest: "b".repeat(64),
    reviewedProfileId: "grand-hall-reviewed-v1",
    transformArtifactDigest: runtimeTransformArtifactDigest(transformArtifact),
    visualAssets,
  });
  const unsigned = {
    schemaVersion: PHASE_LAYOUT_RUNTIME_BINDING_SCHEMA_VERSION,
    admissionPolicy: PHASE_LAYOUT_RUNTIME_ADMISSION_POLICY,
    bindingId: SNAPSHOT_ID,
    phaseLayoutSnapshotId: SNAPSHOT_ID,
    canonicalSnapshotId: CANONICAL_ID,
    snapshotHash: "c".repeat(64),
    venueId: VENUE_ID,
    venueSlug: "trades-hall",
    spaceId: SPACE_ID,
    spaceSlug: "grand-hall",
    boundBy: USER_ID,
    boundAt: "2026-08-03T10:05:00.000Z",
    availability: "available" as const,
    runtimePackageId: PACKAGE_ID,
    runtimePackageRevision: 2,
    runtimePackageContentDigest: "b".repeat(64),
    runtimeManifestDigest: "d".repeat(64),
    runtimePackageEvidenceStatus: "human_reviewed" as const,
    runtimePackageStatus: "internal_ready" as const,
    reviewedProfileId: "grand-hall-reviewed-v1",
    reviewedProfileManifestFingerprint: "e".repeat(64),
    rightsEvidenceDigest: "f".repeat(64),
    sceneAuthorityMapDigest: "1".repeat(64),
    runtimeQaRecordId: QA_ROW_ID,
    runtimeQaRecordKey: "grand-hall-timeline-review-v1",
    runtimeQaRecordDigest: "2".repeat(64),
    runtimeQaDecision: "approved_internal_preview" as const,
    runtimeQaReviewedBy: USER_ID,
    runtimeQaReviewedAt: "2026-08-03T10:01:00.000Z",
    transformArtifactRowId: TRANSFORM_ROW_ID,
    transformArtifactId: transformArtifact.id,
    transformArtifactDigest: runtimeTransformArtifactDigest(transformArtifact),
    transformArtifact,
    visualAssets,
    compositionDigest,
  };
  return PhaseLayoutRuntimeAvailableBindingSchema.parse({
    ...unsigned,
    bindingDigest: phaseLayoutRuntimeBindingDigest(unsigned),
  });
}

function unavailableBinding(): PhaseLayoutRuntimeUnavailableBinding {
  const unsigned = {
    schemaVersion: PHASE_LAYOUT_RUNTIME_BINDING_SCHEMA_VERSION,
    admissionPolicy: PHASE_LAYOUT_RUNTIME_ADMISSION_POLICY,
    bindingId: SNAPSHOT_ID,
    phaseLayoutSnapshotId: SNAPSHOT_ID,
    canonicalSnapshotId: CANONICAL_ID,
    snapshotHash: "c".repeat(64),
    venueId: VENUE_ID,
    venueSlug: "trades-hall",
    spaceId: SPACE_ID,
    spaceSlug: "grand-hall",
    boundBy: USER_ID,
    boundAt: "2026-08-03T10:05:00.000Z",
    availability: "unavailable" as const,
    unavailableReason: "presentation_admission_missing" as const,
    expectedRuntimePackageId: PACKAGE_ID,
    expectedRuntimeManifestDigest: "d".repeat(64),
  };
  return PhaseLayoutRuntimeUnavailableBindingSchema.parse({
    ...unsigned,
    bindingDigest: phaseLayoutRuntimeBindingDigest(unsigned),
  });
}

describe("phase layout historical runtime binding", () => {
  it("seals an exact reviewed package, transform, provenance, and ordered member composition", () => {
    const binding = availableBinding();
    expect(binding.runtimePackageId).toBe(PACKAGE_ID);
    expect(binding.transformArtifactDigest).toBe(runtimeTransformArtifactDigest(transformArtifact));
    expect(binding.visualAssets).toHaveLength(1);
    expect(historicalRuntimeFromBinding(binding)).toEqual({ state: "available", binding });
  });

  it("rejects byte, transform, order, composition, and binding digest drift", () => {
    const binding = availableBinding();
    expect(PhaseLayoutRuntimeAvailableBindingSchema.safeParse({
      ...binding,
      visualAssets: [{ ...binding.visualAssets[0], sha256: "9".repeat(64) }],
    }).success).toBe(false);
    expect(PhaseLayoutRuntimeAvailableBindingSchema.safeParse({
      ...binding,
      transformArtifactDigest: "8".repeat(64),
    }).success).toBe(false);
    expect(PhaseLayoutRuntimeAvailableBindingSchema.safeParse({
      ...binding,
      bindingDigest: "7".repeat(64),
    }).success).toBe(false);
  });

  it("persists an honest unavailable decision without attaching a package later", () => {
    const binding = unavailableBinding();
    const runtime = historicalRuntimeFromBinding(binding);
    expect(runtime.state).toBe("unavailable");
    expect(runtime.binding).toEqual(binding);
    expect(PhaseLayoutHistoricalRuntimeSchema.safeParse(runtime).success).toBe(true);
  });

  it("represents pre-0063 frozen rows explicitly as legacy-unbound", () => {
    expect(historicalRuntimeFromBinding(null)).toEqual({
      state: "unavailable",
      binding: null,
      reason: "legacy_snapshot_unbound",
      message: "This older frozen layout has no immutable historical room binding.",
    });
  });
});
