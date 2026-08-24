import {
  FOUNDRY_INGEST_MANIFEST_V0,
  FOUNDRY_INTAKE_ADMISSION_CAPABILITIES,
  FOUNDRY_INTAKE_ADMISSION_RESULT_V0,
  FoundryIngestManifestV0Schema,
  FoundryIntakeAdmissionResultPayloadSchema,
  FoundryIntakeAdmissionResultV0Schema,
  computeFoundryIngestManifestSha256,
  computeFoundryIntakeAdmissionResultSha256,
  type FoundryIngestManifestV0,
  type FoundryIntakeAdmissionResultV0,
} from "@omnitwin/types";
import { describe, expect, it } from "vitest";
import { FoundryIntegrityError } from "../errors.js";
import {
  FOUNDRY_MULTI_ROOT_CAPTURE_BUNDLE_V0,
  FoundryMultiRootCaptureBundlePayloadV0Schema,
  FoundryMultiRootCaptureBundleV0Schema,
  composeFoundryMultiRootCaptureBundleV0,
  computeFoundryMultiRootCaptureBundleSha256,
  type FoundryMultiRootCaptureBundleInputV0,
} from "../multi-root-capture-bundle.js";

const NOW = "2026-08-09T12:00:00.000Z";

function digest(value: number): string {
  return `sha256:${value.toString(16).padStart(64, "0")}`;
}

function rights() {
  return {
    basis: "customer_owned" as const,
    commercialUse: "allowed" as const,
    modelTrainingUse: "requires_review" as const,
    redistribution: "restricted" as const,
    termsReviewedAt: NOW,
    termsReference: "https://rights.example/grand-hall",
    restrictions: ["internal_processing_only"],
  };
}

function asset(
  id: string,
  shaIndex: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    sourceRootId: "root",
    relativePath: `${id}.bin`,
    inputType: "generic_e57",
    mediaType: "application/octet-stream",
    sizeBytes: 1_024 + shaIndex,
    sha256: digest(shaIndex),
    immutable: true,
    captureState: "raw_capture",
    accessState: "direct",
    capturedAt: null,
    coordinateFrameId: null,
    calibrationAssetIds: [],
    parentAssetIds: [],
    rights: rights(),
    provenanceClass: "captured",
    evidenceKinds: [],
    inspection: {
      geometryValue: "medium",
      appearanceValue: "medium",
      calibrationValue: "medium",
      scaleValue: "medium",
      metadataKeys: ["fixture"],
      decisiveNextTest: "Review the already-recorded fixture metadata.",
    },
    notes: [],
    ...overrides,
  };
}

