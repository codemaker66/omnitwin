import { describe, expect, it } from "vitest";

import {
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_WIDTH_PX,
} from "../grand-hall-room-scope-artifacts.js";
import {
  GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT,
  GRAND_HALL_SUPPLIED_PANORAMA_SWEEP_NUMBERS,
  GrandHallPanoramaSourceInventoryV3Schema,
  computeGrandHallPanoramaSourceInventoryV3Sha256,
  type GrandHallPanoramaSourceInventoryV3,
} from "../grand-hall-room-scope-artifacts-v2.js";
import { GRAND_HALL_T554_HUMAN_DECISIONS_V3 } from "../grand-hall-room-scope-artifacts-v3.js";
import {
  GRAND_HALL_T554_NATIVE_COVERAGE_BITMAP_BYTE_LENGTH,
  GRAND_HALL_T554_NATIVE_COVERAGE_CELL_COUNT,
  GRAND_HALL_T554_NATIVE_COVERAGE_CELL_HEIGHT_PX,
  GRAND_HALL_T554_NATIVE_COVERAGE_CELL_WIDTH_PX,
  GRAND_HALL_T554_NATIVE_COVERAGE_COLUMN_COUNT,
  GRAND_HALL_T554_NATIVE_COVERAGE_ROW_COUNT,
  GRAND_HALL_T554_FROZEN_MASK_MAX_BYTE_LENGTH,
  GRAND_HALL_T554_JSON_EVIDENCE_MAX_BYTE_LENGTH,
  GRAND_HALL_T554_NATIVE_REVIEW_EVIDENCE_V1,
  GRAND_HALL_T554_PENDING_WORKBENCH_EXPORT_RECEIPT_V1,
  GRAND_HALL_T554_SOURCE_JPEG_MAX_BYTE_LENGTH,
  GRAND_HALL_T554_WORKBENCH_CREATED_BY,
  GrandHallT554NativeReviewEvidenceMaterialV1Schema,
  GrandHallT554NativeReviewEvidenceV1Schema,
  GrandHallT554PendingWorkbenchExportReceiptMaterialV1Schema,
  GrandHallT554PendingWorkbenchExportReceiptV1Schema,
  computeGrandHallT554CoverageBitmapSha256,
  computeGrandHallT554NativeReviewEvidenceV1Sha256,
  computeGrandHallT554PendingWorkbenchExportReceiptV1Sha256,
  formatGrandHallT554NativeEvidenceFileName,
  sealGrandHallT554NativeReviewEvidenceV1,
  sealGrandHallT554PendingWorkbenchExportReceiptV1,
  type GrandHallT554CompletedNativeCoverageV1,
  type GrandHallT554FrozenStrictMaskBindingV1,
  type GrandHallT554NativeReviewEvidenceMaterialV1,
  type GrandHallT554PendingWorkbenchExportReceiptMaterialV1,
} from "../grand-hall-t554-native-review-evidence-v1.js";

const PANORAMA_PIXEL_COUNT =
  GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX;
const COMPLETE_BITMAP_HEX = "ff".repeat(
  GRAND_HALL_T554_NATIVE_COVERAGE_BITMAP_BYTE_LENGTH,
);

function digest(seed: number): `sha256:${string}` {
  return `sha256:${seed.toString(16).padStart(64, "0")}`;
}

function panoramaSources(): GrandHallPanoramaSourceInventoryV3 {
  return GrandHallPanoramaSourceInventoryV3Schema.parse(
    GRAND_HALL_SUPPLIED_PANORAMA_SWEEP_NUMBERS.map((sweepNumber, inventoryIndex) => ({
      inventoryIndex,
      sweepNumber,
      fileName: sweepNumber === 99
        ? "sweep_099pg.jpg"
        : sweepNumber === 145
        ? "sweep_145pg.jpg"
        : sweepNumber >= 148
        ? `sweep_0${String(sweepNumber)}jpg.jpg`
        : `sweep_${String(sweepNumber).padStart(3, "0")}jpg.jpg`,
      sha256: digest(1_000 + inventoryIndex),
      byteLength: 5_000_000 + inventoryIndex,
      widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
      heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
    })),
  );
}

function bitmap(
  coveredCellBitsetHex = COMPLETE_BITMAP_HEX,
  coveredCellCount = GRAND_HALL_T554_NATIVE_COVERAGE_CELL_COUNT,
) {
  return {
    bitOrder: "least_significant_bit_first_within_each_byte" as const,
    cellOrder: "row_major_top_to_bottom_left_to_right" as const,
    byteLength: GRAND_HALL_T554_NATIVE_COVERAGE_BITMAP_BYTE_LENGTH,
    coveredCellBitsetHex,
    coveredCellBitsetSha256:
      computeGrandHallT554CoverageBitmapSha256(coveredCellBitsetHex),
    coveredCellCount,
  };
}

