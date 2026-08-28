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
import {
  createGrandHallT554NativeReviewCoverageCarryStateV2,
} from "../grand-hall-t554-native-review-replay-v2.js";
import type { GrandHallT554NativeReviewRegistrySource } from
  "../grand-hall-t554-native-review-registry.js";
import {
  deriveGrandHallT554NativeReviewSessionOwnerControlDirectoryV2,
  inspectGrandHallT554NativeReviewPriorOwnerV2,
} from "../grand-hall-t554-native-review-session-owner-v2.js";
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
    const removal = { force: true, recursive: true, maxRetries: 5, retryDelay: 50 };
    await rm(
      deriveGrandHallT554NativeReviewSessionOwnerControlDirectoryV2(sessionRoot),
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
  return Buffer.from(`${stableCanonicalJson(toCanonicalJson(value))}\n`, "utf8");
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

function sourceIdentity(inventoryIndex: number): GrandHallPanoramaSourceJpgIdentityV2 {
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

function registrySource(inventoryIndex: number): GrandHallT554NativeReviewRegistrySource {
  return {
    source: sourceIdentity(inventoryIndex),
    observation: {
      state: "grand_hall_pixels_observed_human_pending",
      proposedDisposition: "include_with_binary_pixel_mask",
      maskAuthoringState: "required_not_authored",
    },
    observationBasis:
      "agent_visual_inspection_of_digest_bound_source_panorama",
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
  return digest(Buffer.from(
    `VENVIEWER_GRAND_HALL_T554_NATIVE_SOURCE_EPOCH_BINDING_V1\n${stableTypesJson(material)}`,
    "utf8",
  ));
}

type EpochSnapshotMutation = (
  snapshot: GrandHallT554NativeSourceEpochSnapshotV1,
) => void;

class FakeSourceEpoch {
  readonly #bindings: GrandHallT554NativeSourceEpochBindingsV1;
  readonly #verification:
    GrandHallT554NativeSourceEpochSnapshotV1["sourceVerification"];
  abandoned = false;

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
      lifecycle: this.abandoned ? "closed" : "active",
      closedDisposition: this.abandoned ? "abandoned" : null,
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

  abandon(): Promise<void> {
    this.abandoned = true;
    return Promise.resolve();
  }
}

function implementationFixture() {
  const material = {
    schemaVersion:
      GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_SCHEMA,
    implementationId:
      "grand-hall-t554-native-review-workbench-v1" as const,
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
  const makeDependencies = (nextSeam?: CrashSeam) => createDependencies({
    sourceRoot,
    epochs,
    clock,
    nonceState,
    ...(nextSeam === undefined ? {} : { seam: nextSeam }),
    ...(epochSnapshotMutation === undefined
      ? {}
      : { epochSnapshotMutation }),
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

async function sourceChildEvidence(
  sessionRoot: string,
  childName: string,
) {
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

describe("Grand Hall T-554 source-only durable session v2", () => {
  it("creates a fresh authority-none root and serializes one lease-asserted source selection", { timeout: 120_000 }, async () => {
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
    expect((await readdir(fixture.sessionRoot)).sort()).toEqual([
      "child-scopes",
      "children",
      "coordinator",
      GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME,
      "mask-evidence",
      "session-root.json",
    ].sort());
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
    const childName = (await readdir(join(fixture.sessionRoot, "children")))[0];
    if (childName === undefined) throw new Error("missing selected source child");
    const child = await sourceChildEvidence(fixture.sessionRoot, childName);
    expect(child.events[1]).toMatchObject({
      eventType: "source.tile-delivered.v2",
      payload: { responseFinishedAtUtc: "2000-01-01T00:00:00.000Z" },
    });
    await session.close();
  });

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
        Reflect.set(snapshot, "epochBindingSha256", digest("forged-epoch-binding"));
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
      await expect(session.recordExcludeDecision({
        ...coordinatorBinding(selected),
        note: "The exact native-grid review found no Grand Hall pixels.",
      })).rejects.toMatchObject({ code: "SOURCE_COVERAGE_INCOMPLETE" });

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
      if (decision === null) throw new Error("EXCLUDE decision was not exposed");
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
        maximumAllocatedRenderGeneration: decided.maximumAllocatedRenderGeneration,
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
        (await coordinatorEventTypes(fixture.sessionRoot)).filter(
          (eventType) => eventType.startsWith("coverage.segment-resume-"),
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
          expectedSessionScope: await expectedSessionScope(
            fixture.sessionRoot,
          ),
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
        throw new Error("attested crash fixture unexpectedly had no prior owner");
      }
      const recovered =
        await __testOnlyGrandHallT554NativeReviewSourceSessionV2.takeOver(
          { sessionRoot: fixture.sessionRoot, priorOwnerWitness },
          fixture.withoutCrashSeam(),
        );
      const recoveredAttested = await recovered.snapshot();
      expect(recoveredAttested).toMatchObject({
        workspaceRevision: attested.workspaceRevision,
        maximumAllocatedRenderGeneration: attested.maximumAllocatedRenderGeneration,
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
      await expect(session.close()).rejects.toMatchObject({ code: "STALE_LEASE" });
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
        (event) => event.eventType ===
          "source.human-attestation-recorded.v2",
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
      ).rejects.toThrow(
        "injected crash at afterBrowserEpochStartedDurable",
      );
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

  it("cleanly resumes an active source with a fresh epoch and the exact latest child checkpoint", { timeout: 180_000 }, async () => {
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
    const firstChildName = (await readdir(join(fixture.sessionRoot, "children")))[0];
    if (firstChildName === undefined) throw new Error("missing first source child");
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
      expect(carriedDwell.subarray(2).every((value) => value === 0)).toBe(true);
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
    const rotatedBrowser = [...events].reverse().find(
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
    const resumedChildren = await readdir(join(fixture.sessionRoot, "children"));
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
  });

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

      await expect(stale.close()).rejects.toMatchObject({ code: "STALE_LEASE" });
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
      expect(beforeTakeoverTypes.includes("source.selection-committed.v2")).toBe(
        selectionWasCommitted,
      );

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
        expect(startOnlyEvidence.events.map((event) => event.eventType)).toEqual([
          "source.review-started.v2",
        ]);
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
      const crashBrowserEpoch = [...afterTakeover].reverse().find(
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
        expect(crashBrowserEpoch.payload.priorActiveSourceJournal).not.toBeNull();
      } else {
        expect(afterTakeoverTypes).toContain(
          "source.selection-recovery-aborted.v2",
        );
        expect(crashBrowserEpoch.payload.priorActiveSourceJournal).toBeNull();
      }
      await expect(crashed.selectSource({
        expectedWorkspaceRevision: recoveredSnapshot.workspaceRevision,
        inventoryIndex: 2,
      })).rejects.toMatchObject({ code: "STALE_LEASE" });
      await recovered.close();
    },
  );
});