function richManifest(
  legalReviewState:
    | "not_reviewed"
    | "requires_review"
    | "blocked" = "requires_review",
): FoundryIngestManifestV0 {
  return FoundryIngestManifestV0Schema.parse({
    schemaVersion: FOUNDRY_INGEST_MANIFEST_V0,
    projectId: "grand-hall-e57",
    createdAt: NOW,
    createdBy: "intake-reviewer",
    sourceRoots: [
      {
        id: "root",
        kind: "local_directory",
        displayName: "Redacted read-only E57 root",
        locationRedacted: "CAPTURE_ROOT/[redacted]",
        caseSensitivity: "insensitive",
        readOnly: true,
      },
    ],
    coordinateFrames: [
      {
        id: "source-frame",
        kind: "lidar",
        units: "meters",
        handedness: "right",
        upAxis: "z",
        authority: "measured",
        provenanceAssetIds: ["raw"],
        crs: null,
      },
      {
        id: "target-frame",
        kind: "venue_control",
        units: "meters",
        handedness: "right",
        upAxis: "z",
        authority: "registered",
        provenanceAssetIds: ["transform-proof"],
        crs: null,
      },
    ],
    transforms: [
      {
        id: "alignment",
        sourceFrameId: "source-frame",
        targetFrameId: "target-frame",
        operationKind: "affine_similarity",
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        state: "reviewed",
        transformArtifactAssetId: "transform-proof",
        residualReportAssetId: "residual-proof",
        projectionArtifactAssetId: null,
        reviewerAttestationAssetId: "reviewer-proof",
        provenanceAssetIds: ["raw", "calibration"],
      },
    ],
    assets: [
      asset("raw", 1, {
        coordinateFrameId: "source-frame",
        calibrationAssetIds: ["calibration"],
      }),
      asset("calibration", 2, {
        inputType: "calibration_bundle",
        captureState: "official_export",
        coordinateFrameId: "source-frame",
      }),
      asset("transform-proof", 3, {
        inputType: "evidence_record",
        captureState: "reference",
        evidenceKinds: ["transform_artifact"],
      }),
      asset("residual-proof", 4, {
        inputType: "evidence_record",
        captureState: "reference",
        evidenceKinds: ["residual_report"],
      }),
      asset("reviewer-proof", 5, {
        inputType: "evidence_record",
        captureState: "reference",
        evidenceKinds: ["reviewer_attestation"],
      }),
      asset("mask", 6, {
        inputType: "evidence_record",
        captureState: "derived",
        coordinateFrameId: "source-frame",
        parentAssetIds: ["raw"],
        provenanceClass: "enhanced_captured",
        evidenceKinds: ["mask"],
      }),
      asset("generated", 7, {
        inputType: "generic_image",
        captureState: "derived",
        coordinateFrameId: "target-frame",
        parentAssetIds: ["raw", "mask"],
        provenanceClass: "generated_cinematic",
      }),
    ],
    provenanceEdges: [
      {
        id: "mask-edge",
        operationId: "mask-operation",
        inputAssetIds: ["raw"],
        outputAssetId: "mask",
        operationVersion: "1.0.0",
        environmentDigest: digest(20),
        createdAt: NOW,
      },
      {
        id: "generation-edge",
        operationId: "generation-operation",
        inputAssetIds: ["raw", "mask"],
        outputAssetId: "generated",
        operationVersion: "1.0.0",
        environmentDigest: digest(21),
        createdAt: NOW,
      },
    ],
    generatedRegions: [
      {
        id: "generated-region",
        outputAssetId: "generated",
        sourceAssetIds: ["raw"],
        maskAssetId: "mask",
        provenanceClass: "generated_cinematic",
        modelName: "fixture-model",
        modelVersion: "1.0.0",
        checkpointSha256: digest(22),
        promptOrConditionDigest: digest(23),
        confidence: 0.8,
        exportRestrictions: ["internal_review_only"],
        truthModeDisclosure:
          "This fixture region is generated cinema and is not measured venue evidence.",
      },
    ],
    legalReviewState,
    sourceMutationPermitted: false,
  });
}

function simpleManifest(
  projectId: string,
  shaIndex: number,
  legalReviewState:
    | "not_reviewed"
    | "requires_review"
    | "blocked" = "requires_review",
): FoundryIngestManifestV0 {
  return FoundryIngestManifestV0Schema.parse({
    schemaVersion: FOUNDRY_INGEST_MANIFEST_V0,
    projectId,
    createdAt: NOW,
    createdBy: "intake-reviewer",
    sourceRoots: [
      {
        id: "root",
        kind: "local_directory",
        displayName: "Redacted read-only panorama root",
        locationRedacted: "PANORAMA_ROOT/[redacted]",
        caseSensitivity: "insensitive",
        readOnly: true,
      },
    ],
    coordinateFrames: [],
    transforms: [],
    assets: [
      asset("capture", shaIndex, {
        inputType: "panorama_360",
        mediaType: "image/jpeg",
        relativePath: "capture.jpg",
      }),
    ],
    provenanceEdges: [],
    generatedRegions: [],
    legalReviewState,
    sourceMutationPermitted: false,
  });
}

