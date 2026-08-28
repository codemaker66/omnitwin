import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_WIDTH_PX,
  type GrandHallPanoramaSourceJpgIdentityV2,
} from "@omnitwin/types";
import { afterEach, describe, expect, it } from "vitest";

import {
  type GrandHallT554NativeReviewAuthorityBoundaryV2,
  type GrandHallT554NativeReviewCoverageObservedPayloadV2,
  type GrandHallT554NativeReviewImplementationManifestBindingV2,
  type GrandHallT554NativeReviewMaskScopeV2,
  type GrandHallT554NativeReviewRegistryBindingV2,
  type GrandHallT554NativeReviewSourceCustodyBindingV2,
  type GrandHallT554NativeReviewSourceScopeV2,
} from "../grand-hall-t554-native-review-events-v2.js";
import * as durableJournalV2Module from "../grand-hall-t554-native-review-durable-journal-v2.js";
import {
  createGrandHallT554NativeReviewDurableJournalV2,
  openGrandHallT554NativeReviewVerifiedDurableChildEvidenceV2,
  type GrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2,
  type GrandHallT554NativeReviewVerifiedDurableMaskChildJournalEvidenceV2,
  type GrandHallT554NativeReviewVerifiedDurableSourceChildJournalEvidenceV2,
} from "../grand-hall-t554-native-review-durable-journal-v2.js";
import * as replayV2Module from "../grand-hall-t554-native-review-replay-v2.js";
import {
  computeGrandHallT554NativeReviewCoverageEventV2Sha256,
  createGrandHallT554NativeReviewCoverageCarryStateV2,
  emptyGrandHallT554NativeReviewDwellVectorV2,
  emptyGrandHallT554NativeReviewTileBitmapV2,
  replayGrandHallT554NativeReviewMaskChildV2,
  replayGrandHallT554NativeReviewSourceChildV2,
  validateGrandHallT554NativeReviewMaskChildSequenceV2,
  validateGrandHallT554NativeReviewSourceChildSequenceV2,
} from "../grand-hall-t554-native-review-replay-v2.js";

type Sha256 = `sha256:${string}`;
type CoverageMaterial = Omit<
  GrandHallT554NativeReviewCoverageObservedPayloadV2,
  "coverageEventSha256"
>;

const SOURCE_PIXEL_COUNT =
  GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX;
const EMPTY_BITMAP = emptyGrandHallT554NativeReviewTileBitmapV2();
const temporaryParents: string[] = [];
let workspaceSequence = 0;

function digest(label: string): Sha256 {
  return `sha256:${createHash("sha256").update(label).digest("hex")}`;
}

function sha256(bytes: Buffer): Sha256 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function dwellStateSha256(bytes: Buffer): Sha256 {
  return sha256(
    Buffer.concat([
      Buffer.from(
        "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_DWELL_STATE_V2\n",
        "utf8",
      ),
      bytes,
    ]),
  );
}

function tileBitmap(...indexes: number[]): string {
  const bytes = Buffer.alloc(64);
  indexes.forEach((index) => {
    bytes[Math.floor(index / 8)] =
      (bytes[Math.floor(index / 8)] ?? 0) | (1 << (index % 8));
  });
  return bytes.toString("hex");
}

function dwellEvidence(millisecondsForTileZero: number) {
  const bytes = Buffer.alloc(1_024);
  bytes.writeUInt16LE(millisecondsForTileZero, 0);
  return {
    bytes,
    rawSha256: sha256(bytes),
    stateSha256: dwellStateSha256(bytes),
    base64url: bytes.toString("base64url"),
    completedBitmap:
      millisecondsForTileZero === 750 ? tileBitmap(0) : EMPTY_BITMAP,
    completedCount: millisecondsForTileZero === 750 ? 1 : 0,
  };
}

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

