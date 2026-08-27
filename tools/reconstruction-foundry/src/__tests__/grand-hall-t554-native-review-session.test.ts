import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  CanonicalJsonValueSchema,
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_WIDTH_PX,
  GRAND_HALL_SUPPLIED_PANORAMA_SWEEP_NUMBERS,
  stableCanonicalJson,
  type GrandHallPanoramaSourceJpgIdentityV2,
} from "@omnitwin/types";
import { afterEach, describe, expect, it } from "vitest";

import { GrandHallT554NativeReviewCoverageControllerV1 } from
  "../grand-hall-t554-native-review-coverage.js";
import type {
  GrandHallT554NativeMaskFrozenBinding,
  GrandHallT554NativeMaskStoreConfig,
} from "../grand-hall-t554-native-review-mask-store.js";
import type { GrandHallT554NativeReviewRegistrySource } from
  "../grand-hall-t554-native-review-registry.js";
import {
  GrandHallT554NativeReviewSessionError,
  __testOnlyGrandHallT554NativeReviewSessionV1,
  type GrandHallT554NativeReviewSessionDependenciesV1,
  type GrandHallT554NativeReviewSessionPublicSnapshotV1,
  type GrandHallT554NativeReviewSessionRegistryV1,
} from "../grand-hall-t554-native-review-session.js";
import type {
  GrandHallT554NativeSourceEpochBindingsV1,
  GrandHallT554NativeSourceEpochSnapshotV1,
} from
  "../grand-hall-t554-native-source-epoch.js";

const SOURCE_RGB_TILE_BYTES = 256 * 256 * 3;
const MASK_PIXEL_COUNT = GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX;
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (root) => {
    await rm(root, { force: true, recursive: true });
  }));
});

function digest(seed: string | Buffer): `sha256:${string}` {
  const bytes = typeof seed === "string" ? Buffer.from(seed, "utf8") : seed;
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function exactDigest(value: string): `sha256:${string}` {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) throw new Error("fixture digest is not canonical");
  return `sha256:${value.slice("sha256:".length)}`;
}

function epochBindingDigest(
  bindings: GrandHallT554NativeSourceEpochBindingsV1,
  sourceVerification: GrandHallT554NativeSourceEpochSnapshotV1["sourceVerification"],
): `sha256:${string}` {
  const canonical = CanonicalJsonValueSchema.parse({ bindings, sourceVerification });
  return digest(Buffer.from(
    `VENVIEWER_GRAND_HALL_T554_NATIVE_SOURCE_EPOCH_BINDING_V1\n${stableCanonicalJson(canonical)}`,
    "utf8",
  ));
}

function nonce(fill: number): string {
  return Buffer.alloc(32, fill).toString("base64url");
}

function sourceAt(inventoryIndex: number): GrandHallT554NativeReviewRegistrySource {
  const sweepNumber = GRAND_HALL_SUPPLIED_PANORAMA_SWEEP_NUMBERS[inventoryIndex];
  if (sweepNumber === undefined) throw new Error("fixture inventory index is outside 148 rows");
  return {
    source: {
      inventoryIndex,
      sweepNumber,
      fileName: `sweep_${String(sweepNumber).padStart(3, "0")}jpg.jpg`,
      sha256: digest(`source-${String(inventoryIndex)}`),
      byteLength: 1_000_000 + inventoryIndex,
      widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
      heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
    },
    observation: {
      state: "grand_hall_pixels_observed_human_pending",
      proposedDisposition: "include_with_binary_pixel_mask",
      maskAuthoringState: "required_not_authored",
    },
    observationBasis: "agent_visual_inspection_of_digest_bound_source_panorama",
  };
}

function registryFor(panoramaSourceRoot: string): GrandHallT554NativeReviewSessionRegistryV1 {
  return {
    summary: {
      venueSlug: "trades-hall",
      roomSlug: "grand-hall",
      sourceCount: 148,
      reviewPackSha256: digest("review-pack-semantic"),
      reviewPackFileSha256: digest("review-pack-file"),
      reviewPackFileByteLength: 10_000,
      publicationReceiptSha256: digest("receipt-semantic"),
      publicationReceiptFileSha256: digest("receipt-file"),
      publicationReceiptFileByteLength: 2_000,
      authority: "none",
      reviewState: "human_pending",
      acceptanceAuthorized: false,
      reconstructionAuthorized: false,
      runtimeAuthorized: false,
      generatedContentAuthorized: false,
    },
    sourceAt,
    mediaInputAt: (inventoryIndex) => {
      const source = sourceAt(inventoryIndex).source;
      return {
        sourceRoot: panoramaSourceRoot,
        fileName: source.fileName,
        expectedSha256: source.sha256,
        expectedByteLength: source.byteLength,
      };
    },
  };
}