function completeCoverage(
  subjectKind: "source_jpeg" | "frozen_binary_mask",
  subjectSha256: string,
  startedAt: string,
  endedAt: string,
): GrandHallT554CompletedNativeCoverageV1 {
  return {
    schemaVersion: "venviewer.grand-hall-t554-native-grid-coverage.v1",
    subjectKind,
    subjectSha256,
    sourceGridWidthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
    sourceGridHeightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
    cellWidthPx: GRAND_HALL_T554_NATIVE_COVERAGE_CELL_WIDTH_PX,
    cellHeightPx: GRAND_HALL_T554_NATIVE_COVERAGE_CELL_HEIGHT_PX,
    columnCount: GRAND_HALL_T554_NATIVE_COVERAGE_COLUMN_COUNT,
    rowCount: GRAND_HALL_T554_NATIVE_COVERAGE_ROW_COUNT,
    cellCount: GRAND_HALL_T554_NATIVE_COVERAGE_CELL_COUNT,
    complete: true,
    coverage: bitmap(),
    reviewIntervals: [
      {
        startedAt,
        endedAt,
        minimumEffectiveDevicePixelsPerSourcePixel: 1,
        tabVisibleThroughout: true,
        viewerFocusedThroughout: true,
        naturalDimensionsVerified: true,
        serverClampedHeartbeatDurationMs: 60_000,
        coverage: bitmap(),
      },
    ],
  };
}

function frozenMask(seed = 20_000): GrandHallT554FrozenStrictMaskBindingV1 {
  return {
    fileName: `masks/sweep-${String(seed)}.png`,
    sha256: digest(seed),
    byteLength: 750_000 + seed,
    widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
    heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
    bitDepth: 8,
    channelCount: 1,
    colourType: "grayscale",
    alphaPresent: false,
    ancillaryMetadataPresent: false,
    permittedPixelValues: [0, 255],
    zeroMeaning: "grand_hall_included",
    twoHundredFiftyFiveMeaning: "excluded_or_unknown",
    includedPixelCount: PANORAMA_PIXEL_COUNT - 1,
    excludedPixelCount: 1,
    reasonCodes: ["unverified_or_unknown_pixels"],
    exactBinarySourceGridDecoded: true,
    immutableFrozen: true,
  };
}

function includeMaterial(
  source = panoramaSources()[0]!,
  mask = frozenMask(),
): GrandHallT554NativeReviewEvidenceMaterialV1 {
  return GrandHallT554NativeReviewEvidenceMaterialV1Schema.parse({
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_EVIDENCE_V1,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    reviewPackSha256: digest(2_001),
    workbenchImplementationSha256: digest(2_002),
    source,
    sourceVerification: {
      sha256: source.sha256,
      byteLength: source.byteLength,
      widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
      heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
      sameOpenDescriptorHashedAndDecoded: true,
      fullJpegDecodeCompleted: true,
      decodedChannelCount: 3,
      decodedBitsPerSample: 8,
      alphaPresent: false,
      orientationMetadataPresent: false,
    },
    sourceReviewCoverage: completeCoverage(
      "source_jpeg",
      source.sha256,
      "2026-08-26T12:00:00.000Z",
      "2026-08-26T12:01:00.000Z",
    ),
    decision: {
      result: "INCLUDE",
      classification: "grand_hall_core",
      note: "The reviewed source contains supported Grand Hall pixels.",
      mask,
      maskReviewCoverage: completeCoverage(
        "frozen_binary_mask",
        mask.sha256,
        "2026-08-26T12:02:00.000Z",
        "2026-08-26T12:03:00.000Z",
      ),
    },
    humanAttestation: {
      reviewerId: "authorized-venue-reviewer",
      reviewerRole: "venue_owner_or_authorized_domain_reviewer",
      knowledgeBasis: ["Direct knowledge of the Grand Hall and supplied capture."],
      attestedAt: "2026-08-26T12:04:00.000Z",
      statement:
        "I reviewed the exact bound source at native scale and recorded only what I could support from supplied evidence.",
      agentDecisionAuthority: "none",
    },
    sealedAt: "2026-08-26T12:05:00.000Z",
    storageSemantics: "content_addressed_no_replace",
    evidenceScope: "procedural_native_grid_review_only",
    humanPresenceProof: "not_cryptographic",
    authority: "none",
    acceptanceAuthorized: false,
    reconstructionAuthorized: false,
    runtimeAuthorized: false,
    generatedContentAuthorized: false,
  });
}

function excludeMaterial(
  source = panoramaSources()[1]!,
): GrandHallT554NativeReviewEvidenceMaterialV1 {
  const include = includeMaterial(source);
  return GrandHallT554NativeReviewEvidenceMaterialV1Schema.parse({
    ...include,
    decision: {
      result: "EXCLUDE",
      classification: "no_observed_grand_hall_pixels",
      note: "No Grand Hall pixels were observed in the reviewed source.",
      mask: null,
      maskReviewCoverage: null,
    },
  });
}