function admissionResult(
  manifest: FoundryIngestManifestV0,
  custodyIndex: number,
): FoundryIntakeAdmissionResultV0 {
  const payload = FoundryIntakeAdmissionResultPayloadSchema.parse({
    schemaVersion: FOUNDRY_INTAKE_ADMISSION_RESULT_V0,
    receiptSha256: digest(100 + custodyIndex).slice("sha256:".length),
    reviewSha256: digest(200 + custodyIndex),
    manifestSha256: computeFoundryIngestManifestSha256(manifest),
    manifest,
    exclusions: [],
    authority: "none",
    capabilities: FOUNDRY_INTAKE_ADMISSION_CAPABILITIES,
  });
  return FoundryIntakeAdmissionResultV0Schema.parse({
    ...payload,
    resultSha256: computeFoundryIntakeAdmissionResultSha256(payload),
  });
}

function input(
  first: FoundryIntakeAdmissionResultV0,
  second: FoundryIntakeAdmissionResultV0,
): FoundryMultiRootCaptureBundleInputV0 {
  return {
    projectId: "grand-hall-combined",
    createdAt: NOW,
    createdBy: "bundle-composer",
    mounts: [
      { namespaceId: "e57", admissionResult: first },
      { namespaceId: "panoramas", admissionResult: second },
    ],
  };
}

function mapping(
  entries: readonly {
    readonly originalId: string;
    readonly combinedId: string;
  }[],
  originalId: string,
): string {
  const combinedId = entries.find(
    (entry) => entry.originalId === originalId,
  )?.combinedId;
  if (combinedId === undefined)
    throw new Error(`Missing test mapping for ${originalId}`);
  return combinedId;
}

