import { createHash } from "node:crypto";

import {
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_WIDTH_PX,
  type GrandHallPanoramaSourceJpgIdentityV2,
} from "@omnitwin/types";
import { describe, expect, it } from "vitest";

import {
  computeGrandHallT554NativeReviewFrozenMaskBindingV2Sha256,
  computeGrandHallT554NativeReviewFrozenMaskEvidenceV2Sha256,
  computeGrandHallT554NativeReviewMaskSubjectV2Sha256,
  computeGrandHallT554NativeReviewPreparedMaskBindingV2Sha256,
  computeGrandHallT554NativeReviewPreparedMaskEvidenceV2Sha256,
  GrandHallT554NativeReviewCoordinatorReplayV2Error,
  replayGrandHallT554NativeReviewCoordinatorV2,
} from "../grand-hall-t554-native-review-coordinator-replay-v2.js";
import {
  GRAND_HALL_T554_NATIVE_REVIEW_DOMAIN_EVENT_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_V2,
  type GrandHallT554NativeReviewFrozenMaskBindingV2,
  type GrandHallT554NativeReviewPreparedMaskBindingV2,
} from "../grand-hall-t554-native-review-events-v2.js";

const PIXEL_COUNT =
  GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX;
const NOW = "2026-08-27T12:34:56.789Z";
const EMPTY_TILE_BITMAP = "0".repeat(128);

function digest(seed: string | Buffer): `sha256:${string}` {
  const bytes = typeof seed === "string" ? Buffer.from(seed, "utf8") : seed;
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function envelope<const EventType extends string, Payload>(
  eventType: EventType,
  payload: Payload,
) {
  return {
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_DOMAIN_EVENT_V2,
    eventType,
    payload,
  };
}

function artifact(seed: string) {
  return {
    semanticSha256: digest(`${seed}-semantic`),
    fileSha256: digest(`${seed}-file`),
    byteLength: 1_024,
  };
}

function implementation() {
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-implementation-manifest-binding.v2" as const,
    implementationId: "grand-hall-t554-native-review-workbench-v1" as const,
    semanticSha256: digest("implementation-semantic"),
    fileSha256: digest("implementation-file"),
    byteLength: 8_192,
  };
}

function authority() {
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-authority-boundary.v2" as const,
    authority: "none" as const,
    reviewState: "human_pending" as const,
    finalDecision: "PENDING" as const,
    acceptanceAuthorized: false as const,
    reconstructionAuthorized: false as const,
    runtimeAuthorized: false as const,
    exportAuthorized: false as const,
    generatedContentAuthorized: false as const,
  };
}

function registry() {
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-registry-binding.v2" as const,
    venueSlug: "trades-hall" as const,
    roomSlug: "grand-hall" as const,
    sourceCount: 148 as const,
    reviewPack: artifact("review-pack"),
    publicationReceipt: artifact("receipt"),
    authority: "none" as const,
    reviewState: "human_pending" as const,
    finalDecision: "PENDING" as const,
    acceptanceAuthorized: false as const,
    reconstructionAuthorized: false as const,
    runtimeAuthorized: false as const,
    exportAuthorized: false as const,
    generatedContentAuthorized: false as const,
  };
}

function source(inventoryIndex = 0): GrandHallPanoramaSourceJpgIdentityV2 {
  const sweepNumber = inventoryIndex + 1;
  return {
    inventoryIndex,
    sweepNumber,
    fileName: `sweep_${String(sweepNumber).padStart(3, "0")}jpg.jpg`,
    sha256: digest(`source-${String(inventoryIndex)}`),
    byteLength: 2_000_000 + inventoryIndex,
    widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
    heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
  };
}

function sourceVerification(inventoryIndex = 0) {
  const identity = source(inventoryIndex);
  return {
    fileName: identity.fileName,
    sha256: identity.sha256,
    byteLength: identity.byteLength,
    widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
    heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
    decodedChannelCount: 3 as const,
    decodedBitsPerSample: 8 as const,
    alphaPresent: false as const,
    orientationMetadataPresent: false as const,
    decodedPixelSha256: digest(`decoded-${String(inventoryIndex)}`),
    decoderIdentity: {
      schemaVersion:
        "venviewer.grand-hall-t554-source-jpeg-decoder-identity.v1" as const,
      library: "sharp" as const,
      sharpVersion: "0.35.3",
      libvipsVersion: "8.18.3",
      pipeline: "captured-jpeg-buffer-to-unrotated-rgb8.v1" as const,
    },
    descriptorWitnessSha256: digest(`descriptor-${String(inventoryIndex)}`),
    sameOpenDescriptorHashedAndDecoded: true as const,
    fullJpegDecodeCompleted: true as const,
  };
}

function sourceCustody(generation = 1, epochSeed = "source-epoch-1") {
  return {
    source: source(),
    sourceVerification: sourceVerification(),
    sourceReviewSubjectSha256: digest("source-subject"),
    sourceEpochBindingSha256: digest(`${epochSeed}-binding`),
    sourceEpochNonceSha256: digest(`${epochSeed}-nonce`),
    sourceEpochRenderGeneration: generation,
  };
}

function sourceCheckpoint(revision: number, leafName = "source-child-0001") {
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-child-checkpoint.v2" as const,
    kind: "source" as const,
    leafName,
    scopeSha256: digest(`${leafName}-scope`),
    scopeFileSha256: digest(`${leafName}-scope-file`),
    revision,
    headEventSha256: digest(`${leafName}-head-${String(revision)}`),
    journalInventorySha256: digest(`${leafName}-inventory-${String(revision)}`),
  };
}

function maskCheckpoint(revision: number, leafName = "mask-child-0001") {
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-child-checkpoint.v2" as const,
    kind: "mask" as const,
    leafName,
    scopeSha256: digest(`${leafName}-scope`),
    scopeFileSha256: digest(`${leafName}-scope-file`),
    revision,
    headEventSha256: digest(`${leafName}-head-${String(revision)}`),
    journalInventorySha256: digest(`${leafName}-inventory-${String(revision)}`),
  };
}

function carryDwellEvidence() {
  const bytes = Buffer.alloc(1_024);
  return {
    cappedDwellMsUint16LeBase64url: bytes.toString("base64url"),
    cappedDwellBytesSha256: digest(bytes),
    completedTileBitsetHex: EMPTY_TILE_BITMAP,
    completedTileCount: 0,
    cumulativeDwellStateSha256: digest(
      Buffer.concat([
        Buffer.from(
          "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_DWELL_STATE_V2\n",
          "utf8",
        ),
        bytes,
      ]),
    ),
  };
}

function sourceResumeCarry(input: {
  readonly sessionScope: ReturnType<typeof scope>;
  readonly custody: ReturnType<typeof sourceCustody>;
  readonly predecessorJournal: ReturnType<typeof sourceCheckpoint>;
  readonly priorBrowserEpochNonceSha256: `sha256:${string}`;
  readonly priorCoverageSegmentIdSha256: `sha256:${string}`;
  readonly priorRenderGeneration: number;
}) {
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-coverage-carry-state.v2" as const,
    kind: "source" as const,
    subjectSha256: input.custody.sourceReviewSubjectSha256,
    predecessorJournal: input.predecessorJournal,
    sessionIdSha256: input.sessionScope.sessionIdSha256,
    registry: input.sessionScope.registry,
    implementationManifest: input.sessionScope.implementationManifest,
    sourceCustody: input.custody,
    priorBrowserEpochNonceSha256: input.priorBrowserEpochNonceSha256,
    priorSourceEpochBindingSha256:
      input.custody.sourceEpochBindingSha256,
    priorSourceEpochNonceSha256: input.custody.sourceEpochNonceSha256,
    priorSourceEpochRenderGeneration:
      input.custody.sourceEpochRenderGeneration,
    priorCoverageSegmentIdSha256: input.priorCoverageSegmentIdSha256,
    priorRenderGeneration: input.priorRenderGeneration,
    predecessorFinalDurableRecordedAtUtc: NOW,
    ...carryDwellEvidence(),
  };
}

function maskResumeCarry(input: {
  readonly sessionScope: ReturnType<typeof scope>;
  readonly custody: ReturnType<typeof sourceCustody>;
  readonly predecessorJournal: ReturnType<typeof maskCheckpoint>;
  readonly priorBrowserEpochNonceSha256: `sha256:${string}`;
  readonly priorCoverageSegmentIdSha256: `sha256:${string}`;
  readonly priorRenderGeneration: number;
  readonly maskState: ReturnType<typeof includedMaskState>;
  readonly maskReviewSubjectSha256: `sha256:${string}`;
  readonly frozenBindingSha256: `sha256:${string}`;
  readonly frozenBinding: GrandHallT554NativeReviewFrozenMaskBindingV2;
}) {
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-coverage-carry-state.v2" as const,
    kind: "mask" as const,
    subjectSha256: input.maskReviewSubjectSha256,
    predecessorJournal: input.predecessorJournal,
    maskStateSha256: input.maskState.maskStateSha256,
    frozenBindingSha256: input.frozenBindingSha256,
    frozenBinding: input.frozenBinding,
    sessionIdSha256: input.sessionScope.sessionIdSha256,
    registry: input.sessionScope.registry,
    implementationManifest: input.sessionScope.implementationManifest,
    sourceCustody: input.custody,
    priorBrowserEpochNonceSha256: input.priorBrowserEpochNonceSha256,
    priorSourceEpochBindingSha256:
      input.custody.sourceEpochBindingSha256,
    priorSourceEpochNonceSha256: input.custody.sourceEpochNonceSha256,
    priorSourceEpochRenderGeneration:
      input.custody.sourceEpochRenderGeneration,
    priorCoverageSegmentIdSha256: input.priorCoverageSegmentIdSha256,
    priorRenderGeneration: input.priorRenderGeneration,
    predecessorFinalDurableRecordedAtUtc: NOW,
    ...carryDwellEvidence(),
  };
}