class FakeEpoch {
  readonly bindings: GrandHallT554NativeSourceEpochBindingsV1;
  readonly source: GrandHallPanoramaSourceJpgIdentityV2;
  readonly sourceEpochNonce: string;
  readonly renderGeneration: number;
  readonly epochBindingSha256: `sha256:${string}`;
  abandoned = false;
  failAbandon = false;

  constructor(bindings: GrandHallT554NativeSourceEpochBindingsV1) {
    this.bindings = structuredClone(bindings);
    this.source = bindings.source;
    this.sourceEpochNonce = bindings.sourceEpochNonce;
    this.renderGeneration = bindings.renderGeneration;
    this.epochBindingSha256 = epochBindingDigest(bindings, this.sourceVerification());
  }

  private sourceVerification(): GrandHallT554NativeSourceEpochSnapshotV1["sourceVerification"] {
    return {
      fileName: this.source.fileName,
      sha256: exactDigest(this.source.sha256),
      byteLength: this.source.byteLength,
      widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
      heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
      decodedChannelCount: 3,
      decodedBitsPerSample: 8,
      alphaPresent: false,
      orientationMetadataPresent: false,
      decodedPixelSha256: digest(`decoded-${this.source.fileName}`),
      decoderIdentity: {
        schemaVersion: "venviewer.grand-hall-t554-source-jpeg-decoder-identity.v1",
        library: "sharp",
        sharpVersion: "fixture-sharp-1",
        libvipsVersion: "fixture-libvips-1",
        pipeline: "captured-jpeg-buffer-to-unrotated-rgb8.v1",
      },
      descriptorWitnessSha256: digest(`descriptor-${this.source.fileName}`),
      sameOpenDescriptorHashedAndDecoded: true,
      fullJpegDecodeCompleted: true,
    };
  }

  snapshot(): GrandHallT554NativeSourceEpochSnapshotV1 {
    return {
      schemaVersion: "venviewer.grand-hall-t554-native-source-epoch.v1",
      lifecycle: this.abandoned ? "closed" : "active",
      closedDisposition: this.abandoned ? "abandoned" : null,
      sourceEpochNonce: this.sourceEpochNonce,
      sourceEpochNonceSha256: digest(this.sourceEpochNonce),
      renderGeneration: this.renderGeneration,
      epochBindingSha256: this.epochBindingSha256,
      reviewPack: this.bindings.reviewPack,
      publicationReceipt: this.bindings.publicationReceipt,
      workbenchImplementationManifest: this.bindings.workbenchImplementationManifest,
      source: this.source,
      sourceVerification: this.sourceVerification(),
      tileGrid: {
        widthPx: 256,
        heightPx: 256,
        columnCount: 32,
        rowCount: 16,
        channelCount: 3,
        bytesPerTile: SOURCE_RGB_TILE_BYTES,
        resampling: "none",
      },
    };
  }

  copyTile(): Buffer {
    if (this.abandoned) throw new Error("fake epoch was abandoned");
    return Buffer.alloc(SOURCE_RGB_TILE_BYTES, this.source.inventoryIndex + 1);
  }

  abandon(): Promise<void> {
    this.abandoned = true;
    return this.failAbandon
      ? Promise.reject(new Error("injected epoch cleanup failure"))
      : Promise.resolve();
  }
}

class FakeMaskStore {
  readonly source: GrandHallPanoramaSourceJpgIdentityV2;
  revision = 0;
  frozen: GrandHallT554NativeMaskFrozenBinding | null = null;
  abandoned = false;
  editCount = 0;

  constructor(config: GrandHallT554NativeMaskStoreConfig) {
    this.source = config.source;
  }

  snapshot(): {
    readonly revision: number;
    readonly activeFrozenBinding: GrandHallT554NativeMaskFrozenBinding | null;
  } {
    if (this.abandoned) throw new Error("fake mask store was abandoned");
    return { revision: this.revision, activeFrozenBinding: this.frozen };
  }

  pixelForServerRender(): { readonly value: 0 | 255 } {
    if (this.abandoned) throw new Error("fake mask store was abandoned");
    return { value: this.revision === 0 ? 255 : 0 };
  }

