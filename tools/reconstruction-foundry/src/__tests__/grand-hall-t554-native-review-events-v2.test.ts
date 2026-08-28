import { createHash } from "node:crypto";

import {
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_WIDTH_PX,
} from "@omnitwin/types";
import { describe, expect, it } from "vitest";

import {
  GRAND_HALL_T554_NATIVE_REVIEW_HUMAN_ATTESTATION_STATEMENT_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_DOMAIN_EVENT_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_V2,
  computeGrandHallT554NativeReviewHumanAttestationV2Sha256,
  computeGrandHallT554NativeReviewSourceDecisionV2Sha256,
  GrandHallT554NativeReviewCoverageCarryStateV2Schema,
  GrandHallT554NativeReviewCoverageObservedPayloadV2Schema,
  GrandHallT554NativeReviewDomainEventV2Schema,
  GrandHallT554NativeReviewFrozenMaskBindingV2Schema,
  GrandHallT554NativeReviewJournalScopeV2Schema,
  GrandHallT554NativeReviewMaskEditedPayloadV2Schema,
  GrandHallT554NativeReviewMaskReviewStartedPayloadV2Schema,
  GrandHallT554NativeReviewScopedEventV2Schema,
  GrandHallT554NativeReviewSourceReviewStartedPayloadV2Schema,
  GrandHallT554NativeReviewTileDeliveredPayloadV2Schema,
} from "../grand-hall-t554-native-review-events-v2.js";

const PIXEL_COUNT =
  GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX;
const EMPTY_BITMAP = "0".repeat(128);
const CANONICAL_TIME = "2026-08-27T12:34:56.789Z";

function digest(seed: string | Buffer): `sha256:${string}` {
  const bytes = typeof seed === "string" ? Buffer.from(seed, "utf8") : seed;
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

const RAW_SESSION_NONCE = Buffer.alloc(32, 7).toString("base64url");
const RAW_SOURCE_NONCE = Buffer.alloc(32, 8).toString("base64url");

function event(eventType: string, payload: unknown) {
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

function source(inventoryIndex = 0) {
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
  const selected = source(inventoryIndex);
  return {
    fileName: selected.fileName,
    sha256: selected.sha256,
    byteLength: selected.byteLength,
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
      libvipsVersion: "8.17.3",
      pipeline: "captured-jpeg-buffer-to-unrotated-rgb8.v1" as const,
    },
    descriptorWitnessSha256: digest(`descriptor-${String(inventoryIndex)}`),
    sameOpenDescriptorHashedAndDecoded: true as const,
    fullJpegDecodeCompleted: true as const,
  };
}

function sourceCustody(inventoryIndex = 0, generation = 1) {
  return {
    source: source(inventoryIndex),
    sourceVerification: sourceVerification(inventoryIndex),
    sourceReviewSubjectSha256: digest(
      `source-subject-${String(inventoryIndex)}`,
    ),
    sourceEpochBindingSha256: digest(
      `source-epoch-binding-${String(inventoryIndex)}`,
    ),
    sourceEpochNonceSha256: digest(
      inventoryIndex === 0
        ? RAW_SOURCE_NONCE
        : `source-epoch-nonce-${String(inventoryIndex)}`,
    ),
    sourceEpochRenderGeneration: generation,
  };
}

function sourceCheckpoint() {
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-child-checkpoint.v2" as const,
    kind: "source" as const,
    leafName: "source-child-0001",
    scopeSha256: digest("source-scope"),
    scopeFileSha256: digest("source-scope-file"),
    revision: 4,
    headEventSha256: digest("source-head"),
    journalInventorySha256: digest("source-inventory"),
  };
}