describe("composeFoundryMultiRootCaptureBundleV0", () => {
  it("combines two verified roots with authority none and preserves custody digests", () => {
    const e57 = admissionResult(richManifest(), 1);
    const panoramas = admissionResult(simpleManifest("grand-hall-panos", 8), 2);

    const bundle = composeFoundryMultiRootCaptureBundleV0(
      input(e57, panoramas),
    );

    expect(bundle.schemaVersion).toBe(FOUNDRY_MULTI_ROOT_CAPTURE_BUNDLE_V0);
    expect(bundle.authority).toBe("none");
    expect(bundle.capabilities).toEqual(FOUNDRY_INTAKE_ADMISSION_CAPABILITIES);
    expect(bundle.manifest.sourceMutationPermitted).toBe(false);
    expect(bundle.manifest.sourceRoots).toHaveLength(2);
    expect(bundle.mounts.map((mount) => mount.namespaceId)).toEqual([
      "e57",
      "panoramas",
    ]);
    expect(bundle.mounts[0]).toMatchObject({
      originalAdmissionResult: e57,
      originalResultSha256: e57.resultSha256,
      originalManifestSha256: e57.manifestSha256,
      originalReceiptSha256: e57.receiptSha256,
      originalReviewSha256: e57.reviewSha256,
      originalProjectId: e57.manifest.projectId,
    });
    expect(bundle.mounts[1]).toMatchObject({
      originalAdmissionResult: panoramas,
      originalResultSha256: panoramas.resultSha256,
      originalManifestSha256: panoramas.manifestSha256,
      originalReceiptSha256: panoramas.receiptSha256,
      originalReviewSha256: panoramas.reviewSha256,
      originalProjectId: panoramas.manifest.projectId,
    });
    expect(FoundryIngestManifestV0Schema.parse(bundle.manifest)).toEqual(
      bundle.manifest,
    );
    expect(FoundryMultiRootCaptureBundleV0Schema.parse(bundle)).toEqual(bundle);
    const { bundleSha256: _bundleSha256, ...payload } = bundle;
    expect(bundle.bundleSha256).toBe(
      computeFoundryMultiRootCaptureBundleSha256(payload),
    );
  });

  it("is deterministic regardless of mount input order", () => {
    const e57 = admissionResult(richManifest(), 1);
    const panoramas = admissionResult(simpleManifest("grand-hall-panos", 8), 2);
    const forward = input(e57, panoramas);
    const reverse: FoundryMultiRootCaptureBundleInputV0 = {
      ...forward,
      mounts: [...forward.mounts].reverse(),
    };

    expect(composeFoundryMultiRootCaptureBundleV0(reverse)).toEqual(
      composeFoundryMultiRootCaptureBundleV0(forward),
    );
  });

  it("remaps every ID and reference class through the transparent map", () => {
    const bundle = composeFoundryMultiRootCaptureBundleV0(
      input(
        admissionResult(richManifest(), 1),
        admissionResult(simpleManifest("grand-hall-panos", 8), 2),
      ),
    );
    const mount = bundle.mounts.find(
      (candidate) => candidate.namespaceId === "e57",
    );
    expect(mount).toBeDefined();
    if (mount === undefined) return;

    const rootId = mapping(mount.idMap.sourceRoots, "root");
    const rawId = mapping(mount.idMap.assets, "raw");
    const calibrationId = mapping(mount.idMap.assets, "calibration");
    const maskId = mapping(mount.idMap.assets, "mask");
    const generatedId = mapping(mount.idMap.assets, "generated");
    const sourceFrameId = mapping(mount.idMap.coordinateFrames, "source-frame");
    const targetFrameId = mapping(mount.idMap.coordinateFrames, "target-frame");

    const raw = bundle.manifest.assets.find(
      (candidate) => candidate.id === rawId,
    );
    expect(raw).toMatchObject({
      sourceRootId: rootId,
      coordinateFrameId: sourceFrameId,
      calibrationAssetIds: [calibrationId],
      parentAssetIds: [],
    });
    expect(
      bundle.manifest.coordinateFrames.find(
        (frame) => frame.id === sourceFrameId,
      ),
    ).toMatchObject({ provenanceAssetIds: [rawId] });

    const transformId = mapping(mount.idMap.transforms, "alignment");
    expect(
      bundle.manifest.transforms.find(
        (transform) => transform.id === transformId,
      ),
    ).toMatchObject({
      sourceFrameId,
      targetFrameId,
      transformArtifactAssetId: mapping(mount.idMap.assets, "transform-proof"),
      residualReportAssetId: mapping(mount.idMap.assets, "residual-proof"),
      reviewerAttestationAssetId: mapping(mount.idMap.assets, "reviewer-proof"),
      provenanceAssetIds: [rawId, calibrationId],
    });

    const edgeId = mapping(mount.idMap.provenanceEdges, "generation-edge");
    expect(
      bundle.manifest.provenanceEdges.find((edge) => edge.id === edgeId),
    ).toMatchObject({
      operationId: mapping(mount.idMap.operationIds, "generation-operation"),
      inputAssetIds: [rawId, maskId],
      outputAssetId: generatedId,
    });

    const regionId = mapping(mount.idMap.generatedRegions, "generated-region");
    expect(
      bundle.manifest.generatedRegions.find((region) => region.id === regionId),
    ).toMatchObject({
      outputAssetId: generatedId,
      sourceAssetIds: [rawId],
      maskAssetId: maskId,
    });

    for (const category of Object.values(mount.idMap)) {
      for (const entry of category) {
        expect(entry.combinedId).not.toBe(entry.originalId);
      }
    }
  });

  it("rejects exact-content declarations across distinct roots", () => {
    const first = admissionResult(richManifest(), 1);
    const duplicate = admissionResult(simpleManifest("staged-copy", 1), 2);

    expect.assertions(3);
    try {
      composeFoundryMultiRootCaptureBundleV0(input(first, duplicate));
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(FoundryIntegrityError);
      expect((error as FoundryIntegrityError).code).toBe(
        "MULTI_ROOT_DUPLICATE_CONTENT",
      );
      expect((error as Error).message).toContain(
        "Exclude the original or staged duplicate during intake",
      );
    }
  });

  it("rejects namespace collisions before composing", () => {
    const first = admissionResult(richManifest(), 1);
    const second = admissionResult(simpleManifest("grand-hall-panos", 8), 2);
    const collision: FoundryMultiRootCaptureBundleInputV0 = {
      ...input(first, second),
      mounts: [
        { namespaceId: "capture", admissionResult: first },
        { namespaceId: "capture", admissionResult: second },
      ],
    };

    expect(() => composeFoundryMultiRootCaptureBundleV0(collision)).toThrow(
      /namespace IDs must be unique/u,
    );
  });

  it("propagates the strictest legal-review state without changing asset rights", () => {
    const requiresReview = admissionResult(richManifest("requires_review"), 1);
    const blocked = admissionResult(
      simpleManifest("blocked-panos", 8, "blocked"),
      2,
    );

    const bundle = composeFoundryMultiRootCaptureBundleV0(
      input(requiresReview, blocked),
    );
    expect(bundle.manifest.legalReviewState).toBe("blocked");
    const e57Mount = bundle.mounts.find((mount) => mount.namespaceId === "e57");
    expect(e57Mount?.originalLegalReviewState).toBe("requires_review");
    const rawId =
      e57Mount === undefined
        ? "missing"
        : mapping(e57Mount.idMap.assets, "raw");
    expect(
      bundle.manifest.assets.find((assetValue) => assetValue.id === rawId)
        ?.rights,
    ).toEqual(requiresReview.manifest.assets[0]?.rights);
  });

  it("rejects admission-result and manifest digest tampering", () => {
    const first = admissionResult(richManifest(), 1);
    const second = admissionResult(simpleManifest("grand-hall-panos", 8), 2);
    const resultDigestTamper = {
      ...first,
      resultSha256: digest(999),
    } as FoundryIntakeAdmissionResultV0;
    const manifestTamper = {
      ...first,
      manifest: {
        ...first.manifest,
        assets: first.manifest.assets.map((assetValue, index) =>
          index === 0
            ? { ...assetValue, notes: ["tampered after admission"] }
            : assetValue,
        ),
      },
    } as FoundryIntakeAdmissionResultV0;

    expect(() =>
      composeFoundryMultiRootCaptureBundleV0(input(resultDigestTamper, second)),
    ).toThrow(/admission result digest must match/u);
    expect(() =>
      composeFoundryMultiRootCaptureBundleV0(input(manifestTamper, second)),
    ).toThrow(/admission result must bind the exact ingest manifest/u);
  });

  it("rejects capture-bundle self-digest tampering", () => {
    const bundle = composeFoundryMultiRootCaptureBundleV0(
      input(
        admissionResult(richManifest(), 1),
        admissionResult(simpleManifest("grand-hall-panos", 8), 2),
      ),
    );
    const tampered = {
      ...bundle,
      bundleSha256: digest(998),
    };

    expect(
      FoundryMultiRootCaptureBundleV0Schema.safeParse(tampered).success,
    ).toBe(false);
  });

  it("rejects re-declared legal state and ID mappings against embedded admissions before self-digest validation", () => {
    const bundle = composeFoundryMultiRootCaptureBundleV0(
      input(
        admissionResult(richManifest(), 1),
        admissionResult(simpleManifest("grand-hall-panos", 8), 2),
      ),
    );
    const { bundleSha256: _bundleSha256, ...payload } = structuredClone(bundle);
    const firstMount = payload.mounts[0];
    if (firstMount === undefined) throw new Error("expected first mount");
    firstMount.originalLegalReviewState = "not_reviewed";
    expect(
      FoundryMultiRootCaptureBundlePayloadV0Schema.safeParse(payload).success,
    ).toBe(false);

    const { bundleSha256: _secondDigest, ...mappingPayload } =
      structuredClone(bundle);
    const firstMapping = mappingPayload.mounts[0]?.idMap.assets[0];
    if (firstMapping === undefined) throw new Error("expected asset mapping");
    firstMapping.originalId = "substituted-asset";
    expect(
      FoundryMultiRootCaptureBundlePayloadV0Schema.safeParse(mappingPayload)
        .success,
    ).toBe(false);
  });
});
