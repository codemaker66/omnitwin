import { createHash } from "node:crypto";

import {
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_WIDTH_PX,
  type GrandHallPanoramaSourceJpgIdentityV2,
} from "@omnitwin/types";
import { describe, expect, it } from "vitest";

import {
  type GrandHallT554NativeReviewAuthorityBoundaryV2,
  type GrandHallT554NativeReviewImplementationManifestBindingV2,
  type GrandHallT554NativeReviewRegistryBindingV2,
  type GrandHallT554NativeReviewSourceChildEventV2,
  type GrandHallT554NativeReviewSourceCustodyBindingV2,
  type GrandHallT554NativeReviewSourceScopeV2,
} from "../grand-hall-t554-native-review-events-v2.js";
import {
  GrandHallT554NativeReviewReplayV2Error,
  emptyGrandHallT554NativeReviewTileBitmapV2,
  validateGrandHallT554NativeReviewSourceChildSequenceV2,
} from "../grand-hall-t554-native-review-replay-v2.js";
import {
  GRAND_HALL_T554_NATIVE_REVIEW_SOURCE_COVERAGE_OBSERVATION_INPUT_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_SOURCE_SUBJECT_MATERIAL_V2,
  GrandHallT554NativeReviewSourceKernelV2Error,
  computeGrandHallT554NativeReviewSourceReviewSubjectV2Sha256,
  computeGrandHallT554NativeReviewSourceSubjectV2Sha256,
  planGrandHallT554NativeReviewNextSourceCoverageEventV2,
  type GrandHallT554NativeReviewSourceCoverageObservationInputV2,
  type GrandHallT554NativeReviewSourceSubjectMaterialV2,
} from "../grand-hall-t554-native-review-source-kernel-v2.js";

type Sha256 = `sha256:${string}`;
type SourceStartEvent = Extract<
  GrandHallT554NativeReviewSourceChildEventV2,
  { readonly eventType: "source.review-started.v2" }
>;
type SourceDeliveryEvent = Extract<
  GrandHallT554NativeReviewSourceChildEventV2,
  { readonly eventType: "source.tile-delivered.v2" }
>;

const EMPTY_BITMAP = emptyGrandHallT554NativeReviewTileBitmapV2();

function digest(label: string): Sha256 {
  return `sha256:${createHash("sha256").update(label).digest("hex")}`;
}

function tileBitmap(...indexes: number[]): string {
  const bytes = Buffer.alloc(64);
  try {
    for (const index of indexes) {
      const byteIndex = Math.floor(index / 8);
      bytes[byteIndex] = (bytes[byteIndex] ?? 0) | (1 << (index % 8));
    }
    return bytes.toString("hex");
  } finally {
    bytes.fill(0);
  }
}

const source: GrandHallPanoramaSourceJpgIdentityV2 = {
  inventoryIndex: 0,
  sweepNumber: 1,
  fileName: "sweep_001jpg.jpg",
  sha256: digest("source-file"),
  byteLength: 6_419_919,
  widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
  heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
};

const registry: GrandHallT554NativeReviewRegistryBindingV2 = {
  schemaVersion: "venviewer.grand-hall-t554-native-review-registry-binding.v2",
  venueSlug: "trades-hall",
  roomSlug: "grand-hall",
  sourceCount: 148,
  reviewPack: {
    semanticSha256: digest("review-pack-semantic"),
    fileSha256: digest("review-pack-file"),
    byteLength: 130_706,
  },
  publicationReceipt: {
    semanticSha256: digest("receipt-semantic"),
    fileSha256: digest("receipt-file"),
    byteLength: 3_590,
  },
  authority: "none",
  reviewState: "human_pending",
  finalDecision: "PENDING",
  acceptanceAuthorized: false,
  reconstructionAuthorized: false,
  runtimeAuthorized: false,
  exportAuthorized: false,
  generatedContentAuthorized: false,
};

const implementation: GrandHallT554NativeReviewImplementationManifestBindingV2 =
  {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-implementation-manifest-binding.v2",
    implementationId: "grand-hall-t554-native-review-workbench-v1",
    semanticSha256: digest("implementation-semantic"),
    fileSha256: digest("implementation-file"),
    byteLength: 12_345,
  };

const authority: GrandHallT554NativeReviewAuthorityBoundaryV2 = {
  schemaVersion:
    "venviewer.grand-hall-t554-native-review-authority-boundary.v2",
  authority: "none",
  reviewState: "human_pending",
  finalDecision: "PENDING",
  acceptanceAuthorized: false,
  reconstructionAuthorized: false,
  runtimeAuthorized: false,
  exportAuthorized: false,
  generatedContentAuthorized: false,
};