function pendingExportMaterial(): GrandHallT554PendingWorkbenchExportReceiptMaterialV1 {
  const sources = panoramaSources();
  const includedMask = frozenMask();
  const includeReceiptSha256 = digest(30_001);
  const excludeReceiptSha256 = digest(30_003);
  const sourceRecords = sources.map((source, index) => {
    if (index === 0) {
      return {
        source,
        result: "INCLUDE" as const,
        nativeResolutionHumanReviewCompleted: true as const,
        nativeReviewEvidence: {
          fileName: formatGrandHallT554NativeEvidenceFileName(
            source.inventoryIndex,
            includeReceiptSha256,
          ),
          receiptSha256: includeReceiptSha256,
          fileSha256: digest(30_002),
          byteLength: 9_001,
        },
        maskReviewed: true as const,
        mask: includedMask,
      };
    }
    if (index === 1) {
      return {
        source,
        result: "EXCLUDE" as const,
        nativeResolutionHumanReviewCompleted: true as const,
        nativeReviewEvidence: {
          fileName: formatGrandHallT554NativeEvidenceFileName(
            source.inventoryIndex,
            excludeReceiptSha256,
          ),
          receiptSha256: excludeReceiptSha256,
          fileSha256: digest(30_004),
          byteLength: 9_002,
        },
        maskReviewed: false as const,
        mask: null,
      };
    }
    return {
      source,
      result: "UNSURE" as const,
      nativeResolutionHumanReviewCompleted: false as const,
      nativeReviewEvidence: null,
      maskReviewed: false as const,
      mask: null,
    };
  });
  return GrandHallT554PendingWorkbenchExportReceiptMaterialV1Schema.parse({
    schemaVersion: GRAND_HALL_T554_PENDING_WORKBENCH_EXPORT_RECEIPT_V1,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    createdAt: "2026-08-26T13:00:00.000Z",
    createdBy: GRAND_HALL_T554_WORKBENCH_CREATED_BY,
    reviewPackSha256: digest(40_001),
    workbenchImplementationSha256: digest(40_002),
    workspaceStateSha256: digest(40_003),
    panoramaSourceInventorySha256:
      computeGrandHallPanoramaSourceInventoryV3Sha256(sources),
    panoramaRecordCount: GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT,
    resolvedPanoramaCount: 2,
    unresolvedPanoramaCount: GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT - 2,
    includedPanoramaCount: 1,
    excludedPanoramaCount: 1,
    nativeReviewEvidenceCount: 2,
    maskCount: 1,
    sourceRecords,
    humanDecisions: {
      schemaVersion: GRAND_HALL_T554_HUMAN_DECISIONS_V3,
      fileName: "human-decisions-v3-human-pending.json",
      semanticSha256: digest(40_004),
      fileSha256: digest(40_005),
      byteLength: 8_000,
      authority: "none",
      reviewState: "human_pending",
      finalDecision: "PENDING",
      reviewer: null,
      nativeResolutionHumanReviewCompleted: false,
      nativeReviewEvidenceSetSha256: null,
    },
    state: "human_pending_workbench_export_requires_byte_level_sealer",
    publicationOrder: "payloads_then_receipt_last",
    storageSemantics: "no_replace",
    humanPresenceProof: "not_cryptographic",
    authority: "none",
    reviewState: "human_pending",
    finalDecision: "PENDING",
    reviewer: null,
    nativeResolutionHumanReviewCompleted: false,
    nativeReviewEvidenceSetSha256: null,
    byteLevelSealerCompleted: false,
    acceptanceAuthorized: false,
    reconstructionAuthorized: false,
    runtimeAuthorized: false,
    generatedContentAuthorized: false,
    externalNetworkUsed: false,
    productionTrust: null,
  });
}

function fullyResolvedPendingExportMaterial(): GrandHallT554PendingWorkbenchExportReceiptMaterialV1 {
  const pending = pendingExportMaterial();
  const sourceRecords = pending.sourceRecords.map((record, index) => {
    const receiptSha256 = digest(50_000 + index);
    return {
      source: record.source,
      result: "EXCLUDE" as const,
      nativeResolutionHumanReviewCompleted: true as const,
      nativeReviewEvidence: {
        fileName: formatGrandHallT554NativeEvidenceFileName(
          record.source.inventoryIndex,
          receiptSha256,
        ),
        receiptSha256,
        fileSha256: digest(60_000 + index),
        byteLength: 10_000 + index,
      },
      maskReviewed: false as const,
      mask: null,
    };
  });
  return GrandHallT554PendingWorkbenchExportReceiptMaterialV1Schema.parse({
    ...pending,
    resolvedPanoramaCount: GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT,
    unresolvedPanoramaCount: 0,
    includedPanoramaCount: 0,
    excludedPanoramaCount: GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT,
    nativeReviewEvidenceCount: GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT,
    maskCount: 0,
    sourceRecords,
  });
}

