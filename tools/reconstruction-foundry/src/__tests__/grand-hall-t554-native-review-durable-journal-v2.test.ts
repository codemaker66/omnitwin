import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_WIDTH_PX,
  type GrandHallPanoramaSourceJpgIdentityV2,
} from "@omnitwin/types";
import { toCanonicalJson } from "@omnitwin/reconstruction-foundry";
import { afterEach, describe, expect, it } from "vitest";

import { replayGrandHallT554NativeReviewCoordinatorV2 } from "../grand-hall-t554-native-review-coordinator-replay-v2.js";
import {
  createGrandHallT554NativeReviewDurableJournalV2,
  deriveGrandHallT554NativeReviewVerifiedDurableChildPrefixEvidenceV2,
  deriveGrandHallT554NativeReviewLowLevelScopeV2,
  GrandHallT554NativeReviewDurableJournalV2Error,
  isGrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2,
  openGrandHallT554NativeReviewDurableJournalV2,
  openGrandHallT554NativeReviewVerifiedDurableChildEvidenceV2,
} from "../grand-hall-t554-native-review-durable-journal-v2.js";
import {
  GRAND_HALL_T554_NATIVE_REVIEW_DOMAIN_EVENT_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_V2,
  type GrandHallT554NativeReviewCoverageObservedPayloadV2,
  type GrandHallT554NativeReviewFrozenMaskBindingV2,
  type GrandHallT554NativeReviewMaskScopeV2,
  type GrandHallT554NativeReviewSessionScopeV2,
  type GrandHallT554NativeReviewSourceCustodyBindingV2,
  type GrandHallT554NativeReviewSourceScopeV2,
} from "../grand-hall-t554-native-review-events-v2.js";
import { openGrandHallT554NativeReviewJournal } from "../grand-hall-t554-native-review-journal.js";
import {
  computeGrandHallT554NativeReviewCoverageEventV2Sha256,
  createGrandHallT554NativeReviewCoverageCarryStateV2,
  emptyGrandHallT554NativeReviewTileBitmapV2,
  replayGrandHallT554NativeReviewMaskChildV2,
  replayGrandHallT554NativeReviewSourceChildV2,
} from "../grand-hall-t554-native-review-replay-v2.js";

const PIXEL_COUNT =
  GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX;
const EMPTY_TILE_BITMAP = emptyGrandHallT554NativeReviewTileBitmapV2();
const temporaryParents: string[] = [];

type Sha256 = `sha256:${string}`;
type CoverageMaterial = Omit<
  GrandHallT554NativeReviewCoverageObservedPayloadV2,
  "coverageEventSha256"
>;

