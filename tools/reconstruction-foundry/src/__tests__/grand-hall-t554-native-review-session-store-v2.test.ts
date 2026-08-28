import { createHash } from "node:crypto";
import {
  link,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import {
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_WIDTH_PX,
} from "@omnitwin/types";
import { afterEach, describe, expect, it } from "vitest";

import {
  computeGrandHallT554NativeReviewFrozenMaskBindingV2Sha256,
  computeGrandHallT554NativeReviewFrozenMaskEvidenceV2Sha256,
  computeGrandHallT554NativeReviewMaskSubjectV2Sha256,
  computeGrandHallT554NativeReviewPreparedMaskBindingV2Sha256,
  computeGrandHallT554NativeReviewPreparedMaskEvidenceV2Sha256,
} from "../grand-hall-t554-native-review-coordinator-replay-v2.js";
import {
  createGrandHallT554NativeReviewDurableJournalV2,
  isGrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2,
  openGrandHallT554NativeReviewDurableJournalV2,
  openGrandHallT554NativeReviewVerifiedDurableChildEvidenceV2,
  type GrandHallT554NativeReviewDurableJournalReplayV2,
} from "../grand-hall-t554-native-review-durable-journal-v2.js";
import {
  GRAND_HALL_T554_NATIVE_REVIEW_DOMAIN_EVENT_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_HUMAN_ATTESTATION_STATEMENT_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_V2,
  computeGrandHallT554NativeReviewHumanAttestationV2Sha256,
  computeGrandHallT554NativeReviewSourceDecisionV2Sha256,
  type GrandHallT554NativeReviewCoordinatorEventV2,
  type GrandHallT554NativeReviewCoverageObservedPayloadV2,
  type GrandHallT554NativeReviewFrozenMaskBindingV2,
  type GrandHallT554NativeReviewMaskChildCheckpointV2,
  type GrandHallT554NativeReviewMaskChildEventV2,
  type GrandHallT554NativeReviewMaskScopeV2,
  type GrandHallT554NativeReviewSessionScopeV2,
  type GrandHallT554NativeReviewSourceChildCheckpointV2,
  type GrandHallT554NativeReviewSourceChildEventV2,
  type GrandHallT554NativeReviewSourceCustodyBindingV2,
  type GrandHallT554NativeReviewSourceScopeV2,
} from "../grand-hall-t554-native-review-events-v2.js";
import type { GrandHallT554VerifiedMaskEvidence } from "../grand-hall-t554-native-media-kernel.js";
import {
  GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_EVENT_DOMAIN,
  GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_EVENT_SCHEMA,
} from "../grand-hall-t554-native-review-journal.js";
import {
  GrandHallT554NativeMaskRevisionStore,
  type GrandHallT554NativeMaskExactStateV2,
  type GrandHallT554NativeMaskReasonCount,
} from "../grand-hall-t554-native-review-mask-store.js";
import {
  computeGrandHallT554NativeReviewCoverageEventV2Sha256,
  createGrandHallT554NativeReviewCoverageCarryStateV2,
  emptyGrandHallT554NativeReviewTileBitmapV2,
} from "../grand-hall-t554-native-review-replay-v2.js";
import {
  acquireGrandHallT554NativeReviewSessionOwnerV2,
  deriveGrandHallT554NativeReviewSessionOwnerControlDirectoryV2,
  releaseGrandHallT554NativeReviewSessionOwnerV2,
  type GrandHallT554NativeReviewSessionOwnerLeaseV2,
} from "../grand-hall-t554-native-review-session-owner-v2.js";
import {
  __testOnlyGrandHallT554NativeReviewSessionStoreV2,
  GRAND_HALL_T554_NATIVE_REVIEW_SESSION_ROOT_DESCRIPTOR_V2,
  GrandHallT554NativeReviewSessionStoreV2Error,
  openGrandHallT554NativeReviewSessionStoreV2,
} from "../grand-hall-t554-native-review-session-store-v2.js";

const roots: string[] = [];
const NOW = "2000-01-01T00:00:00.000Z";
const SOURCE_PIXEL_COUNT =
  GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX;

type Sha256 = `sha256:${string}`;
type Disposition =
  | "committed"
  | "pending_present"
  | "pending_absent"
  | "aborted_present"
  | "aborted_absent";

function digest(seed: string | Buffer): Sha256 {
  const bytes = typeof seed === "string" ? Buffer.from(seed, "utf8") : seed;
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${stableCanonicalJson(toCanonicalJson(value))}\n`, "utf8");
}

function mutableReasonCounts(
  counts: readonly GrandHallT554NativeMaskReasonCount[],
): GrandHallT554NativeMaskReasonCount[] {
  return counts.map((count) => ({ ...count }));
}

function reasonSampleCounts(
  state: GrandHallT554NativeMaskExactStateV2,
): readonly [number, number, number, number, number, number] {
  const byReason = new Map(
    state.reasonCounts.map((entry) => [entry.reasonCode, entry.pixelCount]),
  );
  return [
    state.includedPixelCount,
    byReason.get("adjacent_room_pixels") ?? 0,
    byReason.get("portal_beyond_grand_hall_plane") ?? 0,
    byReason.get("facade_or_exterior_pixels") ?? 0,
    byReason.get("capture_artifact_outside_verified_room") ?? 0,
    byReason.get("unverified_or_unknown_pixels") ?? 0,
  ];
}

async function writeCanonical(path: string, value: unknown): Promise<void> {
  await writeFile(path, canonicalBytes(value));
}

async function injectCommittedPendingResidue(
  root: string,
  leafName: string,
  removePublishedEvent: boolean,
): Promise<void> {
  const journalRoot = join(root, "children", leafName);
  const claimName = (await readdir(join(journalRoot, "claims")))[0];
  const eventName = (await readdir(join(journalRoot, "events")))[0];
  if (claimName === undefined || eventName === undefined) {
    throw new Error("fixture journal is missing its committed event pair");
  }
  const eventMatch = /^([0-9]{16})-sha256-([0-9a-f]{64})\.json$/u.exec(eventName);
  if (eventMatch === null || eventMatch[1] === undefined || eventMatch[2] === undefined) {
    throw new Error("fixture journal event name is not canonical");
  }
  await link(
    join(journalRoot, "claims", claimName),
    join(
      journalRoot,
      "pending",
      `pending-${eventMatch[1]}-sha256-${eventMatch[2]}-${"0".repeat(32)}.json`,
    ),
  );
  if (removePublishedEvent) {
    await unlink(join(journalRoot, "events", eventName));
  }
}

const authority = {
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

function artifact(seed: string) {
  return {
    semanticSha256: digest(`${seed}-semantic`),
    fileSha256: digest(`${seed}-file`),
    byteLength: 1_024,
  };
}

const registry = {
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

function implementationMaterial() {
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-implementation-manifest.v1" as const,
    implementationId:
      "grand-hall-t554-native-review-workbench-v1" as const,
    fixture: "session-store-read-only-verifier",
  };
}

function sourceIdentity() {
  return {
    inventoryIndex: 0,
    sweepNumber: 1,
    fileName: "sweep_001jpg.jpg",
    sha256: digest("source"),
    byteLength: 6_419_919,
    widthPx: GRAND_HALL_PANORAMA_WIDTH_PX as 8_192,
    heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX as 4_096,
  };
}

function custody(epochSeed = "epoch-1"): GrandHallT554NativeReviewSourceCustodyBindingV2 {
  const source = sourceIdentity();
  return {
    source,
    sourceVerification: {
      fileName: source.fileName,
      sha256: source.sha256,
      byteLength: source.byteLength,
      widthPx: source.widthPx,
      heightPx: source.heightPx,
      decodedChannelCount: 3,
      decodedBitsPerSample: 8,
      alphaPresent: false,
      orientationMetadataPresent: false,
      decodedPixelSha256: digest("decoded"),
      decoderIdentity: {
        schemaVersion:
          "venviewer.grand-hall-t554-source-jpeg-decoder-identity.v1",
        library: "sharp",
        sharpVersion: "0.35.3",
        libvipsVersion: "8.18.3",
        pipeline: "captured-jpeg-buffer-to-unrotated-rgb8.v1",
      },
      descriptorWitnessSha256: digest("descriptor"),
      sameOpenDescriptorHashedAndDecoded: true,
      fullJpegDecodeCompleted: true,
    },
    sourceReviewSubjectSha256: digest("source-subject"),
    sourceEpochBindingSha256: digest(`${epochSeed}-binding`),
    sourceEpochNonceSha256: digest(`${epochSeed}-nonce`),
    sourceEpochRenderGeneration: 1,
  };
}

function preparedMaskBinding(maskName: string, reasonName: string) {
  const source = sourceIdentity();
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-mask-prepared-binding.v2" as const,
    source,
    revision: 1,
    includedPixelCount: 1,
    excludedPixelCount: SOURCE_PIXEL_COUNT - 1,
    reasonCounts: [
      {
        reasonCode: "unverified_or_unknown_pixels" as const,
        pixelCount: SOURCE_PIXEL_COUNT - 1,
      },
    ],
    mask: {
      fileName: maskName,
      sha256: digest(`${maskName}-bytes`),
      byteLength: 9_001,
      widthPx: GRAND_HALL_PANORAMA_WIDTH_PX as 8_192,
      heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX as 4_096,
      bitDepth: 8 as const,
      channelCount: 1 as const,
      permittedPixelValues: [0, 255] satisfies [0, 255],
      zeroMeaning: "grand_hall_included" as const,
      twoHundredFiftyFiveMeaning: "excluded_or_unknown" as const,
    },
    reasonMap: {
      fileName: reasonName,
      sha256: digest(`${reasonName}-bytes`),
      byteLength: 9_002,
      widthPx: GRAND_HALL_PANORAMA_WIDTH_PX as 8_192,
      heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX as 4_096,
      bitDepth: 8 as const,
      channelCount: 1 as const,
      permittedPixelValues: [0, 1, 2, 3, 4, 5] satisfies [
        0,
        1,
        2,
        3,
        4,
        5,
      ],
      zeroMeaning: "grand_hall_included" as const,
      reasonSampleCodebook: [
        { sample: 1 as const, reasonCode: "adjacent_room_pixels" as const },
        {
          sample: 2 as const,
          reasonCode: "portal_beyond_grand_hall_plane" as const,
        },
        {
          sample: 3 as const,
          reasonCode: "facade_or_exterior_pixels" as const,
        },
        {
          sample: 4 as const,
          reasonCode: "capture_artifact_outside_verified_room" as const,
        },
        {
          sample: 5 as const,
          reasonCode: "unverified_or_unknown_pixels" as const,
        },
      ] satisfies [
        { sample: 1; reasonCode: "adjacent_room_pixels" },
        { sample: 2; reasonCode: "portal_beyond_grand_hall_plane" },
        { sample: 3; reasonCode: "facade_or_exterior_pixels" },
        {
          sample: 4;
          reasonCode: "capture_artifact_outside_verified_room";
        },
        { sample: 5; reasonCode: "unverified_or_unknown_pixels" },
      ],
    },
  };
}

function freezeIntent(
  operationSeed: string,
  maskName: string,
  reasonName: string,
): Extract<
  GrandHallT554NativeReviewCoordinatorEventV2,
  { readonly eventType: "mask.freeze-intended.v2" }
> {
  const preparedBinding = preparedMaskBinding(maskName, reasonName);
  return envelope("mask.freeze-intended.v2", {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-mask-freeze-intended.v2",
    operationIdSha256: digest(operationSeed),
    browserEpochNonceSha256: digest("browser-1"),
    expectedWorkspaceRevision: 3,
    sourceCustody: custody(),
    previousRenderGeneration: 3,
    allocatedRenderGeneration: 4,
    maskState: {
      revision: 1,
      maskStateSha256: digest(`${operationSeed}-mask-state`),
      includedPixelCount: 1,
      excludedPixelCount: SOURCE_PIXEL_COUNT - 1,
      reasonCounts: preparedBinding.reasonCounts,
    },
    maskReviewSubjectSha256: digest(`${operationSeed}-mask-subject`),
    coverageSegmentIdSha256: digest(`${operationSeed}-segment`),
    preparedBindingSha256: digest(`${operationSeed}-prepared`),
    preparedBinding,
    childJournalLeafName: `${operationSeed}-child`,
  });
}

function freezeAbort(
  operationSeed: string,
  disposition: "none" | "mask_only" | "reason_map_only" | "mask_and_reason_map",
): Extract<
  GrandHallT554NativeReviewCoordinatorEventV2,
  { readonly eventType: "mask.freeze-recovery-aborted.v2" }
> {
  return envelope("mask.freeze-recovery-aborted.v2", {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-mask-freeze-recovery-aborted.v2",
    operationIdSha256: digest(operationSeed),
    browserEpochNonceSha256: digest("browser-2"),
    workspaceRevision: 3,
    consumedRenderGeneration: 4,
    publicationDisposition: disposition,
    abandonedMaskJournal: null,
  });
}

function envelope<const EventType extends string, const Payload>(eventType: EventType, payload: Payload) {
  return {
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_DOMAIN_EVENT_V2 as typeof GRAND_HALL_T554_NATIVE_REVIEW_DOMAIN_EVENT_V2,
    eventType,
    payload,
  };
}

function sourceDeliveryEvent(
  scope: GrandHallT554NativeReviewSourceScopeV2,
  tileIndex = 0,
) {
  return envelope("source.tile-delivered.v2", {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-tile-delivered.v2" as const,
    browserEpochNonceSha256: scope.browserEpochNonceSha256,
    sourceEpochNonceSha256: scope.sourceCustody.sourceEpochNonceSha256,
    coverageSegmentIdSha256: scope.coverageSegmentIdSha256,
    subjectSha256: scope.sourceCustody.sourceReviewSubjectSha256,
    renderGeneration: scope.renderGeneration,
    column: tileIndex % 32,
    row: Math.floor(tileIndex / 32),
    tileIndex,
    responseFinishedAtUtc: "2000-01-01T00:00:00.001Z",
  });
}

function firstSourceCoverageEvent(
  scope: GrandHallT554NativeReviewSourceScopeV2,
) {
  const emptyBitmap = emptyGrandHallT554NativeReviewTileBitmapV2();
  const dwellBytes = Buffer.alloc(1_024);
  const cumulativeDwellStateSha256 = digest(
    Buffer.concat([
      Buffer.from(
        "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_DWELL_STATE_V2\n",
        "utf8",
      ),
      dwellBytes,
    ]),
  );
  dwellBytes.fill(0);
  const material: Omit<
    GrandHallT554NativeReviewCoverageObservedPayloadV2,
    "coverageEventSha256"
  > = {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-coverage-observed.v2",
    browserEpochNonceSha256: scope.browserEpochNonceSha256,
    sourceEpochNonceSha256: scope.sourceCustody.sourceEpochNonceSha256,
    coverageSegmentIdSha256: scope.coverageSegmentIdSha256,
    subjectSha256: scope.sourceCustody.sourceReviewSubjectSha256,
    renderGeneration: scope.renderGeneration,
    sequence: 0,
    previousCoverageEventSha256: null,
    serverObservation: {
      receivedAtUtc: "2000-01-01T00:00:00.001Z",
      monotonicElapsedMs: 0,
    },
    telemetry: {
      documentVisibilityState: "visible",
      documentFocusState: "focused",
      viewportCssWidth: GRAND_HALL_PANORAMA_WIDTH_PX,
      viewportCssHeight: GRAND_HALL_PANORAMA_HEIGHT_PX,
      devicePixelRatio: 1,
      sourceToCssTransform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      paintedTileBitsetHex: emptyBitmap,
    },
    derived: {
      effectiveDevicePixelsPerSourcePixel: 1,
      serverMonotonicDeltaMs: 0,
      deliveredTileBitsetHex: emptyBitmap,
      fullyVisibleDeliveredTileBitsetHex: emptyBitmap,
      creditedTileBitsetHex: emptyBitmap,
      creditedDurationMs: 0,
      disqualifier: "first_sample",
      completedTileBitsetHex: emptyBitmap,
      completedTileCount: 0,
      cumulativeDwellStateSha256,
    },
  };
  return envelope("source.coverage-observed.v2", {
    ...material,
    coverageEventSha256:
      computeGrandHallT554NativeReviewCoverageEventV2Sha256(
        "source",
        material,
      ),
  });
}

function completeSourceCoverageEvents(
  scope: GrandHallT554NativeReviewSourceScopeV2,
): readonly GrandHallT554NativeReviewSourceChildEventV2[] {
  const fullBitmap = "ff".repeat(64);
  const delivered = Array.from(
    { length: 512 },
    (_, tileIndex) => sourceDeliveryEvent(scope, tileIndex),
  );
  const zeroDwell = Buffer.alloc(1_024);
  const partialDwell = Buffer.alloc(1_024);
  const fullDwell = Buffer.alloc(1_024);
  for (let index = 0; index < 512; index += 1) {
    partialDwell.writeUInt16LE(500, index * 2);
    fullDwell.writeUInt16LE(750, index * 2);
  }
  const dwellDigest = (bytes: Buffer): Sha256 =>
    digest(
      Buffer.concat([
        Buffer.from(
          "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_DWELL_STATE_V2\n",
          "utf8",
        ),
        bytes,
      ]),
    );
  const firstMaterial: Omit<
    GrandHallT554NativeReviewCoverageObservedPayloadV2,
    "coverageEventSha256"
  > = {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-coverage-observed.v2",
    browserEpochNonceSha256: scope.browserEpochNonceSha256,
    sourceEpochNonceSha256: scope.sourceCustody.sourceEpochNonceSha256,
    coverageSegmentIdSha256: scope.coverageSegmentIdSha256,
    subjectSha256: scope.sourceCustody.sourceReviewSubjectSha256,
    renderGeneration: scope.renderGeneration,
    sequence: 0,
    previousCoverageEventSha256: null,
    serverObservation: {
      receivedAtUtc: "2000-01-01T00:00:00.002Z",
      monotonicElapsedMs: 0,
    },
    telemetry: {
      documentVisibilityState: "visible",
      documentFocusState: "focused",
      viewportCssWidth: GRAND_HALL_PANORAMA_WIDTH_PX,
      viewportCssHeight: GRAND_HALL_PANORAMA_HEIGHT_PX,
      devicePixelRatio: 1,
      sourceToCssTransform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      paintedTileBitsetHex: fullBitmap,
    },
    derived: {
      effectiveDevicePixelsPerSourcePixel: 1,
      serverMonotonicDeltaMs: 0,
      deliveredTileBitsetHex: fullBitmap,
      fullyVisibleDeliveredTileBitsetHex: fullBitmap,
      creditedTileBitsetHex: emptyGrandHallT554NativeReviewTileBitmapV2(),
      creditedDurationMs: 0,
      disqualifier: "first_sample",
      completedTileBitsetHex: emptyGrandHallT554NativeReviewTileBitmapV2(),
      completedTileCount: 0,
      cumulativeDwellStateSha256: dwellDigest(zeroDwell),
    },
  };
  const firstPayload: GrandHallT554NativeReviewCoverageObservedPayloadV2 = {
    ...firstMaterial,
    coverageEventSha256:
      computeGrandHallT554NativeReviewCoverageEventV2Sha256(
        "source",
        firstMaterial,
      ),
  };
  const partialMaterial: Omit<
    GrandHallT554NativeReviewCoverageObservedPayloadV2,
    "coverageEventSha256"
  > = {
    ...firstMaterial,
    sequence: 1,
    previousCoverageEventSha256: firstPayload.coverageEventSha256,
    serverObservation: {
      receivedAtUtc: "2000-01-01T00:00:00.502Z",
      monotonicElapsedMs: 500,
    },
    derived: {
      effectiveDevicePixelsPerSourcePixel: 1,
      serverMonotonicDeltaMs: 500,
      deliveredTileBitsetHex: fullBitmap,
      fullyVisibleDeliveredTileBitsetHex: fullBitmap,
      creditedTileBitsetHex: fullBitmap,
      creditedDurationMs: 500,
      disqualifier: null,
      completedTileBitsetHex: emptyGrandHallT554NativeReviewTileBitmapV2(),
      completedTileCount: 0,
      cumulativeDwellStateSha256: dwellDigest(partialDwell),
    },
  };
  const partialPayload: GrandHallT554NativeReviewCoverageObservedPayloadV2 = {
    ...partialMaterial,
    coverageEventSha256:
      computeGrandHallT554NativeReviewCoverageEventV2Sha256(
        "source",
        partialMaterial,
      ),
  };
  const finalMaterial: Omit<
    GrandHallT554NativeReviewCoverageObservedPayloadV2,
    "coverageEventSha256"
  > = {
    ...partialMaterial,
    sequence: 2,
    previousCoverageEventSha256: partialPayload.coverageEventSha256,
    serverObservation: {
      receivedAtUtc: "2000-01-01T00:00:00.752Z",
      monotonicElapsedMs: 750,
    },
    derived: {
      effectiveDevicePixelsPerSourcePixel: 1,
      serverMonotonicDeltaMs: 250,
      deliveredTileBitsetHex: fullBitmap,
      fullyVisibleDeliveredTileBitsetHex: fullBitmap,
      creditedTileBitsetHex: fullBitmap,
      creditedDurationMs: 250,
      disqualifier: null,
      completedTileBitsetHex: fullBitmap,
      completedTileCount: 512,
      cumulativeDwellStateSha256: dwellDigest(fullDwell),
    },
  };
  zeroDwell.fill(0);
  partialDwell.fill(0);
  fullDwell.fill(0);
  return [
    ...delivered,
    envelope("source.coverage-observed.v2", firstPayload),
    envelope("source.coverage-observed.v2", partialPayload),
    envelope("source.coverage-observed.v2", {
      ...finalMaterial,
      coverageEventSha256:
        computeGrandHallT554NativeReviewCoverageEventV2Sha256(
          "source",
          finalMaterial,
        ),
    }),
  ];
}

function completeMaskCoverageEvents(
  scope: GrandHallT554NativeReviewMaskScopeV2,
): readonly GrandHallT554NativeReviewMaskChildEventV2[] {
  const sourceLikeScope: GrandHallT554NativeReviewSourceScopeV2 = {
    schemaVersion: scope.schemaVersion,
    kind: "source",
    sessionIdSha256: scope.sessionIdSha256,
    implementationManifest: scope.implementationManifest,
    registry: scope.registry,
    authorityBoundary: scope.authorityBoundary,
    browserEpochNonceSha256: scope.browserEpochNonceSha256,
    coverageSegmentIdSha256: scope.coverageSegmentIdSha256,
    renderGeneration: scope.renderGeneration,
    sourceCustody: {
      ...scope.sourceCustody,
      sourceReviewSubjectSha256: scope.maskReviewSubjectSha256,
    },
  };
  let previousCoverageEventSha256: Sha256 | null = null;
  return completeSourceCoverageEvents(sourceLikeScope).map((event) => {
    if (event.eventType === "source.tile-delivered.v2") {
      return envelope("mask.tile-delivered.v2", event.payload);
    }
    if (event.eventType !== "source.coverage-observed.v2") {
      throw new Error(
        "complete source fixture emitted an unexpected start event",
      );
    }
    const { coverageEventSha256: _sourceDigest, ...sourceMaterial } =
      event.payload;
    const material = {
      ...sourceMaterial,
      previousCoverageEventSha256,
    };
    const coverageEventSha256 =
      computeGrandHallT554NativeReviewCoverageEventV2Sha256("mask", material);
    previousCoverageEventSha256 = coverageEventSha256;
    return envelope("mask.coverage-observed.v2", {
      ...material,
      coverageEventSha256,
    });
  });
}

async function bulkAppendExactChildFixture(input: {
  readonly journalRoot: string;
  readonly start: GrandHallT554NativeReviewDurableJournalReplayV2;
  readonly scope:
    | GrandHallT554NativeReviewSourceScopeV2
    | GrandHallT554NativeReviewMaskScopeV2;
  readonly events: readonly (
    | GrandHallT554NativeReviewSourceChildEventV2
    | GrandHallT554NativeReviewMaskChildEventV2
  )[];
}): Promise<void> {
  const recordedAtUtc = input.start.records.at(-1)?.recordedAtUtc;
  if (recordedAtUtc === undefined) {
    throw new Error("bulk fixture requires one durable start record");
  }
  let previousEventSha256 = input.start.headEventSha256;
  const files = input.events.map((event, offset) => {
    const sequence = input.start.revision + offset + 1;
    const material = {
      schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_EVENT_SCHEMA,
      sequence,
      previousEventSha256,
      scope: input.start.lowLevelScope,
      scopeSha256: input.start.lowLevelScopeSha256,
      scopeFileSha256: input.start.lowLevelScopeFileSha256,
      recordedAtUtc,
      eventType: event.eventType,
      payload: toCanonicalJson({
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-durable-scoped-event.v2",
        scopedEvent: { scope: input.scope, event },
      }),
    };
    const eventSha256 = `sha256:${domainSeparatedSha256(
      GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_EVENT_DOMAIN,
      toCanonicalJson(material),
    )}` as const;
    previousEventSha256 = eventSha256;
    return {
      claimName: `${String(sequence).padStart(16, "0")}.json`,
      eventName: `${String(sequence).padStart(16, "0")}-${eventSha256.replace(":", "-")}.json`,
      bytes: canonicalBytes({ ...material, eventSha256 }),
    };
  });
  for (let offset = 0; offset < files.length; offset += 64) {
    await Promise.all(
      files.slice(offset, offset + 64).map(async (file) => {
        const claimPath = join(input.journalRoot, "claims", file.claimName);
        await writeFile(claimPath, file.bytes, { flag: "wx" });
        await link(
          claimPath,
          join(input.journalRoot, "events", file.eventName),
        );
      }),
    );
  }
}

interface Fixture {
  readonly root: string;
  readonly scope: GrandHallT554NativeReviewSessionScopeV2;
  readonly leafName: string;
  readonly sourceScope: GrandHallT554NativeReviewSourceScopeV2;
  readonly lease: GrandHallT554NativeReviewSessionOwnerLeaseV2;
}

async function fixture(options: {
  readonly disposition?: Disposition;
  readonly forgedCheckpoint?: boolean;
  readonly forgedMaskState?: boolean;
  readonly completedSource?: boolean;
  readonly completedWorkflow?: boolean;
} = {}): Promise<Fixture> {
  const disposition = options.disposition ?? "committed";
  const root = await mkdtemp(join(tmpdir(), "t554-session-store-v2-"));
  roots.push(root);
  const coordinatorRoot = join(root, "coordinator");
  const childScopesRoot = join(root, "child-scopes");
  const childrenRoot = join(root, "children");
  const maskEvidenceRoot = join(root, "mask-evidence");
  await Promise.all([
    mkdir(coordinatorRoot),
    mkdir(childScopesRoot),
    mkdir(childrenRoot),
    mkdir(maskEvidenceRoot),
  ]);

  const manifestMaterial = implementationMaterial();
  const semanticSha256 = `sha256:${domainSeparatedSha256(
    "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_V1",
    toCanonicalJson(manifestMaterial),
  )}` as const;
  const manifest = { ...manifestMaterial, semanticSha256 };
  const manifestBytes = canonicalBytes(manifest);
  const implementation = {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-implementation-manifest-binding.v2" as const,
    implementationId:
      "grand-hall-t554-native-review-workbench-v1" as const,
    semanticSha256,
    fileSha256: digest(manifestBytes),
    byteLength: manifestBytes.length,
  };
  const scope: GrandHallT554NativeReviewSessionScopeV2 = {
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_V2,
    kind: "session",
    sessionIdSha256: digest("session"),
    subjectSha256: digest("session-subject"),
    implementationManifest: implementation,
    registry,
    authorityBoundary: authority,
  };
  await writeFile(
    join(root, "grand-hall-t554-native-review-implementation-manifest.json"),
    manifestBytes,
  );
  await writeCanonical(join(root, "session-root.json"), {
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_SESSION_ROOT_DESCRIPTOR_V2,
    sessionScope: scope,
    implementationManifestFileName:
      "grand-hall-t554-native-review-implementation-manifest.json",
    coordinatorDirectoryName: "coordinator",
    childScopesDirectoryName: "child-scopes",
    childrenDirectoryName: "children",
    maskEvidenceDirectoryName: "mask-evidence",
  });

  const leafName = "source-child-0001";
  const browser = digest("browser-1");
  const segment = digest("source-segment-1");
  const sourceCustody = custody();
  const sourceScope: GrandHallT554NativeReviewSourceScopeV2 = {
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_V2,
    kind: "source",
    sessionIdSha256: scope.sessionIdSha256,
    implementationManifest: implementation,
    registry,
    authorityBoundary: authority,
    browserEpochNonceSha256: browser,
    coverageSegmentIdSha256: segment,
    renderGeneration: 1,
    sourceCustody,
  };
  const childPresent =
    disposition === "committed" ||
    disposition === "pending_present" ||
    disposition === "aborted_present";
  let checkpoint: GrandHallT554NativeReviewSourceChildCheckpointV2 | null = null;
  let completedCoverage: {
    readonly sourceJournal: GrandHallT554NativeReviewSourceChildCheckpointV2;
    readonly completedTileBitsetHex: string;
    readonly completedTileCount: number;
    readonly cumulativeDwellStateSha256: Sha256;
  } | null = null;
  if (childPresent) {
    const childRoot = join(childrenRoot, leafName);
    await mkdir(childRoot);
    const child = await createGrandHallT554NativeReviewDurableJournalV2({
      workspaceRoot: childRoot,
      scope: sourceScope,
    });
    const startReplay = await child.append({
      expectedRevision: 0,
      event: envelope("source.review-started.v2", {
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-source-review-started.v2",
        browserEpochNonceSha256: browser,
        coverageSegmentIdSha256: segment,
        coverageSegmentStartedAtUtc: NOW,
        firstSampleMustCreditZero: true,
        renderGeneration: 1,
        sourceCustody,
        registry,
        implementationManifest: implementation,
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
        authorityBoundary: authority,
      }),
    });
    const evidence =
      await openGrandHallT554NativeReviewVerifiedDurableChildEvidenceV2({
        workspaceRoot: childRoot,
        expectedScope: sourceScope,
      });
    if (evidence.checkpoint.kind !== "source") {
      throw new Error("source fixture produced a non-source checkpoint");
    }
    checkpoint = evidence.checkpoint;
    if (
      options.completedSource === true ||
      options.completedWorkflow === true
    ) {
      const coverageEvents = completeSourceCoverageEvents(sourceScope);
      await bulkAppendExactChildFixture({
        journalRoot: childRoot,
        start: startReplay,
        scope: sourceScope,
        events: coverageEvents,
      });
      const completeEvidence =
        await openGrandHallT554NativeReviewVerifiedDurableChildEvidenceV2({
          workspaceRoot: childRoot,
          expectedScope: sourceScope,
        });
      if (completeEvidence.kind !== "source") {
        throw new Error("complete fixture produced a non-source child");
      }
      const carry =
        createGrandHallT554NativeReviewCoverageCarryStateV2(completeEvidence);
      if (carry.kind !== "source") {
        throw new Error("complete fixture produced a non-source carry");
      }
      completedCoverage = {
        sourceJournal: completeEvidence.checkpoint,
        completedTileBitsetHex: carry.completedTileBitsetHex,
        completedTileCount: carry.completedTileCount,
        cumulativeDwellStateSha256: carry.cumulativeDwellStateSha256,
      };
    }
    await writeCanonical(join(childScopesRoot, `${leafName}.json`), {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-child-scope-descriptor.v2",
      leafName,
      scope: sourceScope,
    });
  }

  const coordinator = await createGrandHallT554NativeReviewDurableJournalV2({
    workspaceRoot: coordinatorRoot,
    scope,
  });
  const events: GrandHallT554NativeReviewCoordinatorEventV2[] = [
    envelope("session.created.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-session-created.v2",
      sessionIdSha256: scope.sessionIdSha256,
      workspaceRevision: 0,
      maximumAllocatedRenderGeneration: 0,
      registry,
      implementationManifest: implementation,
      authorityBoundary: authority,
    }),
    envelope("session.browser-epoch-started.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-browser-epoch-started.v2",
      browserEpochNumber: 1,
      browserEpochNonceSha256: browser,
      previousBrowserEpochNonceSha256: null,
      reason: "session_created",
      priorActiveSourceJournal: null,
      priorActiveMaskJournal: null,
      workspaceRevision: 0,
      maximumAllocatedRenderGeneration: 0,
      startedAtUtc: NOW,
    }),
    envelope("source.selection-intended.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-source-selection-intended.v2",
      operationIdSha256: digest("select-operation"),
      browserEpochNonceSha256: browser,
      expectedWorkspaceRevision: 0,
      source: sourceCustody.source,
      preparedSourceCustody: sourceCustody,
      sourceEpochNonceSha256: sourceCustody.sourceEpochNonceSha256,
      coverageSegmentIdSha256: segment,
      previousRenderGeneration: 0,
      allocatedRenderGeneration: 1,
      childJournalLeafName: leafName,
      priorActiveSourceJournal: null,
    }),
  ];
  if (disposition === "committed") {
    if (checkpoint === null) throw new Error("committed fixture child absent");
    events.push(
      envelope("source.selection-committed.v2", {
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-source-selection-committed.v2",
        operationIdSha256: digest("select-operation"),
        browserEpochNonceSha256: browser,
        coverageSegmentIdSha256: segment,
        previousWorkspaceRevision: 0,
        resultingWorkspaceRevision: 1,
        renderGeneration: 1,
        sourceCustody,
        sourceJournal: options.forgedCheckpoint === true
          ? { ...checkpoint, headEventSha256: digest("forged-head") }
          : checkpoint,
      }),
    );
  } else if (disposition === "aborted_present") {
    if (checkpoint === null) throw new Error("aborted-present child absent");
    events.push(
      envelope("source.selection-recovery-aborted.v2", {
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-source-selection-recovery-aborted.v2",
        operationIdSha256: digest("select-operation"),
        browserEpochNonceSha256: browser,
        workspaceRevision: 0,
        consumedRenderGeneration: 1,
        recovery: {
          childDisposition: "exact_abandoned",
          abandonedChildJournal: checkpoint,
        },
      }),
    );
  } else if (disposition === "aborted_absent") {
    events.push(
      envelope("source.selection-recovery-aborted.v2", {
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-source-selection-recovery-aborted.v2",
        operationIdSha256: digest("select-operation"),
        browserEpochNonceSha256: browser,
        workspaceRevision: 0,
        consumedRenderGeneration: 1,
        recovery: {
          childDisposition: "absent",
          abandonedChildJournal: null,
        },
      }),
    );
  }

  if (completedCoverage !== null && options.completedWorkflow === true) {
    if (disposition !== "committed") {
      throw new Error("completed workflow fixture requires a committed source");
    }
    const stableContext = {
      schemaVersion:
        "venviewer.grand-hall-t554-native-mask-replay-context.v2" as const,
      sessionIdSha256: scope.sessionIdSha256,
      registry,
      implementationManifest: implementation,
      source: sourceCustody.source,
      sourceVerification: sourceCustody.sourceVerification,
      sourceReviewSubjectSha256: sourceCustody.sourceReviewSubjectSha256,
    };
    const maskStore =
      GrandHallT554NativeMaskRevisionStore.createReplayOnly(sourceCustody.source);
    const initialExact = maskStore.exactStateV2(stableContext);
    maskStore.abandon();
    events.push(
      envelope("mask.workflow-started.v2", {
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-mask-workflow-started.v2",
        browserEpochNonceSha256: browser,
        previousWorkspaceRevision: 1,
        resultingWorkspaceRevision: 2,
        sourceCustody,
        previousRenderGeneration: 1,
        resultingRenderGeneration: 2,
        completedSourceCoverage: {
          schemaVersion:
            "venviewer.grand-hall-t554-native-review-completed-source-coverage.v2",
          sourceReviewSubjectSha256:
            sourceCustody.sourceReviewSubjectSha256,
          ...completedCoverage,
        },
        initialMaskState: {
          revision: initialExact.revision,
          maskStateSha256: initialExact.maskStateSha256,
          includedPixelCount: initialExact.includedPixelCount,
          excludedPixelCount: initialExact.excludedPixelCount,
          reasonCounts: mutableReasonCounts(initialExact.reasonCounts),
        },
      }),
    );
  }

  if (options.forgedMaskState === true) {
    if (checkpoint === null || disposition !== "committed") {
      throw new Error("mask forgery fixture requires a committed child");
    }
    const context = {
      schemaVersion:
        "venviewer.grand-hall-t554-native-mask-replay-context.v2" as const,
      sessionIdSha256: scope.sessionIdSha256,
      registry,
      implementationManifest: implementation,
      sourceCustody,
      sourceReviewSubjectSha256: sourceCustody.sourceReviewSubjectSha256,
    };
    const store = new GrandHallT554NativeMaskRevisionStore({
      source: sourceCustody.source,
      publicationDirectory: join(root, "mask-evidence", ".unused"),
    });
    const initialExact = store.exactStateV2(context);
    const initial = {
      revision: initialExact.revision,
      maskStateSha256: initialExact.maskStateSha256,
      includedPixelCount: initialExact.includedPixelCount,
      excludedPixelCount: initialExact.excludedPixelCount,
      reasonCounts: mutableReasonCounts(initialExact.reasonCounts),
    };
    const edit = {
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
    };
    store.applyEdit(edit);
    const exact = store.exactStateV2(context);
    store.abandon();
    events.push(
      envelope("mask.workflow-started.v2", {
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-mask-workflow-started.v2",
        browserEpochNonceSha256: browser,
        previousWorkspaceRevision: 1,
        resultingWorkspaceRevision: 2,
        sourceCustody,
        previousRenderGeneration: 1,
        resultingRenderGeneration: 2,
        completedSourceCoverage: {
          schemaVersion:
            "venviewer.grand-hall-t554-native-review-completed-source-coverage.v2",
          sourceReviewSubjectSha256:
            sourceCustody.sourceReviewSubjectSha256,
          sourceJournal: checkpoint,
          completedTileBitsetHex: "ff".repeat(64),
          completedTileCount: 512,
          cumulativeDwellStateSha256: digest("completed-dwell"),
        },
        initialMaskState: initial,
      }),
      envelope("mask.edited.v2", {
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-mask-edited.v2",
        operationIdSha256: digest("mask-edit"),
        browserEpochNonceSha256: browser,
        previousWorkspaceRevision: 2,
        resultingWorkspaceRevision: 3,
        sourceCustody,
        previousRenderGeneration: 2,
        resultingRenderGeneration: 3,
        edit,
        previousMaskState: initial,
        resultingMaskState: {
          revision: exact.revision,
          maskStateSha256: digest("forged-mask-state"),
          includedPixelCount: exact.includedPixelCount,
          excludedPixelCount: exact.excludedPixelCount,
          reasonCounts: mutableReasonCounts(exact.reasonCounts),
        },
        invalidatedFrozenBindingSha256: null,
        invalidatedMaskJournal: null,
      }),
    );
  }
  let revision = 0;
  for (const event of events) {
    await coordinator.append({ expectedRevision: revision, event });
    revision += 1;
  }
  const lease = await acquireGrandHallT554NativeReviewSessionOwnerV2({
    sessionRoot: root,
    expectedSessionScope: scope,
  });
  return { root, scope, leafName, sourceScope, lease };
}

async function sourceDecisionProofFixture(complete: boolean) {
  const root = await mkdtemp(join(tmpdir(), "t554-source-proof-v2-"));
  roots.push(root);
  const implementation = {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-implementation-manifest-binding.v2" as const,
    implementationId: "grand-hall-t554-native-review-workbench-v1" as const,
    semanticSha256: digest("source-proof-implementation-semantic"),
    fileSha256: digest("source-proof-implementation-file"),
    byteLength: 8_192,
  };
  const sessionScope: GrandHallT554NativeReviewSessionScopeV2 = {
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_V2,
    kind: "session",
    sessionIdSha256: digest("source-proof-session"),
    subjectSha256: digest("source-proof-session-subject"),
    implementationManifest: implementation,
    registry,
    authorityBoundary: authority,
  };
  const sourceCustody = custody("source-proof-epoch");
  const browserEpochNonceSha256 = digest("source-proof-browser");
  const coverageSegmentIdSha256 = digest("source-proof-segment");
  const sourceScope: GrandHallT554NativeReviewSourceScopeV2 = {
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_V2,
    kind: "source",
    sessionIdSha256: sessionScope.sessionIdSha256,
    implementationManifest: implementation,
    registry,
    authorityBoundary: authority,
    browserEpochNonceSha256,
    coverageSegmentIdSha256,
    renderGeneration: 1,
    sourceCustody,
  };
  const leafName = "source-proof-child";
  const journalRoot = join(root, leafName);
  await mkdir(journalRoot);
  const journal = await createGrandHallT554NativeReviewDurableJournalV2({
    workspaceRoot: journalRoot,
    scope: sourceScope,
  });
  const start = await journal.append({
    expectedRevision: 0,
    event: envelope("source.review-started.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-source-review-started.v2" as const,
      browserEpochNonceSha256,
      coverageSegmentIdSha256,
      coverageSegmentStartedAtUtc: NOW,
      firstSampleMustCreditZero: true as const,
      renderGeneration: 1,
      sourceCustody,
      registry,
      implementationManifest: implementation,
      tileGrid: {
        widthPx: 256 as const,
        heightPx: 256 as const,
        columnCount: 32 as const,
        rowCount: 16 as const,
        channelCount: 3 as const,
        bytesPerTile: 196_608 as const,
        resampling: "none" as const,
      },
      predecessorCoverage: null,
      authorityBoundary: authority,
    }),
  });
  if (complete) {
    await bulkAppendExactChildFixture({
      journalRoot,
      start,
      scope: sourceScope,
      events: completeSourceCoverageEvents(sourceScope),
    });
  }
  const evidence =
    await openGrandHallT554NativeReviewVerifiedDurableChildEvidenceV2({
      workspaceRoot: journalRoot,
      expectedScope: sourceScope,
    });
  if (evidence.kind !== "source") {
    throw new Error("source proof fixture produced a non-source child");
  }
  const sourceCoverage = complete
    ? createGrandHallT554NativeReviewCoverageCarryStateV2(evidence)
    : null;
  if (sourceCoverage !== null && sourceCoverage.kind !== "source") {
    throw new Error("source proof fixture produced a non-source carry");
  }
  const material = {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-source-decision-recorded.v2" as const,
    operationIdSha256: digest("source-proof-decision-operation"),
    browserEpochNonceSha256,
    previousWorkspaceRevision: 1,
    resultingWorkspaceRevision: 2,
    sessionIdSha256: sessionScope.sessionIdSha256,
    registry,
    implementationManifest: implementation,
    authorityBoundary: authority,
    sourceCustody,
    previousRenderGeneration: 1,
    resultingRenderGeneration: 2,
    completedSourceCoverage: {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-completed-source-coverage.v2" as const,
      sourceReviewSubjectSha256: sourceCustody.sourceReviewSubjectSha256,
      sourceJournal: evidence.checkpoint,
      completedTileBitsetHex: "ff".repeat(64),
      completedTileCount: 512 as const,
      cumulativeDwellStateSha256:
        sourceCoverage?.cumulativeDwellStateSha256 ??
        digest("forged-source-completed-dwell"),
    },
    note: "Native review found no observed Grand Hall pixels.",
    decidedAtUtc: new Date().toISOString(),
    result: "EXCLUDE" as const,
    classification: "no_observed_grand_hall_pixels" as const,
    maskState: null,
    maskReviewSubjectSha256: null,
    frozenBindingSha256: null,
    frozenBinding: null,
    completedMaskCoverage: null,
  };
  const decision = envelope("source.decision-recorded.v2", {
    ...material,
    decisionSha256:
      computeGrandHallT554NativeReviewSourceDecisionV2Sha256(material),
  });
  return {
    sessionScope,
    sourceScope,
    evidence,
    decision,
    leafName,
  };
}

async function maskDecisionProofFixture(complete: boolean) {
  const root = await mkdtemp(join(tmpdir(), "t554-mask-proof-v2-"));
  roots.push(root);
  const implementation = {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-implementation-manifest-binding.v2" as const,
    implementationId: "grand-hall-t554-native-review-workbench-v1" as const,
    semanticSha256: digest("mask-proof-implementation-semantic"),
    fileSha256: digest("mask-proof-implementation-file"),
    byteLength: 8_192,
  };
  const sessionScope: GrandHallT554NativeReviewSessionScopeV2 = {
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_V2,
    kind: "session",
    sessionIdSha256: digest("mask-proof-session"),
    subjectSha256: digest("mask-proof-session-subject"),
    implementationManifest: implementation,
    registry,
    authorityBoundary: authority,
  };
  const sourceCustody = custody("mask-proof-epoch");
  const replayContext = {
    schemaVersion:
      "venviewer.grand-hall-t554-native-mask-replay-context.v2" as const,
    sessionIdSha256: sessionScope.sessionIdSha256,
    registry,
    implementationManifest: implementation,
    source: sourceCustody.source,
    sourceVerification: sourceCustody.sourceVerification,
    sourceReviewSubjectSha256: sourceCustody.sourceReviewSubjectSha256,
  };
  const maskStore = GrandHallT554NativeMaskRevisionStore.createReplayOnly(
    sourceCustody.source,
  );
  maskStore.applyEdit({
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
  });
  const exactMaskState = maskStore.exactStateV2(replayContext);
  maskStore.abandon();
  const maskState = {
    revision: exactMaskState.revision,
    maskStateSha256: exactMaskState.maskStateSha256,
    includedPixelCount: exactMaskState.includedPixelCount,
    excludedPixelCount: exactMaskState.excludedPixelCount,
    reasonCounts: mutableReasonCounts(exactMaskState.reasonCounts),
  };
  const prepared = preparedMaskBinding(
    "mask-proof.png",
    "mask-proof-reasons.png",
  );
  const maskReviewSubjectSha256 =
    computeGrandHallT554NativeReviewMaskSubjectV2Sha256({
      sourceReviewSubjectSha256: sourceCustody.sourceReviewSubjectSha256,
      maskStateSha256: maskState.maskStateSha256,
      maskEvidenceSha256:
        computeGrandHallT554NativeReviewPreparedMaskEvidenceV2Sha256(prepared),
      implementationManifest: implementation,
    });
  const frozen = {
    schemaVersion:
      "venviewer.grand-hall-t554-native-mask-frozen-binding.v2" as const,
    source: prepared.source,
    revision: prepared.revision,
    fileName: prepared.mask.fileName,
    sha256: prepared.mask.sha256,
    byteLength: prepared.mask.byteLength,
    widthPx: prepared.mask.widthPx,
    heightPx: prepared.mask.heightPx,
    bitDepth: prepared.mask.bitDepth,
    channelCount: prepared.mask.channelCount,
    permittedPixelValues: prepared.mask.permittedPixelValues,
    zeroMeaning: prepared.mask.zeroMeaning,
    twoHundredFiftyFiveMeaning: prepared.mask.twoHundredFiftyFiveMeaning,
    includedPixelCount: prepared.includedPixelCount,
    excludedPixelCount: prepared.excludedPixelCount,
    reasonCounts: prepared.reasonCounts,
    publicationDurability: "directory_fsync" as const,
    immutableFrozen: true as const,
    reasonMap: prepared.reasonMap,
  };
  const frozenBindingSha256 =
    computeGrandHallT554NativeReviewFrozenMaskBindingV2Sha256(frozen);
  expect(
    computeGrandHallT554NativeReviewFrozenMaskEvidenceV2Sha256(frozen),
  ).toBe(
    computeGrandHallT554NativeReviewPreparedMaskEvidenceV2Sha256(prepared),
  );
  const browserEpochNonceSha256 = digest("mask-proof-browser");
  const coverageSegmentIdSha256 = digest("mask-proof-segment");
  const maskScope: GrandHallT554NativeReviewMaskScopeV2 = {
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_V2,
    kind: "mask",
    sessionIdSha256: sessionScope.sessionIdSha256,
    implementationManifest: implementation,
    registry,
    authorityBoundary: authority,
    browserEpochNonceSha256,
    coverageSegmentIdSha256,
    renderGeneration: 4,
    sourceCustody,
    maskReviewSubjectSha256,
    maskStateSha256: maskState.maskStateSha256,
    frozenBindingSha256,
    frozenBinding: frozen,
  };
  const leafName = "mask-proof-child";
  const journalRoot = join(root, leafName);
  await mkdir(journalRoot);
  const journal = await createGrandHallT554NativeReviewDurableJournalV2({
    workspaceRoot: journalRoot,
    scope: maskScope,
  });
  const start = await journal.append({
    expectedRevision: 0,
    event: envelope("mask.review-started.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-mask-review-started.v2" as const,
      browserEpochNonceSha256,
      coverageSegmentIdSha256,
      coverageSegmentStartedAtUtc: NOW,
      firstSampleMustCreditZero: true as const,
      renderGeneration: 4,
      sourceCustody,
      maskReviewSubjectSha256,
      maskStateSha256: maskState.maskStateSha256,
      frozenBindingSha256,
      frozenBinding: frozen,
      implementationManifest: implementation,
      predecessorCoverage: null,
      authorityBoundary: authority,
    }),
  });
  if (complete) {
    await bulkAppendExactChildFixture({
      journalRoot,
      start,
      scope: maskScope,
      events: completeMaskCoverageEvents(maskScope),
    });
  }
  const evidence =
    await openGrandHallT554NativeReviewVerifiedDurableChildEvidenceV2({
      workspaceRoot: journalRoot,
      expectedScope: maskScope,
    });
  if (evidence.kind !== "mask") {
    throw new Error("mask proof fixture produced a non-mask child");
  }
  const maskCoverage = complete
    ? createGrandHallT554NativeReviewCoverageCarryStateV2(evidence)
    : null;
  if (maskCoverage !== null && maskCoverage.kind !== "mask") {
    throw new Error("mask proof fixture produced a non-mask carry");
  }
  const completedMaskCoverage = {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-completed-mask-coverage.v2" as const,
    maskReviewSubjectSha256,
    maskStateSha256: maskState.maskStateSha256,
    frozenBindingSha256,
    maskJournal: evidence.checkpoint,
    completedTileBitsetHex: "ff".repeat(64),
    completedTileCount: 512 as const,
    cumulativeDwellStateSha256:
      maskCoverage?.cumulativeDwellStateSha256 ??
      digest("forged-mask-completed-dwell"),
  };
  const sourceJournal = {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-child-checkpoint.v2" as const,
    kind: "source" as const,
    leafName: "source-proof-child",
    scopeSha256: digest("source-proof-scope"),
    scopeFileSha256: digest("source-proof-scope-file"),
    revision: 1,
    headEventSha256: digest("source-proof-head"),
    journalInventorySha256: digest("source-proof-inventory"),
  };
  const material = {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-source-decision-recorded.v2" as const,
    operationIdSha256: digest("mask-proof-decision-operation"),
    browserEpochNonceSha256,
    previousWorkspaceRevision: 4,
    resultingWorkspaceRevision: 5,
    sessionIdSha256: sessionScope.sessionIdSha256,
    registry,
    implementationManifest: implementation,
    authorityBoundary: authority,
    sourceCustody,
    previousRenderGeneration: 4,
    resultingRenderGeneration: 5,
    completedSourceCoverage: {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-completed-source-coverage.v2" as const,
      sourceReviewSubjectSha256: sourceCustody.sourceReviewSubjectSha256,
      sourceJournal,
      completedTileBitsetHex: "ff".repeat(64),
      completedTileCount: 512 as const,
      cumulativeDwellStateSha256: digest("source-proof-completed-dwell"),
    },
    note: "Exact frozen mask supports Grand Hall pixels.",
    decidedAtUtc: new Date().toISOString(),
    result: "INCLUDE" as const,
    classification: "grand_hall_core" as const,
    maskState,
    maskReviewSubjectSha256,
    frozenBindingSha256,
    frozenBinding: frozen,
    completedMaskCoverage,
  };
  const decision = envelope("source.decision-recorded.v2", {
    ...material,
    decisionSha256:
      computeGrandHallT554NativeReviewSourceDecisionV2Sha256(material),
  });
  return {
    sessionScope,
    maskScope,
    evidence,
    decision,
    leafName,
  };
}

interface DecisionCompositionFixture {
  readonly built: Fixture;
  readonly decisionSha256: Sha256;
  readonly attestationSha256: Sha256;
  readonly maskLeafName: string | null;
}

async function decisionCompositionFixture(
  result: "INCLUDE" | "EXCLUDE",
): Promise<DecisionCompositionFixture> {
  const built = await fixture(
    result === "INCLUDE"
      ? { completedWorkflow: true }
      : { completedSource: true },
  );
  const sourceEvidence =
    await openGrandHallT554NativeReviewVerifiedDurableChildEvidenceV2({
      workspaceRoot: join(built.root, "children", built.leafName),
      expectedScope: built.sourceScope,
    });
  if (sourceEvidence.kind !== "source") {
    throw new Error("decision composition fixture produced a non-source child");
  }
  const sourceCarry =
    createGrandHallT554NativeReviewCoverageCarryStateV2(sourceEvidence);
  if (sourceCarry.kind !== "source") {
    throw new Error("decision composition fixture produced a non-source carry");
  }
  const completedSourceCoverage = {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-completed-source-coverage.v2" as const,
    sourceReviewSubjectSha256:
      built.sourceScope.sourceCustody.sourceReviewSubjectSha256,
    sourceJournal: sourceEvidence.checkpoint,
    completedTileBitsetHex: sourceCarry.completedTileBitsetHex,
    completedTileCount: sourceCarry.completedTileCount,
    cumulativeDwellStateSha256: sourceCarry.cumulativeDwellStateSha256,
  };
  const coordinator = await openGrandHallT554NativeReviewDurableJournalV2({
    workspaceRoot: join(built.root, "coordinator"),
    expectedScope: built.scope,
  });

  let decisionSha256: Sha256;
  let coordinatorRevisionAfterDecision: number;
  let attestationPreviousWorkspaceRevision: number;
  let finalRenderGeneration: number;
  let maskCheckpoint: GrandHallT554NativeReviewMaskChildCheckpointV2 | null =
    null;
  let maskLeafName: string | null = null;

  if (result === "EXCLUDE") {
    const decisionMaterial = {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-source-decision-recorded.v2" as const,
      operationIdSha256: digest("full-exclude-decision-operation"),
      browserEpochNonceSha256: built.sourceScope.browserEpochNonceSha256,
      previousWorkspaceRevision: 1,
      resultingWorkspaceRevision: 2,
      sessionIdSha256: built.scope.sessionIdSha256,
      registry: built.scope.registry,
      implementationManifest: built.scope.implementationManifest,
      authorityBoundary: built.scope.authorityBoundary,
      sourceCustody: built.sourceScope.sourceCustody,
      previousRenderGeneration: 1,
      resultingRenderGeneration: 2,
      completedSourceCoverage,
      note: "Exact native review found no observed Grand Hall pixels.",
      decidedAtUtc: new Date().toISOString(),
      result: "EXCLUDE" as const,
      classification: "no_observed_grand_hall_pixels" as const,
      maskState: null,
      maskReviewSubjectSha256: null,
      frozenBindingSha256: null,
      frozenBinding: null,
      completedMaskCoverage: null,
    };
    decisionSha256 =
      computeGrandHallT554NativeReviewSourceDecisionV2Sha256(
        decisionMaterial,
      );
    await coordinator.append({
      expectedRevision: 4,
      event: envelope("source.decision-recorded.v2", {
        ...decisionMaterial,
        decisionSha256,
      }),
    });
    coordinatorRevisionAfterDecision = 5;
    attestationPreviousWorkspaceRevision = 2;
    finalRenderGeneration = 2;
  } else {
    const sourceCustody = built.sourceScope.sourceCustody;
    const replayContext = {
      schemaVersion:
        "venviewer.grand-hall-t554-native-mask-replay-context.v2" as const,
      sessionIdSha256: built.scope.sessionIdSha256,
      registry: built.scope.registry,
      implementationManifest: built.scope.implementationManifest,
      source: sourceCustody.source,
      sourceVerification: sourceCustody.sourceVerification,
      sourceReviewSubjectSha256: sourceCustody.sourceReviewSubjectSha256,
    };
    const maskArtifacts = await (async () => {
      const maskStore = new GrandHallT554NativeMaskRevisionStore({
        source: sourceCustody.source,
        publicationDirectory: join(built.root, "mask-evidence"),
      });
      try {
        const initialExact = maskStore.exactStateV2(replayContext);
        const edit = {
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
        };
        maskStore.applyEdit(edit);
        const resultingExact = maskStore.exactStateV2(replayContext);
        const frozen = await maskStore.freeze({ expectedRevision: 1 });
        return { edit, frozen, initialExact, resultingExact };
      } finally {
        maskStore.abandon();
      }
    })();
    const initialMaskState = {
      revision: maskArtifacts.initialExact.revision,
      maskStateSha256: maskArtifacts.initialExact.maskStateSha256,
      includedPixelCount: maskArtifacts.initialExact.includedPixelCount,
      excludedPixelCount: maskArtifacts.initialExact.excludedPixelCount,
      reasonCounts: mutableReasonCounts(maskArtifacts.initialExact.reasonCounts),
    };
    const maskState = {
      revision: maskArtifacts.resultingExact.revision,
      maskStateSha256: maskArtifacts.resultingExact.maskStateSha256,
      includedPixelCount: maskArtifacts.resultingExact.includedPixelCount,
      excludedPixelCount: maskArtifacts.resultingExact.excludedPixelCount,
      reasonCounts: mutableReasonCounts(
        maskArtifacts.resultingExact.reasonCounts,
      ),
    };
    const frozen: GrandHallT554NativeReviewFrozenMaskBindingV2 = {
      ...maskArtifacts.frozen,
      permittedPixelValues: [0, 255],
      reasonCounts: mutableReasonCounts(maskArtifacts.frozen.reasonCounts),
      reasonMap: {
        ...maskArtifacts.frozen.reasonMap,
        permittedPixelValues: [0, 1, 2, 3, 4, 5],
        reasonSampleCodebook: [
          { sample: 1, reasonCode: "adjacent_room_pixels" },
          { sample: 2, reasonCode: "portal_beyond_grand_hall_plane" },
          { sample: 3, reasonCode: "facade_or_exterior_pixels" },
          {
            sample: 4,
            reasonCode: "capture_artifact_outside_verified_room",
          },
          { sample: 5, reasonCode: "unverified_or_unknown_pixels" },
        ],
      },
    };
    const prepared = {
      schemaVersion:
        "venviewer.grand-hall-t554-native-mask-prepared-binding.v2" as const,
      source: frozen.source,
      revision: frozen.revision,
      includedPixelCount: frozen.includedPixelCount,
      excludedPixelCount: frozen.excludedPixelCount,
      reasonCounts: mutableReasonCounts(frozen.reasonCounts),
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
    const preparedBindingSha256 =
      computeGrandHallT554NativeReviewPreparedMaskEvidenceV2Sha256(prepared);
    const preparedMaterialSha256 =
      computeGrandHallT554NativeReviewPreparedMaskBindingV2Sha256(prepared);
    const maskReviewSubjectSha256 =
      computeGrandHallT554NativeReviewMaskSubjectV2Sha256({
        sourceReviewSubjectSha256: sourceCustody.sourceReviewSubjectSha256,
        maskStateSha256: maskState.maskStateSha256,
        maskEvidenceSha256: preparedBindingSha256,
        implementationManifest: built.scope.implementationManifest,
      });
    const frozenBindingSha256 =
      computeGrandHallT554NativeReviewFrozenMaskBindingV2Sha256(frozen);
    const maskCoverageSegmentIdSha256 = digest(
      "full-include-mask-coverage-segment",
    );
    maskLeafName = "mask-child-0001";

    await coordinator.append({
      expectedRevision: 5,
      event: envelope("mask.edited.v2", {
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-mask-edited.v2" as const,
        operationIdSha256: digest("full-include-mask-edit-operation"),
        browserEpochNonceSha256: built.sourceScope.browserEpochNonceSha256,
        previousWorkspaceRevision: 2,
        resultingWorkspaceRevision: 3,
        sourceCustody,
        previousRenderGeneration: 2,
        resultingRenderGeneration: 3,
        edit: maskArtifacts.edit,
        previousMaskState: initialMaskState,
        resultingMaskState: maskState,
        invalidatedFrozenBindingSha256: null,
        invalidatedMaskJournal: null,
      }),
    });
    await coordinator.append({
      expectedRevision: 6,
      event: envelope("mask.freeze-intended.v2", {
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-mask-freeze-intended.v2" as const,
        operationIdSha256: digest("full-include-mask-freeze-operation"),
        browserEpochNonceSha256: built.sourceScope.browserEpochNonceSha256,
        expectedWorkspaceRevision: 3,
        sourceCustody,
        previousRenderGeneration: 3,
        allocatedRenderGeneration: 4,
        maskState,
        maskReviewSubjectSha256,
        coverageSegmentIdSha256: maskCoverageSegmentIdSha256,
        preparedBindingSha256: preparedMaterialSha256,
        preparedBinding: prepared,
        childJournalLeafName: maskLeafName,
      }),
    });

    const maskScope: GrandHallT554NativeReviewMaskScopeV2 = {
      schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_V2,
      kind: "mask",
      sessionIdSha256: built.scope.sessionIdSha256,
      implementationManifest: built.scope.implementationManifest,
      registry: built.scope.registry,
      authorityBoundary: built.scope.authorityBoundary,
      browserEpochNonceSha256: built.sourceScope.browserEpochNonceSha256,
      coverageSegmentIdSha256: maskCoverageSegmentIdSha256,
      renderGeneration: 4,
      sourceCustody,
      maskReviewSubjectSha256,
      maskStateSha256: maskState.maskStateSha256,
      frozenBindingSha256,
      frozenBinding: frozen,
    };
    const maskRoot = join(built.root, "children", maskLeafName);
    await mkdir(maskRoot);
    const maskJournal = await createGrandHallT554NativeReviewDurableJournalV2({
      workspaceRoot: maskRoot,
      scope: maskScope,
    });
    const maskStart = await maskJournal.append({
      expectedRevision: 0,
      event: envelope("mask.review-started.v2", {
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-mask-review-started.v2" as const,
        browserEpochNonceSha256: built.sourceScope.browserEpochNonceSha256,
        coverageSegmentIdSha256: maskCoverageSegmentIdSha256,
        coverageSegmentStartedAtUtc: NOW,
        firstSampleMustCreditZero: true as const,
        renderGeneration: 4,
        sourceCustody,
        maskReviewSubjectSha256,
        maskStateSha256: maskState.maskStateSha256,
        frozenBindingSha256,
        frozenBinding: frozen,
        implementationManifest: built.scope.implementationManifest,
        predecessorCoverage: null,
        authorityBoundary: built.scope.authorityBoundary,
      }),
    });
    await writeCanonical(
      join(built.root, "child-scopes", `${maskLeafName}.json`),
      {
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-child-scope-descriptor.v2",
        leafName: maskLeafName,
        scope: maskScope,
      },
    );
    const maskStartEvidence =
      await openGrandHallT554NativeReviewVerifiedDurableChildEvidenceV2({
        workspaceRoot: maskRoot,
        expectedScope: maskScope,
      });
    if (maskStartEvidence.kind !== "mask") {
      throw new Error("decision composition fixture produced a non-mask child");
    }
    await coordinator.append({
      expectedRevision: 7,
      event: envelope("mask.freeze-committed.v2", {
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-mask-freeze-committed.v2" as const,
        operationIdSha256: digest("full-include-mask-freeze-operation"),
        browserEpochNonceSha256: built.sourceScope.browserEpochNonceSha256,
        previousWorkspaceRevision: 3,
        resultingWorkspaceRevision: 4,
        sourceCustody,
        renderGeneration: 4,
        maskState,
        maskReviewSubjectSha256,
        coverageSegmentIdSha256: maskCoverageSegmentIdSha256,
        frozenBindingSha256,
        frozenBinding: frozen,
        maskJournal: maskStartEvidence.checkpoint,
      }),
    });
    await bulkAppendExactChildFixture({
      journalRoot: maskRoot,
      start: maskStart,
      scope: maskScope,
      events: completeMaskCoverageEvents(maskScope),
    });
    const maskEvidence =
      await openGrandHallT554NativeReviewVerifiedDurableChildEvidenceV2({
        workspaceRoot: maskRoot,
        expectedScope: maskScope,
      });
    if (maskEvidence.kind !== "mask") {
      throw new Error("decision composition fixture produced a non-mask child");
    }
    const maskCarry =
      createGrandHallT554NativeReviewCoverageCarryStateV2(maskEvidence);
    if (maskCarry.kind !== "mask") {
      throw new Error("decision composition fixture produced a non-mask carry");
    }
    maskCheckpoint = maskEvidence.checkpoint;
    const completedMaskCoverage = {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-completed-mask-coverage.v2" as const,
      maskReviewSubjectSha256,
      maskStateSha256: maskState.maskStateSha256,
      frozenBindingSha256,
      maskJournal: maskEvidence.checkpoint,
      completedTileBitsetHex: maskCarry.completedTileBitsetHex,
      completedTileCount: maskCarry.completedTileCount,
      cumulativeDwellStateSha256: maskCarry.cumulativeDwellStateSha256,
    };
    const decisionMaterial = {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-source-decision-recorded.v2" as const,
      operationIdSha256: digest("full-include-decision-operation"),
      browserEpochNonceSha256: built.sourceScope.browserEpochNonceSha256,
      previousWorkspaceRevision: 4,
      resultingWorkspaceRevision: 5,
      sessionIdSha256: built.scope.sessionIdSha256,
      registry: built.scope.registry,
      implementationManifest: built.scope.implementationManifest,
      authorityBoundary: built.scope.authorityBoundary,
      sourceCustody,
      previousRenderGeneration: 4,
      resultingRenderGeneration: 5,
      completedSourceCoverage,
      note: "Exact frozen mask supports observed Grand Hall pixels.",
      decidedAtUtc: new Date().toISOString(),
      result: "INCLUDE" as const,
      classification: "grand_hall_core" as const,
      maskState,
      maskReviewSubjectSha256,
      frozenBindingSha256,
      frozenBinding: frozen,
      completedMaskCoverage,
    };
    decisionSha256 =
      computeGrandHallT554NativeReviewSourceDecisionV2Sha256(
        decisionMaterial,
      );
    await coordinator.append({
      expectedRevision: 8,
      event: envelope("source.decision-recorded.v2", {
        ...decisionMaterial,
        decisionSha256,
      }),
    });
    coordinatorRevisionAfterDecision = 9;
    attestationPreviousWorkspaceRevision = 5;
    finalRenderGeneration = 5;
  }

  const attestationMaterial = {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-source-human-attestation-recorded.v2" as const,
    operationIdSha256: digest(
      `full-${result.toLowerCase()}-human-attestation-operation`,
    ),
    browserEpochNonceSha256: built.sourceScope.browserEpochNonceSha256,
    previousWorkspaceRevision: attestationPreviousWorkspaceRevision,
    resultingWorkspaceRevision: attestationPreviousWorkspaceRevision + 1,
    sessionIdSha256: built.scope.sessionIdSha256,
    sourceReviewSubjectSha256:
      built.sourceScope.sourceCustody.sourceReviewSubjectSha256,
    decisionSha256,
    reviewerId: "authorized-reviewer-1",
    reviewerRole: "venue_owner_or_authorized_domain_reviewer" as const,
    knowledgeBasis: [
      "Reviewed the exact native source and all decision-bound evidence.",
    ],
    attestedAtUtc: new Date().toISOString(),
    statement: GRAND_HALL_T554_NATIVE_REVIEW_HUMAN_ATTESTATION_STATEMENT_V2,
    humanPresenceProof: "not_cryptographic" as const,
    agentDecisionAuthority: "none" as const,
    authority: "none" as const,
  };
  const attestationSha256 =
    computeGrandHallT554NativeReviewHumanAttestationV2Sha256(
      attestationMaterial,
    );
  await coordinator.append({
    expectedRevision: coordinatorRevisionAfterDecision,
    event: envelope("source.human-attestation-recorded.v2", {
      ...attestationMaterial,
      attestationSha256,
    }),
  });
  await coordinator.append({
    expectedRevision: coordinatorRevisionAfterDecision + 1,
    event: envelope("source.abandoned.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-source-abandoned.v2" as const,
      browserEpochNonceSha256: built.sourceScope.browserEpochNonceSha256,
      previousWorkspaceRevision: attestationPreviousWorkspaceRevision + 1,
      resultingWorkspaceRevision: attestationPreviousWorkspaceRevision + 2,
      sourceCustody: built.sourceScope.sourceCustody,
      finalRenderGeneration,
      sourceJournal: sourceEvidence.checkpoint,
      maskJournal: maskCheckpoint,
      reason: "operator_abandon" as const,
    }),
  });
  await coordinator.append({
    expectedRevision: coordinatorRevisionAfterDecision + 2,
    event: envelope("session.stopped.v2", {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-session-stopped.v2" as const,
      browserEpochNonceSha256: built.sourceScope.browserEpochNonceSha256,
      previousWorkspaceRevision: attestationPreviousWorkspaceRevision + 2,
      resultingWorkspaceRevision: attestationPreviousWorkspaceRevision + 3,
      stoppedAtUtc: new Date().toISOString(),
      activeSourceWasPresent: false,
      authorityBoundary: built.scope.authorityBoundary,
    }),
  });
  return { built, decisionSha256, attestationSha256, maskLeafName };
}

function expectStoreError(
  promise: Promise<unknown>,
  code: GrandHallT554NativeReviewSessionStoreV2Error["code"],
): Promise<void> {
  return promise.then(
    () => {
      throw new Error(`expected session-store error ${code}`);
    },
    (error: unknown) => {
      expect(error).toBeInstanceOf(
        GrandHallT554NativeReviewSessionStoreV2Error,
      );
      if (error instanceof GrandHallT554NativeReviewSessionStoreV2Error) {
        expect(error.code).toBe(code);
      }
    },
  );
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).flatMap((root) => [
      rm(root, { recursive: true, force: true }),
      rm(deriveGrandHallT554NativeReviewSessionOwnerControlDirectoryV2(root), {
        recursive: true,
        force: true,
      }),
    ]),
  );
});

describe("Grand Hall T-554 native review session store v2", () => {
  it("opens one exact committed child and returns a deep-frozen recursive inventory", async () => {
    const built = await fixture();
    await expect(
      Reflect.apply(openGrandHallT554NativeReviewSessionStoreV2, undefined, [
        {
          sessionRoot: built.root,
          expectedSessionScope: built.scope,
        },
      ]),
    ).rejects.toMatchObject({ code: "ARGUMENT_INVALID" });
    const replay = await openGrandHallT554NativeReviewSessionStoreV2({
      sessionRoot: built.root,
      expectedSessionScope: built.scope,
      lease: built.lease,
    });
    expect(replay.children).toHaveLength(1);
    expect(replay.children[0]).toMatchObject({
      leafName: built.leafName,
      disposition: "committed",
    });
    expect(replay.rootInventorySha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(replay.verificationAttestationSha256).toMatch(
      /^sha256:[0-9a-f]{64}$/u,
    );
    expect(replay.verificationAttestationSha256).not.toBe(
      replay.rootInventorySha256,
    );
    expect(Object.isFrozen(replay)).toBe(true);
    expect(Object.isFrozen(replay.children[0]?.evidence)).toBe(true);
    expect(
      isGrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2(
        replay.children[0]?.evidence,
      ),
    ).toBe(true);
  });

  it("rejects extra, missing, and swapped child members", async () => {
    const extra = await fixture();
    await writeFile(join(extra.root, "children", "extra"), "x");
    await expectStoreError(
      openGrandHallT554NativeReviewSessionStoreV2({ sessionRoot: extra.root, expectedSessionScope: extra.scope, lease: extra.lease }),
      "INVENTORY_INVALID",
    );

    const missing = await fixture();
    await rm(join(missing.root, "children", missing.leafName), { recursive: true });
    await expectStoreError(
      openGrandHallT554NativeReviewSessionStoreV2({ sessionRoot: missing.root, expectedSessionScope: missing.scope, lease: missing.lease }),
      "CHILD_MISMATCH",
    );

    const swapped = await fixture();
    await rename(
      join(swapped.root, "children", swapped.leafName),
      join(swapped.root, "children", "source-child-swapped"),
    );
    await rename(
      join(swapped.root, "child-scopes", `${swapped.leafName}.json`),
      join(swapped.root, "child-scopes", "source-child-swapped.json"),
    );
    await expectStoreError(
      openGrandHallT554NativeReviewSessionStoreV2({ sessionRoot: swapped.root, expectedSessionScope: swapped.scope, lease: swapped.lease }),
      "CHILD_MISMATCH",
    );
  });

  it("rejects forged historical checkpoints and child-scope transplants", async () => {
    const forged = await fixture({ forgedCheckpoint: true });
    await expectStoreError(
      openGrandHallT554NativeReviewSessionStoreV2({ sessionRoot: forged.root, expectedSessionScope: forged.scope, lease: forged.lease }),
      "CHILD_MISMATCH",
    );

    const transplanted = await fixture();
    await writeCanonical(
      join(transplanted.root, "child-scopes", `${transplanted.leafName}.json`),
      {
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-child-scope-descriptor.v2",
        leafName: transplanted.leafName,
        scope: {
          ...transplanted.sourceScope,
          sourceCustody: custody("transplanted-epoch"),
        },
      },
    );
    await expectStoreError(
      openGrandHallT554NativeReviewSessionStoreV2({ sessionRoot: transplanted.root, expectedSessionScope: transplanted.scope, lease: transplanted.lease }),
      "CHILD_MISMATCH",
    );
  });

  it("rejects a source rev1 checkpoint relabelled as all-complete coverage", async () => {
    const built = await fixture({ forgedMaskState: true });
    await expectStoreError(
      openGrandHallT554NativeReviewSessionStoreV2({ sessionRoot: built.root, expectedSessionScope: built.scope, lease: built.lease }),
      "CHILD_MISMATCH",
    );
  });

  it(
    "accepts an exact fully completed historical source prefix before mask editing",
    async () => {
      const built = await fixture({ completedWorkflow: true });
      const replay = await openGrandHallT554NativeReviewSessionStoreV2({
        sessionRoot: built.root,
        expectedSessionScope: built.scope,
        lease: built.lease,
      });
      expect(replay.maskStateReplayCount).toBe(1);
      expect(replay.coordinator.activeSource).toMatchObject({
        phase: "mask_edit",
      sourceJournal: { revision: 516 },
    });
    expect(replay.verificationAttestationSha256).toMatch(
      /^sha256:[0-9a-f]{64}$/u,
    );
  }, 60_000);

  it("accepts an EXCLUDE decision only when its exact durable source prefix is complete", async () => {
    const built = await sourceDecisionProofFixture(true);
    const verified =
      await __testOnlyGrandHallT554NativeReviewSessionStoreV2.verifyCompletedSourceCoverageReferences(
        built.sessionScope,
        [built.decision],
        [
          {
            leafName: built.leafName,
            disposition: "committed",
            scope: built.sourceScope,
            evidence: built.evidence,
          },
        ],
      );
    expect(verified).toMatchObject([
      {
        sourceJournal: { revision: 516 },
        coverageReplaySha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      },
    ]);
    expect(Object.isFrozen(verified)).toBe(true);
  }, 300_000);

  it("rejects a source rev1 checkpoint relabelled complete by an EXCLUDE decision", async () => {
    const built = await sourceDecisionProofFixture(false);
    await expectStoreError(
      __testOnlyGrandHallT554NativeReviewSessionStoreV2.verifyCompletedSourceCoverageReferences(
        built.sessionScope,
        [built.decision],
        [
          {
            leafName: built.leafName,
            disposition: "committed",
            scope: built.sourceScope,
            evidence: built.evidence,
          },
        ],
      ),
      "CHILD_MISMATCH",
    );
  }, 60_000);

  it("accepts an INCLUDE decision only when its exact durable mask prefix is complete", async () => {
    const built = await maskDecisionProofFixture(true);
    const verified =
      await __testOnlyGrandHallT554NativeReviewSessionStoreV2.verifyCompletedMaskCoverageReferences(
        built.sessionScope,
        [built.decision],
        [
          {
            leafName: built.leafName,
            disposition: "committed",
            scope: built.maskScope,
            evidence: built.evidence,
          },
        ],
      );
    expect(verified).toMatchObject([
      {
        maskJournal: { revision: 516 },
        coverageReplaySha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      },
    ]);
    expect(Object.isFrozen(verified)).toBe(true);
  }, 300_000);

  it("rejects a mask rev1 checkpoint relabelled complete by an INCLUDE decision", async () => {
    const built = await maskDecisionProofFixture(false);
    await expectStoreError(
      __testOnlyGrandHallT554NativeReviewSessionStoreV2.verifyCompletedMaskCoverageReferences(
        built.sessionScope,
        [built.decision],
        [
          {
            leafName: built.leafName,
            disposition: "committed",
            scope: built.maskScope,
            evidence: built.evidence,
          },
        ],
      ),
      "CHILD_MISMATCH",
    );
  }, 60_000);

  it("reopens a full INCLUDE decision, attestation, and abandoned source-plus-mask chain with a stable final digest", async () => {
    const composition = await decisionCompositionFixture("INCLUDE");
    await releaseGrandHallT554NativeReviewSessionOwnerV2({
      lease: composition.built.lease,
      sessionRoot: composition.built.root,
      expectedSessionScope: composition.built.scope,
    });
    const firstLease = await acquireGrandHallT554NativeReviewSessionOwnerV2({
      sessionRoot: composition.built.root,
      expectedSessionScope: composition.built.scope,
    });
    const first = await openGrandHallT554NativeReviewSessionStoreV2({
      sessionRoot: composition.built.root,
      expectedSessionScope: composition.built.scope,
      lease: firstLease,
    });
    expect(first.coordinator).toMatchObject({
      lifecycle: "stopped",
      workspaceRevision: 8,
      maximumAllocatedRenderGeneration: 5,
      eventCount: 12,
      activeSource: null,
      recordedSourceDecisions: [
        {
          result: "INCLUDE",
          decisionSha256: composition.decisionSha256,
          completedSourceCoverage: { sourceJournal: { revision: 516 } },
          completedMaskCoverage: { maskJournal: { revision: 516 } },
        },
      ],
      recordedHumanAttestations: [
        {
          decisionSha256: composition.decisionSha256,
          attestationSha256: composition.attestationSha256,
          humanPresenceProof: "not_cryptographic",
          agentDecisionAuthority: "none",
          authority: "none",
        },
      ],
    });
    expect(first.maskStateReplayCount).toBe(1);
    expect(first.children).toHaveLength(2);
    expect(
      first.children.map((child) => ({
        kind: child.evidence.kind,
        leafName: child.leafName,
        revision: child.evidence.checkpoint.revision,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          kind: "source",
          leafName: composition.built.leafName,
          revision: 516,
        },
        {
          kind: "mask",
          leafName: composition.maskLeafName,
          revision: 516,
        },
      ]),
    );
    expect(first.rootInventorySha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(first.verificationAttestationSha256).toMatch(
      /^sha256:[0-9a-f]{64}$/u,
    );

    await releaseGrandHallT554NativeReviewSessionOwnerV2({
      lease: firstLease,
      sessionRoot: composition.built.root,
      expectedSessionScope: composition.built.scope,
    });
    const reopenedLease =
      await acquireGrandHallT554NativeReviewSessionOwnerV2({
        sessionRoot: composition.built.root,
        expectedSessionScope: composition.built.scope,
      });
    const reopened = await openGrandHallT554NativeReviewSessionStoreV2({
      sessionRoot: composition.built.root,
      expectedSessionScope: composition.built.scope,
      lease: reopenedLease,
    });
    expect(reopened.rootInventorySha256).toBe(first.rootInventorySha256);
    expect(reopened.verificationAttestationSha256).toBe(
      first.verificationAttestationSha256,
    );
    expect(reopened.coordinator.recordedSourceDecisions[0]?.decisionSha256).toBe(
      composition.decisionSha256,
    );
    expect(
      reopened.coordinator.recordedHumanAttestations[0]?.attestationSha256,
    ).toBe(composition.attestationSha256);
    await releaseGrandHallT554NativeReviewSessionOwnerV2({
      lease: reopenedLease,
      sessionRoot: composition.built.root,
      expectedSessionScope: composition.built.scope,
    });
  }, 300_000);

  it("reopens a full EXCLUDE decision, authority-none attestation, and no-mask abandonment chain with a stable final digest", async () => {
    const composition = await decisionCompositionFixture("EXCLUDE");
    await releaseGrandHallT554NativeReviewSessionOwnerV2({
      lease: composition.built.lease,
      sessionRoot: composition.built.root,
      expectedSessionScope: composition.built.scope,
    });
    const firstLease = await acquireGrandHallT554NativeReviewSessionOwnerV2({
      sessionRoot: composition.built.root,
      expectedSessionScope: composition.built.scope,
    });
    const first = await openGrandHallT554NativeReviewSessionStoreV2({
      sessionRoot: composition.built.root,
      expectedSessionScope: composition.built.scope,
      lease: firstLease,
    });
    expect(first.coordinator).toMatchObject({
      lifecycle: "stopped",
      workspaceRevision: 5,
      maximumAllocatedRenderGeneration: 2,
      eventCount: 8,
      activeSource: null,
      recordedSourceDecisions: [
        {
          result: "EXCLUDE",
          decisionSha256: composition.decisionSha256,
          completedSourceCoverage: { sourceJournal: { revision: 516 } },
          completedMaskCoverage: null,
        },
      ],
      recordedHumanAttestations: [
        {
          decisionSha256: composition.decisionSha256,
          attestationSha256: composition.attestationSha256,
          humanPresenceProof: "not_cryptographic",
          agentDecisionAuthority: "none",
          authority: "none",
        },
      ],
    });
    expect(first.maskStateReplayCount).toBe(0);
    expect(first.children).toHaveLength(1);
    expect(first.children[0]).toMatchObject({
      leafName: composition.built.leafName,
      evidence: { kind: "source", checkpoint: { revision: 516 } },
    });
    expect(composition.maskLeafName).toBeNull();
    expect(first.rootInventorySha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(first.verificationAttestationSha256).toMatch(
      /^sha256:[0-9a-f]{64}$/u,
    );

    await releaseGrandHallT554NativeReviewSessionOwnerV2({
      lease: firstLease,
      sessionRoot: composition.built.root,
      expectedSessionScope: composition.built.scope,
    });
    const reopenedLease =
      await acquireGrandHallT554NativeReviewSessionOwnerV2({
        sessionRoot: composition.built.root,
        expectedSessionScope: composition.built.scope,
      });
    const reopened = await openGrandHallT554NativeReviewSessionStoreV2({
      sessionRoot: composition.built.root,
      expectedSessionScope: composition.built.scope,
      lease: reopenedLease,
    });
    expect(reopened.rootInventorySha256).toBe(first.rootInventorySha256);
    expect(reopened.verificationAttestationSha256).toBe(
      first.verificationAttestationSha256,
    );
    expect(reopened.coordinator.recordedSourceDecisions[0]?.decisionSha256).toBe(
      composition.decisionSha256,
    );
    expect(
      reopened.coordinator.recordedHumanAttestations[0]?.attestationSha256,
    ).toBe(composition.attestationSha256);
    await releaseGrandHallT554NativeReviewSessionOwnerV2({
      lease: reopenedLease,
      sessionRoot: composition.built.root,
      expectedSessionScope: composition.built.scope,
    });
  }, 300_000);

  it("rejects same-count mask evidence with a different exact spatial layout", () => {
    const source = sourceIdentity();
    const stableContext = {
      schemaVersion:
        "venviewer.grand-hall-t554-native-mask-replay-context.v2" as const,
      sessionIdSha256: digest("spatial-session"),
      registry,
      implementationManifest: {
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-implementation-manifest-binding.v2" as const,
        implementationId:
          "grand-hall-t554-native-review-workbench-v1" as const,
        semanticSha256: digest("spatial-implementation-semantic"),
        fileSha256: digest("spatial-implementation-file"),
        byteLength: 10,
      },
      source,
      sourceVerification: custody().sourceVerification,
      sourceReviewSubjectSha256: digest("spatial-source-subject"),
    };
    const left = GrandHallT554NativeMaskRevisionStore.createReplayOnly(source);
    const right = GrandHallT554NativeMaskRevisionStore.createReplayOnly(source);
    try {
      left.applyEdit({
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
      });
      right.applyEdit({
        expectedRevision: 0,
        operation: "include",
        primitive: {
          kind: "rectangle",
          horizontalSeam: "none",
          leftPx: 1,
          topPx: 0,
          rightExclusivePx: 2,
          bottomExclusivePx: 1,
        },
      });
      const expected = left.exactStateV2(stableContext);
      const swapped = right.exactStateV2(stableContext);
      expect(swapped.includedPixelCount).toBe(expected.includedPixelCount);
      expect(swapped.pixelTileInventorySha256).not.toBe(
        expected.pixelTileInventorySha256,
      );
      const decoded: GrandHallT554VerifiedMaskEvidence = {
        kind: "frozen_mask_evidence",
        mask: {
          fileName: "swapped-mask.png",
          sha256: digest("swapped-mask"),
          byteLength: 1,
        },
        reasonMap: {
          fileName: "swapped-reason.png",
          sha256: digest("swapped-reason"),
          byteLength: 1,
        },
        includedPixelCount: swapped.includedPixelCount,
        excludedPixelCount: swapped.excludedPixelCount,
        reasonSampleCounts: reasonSampleCounts(swapped),
        pixelTileInventorySha256: swapped.pixelTileInventorySha256,
      };
      expect(() => {
        __testOnlyGrandHallT554NativeReviewSessionStoreV2
          .assertMaskEvidenceMatchesExactState(decoded, expected);
      },
      ).toThrowError(
        expect.objectContaining({ code: "MASK_EVIDENCE_MISMATCH" }),
      );
    } finally {
      left.abandon();
      right.abandon();
    }
  });

  it("enforces exact resolved publication subsets and bounded pending subsets", () => {
    for (const [disposition, accepted] of [
      ["none", []],
      ["mask_only", ["mask-a.png"]],
      ["reason_map_only", ["reason-a.png"]],
      ["mask_and_reason_map", ["mask-a.png", "reason-a.png"]],
    ] as const) {
      const plan =
        __testOnlyGrandHallT554NativeReviewSessionStoreV2.buildMaskPublicationPlan([
          freezeIntent("freeze-a", "mask-a.png", "reason-a.png"),
          freezeAbort("freeze-a", disposition),
        ]);
      expect(() => {
        __testOnlyGrandHallT554NativeReviewSessionStoreV2.assertMaskPublicationNames(
          plan,
          new Set(accepted),
        );
      },
      ).not.toThrow();
      for (const rejected of [
        [],
        ["mask-a.png"],
        ["reason-a.png"],
        ["mask-a.png", "reason-a.png"],
      ]) {
        if (canonicalBytes(rejected).equals(canonicalBytes(accepted))) continue;
        expect(() => {
          __testOnlyGrandHallT554NativeReviewSessionStoreV2.assertMaskPublicationNames(
            plan,
            new Set(rejected),
          );
        },
        ).toThrowError(
          expect.objectContaining({ code: "MASK_EVIDENCE_MISMATCH" }),
        );
      }
    }

    const pendingPlan =
      __testOnlyGrandHallT554NativeReviewSessionStoreV2.buildMaskPublicationPlan([
        freezeIntent("freeze-pending", "pending-mask.png", "pending-reason.png"),
      ]);
    for (const subset of [
      [],
      ["pending-mask.png"],
      ["pending-reason.png"],
      ["pending-mask.png", "pending-reason.png"],
    ]) {
      expect(() => {
        __testOnlyGrandHallT554NativeReviewSessionStoreV2.assertMaskPublicationNames(
          pendingPlan,
          new Set(subset),
        );
      },
      ).not.toThrow();
    }

    const sharedPlan =
      __testOnlyGrandHallT554NativeReviewSessionStoreV2.buildMaskPublicationPlan([
        freezeIntent("freeze-forbidden", "shared-mask.png", "forbidden-reason.png"),
        freezeAbort("freeze-forbidden", "none"),
        freezeIntent("freeze-required", "shared-mask.png", "required-reason.png"),
        freezeAbort("freeze-required", "mask_only"),
      ]);
    expect(() => {
      __testOnlyGrandHallT554NativeReviewSessionStoreV2.assertMaskPublicationNames(
        sharedPlan,
        new Set(["shared-mask.png"]),
      );
    },
    ).not.toThrow();
  });

  it("accepts both pending child states and both exact recovery-abort dispositions", async () => {
    for (const disposition of [
      "pending_present",
      "pending_absent",
      "aborted_present",
      "aborted_absent",
    ] as const) {
      const built = await fixture({ disposition });
      const replay = await openGrandHallT554NativeReviewSessionStoreV2({
        sessionRoot: built.root,
        expectedSessionScope: built.scope,
        lease: built.lease,
      });
      expect(replay.children.length).toBe(
        disposition.endsWith("present") ? 1 : 0,
      );
    }
  });

  it("validates resume carry from the actual prior prefix even when the new child is absent", async () => {
    const exerciseAbsentResume = async (
      resolvedRecoveryAbort: boolean,
    ): Promise<void> => {
    const built = await fixture();
    const priorJournal = await openGrandHallT554NativeReviewDurableJournalV2({
      workspaceRoot: join(built.root, "children", built.leafName),
      expectedScope: built.sourceScope,
    });
    await priorJournal.append({
      expectedRevision: 1,
      event: firstSourceCoverageEvent(built.sourceScope),
    });
    const priorEvidence =
      await openGrandHallT554NativeReviewVerifiedDurableChildEvidenceV2({
        workspaceRoot: join(built.root, "children", built.leafName),
        expectedScope: built.sourceScope,
      });
    if (priorEvidence.kind !== "source") {
      throw new Error("resume fixture prior child changed kind");
    }
    const actualCarry =
      createGrandHallT554NativeReviewCoverageCarryStateV2(priorEvidence);
    if (actualCarry.kind !== "source") {
      throw new Error("resume fixture produced mask carry");
    }
    const forgedCarry = {
      ...actualCarry,
      predecessorFinalDurableRecordedAtUtc: new Date(
        Date.parse(actualCarry.predecessorFinalDurableRecordedAtUtc) + 1,
      ).toISOString(),
    };
    const coordinator = await openGrandHallT554NativeReviewDurableJournalV2({
      workspaceRoot: join(built.root, "coordinator"),
      expectedScope: built.scope,
    });
    const browserTwo = digest("browser-2-resume");
    await coordinator.append({
      expectedRevision: 4,
      event: envelope("session.browser-epoch-started.v2", {
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-browser-epoch-started.v2",
        browserEpochNumber: 2,
        browserEpochNonceSha256: browserTwo,
        previousBrowserEpochNonceSha256: built.sourceScope.browserEpochNonceSha256,
        reason: "crash_resume" as const,
        priorActiveSourceJournal: priorEvidence.checkpoint,
        priorActiveMaskJournal: null,
        workspaceRevision: 1,
        maximumAllocatedRenderGeneration: 1,
        startedAtUtc: "2000-01-01T00:00:01.000Z",
      }),
    });
    const resumedPreparedCustody = {
      ...built.sourceScope.sourceCustody,
      sourceEpochBindingSha256: digest("resume-new-source-binding"),
      sourceEpochNonceSha256: digest("resume-new-source-epoch"),
      sourceEpochRenderGeneration: 2,
    };
    await coordinator.append({
      expectedRevision: 5,
      event: envelope("coverage.segment-resume-intended.v2", {
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-coverage-segment-resume-intended.v2",
        kind: "source" as const,
        operationIdSha256: digest("resume-operation"),
        browserEpochNonceSha256: browserTwo,
        expectedWorkspaceRevision: 1,
        sourceCustodyBefore: built.sourceScope.sourceCustody,
        preparedSourceCustody: resumedPreparedCustody,
        previousVisibleRenderGeneration: 1,
        previousMaximumAllocatedRenderGeneration: 1,
        allocatedRenderGeneration: 2,
        newSourceEpochNonceSha256: digest("resume-new-source-epoch"),
        newCoverageSegmentIdSha256: digest("resume-new-segment"),
        childJournalLeafName: "source-child-resume-0002",
        priorChildJournal: priorEvidence.checkpoint,
        predecessorCoverage: forgedCarry,
      }),
    });
    if (resolvedRecoveryAbort) {
      const browserThree = digest("browser-3-resume-recovery");
      await coordinator.append({
        expectedRevision: 6,
        event: envelope("session.browser-epoch-started.v2", {
          schemaVersion:
            "venviewer.grand-hall-t554-native-review-browser-epoch-started.v2",
          browserEpochNumber: 3,
          browserEpochNonceSha256: browserThree,
          previousBrowserEpochNonceSha256: browserTwo,
          reason: "crash_resume" as const,
          priorActiveSourceJournal: priorEvidence.checkpoint,
          priorActiveMaskJournal: null,
          workspaceRevision: 1,
          maximumAllocatedRenderGeneration: 2,
          startedAtUtc: "2000-01-01T00:00:02.000Z",
        }),
      });
      await coordinator.append({
        expectedRevision: 7,
        event: envelope("coverage.segment-resume-recovery-aborted.v2", {
          schemaVersion:
            "venviewer.grand-hall-t554-native-review-coverage-segment-resume-recovery-aborted.v2",
          kind: "source" as const,
          operationIdSha256: digest("resume-operation"),
          browserEpochNonceSha256: browserThree,
          workspaceRevision: 1,
          consumedRenderGeneration: 2,
          recovery: {
            childDisposition: "absent" as const,
            abandonedChildJournal: null,
          },
        }),
      });
    }
    await expectStoreError(
      openGrandHallT554NativeReviewSessionStoreV2({
        sessionRoot: built.root,
        expectedSessionScope: built.scope,
        lease: built.lease,
      }),
      "CHILD_MISMATCH",
    );
    };
    await exerciseAbsentResume(false);
    await exerciseAbsentResume(true);
  });

  it("rejects unacknowledged tails except on the active writable child", async () => {
    const active = await fixture();
    const activeJournal = await openGrandHallT554NativeReviewDurableJournalV2({
      workspaceRoot: join(active.root, "children", active.leafName),
      expectedScope: active.sourceScope,
    });
    await activeJournal.append({
      expectedRevision: 1,
      event: sourceDeliveryEvent(active.sourceScope),
    });
    await expect(
      openGrandHallT554NativeReviewSessionStoreV2({
        sessionRoot: active.root,
        expectedSessionScope: active.scope,
        lease: active.lease,
      }),
    ).resolves.toMatchObject({ children: [{ disposition: "committed" }] });

    for (const disposition of ["pending_present", "aborted_present"] as const) {
      const built = await fixture({ disposition });
      const journal = await openGrandHallT554NativeReviewDurableJournalV2({
        workspaceRoot: join(built.root, "children", built.leafName),
        expectedScope: built.sourceScope,
      });
      await journal.append({
        expectedRevision: 1,
        event: sourceDeliveryEvent(built.sourceScope),
      });
      await expectStoreError(
        openGrandHallT554NativeReviewSessionStoreV2({
          sessionRoot: built.root,
          expectedSessionScope: built.scope,
          lease: built.lease,
        }),
        "CHILD_MISMATCH",
      );
    }
  });

  it("proves the 148-source source-plus-mask capacity and Windows leaf bound arithmetically", () => {
    const capacity =
      __testOnlyGrandHallT554NativeReviewSessionStoreV2.rootCapacityInvariant();
    expect(capacity).toMatchObject({
      reviewSourceCount: 148,
      maximumRegistryChildCount: 296,
      maximumChildEventCount: 4_609,
      maximumJournalQuarantineEntryCount: 16_384,
      maximumJournalUniqueBytes: String(128 * 1_024 * 1_024),
    });
    expect(capacity.configuredMaximumRootEntryCount).toBeGreaterThanOrEqual(
      capacity.requiredMaximumRootEntryCount,
    );
    expect(BigInt(capacity.configuredMaximumRootTotalBytes)).toBeGreaterThanOrEqual(
      BigInt(capacity.requiredMaximumRootTotalBytes),
    );
    expect(
      __testOnlyGrandHallT554NativeReviewSessionStoreV2.safeChildLeaf(
        "a".repeat(250),
      ),
    ).toBe(true);
    expect(
      __testOnlyGrandHallT554NativeReviewSessionStoreV2.safeChildLeaf(
        "a".repeat(251),
      ),
    ).toBe(false);
    expect(() => {
      __testOnlyGrandHallT554NativeReviewSessionStoreV2.assertBoundedRelativePath(
        "a/b/c/d/e/f/g/h/i",
      );
    },
    ).toThrowError(expect.objectContaining({ code: "LIMIT_REACHED" }));
    expect(() => {
      __testOnlyGrandHallT554NativeReviewSessionStoreV2.assertBoundedRelativePath(
        `a/${"b".repeat(1_023)}`,
      );
    },
    ).toThrowError(expect.objectContaining({ code: "LIMIT_REACHED" }));
  });

  it("authenticates and then fully re-verifies exact journal crash residues", async () => {
    for (const removePublishedEvent of [false, true]) {
      const built = await fixture();
      await injectCommittedPendingResidue(
        built.root,
        built.leafName,
        removePublishedEvent,
      );
      const replay = await openGrandHallT554NativeReviewSessionStoreV2({
        sessionRoot: built.root,
        expectedSessionScope: built.scope,
        lease: built.lease,
      });
      expect(replay.children).toHaveLength(1);
      expect(
        await readdir(join(built.root, "children", built.leafName, "pending")),
      ).toEqual([]);
    }

    const unowned = await fixture();
    await injectCommittedPendingResidue(unowned.root, unowned.leafName, true);
    await releaseGrandHallT554NativeReviewSessionOwnerV2({
      lease: unowned.lease,
      sessionRoot: unowned.root,
      expectedSessionScope: unowned.scope,
    });
    await expect(
      openGrandHallT554NativeReviewSessionStoreV2({
        sessionRoot: unowned.root,
        expectedSessionScope: unowned.scope,
        lease: unowned.lease,
      }),
    ).rejects.toMatchObject({ code: "STALE_LEASE" });
    expect(
      await readdir(join(unowned.root, "children", unowned.leafName, "pending")),
    ).toHaveLength(1);
    const recoveryLease = await acquireGrandHallT554NativeReviewSessionOwnerV2({
      sessionRoot: unowned.root,
      expectedSessionScope: unowned.scope,
    });
    await openGrandHallT554NativeReviewSessionStoreV2({
      sessionRoot: unowned.root,
      expectedSessionScope: unowned.scope,
      lease: recoveryLease,
    });
    expect(
      await readdir(join(unowned.root, "children", unowned.leafName, "pending")),
    ).toEqual([]);
  });

  it("rejects hardlink aliases, case collisions, and verification races", async () => {
    const hardlinked = await fixture();
    await link(
      join(hardlinked.root, "session-root.json"),
      join(hardlinked.root, "session-root-alias.json"),
    );
    await expect(
      openGrandHallT554NativeReviewSessionStoreV2({ sessionRoot: hardlinked.root, expectedSessionScope: hardlinked.scope, lease: hardlinked.lease }),
    ).rejects.toMatchObject({ code: "ROOT_UNSAFE" });

    const collision = await fixture();
    await writeFile(join(collision.root, "mask-evidence", "EVIDENCE"), "b");
    await expectStoreError(
      openGrandHallT554NativeReviewSessionStoreV2({ sessionRoot: collision.root, expectedSessionScope: collision.scope, lease: collision.lease }),
      "ROOT_UNSAFE",
    );

    const raced = await fixture();
    await expectStoreError(
      __testOnlyGrandHallT554NativeReviewSessionStoreV2.openSessionStore({
        sessionRoot: raced.root,
        expectedSessionScope: raced.scope,
        lease: raced.lease,
        seam: {
          afterInitialInventory: async (root) => {
            await writeFile(join(root, "mask-evidence", "raced"), "x");
          },
        },
      }),
      "ROOT_CHANGED",
    );
  });

  it("hashes each authenticated journal hardlink inode once per inventory pass", async () => {
    const built = await fixture();
    const readPaths: string[] = [];
    await __testOnlyGrandHallT554NativeReviewSessionStoreV2.openSessionStore({
      sessionRoot: built.root,
      expectedSessionScope: built.scope,
      lease: built.lease,
      seam: {
        afterUniqueFileRead: (relativePath) => {
          readPaths.push(relativePath);
        },
      },
    });
    expect(
      readPaths.some((relativePath) => relativePath.includes("/claims/")),
    ).toBe(true);
    expect(
      readPaths.some((relativePath) => relativePath.includes("/events/")),
    ).toBe(false);
  });
});
