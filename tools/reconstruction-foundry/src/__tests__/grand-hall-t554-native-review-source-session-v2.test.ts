import { createHash } from "node:crypto";
import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import {
  CanonicalJsonValueSchema,
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_WIDTH_PX,
  stableCanonicalJson as stableTypesJson,
  type GrandHallPanoramaSourceJpgIdentityV2,
} from "@omnitwin/types";
import { afterEach, describe, expect, it } from "vitest";

import {
  GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME,
  GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_SCHEMA,
} from "../grand-hall-t554-native-review-implementation-manifest.js";
import {
  openGrandHallT554NativeReviewDurableJournalV2,
  openGrandHallT554NativeReviewVerifiedDurableChildEvidenceV2,
} from "../grand-hall-t554-native-review-durable-journal-v2.js";
import { createGrandHallT554NativeReviewCoverageCarryStateV2 } from "../grand-hall-t554-native-review-replay-v2.js";
import {
  __testOnlyGrandHallT554NativeReviewMaskWorkflowSessionV2,
  type GrandHallT554NativeReviewMaskWorkflowSessionV2,
} from "../grand-hall-t554-native-review-mask-workflow-session-v2.js";
import {
  bulkAppendExactChildFixture,
  completeMaskCoverageEvents,
  completeSourceCoverageEvents,
} from "./grand-hall-t554-native-review-exact-child-fixture-v2.js";
import {
  __testOnlyGrandHallT554NativeMaskRevisionStore,
  type GrandHallT554NativeMaskRevisionStore,
} from "../grand-hall-t554-native-review-mask-store.js";
import type { GrandHallT554NativeReviewRegistrySource } from "../grand-hall-t554-native-review-registry.js";
import {
  deriveGrandHallT554NativeReviewSessionOwnerControlDirectoryV2,
  inspectGrandHallT554NativeReviewPriorOwnerV2,
} from "../grand-hall-t554-native-review-session-owner-v2.js";
import { replayGrandHallT554NativeReviewCoordinatorV2 } from "../grand-hall-t554-native-review-coordinator-replay-v2.js";
import {
  __testOnlyGrandHallT554NativeReviewSourceSessionV2,
  createGrandHallT554NativeReviewSourceSessionV2,
  openGrandHallT554NativeReviewSourceSessionV2,
  takeOverGrandHallT554NativeReviewSourceSessionAfterCrashV2,
  GrandHallT554NativeReviewSourceSessionV2Error,
  type GrandHallT554NativeReviewSourceSessionV2,
} from "../grand-hall-t554-native-review-source-session-v2.js";
import type {
  GrandHallT554NativeSourceEpochBindingsV1,
  GrandHallT554NativeSourceEpochSnapshotV1,
  GrandHallT554NativeSourceTileRequestV1,
} from "../grand-hall-t554-native-source-epoch.js";

const roots: Array<{
  readonly parentRoot: string;
  readonly sessionRoot: string;
}> = [];
const FULL_TILE_BITMAP = "ff".repeat(64);
const SOURCE_TILE_BYTE_LENGTH = 256 * 256 * 3;
const SAFE_PAST_UTC = Date.parse("2000-01-01T00:00:00.000Z");

type Sha256 = `sha256:${string}`;
type Kernel = GrandHallT554NativeReviewSourceSessionV2;

afterEach(async () => {
  for (const { parentRoot, sessionRoot } of roots.splice(0)) {
    const removal = {
      force: true,
      recursive: true,
      maxRetries: 5,
      retryDelay: 50,
    };
    await rm(
      deriveGrandHallT554NativeReviewSessionOwnerControlDirectoryV2(
        sessionRoot,
      ),
      removal,
    );
    await rm(parentRoot, removal);
  }
});

function digest(seed: string | Buffer): Sha256 {
  const bytes = typeof seed === "string" ? Buffer.from(seed, "utf8") : seed;
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(
    `${stableCanonicalJson(toCanonicalJson(value))}\n`,
    "utf8",
  );
}

function nonce(sequence: number): string {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32BE(sequence, 28);
  return bytes.toString("base64url");
}

function artifact(seed: string) {
  return {
    semanticSha256: digest(`${seed}-semantic`),
    fileSha256: digest(`${seed}-file`),
    byteLength: 1_024,
  };
}

const registryBinding = Object.freeze({
  schemaVersion:
    "venviewer.grand-hall-t554-native-review-registry-binding.v2" as const,
  venueSlug: "trades-hall" as const,
  roomSlug: "grand-hall" as const,
  sourceCount: 148 as const,
  reviewPack: artifact("review-pack"),
  publicationReceipt: artifact("publication-receipt"),
  authority: "none" as const,
  reviewState: "human_pending" as const,
  finalDecision: "PENDING" as const,
  acceptanceAuthorized: false as const,
  reconstructionAuthorized: false as const,
  runtimeAuthorized: false as const,
  exportAuthorized: false as const,
  generatedContentAuthorized: false as const,
});

function sourceIdentity(
  inventoryIndex: number,
): GrandHallPanoramaSourceJpgIdentityV2 {
  const sweepNumber = inventoryIndex + 1;
  return {
    inventoryIndex,
    sweepNumber,
    fileName: `sweep_${String(sweepNumber).padStart(3, "0")}jpg.jpg`,
    sha256: digest(`source-${String(inventoryIndex)}`),
    byteLength: 6_000_000 + inventoryIndex,
    widthPx: GRAND_HALL_PANORAMA_WIDTH_PX,
    heightPx: GRAND_HALL_PANORAMA_HEIGHT_PX,
  };
}

function registrySource(
  inventoryIndex: number,
): GrandHallT554NativeReviewRegistrySource {
  return {
    source: sourceIdentity(inventoryIndex),
    observation: {
      state: "grand_hall_pixels_observed_human_pending",
      proposedDisposition: "include_with_binary_pixel_mask",
      maskAuthoringState: "required_not_authored",
    },
    observationBasis: "agent_visual_inspection_of_digest_bound_source_panorama",
  };
}

function sourceVerification(
  source: GrandHallPanoramaSourceJpgIdentityV2,
): GrandHallT554NativeSourceEpochSnapshotV1["sourceVerification"] {
  return {
    fileName: source.fileName,
    sha256: source.sha256 as Sha256,
    byteLength: source.byteLength,
    widthPx: source.widthPx,
    heightPx: source.heightPx,
    decodedChannelCount: 3 as const,
    decodedBitsPerSample: 8 as const,
    alphaPresent: false as const,
    orientationMetadataPresent: false as const,
    decodedPixelSha256: digest(`decoded-${source.fileName}`),
    decoderIdentity: {
      schemaVersion:
        "venviewer.grand-hall-t554-source-jpeg-decoder-identity.v1" as const,
      library: "sharp" as const,
      sharpVersion: "0.35.3",
      libvipsVersion: "8.18.3",
      pipeline: "captured-jpeg-buffer-to-unrotated-rgb8.v1" as const,
    },
    descriptorWitnessSha256: digest(`descriptor-${source.fileName}`),
    sameOpenDescriptorHashedAndDecoded: true as const,
    fullJpegDecodeCompleted: true as const,
  };
}

function epochBindingSha256(
  bindings: GrandHallT554NativeSourceEpochBindingsV1,
  verification: ReturnType<typeof sourceVerification>,
): Sha256 {
  const material = CanonicalJsonValueSchema.parse({
    bindings,
    sourceVerification: verification,
  });
  return digest(
    Buffer.from(
      `VENVIEWER_GRAND_HALL_T554_NATIVE_SOURCE_EPOCH_BINDING_V1\n${stableTypesJson(material)}`,
      "utf8",
    ),
  );
}

type EpochSnapshotMutation = (
  snapshot: GrandHallT554NativeSourceEpochSnapshotV1,
) => void;

class FakeSourceEpoch {
  readonly #bindings: GrandHallT554NativeSourceEpochBindingsV1;
  readonly #verification: GrandHallT554NativeSourceEpochSnapshotV1["sourceVerification"];
  abandoned = false;
  finalized = false;

  constructor(
    bindings: GrandHallT554NativeSourceEpochBindingsV1,
    readonly snapshotMutation?: EpochSnapshotMutation,
  ) {
    this.#bindings = structuredClone(bindings);
    this.#verification = sourceVerification(bindings.source);
  }