function subjectMaterial(): GrandHallT554NativeReviewSourceSubjectMaterialV2 {
  return {
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_SOURCE_SUBJECT_MATERIAL_V2,
    source,
    sourceVerification: {
      fileName: source.fileName,
      sha256: source.sha256 as Sha256,
      byteLength: source.byteLength,
      widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
      heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
      decodedChannelCount: 3,
      decodedBitsPerSample: 8,
      alphaPresent: false,
      orientationMetadataPresent: false,
      decodedPixelSha256: digest("decoded-pixels"),
      decoderIdentity: {
        schemaVersion:
          "venviewer.grand-hall-t554-source-jpeg-decoder-identity.v1",
        library: "sharp",
        sharpVersion: "0.35.3",
        libvipsVersion: "8.18.3",
        pipeline: "captured-jpeg-buffer-to-unrotated-rgb8.v1",
      },
      descriptorWitnessSha256: digest("descriptor-witness"),
      sameOpenDescriptorHashedAndDecoded: true,
      fullJpegDecodeCompleted: true,
    },
    registry,
    implementationManifest: implementation,
  };
}

function custody(
  subjectSha256 = computeGrandHallT554NativeReviewSourceSubjectV2Sha256(
    subjectMaterial(),
  ),
): GrandHallT554NativeReviewSourceCustodyBindingV2 {
  const material = subjectMaterial();
  return {
    source: material.source,
    sourceVerification: material.sourceVerification,
    sourceReviewSubjectSha256: subjectSha256,
    sourceEpochBindingSha256: digest("source-epoch-binding"),
    sourceEpochNonceSha256: digest("source-epoch-nonce"),
    sourceEpochRenderGeneration: 1,
  };
}

function scope(sourceCustody = custody()): GrandHallT554NativeReviewSourceScopeV2 {
  return {
    schemaVersion: "venviewer.grand-hall-t554-native-review-journal-scope.v2",
    kind: "source",
    sessionIdSha256: digest("session"),
    implementationManifest: implementation,
    registry,
    authorityBoundary: authority,
    browserEpochNonceSha256: digest("browser-epoch"),
    coverageSegmentIdSha256: digest("coverage-segment"),
    renderGeneration: 1,
    sourceCustody,
  };
}

function start(reviewScope = scope()): SourceStartEvent {
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-domain-event.v2",
    eventType: "source.review-started.v2",
    payload: {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-source-review-started.v2",
      browserEpochNonceSha256: reviewScope.browserEpochNonceSha256,
      coverageSegmentIdSha256: reviewScope.coverageSegmentIdSha256,
      coverageSegmentStartedAtUtc: "2026-08-28T10:00:00.000Z",
      firstSampleMustCreditZero: true,
      renderGeneration: reviewScope.renderGeneration,
      sourceCustody: reviewScope.sourceCustody,
      registry: reviewScope.registry,
      implementationManifest: reviewScope.implementationManifest,
      tileGrid: {
        widthPx: 256,
        heightPx: 256,
        columnCount: 32,
        rowCount: 16,
        channelCount: 3,
        bytesPerTile: 196_608,
        resampling: "none",
      },
      predecessorCoverage: null,
      authorityBoundary: reviewScope.authorityBoundary,
    },
  };
}

function delivery(reviewScope = scope()): SourceDeliveryEvent {
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-domain-event.v2",
    eventType: "source.tile-delivered.v2",
    payload: {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-tile-delivered.v2",
      browserEpochNonceSha256: reviewScope.browserEpochNonceSha256,
      sourceEpochNonceSha256:
        reviewScope.sourceCustody.sourceEpochNonceSha256,
      coverageSegmentIdSha256: reviewScope.coverageSegmentIdSha256,
      subjectSha256: reviewScope.sourceCustody.sourceReviewSubjectSha256,
      renderGeneration: reviewScope.renderGeneration,
      column: 0,
      row: 0,
      tileIndex: 0,
      responseFinishedAtUtc: "2026-08-28T10:00:00.001Z",
    },
  };
}