function initialMaskState() {
  return {
    revision: 0,
    maskStateSha256: digest("mask-state-0"),
    includedPixelCount: 0,
    excludedPixelCount: PIXEL_COUNT,
    reasonCounts: [
      {
        reasonCode: "unverified_or_unknown_pixels" as const,
        pixelCount: PIXEL_COUNT,
      },
    ],
  };
}

function includedMaskState() {
  return {
    revision: 1,
    maskStateSha256: digest("mask-state-1"),
    includedPixelCount: 1,
    excludedPixelCount: PIXEL_COUNT - 1,
    reasonCounts: [
      {
        reasonCode: "unverified_or_unknown_pixels" as const,
        pixelCount: PIXEL_COUNT - 1,
      },
    ],
  };
}

function invalidatedMaskState() {
  return {
    revision: 2,
    maskStateSha256: digest("mask-state-2"),
    includedPixelCount: 0,
    excludedPixelCount: PIXEL_COUNT,
    reasonCounts: [
      {
        reasonCode: "unverified_or_unknown_pixels" as const,
        pixelCount: PIXEL_COUNT,
      },
    ],
  };
}

function reasonCodebook(): GrandHallT554NativeReviewFrozenMaskBindingV2["reasonMap"]["reasonSampleCodebook"] {
  return [
    { sample: 1 as const, reasonCode: "adjacent_room_pixels" as const },
    {
      sample: 2 as const,
      reasonCode: "portal_beyond_grand_hall_plane" as const,
    },
    { sample: 3 as const, reasonCode: "facade_or_exterior_pixels" as const },
    {
      sample: 4 as const,
      reasonCode: "capture_artifact_outside_verified_room" as const,
    },
    { sample: 5 as const, reasonCode: "unverified_or_unknown_pixels" as const },
  ];
}

function frozenBinding(
  maskSha256 = digest("mask-png"),
): GrandHallT554NativeReviewFrozenMaskBindingV2 {
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-mask-frozen-binding.v2" as const,
    source: source(),
    revision: 1,
    fileName: "grand-hall-mask.png",
    sha256: maskSha256,
    byteLength: 50_000,
    widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
    heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
    bitDepth: 8 as const,
    channelCount: 1 as const,
    permittedPixelValues: [0 as const, 255 as const],
    zeroMeaning: "grand_hall_included" as const,
    twoHundredFiftyFiveMeaning: "excluded_or_unknown" as const,
    includedPixelCount: 1,
    excludedPixelCount: PIXEL_COUNT - 1,
    reasonCounts: includedMaskState().reasonCounts,
    publicationDurability: "directory_fsync" as const,
    immutableFrozen: true as const,
    reasonMap: {
      fileName: "grand-hall-reason-map.png",
      sha256: digest("reason-map"),
      byteLength: 60_000,
      widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
      heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
      bitDepth: 8 as const,
      channelCount: 1 as const,
      permittedPixelValues: [
        0 as const,
        1 as const,
        2 as const,
        3 as const,
        4 as const,
        5 as const,
      ],
      zeroMeaning: "grand_hall_included" as const,
      reasonSampleCodebook: reasonCodebook(),
    },
  };
}

function preparedBinding(): GrandHallT554NativeReviewPreparedMaskBindingV2 {
  const frozen = frozenBinding();
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-mask-prepared-binding.v2" as const,
    source: frozen.source,
    revision: frozen.revision,
    includedPixelCount: frozen.includedPixelCount,
    excludedPixelCount: frozen.excludedPixelCount,
    reasonCounts: frozen.reasonCounts,
    mask: {
      fileName: frozen.fileName,
      sha256: frozen.sha256,
      byteLength: frozen.byteLength,
      widthPx: frozen.widthPx,
      heightPx: frozen.heightPx,
      bitDepth: frozen.bitDepth,
      channelCount: frozen.channelCount,
      permittedPixelValues: frozen.permittedPixelValues,
      zeroMeaning: frozen.zeroMeaning,
      twoHundredFiftyFiveMeaning: frozen.twoHundredFiftyFiveMeaning,
    },
    reasonMap: frozen.reasonMap,
  };
}

function scope() {
  return {
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_V2,
    kind: "session" as const,
    sessionIdSha256: digest("session"),
    subjectSha256: digest("session-subject"),
    registry: registry(),
    implementationManifest: implementation(),
    authorityBoundary: authority(),
  };
}