const implementation: GrandHallT554NativeReviewImplementationManifestBindingV2 =
  {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-implementation-manifest-binding.v2",
    implementationId: "grand-hall-t554-native-review-workbench-v1",
    semanticSha256: digest("implementation-semantic"),
    fileSha256: digest("implementation-file"),
    byteLength: 12_345,
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

const source: GrandHallPanoramaSourceJpgIdentityV2 = {
  inventoryIndex: 0,
  sweepNumber: 1,
  fileName: "sweep_001jpg.jpg",
  sha256: digest("source-file"),
  byteLength: 6_419_919,
  widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
  heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
};

function sourceCustody(
  generation = 1,
  epoch = "epoch-1",
): GrandHallT554NativeReviewSourceCustodyBindingV2 {
  return {
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
    sourceReviewSubjectSha256: digest("stable-source-subject"),
    sourceEpochBindingSha256: digest(`${epoch}-binding`),
    sourceEpochNonceSha256: digest(`${epoch}-nonce`),
    sourceEpochRenderGeneration: generation,
  };
}

function sourceScope(
  generation = 1,
  browserEpoch = digest("browser-1"),
  segment = digest("segment-1"),
  custody = sourceCustody(generation),
): GrandHallT554NativeReviewSourceScopeV2 {
  return {
    schemaVersion: "venviewer.grand-hall-t554-native-review-journal-scope.v2",
    kind: "source",
    sessionIdSha256: digest("session"),
    implementationManifest: implementation,
    registry,
    authorityBoundary: authority,
    browserEpochNonceSha256: browserEpoch,
    coverageSegmentIdSha256: segment,
    renderGeneration: generation,
    sourceCustody: custody,
  };
}

function sourceStart(
  scope: GrandHallT554NativeReviewSourceScopeV2,
  predecessorCoverage: unknown = null,
  coverageSegmentStartedAtUtc = "2026-08-27T00:00:00.000Z",
) {
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-domain-event.v2" as const,
    eventType: "source.review-started.v2" as const,
    payload: {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-source-review-started.v2" as const,
      browserEpochNonceSha256: scope.browserEpochNonceSha256,
      coverageSegmentIdSha256: scope.coverageSegmentIdSha256,
      coverageSegmentStartedAtUtc,
      firstSampleMustCreditZero: true as const,
      renderGeneration: scope.renderGeneration,
      sourceCustody: scope.sourceCustody,
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
      predecessorCoverage,
      authorityBoundary: authority,
    },
  };
}

function delivery(
  scope:
    | GrandHallT554NativeReviewSourceScopeV2
    | GrandHallT554NativeReviewMaskScopeV2,
  kind: "source" | "mask",
  index = 0,
  receivedAt = "2026-08-27T00:00:00.001Z",
) {
  const subjectSha256 =
    scope.kind === "source"
      ? scope.sourceCustody.sourceReviewSubjectSha256
      : scope.maskReviewSubjectSha256;
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-domain-event.v2" as const,
    eventType: `${kind}.tile-delivered.v2`,
    payload: {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-tile-delivered.v2" as const,
      browserEpochNonceSha256: scope.browserEpochNonceSha256,
      sourceEpochNonceSha256: scope.sourceCustody.sourceEpochNonceSha256,
      coverageSegmentIdSha256: scope.coverageSegmentIdSha256,
      subjectSha256,
      renderGeneration: scope.renderGeneration,
      column: index % 32,
      row: Math.floor(index / 32),
      tileIndex: index,
      responseFinishedAtUtc: receivedAt,
    },
  };
}

function coverageEvent(
  scope:
    | GrandHallT554NativeReviewSourceScopeV2
    | GrandHallT554NativeReviewMaskScopeV2,
  kind: "source" | "mask",
  options: {
    readonly sequence: number;
    readonly previous: Sha256 | null;
    readonly monotonicElapsedMs: number;
    readonly receivedAtUtc: string;
    readonly deliveredBitmap: string;
    readonly visibleBitmap: string;
    readonly creditedBitmap: string;
    readonly creditedDurationMs: number;
    readonly deltaMs: number;
    readonly disqualifier: GrandHallT554NativeReviewCoverageObservedPayloadV2["derived"]["disqualifier"];
    readonly dwellMsForTileZero: number;
    readonly paintedBitmap?: string;
  },
) {
  const dwell = dwellEvidence(options.dwellMsForTileZero);
  const subjectSha256 =
    scope.kind === "source"
      ? scope.sourceCustody.sourceReviewSubjectSha256
      : scope.maskReviewSubjectSha256;
  const material: CoverageMaterial = {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-coverage-observed.v2",
    browserEpochNonceSha256: scope.browserEpochNonceSha256,
    sourceEpochNonceSha256: scope.sourceCustody.sourceEpochNonceSha256,
    coverageSegmentIdSha256: scope.coverageSegmentIdSha256,
    subjectSha256,
    renderGeneration: scope.renderGeneration,
    sequence: options.sequence,
    previousCoverageEventSha256: options.previous,
    serverObservation: {
      receivedAtUtc: options.receivedAtUtc,
      monotonicElapsedMs: options.monotonicElapsedMs,
    },
    telemetry: {
      documentVisibilityState: "visible",
      documentFocusState: "focused",
      viewportCssWidth: GRAND_HALL_PANORAMA_WIDTH_PX,
      viewportCssHeight: GRAND_HALL_PANORAMA_HEIGHT_PX,
      devicePixelRatio: 1,
      sourceToCssTransform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      paintedTileBitsetHex: options.paintedBitmap ?? tileBitmap(0),
    },
    derived: {
      effectiveDevicePixelsPerSourcePixel: 1,
      serverMonotonicDeltaMs: options.deltaMs,
      deliveredTileBitsetHex: options.deliveredBitmap,
      fullyVisibleDeliveredTileBitsetHex: options.visibleBitmap,
      creditedTileBitsetHex: options.creditedBitmap,
      creditedDurationMs: options.creditedDurationMs,
      disqualifier: options.disqualifier,
      completedTileBitsetHex: dwell.completedBitmap,
      completedTileCount: dwell.completedCount,
      cumulativeDwellStateSha256: dwell.stateSha256,
    },
  };
  dwell.bytes.fill(0);
  const payload: GrandHallT554NativeReviewCoverageObservedPayloadV2 = {
    ...material,
    coverageEventSha256: computeGrandHallT554NativeReviewCoverageEventV2Sha256(
      kind,
      material,
    ),
  };
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-domain-event.v2" as const,
    eventType: `${kind}.coverage-observed.v2`,
    payload,
  };
}