function digest(seed: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(seed).digest("hex")}`;
}

function bytesSha256(bytes: Buffer): Sha256 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function dwellStateSha256(bytes: Buffer): Sha256 {
  return bytesSha256(
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
  for (const index of indexes) {
    const offset = Math.floor(index / 8);
    bytes[offset] = (bytes[offset] ?? 0) | (1 << (index % 8));
  }
  return bytes.toString("hex");
}

function artifact(seed: string) {
  return {
    semanticSha256: digest(`${seed}-semantic`),
    fileSha256: digest(`${seed}-file`),
    byteLength: 1_024,
  };
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

const implementation = {
  schemaVersion:
    "venviewer.grand-hall-t554-native-review-implementation-manifest-binding.v2" as const,
  implementationId: "grand-hall-t554-native-review-workbench-v1" as const,
  semanticSha256: digest("implementation-semantic"),
  fileSha256: digest("implementation-file"),
  byteLength: 8_192,
};

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

const source: GrandHallPanoramaSourceJpgIdentityV2 = {
  inventoryIndex: 0,
  sweepNumber: 1,
  fileName: "sweep_001jpg.jpg",
  sha256: digest("source"),
  byteLength: 6_419_919,
  widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
  heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
};

function custody(
  generation = 1,
): GrandHallT554NativeReviewSourceCustodyBindingV2 {
  return {
    source,
    sourceVerification: {
      fileName: source.fileName,
      sha256: digest("source"),
      byteLength: source.byteLength,
      widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
      heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
      decodedChannelCount: 3 as const,
      decodedBitsPerSample: 8 as const,
      alphaPresent: false as const,
      orientationMetadataPresent: false as const,
      decodedPixelSha256: digest("decoded"),
      decoderIdentity: {
        schemaVersion:
          "venviewer.grand-hall-t554-source-jpeg-decoder-identity.v1" as const,
        library: "sharp" as const,
        sharpVersion: "0.35.3",
        libvipsVersion: "8.18.3",
        pipeline: "captured-jpeg-buffer-to-unrotated-rgb8.v1" as const,
      },
      descriptorWitnessSha256: digest("descriptor"),
      sameOpenDescriptorHashedAndDecoded: true as const,
      fullJpegDecodeCompleted: true as const,
    },
    sourceReviewSubjectSha256: digest("source-subject"),
    sourceEpochBindingSha256: digest(
      `source-epoch-binding-${String(generation)}`,
    ),
    sourceEpochNonceSha256: digest(`source-epoch-nonce-${String(generation)}`),
    sourceEpochRenderGeneration: generation,
  };
}

function sourceScope(
  generation = 1,
  browserEpochNonceSha256 = digest("browser-1"),
  coverageSegmentIdSha256 = digest("source-segment-1"),
  sourceCustody = custody(generation),
): GrandHallT554NativeReviewSourceScopeV2 {
  return {
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_V2,
    kind: "source",
    sessionIdSha256: digest("session"),
    implementationManifest: implementation,
    registry,
    authorityBoundary: authority,
    browserEpochNonceSha256,
    coverageSegmentIdSha256,
    renderGeneration: generation,
    sourceCustody,
  };
}

function sourceStart(
  scope: GrandHallT554NativeReviewSourceScopeV2,
  predecessorCoverage: unknown = null,
  coverageSegmentStartedAtUtc = "2000-01-01T00:00:00.000Z",
) {
  return {
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_DOMAIN_EVENT_V2,
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
      registry: scope.registry,
      implementationManifest: scope.implementationManifest,
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
      authorityBoundary: scope.authorityBoundary,
    },
  };
}

function sourceDelivery(
  scope: GrandHallT554NativeReviewSourceScopeV2,
  tileIndex = 0,
  responseFinishedAtUtc = "2000-01-01T00:00:00.001Z",
) {
  return {
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_DOMAIN_EVENT_V2,
    eventType: "source.tile-delivered.v2" as const,
    payload: {
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
      responseFinishedAtUtc,
    },
  };
}

function sourceFirstCoverage(
  scope: GrandHallT554NativeReviewSourceScopeV2,
) {
  const dwellBytes = Buffer.alloc(1_024);
  const material: CoverageMaterial = {
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
      paintedTileBitsetHex: tileBitmap(0),
    },
    derived: {
      effectiveDevicePixelsPerSourcePixel: 1,
      serverMonotonicDeltaMs: 0,
      deliveredTileBitsetHex: tileBitmap(0),
      fullyVisibleDeliveredTileBitsetHex: tileBitmap(0),
      creditedTileBitsetHex: EMPTY_TILE_BITMAP,
      creditedDurationMs: 0,
      disqualifier: "first_sample",
      completedTileBitsetHex: EMPTY_TILE_BITMAP,
      completedTileCount: 0,
      cumulativeDwellStateSha256: dwellStateSha256(dwellBytes),
    },
  };
  dwellBytes.fill(0);
  return {
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_DOMAIN_EVENT_V2,
    eventType: "source.coverage-observed.v2" as const,
    payload: {
      ...material,
      coverageEventSha256:
        computeGrandHallT554NativeReviewCoverageEventV2Sha256(
          "source",
          material,
        ),
    },
  };
}

function frozenBinding(): GrandHallT554NativeReviewFrozenMaskBindingV2 {
  return {
    schemaVersion: "venviewer.grand-hall-t554-native-mask-frozen-binding.v2",
    source,
    revision: 1,
    fileName: "grand-hall-mask.png",
    sha256: digest("mask-png"),
    byteLength: 50_000,
    widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
    heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
    bitDepth: 8,
    channelCount: 1,
    permittedPixelValues: [0, 255],
    zeroMeaning: "grand_hall_included",
    twoHundredFiftyFiveMeaning: "excluded_or_unknown",
    includedPixelCount: 1,
    excludedPixelCount: PIXEL_COUNT - 1,
    reasonCounts: [
      {
        reasonCode: "unverified_or_unknown_pixels",
        pixelCount: PIXEL_COUNT - 1,
      },
    ],
    publicationDurability: "directory_fsync",
    immutableFrozen: true,
    reasonMap: {
      fileName: "grand-hall-reason-map.png",
      sha256: digest("reason-map"),
      byteLength: 60_000,
      widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
      heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
      bitDepth: 8,
      channelCount: 1,
      permittedPixelValues: [0, 1, 2, 3, 4, 5],
      zeroMeaning: "grand_hall_included",
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
}

function maskScope(): GrandHallT554NativeReviewMaskScopeV2 {
  return {
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_V2,
    kind: "mask",
    sessionIdSha256: digest("session"),
    implementationManifest: implementation,
    registry,
    authorityBoundary: authority,
    browserEpochNonceSha256: digest("browser-1"),
    coverageSegmentIdSha256: digest("mask-segment-1"),
    renderGeneration: 2,
    sourceCustody: custody(),
    maskReviewSubjectSha256: digest("mask-subject"),
    maskStateSha256: digest("mask-state"),
    frozenBindingSha256: digest("frozen-binding"),
    frozenBinding: frozenBinding(),
  };
}

function maskStart(scope: GrandHallT554NativeReviewMaskScopeV2) {
  return {
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_DOMAIN_EVENT_V2,
    eventType: "mask.review-started.v2" as const,
    payload: {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-mask-review-started.v2" as const,
      browserEpochNonceSha256: scope.browserEpochNonceSha256,
      coverageSegmentIdSha256: scope.coverageSegmentIdSha256,
      coverageSegmentStartedAtUtc: "2000-01-01T00:00:00.000Z",
      firstSampleMustCreditZero: true as const,
      renderGeneration: scope.renderGeneration,
      sourceCustody: scope.sourceCustody,
      maskReviewSubjectSha256: scope.maskReviewSubjectSha256,
      maskStateSha256: scope.maskStateSha256,
      frozenBindingSha256: scope.frozenBindingSha256,
      frozenBinding: scope.frozenBinding,
      implementationManifest: scope.implementationManifest,
      predecessorCoverage: null,
      authorityBoundary: scope.authorityBoundary,
    },
  };
}

function sessionScope(): GrandHallT554NativeReviewSessionScopeV2 {
  return {
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_V2,
    kind: "session",
    sessionIdSha256: digest("session"),
    subjectSha256: digest("session-subject"),
    implementationManifest: implementation,
    registry,
    authorityBoundary: authority,
  };
}

function sessionCreated(scope: GrandHallT554NativeReviewSessionScopeV2) {
  return {
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_DOMAIN_EVENT_V2,
    eventType: "session.created.v2" as const,
    payload: {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-session-created.v2" as const,
      sessionIdSha256: scope.sessionIdSha256,
      workspaceRevision: 0 as const,
      maximumAllocatedRenderGeneration: 0 as const,
      registry: scope.registry,
      implementationManifest: scope.implementationManifest,
      authorityBoundary: scope.authorityBoundary,
    },
  };
}

async function workspace(leafName: string): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "venviewer-t554-v2-journal-"));
  temporaryParents.push(parent);
  const root = join(parent, leafName);
  await mkdir(root);
  return root;
}

async function verifiedSourcePredecessor() {
  const root = await workspace("source-child-predecessor");
  const scope = sourceScope();
  const journal = await createGrandHallT554NativeReviewDurableJournalV2({
    workspaceRoot: root,
    scope,
  });
  await journal.append({ expectedRevision: 0, event: sourceStart(scope) });
  await journal.append({ expectedRevision: 1, event: sourceDelivery(scope) });
  await journal.append({
    expectedRevision: 2,
    event: sourceFirstCoverage(scope),
  });
  const evidence =
    await openGrandHallT554NativeReviewVerifiedDurableChildEvidenceV2({
      workspaceRoot: root,
      expectedScope: scope,
    });
  if (evidence.kind !== "source") {
    throw new Error("Verified source predecessor evidence changed kind.");
  }
  expect(
    replayGrandHallT554NativeReviewSourceChildV2(evidence).coverage
      .coverageEventCount,
  ).toBe(1);
  return { evidence, scope };
}

afterEach(async () => {
  await Promise.all(
    temporaryParents
      .splice(0)
      .map(async (root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Grand Hall T-554 durable journal v2 adapter", () => {
  it("round-trips exact source events into non-forgeable replay evidence", async () => {
    const root = await workspace("source-child-0001");
    const scope = sourceScope();
    const journal = await createGrandHallT554NativeReviewDurableJournalV2({
      workspaceRoot: root,
      scope,
    });
    await journal.append({ expectedRevision: 0, event: sourceStart(scope) });

    const durable = await journal.replay();
    expect(durable).toMatchObject({
      scope,
      revision: 1,
      events: [sourceStart(scope)],
    });
    expect(durable.journalInventorySha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(Object.isFrozen(durable.records[0])).toBe(true);

    const evidence =
      await openGrandHallT554NativeReviewVerifiedDurableChildEvidenceV2({
        workspaceRoot: root,
        expectedScope: scope,
      });
    expect(
      isGrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2(
        evidence,
      ),
    ).toBe(true);
    expect(evidence).toMatchObject({
      kind: "source",
      checkpoint: {
        leafName: "source-child-0001",
        revision: 1,
        scopeSha256: durable.lowLevelScopeSha256,
        scopeFileSha256: durable.lowLevelScopeFileSha256,
        headEventSha256: durable.headEventSha256,
        journalInventorySha256: durable.journalInventorySha256,
      },
    });
    if (evidence.kind !== "source") throw new Error("source evidence drifted");
    expect(
      replayGrandHallT554NativeReviewSourceChildV2(evidence),
    ).toMatchObject({
      kind: "source",
      coverage: { childEventCount: 1, coverageEventCount: 0 },
    });

    const cloned = structuredClone(evidence);
    expect(() => replayGrandHallT554NativeReviewSourceChildV2(cloned)).toThrow(
      expect.objectContaining({ code: "ARGUMENT_INVALID" }),
    );
  });

  it("derives branded exact historical-prefix evidence without trusting caller JSON", async () => {
    const root = await workspace("source-child-prefix");
    const scope = sourceScope();
    const journal = await createGrandHallT554NativeReviewDurableJournalV2({
      workspaceRoot: root,
      scope,
    });
    await journal.append({ expectedRevision: 0, event: sourceStart(scope) });
    await journal.append({ expectedRevision: 1, event: sourceDelivery(scope) });
    await journal.append({ expectedRevision: 2, event: sourceFirstCoverage(scope) });
    const evidence =
      await openGrandHallT554NativeReviewVerifiedDurableChildEvidenceV2({
        workspaceRoot: root,
        expectedScope: scope,
      });
    const prefix =
      await deriveGrandHallT554NativeReviewVerifiedDurableChildPrefixEvidenceV2({
        evidence,
        revision: 1,
      });
    expect(prefix.checkpoint).toMatchObject({
      leafName: "source-child-prefix",
      revision: 1,
    });
    expect(prefix.events).toEqual([sourceStart(scope)]);
    expect(prefix.checkpoint.journalInventorySha256).not.toBe(
      evidence.checkpoint.journalInventorySha256,
    );
    expect(
      isGrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2(prefix),
    ).toBe(true);
    expect(evidence.checkpoint.revision).toBe(3);

    const forged = structuredClone(evidence);
    await expect(
      deriveGrandHallT554NativeReviewVerifiedDurableChildPrefixEvidenceV2({
        evidence: forged,
        revision: 1,
      }),
    ).rejects.toMatchObject({ code: "ARGUMENT_INVALID" });
  });

  it("round-trips exact mask evidence through the independent mask branch", async () => {
    const root = await workspace("mask-child-0001");
    const scope = maskScope();
    const journal = await createGrandHallT554NativeReviewDurableJournalV2({
      workspaceRoot: root,
      scope,
    });
    await journal.append({ expectedRevision: 0, event: maskStart(scope) });
    const evidence =
      await openGrandHallT554NativeReviewVerifiedDurableChildEvidenceV2({
        workspaceRoot: root,
        expectedScope: scope,
      });
    expect(evidence.kind).toBe("mask");
    if (evidence.kind !== "mask") throw new Error("mask evidence drifted");
    expect(replayGrandHallT554NativeReviewMaskChildV2(evidence)).toMatchObject({
      kind: "mask",
      coverage: { childEventCount: 1 },
    });
  });

  it("refuses to issue child evidence for an empty journal", async () => {
    const root = await workspace("source-child-empty");
    const scope = sourceScope();
    await createGrandHallT554NativeReviewDurableJournalV2({
      workspaceRoot: root,
      scope,
    });
    await expect(
      openGrandHallT554NativeReviewVerifiedDurableChildEvidenceV2({
        workspaceRoot: root,
        expectedScope: scope,
      }),
    ).rejects.toMatchObject({ code: "EMPTY_CHILD_JOURNAL" });
  });

  it("enforces scope kind, exactly one child start, and revision CAS before persistence", async () => {
    const root = await workspace("source-child-guarded");
    const scope = sourceScope();
    const journal = await createGrandHallT554NativeReviewDurableJournalV2({
      workspaceRoot: root,
      scope,
    });
    await expect(
      journal.append({ expectedRevision: 0, event: maskStart(maskScope()) }),
    ).rejects.toMatchObject({ code: "EVENT_INVALID" });
    await journal.append({ expectedRevision: 0, event: sourceStart(scope) });
    await expect(
      journal.append({ expectedRevision: 1, event: sourceStart(scope) }),
    ).rejects.toMatchObject({ code: "EVENT_INVALID" });
    await expect(
      journal.append({ expectedRevision: 0, event: sourceStart(scope) }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect((await journal.replay()).revision).toBe(1);
  });

  it("rejects unrelated branded predecessor evidence on a fresh start before persistence", async () => {
    const { evidence } = await verifiedSourcePredecessor();
    const root = await workspace("source-child-fresh-evidence-rejected");
    const scope = sourceScope(
      2,
      digest("fresh-browser-2"),
      digest("fresh-segment-2"),
      custody(2),
    );
    const journal = await createGrandHallT554NativeReviewDurableJournalV2({
      workspaceRoot: root,
      scope,
    });
    await expect(
      journal.append({
        expectedRevision: 0,
        event: sourceStart(scope),
        predecessorEvidence: evidence,
      }),
    ).rejects.toMatchObject({ code: "BINDING_MISMATCH" });
    expect((await journal.replay()).revision).toBe(0);
  });

  it("rejects a non-null self-consistent carry without branded predecessor evidence", async () => {
    const { evidence } = await verifiedSourcePredecessor();
    const carry =
      createGrandHallT554NativeReviewCoverageCarryStateV2(evidence);
    const root = await workspace("source-child-carry-without-evidence");
    const scope = sourceScope(
      2,
      digest("resume-browser-2"),
      digest("resume-segment-2"),
      custody(2),
    );
    const journal = await createGrandHallT554NativeReviewDurableJournalV2({
      workspaceRoot: root,
      scope,
    });
    await expect(
      journal.append({
        expectedRevision: 0,
        event: sourceStart(
          scope,
          carry,
          evidence.finalDurableRecordedAtUtc,
        ),
      }),
    ).rejects.toMatchObject({ code: "BINDING_MISMATCH" });
    expect((await journal.replay()).revision).toBe(0);
  });

  it("accepts exact carry only with its real verified predecessor journal evidence", async () => {
    const { evidence } = await verifiedSourcePredecessor();
    const carry =
      createGrandHallT554NativeReviewCoverageCarryStateV2(evidence);
    const root = await workspace("source-child-carry-with-evidence");
    const scope = sourceScope(
      2,
      digest("verified-resume-browser-2"),
      digest("verified-resume-segment-2"),
      custody(2),
    );
    const journal = await createGrandHallT554NativeReviewDurableJournalV2({
      workspaceRoot: root,
      scope,
    });
    const resumed = await journal.append({
      expectedRevision: 0,
      event: sourceStart(
        scope,
        carry,
        evidence.finalDurableRecordedAtUtc,
      ),
      predecessorEvidence: evidence,
    });
    expect(resumed.revision).toBe(1);
    expect(resumed.events[0]).toEqual(
      sourceStart(scope, carry, evidence.finalDurableRecordedAtUtc),
    );
  });

  it("replays the complete candidate child sequence before reserving bytes", async () => {
    const root = await workspace("source-child-sequence-guarded");
    const scope = sourceScope();
    const journal = await createGrandHallT554NativeReviewDurableJournalV2({
      workspaceRoot: root,
      scope,
    });
    await journal.append({ expectedRevision: 0, event: sourceStart(scope) });
    await journal.append({
      expectedRevision: 1,
      event: sourceDelivery(scope),
    });

    await expect(
      journal.append({
        expectedRevision: 2,
        event: sourceDelivery(scope, 0, "2000-01-01T00:00:00.002Z"),
      }),
    ).rejects.toMatchObject({ code: "TRANSITION_INVALID" });
    expect((await journal.replay()).revision).toBe(2);
  });

  it("refuses a durable record whose clock precedes its server-owned event", async () => {
    const root = await workspace("source-child-clock-guarded");
    const scope = sourceScope();
    const journal = await createGrandHallT554NativeReviewDurableJournalV2({
      workspaceRoot: root,
      scope,
    });
    await journal.append({ expectedRevision: 0, event: sourceStart(scope) });

    await expect(
      journal.append({
        expectedRevision: 1,
        event: sourceDelivery(scope, 0, "2999-01-01T00:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "JOURNAL_INVALID" });
    expect((await journal.replay()).revision).toBe(1);
  });

  it("persists and strictly replays coordinator events without accepting impossible duplicates", async () => {
    const root = await workspace("coordinator");
    const scope = sessionScope();
    const journal = await createGrandHallT554NativeReviewDurableJournalV2({
      workspaceRoot: root,
      scope,
    });
    await journal.append({ expectedRevision: 0, event: sessionCreated(scope) });
    const replay = await journal.replay();
    expect(
      replayGrandHallT554NativeReviewCoordinatorV2({
        scope,
        events: replay.events,
      }),
    ).toMatchObject({ lifecycle: "active", eventCount: 1 });

    await expect(
      journal.append({ expectedRevision: 1, event: sessionCreated(scope) }),
    ).rejects.toMatchObject({ code: "TRANSITION_INVALID" });
    expect((await journal.replay()).revision).toBe(1);
  });

  it("rejects replay-invalid child bytes written through the low-level journal API", async () => {
    const root = await workspace("source-child-low-level-poisoned");
    const scope = sourceScope();
    const journal = await createGrandHallT554NativeReviewDurableJournalV2({
      workspaceRoot: root,
      scope,
    });
    await journal.append({ expectedRevision: 0, event: sourceStart(scope) });

    const lowLevel = await openGrandHallT554NativeReviewJournal({
      workspaceRoot: root,
      expectedScope: deriveGrandHallT554NativeReviewLowLevelScopeV2(scope),
    });
    await lowLevel.append({
      expectedRevision: 1,
      eventType: "source.review-started.v2",
      payload: toCanonicalJson({
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-durable-scoped-event.v2",
        scopedEvent: { scope, event: sourceStart(scope) },
      }),
    });

    await expect(journal.replay()).rejects.toMatchObject({
      code: "TRANSITION_INVALID",
    });
    await expect(
      openGrandHallT554NativeReviewDurableJournalV2({
        workspaceRoot: root,
        expectedScope: scope,
      }),
    ).rejects.toMatchObject({ code: "TRANSITION_INVALID" });
  });

  it("cryptographically changes the low-level scope binding for registry drift", async () => {
    const scope = sourceScope();
    const changed = {
      ...scope,
      registry: {
        ...scope.registry,
        reviewPack: {
          ...scope.registry.reviewPack,
          fileSha256: digest("changed-review-pack"),
        },
      },
    };
    expect(
      deriveGrandHallT554NativeReviewLowLevelScopeV2(changed).sourceEpochSha256,
    ).not.toBe(
      deriveGrandHallT554NativeReviewLowLevelScopeV2(scope).sourceEpochSha256,
    );

    const root = await workspace("source-child-bound");
    await createGrandHallT554NativeReviewDurableJournalV2({
      workspaceRoot: root,
      scope,
    });
    await expect(
      openGrandHallT554NativeReviewDurableJournalV2({
        workspaceRoot: root,
        expectedScope: changed,
      }),
    ).rejects.toBeDefined();
  });

  it("rejects unsafe workspace leaf names before they can become checkpoint identity", async () => {
    const parent = await mkdtemp(
      join(tmpdir(), "venviewer-t554-v2-journal-unsafe-"),
    );
    temporaryParents.push(parent);
    const root = join(parent, "unsafe leaf");
    await mkdir(root);
    await expect(
      createGrandHallT554NativeReviewDurableJournalV2({
        workspaceRoot: root,
        scope: sourceScope(),
      }),
    ).rejects.toBeInstanceOf(GrandHallT554NativeReviewDurableJournalV2Error);

    const dotDotRoot = join(parent, "source..child");
    await mkdir(dotDotRoot);
    await expect(
      createGrandHallT554NativeReviewDurableJournalV2({
        workspaceRoot: dotDotRoot,
        scope: sourceScope(),
      }),
    ).rejects.toBeInstanceOf(GrandHallT554NativeReviewDurableJournalV2Error);
  });
});