function validLifecycle() {
  const sessionScope = scope();
  const custody = sourceCustody();
  const initial = initialMaskState();
  const included = includedMaskState();
  const invalidated = invalidatedMaskState();
  const prepared = preparedBinding();
  const frozen = frozenBinding();
  const preparedBindingSha256 =
    computeGrandHallT554NativeReviewPreparedMaskBindingV2Sha256(prepared);
  const frozenBindingSha256 =
    computeGrandHallT554NativeReviewFrozenMaskBindingV2Sha256(frozen);
  const maskReviewSubjectSha256 =
    computeGrandHallT554NativeReviewMaskSubjectV2Sha256({
      sourceReviewSubjectSha256: custody.sourceReviewSubjectSha256,
      maskStateSha256: included.maskStateSha256,
      maskEvidenceSha256:
        computeGrandHallT554NativeReviewPreparedMaskEvidenceV2Sha256(prepared),
      implementationManifest: implementation(),
    });
  const browserNonce = digest("browser-1");
  const sourceCoverageSegmentIdSha256 = digest("source-segment-1");
  const maskCoverageSegmentIdSha256 = digest("mask-segment-1");
  const sourceOperation = digest("operation-source-1");
  const firstEditOperation = digest("operation-mask-edit-1");
  const freezeOperation = digest("operation-mask-freeze-1");
  const secondEditOperation = digest("operation-mask-edit-2");
  const firstSourceCheckpoint = sourceCheckpoint(1);
  const completedSourceCheckpoint = sourceCheckpoint(4);
  const firstMaskCheckpoint = maskCheckpoint(1);
  const invalidatedMaskCheckpoint = maskCheckpoint(2);

  const events = [
    envelope("session.created.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-session-created.v2" as const,
      sessionIdSha256: sessionScope.sessionIdSha256,
      workspaceRevision: 0 as const,
      maximumAllocatedRenderGeneration: 0 as const,
      registry: sessionScope.registry,
      implementationManifest: sessionScope.implementationManifest,
      authorityBoundary: sessionScope.authorityBoundary,
    }),
    envelope("session.browser-epoch-started.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-browser-epoch-started.v2" as const,
      browserEpochNumber: 1,
      browserEpochNonceSha256: browserNonce,
      previousBrowserEpochNonceSha256: null,
      reason: "session_created" as const,
      workspaceRevision: 0,
      maximumAllocatedRenderGeneration: 0,
      startedAtUtc: NOW,
    }),
    envelope("source.selection-intended.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-source-selection-intended.v2" as const,
      operationIdSha256: sourceOperation,
      browserEpochNonceSha256: browserNonce,
      expectedWorkspaceRevision: 0,
      source: custody.source,
      sourceEpochNonceSha256: custody.sourceEpochNonceSha256,
      coverageSegmentIdSha256: sourceCoverageSegmentIdSha256,
      previousRenderGeneration: 0,
      allocatedRenderGeneration: 1,
      childJournalLeafName: firstSourceCheckpoint.leafName,
      priorActiveSourceJournal: null,
    }),
    envelope("source.selection-committed.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-source-selection-committed.v2" as const,
      operationIdSha256: sourceOperation,
      browserEpochNonceSha256: browserNonce,
      coverageSegmentIdSha256: sourceCoverageSegmentIdSha256,
      previousWorkspaceRevision: 0,
      resultingWorkspaceRevision: 1,
      renderGeneration: 1,
      sourceCustody: custody,
      sourceJournal: firstSourceCheckpoint,
    }),
    envelope("mask.workflow-started.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-mask-workflow-started.v2" as const,
      browserEpochNonceSha256: browserNonce,
      previousWorkspaceRevision: 1,
      resultingWorkspaceRevision: 2,
      sourceCustody: custody,
      previousRenderGeneration: 1,
      resultingRenderGeneration: 2,
      completedSourceCoverage: {
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-completed-source-coverage.v2" as const,
        sourceReviewSubjectSha256: custody.sourceReviewSubjectSha256,
        sourceJournal: completedSourceCheckpoint,
        completedTileBitsetHex: "ff".repeat(64),
        completedTileCount: 512 as const,
        cumulativeDwellStateSha256: digest("source-completed-dwell"),
      },
      initialMaskState: initial,
    }),
    envelope("mask.edited.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-mask-edited.v2" as const,
      operationIdSha256: firstEditOperation,
      browserEpochNonceSha256: browserNonce,
      previousWorkspaceRevision: 2,
      resultingWorkspaceRevision: 3,
      sourceCustody: custody,
      previousRenderGeneration: 2,
      resultingRenderGeneration: 3,
      edit: {
        expectedRevision: 0,
        operation: "include" as const,
        primitive: {
          kind: "rectangle" as const,
          horizontalSeam: "none" as const,
          leftPx: 0,
          topPx: 0,
          rightExclusivePx: 1,
          bottomExclusivePx: 1,
        },
      },
      previousMaskState: initial,
      resultingMaskState: included,
      invalidatedFrozenBindingSha256: null,
      invalidatedMaskJournal: null,
    }),
    envelope("mask.freeze-intended.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-mask-freeze-intended.v2" as const,
      operationIdSha256: freezeOperation,
      browserEpochNonceSha256: browserNonce,
      expectedWorkspaceRevision: 3,
      sourceCustody: custody,
      previousRenderGeneration: 3,
      allocatedRenderGeneration: 4,
      maskState: included,
      maskReviewSubjectSha256,
      coverageSegmentIdSha256: maskCoverageSegmentIdSha256,
      preparedBindingSha256,
      preparedBinding: prepared,
      childJournalLeafName: firstMaskCheckpoint.leafName,
    }),
    envelope("mask.freeze-committed.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-mask-freeze-committed.v2" as const,
      operationIdSha256: freezeOperation,
      browserEpochNonceSha256: browserNonce,
      previousWorkspaceRevision: 3,
      resultingWorkspaceRevision: 4,
      sourceCustody: custody,
      renderGeneration: 4,
      maskState: included,
      maskReviewSubjectSha256,
      coverageSegmentIdSha256: maskCoverageSegmentIdSha256,
      frozenBindingSha256,
      frozenBinding: frozen,
      maskJournal: firstMaskCheckpoint,
    }),
    envelope("mask.edited.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-mask-edited.v2" as const,
      operationIdSha256: secondEditOperation,
      browserEpochNonceSha256: browserNonce,
      previousWorkspaceRevision: 4,
      resultingWorkspaceRevision: 5,
      sourceCustody: custody,
      previousRenderGeneration: 4,
      resultingRenderGeneration: 5,
      edit: {
        expectedRevision: 1,
        operation: "exclude" as const,
        reasonCode: "unverified_or_unknown_pixels" as const,
        primitive: {
          kind: "rectangle" as const,
          horizontalSeam: "none" as const,
          leftPx: 0,
          topPx: 0,
          rightExclusivePx: 1,
          bottomExclusivePx: 1,
        },
      },
      previousMaskState: included,
      resultingMaskState: invalidated,
      invalidatedFrozenBindingSha256: frozenBindingSha256,
      invalidatedMaskJournal: invalidatedMaskCheckpoint,
    }),
    envelope("source.abandoned.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-source-abandoned.v2" as const,
      browserEpochNonceSha256: browserNonce,
      previousWorkspaceRevision: 5,
      resultingWorkspaceRevision: 6,
      sourceCustody: custody,
      finalRenderGeneration: 5,
      sourceJournal: completedSourceCheckpoint,
      maskJournal: null,
      reason: "session_stop" as const,
    }),
    envelope("session.stopped.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-session-stopped.v2" as const,
      browserEpochNonceSha256: browserNonce,
      previousWorkspaceRevision: 6,
      resultingWorkspaceRevision: 7,
      stoppedAtUtc: NOW,
      activeSourceWasPresent: false,
      authorityBoundary: authority(),
    }),
  ];

  return {
    scope: sessionScope,
    events,
    browserNonce,
    custody,
    prepared,
    frozen,
    preparedBindingSha256,
    frozenBindingSha256,
    maskReviewSubjectSha256,
    sourceCoverageSegmentIdSha256,
    maskCoverageSegmentIdSha256,
    sourceOperation,
  };
}

function crashEpoch(input: {
  readonly number: number;
  readonly nonceSha256: `sha256:${string}`;
  readonly previousNonceSha256: `sha256:${string}`;
  readonly workspaceRevision: number;
  readonly maximumAllocatedRenderGeneration: number;
}) {
  return envelope("session.browser-epoch-started.v2", {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-browser-epoch-started.v2" as const,
    browserEpochNumber: input.number,
    browserEpochNonceSha256: input.nonceSha256,
    previousBrowserEpochNonceSha256: input.previousNonceSha256,
    reason: "crash_resume" as const,
    workspaceRevision: input.workspaceRevision,
    maximumAllocatedRenderGeneration:
      input.maximumAllocatedRenderGeneration,
    startedAtUtc: NOW,
  });
}

function sourceResumeIntent(input: {
  readonly scenario: ReturnType<typeof validLifecycle>;
  readonly browserEpochNonceSha256: `sha256:${string}`;
  readonly priorBrowserEpochNonceSha256: `sha256:${string}`;
  readonly priorChildJournal: ReturnType<typeof sourceCheckpoint>;
  readonly operationIdSha256: `sha256:${string}`;
  readonly newSourceEpochNonceSha256: `sha256:${string}`;
  readonly newCoverageSegmentIdSha256: `sha256:${string}`;
  readonly childJournalLeafName: string;
  readonly previousMaximumAllocatedRenderGeneration: number;
  readonly allocatedRenderGeneration: number;
}) {
  const { scenario } = input;
  return envelope("coverage.segment-resume-intended.v2", {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-coverage-segment-resume-intended.v2" as const,
    kind: "source" as const,
    operationIdSha256: input.operationIdSha256,
    browserEpochNonceSha256: input.browserEpochNonceSha256,
    expectedWorkspaceRevision: 1,
    sourceCustodyBefore: scenario.custody,
    previousVisibleRenderGeneration: 1,
    previousMaximumAllocatedRenderGeneration:
      input.previousMaximumAllocatedRenderGeneration,
    allocatedRenderGeneration: input.allocatedRenderGeneration,
    newSourceEpochNonceSha256: input.newSourceEpochNonceSha256,
    newCoverageSegmentIdSha256: input.newCoverageSegmentIdSha256,
    childJournalLeafName: input.childJournalLeafName,
    priorChildJournal: input.priorChildJournal,
    predecessorCoverage: sourceResumeCarry({
      sessionScope: scenario.scope,
      custody: scenario.custody,
      predecessorJournal: input.priorChildJournal,
      priorBrowserEpochNonceSha256: input.priorBrowserEpochNonceSha256,
      priorCoverageSegmentIdSha256:
        scenario.sourceCoverageSegmentIdSha256,
      priorRenderGeneration: 1,
    }),
  });
}

function sourceResumeCommit(input: {
  readonly browserEpochNonceSha256: `sha256:${string}`;
  readonly operationIdSha256: `sha256:${string}`;
  readonly renderGeneration: number;
  readonly coverageSegmentIdSha256: `sha256:${string}`;
  readonly custody: ReturnType<typeof sourceCustody>;
  readonly childJournal: ReturnType<typeof sourceCheckpoint>;
}) {
  return envelope("coverage.segment-resume-committed.v2", {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-coverage-segment-resume-committed.v2" as const,
    kind: "source" as const,
    operationIdSha256: input.operationIdSha256,
    browserEpochNonceSha256: input.browserEpochNonceSha256,
    previousWorkspaceRevision: 1,
    resultingWorkspaceRevision: 2,
    renderGeneration: input.renderGeneration,
    coverageSegmentIdSha256: input.coverageSegmentIdSha256,
    sourceCustody: input.custody,
    sourceJournal: input.childJournal,
  });
}