function observation(
  monotonicElapsedMs: number,
  receivedAtUtc: string,
  overrides: Partial<
    GrandHallT554NativeReviewSourceCoverageObservationInputV2["telemetry"]
  > = {},
): GrandHallT554NativeReviewSourceCoverageObservationInputV2 {
  return {
    schemaVersion:
      GRAND_HALL_T554_NATIVE_REVIEW_SOURCE_COVERAGE_OBSERVATION_INPUT_V2,
    serverObservation: { receivedAtUtc, monotonicElapsedMs },
    telemetry: {
      documentVisibilityState: "visible",
      documentFocusState: "focused",
      viewportCssWidth: GRAND_HALL_PANORAMA_WIDTH_PX,
      viewportCssHeight: GRAND_HALL_PANORAMA_HEIGHT_PX,
      devicePixelRatio: 1,
      sourceToCssTransform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      paintedTileBitsetHex: tileBitmap(0),
      ...overrides,
    },
  };
}

function plan(
  reviewScope: GrandHallT554NativeReviewSourceScopeV2,
  events: readonly GrandHallT554NativeReviewSourceChildEventV2[],
  nextObservation: GrandHallT554NativeReviewSourceCoverageObservationInputV2,
) {
  return planGrandHallT554NativeReviewNextSourceCoverageEventV2({
    scope: reviewScope,
    events,
    observation: nextObservation,
  });
}