function firstCoverage(
  scope:
    | GrandHallT554NativeReviewSourceScopeV2
    | GrandHallT554NativeReviewMaskScopeV2,
  kind: "source" | "mask",
  dwellMsForTileZero = 0,
  deliveredBitmap = tileBitmap(0),
  visibleBitmap = tileBitmap(0),
  receivedAtUtc = "2026-08-27T00:00:00.002Z",
) {
  return coverageEvent(scope, kind, {
    sequence: 0,
    previous: null,
    monotonicElapsedMs: 0,
    receivedAtUtc,
    deliveredBitmap,
    visibleBitmap,
    creditedBitmap: EMPTY_BITMAP,
    creditedDurationMs: 0,
    deltaMs: 0,
    disqualifier: "first_sample",
    dwellMsForTileZero,
    paintedBitmap: visibleBitmap,
  });
}

function frozenBinding(): GrandHallT554NativeReviewMaskScopeV2["frozenBinding"] {
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-mask-frozen-binding.v2" as const,
    source,
    revision: 1,
    fileName: "mask-001.png",
    sha256: digest("mask-png"),
    byteLength: 9_000,
    widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
    heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
    bitDepth: 8 as const,
    channelCount: 1 as const,
    permittedPixelValues: [0, 255] as const,
    zeroMeaning: "grand_hall_included" as const,
    twoHundredFiftyFiveMeaning: "excluded_or_unknown" as const,
    includedPixelCount: 1,
    excludedPixelCount: SOURCE_PIXEL_COUNT - 1,
    reasonCounts: [
      {
        reasonCode: "unverified_or_unknown_pixels" as const,
        pixelCount: SOURCE_PIXEL_COUNT - 1,
      },
    ],
    publicationDurability: "directory_fsync" as const,
    immutableFrozen: true as const,
    reasonMap: {
      fileName: "reason-map-001.png",
      sha256: digest("reason-map-png"),
      byteLength: 9_100,
      widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
      heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
      bitDepth: 8 as const,
      channelCount: 1 as const,
      permittedPixelValues: [0, 1, 2, 3, 4, 5] as const,
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
      ],
    },
  };
}

function maskScope(
  renderGeneration = 2,
  browserEpochNonceSha256 = digest("browser-1"),
  coverageSegmentIdSha256 = digest("mask-segment-1"),
  custody = sourceCustody(1),
  sessionIdSha256 = digest("session"),
  registryBinding = registry,
): GrandHallT554NativeReviewMaskScopeV2 {
  return {
    schemaVersion: "venviewer.grand-hall-t554-native-review-journal-scope.v2",
    kind: "mask",
    sessionIdSha256,
    implementationManifest: implementation,
    registry: registryBinding,
    authorityBoundary: authority,
    browserEpochNonceSha256,
    coverageSegmentIdSha256,
    renderGeneration,
    sourceCustody: custody,
    maskReviewSubjectSha256: digest("mask-subject"),
    maskStateSha256: digest("mask-state"),
    frozenBindingSha256: digest("frozen-binding"),
    frozenBinding: frozenBinding(),
  };
}

function maskStart(
  scope: GrandHallT554NativeReviewMaskScopeV2,
  predecessorCoverage: unknown = null,
  coverageSegmentStartedAtUtc = "2026-08-27T00:00:00.000Z",
) {
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-domain-event.v2" as const,
    eventType: "mask.review-started.v2" as const,
    payload: {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-mask-review-started.v2" as const,
      browserEpochNonceSha256: scope.browserEpochNonceSha256,
      coverageSegmentIdSha256: scope.coverageSegmentIdSha256,
      coverageSegmentStartedAtUtc,
      firstSampleMustCreditZero: true as const,
      renderGeneration: scope.renderGeneration,
      sourceCustody: scope.sourceCustody,
      maskReviewSubjectSha256: scope.maskReviewSubjectSha256,
      maskStateSha256: scope.maskStateSha256,
      frozenBindingSha256: scope.frozenBindingSha256,
      frozenBinding: scope.frozenBinding,
      implementationManifest: implementation,
      predecessorCoverage,
      authorityBoundary: authority,
    },
  };
}

function offsetUtc(utc: string, deltaMs: number): string {
  return new Date(Date.parse(utc) + deltaMs).toISOString();
}