  snapshot(): GrandHallT554NativeSourceEpochSnapshotV1 {
    const snapshot: GrandHallT554NativeSourceEpochSnapshotV1 = {
      schemaVersion: "venviewer.grand-hall-t554-native-source-epoch.v1",
      lifecycle: this.abandoned || this.finalized ? "closed" : "active",
      closedDisposition: this.abandoned
        ? "abandoned"
        : this.finalized
          ? "finalized_stable"
          : null,
      sourceEpochNonce: this.#bindings.sourceEpochNonce,
      sourceEpochNonceSha256: digest(this.#bindings.sourceEpochNonce),
      renderGeneration: this.#bindings.renderGeneration,
      epochBindingSha256: epochBindingSha256(
        this.#bindings,
        this.#verification,
      ),
      reviewPack: this.#bindings.reviewPack,
      publicationReceipt: this.#bindings.publicationReceipt,
      workbenchImplementationManifest:
        this.#bindings.workbenchImplementationManifest,
      source: this.#bindings.source,
      sourceVerification: this.#verification,
      tileGrid: {
        widthPx: 256,
        heightPx: 256,
        columnCount: 32,
        rowCount: 16,
        channelCount: 3,
        bytesPerTile: SOURCE_TILE_BYTE_LENGTH,
        resampling: "none",
      },
    };
    this.snapshotMutation?.(snapshot);
    return snapshot;
  }

  copyTile(input: GrandHallT554NativeSourceTileRequestV1): Buffer {
    if (
      this.abandoned ||
      this.finalized ||
      input.sourceEpochNonce !== this.#bindings.sourceEpochNonce ||
      input.renderGeneration !== this.#bindings.renderGeneration
    ) {
      throw new Error("fake source epoch received a stale tile request");
    }
    return Buffer.alloc(
      SOURCE_TILE_BYTE_LENGTH,
      (input.row * 32 + input.column + 1) % 256,
    );
  }

  finalize() {
    if (this.abandoned || this.finalized) {
      throw new Error("fake source epoch was already closed");
    }
    this.finalized = true;
    return Promise.resolve({
      schemaVersion:
        "venviewer.grand-hall-t554-finalized-native-source-epoch.v1" as const,
      sourceEpochNonceSha256: digest(this.#bindings.sourceEpochNonce),
      renderGeneration: this.#bindings.renderGeneration,
      epochBindingSha256: epochBindingSha256(
        this.#bindings,
        this.#verification,
      ),
      sourceVerification: this.#verification,
      disposition: "finalized_stable" as const,
    });
  }

  abandon(): Promise<void> {
    if (this.abandoned || this.finalized) {
      throw new Error("fake source epoch was already closed");
    }
    this.abandoned = true;
    return Promise.resolve();
  }
}

function implementationFixture() {
  const material = {
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_SCHEMA,
    implementationId: "grand-hall-t554-native-review-workbench-v1" as const,
    fixture: "source-mutation-kernel-v2-contract",
  };
  const semanticSha256: Sha256 = `sha256:${domainSeparatedSha256(
    "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_V1",
    toCanonicalJson(material),
  )}`;
  const bytes = canonicalBytes({ ...material, semanticSha256 });
  return {
    binding: {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-implementation-manifest-binding.v2" as const,
      implementationId: material.implementationId,
      semanticSha256,
      fileSha256: digest(bytes),
      byteLength: bytes.length,
    },
    copyExactManifestBytes: (): Buffer => Buffer.from(bytes),
  };
}

interface CrashSeam {
  readonly afterBrowserEpochStartedDurable?: () => Promise<void> | void;
  readonly afterSourceSelectionIntentDurable?: () => Promise<void> | void;
  readonly afterSourceChildPublished?: () => Promise<void> | void;
  readonly afterSourceDescriptorPublished?: () => Promise<void> | void;
  readonly afterSourceSelectionCommitDurable?: () => Promise<void> | void;
  readonly afterCoverageResumeIntentDurable?: () => Promise<void> | void;
  readonly afterCoverageResumeChildPublished?: () => Promise<void> | void;
  readonly afterCoverageResumeDescriptorPublished?: () => Promise<void> | void;
  readonly afterCoverageResumeCommitDurable?: () => Promise<void> | void;
}

type SelectionCrashSeamName =
  | "afterSourceSelectionIntentDurable"
  | "afterSourceChildPublished"
  | "afterSourceDescriptorPublished"
  | "afterSourceSelectionCommitDurable";
type ResumeCrashSeamName =
  | "afterCoverageResumeIntentDurable"
  | "afterCoverageResumeChildPublished"
  | "afterCoverageResumeDescriptorPublished"
  | "afterCoverageResumeCommitDurable";
type BrowserCrashSeamName = "afterBrowserEpochStartedDurable";

function injectedCrashSeam(
  name: BrowserCrashSeamName | SelectionCrashSeamName | ResumeCrashSeamName,
): CrashSeam {
  const crash = (): never => {
    throw new Error(`injected crash at ${name}`);
  };
  switch (name) {
    case "afterBrowserEpochStartedDurable":
      return { afterBrowserEpochStartedDurable: crash };
    case "afterSourceSelectionIntentDurable":
      return { afterSourceSelectionIntentDurable: crash };
    case "afterSourceChildPublished":
      return { afterSourceChildPublished: crash };
    case "afterSourceDescriptorPublished":
      return { afterSourceDescriptorPublished: crash };
    case "afterSourceSelectionCommitDurable":
      return { afterSourceSelectionCommitDurable: crash };
    case "afterCoverageResumeIntentDurable":
      return { afterCoverageResumeIntentDurable: crash };
    case "afterCoverageResumeChildPublished":
      return { afterCoverageResumeChildPublished: crash };
    case "afterCoverageResumeDescriptorPublished":
      return { afterCoverageResumeDescriptorPublished: crash };
    case "afterCoverageResumeCommitDurable":
      return { afterCoverageResumeCommitDurable: crash };
  }
}

interface Harness {
  readonly sessionRoot: string;
  readonly dependencies: ReturnType<typeof createDependencies>;
  readonly epochs: FakeSourceEpoch[];
  readonly advance: (milliseconds: number) => void;
  readonly withoutCrashSeam: () => ReturnType<typeof createDependencies>;
  readonly withCrashSeam: (
    seam: CrashSeam,
  ) => ReturnType<typeof createDependencies>;
}

function createDependencies(input: {
  readonly sourceRoot: string;
  readonly epochs: FakeSourceEpoch[];
  readonly clock: { wallMs: number; monotonicMs: number };
  readonly nonceState: { sequence: number };
  readonly seam?: CrashSeam;
  readonly epochSnapshotMutation?: EpochSnapshotMutation;
}) {
  const implementation = implementationFixture();
  return {
    registry: {
      binding: registryBinding,
      sourceAt: (inventoryIndex: number) => registrySource(inventoryIndex),
      mediaInputAt: (inventoryIndex: number) => {
        const source = sourceIdentity(inventoryIndex);
        return {
          sourceRoot: input.sourceRoot,
          fileName: source.fileName,
          expectedSha256: source.sha256,
          expectedByteLength: source.byteLength,
        };
      },
    },
    implementationManifestBinding: implementation.binding,
    copyExactManifestBytes: implementation.copyExactManifestBytes,
    openSourceEpoch: (options: {
      readonly sourceRoot: string;
      readonly bindings: GrandHallT554NativeSourceEpochBindingsV1;
    }): Promise<FakeSourceEpoch> => {
      expect(options.sourceRoot).toBe(input.sourceRoot);
      const epoch = new FakeSourceEpoch(
        options.bindings,
        input.epochSnapshotMutation,
      );
      input.epochs.push(epoch);
      return Promise.resolve(epoch);
    },
    newNonce: (): string => nonce(input.nonceState.sequence++),
    nowUtc: (): string => new Date(input.clock.wallMs).toISOString(),
    monotonicNowMs: (): number => input.clock.monotonicMs,
    ...(input.seam === undefined ? {} : { seam: input.seam }),
  };
}

async function harness(
  seam?: CrashSeam,
  epochSnapshotMutation?: EpochSnapshotMutation,
): Promise<Harness> {
  const parentRoot = await mkdtemp(
    join(tmpdir(), "venviewer-t554-source-kernel-v2-"),
  );
  const sessionRoot = join(parentRoot, "session");
  roots.push({ parentRoot, sessionRoot });
  const epochs: FakeSourceEpoch[] = [];
  const clock = { wallMs: SAFE_PAST_UTC, monotonicMs: 0 };
  const nonceState = { sequence: 1 };
  const sourceRoot = resolve("fixture-private-source-root");
  const makeDependencies = (nextSeam?: CrashSeam) =>
    createDependencies({
      sourceRoot,
      epochs,
      clock,
      nonceState,
      ...(nextSeam === undefined ? {} : { seam: nextSeam }),
      ...(epochSnapshotMutation === undefined ? {} : { epochSnapshotMutation }),
    });
  return {
    sessionRoot,
    dependencies: makeDependencies(seam),
    epochs,
    advance: (milliseconds) => {
      clock.wallMs += milliseconds;
      clock.monotonicMs += milliseconds;
    },
    withoutCrashSeam: () => makeDependencies(),
    withCrashSeam: (nextSeam) => makeDependencies(nextSeam),
  };
}

type Snapshot = Awaited<ReturnType<Kernel["snapshot"]>>;
type ActiveSource = NonNullable<Snapshot["activeSource"]>;

function activeSource(snapshot: Snapshot): ActiveSource {
  if (snapshot.activeSource === null) {
    throw new Error("test fixture expected one active source");
  }
  return snapshot.activeSource;
}

function sourceBinding(snapshot: Snapshot) {
  const source = activeSource(snapshot);
  if (source.sourceEpochNonce === null) {
    throw new Error("test fixture expected one live native source epoch");
  }
  return {
    sourceEpochNonce: source.sourceEpochNonce,
    renderGeneration: source.renderGeneration,
  };
}

function coordinatorBinding(snapshot: Snapshot) {
  return {
    ...sourceBinding(snapshot),
    expectedWorkspaceRevision: snapshot.workspaceRevision,
  };
}

function coordinatorSourceBinding(snapshot: Snapshot) {
  return {
    expectedBrowserEpochNonceSha256: snapshot.browserEpochNonceSha256,
    renderGeneration: activeSource(snapshot).renderGeneration,
    expectedWorkspaceRevision: snapshot.workspaceRevision,
  };
}

function withUntrustedInputs(kernel: Kernel): Readonly<{
  recordSourceCoverage: (input: unknown) => Promise<unknown>;
  recordHumanAttestation: (input: unknown) => Promise<unknown>;
}> {
  return {
    recordSourceCoverage: async (input) =>
      await kernel.recordSourceCoverage(
        input as Parameters<Kernel["recordSourceCoverage"]>[0],
      ),
    recordHumanAttestation: async (input) =>
      await kernel.recordHumanAttestation(
        input as Parameters<Kernel["recordHumanAttestation"]>[0],
      ),
  };
}

function coverageInput(snapshot: Snapshot) {
  return {
    ...sourceBinding(snapshot),
    documentVisibilityState: "visible" as const,
    documentFocusState: "focused" as const,
    viewportCssWidth: GRAND_HALL_PANORAMA_WIDTH_PX,
    viewportCssHeight: GRAND_HALL_PANORAMA_HEIGHT_PX,
    devicePixelRatio: 1,
    sourceToCssTransform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    paintedTileBitsetHex: FULL_TILE_BITMAP,
  };
}

async function freshSession(fixture: Harness): Promise<Kernel> {
  return await __testOnlyGrandHallT554NativeReviewSourceSessionV2.create(
    { sessionRoot: fixture.sessionRoot },
    fixture.dependencies,
  );
}

async function expectedSessionScope(sessionRoot: string): Promise<unknown> {
  const parsed: unknown = JSON.parse(
    await readFile(join(sessionRoot, "session-root.json"), "utf8"),
  );
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("sessionScope" in parsed)
  ) {
    throw new Error("session root fixture has no session scope");
  }
  return parsed.sessionScope;
}

async function coordinatorEventTypes(sessionRoot: string): Promise<string[]> {
  return (await coordinatorEvents(sessionRoot)).map((event) => event.eventType);
}

async function coordinatorEvents(sessionRoot: string) {
  const journal = await openGrandHallT554NativeReviewDurableJournalV2({
    workspaceRoot: join(sessionRoot, "coordinator"),
    expectedScope: await expectedSessionScope(sessionRoot),
  });
  const replay = await journal.replay();
  return replay.events;
}

async function coordinatorReplayState(sessionRoot: string) {
  const expectedScope = await expectedSessionScope(sessionRoot);
  const journal = await openGrandHallT554NativeReviewDurableJournalV2({
    workspaceRoot: join(sessionRoot, "coordinator"),
    expectedScope,
  });
  return replayGrandHallT554NativeReviewCoordinatorV2({
    scope: expectedScope,
    events: (await journal.replay()).events,
  });
}

async function sourceChildEventTypes(sessionRoot: string): Promise<string[]> {
  const childNames = await readdir(join(sessionRoot, "children"));
  if (childNames.length !== 1) {
    throw new Error(
      `source session fixture expected exactly one child, found ${String(childNames.length)}`,
    );
  }
  const [onlyChildName] = childNames;
  if (onlyChildName === undefined) throw new Error("missing source child");
  const descriptor: unknown = JSON.parse(
    await readFile(
      join(sessionRoot, "child-scopes", `${onlyChildName}.json`),
      "utf8",
    ),
  );
  if (
    typeof descriptor !== "object" ||
    descriptor === null ||
    !("scope" in descriptor)
  ) {
    throw new Error("source child fixture has no scope descriptor");
  }
  const journal = await openGrandHallT554NativeReviewDurableJournalV2({
    workspaceRoot: join(sessionRoot, "children", onlyChildName),
    expectedScope: descriptor.scope,
  });
  return (await journal.replay()).events.map((event) => event.eventType);
}

async function sourceChildEvidence(sessionRoot: string, childName: string) {
  const descriptor: unknown = JSON.parse(
    await readFile(
      join(sessionRoot, "child-scopes", `${childName}.json`),
      "utf8",
    ),
  );
  if (
    typeof descriptor !== "object" ||
    descriptor === null ||
    !("scope" in descriptor)
  ) {
    throw new Error("source child fixture has no scope descriptor");
  }
  const evidence =
    await openGrandHallT554NativeReviewVerifiedDurableChildEvidenceV2({
      workspaceRoot: join(sessionRoot, "children", childName),
      expectedScope: descriptor.scope,
    });
  if (evidence.kind !== "source") {
    throw new Error("source session fixture opened a non-source child");
  }
  return evidence;
}

async function seedExactCompletedSourceCoverage(sessionRoot: string) {
  const childNames = await readdir(join(sessionRoot, "children"));
  if (childNames.length !== 1 || childNames[0] === undefined) {
    throw new Error("bulk source-coverage fixture requires one source child");
  }
  const childName = childNames[0];
  const evidence = await sourceChildEvidence(sessionRoot, childName);
  if (evidence.checkpoint.revision !== 1) {
    throw new Error("bulk source-coverage fixture requires a start-only child");
  }
  const journalRoot = join(sessionRoot, "children", childName);
  const journal = await openGrandHallT554NativeReviewDurableJournalV2({
    workspaceRoot: journalRoot,
    expectedScope: evidence.scope,
  });
  const start = await journal.replay();
  await bulkAppendExactChildFixture({
    journalRoot,
    start,
    scope: evidence.scope,
    events: completeSourceCoverageEvents(evidence.scope),
  });
  const completed = await sourceChildEvidence(sessionRoot, childName);
  const carry = createGrandHallT554NativeReviewCoverageCarryStateV2(completed);
  if (
    carry.kind !== "source" ||
    carry.completedTileCount !== 512 ||
    carry.completedTileBitsetHex !== FULL_TILE_BITMAP
  ) {
    throw new Error("bulk source-coverage fixture did not verify as complete");
  }
  return carry;
}

async function selectFirstSource(session: Kernel): Promise<Snapshot> {
  const before = await session.snapshot();
  return await session.selectSource({
    expectedWorkspaceRevision: before.workspaceRevision,
    inventoryIndex: 0,
  });
}

async function finishEverySourceTile(
  session: Kernel,
  snapshot: Snapshot,
): Promise<void> {
  const binding = sourceBinding(snapshot);
  for (let tileIndex = 0; tileIndex < 512; tileIndex += 1) {
    const prepared = await session.prepareSourceTile({
      ...binding,
      column: tileIndex % 32,
      row: Math.floor(tileIndex / 32),
    });
    expect(prepared.sourceRgb8).toHaveLength(SOURCE_TILE_BYTE_LENGTH);
    await prepared.commitDeliveryAfterSuccessfulSend();
    expect(prepared.sourceRgb8.every((value) => value === 0)).toBe(true);
  }
}

async function completeSourceCoverage(
  fixture: Harness,
  session: Kernel,
  selected: Snapshot,
): Promise<Snapshot> {
  await finishEverySourceTile(session, selected);
  await session.recordSourceCoverage(coverageInput(selected));
  fixture.advance(500);
  await session.recordSourceCoverage(coverageInput(selected));
  fixture.advance(250);
  await session.recordSourceCoverage(coverageInput(selected));
  return await session.snapshot();
}

type MaskWorkflowDependencies = Parameters<
  typeof __testOnlyGrandHallT554NativeReviewMaskWorkflowSessionV2.open
>[1];

interface MaskWorkflowDependencyOverrides {
  readonly configureMaskStore?: (
    store: GrandHallT554NativeMaskRevisionStore,
  ) => void;
  readonly openSourceEpoch?: MaskWorkflowDependencies["openSourceEpoch"];
  readonly nowUtc?: MaskWorkflowDependencies["nowUtc"];
  readonly monotonicNowMs?: MaskWorkflowDependencies["monotonicNowMs"];
  readonly seam?: MaskWorkflowDependencies["seam"];
}

function maskWorkflowDependencies(
  sourceDependencies: ReturnType<typeof createDependencies>,
  overrides: MaskWorkflowDependencyOverrides = {},
): MaskWorkflowDependencies {
  return {
    registry: sourceDependencies.registry,
    implementationManifestBinding:
      sourceDependencies.implementationManifestBinding,
    copyExactManifestBytes: sourceDependencies.copyExactManifestBytes,
    openSourceEpoch: sourceDependencies.openSourceEpoch,
    newNonce: sourceDependencies.newNonce,
    nowUtc: () => new Date().toISOString(),
    monotonicNowMs: sourceDependencies.monotonicNowMs,
    ...overrides,
  };
}

type MaskWorkflowSnapshot = Awaited<
  ReturnType<GrandHallT554NativeReviewMaskWorkflowSessionV2["snapshot"]>
>;

function activeMaskSource(snapshot: MaskWorkflowSnapshot) {
  if (snapshot.activeSource === null) {
    throw new Error("mask-workflow fixture expected one active source");
  }
  return snapshot.activeSource;
}

function maskGuard(snapshot: MaskWorkflowSnapshot) {
  const active = activeMaskSource(snapshot);
  return {
    expectedBrowserEpochNonceSha256: snapshot.browserEpochNonceSha256,
    expectedWorkspaceRevision: snapshot.workspaceRevision,
    expectedRenderGeneration: active.renderGeneration,
    sourceReviewSubjectSha256: active.sourceReviewSubjectSha256,
  };
}

function maskRenderBinding(snapshot: MaskWorkflowSnapshot) {
  const active = activeMaskSource(snapshot);
  const maskState = active.maskState;
  if (maskState === null) {
    throw new Error("mask render fixture requires an active mask state");
  }
  return {
    expectedBrowserEpochNonceSha256: snapshot.browserEpochNonceSha256,
    expectedRenderGeneration: active.renderGeneration,
    sourceReviewSubjectSha256: active.sourceReviewSubjectSha256,
    maskStateSha256: maskState.maskStateSha256,
    maskReviewSubjectSha256: active.maskReviewSubjectSha256,
  };
}

function maskCoverageInput(
  snapshot: Awaited<
    ReturnType<GrandHallT554NativeReviewMaskWorkflowSessionV2["snapshot"]>
  >,
  paintedTileBitsetHex = FULL_TILE_BITMAP,
) {
  return {
    ...maskRenderBinding(snapshot),
    documentVisibilityState: "visible" as const,
    documentFocusState: "focused" as const,
    viewportCssWidth: GRAND_HALL_PANORAMA_WIDTH_PX,
    viewportCssHeight: GRAND_HALL_PANORAMA_HEIGHT_PX,
    devicePixelRatio: 1,
    sourceToCssTransform: {
      a: 1,
      b: 0 as const,
      c: 0 as const,
      d: 1,
      e: 0,
      f: 0,
    },
    paintedTileBitsetHex,
  };
}

function includeDecisionInput(snapshot: MaskWorkflowSnapshot) {
  return {
    ...maskGuard(snapshot),
    classification: "grand_hall_core" as const,
    note: "Exact frozen mask supports observed Grand Hall pixels.",
  };
}

function withUntrustedMaskInputs(
  session: GrandHallT554NativeReviewMaskWorkflowSessionV2,
): Readonly<{
  recordIncludeDecision: (input: unknown) => Promise<unknown>;
}> {
  return {
    recordIncludeDecision: async (input) =>
      await session.recordIncludeDecision(
        input as Parameters<
          GrandHallT554NativeReviewMaskWorkflowSessionV2["recordIncludeDecision"]
        >[0],
      ),
  };
}

async function createEditedMaskWorkflow(
  fixture: Harness,
  dependencies: MaskWorkflowDependencies,
): Promise<{
  readonly session: GrandHallT554NativeReviewMaskWorkflowSessionV2;
  readonly edited: MaskWorkflowSnapshot;
}> {
  const sourceSession = await freshSession(fixture);
  await selectFirstSource(sourceSession);
  const completedCoverage = await seedExactCompletedSourceCoverage(
    fixture.sessionRoot,
  );
  expect(completedCoverage).toMatchObject({
    kind: "source",
    completedTileCount: 512,
    completedTileBitsetHex: FULL_TILE_BITMAP,
  });
  await sourceSession.close();

  const session =
    await __testOnlyGrandHallT554NativeReviewMaskWorkflowSessionV2.open(
      { sessionRoot: fixture.sessionRoot },
      dependencies,
    );
  const opened = await session.snapshot();
  const begun = await session.beginMaskWorkflow(maskGuard(opened));
  const edited = await session.applyMaskEdit({
    ...maskGuard(begun),
    edit: {
      expectedRevision: 0,
      operation: "include",
      primitive: {
        kind: "rectangle",
        horizontalSeam: "none",
        leftPx: 0,
        topPx: 0,
        rightExclusivePx: 8,
        bottomExclusivePx: 8,
      },
    },
  });
  return { session, edited };
}

async function takeOverMaskWorkflowAfterCrash(
  fixture: Harness,
  overrides: MaskWorkflowDependencyOverrides = {},
): Promise<GrandHallT554NativeReviewMaskWorkflowSessionV2> {
  const priorOwnerWitness = await inspectGrandHallT554NativeReviewPriorOwnerV2({
    sessionRoot: fixture.sessionRoot,
    expectedSessionScope: await expectedSessionScope(fixture.sessionRoot),
  });
  if (priorOwnerWitness === null) {
    throw new Error("mask crash fixture unexpectedly had no prior owner");
  }
  return await __testOnlyGrandHallT554NativeReviewMaskWorkflowSessionV2.takeOver(
    { sessionRoot: fixture.sessionRoot, priorOwnerWitness },
    maskWorkflowDependencies(fixture.withoutCrashSeam(), overrides),
  );
}

async function maskChildLeafNames(sessionRoot: string): Promise<string[]> {
  return (await readdir(join(sessionRoot, "children")))
    .filter(
      (name) =>
        name.startsWith("mask-freeze-") || name.startsWith("mask-resume-"),
    )
    .sort();
}

async function maskChildEvidenceAt(sessionRoot: string, childName: string) {
  const descriptor: unknown = JSON.parse(
    await readFile(
      join(sessionRoot, "child-scopes", `${childName}.json`),
      "utf8",
    ),
  );
  if (
    typeof descriptor !== "object" ||
    descriptor === null ||
    !("scope" in descriptor)
  ) {
    throw new Error("mask fixture has no scope descriptor");
  }
  const evidence =
    await openGrandHallT554NativeReviewVerifiedDurableChildEvidenceV2({
      workspaceRoot: join(sessionRoot, "children", childName),
      expectedScope: descriptor.scope,
    });
  if (evidence.kind !== "mask") {
    throw new Error("mask fixture opened a non-mask child");
  }
  return evidence;
}

async function maskChildEvidence(sessionRoot: string) {
  const childNames = await maskChildLeafNames(sessionRoot);
  const childName = childNames[0];
  if (childName === undefined || childNames.length !== 1) {
    throw new Error("mask fixture requires exactly one mask child");
  }
  return await maskChildEvidenceAt(sessionRoot, childName);
}

async function latestMaskChildEvidence(sessionRoot: string) {
  const childNames = await maskChildLeafNames(sessionRoot);
  const childName = childNames.at(-1);
  if (childName === undefined) {
    throw new Error("mask fixture requires at least one mask child");
  }
  return await maskChildEvidenceAt(sessionRoot, childName);
}

async function seedExactCompletedMaskCoverage(sessionRoot: string) {
  const evidence = await latestMaskChildEvidence(sessionRoot);
  if (evidence.checkpoint.revision !== 1) {
    throw new Error("bulk mask-coverage fixture requires a start-only child");
  }
  const journalRoot = join(
    sessionRoot,
    "children",
    evidence.checkpoint.leafName,
  );
  const journal = await openGrandHallT554NativeReviewDurableJournalV2({
    workspaceRoot: journalRoot,
    expectedScope: evidence.scope,
  });
  const start = await journal.replay();
  const startRecordedAtUtc = start.records.at(-1)?.recordedAtUtc;
  if (startRecordedAtUtc === undefined) {
    throw new Error("bulk mask-coverage fixture has no start timestamp");
  }
  await bulkAppendExactChildFixture({
    journalRoot,
    start,
    scope: evidence.scope,
    events: completeMaskCoverageEvents(evidence.scope, startRecordedAtUtc),
  });
  const completed = await maskChildEvidenceAt(
    sessionRoot,
    evidence.checkpoint.leafName,
  );
  const carry = createGrandHallT554NativeReviewCoverageCarryStateV2(completed);
  if (
    carry.kind !== "mask" ||
    carry.completedTileCount !== 512 ||
    carry.completedTileBitsetHex !== FULL_TILE_BITMAP
  ) {
    throw new Error("bulk mask-coverage fixture did not verify as complete");
  }
  return carry;
}

async function maskDescriptorLeafNames(sessionRoot: string): Promise<string[]> {
  return (await readdir(join(sessionRoot, "child-scopes")))
    .filter(
      (name) =>
        name.startsWith("mask-freeze-") || name.startsWith("mask-resume-"),
    )
    .sort();
}

describe("Grand Hall T-554 source-only durable session v2", () => {
  it(
    "creates a fresh authority-none root and serializes one lease-asserted source selection",
    { timeout: 120_000 },
    async () => {
      expect(createGrandHallT554NativeReviewSourceSessionV2).toBeTypeOf(
        "function",
      );
      expect(openGrandHallT554NativeReviewSourceSessionV2).toBeTypeOf(
        "function",
      );
      expect(
        takeOverGrandHallT554NativeReviewSourceSessionAfterCrashV2,
      ).toBeTypeOf("function");
      expect(GrandHallT554NativeReviewSourceSessionV2Error).toBeTypeOf(
        "function",
      );

      const fixture = await harness();
      await expect(access(fixture.sessionRoot)).rejects.toMatchObject({
        code: "ENOENT",
      });
      const session = await freshSession(fixture);
      const initial = await session.snapshot();
      expect(initial).toMatchObject({
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-source-session.v2",
        lifecycle: "active",
        workspaceRevision: 0,
        maximumAllocatedRenderGeneration: 0,
        activeSource: null,
        authority: "none",
        reviewState: "human_pending",
        finalDecision: "PENDING",
        acceptanceAuthorized: false,
        reconstructionAuthorized: false,
        runtimeAuthorized: false,
        exportAuthorized: false,
        generatedContentAuthorized: false,
      });
      expect(initial.browserEpochNonceSha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(initial.rootInventorySha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(initial.verificationAttestationSha256).toMatch(
        /^sha256:[a-f0-9]{64}$/u,
      );
      expect((await readdir(fixture.sessionRoot)).sort()).toEqual(
        [
          "child-scopes",
          "children",
          "coordinator",
          GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME,
          "mask-evidence",
          "session-root.json",
        ].sort(),
      );
      expect(
        await readFile(
          join(
            fixture.sessionRoot,
            GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME,
          ),
        ),
      ).toEqual(fixture.dependencies.copyExactManifestBytes());
      expect(
        Object.getOwnPropertyNames(Object.getPrototypeOf(session)).sort(),
      ).toEqual([
        "abandonActiveSource",
        "close",
        "constructor",
        "prepareSourceTile",
        "recordExcludeDecision",
        "recordHumanAttestation",
        "recordSourceCoverage",
        "selectSource",
        "snapshot",
        "stop",
      ]);

      const firstRequest = {
        expectedWorkspaceRevision: initial.workspaceRevision,
        inventoryIndex: 0,
      };
      const secondRequest = {
        expectedWorkspaceRevision: initial.workspaceRevision,
        inventoryIndex: 1,
      };
      const results = await Promise.allSettled([
        session.selectSource(firstRequest),
        session.selectSource(secondRequest),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual([
        "fulfilled",
        "rejected",
      ]);
      const rejected = results.find((result) => result.status === "rejected");
      expect(rejected).toMatchObject({
        reason: { code: "WORKSPACE_REVISION_CONFLICT" },
      });
      expect(fixture.epochs).toHaveLength(1);

      const selected = await session.snapshot();
      expect(selected).toMatchObject({
        workspaceRevision: 1,
        maximumAllocatedRenderGeneration: 1,
        activeSource: {
          phase: "source_review",
          sourceCoverage: { completedTileCount: 0, complete: false },
        },
      });
      const events = await coordinatorEvents(fixture.sessionRoot);
      expect(events.map((event) => event.eventType)).toEqual([
        "session.created.v2",
        "session.browser-epoch-started.v2",
        "source.selection-intended.v2",
        "source.selection-committed.v2",
      ]);
      const intent = events[2];
      const commit = events[3];
      expect(intent?.eventType).toBe("source.selection-intended.v2");
      expect(commit?.eventType).toBe("source.selection-committed.v2");
      if (
        intent?.eventType !== "source.selection-intended.v2" ||
        commit?.eventType !== "source.selection-committed.v2"
      ) {
        throw new Error("source selection events were reordered");
      }
      expect(intent.payload.preparedSourceCustody).toEqual(
        commit.payload.sourceCustody,
      );
      expect(await sourceChildEventTypes(fixture.sessionRoot)).toEqual([
        "source.review-started.v2",
      ]);

      const discarded = await session.prepareSourceTile({
        ...sourceBinding(selected),
        column: 0,
        row: 0,
      });
      expect(discarded.sourceRgb8.some((value) => value !== 0)).toBe(true);
      await discarded.discardAfterFailedSend();
      expect(discarded.sourceRgb8.every((value) => value === 0)).toBe(true);
      await expect(
        discarded.commitDeliveryAfterSuccessfulSend(),
      ).rejects.toMatchObject({ code: "DELIVERY_ALREADY_RESOLVED" });
      expect(await sourceChildEventTypes(fixture.sessionRoot)).toEqual([
        "source.review-started.v2",
      ]);

      const mutated = await session.prepareSourceTile({
        ...sourceBinding(selected),
        column: 0,
        row: 0,
      });
      mutated.sourceRgb8[0] = (mutated.sourceRgb8[0] ?? 0) ^ 0xff;
      await expect(
        mutated.commitDeliveryAfterSuccessfulSend(),
      ).rejects.toMatchObject({ code: "SOURCE_TILE_MUTATED" });
      expect(mutated.sourceRgb8.every((value) => value === 0)).toBe(true);
      expect(await sourceChildEventTypes(fixture.sessionRoot)).toEqual([
        "source.review-started.v2",
      ]);

      const delivered = await session.prepareSourceTile({
        ...sourceBinding(selected),
        column: 0,
        row: 0,
      });
      expect(delivered.commitDeliveryAfterSuccessfulSend).toHaveLength(0);
      await delivered.commitDeliveryAfterSuccessfulSend();
      expect(await sourceChildEventTypes(fixture.sessionRoot)).toEqual([
        "source.review-started.v2",
        "source.tile-delivered.v2",
      ]);
      const childName = (
        await readdir(join(fixture.sessionRoot, "children"))
      )[0];
      if (childName === undefined)
        throw new Error("missing selected source child");
      const child = await sourceChildEvidence(fixture.sessionRoot, childName);
      expect(child.events[1]).toMatchObject({
        eventType: "source.tile-delivered.v2",
        payload: { responseFinishedAtUtc: "2000-01-01T00:00:00.000Z" },
      });
      await session.close();
    },
  );

  it.each([
    {
      field: "schemaVersion",
      mutate: (snapshot: GrandHallT554NativeSourceEpochSnapshotV1) => {
        Reflect.set(snapshot, "schemaVersion", "forged-source-epoch");
      },
    },
    {
      field: "epochBindingSha256",
      mutate: (snapshot: GrandHallT554NativeSourceEpochSnapshotV1) => {
        Reflect.set(
          snapshot,
          "epochBindingSha256",
          digest("forged-epoch-binding"),
        );
      },
    },
    {
      field: "tileGrid.channelCount",
      mutate: (snapshot: GrandHallT554NativeSourceEpochSnapshotV1) => {
        Reflect.set(snapshot.tileGrid, "channelCount", 4);
      },
    },
    {
      field: "tileGrid.resampling",
      mutate: (snapshot: GrandHallT554NativeSourceEpochSnapshotV1) => {
        Reflect.set(snapshot.tileGrid, "resampling", "bilinear");
      },
    },
  ])(
    "rejects a prepared epoch with drifted $field and abandons its decoded capability",
    async ({ mutate }) => {
      const fixture = await harness(undefined, mutate);
      const session = await freshSession(fixture);
      const initial = await session.snapshot();

      await expect(
        session.selectSource({
          expectedWorkspaceRevision: initial.workspaceRevision,
          inventoryIndex: 0,
        }),
      ).rejects.toMatchObject({ code: "RESOURCE_FAILURE" });
      expect(fixture.epochs).toHaveLength(1);
      expect(fixture.epochs[0]?.abandoned).toBe(true);
      expect(await coordinatorEventTypes(fixture.sessionRoot)).toEqual([
        "session.created.v2",
        "session.browser-epoch-started.v2",
      ]);
      await session.close();
    },
  );

  it(
    "durably completes source coverage, records EXCLUDE and authority-none attestation, abandons, stops, and reopens from disk",
    { timeout: 900_000 },
    async () => {
      const fixture = await harness();
      let session = await freshSession(fixture);
      const selected = await selectFirstSource(session);
      await expect(
        withUntrustedInputs(session).recordSourceCoverage({
          ...coverageInput(selected),
          sequence: 0,
          serverObservation: {
            receivedAtUtc: "2099-01-01T00:00:00.000Z",
            monotonicElapsedMs: 750,
          },
          completedTileCount: 512,
        }),
      ).rejects.toMatchObject({ code: "ARGUMENT_INVALID" });
      await expect(
        session.recordExcludeDecision({
          ...coordinatorBinding(selected),
          note: "The exact native-grid review found no Grand Hall pixels.",
        }),
      ).rejects.toMatchObject({ code: "SOURCE_COVERAGE_INCOMPLETE" });

      const completed = await completeSourceCoverage(
        fixture,
        session,
        selected,
      );
      expect(activeSource(completed).sourceCoverage).toMatchObject({
        deliveredTileCount: 512,
        completedTileCount: 512,
        complete: true,
      });
      const decidedEpochNonce = sourceBinding(completed).sourceEpochNonce;

      const decided = await session.recordExcludeDecision({
        ...coordinatorBinding(completed),
        note: "The exact native-grid review found no Grand Hall pixels.",
      });
      expect(decided.workspaceRevision).toBe(completed.workspaceRevision + 1);
      expect(activeSource(decided)).toMatchObject({
        phase: "source_decided",
        sourceEpochNonce: null,
        decision: {
          result: "EXCLUDE",
          classification: "no_observed_grand_hall_pixels",
        },
      });

      const decision = activeSource(decided).decision;
      if (decision === null)
        throw new Error("EXCLUDE decision was not exposed");
      const decidedBrowserEpoch = decided.browserEpochNonceSha256;
      const decidedWorkspaceRevision = decided.workspaceRevision;
      const decidedRenderGeneration = activeSource(decided).renderGeneration;
      await session.close();
      expect(fixture.epochs).toHaveLength(1);
      expect(fixture.epochs[0]?.abandoned).toBe(true);

      session = await __testOnlyGrandHallT554NativeReviewSourceSessionV2.open(
        { sessionRoot: fixture.sessionRoot },
        fixture.withoutCrashSeam(),
      );
      const reopenedDecided = await session.snapshot();
      expect(reopenedDecided).toMatchObject({
        workspaceRevision: decidedWorkspaceRevision,
        maximumAllocatedRenderGeneration:
          decided.maximumAllocatedRenderGeneration,
        activeSource: {
          phase: "source_decided",
          sourceEpochNonce: null,
          renderGeneration: decidedRenderGeneration,
          decision,
        },
      });
      expect(reopenedDecided.browserEpochNonceSha256).not.toBe(
        decidedBrowserEpoch,
      );
      expect(fixture.epochs).toHaveLength(1);
      expect(
        (await coordinatorEventTypes(fixture.sessionRoot)).filter((eventType) =>
          eventType.startsWith("coverage.segment-resume-"),
        ),
      ).toEqual([]);
      const beforeStaleAttestation = await coordinatorEventTypes(
        fixture.sessionRoot,
      );
      await expect(
        session.recordHumanAttestation({
          expectedBrowserEpochNonceSha256: decidedBrowserEpoch,
          renderGeneration: decidedRenderGeneration,
          expectedWorkspaceRevision: decidedWorkspaceRevision,
          reviewerId: "stale-browser-reviewer",
          knowledgeBasis: ["This stale request must not append."],
        }),
      ).rejects.toMatchObject({ code: "SOURCE_STALE" });
      expect(await coordinatorEventTypes(fixture.sessionRoot)).toEqual(
        beforeStaleAttestation,
      );
      await expect(
        withUntrustedInputs(session).recordHumanAttestation({
          sourceEpochNonce: decidedEpochNonce,
          renderGeneration: decidedRenderGeneration,
          expectedWorkspaceRevision: decidedWorkspaceRevision,
          reviewerId: "obsolete-source-epoch-binding",
          knowledgeBasis: ["This request must fail strict parsing."],
        }),
      ).rejects.toMatchObject({ code: "ARGUMENT_INVALID" });
      await expect(
        withUntrustedInputs(session).recordHumanAttestation({
          ...coordinatorSourceBinding(reopenedDecided),
          decisionSha256: decision.decisionSha256,
          reviewerId: "browser-supplied-derived-binding",
          knowledgeBasis: ["This request must fail strict parsing."],
        }),
      ).rejects.toMatchObject({ code: "ARGUMENT_INVALID" });

      const decidedPriorOwnerWitness =
        await inspectGrandHallT554NativeReviewPriorOwnerV2({
          sessionRoot: fixture.sessionRoot,
          expectedSessionScope: await expectedSessionScope(fixture.sessionRoot),
        });
      if (decidedPriorOwnerWitness === null) {
        throw new Error("decided takeover fixture unexpectedly had no owner");
      }
      const decidedTakeover =
        await __testOnlyGrandHallT554NativeReviewSourceSessionV2.takeOver(
          {
            sessionRoot: fixture.sessionRoot,
            priorOwnerWitness: decidedPriorOwnerWitness,
          },
          fixture.withoutCrashSeam(),
        );
      const takeoverDecided = await decidedTakeover.snapshot();
      expect(takeoverDecided).toMatchObject({
        workspaceRevision: decidedWorkspaceRevision,
        activeSource: {
          phase: "source_decided",
          sourceEpochNonce: null,
          renderGeneration: decidedRenderGeneration,
          decision,
        },
      });
      expect(takeoverDecided.browserEpochNonceSha256).not.toBe(
        reopenedDecided.browserEpochNonceSha256,
      );
      await expect(session.close()).rejects.toMatchObject({
        code: "STALE_LEASE",
      });
      session = decidedTakeover;
      const attested = await session.recordHumanAttestation({
        ...coordinatorSourceBinding(takeoverDecided),
        reviewerId: "authorized-reviewer-1",
        knowledgeBasis: [
          "Reviewed the exact source at its complete native tile grid.",
        ],
      });
      const humanAttestation = activeSource(attested).humanAttestation;
      if (humanAttestation === null) {
        throw new Error("human attestation was not exposed after append");
      }
      expect(humanAttestation).toMatchObject({
        decisionSha256: decision.decisionSha256,
        reviewerRole: "venue_owner_or_authorized_domain_reviewer",
        humanPresenceProof: "not_cryptographic",
        agentDecisionAuthority: "none",
        authority: "none",
      });

      const attestedBrowserEpoch = attested.browserEpochNonceSha256;
      const scope = await expectedSessionScope(fixture.sessionRoot);
      const priorOwnerWitness =
        await inspectGrandHallT554NativeReviewPriorOwnerV2({
          sessionRoot: fixture.sessionRoot,
          expectedSessionScope: scope,
        });
      if (priorOwnerWitness === null) {
        throw new Error(
          "attested crash fixture unexpectedly had no prior owner",
        );
      }
      const recovered =
        await __testOnlyGrandHallT554NativeReviewSourceSessionV2.takeOver(
          { sessionRoot: fixture.sessionRoot, priorOwnerWitness },
          fixture.withoutCrashSeam(),
        );
      const recoveredAttested = await recovered.snapshot();
      expect(recoveredAttested).toMatchObject({
        workspaceRevision: attested.workspaceRevision,
        maximumAllocatedRenderGeneration:
          attested.maximumAllocatedRenderGeneration,
        activeSource: {
          phase: "human_attested",
          sourceEpochNonce: null,
          renderGeneration: activeSource(attested).renderGeneration,
          decision,
          humanAttestation,
        },
      });
      expect(recoveredAttested.browserEpochNonceSha256).not.toBe(
        attestedBrowserEpoch,
      );
      expect(fixture.epochs).toHaveLength(1);
      await expect(session.close()).rejects.toMatchObject({
        code: "STALE_LEASE",
      });
      await expect(
        recovered.abandonActiveSource({
          expectedBrowserEpochNonceSha256: attestedBrowserEpoch,
          renderGeneration: activeSource(recoveredAttested).renderGeneration,
          expectedWorkspaceRevision: recoveredAttested.workspaceRevision,
          reason: "session_stop",
        }),
      ).rejects.toMatchObject({ code: "SOURCE_STALE" });

      await recovered.close();
      const cleanAttestedSession =
        await __testOnlyGrandHallT554NativeReviewSourceSessionV2.open(
          { sessionRoot: fixture.sessionRoot },
          fixture.withoutCrashSeam(),
        );
      const cleanAttested = await cleanAttestedSession.snapshot();
      expect(cleanAttested).toMatchObject({
        workspaceRevision: attested.workspaceRevision,
        activeSource: {
          phase: "human_attested",
          sourceEpochNonce: null,
          decision,
          humanAttestation,
        },
      });
      expect(cleanAttested.browserEpochNonceSha256).not.toBe(
        recoveredAttested.browserEpochNonceSha256,
      );

      const abandoned = await cleanAttestedSession.abandonActiveSource({
        ...coordinatorSourceBinding(cleanAttested),
        reason: "session_stop",
      });
      expect(abandoned.activeSource).toBeNull();
      const stopped = await cleanAttestedSession.stop({
        expectedWorkspaceRevision: abandoned.workspaceRevision,
      });
      expect(stopped).toMatchObject({
        lifecycle: "stopped",
        activeSource: null,
        authority: "none",
        finalDecision: "PENDING",
      });
      const stableDigests = {
        rootInventorySha256: stopped.rootInventorySha256,
        verificationAttestationSha256: stopped.verificationAttestationSha256,
      };
      await cleanAttestedSession.close();

      const reopened =
        await __testOnlyGrandHallT554NativeReviewSourceSessionV2.open(
          { sessionRoot: fixture.sessionRoot },
          fixture.withoutCrashSeam(),
        );
      expect(await reopened.snapshot()).toMatchObject({
        lifecycle: "stopped",
        ...stableDigests,
      });
      const durableCoordinatorEvents = await coordinatorEvents(
        fixture.sessionRoot,
      );
      expect(durableCoordinatorEvents.map((event) => event.eventType)).toEqual([
        "session.created.v2",
        "session.browser-epoch-started.v2",
        "source.selection-intended.v2",
        "source.selection-committed.v2",
        "source.decision-recorded.v2",
        "session.browser-epoch-started.v2",
        "session.browser-epoch-started.v2",
        "source.human-attestation-recorded.v2",
        "session.browser-epoch-started.v2",
        "session.browser-epoch-started.v2",
        "source.abandoned.v2",
        "session.stopped.v2",
      ]);
      const durableDecision = durableCoordinatorEvents.find(
        (event) => event.eventType === "source.decision-recorded.v2",
      );
      const durableAttestation = durableCoordinatorEvents.find(
        (event) => event.eventType === "source.human-attestation-recorded.v2",
      );
      expect(durableDecision?.payload).toMatchObject({
        sourceCustody: {
          sourceReviewSubjectSha256:
            activeSource(decided).sourceReviewSubjectSha256,
        },
        completedSourceCoverage: {
          sourceReviewSubjectSha256:
            activeSource(decided).sourceReviewSubjectSha256,
        },
        decisionSha256: decision.decisionSha256,
        result: "EXCLUDE",
        classification: "no_observed_grand_hall_pixels",
      });
      expect(durableAttestation?.payload).toMatchObject({
        sourceReviewSubjectSha256:
          activeSource(decided).sourceReviewSubjectSha256,
        decisionSha256: decision.decisionSha256,
        attestationSha256: humanAttestation.attestationSha256,
        reviewerId: "authorized-reviewer-1",
        agentDecisionAuthority: "none",
        authority: "none",
      });
      const childEvents = await sourceChildEventTypes(fixture.sessionRoot);
      expect(childEvents[0]).toBe("source.review-started.v2");
      expect(childEvents.slice(1, 513)).toEqual(
        Array.from({ length: 512 }, () => "source.tile-delivered.v2"),
      );
      expect(childEvents.slice(513)).toEqual([
        "source.coverage-observed.v2",
        "source.coverage-observed.v2",
        "source.coverage-observed.v2",
      ]);
      await reopened.close();

      await writeFile(
        join(fixture.sessionRoot, "unexpected-root-member"),
        "must fail exact recursive inventory\n",
        "utf8",
      );
      await expect(
        __testOnlyGrandHallT554NativeReviewSourceSessionV2.open(
          { sessionRoot: fixture.sessionRoot },
          fixture.withoutCrashSeam(),
        ),
      ).rejects.toMatchObject({ code: "INVENTORY_INVALID" });
    },
  );

  it(
    "requires explicit takeover after a crash immediately following durable browser-epoch rotation",
    { timeout: 180_000 },
    async () => {
      const fixture = await harness();
      const original = await freshSession(fixture);
      const originalSnapshot = await original.snapshot();
      await original.close();

      await expect(
        __testOnlyGrandHallT554NativeReviewSourceSessionV2.open(
          { sessionRoot: fixture.sessionRoot },
          fixture.withCrashSeam(
            injectedCrashSeam("afterBrowserEpochStartedDurable"),
          ),
        ),
      ).rejects.toThrow("injected crash at afterBrowserEpochStartedDurable");
      const afterCrash = await coordinatorEvents(fixture.sessionRoot);
      const browserEventsAfterCrash = afterCrash.filter(
        (event) => event.eventType === "session.browser-epoch-started.v2",
      );
      expect(browserEventsAfterCrash).toHaveLength(2);
      expect(browserEventsAfterCrash.at(-1)?.payload).toMatchObject({
        reason: "clean_resume",
        previousBrowserEpochNonceSha256:
          originalSnapshot.browserEpochNonceSha256,
      });

      const scope = await expectedSessionScope(fixture.sessionRoot);
      const priorOwnerWitness =
        await inspectGrandHallT554NativeReviewPriorOwnerV2({
          sessionRoot: fixture.sessionRoot,
          expectedSessionScope: scope,
        });
      if (priorOwnerWitness === null) {
        throw new Error("browser-epoch crash fixture had no prior owner");
      }
      const recovered =
        await __testOnlyGrandHallT554NativeReviewSourceSessionV2.takeOver(
          { sessionRoot: fixture.sessionRoot, priorOwnerWitness },
          fixture.withoutCrashSeam(),
        );
      const recoveredSnapshot = await recovered.snapshot();
      expect(recoveredSnapshot.activeSource).toBeNull();
      expect(recoveredSnapshot.browserEpochNonceSha256).not.toBe(
        browserEventsAfterCrash.at(-1)?.payload.browserEpochNonceSha256,
      );
      const finalBrowserEvents = (
        await coordinatorEvents(fixture.sessionRoot)
      ).filter(
        (event) => event.eventType === "session.browser-epoch-started.v2",
      );
      expect(finalBrowserEvents).toHaveLength(3);
      expect(finalBrowserEvents.at(-1)?.payload).toMatchObject({
        reason: "crash_resume",
      });
      await recovered.close();
    },
  );

  it(
    "releases the owner when active-source resume cannot open its fresh epoch so clean reopen succeeds",
    { timeout: 180_000 },
    async () => {
      const fixture = await harness();
      const original = await freshSession(fixture);
      await selectFirstSource(original);
      await original.close();

      const failingDependencies = {
        ...fixture.withoutCrashSeam(),
        openSourceEpoch: (): Promise<never> =>
          Promise.reject(new Error("injected fresh source epoch open failure")),
      };
      await expect(
        __testOnlyGrandHallT554NativeReviewSourceSessionV2.open(
          { sessionRoot: fixture.sessionRoot },
          failingDependencies,
        ),
      ).rejects.toThrow("injected fresh source epoch open failure");

      const scope = await expectedSessionScope(fixture.sessionRoot);
      expect(
        await inspectGrandHallT554NativeReviewPriorOwnerV2({
          sessionRoot: fixture.sessionRoot,
          expectedSessionScope: scope,
        }),
      ).toBeNull();
      const recovered =
        await __testOnlyGrandHallT554NativeReviewSourceSessionV2.open(
          { sessionRoot: fixture.sessionRoot },
          fixture.withoutCrashSeam(),
        );
      expect(await recovered.snapshot()).toMatchObject({
        workspaceRevision: 2,
        maximumAllocatedRenderGeneration: 2,
        activeSource: {
          phase: "source_review",
          renderGeneration: 2,
        },
      });
      await recovered.close();
    },
  );

  it(
    "abandons a live source epoch and zeroes pending source bytes before publishing source abandonment",
    { timeout: 180_000 },
    async () => {
      const fixture = await harness();
      const session = await freshSession(fixture);
      const selected = await selectFirstSource(session);
      const pending = await session.prepareSourceTile({
        ...sourceBinding(selected),
        column: 0,
        row: 0,
      });
      expect(pending.sourceRgb8.some((value) => value !== 0)).toBe(true);

      const abandoned = await session.abandonActiveSource({
        ...coordinatorSourceBinding(selected),
        reason: "operator_abandon",
      });
      expect(abandoned.activeSource).toBeNull();
      expect(fixture.epochs).toHaveLength(1);
      expect(fixture.epochs[0]?.abandoned).toBe(true);
      expect(pending.sourceRgb8.every((value) => value === 0)).toBe(true);
      await expect(
        pending.commitDeliveryAfterSuccessfulSend(),
      ).rejects.toMatchObject({ code: "DELIVERY_ALREADY_RESOLVED" });
      expect((await coordinatorEventTypes(fixture.sessionRoot)).at(-1)).toBe(
        "source.abandoned.v2",
      );
      await session.close();
    },
  );

  it(
    "cleanly resumes an active source with a fresh epoch and the exact latest child checkpoint",
    { timeout: 180_000 },
    async () => {
      const fixture = await harness();
      const firstProcess = await freshSession(fixture);
      const selected = await selectFirstSource(firstProcess);
      const prepared = await firstProcess.prepareSourceTile({
        ...sourceBinding(selected),
        column: 0,
        row: 0,
      });
      await prepared.commitDeliveryAfterSuccessfulSend();
      await firstProcess.recordSourceCoverage(coverageInput(selected));
      fixture.advance(500);
      await firstProcess.recordSourceCoverage(coverageInput(selected));
      const beforeClose = await firstProcess.snapshot();
      const firstChildName = (
        await readdir(join(fixture.sessionRoot, "children"))
      )[0];
      if (firstChildName === undefined)
        throw new Error("missing first source child");
      const firstChild = await sourceChildEvidence(
        fixture.sessionRoot,
        firstChildName,
      );
      expect(firstChild.checkpoint.revision).toBe(4);
      const partialCarry =
        createGrandHallT554NativeReviewCoverageCarryStateV2(firstChild);
      expect(partialCarry).toMatchObject({
        kind: "source",
        predecessorJournal: firstChild.checkpoint,
        completedTileCount: 0,
      });
      const carriedDwell = Buffer.from(
        partialCarry.cappedDwellMsUint16LeBase64url,
        "base64url",
      );
      try {
        expect(carriedDwell.readUInt16LE(0)).toBe(500);
        expect(carriedDwell.subarray(2).every((value) => value === 0)).toBe(
          true,
        );
        expect(digest(carriedDwell)).toBe(partialCarry.cappedDwellBytesSha256);
      } finally {
        carriedDwell.fill(0);
      }
      const priorBrowserEpochNonceSha256 = beforeClose.browserEpochNonceSha256;
      const priorEpochNonce = activeSource(beforeClose).sourceEpochNonce;
      await firstProcess.close();
      expect(fixture.epochs[0]?.abandoned).toBe(true);

      const resumed =
        await __testOnlyGrandHallT554NativeReviewSourceSessionV2.open(
          { sessionRoot: fixture.sessionRoot },
          fixture.withoutCrashSeam(),
        );
      const snapshot = await resumed.snapshot();
      expect(snapshot).toMatchObject({
        lifecycle: "active",
        workspaceRevision: beforeClose.workspaceRevision + 1,
        maximumAllocatedRenderGeneration:
          beforeClose.maximumAllocatedRenderGeneration + 1,
        activeSource: {
          phase: "source_review",
          sourceCoverage: {
            deliveredTileCount: 0,
            completedTileCount: 0,
            complete: false,
          },
        },
      });
      expect(snapshot.browserEpochNonceSha256).not.toBe(
        priorBrowserEpochNonceSha256,
      );
      expect(activeSource(snapshot).sourceEpochNonce).not.toBe(priorEpochNonce);

      const events = await coordinatorEvents(fixture.sessionRoot);
      const rotatedBrowser = [...events]
        .reverse()
        .find(
          (event) => event.eventType === "session.browser-epoch-started.v2",
        );
      expect(rotatedBrowser?.eventType).toBe(
        "session.browser-epoch-started.v2",
      );
      if (rotatedBrowser?.eventType !== "session.browser-epoch-started.v2") {
        throw new Error("clean resume did not rotate the browser epoch");
      }
      expect(rotatedBrowser.payload).toMatchObject({
        reason: "clean_resume",
        previousBrowserEpochNonceSha256: priorBrowserEpochNonceSha256,
        priorActiveSourceJournal: firstChild.checkpoint,
        priorActiveMaskJournal: null,
      });
      expect(events.map((event) => event.eventType).slice(-3)).toEqual([
        "session.browser-epoch-started.v2",
        "coverage.segment-resume-intended.v2",
        "coverage.segment-resume-committed.v2",
      ]);
      const resumeIntent = events.at(-2);
      expect(resumeIntent?.eventType).toBe(
        "coverage.segment-resume-intended.v2",
      );
      if (resumeIntent?.eventType !== "coverage.segment-resume-intended.v2") {
        throw new Error("clean resume did not persist its resume intent");
      }
      expect(resumeIntent.payload).toMatchObject({
        kind: "source",
        priorChildJournal: firstChild.checkpoint,
        predecessorCoverage: partialCarry,
      });
      const resumedChildren = await readdir(
        join(fixture.sessionRoot, "children"),
      );
      expect(resumedChildren).toHaveLength(2);
      const resumedChildName = resumedChildren.find(
        (candidate) => candidate !== firstChildName,
      );
      if (resumedChildName === undefined) {
        throw new Error("clean resume did not publish a fresh child");
      }
      const resumedChild = await sourceChildEvidence(
        fixture.sessionRoot,
        resumedChildName,
      );
      expect(resumedChild.events).toHaveLength(1);
      expect(resumedChild.events[0]).toMatchObject({
        eventType: "source.review-started.v2",
        payload: { predecessorCoverage: partialCarry },
      });
      await resumed.close();
    },
  );

  it.each([
    {
      seamName: "afterCoverageResumeIntentDurable" as const,
      childDirectoryCount: 1,
      childDescriptorCount: 1,
      resumeWasCommitted: false,
    },
    {
      seamName: "afterCoverageResumeChildPublished" as const,
      childDirectoryCount: 2,
      childDescriptorCount: 1,
      resumeWasCommitted: false,
    },
    {
      seamName: "afterCoverageResumeDescriptorPublished" as const,
      childDirectoryCount: 2,
      childDescriptorCount: 2,
      resumeWasCommitted: false,
    },
    {
      seamName: "afterCoverageResumeCommitDurable" as const,
      childDirectoryCount: 2,
      childDescriptorCount: 2,
      resumeWasCommitted: true,
    },
  ])(
    "abandons its prepared epoch at $seamName and recovers only by explicit takeover",
    { timeout: 180_000 },
    async ({
      seamName,
      childDirectoryCount,
      childDescriptorCount,
      resumeWasCommitted,
    }) => {
      const fixture = await harness();
      const original = await freshSession(fixture);
      await selectFirstSource(original);
      await original.close();
      expect(fixture.epochs).toHaveLength(1);
      expect(fixture.epochs[0]?.abandoned).toBe(true);

      await expect(
        __testOnlyGrandHallT554NativeReviewSourceSessionV2.open(
          { sessionRoot: fixture.sessionRoot },
          fixture.withCrashSeam(injectedCrashSeam(seamName)),
        ),
      ).rejects.toThrow(`injected crash at ${seamName}`);
      expect(fixture.epochs).toHaveLength(2);
      expect(fixture.epochs[1]?.abandoned).toBe(true);
      expect(await readdir(join(fixture.sessionRoot, "children"))).toHaveLength(
        childDirectoryCount,
      );
      expect(
        await readdir(join(fixture.sessionRoot, "child-scopes")),
      ).toHaveLength(childDescriptorCount);
      const beforeTakeoverTypes = await coordinatorEventTypes(
        fixture.sessionRoot,
      );
      expect(beforeTakeoverTypes).toContain(
        "coverage.segment-resume-intended.v2",
      );
      expect(
        beforeTakeoverTypes.includes("coverage.segment-resume-committed.v2"),
      ).toBe(resumeWasCommitted);

      const scope = await expectedSessionScope(fixture.sessionRoot);
      const priorOwnerWitness =
        await inspectGrandHallT554NativeReviewPriorOwnerV2({
          sessionRoot: fixture.sessionRoot,
          expectedSessionScope: scope,
        });
      if (priorOwnerWitness === null) {
        throw new Error("resume crash fixture unexpectedly had no prior owner");
      }
      const recovered =
        await __testOnlyGrandHallT554NativeReviewSourceSessionV2.takeOver(
          { sessionRoot: fixture.sessionRoot, priorOwnerWitness },
          fixture.withoutCrashSeam(),
        );
      const snapshot = await recovered.snapshot();
      expect(snapshot.activeSource).toMatchObject({
        phase: "source_review",
        sourceCoverage: { completedTileCount: 0, complete: false },
      });
      expect(activeSource(snapshot).sourceEpochNonce).not.toBeNull();
      expect(fixture.epochs).toHaveLength(3);
      expect(fixture.epochs[2]?.abandoned).toBe(false);
      const afterTakeoverTypes = await coordinatorEventTypes(
        fixture.sessionRoot,
      );
      expect(afterTakeoverTypes.at(-1)).toBe(
        "coverage.segment-resume-committed.v2",
      );
      expect(
        afterTakeoverTypes.includes(
          "coverage.segment-resume-recovery-aborted.v2",
        ),
      ).toBe(!resumeWasCommitted);
      await recovered.close();
      expect(fixture.epochs[2]?.abandoned).toBe(true);
    },
  );

  it(
    "zeroes pending source bytes and abandons its local epoch even after owner takeover",
    { timeout: 180_000 },
    async () => {
      const fixture = await harness();
      const stale = await freshSession(fixture);
      const selected = await selectFirstSource(stale);
      const pending = await stale.prepareSourceTile({
        ...sourceBinding(selected),
        column: 0,
        row: 0,
      });
      expect(pending.sourceRgb8.some((value) => value !== 0)).toBe(true);

      const scope = await expectedSessionScope(fixture.sessionRoot);
      const priorOwnerWitness =
        await inspectGrandHallT554NativeReviewPriorOwnerV2({
          sessionRoot: fixture.sessionRoot,
          expectedSessionScope: scope,
        });
      if (priorOwnerWitness === null) {
        throw new Error("takeover fixture unexpectedly had no prior owner");
      }
      const recovered =
        await __testOnlyGrandHallT554NativeReviewSourceSessionV2.takeOver(
          { sessionRoot: fixture.sessionRoot, priorOwnerWitness },
          fixture.withoutCrashSeam(),
        );

      await expect(stale.close()).rejects.toMatchObject({
        code: "STALE_LEASE",
      });
      expect(pending.sourceRgb8.every((value) => value === 0)).toBe(true);
      expect(fixture.epochs[0]?.abandoned).toBe(true);
      await expect(
        pending.commitDeliveryAfterSuccessfulSend(),
      ).rejects.toMatchObject({ code: "DELIVERY_ALREADY_RESOLVED" });
      await recovered.close();
    },
  );

  it.each([
    {
      seamName: "afterSourceSelectionIntentDurable" as const,
      childDirectoryCount: 0,
      childDescriptorCount: 0,
      selectionWasCommitted: false,
    },
    {
      seamName: "afterSourceChildPublished" as const,
      childDirectoryCount: 1,
      childDescriptorCount: 0,
      selectionWasCommitted: false,
    },
    {
      seamName: "afterSourceDescriptorPublished" as const,
      childDirectoryCount: 1,
      childDescriptorCount: 1,
      selectionWasCommitted: false,
    },
    {
      seamName: "afterSourceSelectionCommitDurable" as const,
      childDirectoryCount: 1,
      childDescriptorCount: 1,
      selectionWasCommitted: true,
    },
  ])(
    "recovers $seamName only through explicit crash takeover",
    { timeout: 180_000 },
    async ({
      seamName,
      childDirectoryCount,
      childDescriptorCount,
      selectionWasCommitted,
    }) => {
      const fixture = await harness(injectedCrashSeam(seamName));
      const crashed = await freshSession(fixture);
      const crashedInitial = await crashed.snapshot();
      await expect(selectFirstSource(crashed)).rejects.toThrow(
        `injected crash at ${seamName}`,
      );
      expect(fixture.epochs).toHaveLength(1);
      expect(fixture.epochs[0]?.abandoned).toBe(true);
      expect(await readdir(join(fixture.sessionRoot, "children"))).toHaveLength(
        childDirectoryCount,
      );
      expect(
        await readdir(join(fixture.sessionRoot, "child-scopes")),
      ).toHaveLength(childDescriptorCount);
      const beforeTakeoverTypes = await coordinatorEventTypes(
        fixture.sessionRoot,
      );
      expect(beforeTakeoverTypes).toContain("source.selection-intended.v2");
      expect(beforeTakeoverTypes).toContain(
        selectionWasCommitted
          ? "source.selection-committed.v2"
          : "source.selection-intended.v2",
      );
      expect(
        beforeTakeoverTypes.includes("source.selection-committed.v2"),
      ).toBe(selectionWasCommitted);

      if (selectionWasCommitted) {
        const [committedChildName] = await readdir(
          join(fixture.sessionRoot, "children"),
        );
        if (committedChildName === undefined) {
          throw new Error("committed selection has no source child");
        }
        const startOnlyEvidence = await sourceChildEvidence(
          fixture.sessionRoot,
          committedChildName,
        );
        expect(
          startOnlyEvidence.events.map((event) => event.eventType),
        ).toEqual(["source.review-started.v2"]);
        expect(
          createGrandHallT554NativeReviewCoverageCarryStateV2(
            startOnlyEvidence,
          ),
        ).toMatchObject({
          kind: "source",
          predecessorJournal: startOnlyEvidence.checkpoint,
          completedTileBitsetHex: "00".repeat(64),
          completedTileCount: 0,
        });
      }

      const scope = await expectedSessionScope(fixture.sessionRoot);
      const priorOwnerWitness =
        await inspectGrandHallT554NativeReviewPriorOwnerV2({
          sessionRoot: fixture.sessionRoot,
          expectedSessionScope: scope,
        });
      if (priorOwnerWitness === null) {
        throw new Error("crash fixture unexpectedly had no live prior owner");
      }
      const recovered =
        await __testOnlyGrandHallT554NativeReviewSourceSessionV2.takeOver(
          { sessionRoot: fixture.sessionRoot, priorOwnerWitness },
          fixture.withoutCrashSeam(),
        );
      const recoveredSnapshot = await recovered.snapshot();
      expect(recoveredSnapshot.browserEpochNonceSha256).not.toBe(
        crashedInitial.browserEpochNonceSha256,
      );
      if (selectionWasCommitted) {
        expect(recoveredSnapshot.activeSource).toMatchObject({
          phase: "source_review",
          sourceCoverage: { completedTileCount: 0, complete: false },
        });
      } else {
        expect(recoveredSnapshot.activeSource).toBeNull();
      }

      const afterTakeover = await coordinatorEvents(fixture.sessionRoot);
      const crashBrowserEpoch = [...afterTakeover]
        .reverse()
        .find(
          (event) => event.eventType === "session.browser-epoch-started.v2",
        );
      expect(crashBrowserEpoch?.eventType).toBe(
        "session.browser-epoch-started.v2",
      );
      if (crashBrowserEpoch?.eventType !== "session.browser-epoch-started.v2") {
        throw new Error("crash takeover did not rotate the browser epoch");
      }
      expect(crashBrowserEpoch.payload.reason).toBe("crash_resume");
      const afterTakeoverTypes = afterTakeover.map((event) => event.eventType);
      if (selectionWasCommitted) {
        expect(afterTakeoverTypes.slice(-3)).toEqual([
          "session.browser-epoch-started.v2",
          "coverage.segment-resume-intended.v2",
          "coverage.segment-resume-committed.v2",
        ]);
        expect(
          crashBrowserEpoch.payload.priorActiveSourceJournal,
        ).not.toBeNull();
      } else {
        expect(afterTakeoverTypes).toContain(
          "source.selection-recovery-aborted.v2",
        );
        expect(crashBrowserEpoch.payload.priorActiveSourceJournal).toBeNull();
      }
      await expect(
        crashed.selectSource({
          expectedWorkspaceRevision: recoveredSnapshot.workspaceRevision,
          inventoryIndex: 2,
        }),
      ).rejects.toMatchObject({ code: "STALE_LEASE" });
      await recovered.close();
    },
  );
});

describe("Grand Hall T-554 mask-workflow durable session v2", () => {
  it(
    "re-verifies editable and frozen source epochs and resumes exact partial mask coverage",
    { timeout: 600_000 },
    async () => {
      const fixture = await harness();
      const sourceSession = await freshSession(fixture);
      await selectFirstSource(sourceSession);
      const completedCoverage = await seedExactCompletedSourceCoverage(
        fixture.sessionRoot,
      );
      expect(completedCoverage).toMatchObject({
        kind: "source",
        completedTileCount: 512,
        completedTileBitsetHex: FULL_TILE_BITMAP,
      });
      await sourceSession.close();

      const maskSession =
        await __testOnlyGrandHallT554NativeReviewMaskWorkflowSessionV2.open(
          { sessionRoot: fixture.sessionRoot },
          maskWorkflowDependencies(fixture.withoutCrashSeam()),
        );
      const opened = await maskSession.snapshot();
      expect(opened).toMatchObject({
        lifecycle: "active",
        workspaceRevision: 1,
        maximumAllocatedRenderGeneration: 1,
        activeSource: {
          phase: "source_review",
          renderGeneration: 1,
          completedSourceCoverage: null,
          maskState: null,
        },
        authority: "none",
        finalDecision: "PENDING",
        generatedContentAuthorized: false,
      });

      const eventsBeforeBegin = await coordinatorEvents(fixture.sessionRoot);
      const selectionCommit = [...eventsBeforeBegin]
        .reverse()
        .find(
          (candidate) =>
            candidate.eventType === "source.selection-committed.v2",
        );
      if (selectionCommit?.eventType !== "source.selection-committed.v2") {
        throw new Error("mask-workflow fixture has no source selection commit");
      }
      const epochCountBeforeBegin = fixture.epochs.length;
      const begun = await maskSession.beginMaskWorkflow(maskGuard(opened));
      expect(begun).toMatchObject({
        workspaceRevision: 2,
        maximumAllocatedRenderGeneration: 2,
        activeSource: {
          phase: "mask_edit",
          renderGeneration: 2,
          completedSourceCoverage: {
            completedTileCount: 512,
            completedTileBitsetHex: FULL_TILE_BITMAP,
          },
          maskState: {
            revision: 0,
            includedPixelCount: 0,
            excludedPixelCount:
              GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX,
            reasonCounts: [
              {
                reasonCode: "unverified_or_unknown_pixels",
                pixelCount:
                  GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX,
              },
            ],
          },
        },
      });
      expect(fixture.epochs).toHaveLength(epochCountBeforeBegin + 1);
      expect(fixture.epochs.at(-1)).toMatchObject({
        abandoned: false,
        finalized: false,
      });
      const workflowEvents = await coordinatorEvents(fixture.sessionRoot);
      const workflowStart = [...workflowEvents]
        .reverse()
        .find(
          (candidate) => candidate.eventType === "mask.workflow-started.v2",
        );
      if (workflowStart?.eventType !== "mask.workflow-started.v2") {
        throw new Error("mask workflow start was not durable");
      }
      expect(workflowStart.payload.sourceCustodyBefore).toEqual(
        selectionCommit.payload.sourceCustody,
      );
      expect(workflowStart.payload.sourceCustody.source).toEqual(
        workflowStart.payload.sourceCustodyBefore.source,
      );
      expect(workflowStart.payload.sourceCustody.sourceVerification).toEqual(
        workflowStart.payload.sourceCustodyBefore.sourceVerification,
      );
      expect(
        workflowStart.payload.sourceCustody.sourceReviewSubjectSha256,
      ).toBe(
        workflowStart.payload.sourceCustodyBefore.sourceReviewSubjectSha256,
      );
      expect(
        workflowStart.payload.sourceCustody.sourceEpochNonceSha256,
      ).not.toBe(
        workflowStart.payload.sourceCustodyBefore.sourceEpochNonceSha256,
      );
      expect(
        workflowStart.payload.sourceCustody.sourceEpochBindingSha256,
      ).not.toBe(
        workflowStart.payload.sourceCustodyBefore.sourceEpochBindingSha256,
      );
      expect(
        workflowStart.payload.sourceCustodyBefore.sourceEpochRenderGeneration,
      ).toBe(workflowStart.payload.previousRenderGeneration);
      expect(
        workflowStart.payload.sourceCustody.sourceEpochRenderGeneration,
      ).toBe(workflowStart.payload.resultingRenderGeneration);

      const edited = await maskSession.applyMaskEdit({
        ...maskGuard(begun),
        edit: {
          expectedRevision: 0,
          operation: "include",
          primitive: {
            kind: "rectangle",
            horizontalSeam: "none",
            leftPx: 0,
            topPx: 0,
            rightExclusivePx: 8,
            bottomExclusivePx: 8,
          },
        },
      });
      expect(edited).toMatchObject({
        workspaceRevision: 3,
        maximumAllocatedRenderGeneration: 3,
        activeSource: {
          phase: "mask_edit",
          renderGeneration: 3,
          maskState: {
            revision: 1,
            includedPixelCount: 64,
            excludedPixelCount:
              GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX - 64,
          },
        },
      });

      await maskSession.close();
      expect(fixture.epochs.at(-1)).toMatchObject({
        abandoned: true,
        finalized: false,
      });
      const invalidSourceDependencies = fixture.withoutCrashSeam();
      const epochCountBeforeInvalidResume = fixture.epochs.length;
      await expect(
        __testOnlyGrandHallT554NativeReviewMaskWorkflowSessionV2.open(
          { sessionRoot: fixture.sessionRoot },
          maskWorkflowDependencies(invalidSourceDependencies, {
            openSourceEpoch: (input) => {
              const epoch = new FakeSourceEpoch(input.bindings, (snapshot) => {
                Object.assign(snapshot, {
                  epochBindingSha256: digest("forged-mask-resume-binding"),
                });
              });
              fixture.epochs.push(epoch);
              return Promise.resolve(epoch);
            },
          }),
        ),
      ).rejects.toMatchObject({ code: "RESOURCE_FAILURE" });
      expect(fixture.epochs).toHaveLength(epochCountBeforeInvalidResume + 1);
      expect(fixture.epochs.at(-1)).toMatchObject({
        abandoned: true,
        finalized: false,
      });
      expect(await coordinatorEventTypes(fixture.sessionRoot)).not.toContain(
        "mask.edit-epoch-resumed.v2",
      );

      const resumedSession =
        await __testOnlyGrandHallT554NativeReviewMaskWorkflowSessionV2.open(
          { sessionRoot: fixture.sessionRoot },
          maskWorkflowDependencies(fixture.withoutCrashSeam()),
        );
      const resumed = await resumedSession.snapshot();
      expect(resumed).toMatchObject({
        workspaceRevision: 4,
        maximumAllocatedRenderGeneration: 4,
        browserEpochNumber: edited.browserEpochNumber + 2,
        activeSource: {
          phase: "mask_edit",
          renderGeneration: 4,
          maskState: activeMaskSource(edited).maskState,
          frozenBinding: null,
          maskJournalLeafName: null,
        },
      });
      const resumedEpoch = fixture.epochs.at(-1);
      expect(resumedEpoch).toMatchObject({
        abandoned: false,
        finalized: false,
      });
      const resumeEvents = await coordinatorEvents(fixture.sessionRoot);
      const resumeEvent = resumeEvents.find(
        (candidate) => candidate.eventType === "mask.edit-epoch-resumed.v2",
      );
      if (resumeEvent?.eventType !== "mask.edit-epoch-resumed.v2") {
        throw new Error("mask-edit resume event was not durable");
      }
      expect(resumeEvent.payload).toMatchObject({
        previousWorkspaceRevision: 3,
        resultingWorkspaceRevision: 4,
        previousVisibleRenderGeneration: 3,
        previousMaximumAllocatedRenderGeneration: 3,
        resultingRenderGeneration: 4,
        browserEpochNonceSha256: resumed.browserEpochNonceSha256,
      });
      expect(resumeEvent.payload.sourceCustody.source).toEqual(
        resumeEvent.payload.sourceCustodyBefore.source,
      );
      expect(resumeEvent.payload.sourceCustody.sourceVerification).toEqual(
        resumeEvent.payload.sourceCustodyBefore.sourceVerification,
      );
      expect(resumeEvent.payload.sourceCustody.sourceReviewSubjectSha256).toBe(
        resumeEvent.payload.sourceCustodyBefore.sourceReviewSubjectSha256,
      );
      expect(resumeEvent.payload.sourceCustody.sourceEpochNonceSha256).not.toBe(
        resumeEvent.payload.sourceCustodyBefore.sourceEpochNonceSha256,
      );
      expect(
        resumeEvent.payload.sourceCustody.sourceEpochBindingSha256,
      ).not.toBe(
        resumeEvent.payload.sourceCustodyBefore.sourceEpochBindingSha256,
      );
      expect(resumeEvent.payload.sourceCustody.sourceEpochBindingSha256).toBe(
        resumedEpoch?.snapshot().epochBindingSha256,
      );

      const frozen = await resumedSession.freezeMask({
        ...maskGuard(resumed),
        expectedMaskRevision: 1,
      });
      expect(frozen).toMatchObject({
        workspaceRevision: 5,
        maximumAllocatedRenderGeneration: 5,
        activeSource: {
          phase: "mask_review",
          renderGeneration: 5,
          maskState: { revision: 1, includedPixelCount: 64 },
          frozenBinding: {
            revision: 1,
            includedPixelCount: 64,
            immutableFrozen: true,
          },
        },
      });
      expect(activeMaskSource(frozen).maskJournalLeafName).toMatch(
        /^mask-freeze-00000005-/u,
      );
      expect(
        (await readdir(join(fixture.sessionRoot, "mask-evidence"))).sort(),
      ).toHaveLength(2);
      expect(await coordinatorEventTypes(fixture.sessionRoot)).toEqual(
        expect.arrayContaining([
          "mask.workflow-started.v2",
          "mask.edited.v2",
          "mask.edit-epoch-resumed.v2",
          "mask.freeze-intended.v2",
          "mask.freeze-committed.v2",
        ]),
      );
      const predecessorTile = await resumedSession.prepareMaskTile({
        ...maskRenderBinding(frozen),
        column: 0,
        row: 0,
      });
      const expectedMask8 = Buffer.from(predecessorTile.mask8);
      const expectedReason8 = Buffer.from(predecessorTile.reason8);
      await predecessorTile.commitDeliveryAfterSuccessfulSend();
      await resumedSession.recordMaskCoverage(maskCoverageInput(frozen));
      fixture.advance(500);
      await resumedSession.recordMaskCoverage(maskCoverageInput(frozen));
      const predecessorEvidence = await maskChildEvidence(fixture.sessionRoot);
      const predecessorCarry =
        createGrandHallT554NativeReviewCoverageCarryStateV2(
          predecessorEvidence,
        );
      if (predecessorCarry.kind !== "mask") {
        throw new Error("mask-review fixture emitted a non-mask carry");
      }
      await resumedSession.close();
      expect(resumedEpoch).toMatchObject({
        abandoned: true,
        finalized: false,
      });

      const eventsBeforeReviewResume = await coordinatorEventTypes(
        fixture.sessionRoot,
      );
      const reviewSession =
        await __testOnlyGrandHallT554NativeReviewMaskWorkflowSessionV2.open(
          { sessionRoot: fixture.sessionRoot },
          maskWorkflowDependencies(fixture.withoutCrashSeam()),
        );
      const reviewResumed = await reviewSession.snapshot();
      expect(reviewResumed).toMatchObject({
        workspaceRevision: 6,
        maximumAllocatedRenderGeneration: 6,
        browserEpochNumber: frozen.browserEpochNumber + 1,
        activeSource: {
          phase: "mask_review",
          renderGeneration: 6,
          maskState: activeMaskSource(frozen).maskState,
          maskReviewSubjectSha256:
            activeMaskSource(frozen).maskReviewSubjectSha256,
          frozenBindingSha256: activeMaskSource(frozen).frozenBindingSha256,
          frozenBinding: activeMaskSource(frozen).frozenBinding,
        },
      });
      expect(activeMaskSource(reviewResumed).maskJournalLeafName).not.toBe(
        activeMaskSource(frozen).maskJournalLeafName,
      );
      expect(activeMaskSource(reviewResumed).maskJournalLeafName).toMatch(
        /^mask-resume-00000006-/u,
      );
      const coordinatorTypesAfterResume = await coordinatorEventTypes(
        fixture.sessionRoot,
      );
      expect(
        coordinatorTypesAfterResume.slice(eventsBeforeReviewResume.length),
      ).toEqual([
        "session.browser-epoch-started.v2",
        "coverage.segment-resume-intended.v2",
        "coverage.segment-resume-committed.v2",
      ]);
      expect(await maskChildLeafNames(fixture.sessionRoot)).toHaveLength(2);
      const resumedEvidence = await latestMaskChildEvidence(
        fixture.sessionRoot,
      );
      expect(resumedEvidence.events[0]).toMatchObject({
        eventType: "mask.review-started.v2",
        payload: { predecessorCoverage: predecessorCarry },
      });
      const rehydratedTile = await reviewSession.prepareMaskTile({
        ...maskRenderBinding(reviewResumed),
        column: 0,
        row: 0,
      });
      expect(rehydratedTile.mask8).toEqual(expectedMask8);
      expect(rehydratedTile.reason8).toEqual(expectedReason8);
      await rehydratedTile.discardAfterFailedSend();
      const firstResumedObservation = await reviewSession.recordMaskCoverage(
        maskCoverageInput(reviewResumed),
      );
      expect(firstResumedObservation).toMatchObject({
        sequence: 0,
        deliveredTileCount: 0,
        completedTileCount: predecessorCarry.completedTileCount,
      });
      const firstObservationCarry =
        createGrandHallT554NativeReviewCoverageCarryStateV2(
          await latestMaskChildEvidence(fixture.sessionRoot),
        );
      expect(firstObservationCarry).toMatchObject({
        kind: "mask",
        cappedDwellMsUint16LeBase64url:
          predecessorCarry.cappedDwellMsUint16LeBase64url,
        cappedDwellBytesSha256: predecessorCarry.cappedDwellBytesSha256,
        completedTileBitsetHex: predecessorCarry.completedTileBitsetHex,
        completedTileCount: predecessorCarry.completedTileCount,
        cumulativeDwellStateSha256: predecessorCarry.cumulativeDwellStateSha256,
      });
      await reviewSession.close();
    },
  );

  it(
    "retains one exact source epoch while serving coupled editable source, mask, and reason tiles",
    { timeout: 600_000 },
    async () => {
      const fixture = await harness();
      const sourceSession = await freshSession(fixture);
      await selectFirstSource(sourceSession);
      await seedExactCompletedSourceCoverage(fixture.sessionRoot);
      await sourceSession.close();

      const session =
        await __testOnlyGrandHallT554NativeReviewMaskWorkflowSessionV2.open(
          { sessionRoot: fixture.sessionRoot },
          maskWorkflowDependencies(fixture.withoutCrashSeam()),
        );
      const begun = await session.beginMaskWorkflow(
        maskGuard(await session.snapshot()),
      );
      const retainedEpoch = fixture.epochs.at(-1);
      if (retainedEpoch === undefined) {
        throw new Error("mask workflow did not retain a source epoch");
      }
      expect(retainedEpoch.snapshot().renderGeneration).toBe(
        activeMaskSource(begun).renderGeneration,
      );

      const initialTile = await session.prepareMaskTile({
        ...maskRenderBinding(begun),
        column: 0,
        row: 0,
      });
      expect(initialTile).toMatchObject({
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-mask-workflow-tile.v2",
        renderMode: "source_rgb8_mask8_reason8",
        widthPx: 256,
        heightPx: 256,
      });
      expect(initialTile.sourceRgb8).toHaveLength(SOURCE_TILE_BYTE_LENGTH);
      expect(initialTile.sourceRgb8.every((value) => value === 1)).toBe(true);
      expect(initialTile.mask8).toHaveLength(256 * 256);
      expect(initialTile.mask8.every((value) => value === 255)).toBe(true);
      expect(initialTile.reason8).toHaveLength(256 * 256);
      expect(initialTile.reason8.every((value) => value === 5)).toBe(true);
      await initialTile.commitDeliveryAfterSuccessfulSend();
      expect(initialTile.sourceRgb8.every((value) => value === 0)).toBe(true);
      expect(initialTile.mask8.every((value) => value === 0)).toBe(true);
      expect(initialTile.reason8.every((value) => value === 0)).toBe(true);
      expect(await maskChildLeafNames(fixture.sessionRoot)).toEqual([]);

      const edited = await session.applyMaskEdit({
        ...maskGuard(begun),
        edit: {
          expectedRevision: 0,
          operation: "include",
          primitive: {
            kind: "rectangle",
            horizontalSeam: "none",
            leftPx: 0,
            topPx: 0,
            rightExclusivePx: 8,
            bottomExclusivePx: 8,
          },
        },
      });
      expect(activeMaskSource(edited).renderGeneration).toBeGreaterThan(
        retainedEpoch.snapshot().renderGeneration,
      );
      expect(retainedEpoch).toMatchObject({
        abandoned: false,
        finalized: false,
      });
      await expect(
        session.prepareMaskTile({
          ...maskRenderBinding(begun),
          column: 0,
          row: 0,
        }),
      ).rejects.toMatchObject({ code: "BINDING_STALE" });

      const editedTile = await session.prepareMaskTile({
        ...maskRenderBinding(edited),
        column: 0,
        row: 0,
      });
      expect(editedTile.sourceRgb8.every((value) => value === 1)).toBe(true);
      for (let y = 0; y < 256; y += 1) {
        for (let x = 0; x < 256; x += 1) {
          const offset = y * 256 + x;
          const included = x < 8 && y < 8;
          expect(editedTile.mask8[offset]).toBe(included ? 0 : 255);
          expect(editedTile.reason8[offset]).toBe(included ? 0 : 5);
        }
      }
      await expect(
        session.freezeMask({
          ...maskGuard(edited),
          expectedMaskRevision: 1,
        }),
      ).rejects.toMatchObject({ code: "PENDING_TILE_DELIVERY" });
      await editedTile.discardAfterFailedSend();
      expect(editedTile.sourceRgb8.every((value) => value === 0)).toBe(true);
      expect(editedTile.mask8.every((value) => value === 0)).toBe(true);
      expect(editedTile.reason8.every((value) => value === 0)).toBe(true);
      await session.close();
      expect(retainedEpoch).toMatchObject({
        abandoned: true,
        finalized: false,
      });
    },
  );

  it(
    "rejects mutation of every coupled render plane and destroys all three together",
    { timeout: 600_000 },
    async () => {
      const fixture = await harness();
      const { session, edited } = await createEditedMaskWorkflow(
        fixture,
        maskWorkflowDependencies(fixture.withoutCrashSeam()),
      );
      for (const [column, plane] of [
        [0, "sourceRgb8"],
        [1, "mask8"],
        [2, "reason8"],
      ] as const) {
        const tile = await session.prepareMaskTile({
          ...maskRenderBinding(edited),
          column,
          row: 0,
        });
        tile[plane][0] = (tile[plane][0] ?? 0) ^ 0xff;
        await expect(
          tile.commitDeliveryAfterSuccessfulSend(),
        ).rejects.toMatchObject({ code: "RENDER_TILE_MUTATED" });
        expect(tile.sourceRgb8.every((value) => value === 0)).toBe(true);
        expect(tile.mask8.every((value) => value === 0)).toBe(true);
        expect(tile.reason8.every((value) => value === 0)).toBe(true);
        await expect(tile.discardAfterFailedSend()).rejects.toMatchObject({
          code: "DELIVERY_ALREADY_RESOLVED",
        });
      }
      expect(await maskChildLeafNames(fixture.sessionRoot)).toEqual([]);

      const pending = await session.prepareMaskTile({
        ...maskRenderBinding(edited),
        column: 3,
        row: 0,
      });
      await session.close();
      expect(pending.sourceRgb8.every((value) => value === 0)).toBe(true);
      expect(pending.mask8.every((value) => value === 0)).toBe(true);
      expect(pending.reason8.every((value) => value === 0)).toBe(true);
      await expect(
        pending.commitDeliveryAfterSuccessfulSend(),
      ).rejects.toMatchObject({ code: "DELIVERY_ALREADY_RESOLVED" });
      expect(fixture.epochs.at(-1)).toMatchObject({ abandoned: true });
    },
  );

  it(
    "durably credits only successfully delivered frozen-mask tiles and makes duplicate success idempotent",
    { timeout: 600_000 },
    async () => {
      const fixture = await harness();
      const { session, edited } = await createEditedMaskWorkflow(
        fixture,
        maskWorkflowDependencies(fixture.withoutCrashSeam()),
      );
      const frozen = await session.freezeMask({
        ...maskGuard(edited),
        expectedMaskRevision: 1,
      });
      const failedSend = await session.prepareMaskTile({
        ...maskRenderBinding(frozen),
        column: 1,
        row: 0,
      });
      await failedSend.discardAfterFailedSend();

      const first = await session.prepareMaskTile({
        ...maskRenderBinding(frozen),
        column: 0,
        row: 0,
      });
      const duplicate = await session.prepareMaskTile({
        ...maskRenderBinding(frozen),
        column: 0,
        row: 0,
      });
      await first.commitDeliveryAfterSuccessfulSend();
      await duplicate.commitDeliveryAfterSuccessfulSend();
      for (const tile of [failedSend, first, duplicate]) {
        expect(tile.sourceRgb8.every((value) => value === 0)).toBe(true);
        expect(tile.mask8.every((value) => value === 0)).toBe(true);
        expect(tile.reason8.every((value) => value === 0)).toBe(true);
      }

      const firstCoverage = await session.recordMaskCoverage(
        maskCoverageInput(frozen),
      );
      expect(firstCoverage).toMatchObject({
        sequence: 0,
        deliveredTileCount: 1,
        completedTileCount: 0,
        complete: false,
      });
      fixture.advance(500);
      const secondCoverage = await session.recordMaskCoverage(
        maskCoverageInput(frozen),
      );
      expect(secondCoverage).toMatchObject({
        sequence: 1,
        deliveredTileCount: 1,
        completedTileCount: 0,
      });
      fixture.advance(250);
      const completed = await session.recordMaskCoverage(
        maskCoverageInput(frozen),
      );
      expect(completed).toMatchObject({
        sequence: 2,
        deliveredTileCount: 1,
        completedTileCount: 1,
        complete: false,
      });
      await expect(
        session.recordMaskCoverage(maskCoverageInput(edited)),
      ).rejects.toMatchObject({ code: "BINDING_STALE" });

      await session.close();
      const evidence = await maskChildEvidence(fixture.sessionRoot);
      expect(
        evidence.events.filter(
          (candidate) => candidate.eventType === "mask.tile-delivered.v2",
        ),
      ).toHaveLength(1);
      expect(
        evidence.events.filter(
          (candidate) => candidate.eventType === "mask.coverage-observed.v2",
        ),
      ).toHaveLength(3);
    },
  );

  it(
    "invalidates a frozen review on edit while retaining the epoch and refreezes the rebuilt mask store",
    { timeout: 600_000 },
    async () => {
      const fixture = await harness();
      const { session, edited } = await createEditedMaskWorkflow(
        fixture,
        maskWorkflowDependencies(fixture.withoutCrashSeam()),
      );
      const retainedEpoch = fixture.epochs.at(-1);
      const firstFrozen = await session.freezeMask({
        ...maskGuard(edited),
        expectedMaskRevision: 1,
      });
      const unresolvedReviewTile = await session.prepareMaskTile({
        ...maskRenderBinding(firstFrozen),
        column: 0,
        row: 0,
      });
      await expect(
        session.applyMaskEdit({
          ...maskGuard(firstFrozen),
          edit: {
            expectedRevision: 1,
            operation: "include",
            primitive: {
              kind: "rectangle",
              horizontalSeam: "none",
              leftPx: 8,
              topPx: 0,
              rightExclusivePx: 16,
              bottomExclusivePx: 8,
            },
          },
        }),
      ).rejects.toMatchObject({ code: "PENDING_TILE_DELIVERY" });
      await unresolvedReviewTile.discardAfterFailedSend();
      const invalidated = await session.applyMaskEdit({
        ...maskGuard(firstFrozen),
        edit: {
          expectedRevision: 1,
          operation: "include",
          primitive: {
            kind: "rectangle",
            horizontalSeam: "none",
            leftPx: 8,
            topPx: 0,
            rightExclusivePx: 16,
            bottomExclusivePx: 8,
          },
        },
      });
      expect(invalidated).toMatchObject({
        activeSource: {
          phase: "mask_edit",
          maskState: { revision: 2, includedPixelCount: 128 },
          maskReviewSubjectSha256: null,
          frozenBinding: null,
          maskJournalLeafName: null,
        },
      });
      expect(retainedEpoch).toMatchObject({
        abandoned: false,
        finalized: false,
      });
      const editTile = await session.prepareMaskTile({
        ...maskRenderBinding(invalidated),
        column: 0,
        row: 0,
      });
      await editTile.commitDeliveryAfterSuccessfulSend();
      const secondFrozen = await session.freezeMask({
        ...maskGuard(invalidated),
        expectedMaskRevision: 2,
      });
      expect(secondFrozen).toMatchObject({
        activeSource: {
          phase: "mask_review",
          maskState: { revision: 2, includedPixelCount: 128 },
          frozenBinding: { revision: 2, includedPixelCount: 128 },
        },
      });
      expect(activeMaskSource(secondFrozen).maskJournalLeafName).not.toBe(
        activeMaskSource(firstFrozen).maskJournalLeafName,
      );
      expect(await maskChildLeafNames(fixture.sessionRoot)).toHaveLength(2);
      const reviewTile = await session.prepareMaskTile({
        ...maskRenderBinding(secondFrozen),
        column: 0,
        row: 0,
      });
      await reviewTile.commitDeliveryAfterSuccessfulSend();
      await session.close();
      expect(retainedEpoch).toMatchObject({
        abandoned: true,
        finalized: false,
      });
    },
  );

  it(
    "latches exact-recovery-required when first mask delivery durability is ambiguous",
    { timeout: 600_000 },
    async () => {
      const fixture = await harness();
      const { session, edited } = await createEditedMaskWorkflow(
        fixture,
        maskWorkflowDependencies(fixture.withoutCrashSeam(), {
          seam: {
            afterMaskTileDeliveryAppendDurable: () => {
              throw new Error(
                "injected ambiguity after durable mask delivery append",
              );
            },
          },
        }),
      );
      const frozen = await session.freezeMask({
        ...maskGuard(edited),
        expectedMaskRevision: 1,
      });
      const tile = await session.prepareMaskTile({
        ...maskRenderBinding(frozen),
        column: 0,
        row: 0,
      });
      await expect(
        tile.commitDeliveryAfterSuccessfulSend(),
      ).rejects.toMatchObject({ code: "CRASH_RECOVERY_REQUIRED" });
      expect(tile.sourceRgb8.every((value) => value === 0)).toBe(true);
      expect(tile.mask8.every((value) => value === 0)).toBe(true);
      expect(tile.reason8.every((value) => value === 0)).toBe(true);
      await expect(session.snapshot()).rejects.toMatchObject({
        code: "CRASH_RECOVERY_REQUIRED",
      });
      await expect(
        session.prepareMaskTile({
          ...maskRenderBinding(frozen),
          column: 1,
          row: 0,
        }),
      ).rejects.toMatchObject({ code: "CRASH_RECOVERY_REQUIRED" });
      await expect(
        session.recordMaskCoverage(maskCoverageInput(frozen)),
      ).rejects.toMatchObject({ code: "CRASH_RECOVERY_REQUIRED" });
      await expect(
        session.applyMaskEdit({
          ...maskGuard(frozen),
          edit: {
            expectedRevision: 1,
            operation: "include",
            primitive: {
              kind: "rectangle",
              horizontalSeam: "none",
              leftPx: 8,
              topPx: 0,
              rightExclusivePx: 16,
              bottomExclusivePx: 8,
            },
          },
        }),
      ).rejects.toMatchObject({ code: "CRASH_RECOVERY_REQUIRED" });
      await expect(session.close()).resolves.toBeUndefined();
      expect(
        (await maskChildEvidence(fixture.sessionRoot)).events.filter(
          (candidate) => candidate.eventType === "mask.tile-delivered.v2",
        ),
      ).toHaveLength(1);
    },
  );

  it(
    "latches exact-recovery-required when mask coverage durability is ambiguous",
    { timeout: 600_000 },
    async () => {
      const fixture = await harness();
      const { session, edited } = await createEditedMaskWorkflow(
        fixture,
        maskWorkflowDependencies(fixture.withoutCrashSeam(), {
          seam: {
            afterMaskCoverageAppendDurable: () => {
              throw new Error(
                "injected ambiguity after durable mask coverage append",
              );
            },
          },
        }),
      );
      const frozen = await session.freezeMask({
        ...maskGuard(edited),
        expectedMaskRevision: 1,
      });
      const tile = await session.prepareMaskTile({
        ...maskRenderBinding(frozen),
        column: 0,
        row: 0,
      });
      await tile.commitDeliveryAfterSuccessfulSend();
      await expect(
        session.recordMaskCoverage(maskCoverageInput(frozen)),
      ).rejects.toMatchObject({ code: "CRASH_RECOVERY_REQUIRED" });
      await expect(session.snapshot()).rejects.toMatchObject({
        code: "CRASH_RECOVERY_REQUIRED",
      });
      await expect(
        session.prepareMaskTile({
          ...maskRenderBinding(frozen),
          column: 1,
          row: 0,
        }),
      ).rejects.toMatchObject({ code: "CRASH_RECOVERY_REQUIRED" });
      await expect(
        session.applyMaskEdit({
          ...maskGuard(frozen),
          edit: {
            expectedRevision: 1,
            operation: "include",
            primitive: {
              kind: "rectangle",
              horizontalSeam: "none",
              leftPx: 8,
              topPx: 0,
              rightExclusivePx: 16,
              bottomExclusivePx: 8,
            },
          },
        }),
      ).rejects.toMatchObject({ code: "CRASH_RECOVERY_REQUIRED" });
      await expect(session.close()).resolves.toBeUndefined();
      const evidence = await maskChildEvidence(fixture.sessionRoot);
      expect(
        evidence.events.filter(
          (candidate) => candidate.eventType === "mask.tile-delivered.v2",
        ),
      ).toHaveLength(1);
      expect(
        evidence.events.filter(
          (candidate) => candidate.eventType === "mask.coverage-observed.v2",
        ),
      ).toHaveLength(1);
    },
  );

  it(
    "abandons the retained epoch when initial mask-store configuration fails",
    { timeout: 600_000 },
    async () => {
      const fixture = await harness();
      const sourceSession = await freshSession(fixture);
      await selectFirstSource(sourceSession);
      await seedExactCompletedSourceCoverage(fixture.sessionRoot);
      await sourceSession.close();
      const session =
        await __testOnlyGrandHallT554NativeReviewMaskWorkflowSessionV2.open(
          { sessionRoot: fixture.sessionRoot },
          maskWorkflowDependencies(fixture.withoutCrashSeam(), {
            configureMaskStore: () => {
              throw new Error(
                "injected initial mask-store configuration failure",
              );
            },
          }),
        );
      const opened = await session.snapshot();
      const eventTypesBefore = await coordinatorEventTypes(fixture.sessionRoot);
      const epochCountBefore = fixture.epochs.length;
      await expect(
        session.beginMaskWorkflow(maskGuard(opened)),
      ).rejects.toMatchObject({ code: "RESOURCE_FAILURE" });
      expect(fixture.epochs).toHaveLength(epochCountBefore + 1);
      expect(fixture.epochs.at(-1)).toMatchObject({
        abandoned: true,
        finalized: false,
      });
      expect(await coordinatorEventTypes(fixture.sessionRoot)).toEqual(
        eventTypesBefore,
      );
      await session.close();
    },
  );

  it(
    "abandons a rehydrated store on configuration failure and safely retries from durable state",
    { timeout: 600_000 },
    async () => {
      const fixture = await harness();
      const sourceSession = await freshSession(fixture);
      await selectFirstSource(sourceSession);
      await seedExactCompletedSourceCoverage(fixture.sessionRoot);
      await sourceSession.close();
      const configuredStores: GrandHallT554NativeMaskRevisionStore[] = [];
      const session =
        await __testOnlyGrandHallT554NativeReviewMaskWorkflowSessionV2.open(
          { sessionRoot: fixture.sessionRoot },
          maskWorkflowDependencies(fixture.withoutCrashSeam(), {
            configureMaskStore: (store) => {
              configuredStores.push(store);
              if (configuredStores.length === 2) {
                throw new Error(
                  "injected rehydrated mask-store configuration failure",
                );
              }
            },
          }),
        );
      const begun = await session.beginMaskWorkflow(
        maskGuard(await session.snapshot()),
      );
      const edit = {
        ...maskGuard(begun),
        edit: {
          expectedRevision: 0,
          operation: "include" as const,
          primitive: {
            kind: "rectangle" as const,
            horizontalSeam: "none" as const,
            leftPx: 0,
            topPx: 0,
            rightExclusivePx: 8,
            bottomExclusivePx: 8,
          },
        },
      };
      await expect(session.applyMaskEdit(edit)).rejects.toMatchObject({
        code: "RESOURCE_FAILURE",
      });
      const failedStore = configuredStores[1];
      if (failedStore === undefined) {
        throw new Error("rehydrated configure failure captured no store");
      }
      expect(() => failedStore.snapshot()).toThrowError(
        expect.objectContaining({ code: "STORE_ABANDONED" }),
      );
      expect(await session.snapshot()).toMatchObject({
        activeSource: { phase: "mask_edit", maskState: { revision: 0 } },
      });
      await expect(session.applyMaskEdit(edit)).resolves.toMatchObject({
        activeSource: { phase: "mask_edit", maskState: { revision: 1 } },
      });
      await session.close();
    },
  );

  it(
    "zeroes pending triple-plane bytes and abandons local mask resources after owner takeover",
    { timeout: 600_000 },
    async () => {
      const fixture = await harness();
      const configuredStores: GrandHallT554NativeMaskRevisionStore[] = [];
      const { session: stale, edited } = await createEditedMaskWorkflow(
        fixture,
        maskWorkflowDependencies(fixture.withoutCrashSeam(), {
          configureMaskStore: (store) => {
            configuredStores.push(store);
          },
        }),
      );
      const staleStore = configuredStores.at(-1);
      const staleEpoch = fixture.epochs.at(-1);
      if (staleStore === undefined || staleEpoch === undefined) {
        throw new Error("stale mask fixture did not retain local resources");
      }
      const pending = await stale.prepareMaskTile({
        ...maskRenderBinding(edited),
        column: 0,
        row: 0,
      });
      expect(pending.sourceRgb8.some((value) => value !== 0)).toBe(true);
      expect(pending.mask8.some((value) => value !== 0)).toBe(true);
      expect(pending.reason8.some((value) => value !== 0)).toBe(true);

      const scope = await expectedSessionScope(fixture.sessionRoot);
      const priorOwnerWitness =
        await inspectGrandHallT554NativeReviewPriorOwnerV2({
          sessionRoot: fixture.sessionRoot,
          expectedSessionScope: scope,
        });
      if (priorOwnerWitness === null) {
        throw new Error("stale mask fixture unexpectedly had no prior owner");
      }
      const recovered =
        await __testOnlyGrandHallT554NativeReviewMaskWorkflowSessionV2.takeOver(
          { sessionRoot: fixture.sessionRoot, priorOwnerWitness },
          maskWorkflowDependencies(fixture.withoutCrashSeam()),
        );

      await expect(stale.close()).rejects.toMatchObject({
        code: "RESOURCE_CLEANUP_FAILED",
      });
      expect(pending.sourceRgb8.every((value) => value === 0)).toBe(true);
      expect(pending.mask8.every((value) => value === 0)).toBe(true);
      expect(pending.reason8.every((value) => value === 0)).toBe(true);
      expect(staleEpoch).toMatchObject({ abandoned: true, finalized: false });
      expect(() => staleStore.snapshot()).toThrowError(
        expect.objectContaining({ code: "STORE_ABANDONED" }),
      );
      await expect(
        pending.commitDeliveryAfterSuccessfulSend(),
      ).rejects.toMatchObject({ code: "DELIVERY_ALREADY_RESOLVED" });
      await recovered.close();
    },
  );

  it(
    "abandons a drifted fresh source epoch without durably starting mask edit",
    { timeout: 600_000 },
    async () => {
      const fixture = await harness();
      const sourceSession = await freshSession(fixture);
      await selectFirstSource(sourceSession);
      await seedExactCompletedSourceCoverage(fixture.sessionRoot);
      await sourceSession.close();

      const maskSession =
        await __testOnlyGrandHallT554NativeReviewMaskWorkflowSessionV2.open(
          { sessionRoot: fixture.sessionRoot },
          maskWorkflowDependencies(fixture.withoutCrashSeam(), {
            openSourceEpoch: (input) => {
              const epoch = new FakeSourceEpoch(input.bindings, (snapshot) => {
                const driftedVerification = {
                  ...snapshot.sourceVerification,
                  decodedPixelSha256: digest(
                    "drifted-mask-workflow-decoded-source",
                  ),
                };
                Object.assign(snapshot, {
                  sourceVerification: driftedVerification,
                  epochBindingSha256: epochBindingSha256(
                    input.bindings,
                    driftedVerification,
                  ),
                });
              });
              fixture.epochs.push(epoch);
              return Promise.resolve(epoch);
            },
          }),
        );
      const opened = await maskSession.snapshot();
      const eventsBeforeBegin = await coordinatorEvents(fixture.sessionRoot);
      const epochCountBeforeBegin = fixture.epochs.length;

      await expect(
        maskSession.beginMaskWorkflow(maskGuard(opened)),
      ).rejects.toMatchObject({ code: "RESOURCE_FAILURE" });

      expect(await coordinatorEvents(fixture.sessionRoot)).toEqual(
        eventsBeforeBegin,
      );
      expect(fixture.epochs).toHaveLength(epochCountBeforeBegin + 1);
      expect(fixture.epochs.at(-1)).toMatchObject({
        abandoned: true,
        finalized: false,
      });
      expect(await maskSession.snapshot()).toMatchObject({
        workspaceRevision: opened.workspaceRevision,
        maximumAllocatedRenderGeneration:
          opened.maximumAllocatedRenderGeneration,
        activeSource: {
          phase: "source_review",
          renderGeneration: activeMaskSource(opened).renderGeneration,
          maskState: null,
        },
      });
      await maskSession.close();
    },
  );

  it(
    "latches exact recovery across durable mask-workflow-start and mask-edit seams",
    { timeout: 600_000 },
    async () => {
      const fixture = await harness();
      const sourceSession = await freshSession(fixture);
      await selectFirstSource(sourceSession);
      await seedExactCompletedSourceCoverage(fixture.sessionRoot);
      await sourceSession.close();
      let crashWorkflowStart = true;
      const dependencies = maskWorkflowDependencies(
        fixture.withoutCrashSeam(),
        {
          seam: {
            afterMaskWorkflowStartedDurable: () => {
              if (crashWorkflowStart) {
                throw new Error(
                  "injected crash after durable mask workflow start",
                );
              }
            },
            afterMaskEditDurable: () => {
              throw new Error("injected crash after durable mask edit");
            },
          },
        },
      );
      const starting =
        await __testOnlyGrandHallT554NativeReviewMaskWorkflowSessionV2.open(
          { sessionRoot: fixture.sessionRoot },
          dependencies,
        );
      const sourceReview = await starting.snapshot();
      await expect(
        starting.beginMaskWorkflow(maskGuard(sourceReview)),
      ).rejects.toMatchObject({ code: "CRASH_RECOVERY_REQUIRED" });
      await expect(starting.snapshot()).rejects.toMatchObject({
        code: "CRASH_RECOVERY_REQUIRED",
      });
      await starting.close();

      crashWorkflowStart = false;
      const editing =
        await __testOnlyGrandHallT554NativeReviewMaskWorkflowSessionV2.open(
          { sessionRoot: fixture.sessionRoot },
          dependencies,
        );
      const editable = await editing.snapshot();
      expect(editable).toMatchObject({
        workspaceRevision: 3,
        maximumAllocatedRenderGeneration: 3,
        activeSource: {
          phase: "mask_edit",
          renderGeneration: 3,
          maskState: { revision: 0 },
        },
      });
      await expect(
        editing.applyMaskEdit({
          ...maskGuard(editable),
          edit: {
            expectedRevision: 0,
            operation: "include",
            primitive: {
              kind: "rectangle",
              horizontalSeam: "none",
              leftPx: 0,
              topPx: 0,
              rightExclusivePx: 8,
              bottomExclusivePx: 8,
            },
          },
        }),
      ).rejects.toMatchObject({ code: "CRASH_RECOVERY_REQUIRED" });
      await expect(editing.snapshot()).rejects.toMatchObject({
        code: "CRASH_RECOVERY_REQUIRED",
      });
      await editing.close();

      const recovered =
        await __testOnlyGrandHallT554NativeReviewMaskWorkflowSessionV2.open(
          { sessionRoot: fixture.sessionRoot },
          maskWorkflowDependencies(fixture.withoutCrashSeam()),
        );
      expect(await recovered.snapshot()).toMatchObject({
        workspaceRevision: 5,
        maximumAllocatedRenderGeneration: 5,
        activeSource: {
          phase: "mask_edit",
          renderGeneration: 5,
          maskState: { revision: 1, includedPixelCount: 64 },
        },
      });
      const eventTypes = await coordinatorEventTypes(fixture.sessionRoot);
      expect(
        eventTypes.filter(
          (eventType) => eventType === "mask.workflow-started.v2",
        ),
      ).toHaveLength(1);
      expect(
        eventTypes.filter((eventType) => eventType === "mask.edited.v2"),
      ).toHaveLength(1);
      expect(
        eventTypes.filter(
          (eventType) => eventType === "mask.edit-epoch-resumed.v2",
        ),
      ).toHaveLength(2);
      await recovered.close();
    },
  );

  it(
    "records only a server-proven INCLUDE, reopens it cleanly, attests authority-none, abandons both children, and stops",
    { timeout: 600_000 },
    async () => {
      const fixture = await harness();
      const { session, edited } = await createEditedMaskWorkflow(
        fixture,
        maskWorkflowDependencies(fixture.withoutCrashSeam()),
      );
      const frozen = await session.freezeMask({
        ...maskGuard(edited),
        expectedMaskRevision: 1,
      });

      await expect(
        session.recordIncludeDecision(includeDecisionInput(frozen)),
      ).rejects.toMatchObject({ code: "MASK_COVERAGE_INCOMPLETE" });

      const pending = await session.prepareMaskTile({
        ...maskRenderBinding(frozen),
        column: 0,
        row: 0,
      });
      await expect(
        session.recordIncludeDecision(includeDecisionInput(frozen)),
      ).rejects.toMatchObject({ code: "PENDING_TILE_DELIVERY" });
      await pending.discardAfterFailedSend();
      expect(pending.sourceRgb8.every((value) => value === 0)).toBe(true);
      expect(pending.mask8.every((value) => value === 0)).toBe(true);
      expect(pending.reason8.every((value) => value === 0)).toBe(true);

      await expect(
        withUntrustedMaskInputs(session).recordIncludeDecision({
          ...includeDecisionInput(frozen),
          acceptanceAuthorized: true,
        }),
      ).rejects.toMatchObject({ code: "ARGUMENT_INVALID" });

      const completedMask = await seedExactCompletedMaskCoverage(
        fixture.sessionRoot,
      );
      expect(completedMask).toMatchObject({
        kind: "mask",
        completedTileCount: 512,
        completedTileBitsetHex: FULL_TILE_BITMAP,
      });
      await expect(
        session.recordIncludeDecision({
          ...includeDecisionInput(frozen),
          expectedWorkspaceRevision: frozen.workspaceRevision + 1,
        }),
      ).rejects.toMatchObject({ code: "WORKSPACE_REVISION_CONFLICT" });

      const beforeDecisionGeneration = frozen.maximumAllocatedRenderGeneration;
      const included = await session.recordIncludeDecision(
        includeDecisionInput(frozen),
      );
      const includedActive = activeMaskSource(included);
      expect(included).toMatchObject({
        workspaceRevision: frozen.workspaceRevision + 1,
        maximumAllocatedRenderGeneration: beforeDecisionGeneration + 1,
        authority: "none",
        reviewState: "human_pending",
        finalDecision: "PENDING",
        acceptanceAuthorized: false,
        reconstructionAuthorized: false,
        runtimeAuthorized: false,
        exportAuthorized: false,
        generatedContentAuthorized: false,
        activeSource: {
          phase: "decision_recorded",
          renderGeneration: beforeDecisionGeneration + 1,
          decision: {
            result: "INCLUDE",
            classification: "grand_hall_core",
            note: "Exact frozen mask supports observed Grand Hall pixels.",
          },
          humanAttestation: null,
        },
      });
      expect(includedActive.decision).not.toBeNull();

      const decisionEvents = (
        await coordinatorEvents(fixture.sessionRoot)
      ).filter(
        (candidate) => candidate.eventType === "source.decision-recorded.v2",
      );
      expect(decisionEvents).toHaveLength(1);
      const decisionEvent = decisionEvents[0];
      if (
        decisionEvent?.eventType !== "source.decision-recorded.v2" ||
        decisionEvent.payload.result !== "INCLUDE"
      ) {
        throw new Error("INCLUDE fixture has no exact durable decision");
      }
      expect(decisionEvent.payload.completedSourceCoverage).toMatchObject({
        completedTileCount: 512,
        completedTileBitsetHex: FULL_TILE_BITMAP,
        sourceJournal: { kind: "source", revision: 516 },
      });
      expect(decisionEvent.payload.completedMaskCoverage).toMatchObject({
        completedTileCount: 512,
        completedTileBitsetHex: FULL_TILE_BITMAP,
        maskJournal: { kind: "mask", revision: 516 },
      });
      expect(decisionEvent.payload.maskState).toEqual(
        activeMaskSource(frozen).maskState,
      );
      expect(decisionEvent.payload.maskReviewSubjectSha256).toBe(
        activeMaskSource(frozen).maskReviewSubjectSha256,
      );
      expect(decisionEvent.payload.frozenBindingSha256).toBe(
        activeMaskSource(frozen).frozenBindingSha256,
      );
      expect(decisionEvent.payload.frozenBinding).toEqual(
        activeMaskSource(frozen).frozenBinding,
      );

      await expect(
        session.stop({ expectedWorkspaceRevision: included.workspaceRevision }),
      ).rejects.toMatchObject({ code: "PHASE_INVALID" });
      const epochCountBeforeTerminalReopen = fixture.epochs.length;
      await session.close();

      const clean =
        await __testOnlyGrandHallT554NativeReviewMaskWorkflowSessionV2.open(
          { sessionRoot: fixture.sessionRoot },
          maskWorkflowDependencies(fixture.withoutCrashSeam()),
        );
      const cleanDecision = await clean.snapshot();
      expect(cleanDecision).toMatchObject({
        activeSource: {
          phase: "decision_recorded",
          decision: {
            decisionSha256: decisionEvent.payload.decisionSha256,
            result: "INCLUDE",
          },
        },
      });
      expect(fixture.epochs).toHaveLength(epochCountBeforeTerminalReopen);

      const attested = await clean.recordHumanAttestation({
        ...maskGuard(cleanDecision),
        reviewerId: "authorized-reviewer-1",
        knowledgeBasis: [
          "Reviewed the exact native source and frozen mask at native scale.",
        ],
      });
      expect(attested).toMatchObject({
        authority: "none",
        reviewState: "human_pending",
        finalDecision: "PENDING",
        acceptanceAuthorized: false,
        reconstructionAuthorized: false,
        runtimeAuthorized: false,
        exportAuthorized: false,
        generatedContentAuthorized: false,
        activeSource: {
          phase: "human_attested",
          humanAttestation: {
            decisionSha256: decisionEvent.payload.decisionSha256,
            reviewerId: "authorized-reviewer-1",
            humanPresenceProof: "not_cryptographic",
            agentDecisionAuthority: "none",
            authority: "none",
          },
        },
      });

      const abandoned = await clean.abandonActiveSource({
        ...maskGuard(attested),
        reason: "operator_abandon",
      });
      expect(abandoned.activeSource).toBeNull();
      const abandonEvent = [...(await coordinatorEvents(fixture.sessionRoot))]
        .reverse()
        .find((candidate) => candidate.eventType === "source.abandoned.v2");
      if (abandonEvent?.eventType !== "source.abandoned.v2") {
        throw new Error("INCLUDE fixture has no exact abandon event");
      }
      expect(abandonEvent.payload.sourceJournal).toEqual(
        decisionEvent.payload.completedSourceCoverage.sourceJournal,
      );
      expect(abandonEvent.payload.maskJournal).toEqual(
        decisionEvent.payload.completedMaskCoverage.maskJournal,
      );

      const stopped = await clean.stop({
        expectedWorkspaceRevision: abandoned.workspaceRevision,
      });
      expect(stopped).toMatchObject({
        lifecycle: "stopped",
        activeSource: null,
        authority: "none",
        reviewState: "human_pending",
        finalDecision: "PENDING",
        acceptanceAuthorized: false,
        reconstructionAuthorized: false,
        runtimeAuthorized: false,
        exportAuthorized: false,
        generatedContentAuthorized: false,
      });
      await clean.close();

      const reopenedStopped =
        await __testOnlyGrandHallT554NativeReviewMaskWorkflowSessionV2.open(
          { sessionRoot: fixture.sessionRoot },
          maskWorkflowDependencies(fixture.withoutCrashSeam()),
        );
      expect(await reopenedStopped.snapshot()).toMatchObject({
        lifecycle: "stopped",
        activeSource: null,
        authority: "none",
        reviewState: "human_pending",
        finalDecision: "PENDING",
      });
      await reopenedStopped.close();
    },
  );

  it(
    "latches an ambiguous durable INCLUDE and crash-reopens exactly one terminal decision without a runtime",
    { timeout: 600_000 },
    async () => {
      const fixture = await harness();
      const dependencies = maskWorkflowDependencies(
        fixture.withoutCrashSeam(),
        {
          seam: {
            afterIncludeDecisionDurable: () => {
              throw new Error("injected crash after durable INCLUDE decision");
            },
          },
        },
      );
      const { session, edited } = await createEditedMaskWorkflow(
        fixture,
        dependencies,
      );
      const frozen = await session.freezeMask({
        ...maskGuard(edited),
        expectedMaskRevision: 1,
      });
      await seedExactCompletedMaskCoverage(fixture.sessionRoot);
      await expect(
        session.recordIncludeDecision(includeDecisionInput(frozen)),
      ).rejects.toMatchObject({ code: "CRASH_RECOVERY_REQUIRED" });
      await expect(session.snapshot()).rejects.toMatchObject({
        code: "CRASH_RECOVERY_REQUIRED",
      });
      expect(
        (await coordinatorEventTypes(fixture.sessionRoot)).filter(
          (eventType) => eventType === "source.decision-recorded.v2",
        ),
      ).toHaveLength(1);

      const epochCountBeforeTakeover = fixture.epochs.length;
      const recovered = await takeOverMaskWorkflowAfterCrash(fixture);
      const recoveredDecision = await recovered.snapshot();
      expect(recoveredDecision).toMatchObject({
        activeSource: {
          phase: "decision_recorded",
          decision: { result: "INCLUDE" },
          humanAttestation: null,
        },
        authority: "none",
        reviewState: "human_pending",
        finalDecision: "PENDING",
        acceptanceAuthorized: false,
        reconstructionAuthorized: false,
        runtimeAuthorized: false,
        exportAuthorized: false,
        generatedContentAuthorized: false,
      });
      expect(fixture.epochs).toHaveLength(epochCountBeforeTakeover);
      expect(
        (await coordinatorEventTypes(fixture.sessionRoot)).filter(
          (eventType) => eventType === "source.decision-recorded.v2",
        ),
      ).toHaveLength(1);
      await expect(session.close()).rejects.toMatchObject({
        code: "RESOURCE_CLEANUP_FAILED",
      });
      await recovered.close();
    },
  );

  it(
    "rejects an all-excluded mask with a typed phase error before it can become INCLUDE evidence",
    { timeout: 300_000 },
    async () => {
      const fixture = await harness();
      const { session, edited } = await createEditedMaskWorkflow(
        fixture,
        maskWorkflowDependencies(fixture.withoutCrashSeam()),
      );
      const empty = await session.applyMaskEdit({
        ...maskGuard(edited),
        edit: {
          expectedRevision: 1,
          operation: "exclude",
          reasonCode: "unverified_or_unknown_pixels",
          primitive: {
            kind: "rectangle",
            horizontalSeam: "none",
            leftPx: 0,
            topPx: 0,
            rightExclusivePx: 8,
            bottomExclusivePx: 8,
          },
        },
      });
      expect(activeMaskSource(empty).maskState).toMatchObject({
        revision: 2,
        includedPixelCount: 0,
      });
      await expect(
        session.freezeMask({
          ...maskGuard(empty),
          expectedMaskRevision: 2,
        }),
      ).rejects.toMatchObject({ code: "PHASE_INVALID" });
      await session.close();
    },
  );

  it(
    "crash-recovers attestation, clean-reopens human-attested state, abandons, and stops exactly once",
    { timeout: 900_000 },
    async () => {
      const fixture = await harness();
      const { session, edited } = await createEditedMaskWorkflow(
        fixture,
        maskWorkflowDependencies(fixture.withoutCrashSeam(), {
          seam: {
            afterHumanAttestationDurable: () => {
              throw new Error("injected crash after durable attestation");
            },
          },
        }),
      );
      const frozen = await session.freezeMask({
        ...maskGuard(edited),
        expectedMaskRevision: 1,
      });
      await seedExactCompletedMaskCoverage(fixture.sessionRoot);
      const included = await session.recordIncludeDecision(
        includeDecisionInput(frozen),
      );
      const liveEpoch = fixture.epochs.at(-1);
      if (liveEpoch === undefined) {
        throw new Error("terminal crash fixture has no live source epoch");
      }

      await expect(
        session.recordHumanAttestation({
          ...maskGuard(included),
          reviewerId: "authorized-reviewer-2",
          knowledgeBasis: ["Exact source and mask evidence reviewed."],
        }),
      ).rejects.toMatchObject({ code: "CRASH_RECOVERY_REQUIRED" });
      await expect(session.snapshot()).rejects.toMatchObject({
        code: "CRASH_RECOVERY_REQUIRED",
      });
      expect(
        (await coordinatorEventTypes(fixture.sessionRoot)).filter(
          (eventType) => eventType === "source.human-attestation-recorded.v2",
        ),
      ).toHaveLength(1);

      const recoveredAttested = await takeOverMaskWorkflowAfterCrash(fixture);
      expect(await recoveredAttested.snapshot()).toMatchObject({
        activeSource: {
          phase: "human_attested",
          humanAttestation: {
            reviewerId: "authorized-reviewer-2",
            humanPresenceProof: "not_cryptographic",
            agentDecisionAuthority: "none",
            authority: "none",
          },
        },
        authority: "none",
        reviewState: "human_pending",
        finalDecision: "PENDING",
      });
      await expect(session.close()).rejects.toMatchObject({
        code: "RESOURCE_CLEANUP_FAILED",
      });
      expect(liveEpoch.abandoned).toBe(true);
      await recoveredAttested.close();

      const epochCountBeforeCleanTerminalOpen = fixture.epochs.length;
      const cleanAttested =
        await __testOnlyGrandHallT554NativeReviewMaskWorkflowSessionV2.open(
          { sessionRoot: fixture.sessionRoot },
          maskWorkflowDependencies(fixture.withoutCrashSeam(), {
            seam: {
              afterSourceAbandonDurable: () => {
                throw new Error("injected crash after durable abandon");
              },
            },
          }),
        );
      const cleanAttestedSnapshot = await cleanAttested.snapshot();
      expect(cleanAttestedSnapshot).toMatchObject({
        activeSource: { phase: "human_attested" },
        authority: "none",
        reviewState: "human_pending",
        finalDecision: "PENDING",
      });
      expect(fixture.epochs).toHaveLength(epochCountBeforeCleanTerminalOpen);

      await expect(
        cleanAttested.abandonActiveSource({
          ...maskGuard(cleanAttestedSnapshot),
          reason: "operator_abandon",
        }),
      ).rejects.toMatchObject({ code: "CRASH_RECOVERY_REQUIRED" });
      expect(
        (await coordinatorEventTypes(fixture.sessionRoot)).filter(
          (eventType) => eventType === "source.abandoned.v2",
        ),
      ).toHaveLength(1);
      const recoveredAbandoned = await takeOverMaskWorkflowAfterCrash(fixture);
      const abandonedSnapshot = await recoveredAbandoned.snapshot();
      expect(abandonedSnapshot).toMatchObject({
        lifecycle: "active",
        activeSource: null,
        authority: "none",
        reviewState: "human_pending",
        finalDecision: "PENDING",
      });
      await expect(cleanAttested.close()).rejects.toMatchObject({
        code: "RESOURCE_CLEANUP_FAILED",
      });
      await recoveredAbandoned.close();

      const stopping =
        await __testOnlyGrandHallT554NativeReviewMaskWorkflowSessionV2.open(
          { sessionRoot: fixture.sessionRoot },
          maskWorkflowDependencies(fixture.withoutCrashSeam(), {
            seam: {
              afterSessionStopDurable: () => {
                throw new Error("injected crash after durable stop");
              },
            },
          }),
        );
      const beforeStop = await stopping.snapshot();
      await expect(
        stopping.stop({
          expectedWorkspaceRevision: beforeStop.workspaceRevision,
        }),
      ).rejects.toMatchObject({ code: "CRASH_RECOVERY_REQUIRED" });
      expect(
        (await coordinatorEventTypes(fixture.sessionRoot)).filter(
          (eventType) => eventType === "session.stopped.v2",
        ),
      ).toHaveLength(1);
      const recoveredStopped = await takeOverMaskWorkflowAfterCrash(fixture);
      expect(await recoveredStopped.snapshot()).toMatchObject({
        lifecycle: "stopped",
        activeSource: null,
        authority: "none",
        reviewState: "human_pending",
        finalDecision: "PENDING",
      });
      await expect(stopping.close()).rejects.toMatchObject({
        code: "RESOURCE_CLEANUP_FAILED",
      });
      await recoveredStopped.close();
    },
  );

  it(
    "zeros pending mask planes and retires its live runtime after a durable-abandon crash",
    { timeout: 600_000 },
    async () => {
      const fixture = await harness();
      const { session, edited } = await createEditedMaskWorkflow(
        fixture,
        maskWorkflowDependencies(fixture.withoutCrashSeam(), {
          seam: {
            afterSourceAbandonDurable: () => {
              throw new Error("injected crash after live-runtime abandon");
            },
          },
        }),
      );
      const pending = await session.prepareMaskTile({
        ...maskRenderBinding(edited),
        column: 0,
        row: 0,
      });
      const liveEpoch = fixture.epochs.at(-1);
      if (liveEpoch === undefined) {
        throw new Error("abandon crash fixture has no live source epoch");
      }

      await expect(
        session.abandonActiveSource({
          ...maskGuard(edited),
          reason: "operator_abandon",
        }),
      ).rejects.toMatchObject({ code: "CRASH_RECOVERY_REQUIRED" });
      expect(pending.sourceRgb8.every((value) => value === 0)).toBe(true);
      expect(pending.mask8.every((value) => value === 0)).toBe(true);
      expect(pending.reason8.every((value) => value === 0)).toBe(true);
      await expect(session.snapshot()).rejects.toMatchObject({
        code: "CRASH_RECOVERY_REQUIRED",
      });
      expect(
        (await coordinatorEventTypes(fixture.sessionRoot)).filter(
          (eventType) => eventType === "source.abandoned.v2",
        ),
      ).toHaveLength(1);

      const epochCountBeforeTakeover = fixture.epochs.length;
      const recovered = await takeOverMaskWorkflowAfterCrash(fixture);
      expect(await recovered.snapshot()).toMatchObject({
        lifecycle: "active",
        activeSource: null,
        authority: "none",
        reviewState: "human_pending",
        finalDecision: "PENDING",
      });
      expect(fixture.epochs).toHaveLength(epochCountBeforeTakeover);
      await expect(session.close()).rejects.toMatchObject({
        code: "RESOURCE_CLEANUP_FAILED",
      });
      expect(liveEpoch.abandoned).toBe(true);
      await recovered.close();
    },
  );

  it(
    "rejects an exact EXCLUDE terminal session before rotating a mask-workflow browser epoch",
    { timeout: 600_000 },
    async () => {
      const fixture = await harness();
      let sourceSession = await freshSession(fixture);
      await selectFirstSource(sourceSession);
      await seedExactCompletedSourceCoverage(fixture.sessionRoot);
      await sourceSession.close();
      sourceSession =
        await __testOnlyGrandHallT554NativeReviewSourceSessionV2.open(
          { sessionRoot: fixture.sessionRoot },
          fixture.withoutCrashSeam(),
        );
      const resumedSource = await sourceSession.snapshot();
      const excluded = await sourceSession.recordExcludeDecision({
        ...coordinatorBinding(resumedSource),
        note: "The exact native-grid review found no Grand Hall pixels.",
      });
      expect(activeSource(excluded).decision).toMatchObject({
        result: "EXCLUDE",
        classification: "no_observed_grand_hall_pixels",
      });
      await sourceSession.close();
      const beforeMaskOpen = await coordinatorEventTypes(fixture.sessionRoot);

      await expect(
        __testOnlyGrandHallT554NativeReviewMaskWorkflowSessionV2.open(
          { sessionRoot: fixture.sessionRoot },
          maskWorkflowDependencies(fixture.withoutCrashSeam()),
        ),
      ).rejects.toMatchObject({ code: "PHASE_INVALID" });
      expect(await coordinatorEventTypes(fixture.sessionRoot)).toEqual(
        beforeMaskOpen,
      );
    },
  );
});

describe("Grand Hall T-554 mask-workflow crash recovery v2", () => {
  it(
    "fails closed without appending when takeover encounters a pending source mutation",
    { timeout: 180_000 },
    async () => {
      const fixture = await harness({
        afterSourceSelectionIntentDurable: () => {
          throw new Error("injected crash after source selection intent");
        },
      });
      const sourceSession = await freshSession(fixture);
      await expect(selectFirstSource(sourceSession)).rejects.toThrow(
        "injected crash after source selection intent",
      );
      const beforeMaskTakeover = await coordinatorEvents(fixture.sessionRoot);
      expect(beforeMaskTakeover.at(-1)?.eventType).toBe(
        "source.selection-intended.v2",
      );

      await expect(
        takeOverMaskWorkflowAfterCrash(fixture),
      ).rejects.toMatchObject({ code: "CRASH_RECOVERY_REQUIRED" });
      expect(await coordinatorEvents(fixture.sessionRoot)).toEqual(
        beforeMaskTakeover,
      );
      await expect(sourceSession.close()).rejects.toMatchObject({
        code: "STALE_LEASE",
      });
    },
  );

  it(
    "completes an intent-only freeze and immediately resumes its exact mask review",
    { timeout: 600_000 },
    async () => {
      const fixture = await harness();
      const { session, edited } = await createEditedMaskWorkflow(
        fixture,
        maskWorkflowDependencies(fixture.withoutCrashSeam(), {
          seam: {
            afterMaskFreezeIntentDurable: () => {
              throw new Error("injected crash after mask freeze intent");
            },
          },
        }),
      );

      await expect(
        session.freezeMask({
          ...maskGuard(edited),
          expectedMaskRevision: 1,
        }),
      ).rejects.toMatchObject({ code: "CRASH_RECOVERY_REQUIRED" });
      expect(await readdir(join(fixture.sessionRoot, "mask-evidence"))).toEqual(
        [],
      );
      expect(await maskChildLeafNames(fixture.sessionRoot)).toEqual([]);
      expect(await maskDescriptorLeafNames(fixture.sessionRoot)).toEqual([]);
      expect((await coordinatorEventTypes(fixture.sessionRoot)).at(-1)).toBe(
        "mask.freeze-intended.v2",
      );

      const recovered = await takeOverMaskWorkflowAfterCrash(fixture);
      const recoveredState = await recovered.snapshot();
      expect(recoveredState).toMatchObject({
        workspaceRevision: 5,
        maximumAllocatedRenderGeneration: 5,
        activeSource: {
          phase: "mask_review",
          renderGeneration: 5,
          maskState: { revision: 1, includedPixelCount: 64 },
          frozenBinding: {
            revision: 1,
            includedPixelCount: 64,
            immutableFrozen: true,
          },
        },
      });
      expect(
        await readdir(join(fixture.sessionRoot, "mask-evidence")),
      ).toHaveLength(2);
      expect(await maskChildLeafNames(fixture.sessionRoot)).toHaveLength(2);
      expect(await maskDescriptorLeafNames(fixture.sessionRoot)).toHaveLength(
        2,
      );
      const recoveredTypes = await coordinatorEventTypes(fixture.sessionRoot);
      const intentIndex = recoveredTypes.lastIndexOf("mask.freeze-intended.v2");
      const commitIndex = recoveredTypes.lastIndexOf(
        "mask.freeze-committed.v2",
      );
      const browserIndex = recoveredTypes.lastIndexOf(
        "session.browser-epoch-started.v2",
      );
      const resumeIntentIndex = recoveredTypes.lastIndexOf(
        "coverage.segment-resume-intended.v2",
      );
      const resumeCommitIndex = recoveredTypes.lastIndexOf(
        "coverage.segment-resume-committed.v2",
      );
      expect(intentIndex).toBeGreaterThanOrEqual(0);
      expect(commitIndex).toBeGreaterThan(intentIndex);
      expect(browserIndex).toBeGreaterThan(commitIndex);
      expect(resumeIntentIndex).toBeGreaterThan(browserIndex);
      expect(resumeCommitIndex).toBeGreaterThan(resumeIntentIndex);
      expect(recoveredTypes).not.toContain("mask.freeze-recovery-aborted.v2");
      await recovered.close();
      await expect(session.close()).rejects.toMatchObject({
        code: "RESOURCE_CLEANUP_FAILED",
      });
    },
  );

  it(
    "recovery-aborts an exact first-final-link partial publication without creating a mask child",
    { timeout: 600_000 },
    async () => {
      const fixture = await harness();
      const { session, edited } = await createEditedMaskWorkflow(
        fixture,
        maskWorkflowDependencies(fixture.withoutCrashSeam(), {
          configureMaskStore: (store) => {
            __testOnlyGrandHallT554NativeMaskRevisionStore.observePreparedPublication(
              store,
              {
                afterPreparedFinalLinked: ({ plane }) => {
                  if (plane === "mask") {
                    throw new Error(
                      "injected crash after exact mask final link",
                    );
                  }
                },
              },
            );
          },
        }),
      );

      await expect(
        session.freezeMask({
          ...maskGuard(edited),
          expectedMaskRevision: 1,
        }),
      ).rejects.toMatchObject({ code: "CRASH_RECOVERY_REQUIRED" });
      const beforeRecoveryEvents = await coordinatorEvents(fixture.sessionRoot);
      const intent = beforeRecoveryEvents.find(
        (candidate) => candidate.eventType === "mask.freeze-intended.v2",
      );
      if (intent?.eventType !== "mask.freeze-intended.v2") {
        throw new Error("partial-publication fixture has no freeze intent");
      }
      expect(await readdir(join(fixture.sessionRoot, "mask-evidence"))).toEqual(
        [intent.payload.preparedBinding.mask.fileName],
      );
      expect(await maskChildLeafNames(fixture.sessionRoot)).toEqual([]);
      expect(await maskDescriptorLeafNames(fixture.sessionRoot)).toEqual([]);

      const recovered = await takeOverMaskWorkflowAfterCrash(fixture);
      const recoveredSnapshot = await recovered.snapshot();
      expect(recoveredSnapshot).toMatchObject({
        workspaceRevision: 4,
        maximumAllocatedRenderGeneration: 5,
        activeSource: {
          phase: "mask_edit",
          renderGeneration: 5,
          maskState: { revision: 1, includedPixelCount: 64 },
          frozenBinding: null,
          maskJournalLeafName: null,
        },
      });
      expect(await readdir(join(fixture.sessionRoot, "mask-evidence"))).toEqual(
        [intent.payload.preparedBinding.mask.fileName],
      );
      expect(await maskChildLeafNames(fixture.sessionRoot)).toEqual([]);
      expect(await maskDescriptorLeafNames(fixture.sessionRoot)).toEqual([]);
      const recoveredTypes = await coordinatorEventTypes(fixture.sessionRoot);
      expect(
        recoveredTypes.filter(
          (eventType) => eventType === "mask.freeze-recovery-aborted.v2",
        ),
      ).toHaveLength(1);
      expect(recoveredTypes).not.toContain("mask.freeze-committed.v2");
      const abortIndex = recoveredTypes.lastIndexOf(
        "mask.freeze-recovery-aborted.v2",
      );
      const browserIndex = recoveredTypes.lastIndexOf(
        "session.browser-epoch-started.v2",
      );
      const resumeIndex = recoveredTypes.lastIndexOf(
        "mask.edit-epoch-resumed.v2",
      );
      expect(browserIndex).toBeGreaterThan(abortIndex);
      expect(resumeIndex).toBeGreaterThan(browserIndex);
      await expect(
        recovered.freezeMask({
          ...maskGuard(recoveredSnapshot),
          expectedMaskRevision: 1,
        }),
      ).rejects.toMatchObject({ code: "MASK_REVISION_TAINTED" });
      expect(await coordinatorEventTypes(fixture.sessionRoot)).toEqual(
        recoveredTypes,
      );
      await recovered.close();
    },
  );

  it(
    "adopts a complete exact publication pair and creates one child after a pre-child crash",
    { timeout: 600_000 },
    async () => {
      const fixture = await harness();
      const { session, edited } = await createEditedMaskWorkflow(
        fixture,
        maskWorkflowDependencies(fixture.withoutCrashSeam(), {
          seam: {
            afterMaskPairPublished: () => {
              throw new Error("injected crash after exact mask pair");
            },
          },
        }),
      );

      await expect(
        session.freezeMask({
          ...maskGuard(edited),
          expectedMaskRevision: 1,
        }),
      ).rejects.toMatchObject({ code: "CRASH_RECOVERY_REQUIRED" });
      expect(
        await readdir(join(fixture.sessionRoot, "mask-evidence")),
      ).toHaveLength(2);
      expect(await maskChildLeafNames(fixture.sessionRoot)).toEqual([]);
      expect(await maskDescriptorLeafNames(fixture.sessionRoot)).toEqual([]);

      const recovered = await takeOverMaskWorkflowAfterCrash(fixture);
      const recoveredState = await recovered.snapshot();
      expect(recoveredState).toMatchObject({
        workspaceRevision: 5,
        maximumAllocatedRenderGeneration: 5,
        activeSource: {
          phase: "mask_review",
          renderGeneration: 5,
          maskState: { revision: 1, includedPixelCount: 64 },
          frozenBinding: { revision: 1, includedPixelCount: 64 },
        },
      });
      expect(
        await readdir(join(fixture.sessionRoot, "mask-evidence")),
      ).toHaveLength(2);
      expect(await maskChildLeafNames(fixture.sessionRoot)).toHaveLength(2);
      expect(await maskDescriptorLeafNames(fixture.sessionRoot)).toHaveLength(
        2,
      );
      const recoveredTypes = await coordinatorEventTypes(fixture.sessionRoot);
      expect(
        recoveredTypes.filter(
          (eventType) => eventType === "mask.freeze-committed.v2",
        ),
      ).toHaveLength(1);
      expect(recoveredTypes).not.toContain("mask.freeze-recovery-aborted.v2");
      expect(
        recoveredTypes.filter(
          (eventType) => eventType === "coverage.segment-resume-committed.v2",
        ),
      ).toHaveLength(1);
      await recovered.close();
      await expect(session.close()).rejects.toMatchObject({
        code: "RESOURCE_CLEANUP_FAILED",
      });
    },
  );

  it(
    "refuses to commit when the published descriptor is corrupted before full-root verification",
    { timeout: 600_000 },
    async () => {
      const fixture = await harness();
      const { session, edited } = await createEditedMaskWorkflow(
        fixture,
        maskWorkflowDependencies(fixture.withoutCrashSeam(), {
          seam: {
            afterMaskChildStartPublishedBeforeRootVerification: async () => {
              const descriptors = await maskDescriptorLeafNames(
                fixture.sessionRoot,
              );
              const descriptor = descriptors[0];
              if (descriptor === undefined || descriptors.length !== 1) {
                throw new Error(
                  "descriptor-corruption fixture expected one mask descriptor",
                );
              }
              await writeFile(
                join(fixture.sessionRoot, "child-scopes", descriptor),
                '{"corrupt":true}\n',
                "utf8",
              );
            },
          },
        }),
      );

      await expect(
        session.freezeMask({
          ...maskGuard(edited),
          expectedMaskRevision: 1,
        }),
      ).rejects.toMatchObject({ code: "CRASH_RECOVERY_REQUIRED" });
      const eventTypes = await coordinatorEventTypes(fixture.sessionRoot);
      expect(eventTypes.at(-1)).toBe("mask.freeze-intended.v2");
      expect(eventTypes).not.toContain("mask.freeze-committed.v2");
      expect(await maskChildLeafNames(fixture.sessionRoot)).toHaveLength(1);
      expect(await maskDescriptorLeafNames(fixture.sessionRoot)).toHaveLength(
        1,
      );
      await expect(
        takeOverMaskWorkflowAfterCrash(fixture),
      ).rejects.toMatchObject({ code: "CRASH_RECOVERY_REQUIRED" });
      expect(await coordinatorEventTypes(fixture.sessionRoot)).toEqual(
        eventTypes,
      );
    },
  );

  it(
    "reconciles an exact child created before its descriptor and commits it once",
    { timeout: 600_000 },
    async () => {
      const fixture = await harness();
      const { session, edited } = await createEditedMaskWorkflow(
        fixture,
        maskWorkflowDependencies(fixture.withoutCrashSeam(), {
          seam: {
            afterMaskChildPublished: () => {
              throw new Error("injected crash after exact mask child");
            },
          },
        }),
      );

      await expect(
        session.freezeMask({
          ...maskGuard(edited),
          expectedMaskRevision: 1,
        }),
      ).rejects.toMatchObject({ code: "CRASH_RECOVERY_REQUIRED" });
      const childNamesBeforeRecovery = await maskChildLeafNames(
        fixture.sessionRoot,
      );
      expect(childNamesBeforeRecovery).toHaveLength(1);
      const childNameBeforeRecovery = childNamesBeforeRecovery[0];
      if (childNameBeforeRecovery === undefined) {
        throw new Error("Expected one published mask child before recovery.");
      }
      expect(await maskDescriptorLeafNames(fixture.sessionRoot)).toEqual([]);

      const recovered = await takeOverMaskWorkflowAfterCrash(fixture);
      const recoveredState = await recovered.snapshot();
      expect(recoveredState).toMatchObject({
        workspaceRevision: 5,
        maximumAllocatedRenderGeneration: 5,
        activeSource: {
          phase: "mask_review",
          renderGeneration: 5,
          maskState: { revision: 1, includedPixelCount: 64 },
        },
      });
      expect(activeMaskSource(recoveredState).maskJournalLeafName).not.toBe(
        childNameBeforeRecovery,
      );
      expect(await maskChildLeafNames(fixture.sessionRoot)).toHaveLength(2);
      expect(await maskChildLeafNames(fixture.sessionRoot)).toContain(
        childNameBeforeRecovery,
      );
      expect(await maskDescriptorLeafNames(fixture.sessionRoot)).toHaveLength(
        2,
      );
      expect(await maskDescriptorLeafNames(fixture.sessionRoot)).toContain(
        `${childNameBeforeRecovery}.json`,
      );
      const recoveredTypes = await coordinatorEventTypes(fixture.sessionRoot);
      expect(
        recoveredTypes.filter(
          (eventType) => eventType === "mask.freeze-committed.v2",
        ),
      ).toHaveLength(1);
      expect(recoveredTypes).not.toContain("mask.freeze-recovery-aborted.v2");
      expect(
        recoveredTypes.filter(
          (eventType) => eventType === "coverage.segment-resume-committed.v2",
        ),
      ).toHaveLength(1);
      await recovered.close();
      await expect(session.close()).rejects.toMatchObject({
        code: "RESOURCE_CLEANUP_FAILED",
      });
    },
  );

  it(
    "releases the owner when mask-edit resume cannot open its fresh epoch so clean reopen succeeds",
    { timeout: 300_000 },
    async () => {
      const fixture = await harness();
      const { session, edited } = await createEditedMaskWorkflow(
        fixture,
        maskWorkflowDependencies(fixture.withoutCrashSeam()),
      );
      await session.close();

      await expect(
        __testOnlyGrandHallT554NativeReviewMaskWorkflowSessionV2.open(
          { sessionRoot: fixture.sessionRoot },
          maskWorkflowDependencies(fixture.withoutCrashSeam(), {
            openSourceEpoch: (): Promise<never> =>
              Promise.reject(
                new Error("injected mask-resume fresh epoch open failure"),
              ),
          }),
        ),
      ).rejects.toMatchObject({ code: "RESOURCE_FAILURE" });

      const scope = await expectedSessionScope(fixture.sessionRoot);
      expect(
        await inspectGrandHallT554NativeReviewPriorOwnerV2({
          sessionRoot: fixture.sessionRoot,
          expectedSessionScope: scope,
        }),
      ).toBeNull();
      const recovered =
        await __testOnlyGrandHallT554NativeReviewMaskWorkflowSessionV2.open(
          { sessionRoot: fixture.sessionRoot },
          maskWorkflowDependencies(fixture.withoutCrashSeam()),
        );
      expect(await recovered.snapshot()).toMatchObject({
        workspaceRevision: edited.workspaceRevision + 1,
        maximumAllocatedRenderGeneration:
          edited.maximumAllocatedRenderGeneration + 1,
        activeSource: {
          phase: "mask_edit",
          renderGeneration: activeMaskSource(edited).renderGeneration + 1,
          maskState: activeMaskSource(edited).maskState,
        },
      });
      await recovered.close();
    },
  );

  it(
    "retains takeover fencing, recovery-aborts an intent-only mask coverage resume, and retries with fresh identities",
    { timeout: 600_000 },
    async () => {
      const fixture = await harness();
      const { session, edited } = await createEditedMaskWorkflow(
        fixture,
        maskWorkflowDependencies(fixture.withoutCrashSeam()),
      );
      const frozen = await session.freezeMask({
        ...maskGuard(edited),
        expectedMaskRevision: 1,
      });
      const stalePendingTile = await session.prepareMaskTile({
        ...maskRenderBinding(frozen),
        column: 0,
        row: 0,
      });
      const expectedMask8 = Buffer.from(stalePendingTile.mask8);
      const expectedReason8 = Buffer.from(stalePendingTile.reason8);

      await expect(
        takeOverMaskWorkflowAfterCrash(fixture, {
          seam: {
            afterMaskCoverageResumeIntentDurable: () => {
              throw new Error("injected crash after mask resume intent");
            },
          },
        }),
      ).rejects.toMatchObject({ code: "CRASH_RECOVERY_REQUIRED" });
      const resumeCrashScope = await expectedSessionScope(fixture.sessionRoot);
      expect(
        await inspectGrandHallT554NativeReviewPriorOwnerV2({
          sessionRoot: fixture.sessionRoot,
          expectedSessionScope: resumeCrashScope,
        }),
      ).not.toBeNull();
      const afterCrash = await coordinatorReplayState(fixture.sessionRoot);
      expect(afterCrash).toMatchObject({
        workspaceRevision: frozen.workspaceRevision,
        maximumAllocatedRenderGeneration:
          frozen.maximumAllocatedRenderGeneration + 1,
        pendingIntent: {
          kind: "coverage_resume",
          allocatedRenderGeneration:
            frozen.maximumAllocatedRenderGeneration + 1,
        },
        activeSource: {
          phase: "mask_review",
          renderGeneration: activeMaskSource(frozen).renderGeneration,
          maskState: activeMaskSource(frozen).maskState,
          frozenBindingSha256: activeMaskSource(frozen).frozenBindingSha256,
        },
      });
      expect(await maskChildLeafNames(fixture.sessionRoot)).toHaveLength(1);

      await expect(
        takeOverMaskWorkflowAfterCrash(fixture, {
          seam: {
            afterMaskCoverageResumeRecoveryAbortDurable: () => {
              throw new Error(
                "injected crash after mask resume recovery-abort",
              );
            },
          },
        }),
      ).rejects.toMatchObject({ code: "CRASH_RECOVERY_REQUIRED" });
      const afterDurableAbort = await coordinatorReplayState(
        fixture.sessionRoot,
      );
      expect(afterDurableAbort).toMatchObject({
        workspaceRevision: frozen.workspaceRevision,
        maximumAllocatedRenderGeneration:
          frozen.maximumAllocatedRenderGeneration + 1,
        pendingIntent: null,
        activeSource: {
          phase: "mask_review",
          renderGeneration: activeMaskSource(frozen).renderGeneration,
          maskState: activeMaskSource(frozen).maskState,
          frozenBindingSha256: activeMaskSource(frozen).frozenBindingSha256,
        },
      });

      const recovered = await takeOverMaskWorkflowAfterCrash(fixture);
      const snapshot = await recovered.snapshot();
      expect(snapshot).toMatchObject({
        workspaceRevision: frozen.workspaceRevision + 1,
        maximumAllocatedRenderGeneration:
          frozen.maximumAllocatedRenderGeneration + 2,
        activeSource: {
          phase: "mask_review",
          renderGeneration: activeMaskSource(frozen).renderGeneration + 2,
          maskState: activeMaskSource(frozen).maskState,
          maskReviewSubjectSha256:
            activeMaskSource(frozen).maskReviewSubjectSha256,
          frozenBindingSha256: activeMaskSource(frozen).frozenBindingSha256,
          frozenBinding: activeMaskSource(frozen).frozenBinding,
        },
      });
      const events = await coordinatorEvents(fixture.sessionRoot);
      const intents = events.filter(
        (candidate) =>
          candidate.eventType === "coverage.segment-resume-intended.v2" &&
          candidate.payload.kind === "mask",
      );
      const aborts = events.filter(
        (candidate) =>
          candidate.eventType ===
            "coverage.segment-resume-recovery-aborted.v2" &&
          candidate.payload.kind === "mask",
      );
      const commits = events.filter(
        (candidate) =>
          candidate.eventType === "coverage.segment-resume-committed.v2" &&
          candidate.payload.kind === "mask",
      );
      expect(intents).toHaveLength(2);
      expect(aborts).toHaveLength(1);
      expect(commits).toHaveLength(1);
      const firstIntent = intents[0];
      const secondIntent = intents[1];
      if (
        firstIntent?.eventType !== "coverage.segment-resume-intended.v2" ||
        firstIntent.payload.kind !== "mask" ||
        secondIntent?.eventType !== "coverage.segment-resume-intended.v2" ||
        secondIntent.payload.kind !== "mask"
      ) {
        throw new Error("mask resume retry fixture lost its exact intents");
      }
      expect(aborts[0]?.payload).toMatchObject({
        workspaceRevision: frozen.workspaceRevision,
        consumedRenderGeneration: frozen.maximumAllocatedRenderGeneration + 1,
        recovery: {
          childDisposition: "absent",
          abandonedChildJournal: null,
        },
      });
      expect(firstIntent.payload.operationIdSha256).not.toBe(
        secondIntent.payload.operationIdSha256,
      );
      expect(firstIntent.payload.newCoverageSegmentIdSha256).not.toBe(
        secondIntent.payload.newCoverageSegmentIdSha256,
      );
      expect(firstIntent.payload.newSourceEpochNonceSha256).not.toBe(
        secondIntent.payload.newSourceEpochNonceSha256,
      );
      const rehydrated = await recovered.prepareMaskTile({
        ...maskRenderBinding(snapshot),
        column: 0,
        row: 0,
      });
      expect(rehydrated.mask8).toEqual(expectedMask8);
      expect(rehydrated.reason8).toEqual(expectedReason8);
      await rehydrated.discardAfterFailedSend();
      await recovered.close();
      await expect(session.close()).rejects.toMatchObject({
        code: "RESOURCE_CLEANUP_FAILED",
      });
      expect(stalePendingTile.sourceRgb8.every((value) => value === 0)).toBe(
        true,
      );
      expect(stalePendingTile.mask8.every((value) => value === 0)).toBe(true);
      expect(stalePendingTile.reason8.every((value) => value === 0)).toBe(true);

      const reopened =
        await __testOnlyGrandHallT554NativeReviewMaskWorkflowSessionV2.open(
          { sessionRoot: fixture.sessionRoot },
          maskWorkflowDependencies(fixture.withoutCrashSeam()),
        );
      await reopened.close();
      expect(
        (await coordinatorEvents(fixture.sessionRoot)).filter(
          (candidate) =>
            candidate.eventType ===
              "coverage.segment-resume-recovery-aborted.v2" &&
            candidate.payload.kind === "mask",
        ),
      ).toHaveLength(1);
    },
  );

  it.each([
    {
      boundary: "child",
      expectedDescriptorCountAfterCrash: 1,
    },
    {
      boundary: "descriptor",
      expectedDescriptorCountAfterCrash: 2,
    },
    {
      boundary: "root-verification",
      expectedDescriptorCountAfterCrash: 2,
    },
  ] as const)(
    "reconciles and recovery-aborts an exact revision-one mask resume stopped at its $boundary boundary",
    { timeout: 600_000 },
    async ({ boundary, expectedDescriptorCountAfterCrash }) => {
      const fixture = await harness();
      const { session, edited } = await createEditedMaskWorkflow(
        fixture,
        maskWorkflowDependencies(fixture.withoutCrashSeam()),
      );
      const frozen = await session.freezeMask({
        ...maskGuard(edited),
        expectedMaskRevision: 1,
      });
      const crash = (): never => {
        throw new Error(`injected crash after mask resume ${boundary}`);
      };
      await expect(
        takeOverMaskWorkflowAfterCrash(fixture, {
          seam:
            boundary === "child"
              ? { afterMaskCoverageResumeChildPublished: crash }
              : boundary === "descriptor"
                ? { afterMaskCoverageResumeDescriptorPublished: crash }
                : {
                    afterMaskCoverageResumeChildStartPublishedBeforeRootVerification:
                      crash,
                  },
        }),
      ).rejects.toMatchObject({ code: "CRASH_RECOVERY_REQUIRED" });
      expect(await maskChildLeafNames(fixture.sessionRoot)).toHaveLength(2);
      expect(await maskDescriptorLeafNames(fixture.sessionRoot)).toHaveLength(
        expectedDescriptorCountAfterCrash,
      );

      const recovered = await takeOverMaskWorkflowAfterCrash(fixture);
      const snapshot = await recovered.snapshot();
      expect(snapshot).toMatchObject({
        workspaceRevision: frozen.workspaceRevision + 1,
        maximumAllocatedRenderGeneration:
          frozen.maximumAllocatedRenderGeneration + 2,
        activeSource: {
          phase: "mask_review",
          renderGeneration: activeMaskSource(frozen).renderGeneration + 2,
          maskState: activeMaskSource(frozen).maskState,
          frozenBindingSha256: activeMaskSource(frozen).frozenBindingSha256,
        },
      });
      const aborts = (await coordinatorEvents(fixture.sessionRoot)).filter(
        (candidate) =>
          candidate.eventType ===
            "coverage.segment-resume-recovery-aborted.v2" &&
          candidate.payload.kind === "mask",
      );
      expect(aborts).toHaveLength(1);
      expect(aborts[0]?.payload).toMatchObject({
        workspaceRevision: frozen.workspaceRevision,
        consumedRenderGeneration: frozen.maximumAllocatedRenderGeneration + 1,
        recovery: {
          childDisposition: "exact_abandoned",
          abandonedChildJournal: { kind: "mask", revision: 1 },
        },
      });
      expect(await maskChildLeafNames(fixture.sessionRoot)).toHaveLength(3);
      expect(await maskDescriptorLeafNames(fixture.sessionRoot)).toHaveLength(
        3,
      );
      await recovered.close();
      await expect(session.close()).rejects.toMatchObject({
        code: "RESOURCE_CLEANUP_FAILED",
      });
    },
  );

  it(
    "never aborts a commit-durable mask coverage resume and uses that start-only child as the next predecessor",
    { timeout: 600_000 },
    async () => {
      const fixture = await harness();
      const { session, edited } = await createEditedMaskWorkflow(
        fixture,
        maskWorkflowDependencies(fixture.withoutCrashSeam()),
      );
      const frozen = await session.freezeMask({
        ...maskGuard(edited),
        expectedMaskRevision: 1,
      });
      await expect(
        takeOverMaskWorkflowAfterCrash(fixture, {
          seam: {
            afterMaskCoverageResumeCommitDurable: () => {
              throw new Error("injected crash after mask resume commit");
            },
          },
        }),
      ).rejects.toMatchObject({ code: "CRASH_RECOVERY_REQUIRED" });
      const committed = await coordinatorReplayState(fixture.sessionRoot);
      expect(committed).toMatchObject({
        workspaceRevision: frozen.workspaceRevision + 1,
        maximumAllocatedRenderGeneration:
          frozen.maximumAllocatedRenderGeneration + 1,
        pendingIntent: null,
        activeSource: {
          phase: "mask_review",
          renderGeneration: activeMaskSource(frozen).renderGeneration + 1,
        },
      });

      const recovered = await takeOverMaskWorkflowAfterCrash(fixture);
      const snapshot = await recovered.snapshot();
      expect(snapshot).toMatchObject({
        workspaceRevision: frozen.workspaceRevision + 2,
        maximumAllocatedRenderGeneration:
          frozen.maximumAllocatedRenderGeneration + 2,
        activeSource: {
          phase: "mask_review",
          renderGeneration: activeMaskSource(frozen).renderGeneration + 2,
        },
      });
      const events = await coordinatorEvents(fixture.sessionRoot);
      const intents = events.filter(
        (candidate) =>
          candidate.eventType === "coverage.segment-resume-intended.v2" &&
          candidate.payload.kind === "mask",
      );
      const commits = events.filter(
        (candidate) =>
          candidate.eventType === "coverage.segment-resume-committed.v2" &&
          candidate.payload.kind === "mask",
      );
      const aborts = events.filter(
        (candidate) =>
          candidate.eventType ===
            "coverage.segment-resume-recovery-aborted.v2" &&
          candidate.payload.kind === "mask",
      );
      expect(intents).toHaveLength(2);
      expect(commits).toHaveLength(2);
      expect(aborts).toHaveLength(0);
      const secondIntent = intents[1];
      const firstCommit = commits[0];
      if (
        secondIntent?.eventType !== "coverage.segment-resume-intended.v2" ||
        secondIntent.payload.kind !== "mask" ||
        firstCommit?.eventType !== "coverage.segment-resume-committed.v2" ||
        firstCommit.payload.kind !== "mask"
      ) {
        throw new Error(
          "commit-durable fixture lost its exact mask resume events",
        );
      }
      expect(
        secondIntent.payload.predecessorCoverage.predecessorJournal,
      ).toEqual(firstCommit.payload.maskJournal);
      expect(secondIntent.payload.predecessorCoverage.completedTileCount).toBe(
        0,
      );
      expect(await maskChildLeafNames(fixture.sessionRoot)).toHaveLength(3);
      await recovered.close();
      await expect(session.close()).rejects.toMatchObject({
        code: "RESOURCE_CLEANUP_FAILED",
      });
    },
  );
});