function maskCheckpoint() {
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-child-checkpoint.v2" as const,
    kind: "mask" as const,
    leafName: "mask-child-0001",
    scopeSha256: digest("mask-scope"),
    scopeFileSha256: digest("mask-scope-file"),
    revision: 4,
    headEventSha256: digest("mask-head"),
    journalInventorySha256: digest("mask-inventory"),
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

function editedMaskState() {
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

function reasonCodebook() {
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

function frozenBinding(inventoryIndex = 0) {
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-mask-frozen-binding.v2" as const,
    source: source(inventoryIndex),
    revision: 1,
    fileName: `grand-hall-mask-${String(inventoryIndex)}.png`,
    sha256: digest(`mask-png-${String(inventoryIndex)}`),
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
    reasonCounts: [
      {
        reasonCode: "unverified_or_unknown_pixels" as const,
        pixelCount: PIXEL_COUNT - 1,
      },
    ],
    publicationDurability: "directory_fsync" as const,
    immutableFrozen: true as const,
    reasonMap: {
      fileName: `grand-hall-reason-map-${String(inventoryIndex)}.png`,
      sha256: digest(`reason-map-${String(inventoryIndex)}`),
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

function preparedBinding(inventoryIndex = 0) {
  const frozen = frozenBinding(inventoryIndex);
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

function bitmap(indexes: readonly number[]): string {
  const bytes = Buffer.alloc(64);
  for (const index of indexes) {
    const byteIndex = Math.floor(index / 8);
    bytes[byteIndex] = (bytes[byteIndex] ?? 0) | (1 << (index % 8));
  }
  return bytes.toString("hex");
}

function dwellEvidence(values: ReadonlyMap<number, number> = new Map()) {
  const bytes = Buffer.alloc(1_024);
  const completed: number[] = [];
  for (const [index, dwell] of values) {
    bytes.writeUInt16LE(dwell, index * 2);
    if (dwell === 750) completed.push(index);
  }
  return {
    cappedDwellMsUint16LeBase64url: bytes.toString("base64url"),
    cappedDwellBytesSha256: digest(bytes),
    completedTileBitsetHex: bitmap(completed),
    completedTileCount: completed.length,
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

function completedSourceCoverage() {
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-completed-source-coverage.v2" as const,
    sourceReviewSubjectSha256: sourceCustody().sourceReviewSubjectSha256,
    sourceJournal: sourceCheckpoint(),
    completedTileBitsetHex: "ff".repeat(64),
    completedTileCount: 512 as const,
    cumulativeDwellStateSha256: digest("completed-source-dwell"),
  };
}

function completedMaskCoverage() {
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-completed-mask-coverage.v2" as const,
    maskReviewSubjectSha256: digest("mask-review-subject"),
    maskStateSha256: editedMaskState().maskStateSha256,
    frozenBindingSha256: digest("frozen-binding"),
    maskJournal: maskCheckpoint(),
    completedTileBitsetHex: "ff".repeat(64),
    completedTileCount: 512 as const,
    cumulativeDwellStateSha256: digest("completed-mask-dwell"),
  };
}

function excludeDecisionPayload() {
  const material = {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-source-decision-recorded.v2" as const,
    operationIdSha256: digest("exclude-decision-operation"),
    browserEpochNonceSha256: digest("browser-epoch"),
    previousWorkspaceRevision: 1,
    resultingWorkspaceRevision: 2,
    sessionIdSha256: digest("session-id"),
    registry: registry(),
    implementationManifest: implementation(),
    authorityBoundary: authority(),
    sourceCustody: sourceCustody(),
    previousRenderGeneration: 1,
    resultingRenderGeneration: 2,
    completedSourceCoverage: completedSourceCoverage(),
    note: "Native review found no observed Grand Hall pixels.",
    decidedAtUtc: CANONICAL_TIME,
    result: "EXCLUDE" as const,
    classification: "no_observed_grand_hall_pixels" as const,
    maskState: null,
    maskReviewSubjectSha256: null,
    frozenBindingSha256: null,
    frozenBinding: null,
    completedMaskCoverage: null,
  };
  return {
    ...material,
    decisionSha256:
      computeGrandHallT554NativeReviewSourceDecisionV2Sha256(material),
  };
}

function includeDecisionPayload() {
  const material = {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-source-decision-recorded.v2" as const,
    operationIdSha256: digest("include-decision-operation"),
    browserEpochNonceSha256: digest("browser-epoch"),
    previousWorkspaceRevision: 4,
    resultingWorkspaceRevision: 5,
    sessionIdSha256: digest("session-id"),
    registry: registry(),
    implementationManifest: implementation(),
    authorityBoundary: authority(),
    sourceCustody: sourceCustody(),
    previousRenderGeneration: 4,
    resultingRenderGeneration: 5,
    completedSourceCoverage: completedSourceCoverage(),
    note: "Native review supports Grand Hall pixels within the bound mask.",
    decidedAtUtc: CANONICAL_TIME,
    result: "INCLUDE" as const,
    classification: "grand_hall_core" as const,
    maskState: editedMaskState(),
    maskReviewSubjectSha256: digest("mask-review-subject"),
    frozenBindingSha256: digest("frozen-binding"),
    frozenBinding: frozenBinding(),
    completedMaskCoverage: completedMaskCoverage(),
  };
  return {
    ...material,
    decisionSha256:
      computeGrandHallT554NativeReviewSourceDecisionV2Sha256(material),
  };
}

function humanAttestationPayload(decisionSha256: `sha256:${string}`) {
  const material = {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-source-human-attestation-recorded.v2" as const,
    operationIdSha256: digest("human-attestation-operation"),
    browserEpochNonceSha256: digest("browser-epoch"),
    previousWorkspaceRevision: 5,
    resultingWorkspaceRevision: 6,
    sessionIdSha256: digest("session-id"),
    sourceReviewSubjectSha256: sourceCustody().sourceReviewSubjectSha256,
    decisionSha256,
    reviewerId: "authorized-reviewer-1",
    reviewerRole: "venue_owner_or_authorized_domain_reviewer" as const,
    knowledgeBasis: [
      "Reviewed the exact native source and its exact frozen mask.",
    ],
    attestedAtUtc: CANONICAL_TIME,
    statement: GRAND_HALL_T554_NATIVE_REVIEW_HUMAN_ATTESTATION_STATEMENT_V2,
    humanPresenceProof: "not_cryptographic" as const,
    agentDecisionAuthority: "none" as const,
    authority: "none" as const,
  };
  return {
    ...material,
    attestationSha256:
      computeGrandHallT554NativeReviewHumanAttestationV2Sha256(material),
  };
}

function sourceCarry() {
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-coverage-carry-state.v2" as const,
    kind: "source" as const,
    subjectSha256: sourceCustody().sourceReviewSubjectSha256,
    predecessorJournal: sourceCheckpoint(),
    sessionIdSha256: digest("session-id"),
    registry: registry(),
    implementationManifest: implementation(),
    sourceCustody: sourceCustody(),
    priorBrowserEpochNonceSha256: digest(RAW_SESSION_NONCE),
    priorSourceEpochBindingSha256: sourceCustody().sourceEpochBindingSha256,
    priorSourceEpochNonceSha256: sourceCustody().sourceEpochNonceSha256,
    priorSourceEpochRenderGeneration:
      sourceCustody().sourceEpochRenderGeneration,
    priorCoverageSegmentIdSha256: digest("source-segment"),
    priorRenderGeneration: 1,
    predecessorFinalDurableRecordedAtUtc: CANONICAL_TIME,
    ...dwellEvidence(
      new Map([
        [0, 375],
        [1, 750],
      ]),
    ),
  };
}

function maskCarry() {
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-coverage-carry-state.v2" as const,
    kind: "mask" as const,
    subjectSha256: digest("mask-subject"),
    predecessorJournal: maskCheckpoint(),
    maskStateSha256: editedMaskState().maskStateSha256,
    frozenBindingSha256: digest("frozen-binding"),
    frozenBinding: frozenBinding(),
    sessionIdSha256: digest("session-id"),
    registry: registry(),
    implementationManifest: implementation(),
    sourceCustody: sourceCustody(),
    priorBrowserEpochNonceSha256: digest(RAW_SESSION_NONCE),
    priorSourceEpochBindingSha256: sourceCustody().sourceEpochBindingSha256,
    priorSourceEpochNonceSha256: sourceCustody().sourceEpochNonceSha256,
    priorSourceEpochRenderGeneration:
      sourceCustody().sourceEpochRenderGeneration,
    priorCoverageSegmentIdSha256: digest("mask-segment"),
    priorRenderGeneration: 4,
    predecessorFinalDurableRecordedAtUtc: CANONICAL_TIME,
    ...dwellEvidence(
      new Map([
        [5, 749],
        [6, 750],
      ]),
    ),
  };
}

function sourceStarted(
  predecessorCoverage: ReturnType<typeof sourceCarry> | null = null,
) {
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-source-review-started.v2" as const,
    browserEpochNonceSha256: digest(RAW_SESSION_NONCE),
    coverageSegmentIdSha256: digest("source-segment"),
    coverageSegmentStartedAtUtc: CANONICAL_TIME,
    firstSampleMustCreditZero: true as const,
    renderGeneration: 1,
    sourceCustody: sourceCustody(),
    registry: registry(),
    implementationManifest: implementation(),
    tileGrid: {
      widthPx: 256 as const,
      heightPx: 256 as const,
      columnCount: 32 as const,
      rowCount: 16 as const,
      channelCount: 3 as const,
      bytesPerTile: 196_608 as const,
      resampling: "none" as const,
    },
    predecessorCoverage,
    authorityBoundary: authority(),
  };
}

function maskStarted(
  predecessorCoverage: ReturnType<typeof maskCarry> | null = null,
) {
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-mask-review-started.v2" as const,
    browserEpochNonceSha256: digest(RAW_SESSION_NONCE),
    coverageSegmentIdSha256: digest("mask-segment"),
    coverageSegmentStartedAtUtc: CANONICAL_TIME,
    firstSampleMustCreditZero: true as const,
    renderGeneration: 4,
    sourceCustody: sourceCustody(),
    maskReviewSubjectSha256: digest("mask-subject"),
    maskStateSha256: editedMaskState().maskStateSha256,
    frozenBindingSha256: digest("frozen-binding"),
    frozenBinding: frozenBinding(),
    implementationManifest: implementation(),
    predecessorCoverage,
    authorityBoundary: authority(),
  };
}

function tileDelivered(
  subjectSha256 = sourceCustody().sourceReviewSubjectSha256,
  generation = 1,
) {
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-tile-delivered.v2" as const,
    browserEpochNonceSha256: digest(RAW_SESSION_NONCE),
    sourceEpochNonceSha256: sourceCustody().sourceEpochNonceSha256,
    coverageSegmentIdSha256: digest(
      generation === 1 ? "source-segment" : "mask-segment",
    ),
    subjectSha256,
    renderGeneration: generation,
    column: 2,
    row: 1,
    tileIndex: 34,
    responseFinishedAtUtc: CANONICAL_TIME,
  };
}

function firstCoverage(
  completedTileBitsetHex = EMPTY_BITMAP,
  completedTileCount = 0,
) {
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-coverage-observed.v2" as const,
    browserEpochNonceSha256: digest(RAW_SESSION_NONCE),
    sourceEpochNonceSha256: sourceCustody().sourceEpochNonceSha256,
    coverageSegmentIdSha256: digest("source-segment"),
    subjectSha256: sourceCustody().sourceReviewSubjectSha256,
    renderGeneration: 1,
    sequence: 0,
    previousCoverageEventSha256: null,
    serverObservation: {
      receivedAtUtc: CANONICAL_TIME,
      monotonicElapsedMs: 125,
    },
    telemetry: {
      documentVisibilityState: "visible" as const,
      documentFocusState: "focused" as const,
      viewportCssWidth: 8_192,
      viewportCssHeight: 4_096,
      devicePixelRatio: 1,
      sourceToCssTransform: {
        a: 1,
        b: 0 as const,
        c: 0 as const,
        d: 1,
        e: 0,
        f: 0,
      },
      paintedTileBitsetHex: EMPTY_BITMAP,
    },
    derived: {
      effectiveDevicePixelsPerSourcePixel: 1,
      serverMonotonicDeltaMs: 0,
      deliveredTileBitsetHex: EMPTY_BITMAP,
      fullyVisibleDeliveredTileBitsetHex: EMPTY_BITMAP,
      creditedTileBitsetHex: EMPTY_BITMAP,
      creditedDurationMs: 0,
      disqualifier: "first_sample" as const,
      completedTileBitsetHex,
      completedTileCount,
      cumulativeDwellStateSha256: digest("current-dwell-state"),
    },
    coverageEventSha256: digest("coverage-event-0"),
  };
}