  applyEdit(input: unknown): ReturnType<FakeMaskStore["snapshot"]> {
    if (typeof input !== "object" || input === null || !("expectedRevision" in input)) {
      throw new Error("invalid fake mask edit");
    }
    if (input.expectedRevision !== this.revision) throw new Error("fake revision conflict");
    this.revision += 1;
    this.editCount += 1;
    this.frozen = null;
    return this.snapshot();
  }

  freeze(input: unknown): Promise<GrandHallT554NativeMaskFrozenBinding> {
    if (typeof input !== "object" || input === null || !("expectedRevision" in input)) {
      throw new Error("invalid fake mask freeze");
    }
    if (input.expectedRevision !== this.revision) throw new Error("fake revision conflict");
    const includedPixelCount = this.revision === 0 ? 0 : MASK_PIXEL_COUNT;
    const excludedPixelCount = MASK_PIXEL_COUNT - includedPixelCount;
    this.frozen = {
      schemaVersion: "venviewer.grand-hall-t554-native-mask-frozen-binding.v2",
      source: this.source,
      revision: this.revision,
      fileName: `private-mask-${String(this.revision)}.png`,
      sha256: digest(`mask-${String(this.source.inventoryIndex)}-${String(this.revision)}`),
      byteLength: 1_024 + this.revision,
      widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
      heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
      bitDepth: 8,
      channelCount: 1,
      permittedPixelValues: [0, 255],
      zeroMeaning: "grand_hall_included",
      twoHundredFiftyFiveMeaning: "excluded_or_unknown",
      includedPixelCount,
      excludedPixelCount,
      reasonCounts: excludedPixelCount === 0 ? [] : [{
        reasonCode: "unverified_or_unknown_pixels",
        pixelCount: excludedPixelCount,
      }],
      publicationDurability: "directory_fsync",
      immutableFrozen: true,
      reasonMap: {
        fileName: `private-mask-${String(this.revision)}-reason-map.png`,
        sha256: digest(`reason-map-${String(this.source.inventoryIndex)}-${String(this.revision)}`),
        byteLength: 2_048 + this.revision,
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
          { sample: 4, reasonCode: "capture_artifact_outside_verified_room" },
          { sample: 5, reasonCode: "unverified_or_unknown_pixels" },
        ],
      },
    };
    return Promise.resolve(structuredClone(this.frozen));
  }

  abandon(): void {
    this.abandoned = true;
    this.frozen = null;
  }
}

class FakeJournal {
  revision = 0;
  readonly eventTypes: string[] = [];
  readonly payloads: unknown[] = [];
  failEventType: string | undefined;
  blockedEventType: string | undefined;
  releaseBlockedAppend: (() => void) | undefined;

  async append(input: {
    readonly expectedRevision: number;
    readonly eventType: string;
    readonly payload: unknown;
  }): Promise<{
    readonly revision: number;
  }> {
    if (input.expectedRevision !== this.revision) throw new Error("fake journal CAS conflict");
    if (input.eventType === this.failEventType) throw new Error("injected journal failure");
    if (input.eventType === this.blockedEventType) {
      await new Promise<void>((resolveBlocked) => {
        this.releaseBlockedAppend = resolveBlocked;
      });
    }
    this.revision += 1;
    this.eventTypes.push(input.eventType);
    this.payloads.push(structuredClone(input.payload));
    return { revision: this.revision };
  }
}

interface Harness {
  readonly session: Awaited<ReturnType<
    typeof __testOnlyGrandHallT554NativeReviewSessionV1.createSession
  >>;
  readonly epochs: FakeEpoch[];
  readonly masks: FakeMaskStore[];
  readonly sourceJournals: FakeJournal[];
  readonly maskJournals: FakeJournal[];
  readonly panoramaSecretRoot: string;
  readonly journalSecretRoot: string;
  readonly maskSecretRoot: string;
  readonly registry: GrandHallT554NativeReviewSessionRegistryV1;
  readonly advance: (milliseconds: number) => void;
  readonly failNextNonce: () => void;
}