describe("Grand Hall T-554 source-only native-review kernel v2", () => {
  it("derives one exact domain-separated source subject over the stable trust boundary", () => {
    const material = subjectMaterial();
    const expected =
      "sha256:08d3a661f2293d68a589dd97eb0c336b3db7fda860b95a593f4be55e9e7f9574";
    expect(
      computeGrandHallT554NativeReviewSourceSubjectV2Sha256(material),
    ).toBe(expected);
    expect(
      computeGrandHallT554NativeReviewSourceReviewSubjectV2Sha256(material),
    ).toBe(expected);
    expect(
      computeGrandHallT554NativeReviewSourceSubjectV2Sha256({
        implementationManifest: material.implementationManifest,
        registry: material.registry,
        sourceVerification: material.sourceVerification,
        source: material.source,
        schemaVersion: material.schemaVersion,
      }),
    ).toBe(expected);

    const changedMaterials = [
      {
        ...material,
        source: {
          ...material.source,
          inventoryIndex: 1,
          sweepNumber: 2,
          fileName: "sweep_002jpg.jpg",
          sha256: digest("different-source-file"),
        },
        sourceVerification: {
          ...material.sourceVerification,
          fileName: "sweep_002jpg.jpg",
          sha256: digest("different-source-file"),
        },
      },
      {
        ...material,
        sourceVerification: {
          ...material.sourceVerification,
          decodedPixelSha256: digest("different-decoded-pixels"),
        },
      },
      {
        ...material,
        sourceVerification: {
          ...material.sourceVerification,
          descriptorWitnessSha256: digest("different-descriptor"),
        },
      },
      {
        ...material,
        registry: {
          ...material.registry,
          reviewPack: {
            ...material.registry.reviewPack,
            semanticSha256: digest("different-review-pack"),
          },
        },
      },
      {
        ...material,
        implementationManifest: {
          ...material.implementationManifest,
          semanticSha256: digest("different-implementation"),
        },
      },
    ];
    for (const changed of changedMaterials) {
      expect(
        computeGrandHallT554NativeReviewSourceSubjectV2Sha256(changed),
      ).not.toBe(expected);
    }
  });

  it("rejects mismatched, incomplete, or extended source-subject material", () => {
    const material = subjectMaterial();
    const invalid = [
      {
        ...material,
        sourceVerification: {
          ...material.sourceVerification,
          sha256: digest("different-source"),
        },
      },
      { ...material, registry: undefined },
      { ...material, callerAuthority: "accepted" },
    ];
    for (const candidate of invalid) {
      expect(() =>
        computeGrandHallT554NativeReviewSourceSubjectV2Sha256(candidate),
      ).toThrowError(
        expect.objectContaining({ code: "ARGUMENT_INVALID" }),
      );
    }
  });

  it("hydrates the exact first zero-credit source event and self-validates replay", () => {
    const reviewScope = scope();
    const events = [start(reviewScope), delivery(reviewScope)];
    const event = plan(
      reviewScope,
      events,
      observation(0, "2026-08-28T10:00:00.002Z"),
    );
    expect(event).toMatchObject({
      eventType: "source.coverage-observed.v2",
      payload: {
        browserEpochNonceSha256: reviewScope.browserEpochNonceSha256,
        sourceEpochNonceSha256:
          reviewScope.sourceCustody.sourceEpochNonceSha256,
        coverageSegmentIdSha256: reviewScope.coverageSegmentIdSha256,
        subjectSha256: reviewScope.sourceCustody.sourceReviewSubjectSha256,
        renderGeneration: 1,
        sequence: 0,
        previousCoverageEventSha256: null,
        derived: {
          effectiveDevicePixelsPerSourcePixel: 1,
          serverMonotonicDeltaMs: 0,
          deliveredTileBitsetHex: tileBitmap(0),
          fullyVisibleDeliveredTileBitsetHex: tileBitmap(0),
          creditedTileBitsetHex: EMPTY_BITMAP,
          creditedDurationMs: 0,
          disqualifier: "first_sample",
          completedTileBitsetHex: EMPTY_BITMAP,
          completedTileCount: 0,
        },
        coverageEventSha256:
          "sha256:8ad62ee8d11def46eadfac73ef358b064ac7073da7ed37d3792921c291259f0f",
      },
    });
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.payload)).toBe(true);
    expect(Object.isFrozen(event.payload.telemetry)).toBe(true);
    expect(
      validateGrandHallT554NativeReviewSourceChildSequenceV2({
        scope: reviewScope,
        events: [...events, event],
      }).replay.coverage,
    ).toMatchObject({ coverageEventCount: 1, completedTileCount: 0 });
  });

  it("credits only continuous server-timed visibility and caps exact tile dwell", () => {
    const reviewScope = scope();
    const events: GrandHallT554NativeReviewSourceChildEventV2[] = [
      start(reviewScope),
      delivery(reviewScope),
    ];
    const first = plan(
      reviewScope,
      events,
      observation(0, "2026-08-28T10:00:00.002Z"),
    );
    events.push(first);
    const second = plan(
      reviewScope,
      events,
      observation(500, "2026-08-28T10:00:00.502Z"),
    );
    events.push(second);
    expect(second.payload.derived).toMatchObject({
      serverMonotonicDeltaMs: 500,
      creditedTileBitsetHex: tileBitmap(0),
      creditedDurationMs: 500,
      disqualifier: null,
      completedTileCount: 0,
    });

    const third = plan(
      reviewScope,
      events,
      observation(750, "2026-08-28T10:00:00.752Z"),
    );
    expect(third.payload).toMatchObject({
      sequence: 2,
      previousCoverageEventSha256: second.payload.coverageEventSha256,
      derived: {
        serverMonotonicDeltaMs: 250,
        creditedTileBitsetHex: tileBitmap(0),
        creditedDurationMs: 250,
        disqualifier: null,
        completedTileBitsetHex: tileBitmap(0),
        completedTileCount: 1,
      },
    });
  });

  it("carries the prior sample's disqualification across an ineligible interval", () => {
    const reviewScope = scope();
    const events: GrandHallT554NativeReviewSourceChildEventV2[] = [
      start(reviewScope),
      delivery(reviewScope),
    ];
    const hidden = plan(
      reviewScope,
      events,
      observation(0, "2026-08-28T10:00:00.002Z", {
        documentVisibilityState: "hidden",
      }),
    );
    events.push(hidden);
    const visible = plan(
      reviewScope,
      events,
      observation(250, "2026-08-28T10:00:00.252Z"),
    );
    expect(visible.payload.derived).toMatchObject({
      creditedTileBitsetHex: EMPTY_BITMAP,
      creditedDurationMs: 0,
      disqualifier: "document_not_visible",
    });
  });

  it("fails closed on a caller-invented subject, malformed observation, or backward clock", () => {
    const inventedScope = scope(custody(digest("invented-subject")));
    expect(() =>
      plan(
        inventedScope,
        [start(inventedScope)],
        observation(0, "2026-08-28T10:00:00.001Z"),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "SOURCE_SUBJECT_MISMATCH" }),
    );

    const reviewScope = scope();
    const events: GrandHallT554NativeReviewSourceChildEventV2[] = [
      start(reviewScope),
    ];
    expect(() =>
      planGrandHallT554NativeReviewNextSourceCoverageEventV2({
        scope: reviewScope,
        events,
        observation: {
          ...observation(0, "2026-08-28T10:00:00.001Z"),
          browserCompletedTileCount: 512,
        },
      }),
    ).toThrowError(GrandHallT554NativeReviewSourceKernelV2Error);

    const first = plan(
      reviewScope,
      events,
      observation(100, "2026-08-28T10:00:00.001Z"),
    );
    expect(() =>
      plan(
        reviewScope,
        [...events, first],
        observation(99, "2026-08-28T10:00:00.002Z"),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<GrandHallT554NativeReviewReplayV2Error>>({
        code: "CLOCK_INVALID",
      }),
    );
  });
});