function validScopes(): readonly unknown[] {
  const common = {
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_V2,
    sessionIdSha256: digest("session-id"),
    implementationManifest: implementation(),
    registry: registry(),
    authorityBoundary: authority(),
  };
  return [
    { ...common, kind: "session", subjectSha256: digest("session-subject") },
    {
      ...common,
      kind: "source",
      browserEpochNonceSha256: digest(RAW_SESSION_NONCE),
      coverageSegmentIdSha256: digest("source-segment"),
      renderGeneration: 1,
      sourceCustody: sourceCustody(),
    },
    {
      ...common,
      kind: "mask",
      browserEpochNonceSha256: digest(RAW_SESSION_NONCE),
      coverageSegmentIdSha256: digest("mask-segment"),
      renderGeneration: 4,
      sourceCustody: sourceCustody(),
      maskReviewSubjectSha256: digest("mask-subject"),
      maskStateSha256: editedMaskState().maskStateSha256,
      frozenBindingSha256: digest("frozen-binding"),
      frozenBinding: frozenBinding(),
    },
  ];
}

function validEvents(): readonly unknown[] {
  const resumedSourceCustody = {
    ...sourceCustody(),
    sourceEpochBindingSha256: digest("source-resume-binding"),
    sourceEpochNonceSha256: digest("source-resume-nonce"),
    sourceEpochRenderGeneration: 2,
  };
  const resumedMaskCustody = {
    ...sourceCustody(),
    sourceEpochBindingSha256: digest("mask-resume-binding"),
    sourceEpochNonceSha256: digest("mask-resume-nonce"),
    sourceEpochRenderGeneration: 5,
  };
  const resumedEditCustody = {
    ...sourceCustody(),
    sourceEpochBindingSha256: digest("mask-edit-resume-binding"),
    sourceEpochNonceSha256: digest("mask-edit-resume-nonce"),
    sourceEpochRenderGeneration: 5,
  };
  const selectionIntent = {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-source-selection-intended.v2",
    operationIdSha256: digest("select-operation"),
    browserEpochNonceSha256: digest(RAW_SESSION_NONCE),
    expectedWorkspaceRevision: 0,
    source: source(),
    preparedSourceCustody: sourceCustody(),
    sourceEpochNonceSha256: sourceCustody().sourceEpochNonceSha256,
    coverageSegmentIdSha256: digest("source-segment"),
    previousRenderGeneration: 0,
    allocatedRenderGeneration: 1,
    childJournalLeafName: "source-child-0001",
    priorActiveSourceJournal: null,
  };
  const freezeIntent = {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-mask-freeze-intended.v2",
    operationIdSha256: digest("freeze-operation"),
    browserEpochNonceSha256: digest(RAW_SESSION_NONCE),
    expectedWorkspaceRevision: 3,
    sourceCustody: sourceCustody(),
    previousRenderGeneration: 3,
    allocatedRenderGeneration: 4,
    maskState: editedMaskState(),
    maskReviewSubjectSha256: digest("mask-subject"),
    coverageSegmentIdSha256: digest("mask-segment"),
    preparedBindingSha256: digest("prepared-binding"),
    preparedBinding: preparedBinding(),
    childJournalLeafName: "mask-child-0001",
  };
  return [
    event("session.created.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-session-created.v2",
      sessionIdSha256: digest("session-id"),
      workspaceRevision: 0,
      maximumAllocatedRenderGeneration: 0,
      registry: registry(),
      implementationManifest: implementation(),
      authorityBoundary: authority(),
    }),
    event("session.browser-epoch-started.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-browser-epoch-started.v2",
      browserEpochNumber: 1,
      browserEpochNonceSha256: digest(RAW_SESSION_NONCE),
      previousBrowserEpochNonceSha256: null,
      reason: "session_created",
      priorActiveSourceJournal: null,
      priorActiveMaskJournal: null,
      workspaceRevision: 0,
      maximumAllocatedRenderGeneration: 0,
      startedAtUtc: CANONICAL_TIME,
    }),
    event("source.selection-intended.v2", selectionIntent),
    event("source.selection-committed.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-source-selection-committed.v2",
      operationIdSha256: digest("select-operation"),
      browserEpochNonceSha256: digest(RAW_SESSION_NONCE),
      coverageSegmentIdSha256: digest("source-segment"),
      previousWorkspaceRevision: 0,
      resultingWorkspaceRevision: 1,
      renderGeneration: 1,
      sourceCustody: sourceCustody(),
      sourceJournal: sourceCheckpoint(),
    }),
    event("source.selection-recovery-aborted.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-source-selection-recovery-aborted.v2",
      operationIdSha256: digest("aborted-select"),
      browserEpochNonceSha256: digest(RAW_SESSION_NONCE),
      workspaceRevision: 0,
      consumedRenderGeneration: 1,
      recovery: { childDisposition: "absent", abandonedChildJournal: null },
    }),
    event("mask.workflow-started.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-mask-workflow-started.v2",
      browserEpochNonceSha256: digest(RAW_SESSION_NONCE),
      previousWorkspaceRevision: 1,
      resultingWorkspaceRevision: 2,
      sourceCustody: sourceCustody(),
      previousRenderGeneration: 1,
      resultingRenderGeneration: 2,
      completedSourceCoverage: completedSourceCoverage(),
      initialMaskState: initialMaskState(),
    }),
    event("mask.edited.v2", {
      schemaVersion: "venviewer.grand-hall-t554-native-review-mask-edited.v2",
      operationIdSha256: digest("edit-operation"),
      browserEpochNonceSha256: digest(RAW_SESSION_NONCE),
      previousWorkspaceRevision: 2,
      resultingWorkspaceRevision: 3,
      sourceCustody: sourceCustody(),
      previousRenderGeneration: 2,
      resultingRenderGeneration: 3,
      edit: {
        expectedRevision: 0,
        operation: "include",
        primitive: {
          kind: "rectangle",
          horizontalSeam: "none",
          leftPx: 0,
          topPx: 0,
          rightExclusivePx: 1,
          bottomExclusivePx: 1,
        },
      },
      previousMaskState: initialMaskState(),
      resultingMaskState: editedMaskState(),
      invalidatedFrozenBindingSha256: null,
      invalidatedMaskJournal: null,
    }),
    event("mask.freeze-intended.v2", freezeIntent),
    event("mask.freeze-committed.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-mask-freeze-committed.v2",
      operationIdSha256: digest("freeze-operation"),
      browserEpochNonceSha256: digest(RAW_SESSION_NONCE),
      previousWorkspaceRevision: 3,
      resultingWorkspaceRevision: 4,
      sourceCustody: sourceCustody(),
      renderGeneration: 4,
      maskState: editedMaskState(),
      maskReviewSubjectSha256: digest("mask-subject"),
      coverageSegmentIdSha256: digest("mask-segment"),
      frozenBindingSha256: digest("frozen-binding"),
      frozenBinding: frozenBinding(),
      maskJournal: maskCheckpoint(),
    }),
    event("mask.freeze-recovery-aborted.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-mask-freeze-recovery-aborted.v2",
      operationIdSha256: digest("aborted-freeze"),
      browserEpochNonceSha256: digest(RAW_SESSION_NONCE),
      workspaceRevision: 3,
      consumedRenderGeneration: 4,
      publicationDisposition: "mask_only",
      abandonedMaskJournal: null,
    }),
    event("coverage.segment-resume-intended.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-coverage-segment-resume-intended.v2",
      kind: "source",
      operationIdSha256: digest("source-resume-operation"),
      browserEpochNonceSha256: digest("browser-2"),
      expectedWorkspaceRevision: 1,
      sourceCustodyBefore: sourceCustody(),
      preparedSourceCustody: resumedSourceCustody,
      previousVisibleRenderGeneration: 1,
      previousMaximumAllocatedRenderGeneration: 1,
      allocatedRenderGeneration: 2,
      newSourceEpochNonceSha256: resumedSourceCustody.sourceEpochNonceSha256,
      newCoverageSegmentIdSha256: digest("source-segment-2"),
      childJournalLeafName: "source-child-0002",
      priorChildJournal: sourceCheckpoint(),
      predecessorCoverage: sourceCarry(),
    }),
    event("coverage.segment-resume-committed.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-coverage-segment-resume-committed.v2",
      kind: "source",
      operationIdSha256: digest("source-resume-operation"),
      browserEpochNonceSha256: digest("browser-2"),
      previousWorkspaceRevision: 1,
      resultingWorkspaceRevision: 2,
      renderGeneration: 2,
      coverageSegmentIdSha256: digest("source-segment-2"),
      sourceCustody: resumedSourceCustody,
      sourceJournal: sourceCheckpoint(),
    }),
    event("coverage.segment-resume-recovery-aborted.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-coverage-segment-resume-recovery-aborted.v2",
      kind: "source",
      operationIdSha256: digest("source-resume-abort-operation"),
      browserEpochNonceSha256: digest("browser-2"),
      workspaceRevision: 1,
      consumedRenderGeneration: 2,
      recovery: {
        childDisposition: "absent",
        abandonedChildJournal: null,
      },
    }),
    event("coverage.segment-resume-intended.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-coverage-segment-resume-intended.v2",
      kind: "mask",
      operationIdSha256: digest("mask-resume-operation"),
      browserEpochNonceSha256: digest("browser-2"),
      expectedWorkspaceRevision: 4,
      sourceCustodyBefore: sourceCustody(),
      preparedSourceCustody: resumedMaskCustody,
      previousVisibleRenderGeneration: 4,
      previousMaximumAllocatedRenderGeneration: 4,
      allocatedRenderGeneration: 5,
      newSourceEpochNonceSha256: resumedMaskCustody.sourceEpochNonceSha256,
      newCoverageSegmentIdSha256: digest("mask-segment-2"),
      childJournalLeafName: "mask-child-0002",
      priorChildJournal: maskCheckpoint(),
      predecessorCoverage: maskCarry(),
      maskState: editedMaskState(),
      maskReviewSubjectSha256: digest("mask-subject"),
      frozenBindingSha256: digest("frozen-binding"),
      frozenBinding: frozenBinding(),
    }),
    event("coverage.segment-resume-committed.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-coverage-segment-resume-committed.v2",
      kind: "mask",
      operationIdSha256: digest("mask-resume-operation"),
      browserEpochNonceSha256: digest("browser-2"),
      previousWorkspaceRevision: 4,
      resultingWorkspaceRevision: 5,
      renderGeneration: 5,
      coverageSegmentIdSha256: digest("mask-segment-2"),
      sourceCustody: resumedMaskCustody,
      maskState: editedMaskState(),
      maskReviewSubjectSha256: digest("mask-subject"),
      frozenBindingSha256: digest("frozen-binding"),
      frozenBinding: frozenBinding(),
      maskJournal: maskCheckpoint(),
    }),
    event("coverage.segment-resume-recovery-aborted.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-coverage-segment-resume-recovery-aborted.v2",
      kind: "mask",
      operationIdSha256: digest("mask-resume-abort-operation"),
      browserEpochNonceSha256: digest("browser-2"),
      workspaceRevision: 4,
      consumedRenderGeneration: 5,
      recovery: {
        childDisposition: "exact_abandoned",
        abandonedChildJournal: maskCheckpoint(),
      },
    }),
    event("mask.edit-epoch-resumed.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-mask-edit-epoch-resumed.v2",
      operationIdSha256: digest("mask-edit-resume-operation"),
      browserEpochNonceSha256: digest("browser-2"),
      previousWorkspaceRevision: 4,
      resultingWorkspaceRevision: 5,
      previousVisibleRenderGeneration: 4,
      previousMaximumAllocatedRenderGeneration: 4,
      resultingRenderGeneration: 5,
      sourceCustodyBefore: sourceCustody(),
      sourceCustody: resumedEditCustody,
    }),
    event("source.abandoned.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-source-abandoned.v2",
      browserEpochNonceSha256: digest(RAW_SESSION_NONCE),
      previousWorkspaceRevision: 4,
      resultingWorkspaceRevision: 5,
      sourceCustody: sourceCustody(),
      finalRenderGeneration: 4,
      sourceJournal: sourceCheckpoint(),
      maskJournal: maskCheckpoint(),
      reason: "source_switch",
    }),
    event("session.stopped.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-session-stopped.v2",
      browserEpochNonceSha256: digest(RAW_SESSION_NONCE),
      previousWorkspaceRevision: 5,
      resultingWorkspaceRevision: 6,
      stoppedAtUtc: CANONICAL_TIME,
      activeSourceWasPresent: false,
      authorityBoundary: authority(),
    }),
    event("session.poisoned.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-session-poisoned.v2",
      browserEpochNonceSha256: digest(RAW_SESSION_NONCE),
      workspaceRevision: 6,
      maximumAllocatedRenderGeneration: 4,
      poisonedAtUtc: CANONICAL_TIME,
      reasonCode: "resource_cleanup_failed",
      authorityBoundary: authority(),
    }),
    event("source.review-started.v2", sourceStarted()),
    event("source.tile-delivered.v2", tileDelivered()),
    event("source.coverage-observed.v2", firstCoverage()),
    event("mask.review-started.v2", maskStarted()),
    event("mask.tile-delivered.v2", {
      ...tileDelivered(digest("mask-subject"), 4),
      coverageSegmentIdSha256: digest("mask-segment"),
    }),
    event("mask.coverage-observed.v2", {
      ...firstCoverage(),
      coverageSegmentIdSha256: digest("mask-segment"),
      subjectSha256: digest("mask-subject"),
      renderGeneration: 4,
    }),
  ];
}