async function durableChildWorkspace(kind: "source" | "mask"): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "venviewer-t554-v2-replay-"));
  temporaryParents.push(parent);
  workspaceSequence += 1;
  const root = join(
    parent,
    `${kind}-child-${String(workspaceSequence).padStart(4, "0")}`,
  );
  await mkdir(root);
  return root;
}

async function sourceEvidence(
  scope: GrandHallT554NativeReviewSourceScopeV2,
  events: readonly unknown[],
  predecessorEvidence?: GrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2,
): Promise<GrandHallT554NativeReviewVerifiedDurableSourceChildJournalEvidenceV2> {
  const workspaceRoot = await durableChildWorkspace("source");
  const journal = await createGrandHallT554NativeReviewDurableJournalV2({
    workspaceRoot,
    scope,
  });
  for (const [index, event] of events.entries()) {
    await journal.append({
      expectedRevision: index,
      event,
      ...(index === 0 && predecessorEvidence !== undefined
        ? { predecessorEvidence }
        : {}),
    });
  }
  const evidence =
    await openGrandHallT554NativeReviewVerifiedDurableChildEvidenceV2({
      workspaceRoot,
      expectedScope: scope,
    });
  if (evidence.kind !== "source") throw new Error("source evidence drifted");
  return evidence;
}

async function maskEvidence(
  scope: GrandHallT554NativeReviewMaskScopeV2,
  events: readonly unknown[],
  predecessorEvidence?: GrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2,
): Promise<GrandHallT554NativeReviewVerifiedDurableMaskChildJournalEvidenceV2> {
  const workspaceRoot = await durableChildWorkspace("mask");
  const journal = await createGrandHallT554NativeReviewDurableJournalV2({
    workspaceRoot,
    scope,
  });
  for (const [index, event] of events.entries()) {
    await journal.append({
      expectedRevision: index,
      event,
      ...(index === 0 && predecessorEvidence !== undefined
        ? { predecessorEvidence }
        : {}),
    });
  }
  const evidence =
    await openGrandHallT554NativeReviewVerifiedDurableChildEvidenceV2({
      workspaceRoot,
      expectedScope: scope,
    });
  if (evidence.kind !== "mask") throw new Error("mask evidence drifted");
  return evidence;
}

function replaySourceSequence(
  scope: GrandHallT554NativeReviewSourceScopeV2,
  events: readonly unknown[],
) {
  return validateGrandHallT554NativeReviewSourceChildSequenceV2({
    scope,
    events,
  }).replay;
}

function replayMaskSequence(
  scope: GrandHallT554NativeReviewMaskScopeV2,
  events: readonly unknown[],
) {
  return validateGrandHallT554NativeReviewMaskChildSequenceV2({
    scope,
    events,
  }).replay;
}

async function sourceCarryFixture() {
  const priorScope = sourceScope();
  const priorEvents = [
    sourceStart(priorScope),
    delivery(priorScope, "source"),
    firstCoverage(priorScope, "source"),
  ];
  const evidence = await sourceEvidence(priorScope, priorEvents);
  const carry = createGrandHallT554NativeReviewCoverageCarryStateV2(evidence);
  if (carry.kind !== "source")
    throw new Error("source evidence emitted mask carry");
  return { carry, priorScope };
}

async function maskCarryFixture() {
  const priorScope = maskScope();
  const priorEvents = [
    maskStart(priorScope),
    delivery(priorScope, "mask"),
    firstCoverage(priorScope, "mask"),
  ];
  const evidence = await maskEvidence(priorScope, priorEvents);
  const carry = createGrandHallT554NativeReviewCoverageCarryStateV2(evidence);
  if (carry.kind !== "mask")
    throw new Error("mask evidence emitted source carry");
  return { carry, priorScope };
}

function replaySourceResume(
  resumedScope: GrandHallT554NativeReviewSourceScopeV2,
  predecessorCoverage: unknown,
  startedAtUtc: string,
) {
  return replaySourceSequence(resumedScope, [
    sourceStart(resumedScope, predecessorCoverage, startedAtUtc),
    firstCoverage(
      resumedScope,
      "source",
      0,
      EMPTY_BITMAP,
      EMPTY_BITMAP,
      offsetUtc(startedAtUtc, 1),
    ),
  ]);
}

function replayMaskResume(
  resumedScope: GrandHallT554NativeReviewMaskScopeV2,
  predecessorCoverage: unknown,
  startedAtUtc: string,
) {
  return replayMaskSequence(resumedScope, [
    maskStart(resumedScope, predecessorCoverage, startedAtUtc),
    firstCoverage(
      resumedScope,
      "mask",
      0,
      EMPTY_BITMAP,
      EMPTY_BITMAP,
      offsetUtc(startedAtUtc, 1),
    ),
  ]);
}