describe("Grand Hall T-554 native-review evidence v1", () => {
  it("seals deterministic immutable INCLUDE and EXCLUDE receipts", () => {
    const include = includeMaterial();
    const includeReceipt = sealGrandHallT554NativeReviewEvidenceV1(include);
    const excludeReceipt = sealGrandHallT554NativeReviewEvidenceV1(excludeMaterial());

    expect(includeReceipt.receiptSha256).toBe(
      computeGrandHallT554NativeReviewEvidenceV1Sha256(include),
    );
    expect(sealGrandHallT554NativeReviewEvidenceV1(include)).toEqual(includeReceipt);
    expect(excludeReceipt.decision).toMatchObject({
      result: "EXCLUDE",
      mask: null,
      maskReviewCoverage: null,
    });
    expect(includeReceipt.authority).toBe("none");
    expect(includeReceipt.humanPresenceProof).toBe("not_cryptographic");
  });

  it("accepts only canonical UTC millisecond timestamps", () => {
    const canonical = includeMaterial();
    expect(() => GrandHallT554NativeReviewEvidenceMaterialV1Schema.parse(canonical))
      .not.toThrow();

    const offsetEquivalent = {
      ...canonical,
      humanAttestation: {
        ...canonical.humanAttestation,
        attestedAt: "2026-08-26T13:04:00.000+01:00",
      },
    };
    expect(() => GrandHallT554NativeReviewEvidenceMaterialV1Schema.parse(offsetEquivalent))
      .toThrow();

    const missingMilliseconds = {
      ...canonical,
      sealedAt: "2026-08-26T12:05:00Z",
    };
    expect(() => GrandHallT554NativeReviewEvidenceMaterialV1Schema.parse(missingMilliseconds))
      .toThrow();

    const excessivePrecision = {
      ...pendingExportMaterial(),
      createdAt: "2026-08-26T13:00:00.0000Z",
    };
    expect(() => GrandHallT554PendingWorkbenchExportReceiptMaterialV1Schema.parse(excessivePrecision))
      .toThrow();
  });

  it("does not permit UNSURE to become a sealed native-review receipt", () => {
    const material = includeMaterial();
    const receipt = {
      ...material,
      decision: {
        result: "UNSURE",
        classification: "unresolved",
        note: "Not yet resolved.",
        mask: null,
        maskReviewCoverage: null,
      },
    };

    expect(() => GrandHallT554NativeReviewEvidenceMaterialV1Schema.parse(receipt))
      .toThrow();
  });

  it("rejects source substitutions and incomplete or forged native coverage", () => {
    const wrongInventoryPosition = structuredClone(includeMaterial());
    wrongInventoryPosition.source.inventoryIndex = 92;
    expect(() => GrandHallT554NativeReviewEvidenceMaterialV1Schema.parse(wrongInventoryPosition))
      .toThrow();

    const sourceMismatch = structuredClone(includeMaterial());
    sourceMismatch.sourceVerification.sha256 = digest(91_001);
    expect(() => GrandHallT554NativeReviewEvidenceMaterialV1Schema.parse(sourceMismatch))
      .toThrow();

    const subjectMismatch = structuredClone(includeMaterial());
    subjectMismatch.sourceReviewCoverage.subjectSha256 = digest(91_002);
    expect(() => GrandHallT554NativeReviewEvidenceMaterialV1Schema.parse(subjectMismatch))
      .toThrow();

    const incomplete = structuredClone(includeMaterial());
    const incompleteHex = `${COMPLETE_BITMAP_HEX.slice(0, -2)}fe`;
    incomplete.sourceReviewCoverage.coverage = bitmap(incompleteHex, 511);
    incomplete.sourceReviewCoverage.reviewIntervals[0]!.coverage = bitmap(
      incompleteHex,
      511,
    );
    expect(() => GrandHallT554NativeReviewEvidenceMaterialV1Schema.parse(incomplete))
      .toThrow();

    const forgedDigest = structuredClone(includeMaterial());
    forgedDigest.sourceReviewCoverage.coverage.coveredCellBitsetSha256 = digest(91_003);
    expect(() => GrandHallT554NativeReviewEvidenceMaterialV1Schema.parse(forgedDigest))
      .toThrow();
  });

  it("rejects coverage interval union, scale, visibility, ordering, and chronology failures", () => {
    const missingIntervalCoverage = structuredClone(includeMaterial());
    const incompleteHex = `${COMPLETE_BITMAP_HEX.slice(0, -2)}fe`;
    missingIntervalCoverage.sourceReviewCoverage.reviewIntervals[0]!.coverage = bitmap(
      incompleteHex,
      511,
    );
    expect(() => GrandHallT554NativeReviewEvidenceMaterialV1Schema.parse(missingIntervalCoverage))
      .toThrow();

    const downsampled = structuredClone(includeMaterial());
    downsampled.sourceReviewCoverage.reviewIntervals[0]!
      .minimumEffectiveDevicePixelsPerSourcePixel = 0.99;
    expect(() => GrandHallT554NativeReviewEvidenceMaterialV1Schema.parse(downsampled))
      .toThrow();

    const visible = includeMaterial();
    const hidden = {
      ...visible,
      sourceReviewCoverage: {
        ...visible.sourceReviewCoverage,
        reviewIntervals: visible.sourceReviewCoverage.reviewIntervals.map(
          (interval, index) => ({
            ...interval,
            tabVisibleThroughout: index === 0
              ? false
              : interval.tabVisibleThroughout,
          }),
        ),
      },
    };
    expect(() => GrandHallT554NativeReviewEvidenceMaterialV1Schema.parse(hidden))
      .toThrow();

    const impossibleHeartbeat = structuredClone(includeMaterial());
    impossibleHeartbeat.sourceReviewCoverage.reviewIntervals[0]!
      .serverClampedHeartbeatDurationMs = 60_001;
    expect(() => GrandHallT554NativeReviewEvidenceMaterialV1Schema.parse(impossibleHeartbeat))
      .toThrow();

    const overlaps = structuredClone(includeMaterial());
    const firstInterval = overlaps.sourceReviewCoverage.reviewIntervals[0]!;
    overlaps.sourceReviewCoverage.reviewIntervals.push({
      ...firstInterval,
      startedAt: "2026-08-26T12:00:30.000Z",
      endedAt: "2026-08-26T12:01:30.000Z",
    });
    expect(() => GrandHallT554NativeReviewEvidenceMaterialV1Schema.parse(overlaps))
      .toThrow();

    const sealedEarly = structuredClone(includeMaterial());
    sealedEarly.sealedAt = "2026-08-26T12:02:30.000Z";
    expect(() => GrandHallT554NativeReviewEvidenceMaterialV1Schema.parse(sealedEarly))
      .toThrow();
  });

  it("requires attestation after review and allows the exact final-review boundary", () => {
    const atBoundary = structuredClone(includeMaterial());
    atBoundary.humanAttestation.attestedAt = "2026-08-26T12:03:00.000Z";
    atBoundary.sealedAt = "2026-08-26T12:03:00.000Z";
    expect(() => GrandHallT554NativeReviewEvidenceMaterialV1Schema.parse(atBoundary))
      .not.toThrow();

    const attestedEarly = structuredClone(includeMaterial());
    attestedEarly.humanAttestation.attestedAt = "2026-08-26T12:02:59.999Z";
    expect(() => GrandHallT554NativeReviewEvidenceMaterialV1Schema.parse(attestedEarly))
      .toThrow();
  });

  it("requires INCLUDE to bind an exact binary frozen mask and complete mask review", () => {
    const wrongMaskSubject = structuredClone(includeMaterial());
    if (wrongMaskSubject.decision.result !== "INCLUDE") throw new Error("fixture error");
    wrongMaskSubject.decision.maskReviewCoverage.subjectSha256 = digest(92_001);
    expect(() => GrandHallT554NativeReviewEvidenceMaterialV1Schema.parse(wrongMaskSubject))
      .toThrow();

    const badCounts = structuredClone(includeMaterial());
    if (badCounts.decision.result !== "INCLUDE") throw new Error("fixture error");
    badCounts.decision.mask.excludedPixelCount = 2;
    expect(() => GrandHallT554NativeReviewEvidenceMaterialV1Schema.parse(badCounts))
      .toThrow();

    const binary = includeMaterial();
    if (binary.decision.result !== "INCLUDE") throw new Error("fixture error");
    const nonBinary = {
      ...binary,
      decision: {
        ...binary.decision,
        mask: {
          ...binary.decision.mask,
          permittedPixelValues: [0, 127, 255],
        },
      },
    };
    expect(() => GrandHallT554NativeReviewEvidenceMaterialV1Schema.parse(nonBinary))
      .toThrow();

    const noMaskReview = structuredClone(includeMaterial());
    if (noMaskReview.decision.result !== "INCLUDE") throw new Error("fixture error");
    const incompleteHex = `${COMPLETE_BITMAP_HEX.slice(0, -2)}fe`;
    noMaskReview.decision.maskReviewCoverage.coverage = bitmap(incompleteHex, 511);
    noMaskReview.decision.maskReviewCoverage.reviewIntervals[0]!.coverage = bitmap(
      incompleteHex,
      511,
    );
    expect(() => GrandHallT554NativeReviewEvidenceMaterialV1Schema.parse(noMaskReview))
      .toThrow();
  });

  it("accepts the frozen-mask byte cap and rejects one byte beyond it", () => {
    const atBoundary = includeMaterial();
    if (atBoundary.decision.result !== "INCLUDE") throw new Error("fixture error");
    atBoundary.decision.mask.byteLength = GRAND_HALL_T554_FROZEN_MASK_MAX_BYTE_LENGTH;
    expect(() => GrandHallT554NativeReviewEvidenceMaterialV1Schema.parse(atBoundary))
      .not.toThrow();

    const overBoundary = structuredClone(atBoundary);
    if (overBoundary.decision.result !== "INCLUDE") throw new Error("fixture error");
    overBoundary.decision.mask.byteLength =
      GRAND_HALL_T554_FROZEN_MASK_MAX_BYTE_LENGTH + 1;
    expect(() => GrandHallT554NativeReviewEvidenceMaterialV1Schema.parse(overBoundary))
      .toThrow();
  });

  it("accepts the source-JPEG byte cap and rejects one byte beyond it", () => {
    const atBoundary = structuredClone(includeMaterial());
    atBoundary.source.byteLength = GRAND_HALL_T554_SOURCE_JPEG_MAX_BYTE_LENGTH;
    atBoundary.sourceVerification.byteLength =
      GRAND_HALL_T554_SOURCE_JPEG_MAX_BYTE_LENGTH;
    expect(() => GrandHallT554NativeReviewEvidenceMaterialV1Schema.parse(atBoundary))
      .not.toThrow();

    const overBoundary = structuredClone(atBoundary);
    overBoundary.source.byteLength =
      GRAND_HALL_T554_SOURCE_JPEG_MAX_BYTE_LENGTH + 1;
    overBoundary.sourceVerification.byteLength =
      GRAND_HALL_T554_SOURCE_JPEG_MAX_BYTE_LENGTH + 1;
    expect(() => GrandHallT554NativeReviewEvidenceMaterialV1Schema.parse(overBoundary))
      .toThrow();
  });

  it("rejects a mask smuggled into EXCLUDE and rejects unknown receipt fields", () => {
    const excludedMaterial = excludeMaterial();
    if (excludedMaterial.decision.result !== "EXCLUDE") {
      throw new Error("fixture error");
    }
    const exclude = {
      ...excludedMaterial,
      decision: {
        ...excludedMaterial.decision,
        mask: frozenMask(),
      },
    };
    expect(() => GrandHallT554NativeReviewEvidenceMaterialV1Schema.parse(exclude))
      .toThrow();

    const receipt = sealGrandHallT554NativeReviewEvidenceV1(includeMaterial());
    const withExtra = { ...receipt, humanAccepted: true };
    expect(() => GrandHallT554NativeReviewEvidenceV1Schema.parse(withExtra)).toThrow();

    const tampered = { ...receipt, sealedAt: "2026-08-26T12:06:00.000Z" };
    expect(() => GrandHallT554NativeReviewEvidenceV1Schema.parse(tampered)).toThrow();
  });
});