async function createHarness(): Promise<Harness> {
  const panoramaSecretRoot = resolve("private-panorama-source-do-not-expose");
  const journalSecretRoot = resolve("private-journal-root-do-not-expose");
  const maskSecretRoot = resolve("private-mask-root-do-not-expose");
  const nonces = [nonce(1), nonce(2), nonce(3), nonce(4), nonce(5)];
  const epochs: FakeEpoch[] = [];
  const masks: FakeMaskStore[] = [];
  const sourceJournals: FakeJournal[] = [];
  const maskJournals: FakeJournal[] = [];
  let nonceFailure = false;
  let wallMs = Date.parse("2026-08-26T12:00:00.000Z");
  let monotonicMs = 1_000;
  const registry = registryFor(panoramaSecretRoot);
  const dependencies: GrandHallT554NativeReviewSessionDependenciesV1 = {
    newNonce: () => {
      if (nonceFailure) {
        nonceFailure = false;
        throw new Error("injected nonce failure");
      }
      const value = nonces.shift();
      if (value === undefined) throw new Error("fixture nonce supply exhausted");
      return value;
    },
    reserveSessionJournalRoot: (root) => Promise.resolve(root),
    openSourceEpoch: ({ bindings }) => {
      const epoch = new FakeEpoch(bindings);
      epochs.push(epoch);
      return Promise.resolve(epoch);
    },
    createJournal: ({ scope }) => {
      const journal = new FakeJournal();
      if (scope.kind === "source") sourceJournals.push(journal);
      else maskJournals.push(journal);
      return Promise.resolve(journal);
    },
    createMaskStore: (config) => {
      const mask = new FakeMaskStore(config);
      masks.push(mask);
      return mask;
    },
    createCoverage: (options) => new GrandHallT554NativeReviewCoverageControllerV1({
      ...options,
      wallClock: () => new Date(wallMs),
      monotonicNowMs: () => monotonicMs,
    }),
  };
  const session = await __testOnlyGrandHallT554NativeReviewSessionV1.createSession({
    registry,
    workbenchImplementationManifest: {
      semanticSha256: digest("implementation-semantic"),
      fileSha256: digest("implementation-file"),
      byteLength: 5_000,
    },
    journalWorkspaceRoot: journalSecretRoot,
    maskPublicationDirectory: maskSecretRoot,
  }, dependencies);
  return {
    session,
    epochs,
    masks,
    sourceJournals,
    maskJournals,
    panoramaSecretRoot,
    journalSecretRoot,
    maskSecretRoot,
    registry,
    advance: (milliseconds) => {
      wallMs += milliseconds;
      monotonicMs += milliseconds;
    },
    failNextNonce: () => {
      nonceFailure = true;
    },
  };
}

function active(snapshot: GrandHallT554NativeReviewSessionPublicSnapshotV1): NonNullable<
  GrandHallT554NativeReviewSessionPublicSnapshotV1["activeSource"]
> {
  if (snapshot.sessionNonce === null || snapshot.activeSource === null) {
    throw new Error("fixture expected one active session source");
  }
  return snapshot.activeSource;
}

function sessionNonce(snapshot: GrandHallT554NativeReviewSessionPublicSnapshotV1): string {
  if (snapshot.sessionNonce === null) throw new Error("fixture session is stopped");
  return snapshot.sessionNonce;
}

async function select(
  harness: Harness,
  inventoryIndex = 0,
): Promise<GrandHallT554NativeReviewSessionPublicSnapshotV1> {
  const before = await harness.session.snapshot();
  return await harness.session.selectSource({
    sessionNonce: sessionNonce(before),
    expectedWorkspaceRevision: before.workspaceRevision,
    inventoryIndex,
  });
}

function boundMutation(snapshot: GrandHallT554NativeReviewSessionPublicSnapshotV1): {
  readonly sessionNonce: string;
  readonly sourceEpochNonce: string;
  readonly renderGeneration: number;
  readonly expectedWorkspaceRevision: number;
} {
  const selected = active(snapshot);
  return {
    sessionNonce: sessionNonce(snapshot),
    sourceEpochNonce: selected.sourceEpochNonce,
    renderGeneration: selected.renderGeneration,
    expectedWorkspaceRevision: snapshot.workspaceRevision,
  };
}

function tileRequest(snapshot: GrandHallT554NativeReviewSessionPublicSnapshotV1): Record<string, unknown> {
  return {
    sessionNonce: sessionNonce(snapshot),
    sourceEpochNonce: active(snapshot).sourceEpochNonce,
    renderGeneration: active(snapshot).renderGeneration,
    column: 0,
    row: 0,
  };
}

function telemetry(
  snapshot: GrandHallT554NativeReviewSessionPublicSnapshotV1,
  sequence: number,
): Record<string, unknown> {
  const selected = active(snapshot);
  return {
    schemaVersion: "venviewer.grand-hall-t554-native-review-telemetry-sample.v1",
    sessionNonce: sessionNonce(snapshot),
    sourceEpochNonce: selected.sourceEpochNonce,
    renderGeneration: selected.renderGeneration,
    sequence,
    documentVisibilityState: "visible",
    documentFocusState: "focused",
    viewportCssWidth: 256,
    viewportCssHeight: 256,
    devicePixelRatio: 1,
    sourceToCssTransform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    paintedTiles: [{ column: 0, row: 0, generation: selected.renderGeneration }],
  };
}