afterEach(async () => {
  await Promise.all(
    temporaryParents
      .splice(0)
      .map(async (root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Grand Hall T-554 typed native-review replay v2", () => {
  it("strictly replays durable delivery and native-grid dwell to completion witnesses", async () => {
    const scope = sourceScope();
    const first = firstCoverage(scope, "source");
    const second = coverageEvent(scope, "source", {
      sequence: 1,
      previous: first.payload.coverageEventSha256,
      monotonicElapsedMs: 500,
      receivedAtUtc: "2026-08-27T00:00:00.502Z",
      deliveredBitmap: tileBitmap(0),
      visibleBitmap: tileBitmap(0),
      creditedBitmap: tileBitmap(0),
      creditedDurationMs: 500,
      deltaMs: 500,
      disqualifier: null,
      dwellMsForTileZero: 500,
    });
    const third = coverageEvent(scope, "source", {
      sequence: 2,
      previous: second.payload.coverageEventSha256,
      monotonicElapsedMs: 750,
      receivedAtUtc: "2026-08-27T00:00:00.752Z",
      deliveredBitmap: tileBitmap(0),
      visibleBitmap: tileBitmap(0),
      creditedBitmap: tileBitmap(0),
      creditedDurationMs: 250,
      deltaMs: 250,
      disqualifier: null,
      dwellMsForTileZero: 750,
    });
    const replay = replayGrandHallT554NativeReviewSourceChildV2(
      await sourceEvidence(scope, [
        sourceStart(scope),
        delivery(scope, "source"),
        first,
        second,
        third,
      ]),
    );
    expect(replay.coverage).toMatchObject({
      kind: "source",
      childEventCount: 5,
      uniqueDeliveredTileCount: 1,
      coverageEventCount: 3,
      lastCoverageEventSha256: third.payload.coverageEventSha256,
      completedTileBitsetHex: tileBitmap(0),
      completedTileCount: 1,
      complete: false,
    });
  });

  it("rejects telemetry credit without earlier durable delivery", () => {
    const scope = sourceScope();
    const first = firstCoverage(scope, "source", 0, EMPTY_BITMAP, EMPTY_BITMAP);
    const forged = coverageEvent(scope, "source", {
      sequence: 1,
      previous: first.payload.coverageEventSha256,
      monotonicElapsedMs: 500,
      receivedAtUtc: "2026-08-27T00:00:00.502Z",
      deliveredBitmap: tileBitmap(0),
      visibleBitmap: tileBitmap(0),
      creditedBitmap: tileBitmap(0),
      creditedDurationMs: 500,
      deltaMs: 500,
      disqualifier: null,
      dwellMsForTileZero: 500,
    });
    expect(() =>
      replaySourceSequence(scope, [sourceStart(scope), first, forged]),
    ).toThrowError(expect.objectContaining({ code: "DERIVED_MISMATCH" }));
  });

  it("rejects a duplicate first-delivery event", () => {
    const scope = sourceScope();
    expect(() =>
      replaySourceSequence(scope, [
        sourceStart(scope),
        delivery(scope, "source"),
        delivery(scope, "source", 0, "2026-08-27T00:00:00.002Z"),
      ]),
    ).toThrowError(expect.objectContaining({ code: "TRANSITION_INVALID" }));
  });

  it("rejects a self-consistently rehashed derived coverage forgery", () => {
    const scope = sourceScope();
    const first = firstCoverage(scope, "source");
    const forgedMaterial: CoverageMaterial = {
      ...first.payload,
      derived: {
        ...first.payload.derived,
        cumulativeDwellStateSha256: digest("forged-dwell-state"),
      },
    };
    const forged = {
      ...first,
      payload: {
        ...forgedMaterial,
        coverageEventSha256:
          computeGrandHallT554NativeReviewCoverageEventV2Sha256(
            "source",
            forgedMaterial,
          ),
      },
    };
    expect(() =>
      replaySourceSequence(scope, [
        sourceStart(scope),
        delivery(scope, "source"),
        forged,
      ]),
    ).toThrowError(expect.objectContaining({ code: "DERIVED_MISMATCH" }));
  });

  it("rejects binding drift even when the event remains schema-valid", () => {
    const scope = sourceScope();
    const event = delivery(scope, "source");
    const drifted = {
      ...event,
      payload: { ...event.payload, subjectSha256: digest("other-subject") },
    };
    expect(() =>
      replaySourceSequence(scope, [sourceStart(scope), drifted]),
    ).toThrowError(expect.objectContaining({ code: "BINDING_MISMATCH" }));
  });

  it("recomputes a long heartbeat gap as zero-credit", () => {
    const scope = sourceScope();
    const first = firstCoverage(scope, "source");
    const gap = coverageEvent(scope, "source", {
      sequence: 1,
      previous: first.payload.coverageEventSha256,
      monotonicElapsedMs: 501,
      receivedAtUtc: "2026-08-27T00:00:00.503Z",
      deliveredBitmap: tileBitmap(0),
      visibleBitmap: tileBitmap(0),
      creditedBitmap: EMPTY_BITMAP,
      creditedDurationMs: 0,
      deltaMs: 501,
      disqualifier: "heartbeat_gap_exceeded",
      dwellMsForTileZero: 0,
    });
    const replay = replaySourceSequence(scope, [
      sourceStart(scope),
      delivery(scope, "source"),
      first,
      gap,
    ]);
    expect(replay.coverage.completedTileCount).toBe(0);
  });

  it("carries exact partial/completed dwell into a fresh zero-credit segment", async () => {
    const priorScope = sourceScope();
    const priorFirst = firstCoverage(priorScope, "source");
    const priorSecond = coverageEvent(priorScope, "source", {
      sequence: 1,
      previous: priorFirst.payload.coverageEventSha256,
      monotonicElapsedMs: 500,
      receivedAtUtc: "2026-08-27T00:00:00.502Z",
      deliveredBitmap: tileBitmap(0),
      visibleBitmap: tileBitmap(0),
      creditedBitmap: tileBitmap(0),
      creditedDurationMs: 500,
      deltaMs: 500,
      disqualifier: null,
      dwellMsForTileZero: 500,
    });
    const priorComplete = coverageEvent(priorScope, "source", {
      sequence: 2,
      previous: priorSecond.payload.coverageEventSha256,
      monotonicElapsedMs: 750,
      receivedAtUtc: "2026-08-27T00:00:00.752Z",
      deliveredBitmap: tileBitmap(0),
      visibleBitmap: tileBitmap(0),
      creditedBitmap: tileBitmap(0),
      creditedDurationMs: 250,
      deltaMs: 250,
      disqualifier: null,
      dwellMsForTileZero: 750,
    });
    const priorEvents = [
      sourceStart(priorScope),
      delivery(priorScope, "source"),
      priorFirst,
      priorSecond,
      priorComplete,
    ];
    const priorEvidence = await sourceEvidence(priorScope, priorEvents);
    const carry =
      createGrandHallT554NativeReviewCoverageCarryStateV2(priorEvidence);
    const resumedCustody = sourceCustody(2, "epoch-2");
    const resumedScope = sourceScope(
      2,
      digest("browser-2"),
      digest("segment-2"),
      resumedCustody,
    );
    const resumedStartedAtUtc = offsetUtc(
      priorEvidence.finalDurableRecordedAtUtc,
      1,
    );
    const resumedFirst = firstCoverage(
      resumedScope,
      "source",
      750,
      EMPTY_BITMAP,
      EMPTY_BITMAP,
      offsetUtc(resumedStartedAtUtc, 1),
    );
    const resumedEvidence = await sourceEvidence(
      resumedScope,
      [
        sourceStart(resumedScope, carry, resumedStartedAtUtc),
        resumedFirst,
      ],
      priorEvidence,
    );
    const resumed = replayGrandHallT554NativeReviewSourceChildV2(
      resumedEvidence,
    );
    expect(resumed.coverage).toMatchObject({
      uniqueDeliveredTileCount: 0,
      completedTileCount: 1,
      completedTileBitsetHex: tileBitmap(0),
    });
  });

  it("strictly binds mask-child replay to the frozen mask evidence", async () => {
    const scope = maskScope();
    const replay = replayGrandHallT554NativeReviewMaskChildV2(
      await maskEvidence(scope, [
        maskStart(scope),
        delivery(scope, "mask"),
        firstCoverage(scope, "mask"),
      ]),
    );
    expect(replay).toMatchObject({
      kind: "mask",
      coverage: { uniqueDeliveredTileCount: 1, coverageEventCount: 1 },
    });
    const driftedStart = maskStart(scope);
    driftedStart.payload.frozenBindingSha256 = digest("wrong-frozen");
    expect(() =>
      replayMaskSequence(scope, [driftedStart]),
    ).toThrowError(expect.objectContaining({ code: "BINDING_MISMATCH" }));
  });

  it("rejects wall-clock rollback inside a child journal", () => {
    const scope = sourceScope();
    expect(() =>
      replaySourceSequence(scope, [
        sourceStart(scope),
        delivery(scope, "source", 0, "2026-08-26T23:59:59.999Z"),
      ]),
    ).toThrowError(expect.objectContaining({ code: "CLOCK_INVALID" }));
  });

  it("rejects an unknown/self-consistently shaped domain event and excess inventory", () => {
    const scope = sourceScope();
    expect(() =>
      validateGrandHallT554NativeReviewSourceChildSequenceV2({
        scope,
        events: [
          {
            schemaVersion:
              "venviewer.grand-hall-t554-native-review-domain-event.v2",
            eventType: "source.accepted.v2",
            payload: {},
          },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: "EVENT_INVALID" }));
    expect(() =>
      validateGrandHallT554NativeReviewSourceChildSequenceV2({
        scope,
        events: Array.from({ length: 4_610 }, () => sourceStart(scope)),
      }),
    ).toThrowError(expect.objectContaining({ code: "EVENT_LIMIT_REACHED" }));
  });

  it("emits exact zero-dwell carry from branded start-only child evidence", async () => {
    const scope = sourceScope();
    const evidence = await sourceEvidence(scope, [sourceStart(scope)]);
    const replay = replayGrandHallT554NativeReviewSourceChildV2(evidence);
    expect(replay.coverage.coverageEventCount).toBe(0);
    expect(
      createGrandHallT554NativeReviewCoverageCarryStateV2(evidence),
    ).toMatchObject({
      kind: "source",
      predecessorJournal: evidence.checkpoint,
      completedTileCount: 0,
      completedTileBitsetHex: "0".repeat(128),
    });
    expect(emptyGrandHallT554NativeReviewDwellVectorV2()).toMatchObject({
      cappedDwellMsUint16LeBase64url: expect.any(String),
      cappedDwellBytesSha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
  });

  it("rejects structurally valid but unbranded or transplanted durable evidence", async () => {
    const scope = sourceScope();
    const branded = await sourceEvidence(scope, [sourceStart(scope)]);
    expect(replayGrandHallT554NativeReviewSourceChildV2(branded).kind).toBe(
      "source",
    );

    const cloned = structuredClone(branded);
    expect(() =>
      replayGrandHallT554NativeReviewSourceChildV2(cloned),
    ).toThrowError(expect.objectContaining({ code: "ARGUMENT_INVALID" }));
    const checkpointTransplant = {
      ...cloned,
      checkpoint: {
        ...cloned.checkpoint,
        leafName: "different-source-child",
      },
    };
    expect(() =>
      replayGrandHallT554NativeReviewSourceChildV2(checkpointTransplant),
    ).toThrowError(expect.objectContaining({ code: "ARGUMENT_INVALID" }));
  });

  it("exposes no durable-evidence minting factory under NODE_ENV=test", () => {
    expect(process.env.NODE_ENV).toBe("test");
    expect(durableJournalV2Module).not.toHaveProperty(
      "__testOnlyGrandHallT554NativeReviewDurableEvidenceV2",
    );
    expect(replayV2Module).not.toHaveProperty(
      "__testOnlyGrandHallT554NativeReviewReplayV2",
    );
  });

  it("domain-separates otherwise identical source and mask coverage material", () => {
    const event = firstCoverage(sourceScope(), "source");
    const { coverageEventSha256, ...material } = event.payload;
    expect(
      computeGrandHallT554NativeReviewCoverageEventV2Sha256("source", material),
    ).toBe(coverageEventSha256);
    expect(
      computeGrandHallT554NativeReviewCoverageEventV2Sha256("mask", material),
    ).not.toBe(coverageEventSha256);
  });

  it("rejects source carry transplanted across identity, epoch, generation, or time", async () => {
    const { carry, priorScope } = await sourceCarryFixture();
    const freshCustody = sourceCustody(2, "epoch-2");
    const freshScope = sourceScope(
      2,
      digest("browser-2"),
      digest("segment-2"),
      freshCustody,
    );
    const resumedStartedAtUtc = offsetUtc(
      carry.predecessorFinalDurableRecordedAtUtc,
      1,
    );
    expect(
      replaySourceResume(freshScope, carry, resumedStartedAtUtc).coverage
        .coverageEventCount,
    ).toBe(1);

    const changedRegistry = {
      ...carry,
      registry: {
        ...carry.registry,
        reviewPack: {
          ...carry.registry.reviewPack,
          semanticSha256: digest("changed-review-pack"),
        },
      },
    };
    const cases: ReadonlyArray<{
      readonly label: string;
      readonly scope: GrandHallT554NativeReviewSourceScopeV2;
      readonly carry: unknown;
      readonly startedAtUtc?: string;
      readonly code: "BINDING_MISMATCH" | "TRANSITION_INVALID";
    }> = [
      {
        label: "session",
        scope: freshScope,
        carry: { ...carry, sessionIdSha256: digest("another-session") },
        code: "BINDING_MISMATCH",
      },
      {
        label: "registry",
        scope: freshScope,
        carry: changedRegistry,
        code: "BINDING_MISMATCH",
      },
      {
        label: "browser epoch",
        scope: sourceScope(
          2,
          priorScope.browserEpochNonceSha256,
          digest("segment-2"),
          freshCustody,
        ),
        carry,
        code: "BINDING_MISMATCH",
      },
      {
        label: "coverage segment",
        scope: sourceScope(
          2,
          digest("browser-2"),
          priorScope.coverageSegmentIdSha256,
          freshCustody,
        ),
        carry,
        code: "BINDING_MISMATCH",
      },
      {
        label: "source epoch binding",
        scope: sourceScope(2, digest("browser-2"), digest("segment-2"), {
          ...freshCustody,
          sourceEpochBindingSha256: carry.priorSourceEpochBindingSha256,
        }),
        carry,
        code: "BINDING_MISMATCH",
      },
      {
        label: "source epoch nonce",
        scope: sourceScope(2, digest("browser-2"), digest("segment-2"), {
          ...freshCustody,
          sourceEpochNonceSha256: carry.priorSourceEpochNonceSha256,
        }),
        carry,
        code: "BINDING_MISMATCH",
      },
      {
        label: "render generation",
        scope: sourceScope(
          1,
          digest("browser-2"),
          digest("segment-2"),
          sourceCustody(1, "epoch-2"),
        ),
        carry,
        code: "TRANSITION_INVALID",
      },
      {
        label: "wall clock",
        scope: freshScope,
        carry,
        startedAtUtc: offsetUtc(
          carry.predecessorFinalDurableRecordedAtUtc,
          -1,
        ),
        code: "TRANSITION_INVALID",
      },
    ];
    for (const testCase of cases) {
      expect(
        () =>
          replaySourceResume(
            testCase.scope,
            testCase.carry,
            testCase.startedAtUtc ?? resumedStartedAtUtc,
          ),
        testCase.label,
      ).toThrowError(expect.objectContaining({ code: testCase.code }));
    }
  });

  it("rejects mask carry transplanted across identity, epoch, generation, or time", async () => {
    const { carry, priorScope } = await maskCarryFixture();
    const freshCustody = sourceCustody(2, "mask-epoch-2");
    const freshScope = maskScope(
      3,
      digest("mask-browser-2"),
      digest("mask-segment-2"),
      freshCustody,
    );
    const resumedStartedAtUtc = offsetUtc(
      carry.predecessorFinalDurableRecordedAtUtc,
      1,
    );
    expect(
      replayMaskResume(freshScope, carry, resumedStartedAtUtc).coverage
        .coverageEventCount,
    ).toBe(1);

    const changedRegistry = {
      ...carry,
      registry: {
        ...carry.registry,
        publicationReceipt: {
          ...carry.registry.publicationReceipt,
          fileSha256: digest("changed-receipt"),
        },
      },
    };
    const cases: ReadonlyArray<{
      readonly label: string;
      readonly scope: GrandHallT554NativeReviewMaskScopeV2;
      readonly carry: unknown;
      readonly startedAtUtc?: string;
      readonly code: "BINDING_MISMATCH" | "TRANSITION_INVALID";
    }> = [
      {
        label: "session",
        scope: freshScope,
        carry: { ...carry, sessionIdSha256: digest("another-mask-session") },
        code: "BINDING_MISMATCH",
      },
      {
        label: "registry",
        scope: freshScope,
        carry: changedRegistry,
        code: "BINDING_MISMATCH",
      },
      {
        label: "browser epoch",
        scope: maskScope(
          3,
          priorScope.browserEpochNonceSha256,
          digest("mask-segment-2"),
          freshCustody,
        ),
        carry,
        code: "BINDING_MISMATCH",
      },
      {
        label: "coverage segment",
        scope: maskScope(
          3,
          digest("mask-browser-2"),
          priorScope.coverageSegmentIdSha256,
          freshCustody,
        ),
        carry,
        code: "BINDING_MISMATCH",
      },
      {
        label: "source epoch binding",
        scope: maskScope(
          3,
          digest("mask-browser-2"),
          digest("mask-segment-2"),
          {
            ...freshCustody,
            sourceEpochBindingSha256: carry.priorSourceEpochBindingSha256,
          },
        ),
        carry,
        code: "BINDING_MISMATCH",
      },
      {
        label: "source epoch nonce",
        scope: maskScope(
          3,
          digest("mask-browser-2"),
          digest("mask-segment-2"),
          {
            ...freshCustody,
            sourceEpochNonceSha256: carry.priorSourceEpochNonceSha256,
          },
        ),
        carry,
        code: "BINDING_MISMATCH",
      },
      {
        label: "source generation",
        scope: maskScope(
          3,
          digest("mask-browser-2"),
          digest("mask-segment-2"),
          sourceCustody(1, "mask-epoch-2"),
        ),
        carry,
        code: "TRANSITION_INVALID",
      },
      {
        label: "mask render generation",
        scope: maskScope(
          2,
          digest("mask-browser-2"),
          digest("mask-segment-2"),
          freshCustody,
        ),
        carry,
        code: "TRANSITION_INVALID",
      },
      {
        label: "wall clock",
        scope: freshScope,
        carry,
        startedAtUtc: offsetUtc(
          carry.predecessorFinalDurableRecordedAtUtc,
          -1,
        ),
        code: "TRANSITION_INVALID",
      },
    ];
    for (const testCase of cases) {
      expect(
        () =>
          replayMaskResume(
            testCase.scope,
            testCase.carry,
            testCase.startedAtUtc ?? resumedStartedAtUtc,
          ),
        testCase.label,
      ).toThrowError(expect.objectContaining({ code: testCase.code }));
    }
  });
});