function maskResumeIntent(input: {
  readonly scenario: ReturnType<typeof validLifecycle>;
  readonly browserEpochNonceSha256: `sha256:${string}`;
  readonly priorBrowserEpochNonceSha256: `sha256:${string}`;
  readonly priorChildJournal: ReturnType<typeof maskCheckpoint>;
  readonly operationIdSha256: `sha256:${string}`;
  readonly newSourceEpochNonceSha256: `sha256:${string}`;
  readonly newCoverageSegmentIdSha256: `sha256:${string}`;
  readonly childJournalLeafName: string;
}) {
  const { scenario } = input;
  return envelope("coverage.segment-resume-intended.v2", {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-coverage-segment-resume-intended.v2" as const,
    kind: "mask" as const,
    operationIdSha256: input.operationIdSha256,
    browserEpochNonceSha256: input.browserEpochNonceSha256,
    expectedWorkspaceRevision: 4,
    sourceCustodyBefore: scenario.custody,
    previousVisibleRenderGeneration: 4,
    previousMaximumAllocatedRenderGeneration: 4,
    allocatedRenderGeneration: 5,
    newSourceEpochNonceSha256: input.newSourceEpochNonceSha256,
    newCoverageSegmentIdSha256: input.newCoverageSegmentIdSha256,
    childJournalLeafName: input.childJournalLeafName,
    priorChildJournal: input.priorChildJournal,
    predecessorCoverage: maskResumeCarry({
      sessionScope: scenario.scope,
      custody: scenario.custody,
      predecessorJournal: input.priorChildJournal,
      priorBrowserEpochNonceSha256: input.priorBrowserEpochNonceSha256,
      priorCoverageSegmentIdSha256:
        scenario.maskCoverageSegmentIdSha256,
      priorRenderGeneration: 4,
      maskState: includedMaskState(),
      maskReviewSubjectSha256: scenario.maskReviewSubjectSha256,
      frozenBindingSha256: scenario.frozenBindingSha256,
      frozenBinding: scenario.frozen,
    }),
    maskState: includedMaskState(),
    maskReviewSubjectSha256: scenario.maskReviewSubjectSha256,
    frozenBindingSha256: scenario.frozenBindingSha256,
    frozenBinding: scenario.frozen,
  });
}

function maskResumeCommit(input: {
  readonly scenario: ReturnType<typeof validLifecycle>;
  readonly browserEpochNonceSha256: `sha256:${string}`;
  readonly operationIdSha256: `sha256:${string}`;
  readonly coverageSegmentIdSha256: `sha256:${string}`;
  readonly custody: ReturnType<typeof sourceCustody>;
  readonly childJournal: ReturnType<typeof maskCheckpoint>;
}) {
  return envelope("coverage.segment-resume-committed.v2", {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-coverage-segment-resume-committed.v2" as const,
    kind: "mask" as const,
    operationIdSha256: input.operationIdSha256,
    browserEpochNonceSha256: input.browserEpochNonceSha256,
    previousWorkspaceRevision: 4,
    resultingWorkspaceRevision: 5,
    renderGeneration: 5,
    coverageSegmentIdSha256: input.coverageSegmentIdSha256,
    sourceCustody: input.custody,
    maskState: includedMaskState(),
    maskReviewSubjectSha256: input.scenario.maskReviewSubjectSha256,
    frozenBindingSha256: input.scenario.frozenBindingSha256,
    frozenBinding: input.scenario.frozen,
    maskJournal: input.childJournal,
  });
}

function replacePayload(
  events: readonly unknown[],
  index: number,
  replacement: Readonly<Record<string, unknown>>,
): readonly unknown[] {
  const current = events[index];
  if (
    typeof current !== "object" ||
    current === null ||
    Array.isArray(current)
  ) {
    throw new Error("test event is not an object");
  }
  const record = current as Readonly<Record<string, unknown>>;
  const payload = record.payload;
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new Error("test event payload is not an object");
  }
  const result = [...events];
  result[index] = {
    ...record,
    payload: {
      ...(payload as Readonly<Record<string, unknown>>),
      ...replacement,
    },
  };
  return result;
}

function expectReplayError(
  sessionScope: unknown,
  events: readonly unknown[],
  code: GrandHallT554NativeReviewCoordinatorReplayV2Error["code"],
): void {
  try {
    replayGrandHallT554NativeReviewCoordinatorV2({
      scope: sessionScope,
      events,
    });
  } catch (error) {
    expect(error).toBeInstanceOf(
      GrandHallT554NativeReviewCoordinatorReplayV2Error,
    );
    if (error instanceof GrandHallT554NativeReviewCoordinatorReplayV2Error) {
      expect(error.code).toBe(code);
      return;
    }
  }
  throw new Error(`expected coordinator replay error ${code}`);
}