describe("Grand Hall T-554 pending workbench export receipt v1", () => {
  it("seals all 148 exact sources while retaining the fail-closed pending lifecycle", () => {
    const material = pendingExportMaterial();
    const receipt = sealGrandHallT554PendingWorkbenchExportReceiptV1(material);

    expect(receipt.sourceRecords).toHaveLength(148);
    expect(receipt.panoramaRecordCount).toBe(148);
    expect(receipt.sourceRecords.some((record) => record.source.sweepNumber === 93))
      .toBe(false);
    expect(receipt.receiptSha256).toBe(
      computeGrandHallT554PendingWorkbenchExportReceiptV1Sha256(material),
    );
    expect(receipt).toMatchObject({
      authority: "none",
      reviewState: "human_pending",
      finalDecision: "PENDING",
      reviewer: null,
      nativeResolutionHumanReviewCompleted: false,
      nativeReviewEvidenceSetSha256: null,
      byteLevelSealerCompleted: false,
      externalNetworkUsed: false,
    });
    expect(receipt.humanDecisions).toMatchObject({
      authority: "none",
      reviewState: "human_pending",
      finalDecision: "PENDING",
      reviewer: null,
      nativeResolutionHumanReviewCompleted: false,
      nativeReviewEvidenceSetSha256: null,
    });
  });

  it("keeps an all-148-resolved export human-pending until the byte-level sealer", () => {
    const material = fullyResolvedPendingExportMaterial();
    const receipt = sealGrandHallT554PendingWorkbenchExportReceiptV1(material);

    expect(receipt.resolvedPanoramaCount).toBe(148);
    expect(receipt.unresolvedPanoramaCount).toBe(0);
    expect(receipt.sourceRecords.every((record) =>
      record.nativeResolutionHumanReviewCompleted &&
      record.nativeReviewEvidence !== null
    )).toBe(true);
    expect(receipt).toMatchObject({
      authority: "none",
      reviewState: "human_pending",
      finalDecision: "PENDING",
      reviewer: null,
      nativeResolutionHumanReviewCompleted: false,
      nativeReviewEvidenceSetSha256: null,
      byteLevelSealerCompleted: false,
      acceptanceAuthorized: false,
    });

    const forbiddenClaims: readonly Record<string, unknown>[] = [
      { nativeResolutionHumanReviewCompleted: true },
      { nativeReviewEvidenceSetSha256: digest(70_001) },
      { byteLevelSealerCompleted: true },
      { acceptanceAuthorized: true },
      { authority: "human_accepted" },
      { reviewState: "human_accepted" },
      { finalDecision: "ACCEPT" },
      { reviewer: { reviewerId: "someone" } },
    ];
    forbiddenClaims.forEach((claim) => {
      expect(GrandHallT554PendingWorkbenchExportReceiptMaterialV1Schema.safeParse({
        ...material,
        ...claim,
      }).success).toBe(false);
    });
  });

  it("uses one canonical content-addressed native-evidence path per source row", () => {
    expect(formatGrandHallT554NativeEvidenceFileName(0, digest(1))).toBe(
      `receipts/native/000/sha256-${"0".repeat(63)}1.json`,
    );
    expect(formatGrandHallT554NativeEvidenceFileName(147, digest(2))).toBe(
      `receipts/native/147/sha256-${"0".repeat(63)}2.json`,
    );

    const wrongIndexPath = structuredClone(pendingExportMaterial());
    const indexedEvidence = wrongIndexPath.sourceRecords[0]!.nativeReviewEvidence;
    if (indexedEvidence === null) throw new Error("fixture error");
    indexedEvidence.fileName = formatGrandHallT554NativeEvidenceFileName(
      1,
      indexedEvidence.receiptSha256,
    );
    expect(() => GrandHallT554PendingWorkbenchExportReceiptMaterialV1Schema.parse(wrongIndexPath))
      .toThrow();

    const wrongDigestPath = structuredClone(pendingExportMaterial());
    const digestEvidence = wrongDigestPath.sourceRecords[0]!.nativeReviewEvidence;
    if (digestEvidence === null) throw new Error("fixture error");
    digestEvidence.fileName = formatGrandHallT554NativeEvidenceFileName(
      0,
      digest(96_001),
    );
    expect(() => GrandHallT554PendingWorkbenchExportReceiptMaterialV1Schema.parse(wrongDigestPath))
      .toThrow();
  });

  it("accepts bounded JSON members and rejects evidence or decisions over 16 MiB", () => {
    const atBoundary = structuredClone(pendingExportMaterial());
    const includeEvidence = atBoundary.sourceRecords[0]!.nativeReviewEvidence;
    const excludeEvidence = atBoundary.sourceRecords[1]!.nativeReviewEvidence;
    if (includeEvidence === null || excludeEvidence === null) {
      throw new Error("fixture error");
    }
    includeEvidence.byteLength = GRAND_HALL_T554_JSON_EVIDENCE_MAX_BYTE_LENGTH;
    excludeEvidence.byteLength = GRAND_HALL_T554_JSON_EVIDENCE_MAX_BYTE_LENGTH;
    atBoundary.humanDecisions.byteLength =
      GRAND_HALL_T554_JSON_EVIDENCE_MAX_BYTE_LENGTH;
    expect(() => GrandHallT554PendingWorkbenchExportReceiptMaterialV1Schema.parse(atBoundary))
      .not.toThrow();

    const evidenceTooLarge = structuredClone(atBoundary);
    const oversizedEvidence = evidenceTooLarge.sourceRecords[0]!.nativeReviewEvidence;
    if (oversizedEvidence === null) throw new Error("fixture error");
    oversizedEvidence.byteLength = GRAND_HALL_T554_JSON_EVIDENCE_MAX_BYTE_LENGTH + 1;
    expect(() => GrandHallT554PendingWorkbenchExportReceiptMaterialV1Schema.parse(evidenceTooLarge))
      .toThrow();

    const decisionsTooLarge = structuredClone(atBoundary);
    decisionsTooLarge.humanDecisions.byteLength =
      GRAND_HALL_T554_JSON_EVIDENCE_MAX_BYTE_LENGTH + 1;
    expect(() => GrandHallT554PendingWorkbenchExportReceiptMaterialV1Schema.parse(decisionsTooLarge))
      .toThrow();
  });

  it("rejects reordered, missing, substituted, and miscounted inventory", () => {
    const reordered = structuredClone(pendingExportMaterial());
    [reordered.sourceRecords[0], reordered.sourceRecords[1]] = [
      reordered.sourceRecords[1]!,
      reordered.sourceRecords[0]!,
    ];
    expect(() => GrandHallT554PendingWorkbenchExportReceiptMaterialV1Schema.parse(reordered))
      .toThrow();

    const injected93 = structuredClone(pendingExportMaterial());
    injected93.sourceRecords[92]!.source.sweepNumber = 93;
    injected93.sourceRecords[92]!.source.fileName = "sweep_093jpg.jpg";
    expect(() => GrandHallT554PendingWorkbenchExportReceiptMaterialV1Schema.parse(injected93))
      .toThrow();

    const wrongInventoryDigest = structuredClone(pendingExportMaterial());
    wrongInventoryDigest.panoramaSourceInventorySha256 = digest(93_001);
    expect(() => GrandHallT554PendingWorkbenchExportReceiptMaterialV1Schema.parse(wrongInventoryDigest))
      .toThrow();

    const wrongCount = structuredClone(pendingExportMaterial());
    wrongCount.resolvedPanoramaCount = 3;
    expect(() => GrandHallT554PendingWorkbenchExportReceiptMaterialV1Schema.parse(wrongCount))
      .toThrow();
  });

  it("enforces per-result evidence and mask semantics", () => {
    const pending = pendingExportMaterial();
    const unresolvedWithEvidence = {
      ...pending,
      sourceRecords: pending.sourceRecords.map((record, index) => index === 2
        ? {
          ...record,
          nativeReviewEvidence: {
            fileName: "native-evidence/forged.json",
            receiptSha256: digest(94_001),
            fileSha256: digest(94_002),
            byteLength: 100,
          },
        }
        : record),
    };
    expect(() => GrandHallT554PendingWorkbenchExportReceiptMaterialV1Schema.parse(unresolvedWithEvidence))
      .toThrow();

    const includeWithoutMask = {
      ...pending,
      sourceRecords: pending.sourceRecords.map((record, index) => index === 0
        ? { ...record, mask: null }
        : record),
    };
    expect(() => GrandHallT554PendingWorkbenchExportReceiptMaterialV1Schema.parse(includeWithoutMask))
      .toThrow();

    const excludeWithMask = {
      ...pending,
      sourceRecords: pending.sourceRecords.map((record, index) => index === 1
        ? { ...record, mask: frozenMask(94_010) }
        : record),
    };
    expect(() => GrandHallT554PendingWorkbenchExportReceiptMaterialV1Schema.parse(excludeWithMask))
      .toThrow();
  });

  it("rejects duplicate or path-unsafe evidence and colliding mask paths", () => {
    const duplicateEvidence = structuredClone(pendingExportMaterial());
    const firstEvidence = duplicateEvidence.sourceRecords[0]!.nativeReviewEvidence;
    const secondEvidence = duplicateEvidence.sourceRecords[1]!.nativeReviewEvidence;
    if (firstEvidence === null || secondEvidence === null) throw new Error("fixture error");
    secondEvidence.receiptSha256 = firstEvidence.receiptSha256;
    secondEvidence.fileName = formatGrandHallT554NativeEvidenceFileName(
      duplicateEvidence.sourceRecords[1]!.source.inventoryIndex,
      secondEvidence.receiptSha256,
    );
    expect(() => GrandHallT554PendingWorkbenchExportReceiptMaterialV1Schema.parse(duplicateEvidence))
      .toThrow();

    const duplicateFileDigest = structuredClone(pendingExportMaterial());
    const firstFile = duplicateFileDigest.sourceRecords[0]!.nativeReviewEvidence;
    const secondFile = duplicateFileDigest.sourceRecords[1]!.nativeReviewEvidence;
    if (firstFile === null || secondFile === null) throw new Error("fixture error");
    secondFile.fileSha256 = firstFile.fileSha256;
    expect(() => GrandHallT554PendingWorkbenchExportReceiptMaterialV1Schema.parse(duplicateFileDigest))
      .toThrow();

    const collidingName = structuredClone(pendingExportMaterial());
    const firstNamedEvidence = collidingName.sourceRecords[0]!.nativeReviewEvidence;
    const secondNamedEvidence = collidingName.sourceRecords[1]!.nativeReviewEvidence;
    if (firstNamedEvidence === null || secondNamedEvidence === null) throw new Error("fixture error");
    secondNamedEvidence.fileName = firstNamedEvidence.fileName.toUpperCase();
    expect(() => GrandHallT554PendingWorkbenchExportReceiptMaterialV1Schema.parse(collidingName))
      .toThrow();

    const traversal = structuredClone(pendingExportMaterial());
    const evidence = traversal.sourceRecords[0]!.nativeReviewEvidence;
    if (evidence === null) throw new Error("fixture error");
    evidence.fileName = "../escaped.json";
    expect(() => GrandHallT554PendingWorkbenchExportReceiptMaterialV1Schema.parse(traversal))
      .toThrow();

    const oneInclude = pendingExportMaterial();
    const firstMask = oneInclude.sourceRecords[0]!.mask;
    if (firstMask === null) throw new Error("fixture error");
    const duplicateMask = {
      ...oneInclude,
      includedPanoramaCount: 2,
      excludedPanoramaCount: 0,
      maskCount: 2,
      sourceRecords: oneInclude.sourceRecords.map((record, index) => index === 1
        ? {
          ...record,
          result: "INCLUDE",
          maskReviewed: true,
          mask: {
            ...firstMask,
            fileName: "masks/sweep-002.png",
          },
        }
        : record),
    };
    expect(() => GrandHallT554PendingWorkbenchExportReceiptMaterialV1Schema.parse(duplicateMask))
      .not.toThrow();

    const collidingMaskPath = structuredClone(duplicateMask);
    const secondMask = collidingMaskPath.sourceRecords[1]!.mask;
    if (secondMask === null) throw new Error("fixture error");
    secondMask.fileName = firstMask.fileName.toUpperCase();
    expect(() => GrandHallT554PendingWorkbenchExportReceiptMaterialV1Schema.parse(collidingMaskPath))
      .toThrow();
  });

  it("cannot claim acceptance before the future byte-level sealer", () => {
    const pending = pendingExportMaterial();
    const acceptanceAttempt = {
      ...pending,
      authority: "human_accepted",
      reviewState: "accepted",
      finalDecision: "ACCEPT",
      reviewer: { reviewerId: "someone" },
      nativeResolutionHumanReviewCompleted: true,
      nativeReviewEvidenceSetSha256: digest(95_001),
      byteLevelSealerCompleted: true,
      acceptanceAuthorized: true,
    };
    expect(() => GrandHallT554PendingWorkbenchExportReceiptMaterialV1Schema.parse(acceptanceAttempt))
      .toThrow();

    const nestedAcceptance = {
      ...pending,
      humanDecisions: {
        ...pending.humanDecisions,
        authority: "human_accepted",
        reviewState: "accepted",
        finalDecision: "ACCEPT",
        nativeResolutionHumanReviewCompleted: true,
        nativeReviewEvidenceSetSha256: digest(95_002),
      },
    };
    expect(() => GrandHallT554PendingWorkbenchExportReceiptMaterialV1Schema.parse(nestedAcceptance))
      .toThrow();
  });

  it("rejects pending-export receipt mutation and unknown authority-bearing fields", () => {
    const receipt = sealGrandHallT554PendingWorkbenchExportReceiptV1(
      pendingExportMaterial(),
    );
    const mutated = { ...receipt, createdAt: "2026-08-26T13:01:00.000Z" };
    expect(() => GrandHallT554PendingWorkbenchExportReceiptV1Schema.parse(mutated))
      .toThrow();

    const withExtra = { ...receipt, trainingAuthorized: true };
    expect(() => GrandHallT554PendingWorkbenchExportReceiptV1Schema.parse(withExtra))
      .toThrow();
  });
});
