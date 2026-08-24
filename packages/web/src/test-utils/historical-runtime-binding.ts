import {
  PHASE_LAYOUT_RUNTIME_ADMISSION_POLICY,
  PHASE_LAYOUT_RUNTIME_BINDING_SCHEMA_VERSION,
  PhaseLayoutRuntimeAvailableBindingSchema,
  phaseLayoutRuntimeBindingDigest,
  phaseLayoutRuntimeCompositionDigest,
  runtimeTransformArtifactDigest,
  type PhaseLayoutRuntimeAvailableBinding,
  type TransformArtifactV0,
} from "@omnitwin/types";
import type { HistoricalRuntimeRenderInput } from "../stores/layout-timeline-preview-store.js";

const DEFAULT_TRANSFORM: TransformArtifactV0 = {
  id: "grand-hall-arf-to-rrf-v1",
  sourceFrame: "ARF",
  targetFrame: "RRF",
  units: "meters",
  matrix: [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ],
  alignmentMethod: "manual_alignment",
  residualRmseM: null,
  landmarks: [],
  provenance: {
    state: "measured",
    refs: [{ refType: "control_network", ref: "grand-hall-controls-v1", role: "alignment" }],
  },
  creator: { actorType: "pipeline", id: "venue-factory", role: "registration" },
  reviewer: { actorType: "human", id: "reviewer-1", role: "spatial-reviewer" },
  date: "2026-08-03T10:00:00.000Z",
};

export interface HistoricalRuntimeBindingFixtureOptions {
  readonly bindingId?: string;
  readonly canonicalSnapshotId?: string;
  readonly venueId?: string;
  readonly spaceId?: string;
  readonly runtimePackageId?: string;
  readonly runtimePackageRevision?: number;
  readonly runtimePackageContentDigest?: string;
  readonly assetVersionId?: string;
  readonly sha256?: string;
  readonly sizeBytes?: number;
  readonly memberSizeBytes?: readonly number[];
  readonly mimeType?: string;
  readonly fileName?: string;
  readonly transformArtifact?: TransformArtifactV0;
}

export function historicalRuntimeBindingFixture(
  options: HistoricalRuntimeBindingFixtureOptions = {},
): PhaseLayoutRuntimeAvailableBinding {
  const bindingId = options.bindingId ?? "11111111-1111-4111-8111-111111111111";
  const runtimePackageId = options.runtimePackageId ?? "66666666-6666-4666-8666-666666666666";
  const transformArtifact = options.transformArtifact ?? DEFAULT_TRANSFORM;
  const transformArtifactDigest = runtimeTransformArtifactDigest(transformArtifact);
  const memberSizeBytes = options.memberSizeBytes ?? [options.sizeBytes ?? 1_024];
  const visualAssets = memberSizeBytes.map((sizeBytes, memberIndex) => {
    const fileName = memberIndex === 0
      ? options.fileName ?? "grand-hall.sog"
      : `grand-hall-${String(memberIndex)}.sog`;
    return {
      memberIndex,
      assetVersionId: memberIndex === 0
        ? options.assetVersionId ?? "99999999-9999-4999-8999-999999999999"
        : `99999999-9999-4999-8999-${String(999_999_999_999 - memberIndex).padStart(12, "0")}`,
      fileName,
      fileExt: fileName.endsWith(".spz") ? ".spz" as const : ".sog" as const,
      mimeType: options.mimeType ?? "application/octet-stream",
      sha256: options.sha256 ?? "a".repeat(64),
      sizeBytes,
      evidenceStatus: "human_reviewed" as const,
    };
  });
  const runtimePackageContentDigest = options.runtimePackageContentDigest ?? (
    options.runtimePackageId === undefined
      ? "b".repeat(64)
      : phaseLayoutRuntimeCompositionDigest({ fixtureRuntimePackageId: runtimePackageId })
  );
  const compositionDigest = phaseLayoutRuntimeCompositionDigest({
    runtimePackageId,
    runtimePackageContentDigest,
    reviewedProfileId: "grand-hall-reviewed-v1",
    transformArtifactDigest,
    visualAssets,
  });
  const unsigned = {
    schemaVersion: PHASE_LAYOUT_RUNTIME_BINDING_SCHEMA_VERSION,
    admissionPolicy: PHASE_LAYOUT_RUNTIME_ADMISSION_POLICY,
    bindingId,
    phaseLayoutSnapshotId: bindingId,
    canonicalSnapshotId: options.canonicalSnapshotId ?? "22222222-2222-4222-8222-222222222222",
    snapshotHash: "c".repeat(64),
    venueId: options.venueId ?? "33333333-3333-4333-8333-333333333333",
    venueSlug: "trades-hall",
    spaceId: options.spaceId ?? "44444444-4444-4444-8444-444444444444",
    spaceSlug: "grand-hall",
    boundBy: "55555555-5555-4555-8555-555555555555",
    boundAt: "2026-08-03T10:05:00.000Z",
    availability: "available" as const,
    runtimePackageId,
    runtimePackageRevision: options.runtimePackageRevision ?? 2,
    runtimePackageContentDigest,
    runtimeManifestDigest: "d".repeat(64),
    runtimePackageEvidenceStatus: "human_reviewed" as const,
    runtimePackageStatus: "internal_ready" as const,
    reviewedProfileId: "grand-hall-reviewed-v1",
    reviewedProfileManifestFingerprint: "e".repeat(64),
    rightsEvidenceDigest: "f".repeat(64),
    sceneAuthorityMapDigest: "1".repeat(64),
    runtimeQaRecordId: "77777777-7777-4777-8777-777777777777",
    runtimeQaRecordKey: "grand-hall-timeline-review-v1",
    runtimeQaRecordDigest: "2".repeat(64),
    runtimeQaDecision: "approved_internal_preview" as const,
    runtimeQaReviewedBy: "55555555-5555-4555-8555-555555555555",
    runtimeQaReviewedAt: "2026-08-03T10:01:00.000Z",
    transformArtifactRowId: "88888888-8888-4888-8888-888888888888",
    transformArtifactId: transformArtifact.id,
    transformArtifactDigest,
    transformArtifact,
    visualAssets,
    compositionDigest,
  };
  return PhaseLayoutRuntimeAvailableBindingSchema.parse({
    ...unsigned,
    bindingDigest: phaseLayoutRuntimeBindingDigest(unsigned),
  });
}

/** Constructs the branded dormant renderer branch for unit tests only. */
export function historicalRuntimeRenderInputFixture(
  binding: PhaseLayoutRuntimeAvailableBinding,
): HistoricalRuntimeRenderInput {
  return { state: "available", binding } as HistoricalRuntimeRenderInput;
}