describe("Grand Hall T-554 native review coordinator replay v2", () => {
  it("replays the full select, mask, freeze, invalidate, abandon, and stop lifecycle", () => {
    const scenario = validLifecycle();
    const replay = replayGrandHallT554NativeReviewCoordinatorV2(scenario);

    expect(replay).toMatchObject({
      lifecycle: "stopped",
      workspaceRevision: 7,
      maximumAllocatedRenderGeneration: 5,
      eventCount: 11,
      activeSource: null,
      pendingIntent: null,
      declaredChildLeafNames: ["mask-child-0001", "source-child-0001"],
    });
    expect(Object.isFrozen(replay)).toBe(true);
    expect(Object.isFrozen(replay.registry)).toBe(true);
    expect(Object.isFrozen(replay.declaredChildLeafNames)).toBe(true);
  });

  it("uses one stable mask-evidence digest across prepare and durable publication", () => {
    const scenario = validLifecycle();

    expect(
      computeGrandHallT554NativeReviewPreparedMaskEvidenceV2Sha256(
        scenario.prepared,
      ),
    ).toBe(
      computeGrandHallT554NativeReviewFrozenMaskEvidenceV2Sha256(
        scenario.frozen,
      ),
    );
    expect(scenario.preparedBindingSha256).not.toBe(
      scenario.frozenBindingSha256,
    );
  });

  it("resumes source and frozen-mask coverage into fresh epochs and child obligations", () => {
    const scenario = validLifecycle();

    const sourceBrowserTwo = digest("source-resume-browser-2");
    const sourceCrash = crashEpoch({
      number: 2,
      nonceSha256: sourceBrowserTwo,
      previousNonceSha256: scenario.browserNonce,
      workspaceRevision: 1,
      maximumAllocatedRenderGeneration: 1,
    });
    const priorSourceJournal = sourceCheckpoint(2);
    const sourceOperation = digest("source-resume-operation");
    const sourceSegment = digest("source-resume-segment");
    const resumedSourceCustody = sourceCustody(2, "source-resume-epoch");
    const sourceIntent = sourceResumeIntent({
      scenario,
      browserEpochNonceSha256: sourceBrowserTwo,
      priorBrowserEpochNonceSha256: scenario.browserNonce,
      priorChildJournal: priorSourceJournal,
      operationIdSha256: sourceOperation,
      newSourceEpochNonceSha256:
        resumedSourceCustody.sourceEpochNonceSha256,
      newCoverageSegmentIdSha256: sourceSegment,
      childJournalLeafName: "source-child-resume-0002",
      previousMaximumAllocatedRenderGeneration: 1,
      allocatedRenderGeneration: 2,
    });
    const resumedSourceJournal = sourceCheckpoint(
      1,
      "source-child-resume-0002",
    );
    const sourceCommit = sourceResumeCommit({
      browserEpochNonceSha256: sourceBrowserTwo,
      operationIdSha256: sourceOperation,
      renderGeneration: 2,
      coverageSegmentIdSha256: sourceSegment,
      custody: resumedSourceCustody,
      childJournal: resumedSourceJournal,
    });
    const sourceReplay = replayGrandHallT554NativeReviewCoordinatorV2({
      scope: scenario.scope,
      events: [
        ...scenario.events.slice(0, 4),
        sourceCrash,
        sourceIntent,
        sourceCommit,
      ],
    });
    expect(sourceReplay).toMatchObject({
      workspaceRevision: 2,
      maximumAllocatedRenderGeneration: 2,
      pendingIntent: null,
      activeSource: {
        phase: "source_review",
        renderGeneration: 2,
        sourceCoverageSegmentIdSha256: sourceSegment,
        sourceCustody: resumedSourceCustody,
      },
    });
    expect(
      sourceReplay.childObligations.find(
        (obligation) =>
          obligation.leafName === "source-child-resume-0002",
      ),
    ).toMatchObject({
      kind: "source",
      declarationKind: "coverage_resume",
      disposition: "committed",
      allocatedRenderGeneration: 2,
      checkpointReferences: [resumedSourceJournal],
    });

    const maskBrowserTwo = digest("mask-resume-browser-2");
    const maskCrash = crashEpoch({
      number: 2,
      nonceSha256: maskBrowserTwo,
      previousNonceSha256: scenario.browserNonce,
      workspaceRevision: 4,
      maximumAllocatedRenderGeneration: 4,
    });
    const priorMaskJournal = maskCheckpoint(2);
    const maskOperation = digest("mask-resume-operation");
    const maskSegment = digest("mask-resume-segment");
    const resumedMaskCustody = sourceCustody(5, "mask-resume-epoch");
    const maskIntent = maskResumeIntent({
      scenario,
      browserEpochNonceSha256: maskBrowserTwo,
      priorBrowserEpochNonceSha256: scenario.browserNonce,
      priorChildJournal: priorMaskJournal,
      operationIdSha256: maskOperation,
      newSourceEpochNonceSha256:
        resumedMaskCustody.sourceEpochNonceSha256,
      newCoverageSegmentIdSha256: maskSegment,
      childJournalLeafName: "mask-child-resume-0002",
    });
    const resumedMaskJournal = maskCheckpoint(1, "mask-child-resume-0002");
    const maskCommit = maskResumeCommit({
      scenario,
      browserEpochNonceSha256: maskBrowserTwo,
      operationIdSha256: maskOperation,
      coverageSegmentIdSha256: maskSegment,
      custody: resumedMaskCustody,
      childJournal: resumedMaskJournal,
    });
    const maskReplay = replayGrandHallT554NativeReviewCoordinatorV2({
      scope: scenario.scope,
      events: [
        ...scenario.events.slice(0, 8),
        maskCrash,
        maskIntent,
        maskCommit,
      ],
    });
    expect(maskReplay).toMatchObject({
      workspaceRevision: 5,
      maximumAllocatedRenderGeneration: 5,
      pendingIntent: null,
      activeSource: {
        phase: "mask_review",
        renderGeneration: 5,
        maskCoverageSegmentIdSha256: maskSegment,
        maskState: includedMaskState(),
        maskReviewSubjectSha256: scenario.maskReviewSubjectSha256,
        frozenBindingSha256: scenario.frozenBindingSha256,
        frozenBinding: scenario.frozen,
      },
    });
    expect(
      maskReplay.childObligations.find(
        (obligation) => obligation.leafName === "mask-child-resume-0002",
      ),
    ).toMatchObject({
      kind: "mask",
      declarationKind: "coverage_resume",
      disposition: "committed",
      allocatedRenderGeneration: 5,
      checkpointReferences: [resumedMaskJournal],
    });
  });

  it("resumes an editable mask epoch without inventing frozen review state", () => {
    const scenario = validLifecycle();
    const browserTwo = digest("mask-edit-resume-browser-2");
    const resumedCustody = sourceCustody(4, "mask-edit-resume-epoch");
    const resume = envelope("mask.edit-epoch-resumed.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-mask-edit-epoch-resumed.v2" as const,
      operationIdSha256: digest("mask-edit-resume-operation"),
      browserEpochNonceSha256: browserTwo,
      previousWorkspaceRevision: 3,
      resultingWorkspaceRevision: 4,
      previousVisibleRenderGeneration: 3,
      previousMaximumAllocatedRenderGeneration: 3,
      resultingRenderGeneration: 4,
      sourceCustodyBefore: scenario.custody,
      sourceCustody: resumedCustody,
    });
    const replay = replayGrandHallT554NativeReviewCoordinatorV2({
      scope: scenario.scope,
      events: [
        ...scenario.events.slice(0, 6),
        crashEpoch({
          number: 2,
          nonceSha256: browserTwo,
          previousNonceSha256: scenario.browserNonce,
          workspaceRevision: 3,
          maximumAllocatedRenderGeneration: 3,
        }),
        resume,
      ],
    });
    expect(replay).toMatchObject({
      workspaceRevision: 4,
      maximumAllocatedRenderGeneration: 4,
      pendingIntent: null,
      activeSource: {
        phase: "mask_edit",
        renderGeneration: 4,
        sourceCustody: resumedCustody,
        maskState: includedMaskState(),
        maskReviewSubjectSha256: null,
        frozenBindingSha256: null,
        frozenBinding: null,
        maskJournal: null,
        maskCoverageSegmentIdSha256: null,
      },
    });
    expectReplayError(
      scenario.scope,
      [
        ...scenario.events.slice(0, 6),
        replacePayload([resume], 0, {
          browserEpochNonceSha256: scenario.browserNonce,
        })[0],
      ],
      "TRANSITION_INVALID",
    );
    expectReplayError(
      scenario.scope,
      [
        ...scenario.events.slice(0, 6),
        crashEpoch({
          number: 2,
          nonceSha256: browserTwo,
          previousNonceSha256: scenario.browserNonce,
          workspaceRevision: 3,
          maximumAllocatedRenderGeneration: 3,
        }),
        replacePayload([resume], 0, {
          browserEpochNonceSha256: scenario.browserNonce,
        })[0],
      ],
      "BINDING_MISMATCH",
    );
  });

  it("recovery-aborts a crashed mask resume while retaining frozen review evidence", () => {
    const scenario = validLifecycle();
    const browserTwo = digest("mask-resume-abort-browser-2");
    const browserThree = digest("mask-resume-abort-browser-3");
    const operation = digest("mask-resume-abort-operation");
    const intent = maskResumeIntent({
      scenario,
      browserEpochNonceSha256: browserTwo,
      priorBrowserEpochNonceSha256: scenario.browserNonce,
      priorChildJournal: maskCheckpoint(2),
      operationIdSha256: operation,
      newSourceEpochNonceSha256: digest("mask-resume-abort-epoch-nonce"),
      newCoverageSegmentIdSha256: digest("mask-resume-abort-segment"),
      childJournalLeafName: "mask-child-resume-aborted",
    });
    const abandoned = maskCheckpoint(1, "mask-child-resume-aborted");
    const replay = replayGrandHallT554NativeReviewCoordinatorV2({
      scope: scenario.scope,
      events: [
        ...scenario.events.slice(0, 8),
        crashEpoch({
          number: 2,
          nonceSha256: browserTwo,
          previousNonceSha256: scenario.browserNonce,
          workspaceRevision: 4,
          maximumAllocatedRenderGeneration: 4,
        }),
        intent,
        crashEpoch({
          number: 3,
          nonceSha256: browserThree,
          previousNonceSha256: browserTwo,
          workspaceRevision: 4,
          maximumAllocatedRenderGeneration: 5,
        }),
        envelope("coverage.segment-resume-recovery-aborted.v2", {
          schemaVersion:
            "venviewer.grand-hall-t554-native-review-coverage-segment-resume-recovery-aborted.v2" as const,
          kind: "mask" as const,
          operationIdSha256: operation,
          browserEpochNonceSha256: browserThree,
          workspaceRevision: 4,
          consumedRenderGeneration: 5,
          recovery: {
            childDisposition: "exact_abandoned" as const,
            abandonedChildJournal: abandoned,
          },
        }),
      ],
    });
    expect(replay).toMatchObject({
      workspaceRevision: 4,
      maximumAllocatedRenderGeneration: 5,
      pendingIntent: null,
      activeSource: {
        phase: "mask_review",
        renderGeneration: 4,
        maskState: includedMaskState(),
        frozenBindingSha256: scenario.frozenBindingSha256,
        frozenBinding: scenario.frozen,
      },
    });
    expect(
      replay.childObligations.find(
        (obligation) =>
          obligation.leafName === "mask-child-resume-aborted",
      ),
    ).toMatchObject({
      kind: "mask",
      disposition: "recovery_aborted_present",
      checkpointReferences: [abandoned],
    });
  });

  it("rejects stale resume ownership, workspace, visible generation, and allocation ceilings", () => {
    const scenario = validLifecycle();
    const browserTwo = digest("resume-adversarial-browser-2");
    const prefix = [
      ...scenario.events.slice(0, 4),
      crashEpoch({
        number: 2,
        nonceSha256: browserTwo,
        previousNonceSha256: scenario.browserNonce,
        workspaceRevision: 1,
        maximumAllocatedRenderGeneration: 1,
      }),
    ];
    const prior = sourceCheckpoint(2);
    const resumedCustody = sourceCustody(2, "resume-adversarial-epoch");
    const intent = sourceResumeIntent({
      scenario,
      browserEpochNonceSha256: browserTwo,
      priorBrowserEpochNonceSha256: scenario.browserNonce,
      priorChildJournal: prior,
      operationIdSha256: digest("resume-adversarial-operation"),
      newSourceEpochNonceSha256: resumedCustody.sourceEpochNonceSha256,
      newCoverageSegmentIdSha256: digest("resume-adversarial-segment"),
      childJournalLeafName: "source-child-resume-adversarial",
      previousMaximumAllocatedRenderGeneration: 1,
      allocatedRenderGeneration: 2,
    });
    expectReplayError(
      scenario.scope,
      [
        ...prefix,
        replacePayload([intent], 0, {
          browserEpochNonceSha256: scenario.browserNonce,
        })[0],
      ],
      "BINDING_MISMATCH",
    );
    expectReplayError(
      scenario.scope,
      [
        ...prefix,
        replacePayload([intent], 0, { expectedWorkspaceRevision: 0 })[0],
      ],
      "TRANSITION_INVALID",
    );
    expectReplayError(
      scenario.scope,
      [
        ...prefix,
        replacePayload([intent], 0, {
          previousVisibleRenderGeneration: 2,
          previousMaximumAllocatedRenderGeneration: 2,
          allocatedRenderGeneration: 3,
        })[0],
      ],
      "TRANSITION_INVALID",
    );
    expectReplayError(
      scenario.scope,
      [
        ...prefix,
        replacePayload([intent], 0, {
          previousMaximumAllocatedRenderGeneration: 2,
          allocatedRenderGeneration: 3,
        })[0],
      ],
      "TRANSITION_INVALID",
    );

    const commit = sourceResumeCommit({
      browserEpochNonceSha256: browserTwo,
      operationIdSha256: digest("resume-adversarial-operation"),
      renderGeneration: 2,
      coverageSegmentIdSha256: digest("resume-adversarial-segment"),
      custody: resumedCustody,
      childJournal: sourceCheckpoint(1, "source-child-resume-adversarial"),
    });
    expectReplayError(
      scenario.scope,
      [
        ...prefix,
        intent,
        replacePayload([commit], 0, {
          browserEpochNonceSha256: scenario.browserNonce,
        })[0],
      ],
      "BINDING_MISMATCH",
    );
    expectReplayError(
      scenario.scope,
      [
        ...prefix,
        intent,
        replacePayload([commit], 0, {
          sourceCustody: {
            ...resumedCustody,
            sourceVerification: {
              ...resumedCustody.sourceVerification,
              decodedPixelSha256: digest("drifted-decoded-pixels"),
            },
          },
        })[0],
      ],
      "BINDING_MISMATCH",
    );
  });

  it("rejects reused resume operation, epoch, segment, child, and unknown kind", () => {
    const scenario = validLifecycle();
    const browserTwo = digest("resume-identity-browser-2");
    const prefix = [
      ...scenario.events.slice(0, 4),
      crashEpoch({
        number: 2,
        nonceSha256: browserTwo,
        previousNonceSha256: scenario.browserNonce,
        workspaceRevision: 1,
        maximumAllocatedRenderGeneration: 1,
      }),
    ];
    const prior = sourceCheckpoint(2);
    const resumedCustody = sourceCustody(2, "resume-identity-epoch");
    const intent = sourceResumeIntent({
      scenario,
      browserEpochNonceSha256: browserTwo,
      priorBrowserEpochNonceSha256: scenario.browserNonce,
      priorChildJournal: prior,
      operationIdSha256: digest("resume-identity-operation"),
      newSourceEpochNonceSha256: resumedCustody.sourceEpochNonceSha256,
      newCoverageSegmentIdSha256: digest("resume-identity-segment"),
      childJournalLeafName: "source-child-resume-identity",
      previousMaximumAllocatedRenderGeneration: 1,
      allocatedRenderGeneration: 2,
    });

    expectReplayError(
      scenario.scope,
      [
        ...prefix,
        replacePayload([intent], 0, {
          operationIdSha256: scenario.sourceOperation,
        })[0],
      ],
      "TRANSITION_INVALID",
    );
    expectReplayError(
      scenario.scope,
      [
        ...prefix,
        replacePayload([intent], 0, {
          newSourceEpochNonceSha256:
            scenario.custody.sourceEpochNonceSha256,
        })[0],
      ],
      "EVENT_INVALID",
    );
    expectReplayError(
      scenario.scope,
      [
        ...prefix,
        replacePayload([intent], 0, {
          newCoverageSegmentIdSha256:
            scenario.sourceCoverageSegmentIdSha256,
        })[0],
      ],
      "EVENT_INVALID",
    );
    expectReplayError(
      scenario.scope,
      [
        ...prefix,
        replacePayload([intent], 0, {
          childJournalLeafName: "source-child-0001",
        })[0],
      ],
      "TRANSITION_INVALID",
    );
    expectReplayError(
      scenario.scope,
      [
        ...prefix,
        replacePayload([intent], 0, { kind: "future_resume_kind" })[0],
      ],
      "EVENT_INVALID",
    );

    const reusedBindingCustody = {
      ...resumedCustody,
      sourceEpochBindingSha256:
        scenario.custody.sourceEpochBindingSha256,
    };
    expectReplayError(
      scenario.scope,
      [
        ...prefix,
        intent,
        sourceResumeCommit({
          browserEpochNonceSha256: browserTwo,
          operationIdSha256: digest("resume-identity-operation"),
          renderGeneration: 2,
          coverageSegmentIdSha256: digest("resume-identity-segment"),
          custody: reusedBindingCustody,
          childJournal: sourceCheckpoint(
            1,
            "source-child-resume-identity",
          ),
        }),
      ],
      "BINDING_MISMATCH",
    );
  });

  it("rejects checkpoint, carry, prior-browser, and phase drift", () => {
    const scenario = validLifecycle();
    const browserTwo = digest("resume-carry-browser-2");
    const sourcePrefix = [
      ...scenario.events.slice(0, 4),
      crashEpoch({
        number: 2,
        nonceSha256: browserTwo,
        previousNonceSha256: scenario.browserNonce,
        workspaceRevision: 1,
        maximumAllocatedRenderGeneration: 1,
      }),
    ];
    const prior = sourceCheckpoint(2);
    const resumedCustody = sourceCustody(2, "resume-carry-epoch");
    const intent = sourceResumeIntent({
      scenario,
      browserEpochNonceSha256: browserTwo,
      priorBrowserEpochNonceSha256: scenario.browserNonce,
      priorChildJournal: prior,
      operationIdSha256: digest("resume-carry-operation"),
      newSourceEpochNonceSha256: resumedCustody.sourceEpochNonceSha256,
      newCoverageSegmentIdSha256: digest("resume-carry-segment"),
      childJournalLeafName: "source-child-resume-carry",
      previousMaximumAllocatedRenderGeneration: 1,
      allocatedRenderGeneration: 2,
    });
    expectReplayError(
      scenario.scope,
      [
        ...sourcePrefix,
        replacePayload([intent], 0, {
          predecessorCoverage: {
            ...intent.payload.predecessorCoverage,
            priorBrowserEpochNonceSha256: digest("wrong-prior-browser"),
          },
        })[0],
      ],
      "BINDING_MISMATCH",
    );
    expectReplayError(
      scenario.scope,
      [
        ...sourcePrefix,
        replacePayload([intent], 0, {
          predecessorCoverage: {
            ...intent.payload.predecessorCoverage,
            priorCoverageSegmentIdSha256: digest("wrong-prior-segment"),
          },
        })[0],
      ],
      "BINDING_MISMATCH",
    );
    expectReplayError(
      scenario.scope,
      [
        ...sourcePrefix,
        replacePayload([intent], 0, {
          predecessorCoverage: {
            ...intent.payload.predecessorCoverage,
            predecessorJournal: sourceCheckpoint(3),
          },
        })[0],
      ],
      "EVENT_INVALID",
    );

    const forgedSameRevision = {
      ...sourceCheckpoint(1),
      headEventSha256: digest("forged-same-revision-head"),
    };
    const forgedIntent = sourceResumeIntent({
      scenario,
      browserEpochNonceSha256: browserTwo,
      priorBrowserEpochNonceSha256: scenario.browserNonce,
      priorChildJournal: forgedSameRevision,
      operationIdSha256: digest("resume-forged-checkpoint-operation"),
      newSourceEpochNonceSha256: digest("resume-forged-checkpoint-nonce"),
      newCoverageSegmentIdSha256: digest("resume-forged-checkpoint-segment"),
      childJournalLeafName: "source-child-resume-forged-checkpoint",
      previousMaximumAllocatedRenderGeneration: 1,
      allocatedRenderGeneration: 2,
    });
    expectReplayError(
      scenario.scope,
      [...sourcePrefix, forgedIntent],
      "BINDING_MISMATCH",
    );

    const sourceOnMask = replacePayload(
      [
        sourceResumeIntent({
          scenario,
          browserEpochNonceSha256: browserTwo,
          priorBrowserEpochNonceSha256: scenario.browserNonce,
          priorChildJournal: sourceCheckpoint(5),
          operationIdSha256: digest("source-on-mask-operation"),
          newSourceEpochNonceSha256: digest("source-on-mask-nonce"),
          newCoverageSegmentIdSha256: digest("source-on-mask-segment"),
          childJournalLeafName: "source-child-on-mask",
          previousMaximumAllocatedRenderGeneration: 4,
          allocatedRenderGeneration: 5,
        }),
      ],
      0,
      {
        expectedWorkspaceRevision: 4,
        previousVisibleRenderGeneration: 4,
        predecessorCoverage: sourceResumeCarry({
          sessionScope: scenario.scope,
          custody: scenario.custody,
          predecessorJournal: sourceCheckpoint(5),
          priorBrowserEpochNonceSha256: scenario.browserNonce,
          priorCoverageSegmentIdSha256:
            scenario.sourceCoverageSegmentIdSha256,
          priorRenderGeneration: 4,
        }),
      },
    )[0];
    expectReplayError(
      scenario.scope,
      [
        ...scenario.events.slice(0, 8),
        crashEpoch({
          number: 2,
          nonceSha256: browserTwo,
          previousNonceSha256: scenario.browserNonce,
          workspaceRevision: 4,
          maximumAllocatedRenderGeneration: 4,
        }),
        sourceOnMask,
      ],
      "TRANSITION_INVALID",
    );

    const maskOnSource = replacePayload(
      [
        maskResumeIntent({
          scenario,
          browserEpochNonceSha256: browserTwo,
          priorBrowserEpochNonceSha256: scenario.browserNonce,
          priorChildJournal: maskCheckpoint(1, "never-declared-mask"),
          operationIdSha256: digest("mask-on-source-operation"),
          newSourceEpochNonceSha256: digest("mask-on-source-nonce"),
          newCoverageSegmentIdSha256: digest("mask-on-source-segment"),
          childJournalLeafName: "mask-child-on-source",
        }),
      ],
      0,
      {
        expectedWorkspaceRevision: 1,
        previousVisibleRenderGeneration: 1,
        previousMaximumAllocatedRenderGeneration: 1,
        allocatedRenderGeneration: 2,
      },
    )[0];
    expectReplayError(
      scenario.scope,
      [...sourcePrefix, maskOnSource],
      "TRANSITION_INVALID",
    );
  });

  it("consumes a crashed resume allocation, recovery-aborts it, and retries without wedging", () => {
    const scenario = validLifecycle();
    const browserTwo = digest("resume-abort-browser-2");
    const prior = sourceCheckpoint(2);
    const firstCustody = sourceCustody(2, "resume-abort-epoch-2");
    const firstOperation = digest("resume-abort-operation-2");
    const firstIntent = sourceResumeIntent({
      scenario,
      browserEpochNonceSha256: browserTwo,
      priorBrowserEpochNonceSha256: scenario.browserNonce,
      priorChildJournal: prior,
      operationIdSha256: firstOperation,
      newSourceEpochNonceSha256: firstCustody.sourceEpochNonceSha256,
      newCoverageSegmentIdSha256: digest("resume-abort-segment-2"),
      childJournalLeafName: "source-child-resume-aborted",
      previousMaximumAllocatedRenderGeneration: 1,
      allocatedRenderGeneration: 2,
    });
    const browserThree = digest("resume-abort-browser-3");
    const throughSecondCrash = [
      ...scenario.events.slice(0, 4),
      crashEpoch({
        number: 2,
        nonceSha256: browserTwo,
        previousNonceSha256: scenario.browserNonce,
        workspaceRevision: 1,
        maximumAllocatedRenderGeneration: 1,
      }),
      firstIntent,
      crashEpoch({
        number: 3,
        nonceSha256: browserThree,
        previousNonceSha256: browserTwo,
        workspaceRevision: 1,
        maximumAllocatedRenderGeneration: 2,
      }),
    ];
    const abort = envelope("coverage.segment-resume-recovery-aborted.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-coverage-segment-resume-recovery-aborted.v2" as const,
      kind: "source" as const,
      operationIdSha256: firstOperation,
      browserEpochNonceSha256: browserThree,
      workspaceRevision: 1,
      consumedRenderGeneration: 2,
      recovery: {
        childDisposition: "absent" as const,
        abandonedChildJournal: null,
      },
    });
    const recovered = replayGrandHallT554NativeReviewCoordinatorV2({
      scope: scenario.scope,
      events: [...throughSecondCrash, abort],
    });
    expect(recovered).toMatchObject({
      workspaceRevision: 1,
      maximumAllocatedRenderGeneration: 2,
      pendingIntent: null,
      activeSource: { renderGeneration: 1 },
    });
    expect(
      recovered.childObligations.find(
        (obligation) =>
          obligation.leafName === "source-child-resume-aborted",
      ),
    ).toMatchObject({
      disposition: "recovery_aborted_absent",
      allocatedRenderGeneration: 2,
    });

    const retriedCustody = sourceCustody(3, "resume-abort-epoch-3");
    const retryOperation = digest("resume-abort-operation-3");
    const retrySegment = digest("resume-abort-segment-3");
    const retryIntent = sourceResumeIntent({
      scenario,
      browserEpochNonceSha256: browserThree,
      priorBrowserEpochNonceSha256: browserTwo,
      priorChildJournal: prior,
      operationIdSha256: retryOperation,
      newSourceEpochNonceSha256: retriedCustody.sourceEpochNonceSha256,
      newCoverageSegmentIdSha256: retrySegment,
      childJournalLeafName: "source-child-resume-retry",
      previousMaximumAllocatedRenderGeneration: 2,
      allocatedRenderGeneration: 3,
    });
    const retryJournal = sourceCheckpoint(1, "source-child-resume-retry");
    const retried = replayGrandHallT554NativeReviewCoordinatorV2({
      scope: scenario.scope,
      events: [
        ...throughSecondCrash,
        abort,
        retryIntent,
        sourceResumeCommit({
          browserEpochNonceSha256: browserThree,
          operationIdSha256: retryOperation,
          renderGeneration: 3,
          coverageSegmentIdSha256: retrySegment,
          custody: retriedCustody,
          childJournal: retryJournal,
        }),
      ],
    });
    expect(retried).toMatchObject({
      workspaceRevision: 2,
      maximumAllocatedRenderGeneration: 3,
      pendingIntent: null,
      activeSource: {
        renderGeneration: 3,
        sourceCoverageSegmentIdSha256: retrySegment,
      },
    });
    expect(
      retried.childObligations.find(
        (obligation) =>
          obligation.leafName === "source-child-resume-retry",
      ),
    ).toMatchObject({ disposition: "committed" });

    expectReplayError(
      scenario.scope,
      [
        ...throughSecondCrash,
        replacePayload([abort], 0, {
          browserEpochNonceSha256: browserTwo,
        })[0],
      ],
      "BINDING_MISMATCH",
    );
  });

  it("rejects unknown or non-exact event shapes", () => {
    const scenario = validLifecycle();
    const unknown = envelope("session.magic.v2", { value: true });
    expectReplayError(
      scenario.scope,
      [scenario.events[0], unknown],
      "EVENT_INVALID",
    );

    const withExtra = {
      ...(scenario.events[1] as Readonly<Record<string, unknown>>),
      invented: true,
    };
    expectReplayError(
      scenario.scope,
      [scenario.events[0], withExtra],
      "EVENT_INVALID",
    );
  });

  it("rejects a source commit without its durable intent", () => {
    const scenario = validLifecycle();
    expectReplayError(
      scenario.scope,
      [scenario.events[0], scenario.events[1], scenario.events[3]],
      "TRANSITION_INVALID",
    );
  });

  it("rejects stale workspace CAS and stale browser ownership", () => {
    const scenario = validLifecycle();
    expectReplayError(
      scenario.scope,
      replacePayload(scenario.events, 2, { expectedWorkspaceRevision: 1 }),
      "TRANSITION_INVALID",
    );
    expectReplayError(
      scenario.scope,
      replacePayload(scenario.events, 2, {
        browserEpochNonceSha256: digest("stale-browser"),
      }),
      "BINDING_MISMATCH",
    );

    for (const eventIndex of [4, 5, 7, 8, 9, 10]) {
      expectReplayError(
        scenario.scope,
        replacePayload(scenario.events, eventIndex, {
          browserEpochNonceSha256: digest(
            `stale-browser-${String(eventIndex)}`,
          ),
        }),
        "BINDING_MISMATCH",
      );
    }
  });

  it("rejects operation-id reuse, including across intent and mask edit", () => {
    const scenario = validLifecycle();
    expectReplayError(
      scenario.scope,
      replacePayload(scenario.events, 5, {
        operationIdSha256: scenario.sourceOperation,
      }),
      "TRANSITION_INVALID",
    );
  });

  it("rejects reused child leaves and stale render-generation predecessors", () => {
    const scenario = validLifecycle();
    const prefix = scenario.events.slice(0, 10);
    const newCustody = sourceCustody(6, "source-epoch-2");
    const secondIntent = envelope("source.selection-intended.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-source-selection-intended.v2" as const,
      operationIdSha256: digest("operation-source-2"),
      browserEpochNonceSha256: scenario.browserNonce,
      expectedWorkspaceRevision: 6,
      source: newCustody.source,
      sourceEpochNonceSha256: newCustody.sourceEpochNonceSha256,
      coverageSegmentIdSha256: digest("source-segment-2"),
      previousRenderGeneration: 5,
      allocatedRenderGeneration: 6,
      childJournalLeafName: "source-child-0001",
      priorActiveSourceJournal: null,
    });
    expectReplayError(
      scenario.scope,
      [...prefix, secondIntent],
      "TRANSITION_INVALID",
    );

    const staleGeneration = {
      ...secondIntent,
      payload: {
        ...secondIntent.payload,
        previousRenderGeneration: 4,
        allocatedRenderGeneration: 5,
        childJournalLeafName: "source-child-0002",
      },
    };
    expectReplayError(
      scenario.scope,
      [...prefix, staleGeneration],
      "TRANSITION_INVALID",
    );
  });

  it("preserves an intent prefix and permits only a new epoch to recovery-abort it", () => {
    const scenario = validLifecycle();
    const pendingPrefix = scenario.events.slice(0, 3);
    const pending = replayGrandHallT554NativeReviewCoordinatorV2({
      scope: scenario.scope,
      events: pendingPrefix,
    });
    expect(pending.pendingIntent).toMatchObject({
      kind: "source_selection",
      allocatedRenderGeneration: 1,
    });
    expect(pending.maximumAllocatedRenderGeneration).toBe(1);

    const browserTwo = digest("browser-2");
    const crashEpoch = envelope("session.browser-epoch-started.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-browser-epoch-started.v2" as const,
      browserEpochNumber: 2,
      browserEpochNonceSha256: browserTwo,
      previousBrowserEpochNonceSha256: scenario.browserNonce,
      reason: "crash_resume" as const,
      workspaceRevision: 0,
      maximumAllocatedRenderGeneration: 1,
      startedAtUtc: NOW,
    });
    expectReplayError(
      scenario.scope,
      [...pendingPrefix, crashEpoch, scenario.events[3]],
      "BINDING_MISMATCH",
    );

    const abort = envelope("source.selection-recovery-aborted.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-source-selection-recovery-aborted.v2" as const,
      operationIdSha256: scenario.sourceOperation,
      browserEpochNonceSha256: browserTwo,
      workspaceRevision: 0,
      consumedRenderGeneration: 1,
      recovery: {
        childDisposition: "absent" as const,
        abandonedChildJournal: null,
      },
    });
    const recovered = replayGrandHallT554NativeReviewCoordinatorV2({
      scope: scenario.scope,
      events: [...pendingPrefix, crashEpoch, abort],
    });
    expect(recovered.pendingIntent).toBeNull();
    expect(recovered.workspaceRevision).toBe(0);
    expect(recovered.maximumAllocatedRenderGeneration).toBe(1);
  });

  it("continues edit or freeze after an aborted freeze consumes a generation", () => {
    const scenario = validLifecycle();
    const pendingFreezePrefix = scenario.events.slice(0, 7);
    const browserTwo = digest("browser-2-after-freeze");
    const crashEpoch = envelope("session.browser-epoch-started.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-browser-epoch-started.v2" as const,
      browserEpochNumber: 2,
      browserEpochNonceSha256: browserTwo,
      previousBrowserEpochNonceSha256: scenario.browserNonce,
      reason: "crash_resume" as const,
      workspaceRevision: 3,
      maximumAllocatedRenderGeneration: 4,
      startedAtUtc: NOW,
    });
    const abort = envelope("mask.freeze-recovery-aborted.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-mask-freeze-recovery-aborted.v2" as const,
      operationIdSha256: digest("operation-mask-freeze-1"),
      browserEpochNonceSha256: browserTwo,
      workspaceRevision: 3,
      consumedRenderGeneration: 4,
      publicationDisposition: "none" as const,
      abandonedMaskJournal: null,
    });
    const recoveredPrefix = [
      ...pendingFreezePrefix,
      crashEpoch,
      abort,
    ] as const;

    const continuedEdit = replacePayload([scenario.events[8]], 0, {
      operationIdSha256: digest("operation-mask-edit-after-abort"),
      browserEpochNonceSha256: browserTwo,
      previousWorkspaceRevision: 3,
      resultingWorkspaceRevision: 4,
      previousRenderGeneration: 3,
      resultingRenderGeneration: 5,
      invalidatedFrozenBindingSha256: null,
      invalidatedMaskJournal: null,
    })[0];
    if (continuedEdit === undefined)
      throw new Error("continued edit is absent");
    const edited = replayGrandHallT554NativeReviewCoordinatorV2({
      scope: scenario.scope,
      events: [...recoveredPrefix, continuedEdit],
    });
    expect(edited.maximumAllocatedRenderGeneration).toBe(5);
    expect(edited.activeSource?.renderGeneration).toBe(5);
    expect(edited.workspaceRevision).toBe(4);

    const continuedFreeze = replacePayload([scenario.events[6]], 0, {
      operationIdSha256: digest("operation-mask-freeze-after-abort"),
      browserEpochNonceSha256: browserTwo,
      expectedWorkspaceRevision: 3,
      previousRenderGeneration: 3,
      allocatedRenderGeneration: 5,
      coverageSegmentIdSha256: digest("mask-segment-after-abort"),
      childJournalLeafName: "mask-child-0002",
    })[0];
    if (continuedFreeze === undefined)
      throw new Error("continued freeze is absent");
    const refrozen = replayGrandHallT554NativeReviewCoordinatorV2({
      scope: scenario.scope,
      events: [...recoveredPrefix, continuedFreeze],
    });
    expect(refrozen.maximumAllocatedRenderGeneration).toBe(5);
    expect(refrozen.activeSource?.renderGeneration).toBe(3);
    expect(refrozen.pendingIntent).toMatchObject({
      kind: "mask_freeze",
      allocatedRenderGeneration: 5,
      childJournalLeafName: "mask-child-0002",
    });
  });

  it("rejects stop while a source remains active", () => {
    const scenario = validLifecycle();
    const stop = envelope("session.stopped.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-session-stopped.v2" as const,
      browserEpochNonceSha256: scenario.browserNonce,
      previousWorkspaceRevision: 1,
      resultingWorkspaceRevision: 2,
      stoppedAtUtc: NOW,
      activeSourceWasPresent: true,
      authorityBoundary: authority(),
    });
    expectReplayError(
      scenario.scope,
      [...scenario.events.slice(0, 4), stop],
      "TRANSITION_INVALID",
    );
  });

  it("makes poison terminal while retaining the last acknowledged revisions", () => {
    const scenario = validLifecycle();
    const poison = envelope("session.poisoned.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-session-poisoned.v2" as const,
      browserEpochNonceSha256: scenario.browserNonce,
      workspaceRevision: 0,
      maximumAllocatedRenderGeneration: 1,
      poisonedAtUtc: NOW,
      reasonCode: "durability_ambiguous" as const,
      authorityBoundary: authority(),
    });
    const poisoned = replayGrandHallT554NativeReviewCoordinatorV2({
      scope: scenario.scope,
      events: [...scenario.events.slice(0, 3), poison],
    });
    expect(poisoned.lifecycle).toBe("poisoned");
    expect(poisoned.workspaceRevision).toBe(0);
    expect(poisoned.maximumAllocatedRenderGeneration).toBe(1);

    expectReplayError(
      scenario.scope,
      [
        ...scenario.events.slice(0, 3),
        {
          ...poison,
          payload: {
            ...poison.payload,
            browserEpochNonceSha256: digest("stale-poison-browser"),
          },
        },
      ],
      "BINDING_MISMATCH",
    );

    expectReplayError(
      scenario.scope,
      [...scenario.events.slice(0, 3), poison, scenario.events[1]],
      "TRANSITION_INVALID",
    );
  });

  it("rejects scope drift at session creation", () => {
    const scenario = validLifecycle();
    const driftedRegistry = {
      ...registry(),
      reviewPack: artifact("different-review-pack"),
    };
    expectReplayError(
      scenario.scope,
      replacePayload(scenario.events, 0, { registry: driftedRegistry }),
      "BINDING_MISMATCH",
    );
  });

  it("rejects forged prepared digests and subjects", () => {
    const scenario = validLifecycle();
    expectReplayError(
      scenario.scope,
      replacePayload(scenario.events, 6, {
        preparedBindingSha256: digest("forged-prepared-binding"),
      }),
      "DERIVED_MISMATCH",
    );
    expectReplayError(
      scenario.scope,
      replacePayload(scenario.events, 6, {
        maskReviewSubjectSha256: digest("forged-mask-subject"),
      }),
      "DERIVED_MISMATCH",
    );
  });

  it("rejects prepared evidence whose counts drift from replayed mask state", () => {
    const scenario = validLifecycle();
    const mismatchedPrepared = {
      ...scenario.prepared,
      includedPixelCount: 2,
      excludedPixelCount: PIXEL_COUNT - 2,
      reasonCounts: [
        {
          reasonCode: "unverified_or_unknown_pixels" as const,
          pixelCount: PIXEL_COUNT - 2,
        },
      ],
    };
    const evidenceSha256 =
      computeGrandHallT554NativeReviewPreparedMaskEvidenceV2Sha256(
        mismatchedPrepared,
      );
    expectReplayError(
      scenario.scope,
      replacePayload(scenario.events, 6, {
        preparedBinding: mismatchedPrepared,
        preparedBindingSha256:
          computeGrandHallT554NativeReviewPreparedMaskBindingV2Sha256(
            mismatchedPrepared,
          ),
        maskReviewSubjectSha256:
          computeGrandHallT554NativeReviewMaskSubjectV2Sha256({
            sourceReviewSubjectSha256:
              scenario.custody.sourceReviewSubjectSha256,
            maskStateSha256: includedMaskState().maskStateSha256,
            maskEvidenceSha256: evidenceSha256,
            implementationManifest: implementation(),
          }),
      }),
      "BINDING_MISMATCH",
    );
  });

  it("rejects a durable frozen pair that differs from the prepared bytes", () => {
    const scenario = validLifecycle();
    const differentFrozen = frozenBinding(digest("different-mask-png"));
    expectReplayError(
      scenario.scope,
      replacePayload(scenario.events, 7, {
        frozenBinding: differentFrozen,
        frozenBindingSha256:
          computeGrandHallT554NativeReviewFrozenMaskBindingV2Sha256(
            differentFrozen,
          ),
      }),
      "BINDING_MISMATCH",
    );
  });

  it("deep-freezes an active frozen-review replay result", () => {
    const scenario = validLifecycle();
    const replay = replayGrandHallT554NativeReviewCoordinatorV2({
      scope: scenario.scope,
      events: scenario.events.slice(0, 8),
    });
    expect(replay.activeSource?.phase).toBe("mask_review");
    expect(Object.isFrozen(replay.activeSource)).toBe(true);
    expect(Object.isFrozen(replay.activeSource?.frozenBinding)).toBe(true);
    expect(Object.isFrozen(replay.activeSource?.frozenBinding?.reasonMap)).toBe(
      true,
    );
  });
});