describe("Grand Hall T-554 native-review v2 event schemas", () => {
  it("accepts exactly the session, source, and mask scope variants", () => {
    for (const scope of validScopes()) {
      expect(
        GrandHallT554NativeReviewJournalScopeV2Schema.safeParse(scope).success,
      ).toBe(true);
    }

    const sessionScope = validScopes()[0];
    expect(
      GrandHallT554NativeReviewJournalScopeV2Schema.safeParse({
        ...(typeof sessionScope === "object" && sessionScope !== null
          ? sessionScope
          : {}),
        arbitraryRoot: "C:/secret",
      }).success,
    ).toBe(false);

    const sourceScope = validScopes()[1];
    expect(
      GrandHallT554NativeReviewJournalScopeV2Schema.safeParse({
        ...(typeof sourceScope === "object" && sourceScope !== null
          ? sourceScope
          : {}),
        renderGeneration: 2,
      }).success,
    ).toBe(false);

    const maskScope = validScopes()[2];
    expect(
      GrandHallT554NativeReviewJournalScopeV2Schema.safeParse({
        ...(typeof maskScope === "object" && maskScope !== null
          ? maskScope
          : {}),
        frozenBinding: frozenBinding(1),
      }).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewJournalScopeV2Schema.safeParse({
        ...(typeof maskScope === "object" && maskScope !== null
          ? maskScope
          : {}),
        frozenBinding: { ...frozenBinding(), revision: 0 },
      }).success,
    ).toBe(false);
  });

  it("accepts every exact coordinator and child event mapping as one discriminated union", () => {
    for (const candidate of validEvents()) {
      expect(
        GrandHallT554NativeReviewDomainEventV2Schema.safeParse(candidate)
          .success,
      ).toBe(true);
    }

    const parsed = GrandHallT554NativeReviewDomainEventV2Schema.parse(
      event("source.tile-delivered.v2", tileDelivered()),
    );
    if (parsed.eventType !== "source.tile-delivered.v2") {
      throw new Error("event discrimination failed");
    }
    expect(parsed.payload.tileIndex).toBe(34);

    expect(
      GrandHallT554NativeReviewScopedEventV2Schema.safeParse({
        scope: validScopes()[1],
        event: event("source.tile-delivered.v2", tileDelivered()),
      }).success,
    ).toBe(true);
    expect(
      GrandHallT554NativeReviewScopedEventV2Schema.safeParse({
        scope: validScopes()[2],
        event: event("source.tile-delivered.v2", tileDelivered()),
      }).success,
    ).toBe(false);
  });

  it("rejects semantically cross-bound scopes even when their kinds match", () => {
    expect(
      GrandHallT554NativeReviewScopedEventV2Schema.safeParse({
        scope: validScopes()[0],
        event: event("session.created.v2", {
          schemaVersion:
            "venviewer.grand-hall-t554-native-review-session-created.v2",
          sessionIdSha256: digest("other-session"),
          workspaceRevision: 0,
          maximumAllocatedRenderGeneration: 0,
          registry: registry(),
          implementationManifest: implementation(),
          authorityBoundary: authority(),
        }),
      }).success,
    ).toBe(false);

    expect(
      GrandHallT554NativeReviewScopedEventV2Schema.safeParse({
        scope: validScopes()[1],
        event: event("source.tile-delivered.v2", {
          ...tileDelivered(),
          coverageSegmentIdSha256: digest("other-source-segment"),
        }),
      }).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewScopedEventV2Schema.safeParse({
        scope: validScopes()[1],
        event: event("source.review-started.v2", {
          ...sourceStarted(),
          implementationManifest: {
            ...implementation(),
            semanticSha256: digest("other-implementation"),
          },
        }),
      }).success,
    ).toBe(false);

    expect(
      GrandHallT554NativeReviewScopedEventV2Schema.safeParse({
        scope: validScopes()[2],
        event: event("mask.review-started.v2", {
          ...maskStarted(),
          frozenBinding: frozenBinding(1),
        }),
      }).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewScopedEventV2Schema.safeParse({
        scope: validScopes()[2],
        event: event("mask.coverage-observed.v2", {
          ...firstCoverage(),
          coverageSegmentIdSha256: digest("mask-segment"),
          subjectSha256: digest("other-mask-subject"),
          renderGeneration: 4,
        }),
      }).success,
    ).toBe(false);
  });

  it("rejects unknown, mismatched, extra, path-bearing, and authority-escalating shapes", () => {
    expect(
      GrandHallT554NativeReviewDomainEventV2Schema.safeParse(
        event("source.accepted.v2", { schemaVersion: "forged" }),
      ).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewDomainEventV2Schema.safeParse(
        event("source.tile-delivered.v2", sourceStarted()),
      ).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewDomainEventV2Schema.safeParse({
        ...event("source.tile-delivered.v2", tileDelivered()),
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewDomainEventV2Schema.safeParse(
        event("source.tile-delivered.v2", {
          ...tileDelivered(),
          sourcePath: "C:/secret.jpg",
        }),
      ).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewDomainEventV2Schema.safeParse(
        event("session.stopped.v2", {
          schemaVersion:
            "venviewer.grand-hall-t554-native-review-session-stopped.v2",
          browserEpochNonceSha256: digest(RAW_SESSION_NONCE),
          previousWorkspaceRevision: 0,
          resultingWorkspaceRevision: 1,
          stoppedAtUtc: CANONICAL_TIME,
          activeSourceWasPresent: false,
          authorityBoundary: { ...authority(), exportAuthorized: true },
        }),
      ).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewDomainEventV2Schema.safeParse(
        event("session.poisoned.v2", {
          schemaVersion:
            "venviewer.grand-hall-t554-native-review-session-poisoned.v2",
          browserEpochNonceSha256: digest(RAW_SESSION_NONCE),
          workspaceRevision: 0,
          maximumAllocatedRenderGeneration: 0,
          poisonedAtUtc: CANONICAL_TIME,
          reasonCode: "resource_cleanup_failed",
          authorityBoundary: { ...authority(), reconstructionAuthorized: true },
        }),
      ).success,
    ).toBe(false);

    const serialized = JSON.stringify({
      scopes: validScopes(),
      events: validEvents(),
    });
    expect(serialized).not.toContain(RAW_SESSION_NONCE);
    expect(serialized).not.toContain(RAW_SOURCE_NONCE);
    expect(serialized).not.toMatch(/[A-Za-z]:[\\/]/u);
  });

  it("enforces workspace, generation, mask CAS, and invalidation constraints", () => {
    const edit = validEvents()[6];
    if (typeof edit !== "object" || edit === null || !("payload" in edit)) {
      throw new Error("mask edit fixture missing");
    }
    const payload = edit.payload;
    if (typeof payload !== "object" || payload === null)
      throw new Error("mask edit payload missing");

    expect(
      GrandHallT554NativeReviewMaskEditedPayloadV2Schema.safeParse({
        ...payload,
        resultingWorkspaceRevision: 4,
      }).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewMaskEditedPayloadV2Schema.safeParse({
        ...payload,
        resultingRenderGeneration: 2,
      }).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewMaskEditedPayloadV2Schema.safeParse({
        ...payload,
        resultingRenderGeneration: 8,
      }).success,
    ).toBe(true);
    expect(
      GrandHallT554NativeReviewMaskEditedPayloadV2Schema.safeParse({
        ...payload,
        edit: {
          expectedRevision: 1,
          operation: "include",
          primitive: {
            kind: "rectangle",
            horizontalSeam: "none",
            leftPx: 0,
            topPx: 0,
            rightExclusivePx: 1,
            bottomExclusivePx: 1,
          },
        },
      }).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewMaskEditedPayloadV2Schema.safeParse({
        ...payload,
        invalidatedFrozenBindingSha256: digest("old-frozen"),
        invalidatedMaskJournal: null,
      }).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewMaskEditedPayloadV2Schema.safeParse({
        ...payload,
        edit: {
          expectedRevision: 0,
          operation: "include",
          reasonCode: "unverified_or_unknown_pixels",
          primitive: {
            kind: "rectangle",
            horizontalSeam: "none",
            leftPx: 0,
            topPx: 0,
            rightExclusivePx: 1,
            bottomExclusivePx: 1,
          },
        },
      }).success,
    ).toBe(false);

    const workflow = GrandHallT554NativeReviewDomainEventV2Schema.parse(
      validEvents()[5],
    );
    if (workflow.eventType !== "mask.workflow-started.v2") {
      throw new Error("mask workflow fixture drifted");
    }
    expect(
      GrandHallT554NativeReviewDomainEventV2Schema.safeParse(
        event("mask.workflow-started.v2", {
          ...workflow.payload,
          completedSourceCoverage: {
            ...workflow.payload.completedSourceCoverage,
            completedTileBitsetHex: EMPTY_BITMAP,
          },
        }),
      ).success,
    ).toBe(false);
  });

  it("validates exact frozen-mask counts, reason ordering, and paired filenames", () => {
    expect(
      GrandHallT554NativeReviewFrozenMaskBindingV2Schema.safeParse(
        frozenBinding(),
      ).success,
    ).toBe(true);
    expect(
      GrandHallT554NativeReviewFrozenMaskBindingV2Schema.safeParse({
        ...frozenBinding(),
        excludedPixelCount: PIXEL_COUNT - 2,
      }).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewFrozenMaskBindingV2Schema.safeParse({
        ...frozenBinding(),
        reasonCounts: [
          {
            reasonCode: "unverified_or_unknown_pixels",
            pixelCount: PIXEL_COUNT - 2,
          },
          { reasonCode: "adjacent_room_pixels", pixelCount: 1 },
        ],
      }).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewFrozenMaskBindingV2Schema.safeParse({
        ...frozenBinding(),
        reasonMap: {
          ...frozenBinding().reasonMap,
          fileName: frozenBinding().fileName,
        },
      }).success,
    ).toBe(false);

    const freezeIntent = GrandHallT554NativeReviewDomainEventV2Schema.parse(
      validEvents()[7],
    );
    if (freezeIntent.eventType !== "mask.freeze-intended.v2") {
      throw new Error("freeze-intent fixture drifted");
    }
    expect(
      GrandHallT554NativeReviewDomainEventV2Schema.safeParse(
        event("mask.freeze-intended.v2", {
          ...freezeIntent.payload,
          preparedBinding: {
            ...freezeIntent.payload.preparedBinding,
            publicationDurability: "directory_fsync",
          },
        }),
      ).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewDomainEventV2Schema.safeParse(
        event("mask.freeze-intended.v2", {
          ...freezeIntent.payload,
          maskState: initialMaskState(),
          preparedBinding: {
            ...preparedBinding(),
            revision: 0,
            includedPixelCount: 0,
            excludedPixelCount: PIXEL_COUNT,
            reasonCounts: [
              {
                reasonCode: "unverified_or_unknown_pixels",
                pixelCount: PIXEL_COUNT,
              },
            ],
          },
        }),
      ).success,
    ).toBe(false);
  });

  it("binds tile delivery to exact row-major coordinates and canonical server time", () => {
    expect(
      GrandHallT554NativeReviewTileDeliveredPayloadV2Schema.safeParse(
        tileDelivered(),
      ).success,
    ).toBe(true);
    expect(
      GrandHallT554NativeReviewTileDeliveredPayloadV2Schema.safeParse({
        ...tileDelivered(),
        tileIndex: 35,
      }).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewTileDeliveredPayloadV2Schema.safeParse({
        ...tileDelivered(),
        responseFinishedAtUtc: "2026-08-27T12:34:56Z",
      }).success,
    ).toBe(false);
  });

  it("forces every process-segment first sample to zero credit while allowing carried completion", () => {
    const resumedFirst = firstCoverage(bitmap([1]), 1);
    expect(resumedFirst.derived.deliveredTileBitsetHex).toBe(EMPTY_BITMAP);
    expect(
      GrandHallT554NativeReviewCoverageObservedPayloadV2Schema.safeParse(
        resumedFirst,
      ).success,
    ).toBe(true);

    expect(
      GrandHallT554NativeReviewCoverageObservedPayloadV2Schema.safeParse({
        ...resumedFirst,
        previousCoverageEventSha256: digest("forged-previous"),
      }).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewCoverageObservedPayloadV2Schema.safeParse({
        ...resumedFirst,
        derived: {
          ...resumedFirst.derived,
          creditedDurationMs: 1,
          creditedTileBitsetHex: bitmap([1]),
          disqualifier: null,
        },
      }).success,
    ).toBe(false);
  });

  it("rejects semantically impossible coverage bitsets, counts, gaps, and chains", () => {
    const first = firstCoverage();
    expect(
      GrandHallT554NativeReviewCoverageObservedPayloadV2Schema.safeParse({
        ...first,
        sequence: 1,
      }).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewCoverageObservedPayloadV2Schema.safeParse({
        ...first,
        derived: {
          ...first.derived,
          completedTileBitsetHex: bitmap([0]),
          completedTileCount: 0,
        },
      }).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewCoverageObservedPayloadV2Schema.safeParse({
        ...first,
        telemetry: { ...first.telemetry, paintedTileBitsetHex: EMPTY_BITMAP },
        derived: {
          ...first.derived,
          deliveredTileBitsetHex: bitmap([0]),
          fullyVisibleDeliveredTileBitsetHex: bitmap([0]),
        },
      }).success,
    ).toBe(false);

    const later = {
      ...first,
      sequence: 1,
      previousCoverageEventSha256: digest("coverage-event-0"),
      serverObservation: {
        ...first.serverObservation,
        monotonicElapsedMs: 1_000,
      },
      derived: {
        ...first.derived,
        serverMonotonicDeltaMs: 600,
        disqualifier: null,
      },
    };
    expect(
      GrandHallT554NativeReviewCoverageObservedPayloadV2Schema.safeParse(later)
        .success,
    ).toBe(false);
  });

  it("validates and cryptographically binds the complete 512-cell dwell carry vector", () => {
    expect(
      GrandHallT554NativeReviewCoverageCarryStateV2Schema.safeParse(
        sourceCarry(),
      ).success,
    ).toBe(true);
    expect(
      GrandHallT554NativeReviewCoverageCarryStateV2Schema.safeParse(maskCarry())
        .success,
    ).toBe(true);

    expect(
      GrandHallT554NativeReviewCoverageCarryStateV2Schema.safeParse({
        ...sourceCarry(),
        cappedDwellBytesSha256: digest("forged-dwell"),
      }).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewCoverageCarryStateV2Schema.safeParse({
        ...sourceCarry(),
        cumulativeDwellStateSha256: digest("forged-state"),
      }).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewCoverageCarryStateV2Schema.safeParse({
        ...sourceCarry(),
        cappedDwellMsUint16LeBase64url: `${sourceCarry().cappedDwellMsUint16LeBase64url}==`,
      }).success,
    ).toBe(false);

    const overCapBytes = Buffer.alloc(1_024);
    overCapBytes.writeUInt16LE(751, 0);
    expect(
      GrandHallT554NativeReviewCoverageCarryStateV2Schema.safeParse({
        ...sourceCarry(),
        cappedDwellMsUint16LeBase64url: overCapBytes.toString("base64url"),
        cappedDwellBytesSha256: digest(overCapBytes),
        cumulativeDwellStateSha256: digest(
          Buffer.concat([
            Buffer.from(
              "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_DWELL_STATE_V2\n",
              "utf8",
            ),
            overCapBytes,
          ]),
        ),
        completedTileBitsetHex: EMPTY_BITMAP,
        completedTileCount: 0,
      }).success,
    ).toBe(false);
  });

  it("requires exact resume carry, fresh segment epochs, and preserved frozen evidence", () => {
    const sourceResume = GrandHallT554NativeReviewDomainEventV2Schema.parse(
      validEvents()[10],
    );
    if (sourceResume.eventType !== "coverage.segment-resume-intended.v2") {
      throw new Error("source resume fixture drifted");
    }
    expect(sourceResume.payload.kind).toBe("source");
    expect(
      GrandHallT554NativeReviewDomainEventV2Schema.safeParse(
        event("coverage.segment-resume-intended.v2", {
          ...sourceResume.payload,
          predecessorCoverage: null,
        }),
      ).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewDomainEventV2Schema.safeParse(
        event("coverage.segment-resume-intended.v2", {
          ...sourceResume.payload,
          newSourceEpochNonceSha256:
            sourceResume.payload.sourceCustodyBefore.sourceEpochNonceSha256,
        }),
      ).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewDomainEventV2Schema.safeParse(
        event("coverage.segment-resume-intended.v2", {
          ...sourceResume.payload,
          newCoverageSegmentIdSha256:
            sourceResume.payload.predecessorCoverage
              .priorCoverageSegmentIdSha256,
        }),
      ).success,
    ).toBe(false);

    const maskResume = GrandHallT554NativeReviewDomainEventV2Schema.parse(
      validEvents()[13],
    );
    if (
      maskResume.eventType !== "coverage.segment-resume-intended.v2" ||
      maskResume.payload.kind !== "mask"
    ) {
      throw new Error("mask resume fixture drifted");
    }
    expect(
      GrandHallT554NativeReviewDomainEventV2Schema.safeParse(
        event("coverage.segment-resume-intended.v2", {
          ...maskResume.payload,
          frozenBindingSha256: digest("other-frozen-binding"),
        }),
      ).success,
    ).toBe(false);

    const editResume = GrandHallT554NativeReviewDomainEventV2Schema.parse(
      validEvents()[16],
    );
    if (editResume.eventType !== "mask.edit-epoch-resumed.v2") {
      throw new Error("mask-edit resume fixture drifted");
    }
    expect(
      GrandHallT554NativeReviewDomainEventV2Schema.safeParse(
        event("mask.edit-epoch-resumed.v2", {
          ...editResume.payload,
          sourceCustody: {
            ...editResume.payload.sourceCustody,
            sourceEpochBindingSha256:
              editResume.payload.sourceCustodyBefore.sourceEpochBindingSha256,
          },
        }),
      ).success,
    ).toBe(false);
  });

  it("blocks coverage carry across stable source, implementation, mask, or subject drift", () => {
    expect(
      GrandHallT554NativeReviewSourceReviewStartedPayloadV2Schema.safeParse(
        sourceStarted(sourceCarry()),
      ).success,
    ).toBe(true);
    expect(
      GrandHallT554NativeReviewSourceReviewStartedPayloadV2Schema.safeParse({
        ...sourceStarted(sourceCarry()),
        predecessorCoverage: {
          ...sourceCarry(),
          implementationManifest: {
            ...implementation(),
            fileSha256: digest("other-implementation"),
          },
        },
      }).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewSourceReviewStartedPayloadV2Schema.safeParse({
        ...sourceStarted(sourceCarry()),
        predecessorCoverage: {
          ...sourceCarry(),
          subjectSha256: digest("other-subject"),
        },
      }).success,
    ).toBe(false);

    expect(
      GrandHallT554NativeReviewMaskReviewStartedPayloadV2Schema.safeParse(
        maskStarted(maskCarry()),
      ).success,
    ).toBe(true);
    expect(
      GrandHallT554NativeReviewMaskReviewStartedPayloadV2Schema.safeParse({
        ...maskStarted(maskCarry()),
        predecessorCoverage: {
          ...maskCarry(),
          maskStateSha256: digest("other-mask-state"),
        },
      }).success,
    ).toBe(false);
  });

  it("rejects noncanonical hashes, bitmaps, revisions, and trusted-field injection", () => {
    const delivery = tileDelivered();
    expect(
      GrandHallT554NativeReviewTileDeliveredPayloadV2Schema.safeParse({
        ...delivery,
        subjectSha256: delivery.subjectSha256.toUpperCase(),
      }).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewCoverageObservedPayloadV2Schema.safeParse({
        ...firstCoverage(),
        telemetry: {
          ...firstCoverage().telemetry,
          paintedTileBitsetHex: "0".repeat(126),
        },
      }).success,
    ).toBe(false);
    const parsedEdit = GrandHallT554NativeReviewDomainEventV2Schema.parse(
      validEvents()[6],
    );
    if (parsedEdit.eventType !== "mask.edited.v2")
      throw new Error("mask edit fixture drifted");
    expect(
      GrandHallT554NativeReviewMaskEditedPayloadV2Schema.safeParse({
        ...parsedEdit.payload,
        resultingWorkspaceRevision: 3.5,
      }).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewDomainEventV2Schema.safeParse(
        event("mask.edited.v2", {
          schemaVersion:
            "venviewer.grand-hall-t554-native-review-mask-edited.v2",
          includedPixelCount: 1,
          maskSha256: digest("browser-claim"),
        }),
      ).success,
    ).toBe(false);
  });

  it("accepts only exact authority-none INCLUDE, EXCLUDE, and human-attestation records", () => {
    const exclude = event(
      "source.decision-recorded.v2",
      excludeDecisionPayload(),
    );
    const include = event(
      "source.decision-recorded.v2",
      includeDecisionPayload(),
    );
    const attestation = event(
      "source.human-attestation-recorded.v2",
      humanAttestationPayload(includeDecisionPayload().decisionSha256),
    );
    expect(
      GrandHallT554NativeReviewDomainEventV2Schema.safeParse(exclude).success,
    ).toBe(true);
    expect(
      GrandHallT554NativeReviewDomainEventV2Schema.safeParse(include).success,
    ).toBe(true);
    expect(
      GrandHallT554NativeReviewDomainEventV2Schema.safeParse(attestation)
        .success,
    ).toBe(true);

    const sessionScope = validScopes()[0];
    const sourceScope = validScopes()[1];
    expect(
      GrandHallT554NativeReviewScopedEventV2Schema.safeParse({
        scope: sessionScope,
        event: include,
      }).success,
    ).toBe(true);
    expect(
      GrandHallT554NativeReviewScopedEventV2Schema.safeParse({
        scope: sourceScope,
        event: include,
      }).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewScopedEventV2Schema.safeParse({
        scope: sessionScope,
        event: attestation,
      }).success,
    ).toBe(true);
  });

  it("rejects mixed decision shapes, forged completion, digest drift, and authority escalation", () => {
    const exclude = excludeDecisionPayload();
    const include = includeDecisionPayload();
    const attestation = humanAttestationPayload(include.decisionSha256);

    expect(
      GrandHallT554NativeReviewDomainEventV2Schema.safeParse(
        event("source.decision-recorded.v2", {
          ...exclude,
          result: "UNSURE",
        }),
      ).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewDomainEventV2Schema.safeParse(
        event("source.decision-recorded.v2", {
          ...exclude,
          maskState: editedMaskState(),
        }),
      ).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewDomainEventV2Schema.safeParse(
        event("source.decision-recorded.v2", {
          ...include,
          completedMaskCoverage: {
            ...include.completedMaskCoverage,
            completedTileBitsetHex: EMPTY_BITMAP,
          },
        }),
      ).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewDomainEventV2Schema.safeParse(
        event("source.decision-recorded.v2", {
          ...include,
          note: "Changed after digesting.",
        }),
      ).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewDomainEventV2Schema.safeParse(
        event("source.decision-recorded.v2", {
          ...include,
          resultingRenderGeneration: include.previousRenderGeneration,
        }),
      ).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewDomainEventV2Schema.safeParse(
        event("source.human-attestation-recorded.v2", {
          ...attestation,
          reviewerRole: "agent",
        }),
      ).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewDomainEventV2Schema.safeParse(
        event("source.human-attestation-recorded.v2", {
          ...attestation,
          knowledgeBasis: [],
        }),
      ).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewDomainEventV2Schema.safeParse(
        event("source.human-attestation-recorded.v2", {
          ...attestation,
          humanPresenceProof: "cryptographically_verified",
        }),
      ).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewDomainEventV2Schema.safeParse(
        event("source.human-attestation-recorded.v2", {
          ...attestation,
          agentDecisionAuthority: "accepted",
        }),
      ).success,
    ).toBe(false);
    expect(
      GrandHallT554NativeReviewDomainEventV2Schema.safeParse(
        event("source.human-attestation-recorded.v2", {
          ...attestation,
          localSourcePath: "F:/private/source.jpg",
        }),
      ).success,
    ).toBe(false);
  });
});