async function beginInclude(
  harness: Harness,
  snapshot: GrandHallT554NativeReviewSessionPublicSnapshotV1,
): Promise<GrandHallT554NativeReviewSessionPublicSnapshotV1> {
  return await harness.session.beginIncludeMask(boundMutation(snapshot));
}

function includeRectangle(
  snapshot: GrandHallT554NativeReviewSessionPublicSnapshotV1,
): Record<string, unknown> {
  return {
    ...boundMutation(snapshot),
    expectedMaskRevision: active(snapshot).mask.revision,
    operation: "include",
    primitive: {
      kind: "rectangle",
      horizontalSeam: "none",
      leftPx: 0,
      topPx: 0,
      rightExclusivePx: 256,
      bottomExclusivePx: 256,
    },
  };
}

describe("Grand Hall T-554 native-review session controller", () => {
  it("binds exact server state, rejects stale epochs/generations, and exposes no secret path", async () => {
    const harness = await createHarness();
    const selected = await select(harness);
    const publicJson = JSON.stringify(selected);
    expect(publicJson).not.toContain(harness.panoramaSecretRoot);
    expect(publicJson).not.toContain(harness.journalSecretRoot);
    expect(publicJson).not.toContain(harness.maskSecretRoot);
    expect(publicJson).not.toContain(sourceAt(0).source.sha256);
    expect(harness.sourceJournals[0]?.eventTypes).toEqual(["source.review-started"]);
    expect(harness.sourceJournals[0]?.payloads[0]).toMatchObject({
      sourceEpoch: {
        sourceVerification: {
          decodedPixelSha256: digest(`decoded-${sourceAt(0).source.fileName}`),
          descriptorWitnessSha256: digest(`descriptor-${sourceAt(0).source.fileName}`),
          sameOpenDescriptorHashedAndDecoded: true,
          fullJpegDecodeCompleted: true,
          decoderIdentity: {
            pipeline: "captured-jpeg-buffer-to-unrotated-rgb8.v1",
          },
        },
        tileGrid: { widthPx: 256, heightPx: 256, columnCount: 32, rowCount: 16 },
      },
    });
    expect(JSON.stringify(harness.sourceJournals[0]?.payloads[0])).not.toContain(
      harness.panoramaSecretRoot,
    );
    expect(selected).toMatchObject({
      authority: "none",
      reviewState: "human_pending",
      finalDecision: "PENDING",
      acceptanceAuthorized: false,
      reconstructionAuthorized: false,
      runtimeAuthorized: false,
      exportAuthorized: false,
      generatedContentAuthorized: false,
      crashRecovery: {
        resumeSupported: false,
        priorJournalRootReuseAllowed: false,
        releaseState: "blocked_pending_deterministic_replay_import",
      },
      implementationManifestVerification: {
        concreteBytesVerified: false,
        productionFactoryAvailable: false,
        releaseState: "blocked_pending_manifest_byte_verifier",
      },
      activeSource: { inventoryIndex: 0, phase: "source_review" },
    });

    await expect(harness.session.serveTile({
      ...tileRequest(selected),
      sourceEpochNonce: nonce(99),
    })).rejects.toMatchObject({ code: "SOURCE_STALE" });
    await expect(harness.session.serveTile({
      ...tileRequest(selected),
      renderGeneration: active(selected).renderGeneration + 1,
    })).rejects.toMatchObject({ code: "SOURCE_STALE" });
    await expect(harness.session.recordCoverage({
      ...telemetry(selected, 0),
      subjectSha256: sourceAt(0).source.sha256,
    })).rejects.toMatchObject({ code: "ARGUMENT_INVALID" });
    await expect(harness.session.applyMaskEdit({
      ...includeRectangle(selected),
      sourcePath: harness.panoramaSecretRoot,
      maskPixelCount: MASK_PIXEL_COUNT,
    })).rejects.toMatchObject({ code: "ARGUMENT_INVALID" });
  });

  it("withholds coverage acknowledgement until append is durable and gives no ack on failure", async () => {
    const harness = await createHarness();
    const selected = await select(harness);
    const preparedTile = await harness.session.serveTile(tileRequest(selected));
    await preparedTile.commitDeliveryAfterSuccessfulSend();
    const journal = harness.sourceJournals[0];
    if (journal === undefined) throw new Error("missing source journal");
    journal.blockedEventType = "source.coverage";
    let acknowledged = false;
    const pending = harness.session.recordCoverage(telemetry(selected, 0)).then((value) => {
      acknowledged = true;
      return value;
    });
    await Promise.resolve();
    expect(acknowledged).toBe(false);
    journal.releaseBlockedAppend?.();
    await expect(pending).resolves.toMatchObject({ sequence: 0, journalRevision: 2 });
    expect(acknowledged).toBe(true);

    harness.advance(500);
    journal.blockedEventType = undefined;
    journal.failEventType = "source.coverage";
    let failedAcknowledgement = false;
    const rejected = harness.session.recordCoverage(telemetry(selected, 1)).then(() => {
      failedAcknowledgement = true;
    });
    await expect(rejected).rejects.toMatchObject({ code: "DURABILITY_FAILURE" });
    expect(failedAcknowledgement).toBe(false);
    expect(harness.epochs[0]?.abandoned).toBe(true);
    expect(harness.masks[0]?.abandoned).toBe(true);
    const poisoned = await harness.session.snapshot();
    expect(poisoned).toMatchObject({
      lifecycle: "poisoned",
      sessionNonce: null,
      workspaceRevision: selected.workspaceRevision + 1,
      activeSource: null,
    });
    await expect(harness.session.selectSource({
      sessionNonce: sessionNonce(selected),
      expectedWorkspaceRevision: poisoned.workspaceRevision,
      inventoryIndex: 1,
    })).rejects.toMatchObject({ code: "SESSION_POISONED" });
    await expect(harness.session.serveTile(tileRequest(selected))).rejects.toMatchObject({
      code: "SESSION_POISONED",
    });
    await expect(harness.session.stop({
      sessionNonce: sessionNonce(selected),
      expectedWorkspaceRevision: poisoned.workspaceRevision,
    })).resolves.toMatchObject({ lifecycle: "stopped", sessionNonce: null });
  });

  it("zeros an unjournalled mask mutation and never returns its changed revision", async () => {
    const harness = await createHarness();
    const editing = await beginInclude(harness, await select(harness));
    const journal = harness.sourceJournals[0];
    if (journal === undefined) throw new Error("missing source journal");
    journal.failEventType = "include-mask.edited";
    await expect(harness.session.applyMaskEdit(includeRectangle(editing))).rejects.toMatchObject({
      code: "DURABILITY_FAILURE",
    });
    expect(harness.masks[0]?.editCount).toBe(1);
    expect(harness.masks[0]?.abandoned).toBe(true);
    expect(harness.epochs[0]?.abandoned).toBe(true);
    await expect(harness.session.snapshot()).resolves.toMatchObject({ activeSource: null });
  });

  it("does not mark a prepared tile delivered until the trusted adapter commits a successful send", async () => {
    const harness = await createHarness();
    const selected = await select(harness);
    const preparedTile = await harness.session.serveTile(tileRequest(selected));
    await preparedTile.discardAfterFailedSend();
    expect(preparedTile.sourceRgb8.every((value) => value === 0)).toBe(true);
    await expect(preparedTile.commitDeliveryAfterSuccessfulSend()).rejects.toMatchObject({
      code: "DELIVERY_ALREADY_RESOLVED",
    });

    await harness.session.recordCoverage(telemetry(selected, 0));
    harness.advance(500);
    await harness.session.recordCoverage(telemetry(selected, 1));
    harness.advance(500);
    await expect(harness.session.recordCoverage(telemetry(selected, 2))).resolves.toMatchObject({
      completedTileCount: 0,
      complete: false,
    });

    const deliveredTile = await harness.session.serveTile(tileRequest(selected));
    await deliveredTile.commitDeliveryAfterSuccessfulSend();
    expect(deliveredTile.sourceRgb8.every((value) => value === 0)).toBe(true);
    await expect(deliveredTile.commitDeliveryAfterSuccessfulSend()).rejects.toMatchObject({
      code: "DELIVERY_ALREADY_RESOLVED",
    });
    harness.advance(500);
    await harness.session.recordCoverage(telemetry(selected, 3));
    harness.advance(500);
    await harness.session.recordCoverage(telemetry(selected, 4));
    harness.advance(250);
    await expect(harness.session.recordCoverage(telemetry(selected, 5))).resolves.toMatchObject({
      completedTileCount: 1,
      complete: false,
    });
  });

  it("force-zeros a prepared tile when stop wins the lane race against delivery commit", async () => {
    const harness = await createHarness();
    const selected = await select(harness);
    const preparedTile = await harness.session.serveTile(tileRequest(selected));
    expect(preparedTile.sourceRgb8.some((value) => value !== 0)).toBe(true);

    const stopping = harness.session.stop({
      sessionNonce: sessionNonce(selected),
      expectedWorkspaceRevision: selected.workspaceRevision,
    });
    const lateCommit = preparedTile.commitDeliveryAfterSuccessfulSend();

    await expect(stopping).resolves.toMatchObject({ lifecycle: "stopped" });
    expect(preparedTile.sourceRgb8.every((value) => value === 0)).toBe(true);
    await expect(lateCommit).rejects.toMatchObject({ code: "SOURCE_STALE" });
  });

  it("continues all custody cleanup when one prepared buffer cannot be zeroed", async () => {
    const harness = await createHarness();
    const selected = await select(harness);
    const first = await harness.session.serveTile(tileRequest(selected));
    const second = await harness.session.serveTile(tileRequest(selected));
    Object.defineProperty(first.sourceRgb8, "fill", {
      value: () => {
        throw new Error("injected buffer zero failure");
      },
    });

    await expect(harness.session.stop({
      sessionNonce: sessionNonce(selected),
      expectedWorkspaceRevision: selected.workspaceRevision,
    })).rejects.toMatchObject({ code: "RESOURCE_CLEANUP_FAILED" });
    expect(second.sourceRgb8.every((value) => value === 0)).toBe(true);
    expect(harness.masks[0]?.abandoned).toBe(true);
    expect(harness.epochs[0]?.abandoned).toBe(true);
    await expect(harness.session.snapshot()).resolves.toMatchObject({
      lifecycle: "poisoned",
      sessionNonce: null,
      activeSource: null,
    });
  });

  it("serializes two-tab mask edits and lets exactly one compare-and-swap win", async () => {
    const harness = await createHarness();
    const editing = await beginInclude(harness, await select(harness));
    const request = includeRectangle(editing);
    const [first, second] = await Promise.allSettled([
      harness.session.applyMaskEdit(request),
      harness.session.applyMaskEdit(request),
    ]);
    expect([first.status, second.status].sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = first.status === "rejected" ? first.reason :
      second.status === "rejected" ? second.reason : undefined;
    expect(rejected).toBeInstanceOf(GrandHallT554NativeReviewSessionError);
    expect(rejected).toMatchObject({ code: "WORKSPACE_REVISION_CONFLICT" });
    expect(harness.masks[0]?.editCount).toBe(1);
  });

  it("destroys the prior source and mask custody before switching selection", async () => {
    const harness = await createHarness();
    const first = await select(harness, 0);
    const oldEpoch = harness.epochs[0];
    const oldMask = harness.masks[0];
    const pendingTile = await harness.session.serveTile(tileRequest(first));
    const second = await harness.session.selectSource({
      sessionNonce: sessionNonce(first),
      expectedWorkspaceRevision: first.workspaceRevision,
      inventoryIndex: 1,
    });
    expect(oldEpoch?.abandoned).toBe(true);
    expect(oldMask?.abandoned).toBe(true);
    expect(pendingTile.sourceRgb8.every((value) => value === 0)).toBe(true);
    expect(active(second).inventoryIndex).toBe(1);
    await expect(harness.session.serveTile(tileRequest(first))).rejects.toMatchObject({
      code: "SOURCE_STALE",
    });
  });

  it("retains old custody when registry access or nonce preparation fails before a switch", async () => {
    const harness = await createHarness();
    const selected = await select(harness);
    const oldEpoch = harness.epochs[0];
    const originalSourceAt = harness.registry.sourceAt;
    Object.defineProperty(harness.registry, "sourceAt", {
      configurable: true,
      value: () => {
        throw new Error("injected registry accessor failure");
      },
    });

    await expect(harness.session.selectSource({
      sessionNonce: sessionNonce(selected),
      expectedWorkspaceRevision: selected.workspaceRevision,
      inventoryIndex: 1,
    })).rejects.toThrow("injected registry accessor failure");
    expect(oldEpoch?.abandoned).toBe(false);
    await expect(harness.session.snapshot()).resolves.toMatchObject({
      lifecycle: "active",
      sessionNonce: sessionNonce(selected),
      workspaceRevision: selected.workspaceRevision,
      activeSource: { inventoryIndex: 0 },
    });

    Object.defineProperty(harness.registry, "sourceAt", {
      configurable: true,
      value: originalSourceAt,
    });
    harness.failNextNonce();
    await expect(harness.session.selectSource({
      sessionNonce: sessionNonce(selected),
      expectedWorkspaceRevision: selected.workspaceRevision,
      inventoryIndex: 1,
    })).rejects.toThrow("injected nonce failure");
    expect(oldEpoch?.abandoned).toBe(false);
    await expect(harness.session.snapshot()).resolves.toMatchObject({
      lifecycle: "active",
      workspaceRevision: selected.workspaceRevision,
      activeSource: { inventoryIndex: 0 },
    });
  });

  it("terminally poisons the session when source cleanup cannot be proved", async () => {
    const harness = await createHarness();
    const selected = await select(harness);
    const epoch = harness.epochs[0];
    if (epoch === undefined) throw new Error("missing source epoch");
    epoch.failAbandon = true;

    await expect(harness.session.selectSource({
      sessionNonce: sessionNonce(selected),
      expectedWorkspaceRevision: selected.workspaceRevision,
      inventoryIndex: 1,
    })).rejects.toMatchObject({ code: "RESOURCE_CLEANUP_FAILED" });
    await expect(harness.session.snapshot()).resolves.toMatchObject({
      lifecycle: "poisoned",
      sessionNonce: null,
      workspaceRevision: selected.workspaceRevision + 1,
      activeSource: null,
    });
    expect(harness.epochs).toHaveLength(1);
    await expect(harness.session.selectSource({
      sessionNonce: sessionNonce(selected),
      expectedWorkspaceRevision: selected.workspaceRevision + 1,
      inventoryIndex: 1,
    })).rejects.toMatchObject({ code: "SESSION_POISONED" });
  });

  it("invalidates frozen-mask coverage and render generation after every later edit", async () => {
    const harness = await createHarness();
    const editing = await beginInclude(harness, await select(harness));
    const edited = await harness.session.applyMaskEdit(includeRectangle(editing));
    const frozen = await harness.session.freezeMask({
      ...boundMutation(edited),
      expectedMaskRevision: active(edited).mask.revision,
    });
    expect(active(frozen)).toMatchObject({
      phase: "include_mask_review",
      mask: { frozen: true, coverage: { completedTileCount: 0, complete: false } },
    });
    const preparedTile = await harness.session.serveTile(tileRequest(frozen));
    await preparedTile.commitDeliveryAfterSuccessfulSend();
    await expect(harness.session.recordCoverage(telemetry(frozen, 0))).resolves.toMatchObject({
      sequence: 0,
    });

    const editedAgain = await harness.session.applyMaskEdit(includeRectangle(frozen));
    expect(active(editedAgain).renderGeneration).not.toBe(active(frozen).renderGeneration);
    expect(active(editedAgain)).toMatchObject({
      phase: "include_mask_edit",
      mask: { frozen: false, coverage: null },
    });
    await expect(harness.session.recordCoverage(telemetry(frozen, 1))).rejects.toMatchObject({
      code: "SOURCE_STALE",
    });
  });

  it("abandons active buffers on stop and permanently removes the session nonce", async () => {
    const harness = await createHarness();
    const selected = await select(harness);
    const stopped = await harness.session.stop({
      sessionNonce: sessionNonce(selected),
      expectedWorkspaceRevision: selected.workspaceRevision,
    });
    expect(harness.epochs[0]?.abandoned).toBe(true);
    expect(harness.masks[0]?.abandoned).toBe(true);
    expect(stopped).toMatchObject({ lifecycle: "stopped", sessionNonce: null, activeSource: null });
    await expect(harness.session.selectSource({
      sessionNonce: sessionNonce(selected),
      expectedWorkspaceRevision: stopped.workspaceRevision,
      inventoryIndex: 2,
    })).rejects.toMatchObject({ code: "SESSION_STOPPED" });
  });

  it("exclusively reserves an empty session root and refuses crash-root reuse", async () => {
    const journalRoot = await mkdtemp(join(tmpdir(), "grand-hall-session-root-"));
    const maskRoot = await mkdtemp(join(tmpdir(), "grand-hall-session-mask-"));
    temporaryRoots.push(journalRoot, maskRoot);
    await expect(
      __testOnlyGrandHallT554NativeReviewSessionV1.reserveEmptySessionJournalRoot(journalRoot),
    ).resolves.toBe(join(journalRoot, "native-review-session-reserved-v1"));
    await expect(
      __testOnlyGrandHallT554NativeReviewSessionV1.reserveEmptySessionJournalRoot(journalRoot),
    ).rejects.toMatchObject({
      code: "CRASH_RECOVERY_REQUIRED",
    });
  });
});
