import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { lstat, mkdir, open, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import {
  CanonicalJsonValueSchema,
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_WIDTH_PX,
  GrandHallPanoramaSourceJpgIdentityV2Schema,
  stableCanonicalJson,
  type GrandHallPanoramaSourceJpgIdentityV2,
} from "@omnitwin/types";
import { toCanonicalJson } from "@omnitwin/reconstruction-foundry";
import { z } from "zod";

import {
  GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT,
  GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX,
  GRAND_HALL_T554_NATIVE_TILE_ROW_COUNT,
  GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX,
  type GrandHallT554NativeReviewCoverageControllerOptions,
  type GrandHallT554NativeReviewCoverageEventV1,
  type GrandHallT554NativeReviewCoverageSnapshotV1,
} from "./grand-hall-t554-native-review-coverage.js";
import {
  type GrandHallT554NativeReviewJournalAppendInput,
  type GrandHallT554NativeReviewJournalScope,
} from "./grand-hall-t554-native-review-journal.js";
import {
  GRAND_HALL_T554_NATIVE_MASK_REASON_CODES,
  type GrandHallT554NativeMaskFrozenBinding,
  type GrandHallT554NativeMaskStoreConfig,
} from "./grand-hall-t554-native-review-mask-store.js";
import type {
  GrandHallT554NativeReviewRegistrySource,
  GrandHallT554NativeReviewRegistrySummary,
} from "./grand-hall-t554-native-review-registry.js";
import {
  type GrandHallT554NativeSourceEpochBindingsV1,
  type GrandHallT554NativeSourceEpochSnapshotV1,
  type GrandHallT554NativeSourceTileRequestV1,
} from "./grand-hall-t554-native-source-epoch.js";

const NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const MAXIMUM_ARTIFACT_BYTES = 16 * 1_024 * 1_024;

const Sha256Schema = z.string().regex(SHA256_PATTERN).transform(
  (value): `sha256:${string}` => `sha256:${value.slice("sha256:".length)}`,
);

const NonceSchema = z.string().regex(NONCE_PATTERN).refine((value) => {
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === 32 && bytes.toString("base64url") === value;
}, "nonce must be one canonical 256-bit base64url token");

const ArtifactBindingSchema = z.object({
  semanticSha256: Sha256Schema,
  fileSha256: Sha256Schema,
  byteLength: z.number().int().positive().max(MAXIMUM_ARTIFACT_BYTES),
}).strict();

const SourceIdentityEvidenceSchema = GrandHallPanoramaSourceJpgIdentityV2Schema.transform(
  (source) => ({
    ...source,
    sha256: Sha256Schema.parse(source.sha256),
  }),
);

const FixedPendingRegistrySummarySchema = z.object({
  venueSlug: z.literal("trades-hall"),
  roomSlug: z.literal("grand-hall"),
  sourceCount: z.literal(148),
  reviewPackSha256: z.string().regex(SHA256_PATTERN),
  reviewPackFileSha256: z.string().regex(SHA256_PATTERN),
  reviewPackFileByteLength: z.number().int().positive().max(MAXIMUM_ARTIFACT_BYTES),
  publicationReceiptSha256: z.string().regex(SHA256_PATTERN),
  publicationReceiptFileSha256: z.string().regex(SHA256_PATTERN),
  publicationReceiptFileByteLength: z.number().int().positive().max(MAXIMUM_ARTIFACT_BYTES),
  authority: z.literal("none"),
  reviewState: z.literal("human_pending"),
  acceptanceAuthorized: z.literal(false),
  reconstructionAuthorized: z.literal(false),
  runtimeAuthorized: z.literal(false),
  generatedContentAuthorized: z.literal(false),
}).strict();

const SourceEpochSnapshotEvidenceSchema = z.object({
  schemaVersion: z.literal("venviewer.grand-hall-t554-native-source-epoch.v1"),
  lifecycle: z.literal("active"),
  closedDisposition: z.null(),
  sourceEpochNonce: NonceSchema,
  sourceEpochNonceSha256: Sha256Schema,
  renderGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  epochBindingSha256: Sha256Schema,
  reviewPack: ArtifactBindingSchema,
  publicationReceipt: ArtifactBindingSchema,
  workbenchImplementationManifest: ArtifactBindingSchema,
  source: SourceIdentityEvidenceSchema,
  sourceVerification: z.object({
    fileName: z.string().min(1),
    sha256: Sha256Schema,
    byteLength: z.number().int().positive(),
    widthPx: z.literal(GRAND_HALL_PANORAMA_WIDTH_PX),
    heightPx: z.literal(GRAND_HALL_PANORAMA_HEIGHT_PX),
    decodedChannelCount: z.literal(3),
    decodedBitsPerSample: z.literal(8),
    alphaPresent: z.literal(false),
    orientationMetadataPresent: z.literal(false),
    decodedPixelSha256: Sha256Schema,
    decoderIdentity: z.object({
      schemaVersion: z.literal("venviewer.grand-hall-t554-source-jpeg-decoder-identity.v1"),
      library: z.literal("sharp"),
      sharpVersion: z.string().min(1),
      libvipsVersion: z.string().min(1),
      pipeline: z.literal("captured-jpeg-buffer-to-unrotated-rgb8.v1"),
    }).strict(),
    descriptorWitnessSha256: Sha256Schema,
    sameOpenDescriptorHashedAndDecoded: z.literal(true),
    fullJpegDecodeCompleted: z.literal(true),
  }).strict(),
  tileGrid: z.object({
    widthPx: z.literal(GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX),
    heightPx: z.literal(GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX),
    columnCount: z.literal(GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT),
    rowCount: z.literal(GRAND_HALL_T554_NATIVE_TILE_ROW_COUNT),
    channelCount: z.literal(3),
    bytesPerTile: z.literal(
      GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX * GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX * 3,
    ),
    resampling: z.literal("none"),
  }).strict(),
}).strict();

const SessionMutationBindingSchema = z.object({
  sessionNonce: NonceSchema,
  sourceEpochNonce: NonceSchema,
  renderGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  expectedWorkspaceRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();

const SelectSourceSchema = z.object({
  sessionNonce: NonceSchema,
  expectedWorkspaceRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  inventoryIndex: z.number().int().min(0).max(147),
}).strict();

const TileRequestSchema = z.object({
  sessionNonce: NonceSchema,
  sourceEpochNonce: NonceSchema,
  renderGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  column: z.number().int().min(0).max(GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT - 1),
  row: z.number().int().min(0).max(GRAND_HALL_T554_NATIVE_TILE_ROW_COUNT - 1),
}).strict();

const SourceToCssTransformSchema = z.object({
  a: z.number().finite().positive().max(64),
  b: z.number().finite(),
  c: z.number().finite(),
  d: z.number().finite().positive().max(64),
  e: z.number().finite().min(-1_000_000).max(1_000_000),
  f: z.number().finite().min(-1_000_000).max(1_000_000),
}).strict();

const PaintedTileSchema = z.object({
  column: z.number().int().min(0).max(GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT - 1),
  row: z.number().int().min(0).max(GRAND_HALL_T554_NATIVE_TILE_ROW_COUNT - 1),
  generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();

const BrowserCoverageTelemetrySchema = z.object({
  schemaVersion: z.literal("venviewer.grand-hall-t554-native-review-telemetry-sample.v1"),
  sessionNonce: NonceSchema,
  sourceEpochNonce: NonceSchema,
  renderGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  documentVisibilityState: z.enum(["visible", "hidden", "prerender"]),
  documentFocusState: z.enum(["focused", "blurred"]),
  viewportCssWidth: z.number().finite().positive().max(16_384),
  viewportCssHeight: z.number().finite().positive().max(16_384),
  devicePixelRatio: z.number().finite().min(0.25).max(8),
  sourceToCssTransform: SourceToCssTransformSchema,
  paintedTiles: z.array(PaintedTileSchema).max(
    GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT * GRAND_HALL_T554_NATIVE_TILE_ROW_COUNT,
  ),
}).strict();

const PixelCoordinateXSchema = z.number().int().min(0).max(GRAND_HALL_PANORAMA_WIDTH_PX);
const PixelCoordinateYSchema = z.number().int().min(0).max(GRAND_HALL_PANORAMA_HEIGHT_PX);
const RectanglePrimitiveSchema = z.object({
  kind: z.literal("rectangle"),
  horizontalSeam: z.enum(["none", "wrap"]),
  leftPx: PixelCoordinateXSchema,
  topPx: PixelCoordinateYSchema,
  rightExclusivePx: PixelCoordinateXSchema,
  bottomExclusivePx: PixelCoordinateYSchema,
}).strict();
const PolygonPrimitiveSchema = z.object({
  kind: z.literal("polygon"),
  horizontalSeam: z.enum(["none", "wrap_shortest"]),
  points: z.array(z.object({
    xPx: PixelCoordinateXSchema,
    yPx: PixelCoordinateYSchema,
  }).strict()).min(3).max(512),
}).strict();
const MaskPrimitiveSchema = z.union([RectanglePrimitiveSchema, PolygonPrimitiveSchema]);
const MaskEditSchema = SessionMutationBindingSchema.extend({
  expectedMaskRevision: z.number().int().nonnegative().max(4_096),
  operation: z.literal("include"),
  primitive: MaskPrimitiveSchema,
}).strict().or(SessionMutationBindingSchema.extend({
  expectedMaskRevision: z.number().int().nonnegative().max(4_096),
  operation: z.literal("exclude"),
  reasonCode: z.enum(GRAND_HALL_T554_NATIVE_MASK_REASON_CODES),
  primitive: MaskPrimitiveSchema,
}).strict());
const FreezeMaskSchema = SessionMutationBindingSchema.extend({
  expectedMaskRevision: z.number().int().nonnegative().max(4_096),
}).strict();

export interface GrandHallT554NativeReviewArtifactBindingV1 {
  readonly semanticSha256: string;
  readonly fileSha256: string;
  readonly byteLength: number;
}

export interface GrandHallT554NativeReviewSessionRegistryV1 {
  readonly summary: GrandHallT554NativeReviewRegistrySummary;
  readonly sourceAt: (inventoryIndex: number) => GrandHallT554NativeReviewRegistrySource;
  readonly mediaInputAt: (inventoryIndex: number) => {
    readonly sourceRoot: string;
    readonly fileName: string;
    readonly expectedSha256: string;
    readonly expectedByteLength: number;
  };
}

interface GrandHallT554NativeReviewInjectedSessionOptionsV1 {
  readonly registry: GrandHallT554NativeReviewSessionRegistryV1;
  readonly workbenchImplementationManifest: GrandHallT554NativeReviewArtifactBindingV1;
  readonly journalWorkspaceRoot: string;
  readonly maskPublicationDirectory: string;
}

export type GrandHallT554NativeReviewSessionPhaseV1 =
  | "source_review"
  | "include_mask_edit"
  | "include_mask_review";

export interface GrandHallT554NativeReviewSessionPublicSnapshotV1 {
  readonly schemaVersion: "venviewer.grand-hall-t554-native-review-session-public.v1";
  readonly lifecycle: "active" | "poisoned" | "stopped";
  readonly sessionNonce: string | null;
  readonly workspaceRevision: number;
  readonly registry: GrandHallT554NativeReviewRegistrySummary;
  readonly workbenchImplementationManifest: GrandHallT554NativeReviewArtifactBindingV1;
  readonly authority: "none";
  readonly reviewState: "human_pending";
  readonly finalDecision: "PENDING";
  readonly acceptanceAuthorized: false;
  readonly reconstructionAuthorized: false;
  readonly runtimeAuthorized: false;
  readonly exportAuthorized: false;
  readonly generatedContentAuthorized: false;
  readonly crashRecovery: {
    readonly resumeSupported: false;
    readonly priorJournalRootReuseAllowed: false;
    readonly releaseState: "blocked_pending_deterministic_replay_import";
  };
  readonly implementationManifestVerification: {
    readonly concreteBytesVerified: false;
    readonly productionFactoryAvailable: false;
    readonly releaseState: "blocked_pending_manifest_byte_verifier";
  };
  readonly activeSource: {
    readonly inventoryIndex: number;
    readonly sweepNumber: number;
    readonly sourceEpochNonce: string;
    readonly renderGeneration: number;
    readonly phase: GrandHallT554NativeReviewSessionPhaseV1;
    readonly tileGrid: {
      readonly widthPx: typeof GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX;
      readonly heightPx: typeof GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX;
      readonly columnCount: typeof GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT;
      readonly rowCount: typeof GRAND_HALL_T554_NATIVE_TILE_ROW_COUNT;
    };
    readonly sourceCoverage: {
      readonly completedTileCount: number;
      readonly complete: boolean;
    };
    readonly mask: {
      readonly revision: number;
      readonly frozen: boolean;
      readonly coverage: {
        readonly completedTileCount: number;
        readonly complete: boolean;
      } | null;
    };
    readonly failed: boolean;
  } | null;
}

export interface GrandHallT554NativeReviewTileV1 {
  readonly schemaVersion: "venviewer.grand-hall-t554-native-review-tile.v1";
  readonly renderMode: "source_rgb8" | "source_rgb8_with_mask8";
  readonly widthPx: typeof GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX;
  readonly heightPx: typeof GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX;
  readonly sourceRgb8: Buffer;
  readonly mask8: Buffer | null;
  /** Called only by the trusted HTTP adapter after the response finishes successfully. */
  readonly commitDeliveryAfterSuccessfulSend: () => Promise<void>;
  /** Called by the trusted HTTP adapter when the response aborts or fails. */
  readonly discardAfterFailedSend: () => Promise<void>;
}

export interface GrandHallT554NativeReviewCoverageAcknowledgementV1 {
  readonly schemaVersion: "venviewer.grand-hall-t554-native-review-coverage-ack.v1";
  readonly sequence: number;
  readonly journalRevision: number;
  readonly completedTileCount: number;
  readonly complete: boolean;
}

export type GrandHallT554NativeReviewSessionErrorCode =
  | "ARGUMENT_INVALID"
  | "SESSION_STOPPED"
  | "SESSION_POISONED"
  | "WORKSPACE_REVISION_CONFLICT"
  | "NO_ACTIVE_SOURCE"
  | "SOURCE_STALE"
  | "PHASE_INVALID"
  | "ACTIVE_SOURCE_FAILED"
  | "DURABILITY_FAILURE"
  | "RESOURCE_FAILURE"
  | "RESOURCE_CLEANUP_FAILED"
  | "CRASH_RECOVERY_REQUIRED"
  | "DELIVERY_ALREADY_RESOLVED";

export class GrandHallT554NativeReviewSessionError extends Error {
  constructor(
    readonly code: GrandHallT554NativeReviewSessionErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallT554NativeReviewSessionError";
  }
}

interface SessionSourceEpoch {
  snapshot(): unknown;
  copyTile(input: GrandHallT554NativeSourceTileRequestV1): Buffer;
  abandon(): Promise<void>;
}

interface SessionJournal {
  append(input: GrandHallT554NativeReviewJournalAppendInput): Promise<{
    readonly revision: number;
  }>;
}

interface SessionMaskStore {
  readonly source: GrandHallPanoramaSourceJpgIdentityV2;
  snapshot(): {
    readonly revision: number;
    readonly activeFrozenBinding: GrandHallT554NativeMaskFrozenBinding | null;
  };
  pixelForServerRender(x: number, y: number): { readonly value: 0 | 255 };
  applyEdit(input: unknown): {
    readonly revision: number;
    readonly activeFrozenBinding: GrandHallT554NativeMaskFrozenBinding | null;
  };
  freeze(input: unknown): Promise<GrandHallT554NativeMaskFrozenBinding>;
  abandon(): void;
}

interface SessionCoverage {
  recordDeliveredTile(column: number, row: number): void;
  recordTelemetry(input: unknown): GrandHallT554NativeReviewCoverageEventV1;
  snapshot(): GrandHallT554NativeReviewCoverageSnapshotV1;
}

export interface GrandHallT554NativeReviewSessionDependenciesV1 {
  readonly newNonce: () => string;
  readonly reserveSessionJournalRoot: (root: string) => Promise<string>;
  readonly openSourceEpoch: (input: {
    readonly sourceRoot: string;
    readonly bindings: GrandHallT554NativeSourceEpochBindingsV1;
  }) => Promise<SessionSourceEpoch>;
  readonly createJournal: (input: {
    readonly root: string;
    readonly leafName: string;
    readonly scope: GrandHallT554NativeReviewJournalScope;
  }) => Promise<SessionJournal>;
  readonly createMaskStore: (config: GrandHallT554NativeMaskStoreConfig) => SessionMaskStore;
  readonly createCoverage: (
    options: GrandHallT554NativeReviewCoverageControllerOptions,
  ) => SessionCoverage;
}

interface ActiveSource {
  readonly registrySource: GrandHallT554NativeReviewRegistrySource;
  readonly epoch: SessionSourceEpoch;
  readonly sourceEpochNonce: string;
  readonly sourceEpochNonceSha256: `sha256:${string}`;
  readonly sourceRenderGeneration: number;
  renderGeneration: number;
  phase: GrandHallT554NativeReviewSessionPhaseV1;
  readonly sourceCoverage: SessionCoverage;
  readonly sourceJournal: SessionJournal;
  sourceJournalRevision: number;
  readonly maskStore: SessionMaskStore;
  maskCoverage: SessionCoverage | undefined;
  maskJournal: SessionJournal | undefined;
  maskJournalRevision: number;
  readonly pendingTileDestroys: Set<() => void>;
  failed: boolean;
}

class SerialMutationLane {
  private tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

function sha256(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sourceEpochBindingSha256(
  bindings: GrandHallT554NativeSourceEpochBindingsV1,
  sourceVerification: GrandHallT554NativeSourceEpochSnapshotV1["sourceVerification"],
): `sha256:${string}` {
  const canonical = CanonicalJsonValueSchema.parse({ bindings, sourceVerification });
  return sha256(Buffer.from(
    `VENVIEWER_GRAND_HALL_T554_NATIVE_SOURCE_EPOCH_BINDING_V1\n${stableCanonicalJson(canonical)}`,
    "utf8",
  ));
}

function canonicalValuesEqual(left: unknown, right: unknown): boolean {
  return stableCanonicalJson(CanonicalJsonValueSchema.parse(left)) ===
    stableCanonicalJson(CanonicalJsonValueSchema.parse(right));
}

function comparablePath(path: string): string {
  const absolute = resolve(path);
  return process.platform === "win32"
    ? absolute.replaceAll("/", "\\").toLowerCase()
    : absolute;
}

function sameNode(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

function sameDirectoryState(left: BigIntStats, right: BigIntStats): boolean {
  return sameNode(left, right) &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs;
}

function errnoCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error &&
      typeof error.code === "string"
    ? error.code
    : undefined;
}

async function syncDirectory(absolutePath: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(absolutePath, "r");
    await handle.sync();
  } catch (error) {
    const code = errnoCode(error);
    const unsupported = code === "ENOTSUP" || process.platform === "win32" &&
      (code === "EACCES" || code === "EBADF" || code === "EINVAL" ||
        code === "EISDIR" || code === "EPERM");
    if (!unsupported) throw error;
  } finally {
    await handle?.close();
  }
}

async function reserveEmptySessionJournalRoot(root: string): Promise<string> {
  const reservationName = "native-review-session-reserved-v1";
  const reservationPath = join(root, reservationName);
  try {
    const before = await lstat(root, { bigint: true });
    const canonical = await realpath(root);
    const inventory = await readdir(root, { withFileTypes: true });
    const afterInventory = await lstat(root, { bigint: true });
    if (
      !before.isDirectory() || before.isSymbolicLink() ||
      comparablePath(canonical) !== comparablePath(root) ||
      !sameDirectoryState(before, afterInventory)
    ) {
      throw new GrandHallT554NativeReviewSessionError(
        "ARGUMENT_INVALID",
        "The native-review journal parent is aliased, unstable, or not a direct directory.",
      );
    }
    if (inventory.length !== 0) {
      throw new GrandHallT554NativeReviewSessionError(
        "CRASH_RECOVERY_REQUIRED",
        "The native-review journal parent is not empty. Reuse is forbidden until deterministic crash replay/import exists; retain the prior evidence and choose a new empty root.",
      );
    }
    await mkdir(reservationPath);
    await syncDirectory(root);
    const rootAfter = await lstat(root, { bigint: true });
    const reservation = await lstat(reservationPath, { bigint: true });
    const reservationCanonical = await realpath(reservationPath);
    const afterNames = await readdir(root);
    if (
      !sameNode(before, rootAfter) ||
      afterNames.length !== 1 || afterNames[0] !== reservationName ||
      !reservation.isDirectory() || reservation.isSymbolicLink() ||
      comparablePath(reservationCanonical) !== comparablePath(reservationPath)
    ) {
      throw new GrandHallT554NativeReviewSessionError(
        "CRASH_RECOVERY_REQUIRED",
        "The native-review journal reservation raced or drifted; retain the root for investigation and do not reuse it.",
      );
    }
    return reservationPath;
  } catch (error) {
    if (error instanceof GrandHallT554NativeReviewSessionError) throw error;
    if (errnoCode(error) === "EEXIST") {
      throw new GrandHallT554NativeReviewSessionError(
        "CRASH_RECOVERY_REQUIRED",
        "The native-review journal root was already reserved. Reuse is forbidden until deterministic crash replay/import exists.",
        error,
      );
    }
    throw new GrandHallT554NativeReviewSessionError(
      "ARGUMENT_INVALID",
      "The empty native-review journal root could not be reserved safely.",
      error,
    );
  }
}

function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new GrandHallT554NativeReviewSessionError(
      "ARGUMENT_INVALID",
      parsed.error.issues.map((issue) => issue.message).join("; "),
    );
  }
  return parsed.data;
}

function requireAbsoluteRoot(value: string, label: string): string {
  if (typeof value !== "string" || !isAbsolute(value) || value.includes("\0")) {
    throw new GrandHallT554NativeReviewSessionError(
      "ARGUMENT_INVALID",
      `${label} must be one absolute server-owned path.`,
    );
  }
  return resolve(value);
}

function artifactBindingFromRegistry(
  summary: GrandHallT554NativeReviewRegistrySummary,
  kind: "reviewPack" | "publicationReceipt",
): GrandHallT554NativeReviewArtifactBindingV1 {
  return kind === "reviewPack"
    ? {
        semanticSha256: summary.reviewPackSha256,
        fileSha256: summary.reviewPackFileSha256,
        byteLength: summary.reviewPackFileByteLength,
      }
    : {
        semanticSha256: summary.publicationReceiptSha256,
        fileSha256: summary.publicationReceiptFileSha256,
        byteLength: summary.publicationReceiptFileByteLength,
      };
}

function journalLeafName(
  kind: "source" | "mask",
  inventoryIndex: number,
  revision: number,
  renderGeneration: number,
  subjectSha256: string,
): string {
  return [
    kind,
    String(inventoryIndex).padStart(3, "0"),
    String(revision).padStart(4, "0"),
    `generation-${String(renderGeneration)}`,
    subjectSha256.replace("sha256:", "sha256-"),
  ].join("-");
}

function coverageSummary(coverage: SessionCoverage | undefined): {
  readonly completedTileCount: number;
  readonly complete: boolean;
} | null {
  if (coverage === undefined) return null;
  const snapshot = coverage.snapshot();
  return {
    completedTileCount: snapshot.completedTileCount,
    complete: snapshot.complete,
  };
}

function maskTile(store: SessionMaskStore, column: number, row: number): Buffer {
  const result = Buffer.allocUnsafe(
    GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX * GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX,
  );
  const left = column * GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX;
  const top = row * GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX;
  try {
    let offset = 0;
    for (let y = top; y < top + GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX; y += 1) {
      for (let x = left; x < left + GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX; x += 1) {
        result[offset] = store.pixelForServerRender(x, y).value;
        offset += 1;
      }
    }
    return result;
  } catch (error) {
    result.fill(0);
    throw error;
  }
}

class GrandHallT554NativeReviewSessionControllerV1 {
  private readonly lane = new SerialMutationLane();
  private sessionNonceBytes: Buffer | undefined;
  private readonly sessionNonceSha256: `sha256:${string}`;
  private readonly registrySummary: GrandHallT554NativeReviewRegistrySummary;
  private readonly journalWorkspaceRoot: string;
  private readonly maskPublicationDirectory: string;
  private active: ActiveSource | undefined;
  private workspaceRevision = 0;
  private nextGenerationValue = 1;
  private lifecycle: "active" | "poisoned" | "stopped" = "active";

  constructor(
    private readonly registry: GrandHallT554NativeReviewSessionRegistryV1,
    private readonly implementation: GrandHallT554NativeReviewArtifactBindingV1,
    roots: {
      readonly journalWorkspaceRoot: string;
      readonly maskPublicationDirectory: string;
    },
    sessionNonce: string,
    private readonly dependencies: GrandHallT554NativeReviewSessionDependenciesV1,
  ) {
    const parsedSummary = FixedPendingRegistrySummarySchema.safeParse(registry.summary);
    if (!parsedSummary.success) {
      throw new GrandHallT554NativeReviewSessionError(
        "ARGUMENT_INVALID",
        "Native review requires the exact authority-none, human-pending 148-source registry.",
      );
    }
    this.registrySummary = parsedSummary.data;
    this.implementation = parseInput(ArtifactBindingSchema, implementation);
    this.journalWorkspaceRoot = requireAbsoluteRoot(
      roots.journalWorkspaceRoot,
      "Native-review journal workspace root",
    );
    this.maskPublicationDirectory = requireAbsoluteRoot(
      roots.maskPublicationDirectory,
      "Native-review mask publication directory",
    );
    this.sessionNonceBytes = Buffer.from(sessionNonce, "base64url");
    this.sessionNonceSha256 = sha256(Buffer.from(sessionNonce, "utf8"));
  }

  snapshot(): Promise<GrandHallT554NativeReviewSessionPublicSnapshotV1> {
    return this.lane.run(() => this.publicSnapshot());
  }

  selectSource(input: unknown): Promise<GrandHallT554NativeReviewSessionPublicSnapshotV1> {
    return this.lane.run(async () => {
      const request = parseInput(SelectSourceSchema, input);
      this.assertSession(request.sessionNonce);
      this.assertWorkspaceRevision(request.expectedWorkspaceRevision);
      const source = structuredClone(this.registry.sourceAt(request.inventoryIndex));
      const media = this.registry.mediaInputAt(request.inventoryIndex);
      if (
        source.source.inventoryIndex !== request.inventoryIndex ||
        media.fileName !== source.source.fileName ||
        media.expectedSha256 !== source.source.sha256 ||
        media.expectedByteLength !== source.source.byteLength
      ) {
        throw new GrandHallT554NativeReviewSessionError(
          "RESOURCE_FAILURE",
          "The fixed registry source and media binding disagree.",
        );
      }
      const sourceEpochNonce = parseInput(NonceSchema, this.dependencies.newNonce());
      const renderGeneration = this.nextGeneration();
      const bindings: GrandHallT554NativeSourceEpochBindingsV1 = {
        schemaVersion: "venviewer.grand-hall-t554-native-source-epoch-bindings.v1",
        sourceEpochNonce,
        renderGeneration,
        reviewPack: artifactBindingFromRegistry(this.registrySummary, "reviewPack"),
        publicationReceipt: artifactBindingFromRegistry(
          this.registrySummary,
          "publicationReceipt",
        ),
        workbenchImplementationManifest: this.implementation,
        source: source.source,
      };
      await this.destroyActiveSourceOrPoison();
      let epoch: SessionSourceEpoch;
      try {
        epoch = await this.dependencies.openSourceEpoch({
          sourceRoot: media.sourceRoot,
          bindings,
        });
      } catch (error) {
        this.poisonSession();
        throw new GrandHallT554NativeReviewSessionError(
          "RESOURCE_FAILURE",
          "The exact source epoch could not be opened; this session is terminally poisoned.",
          error,
        );
      }
      let maskStore: SessionMaskStore | undefined;
      let active: ActiveSource | undefined;
      try {
        const epochSnapshot = this.assertOpenedEpoch(epoch.snapshot(), bindings);
        maskStore = this.dependencies.createMaskStore({
          source: source.source,
          publicationDirectory: this.maskPublicationDirectory,
        });
        const sessionNonce = this.currentSessionNonce();
        const sourceCoverage = this.dependencies.createCoverage({
          sessionNonce,
          sourceEpochNonce,
          subjectSha256: epochSnapshot.epochBindingSha256,
          renderGeneration,
        });
        const sourceJournal = await this.dependencies.createJournal({
          root: this.journalWorkspaceRoot,
          leafName: journalLeafName(
            "source",
            request.inventoryIndex,
            0,
            renderGeneration,
            epochSnapshot.epochBindingSha256,
          ),
          scope: {
            sessionNonceSha256: this.sessionNonceSha256,
            sourceEpochSha256: epochSnapshot.sourceEpochNonceSha256,
            subjectSha256: epochSnapshot.epochBindingSha256,
            kind: "source",
            implementationSha256: this.implementation.semanticSha256 as `sha256:${string}`,
          },
        });
        active = {
          registrySource: source,
          epoch,
          sourceEpochNonce,
          sourceEpochNonceSha256: epochSnapshot.sourceEpochNonceSha256,
          sourceRenderGeneration: renderGeneration,
          renderGeneration,
          phase: "source_review",
          sourceCoverage,
          sourceJournal,
          sourceJournalRevision: 0,
          maskStore,
          maskCoverage: undefined,
          maskJournal: undefined,
          maskJournalRevision: 0,
          pendingTileDestroys: new Set(),
          failed: false,
        };
        this.active = active;
        const opened = await this.appendEvent(
          active,
          sourceJournal,
          0,
          "source.review-started",
          { sourceEpoch: epochSnapshot },
        );
        active.sourceJournalRevision = opened.revision;
        this.workspaceRevision += 1;
        return this.publicSnapshot();
      } catch (error) {
        if (active !== undefined) {
          if (this.active === active) {
            const cause = await this.destroyAfterFailure(active, error);
            throw new GrandHallT554NativeReviewSessionError(
              "RESOURCE_FAILURE",
              "The source-review opening ledger failed closed.",
              cause,
            );
          }
          throw error;
        }
        let cleanupError: unknown;
        try {
          maskStore?.abandon();
        } catch (failure) {
          cleanupError = failure;
        }
        try {
          await epoch.abandon();
        } catch (failure) {
          cleanupError ??= failure;
        }
        this.poisonSession();
        if (cleanupError !== undefined) {
          throw new GrandHallT554NativeReviewSessionError(
            "RESOURCE_CLEANUP_FAILED",
            "A failed source opening could not prove complete custody destruction.",
            { openingError: error, cleanupError },
          );
        }
        throw error;
      }
    });
  }

  beginIncludeMask(input: unknown): Promise<GrandHallT554NativeReviewSessionPublicSnapshotV1> {
    return this.lane.run(async () => {
      const request = parseInput(SessionMutationBindingSchema, input);
      this.assertSession(request.sessionNonce);
      this.assertWorkspaceRevision(request.expectedWorkspaceRevision);
      const active = this.assertBoundActive(request);
      if (active.phase !== "source_review") {
        throw new GrandHallT554NativeReviewSessionError(
          "PHASE_INVALID",
          "The INCLUDE mask workflow can begin only from source review.",
        );
      }
      const nextRenderGeneration = this.nextGeneration();
      await this.appendSourceEvent(active, "include-mask.started", {
        inventoryIndex: active.registrySource.source.inventoryIndex,
        maskRevision: active.maskStore.snapshot().revision,
        renderGeneration: nextRenderGeneration,
      });
      active.phase = "include_mask_edit";
      active.renderGeneration = nextRenderGeneration;
      this.workspaceRevision += 1;
      return this.publicSnapshot();
    });
  }

  applyMaskEdit(input: unknown): Promise<GrandHallT554NativeReviewSessionPublicSnapshotV1> {
    return this.lane.run(async () => {
      const request = parseInput(MaskEditSchema, input);
      this.assertSession(request.sessionNonce);
      this.assertWorkspaceRevision(request.expectedWorkspaceRevision);
      const active = this.assertBoundActive(request);
      if (active.phase !== "include_mask_edit" && active.phase !== "include_mask_review") {
        throw new GrandHallT554NativeReviewSessionError(
          "PHASE_INVALID",
          "Mask edits require an active INCLUDE mask workflow.",
        );
      }
      try {
        const edit = request.operation === "exclude"
          ? {
              expectedRevision: request.expectedMaskRevision,
              operation: request.operation,
              reasonCode: request.reasonCode,
              primitive: request.primitive,
            }
          : {
              expectedRevision: request.expectedMaskRevision,
              operation: request.operation,
              primitive: request.primitive,
            };
        const updated = active.maskStore.applyEdit(edit);
        active.maskCoverage = undefined;
        active.maskJournal = undefined;
        active.maskJournalRevision = 0;
        active.phase = "include_mask_edit";
        active.renderGeneration = this.nextGeneration();
        await this.appendSourceEvent(active, "include-mask.edited", {
          edit,
          resultingMaskRevision: updated.revision,
          frozenBindingInvalidated: true,
          renderGeneration: active.renderGeneration,
        });
        this.workspaceRevision += 1;
        return this.publicSnapshot();
      } catch (error) {
        if (error instanceof GrandHallT554NativeReviewSessionError) throw error;
        const cause = await this.destroyAfterFailure(active, error);
        throw new GrandHallT554NativeReviewSessionError(
          "RESOURCE_FAILURE",
          "The server-owned mask edit failed closed.",
          cause,
        );
      }
    });
  }

  freezeMask(input: unknown): Promise<GrandHallT554NativeReviewSessionPublicSnapshotV1> {
    return this.lane.run(async () => {
      const request = parseInput(FreezeMaskSchema, input);
      this.assertSession(request.sessionNonce);
      this.assertWorkspaceRevision(request.expectedWorkspaceRevision);
      const active = this.assertBoundActive(request);
      if (active.phase !== "include_mask_edit") {
        throw new GrandHallT554NativeReviewSessionError(
          "PHASE_INVALID",
          "Only an edited INCLUDE mask can enter frozen-mask review.",
        );
      }
      try {
        const frozen = await active.maskStore.freeze({
          expectedRevision: request.expectedMaskRevision,
        });
        const renderGeneration = this.nextGeneration();
        const coverage = this.dependencies.createCoverage({
          sessionNonce: this.currentSessionNonce(),
          sourceEpochNonce: active.sourceEpochNonce,
          subjectSha256: frozen.sha256,
          renderGeneration,
        });
        const journal = await this.dependencies.createJournal({
          root: this.journalWorkspaceRoot,
          leafName: journalLeafName(
            "mask",
            active.registrySource.source.inventoryIndex,
            frozen.revision,
            renderGeneration,
            frozen.sha256,
          ),
          scope: {
            sessionNonceSha256: this.sessionNonceSha256,
            sourceEpochSha256: active.sourceEpochNonceSha256,
            subjectSha256: frozen.sha256,
            kind: "mask",
            implementationSha256: this.implementation.semanticSha256 as `sha256:${string}`,
          },
        });
        const replay = await this.appendEvent(
          active,
          journal,
          0,
          "include-mask.review-started",
          {
            frozenBinding: frozen,
            renderGeneration,
          },
        );
        active.maskCoverage = coverage;
        active.maskJournal = journal;
        active.maskJournalRevision = replay.revision;
        active.phase = "include_mask_review";
        active.renderGeneration = renderGeneration;
        this.workspaceRevision += 1;
        return this.publicSnapshot();
      } catch (error) {
        if (error instanceof GrandHallT554NativeReviewSessionError) throw error;
        const cause = await this.destroyAfterFailure(active, error);
        throw new GrandHallT554NativeReviewSessionError(
          "RESOURCE_FAILURE",
          "The frozen mask or its review ledger failed closed.",
          cause,
        );
      }
    });
  }

  serveTile(input: unknown): Promise<GrandHallT554NativeReviewTileV1> {
    return this.lane.run(async () => {
      const request = parseInput(TileRequestSchema, input);
      const active = this.assertBoundActive(request);
      let sourceRgb8: Buffer | undefined;
      let mask8: Buffer | undefined;
      try {
        sourceRgb8 = active.epoch.copyTile({
          sourceEpochNonce: active.sourceEpochNonce,
          renderGeneration: active.sourceRenderGeneration,
          column: request.column,
          row: request.row,
        });
        if (active.phase === "source_review") {
          const delivery = this.deliveryResolution(
            active,
            request.column,
            request.row,
            active.phase,
            active.renderGeneration,
            [sourceRgb8],
          );
          return {
            schemaVersion: "venviewer.grand-hall-t554-native-review-tile.v1",
            renderMode: "source_rgb8",
            widthPx: GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX,
            heightPx: GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX,
            sourceRgb8,
            mask8: null,
            commitDeliveryAfterSuccessfulSend: delivery.commit,
            discardAfterFailedSend: delivery.discard,
          };
        }
        mask8 = maskTile(active.maskStore, request.column, request.row);
        const delivery = this.deliveryResolution(
          active,
          request.column,
          request.row,
          active.phase,
          active.renderGeneration,
          [sourceRgb8, mask8],
        );
        return {
          schemaVersion: "venviewer.grand-hall-t554-native-review-tile.v1",
          renderMode: "source_rgb8_with_mask8",
          widthPx: GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX,
          heightPx: GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX,
          sourceRgb8,
          mask8,
          commitDeliveryAfterSuccessfulSend: delivery.commit,
          discardAfterFailedSend: delivery.discard,
        };
      } catch (error) {
        sourceRgb8?.fill(0);
        mask8?.fill(0);
        if (error instanceof GrandHallT554NativeReviewSessionError) throw error;
        const cause = await this.destroyAfterFailure(active, error);
        throw new GrandHallT554NativeReviewSessionError(
          "RESOURCE_FAILURE",
          "The active native tile could not be served safely.",
          cause,
        );
      }
    });
  }

  recordCoverage(
    input: unknown,
  ): Promise<GrandHallT554NativeReviewCoverageAcknowledgementV1> {
    return this.lane.run(async () => {
      const telemetry = parseInput(BrowserCoverageTelemetrySchema, input);
      const active = this.assertBoundActive(telemetry);
      const target = active.phase === "source_review"
        ? { coverage: active.sourceCoverage, journal: active.sourceJournal,
            revision: active.sourceJournalRevision, eventType: "source.coverage" }
        : active.phase === "include_mask_review" && active.maskCoverage !== undefined &&
            active.maskJournal !== undefined
          ? { coverage: active.maskCoverage, journal: active.maskJournal,
              revision: active.maskJournalRevision, eventType: "include-mask.coverage" }
          : undefined;
      if (target === undefined) {
        throw new GrandHallT554NativeReviewSessionError(
          "PHASE_INVALID",
          "Coverage is accepted only for source review or a frozen INCLUDE mask.",
        );
      }
      const subjectSha256 = target.coverage.snapshot().subjectSha256;
      const event = target.coverage.recordTelemetry({
        ...telemetry,
        subjectSha256,
      });
      const replay = await this.appendEvent(
        active,
        target.journal,
        target.revision,
        target.eventType,
        event,
      );
      if (active.phase === "source_review") {
        active.sourceJournalRevision = replay.revision;
      } else {
        active.maskJournalRevision = replay.revision;
      }
      const snapshot = target.coverage.snapshot();
      return {
        schemaVersion: "venviewer.grand-hall-t554-native-review-coverage-ack.v1",
        sequence: event.sequence,
        journalRevision: replay.revision,
        completedTileCount: snapshot.completedTileCount,
        complete: snapshot.complete,
      };
    });
  }

  abandonActiveSource(input: unknown): Promise<GrandHallT554NativeReviewSessionPublicSnapshotV1> {
    return this.lane.run(async () => {
      const request = parseInput(z.object({
        sessionNonce: NonceSchema,
        expectedWorkspaceRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      }).strict(), input);
      this.assertSession(request.sessionNonce);
      this.assertWorkspaceRevision(request.expectedWorkspaceRevision);
      if (this.active === undefined) {
        throw new GrandHallT554NativeReviewSessionError(
          "NO_ACTIVE_SOURCE",
          "There is no active source to abandon.",
        );
      }
      await this.destroyActiveSourceOrPoison();
      this.workspaceRevision += 1;
      return this.publicSnapshot();
    });
  }

  stop(input: unknown): Promise<GrandHallT554NativeReviewSessionPublicSnapshotV1> {
    return this.lane.run(async () => {
      const request = parseInput(z.object({
        sessionNonce: NonceSchema,
        expectedWorkspaceRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      }).strict(), input);
      this.assertStopSession(request.sessionNonce);
      this.assertWorkspaceRevision(request.expectedWorkspaceRevision);
      await this.destroyActiveSourceOrPoison();
      this.lifecycle = "stopped";
      this.destroySessionNonce();
      this.workspaceRevision += 1;
      return this.publicSnapshot();
    });
  }

  private publicSnapshot(): GrandHallT554NativeReviewSessionPublicSnapshotV1 {
    const active = this.active;
    const sourceCoverage = active?.sourceCoverage.snapshot();
    const maskSnapshot = active?.maskStore.snapshot();
    return structuredClone({
      schemaVersion: "venviewer.grand-hall-t554-native-review-session-public.v1" as const,
      lifecycle: this.lifecycle,
      sessionNonce: this.lifecycle === "active" ? this.currentSessionNonce() : null,
      workspaceRevision: this.workspaceRevision,
      registry: this.registrySummary,
      workbenchImplementationManifest: this.implementation,
      authority: "none" as const,
      reviewState: "human_pending" as const,
      finalDecision: "PENDING" as const,
      acceptanceAuthorized: false as const,
      reconstructionAuthorized: false as const,
      runtimeAuthorized: false as const,
      exportAuthorized: false as const,
      generatedContentAuthorized: false as const,
      crashRecovery: {
        resumeSupported: false as const,
        priorJournalRootReuseAllowed: false as const,
        releaseState: "blocked_pending_deterministic_replay_import" as const,
      },
      implementationManifestVerification: {
        concreteBytesVerified: false as const,
        productionFactoryAvailable: false as const,
        releaseState: "blocked_pending_manifest_byte_verifier" as const,
      },
      activeSource: active === undefined || sourceCoverage === undefined || maskSnapshot === undefined
        ? null
        : {
            inventoryIndex: active.registrySource.source.inventoryIndex,
            sweepNumber: active.registrySource.source.sweepNumber,
            sourceEpochNonce: active.sourceEpochNonce,
            renderGeneration: active.renderGeneration,
            phase: active.phase,
            tileGrid: {
              widthPx: GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX,
              heightPx: GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX,
              columnCount: GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT,
              rowCount: GRAND_HALL_T554_NATIVE_TILE_ROW_COUNT,
            },
            sourceCoverage: {
              completedTileCount: sourceCoverage.completedTileCount,
              complete: sourceCoverage.complete,
            },
            mask: {
              revision: maskSnapshot.revision,
              frozen: maskSnapshot.activeFrozenBinding !== null,
              coverage: coverageSummary(active.maskCoverage),
            },
            failed: active.failed,
          },
    });
  }

  private assertSession(sessionNonce: string): void {
    if (this.lifecycle === "stopped") {
      throw new GrandHallT554NativeReviewSessionError(
        "SESSION_STOPPED",
        "The native-review session has been stopped.",
      );
    }
    if (this.lifecycle === "poisoned") {
      throw new GrandHallT554NativeReviewSessionError(
        "SESSION_POISONED",
        "The native-review session encountered ambiguous state and cannot accept further mutations.",
      );
    }
    if (sessionNonce !== this.currentSessionNonce()) {
      throw new GrandHallT554NativeReviewSessionError(
        "SOURCE_STALE",
        "The request is not bound to this native-review session.",
      );
    }
  }

  private assertStopSession(sessionNonce: string): void {
    if (this.lifecycle === "stopped") {
      throw new GrandHallT554NativeReviewSessionError(
        "SESSION_STOPPED",
        "The native-review session has been stopped.",
      );
    }
    if (sha256(Buffer.from(sessionNonce, "utf8")) !== this.sessionNonceSha256) {
      throw new GrandHallT554NativeReviewSessionError(
        "SOURCE_STALE",
        "The stop request is not bound to this native-review session.",
      );
    }
  }

  private currentSessionNonce(): string {
    const bytes = this.sessionNonceBytes;
    if (bytes === undefined || this.lifecycle !== "active") {
      throw new GrandHallT554NativeReviewSessionError(
        this.lifecycle === "stopped" ? "SESSION_STOPPED" : "SESSION_POISONED",
        "The native-review session token is no longer available.",
      );
    }
    return bytes.toString("base64url");
  }

  private destroySessionNonce(): void {
    this.sessionNonceBytes?.fill(0);
    this.sessionNonceBytes = undefined;
  }

  private poisonSession(): void {
    if (this.lifecycle !== "active") return;
    this.lifecycle = "poisoned";
    this.workspaceRevision += 1;
    this.destroySessionNonce();
  }

  private assertWorkspaceRevision(expectedRevision: number): void {
    if (expectedRevision !== this.workspaceRevision) {
      throw new GrandHallT554NativeReviewSessionError(
        "WORKSPACE_REVISION_CONFLICT",
        "The workspace compare-and-swap revision is stale.",
      );
    }
  }

  private assertBoundActive(request: {
    readonly sessionNonce: string;
    readonly sourceEpochNonce: string;
    readonly renderGeneration: number;
  }): ActiveSource {
    this.assertSession(request.sessionNonce);
    const active = this.active;
    if (active === undefined) {
      throw new GrandHallT554NativeReviewSessionError(
        "NO_ACTIVE_SOURCE",
        "No native source is active.",
      );
    }
    if (active.failed) {
      throw new GrandHallT554NativeReviewSessionError(
        "ACTIVE_SOURCE_FAILED",
        "The active source failed closed and must be abandoned.",
      );
    }
    if (
      request.sourceEpochNonce !== active.sourceEpochNonce ||
      request.renderGeneration !== active.renderGeneration
    ) {
      throw new GrandHallT554NativeReviewSessionError(
        "SOURCE_STALE",
        "The request source epoch or render generation is stale.",
      );
    }
    return active;
  }

  private assertOpenedEpoch(
    snapshot: unknown,
    bindings: GrandHallT554NativeSourceEpochBindingsV1,
  ): GrandHallT554NativeSourceEpochSnapshotV1 {
    const parsed = SourceEpochSnapshotEvidenceSchema.safeParse(snapshot);
    if (!parsed.success) {
      throw new GrandHallT554NativeReviewSessionError(
        "RESOURCE_FAILURE",
        "The opened source epoch did not provide the exact source/decode custody evidence.",
        parsed.error,
      );
    }
    const evidence = parsed.data;
    const verification = evidence.sourceVerification;
    if (
      evidence.sourceEpochNonce !== bindings.sourceEpochNonce ||
      evidence.sourceEpochNonceSha256 !== sha256(Buffer.from(bindings.sourceEpochNonce, "utf8")) ||
      evidence.renderGeneration !== bindings.renderGeneration ||
      !canonicalValuesEqual(evidence.reviewPack, bindings.reviewPack) ||
      !canonicalValuesEqual(evidence.publicationReceipt, bindings.publicationReceipt) ||
      !canonicalValuesEqual(
        evidence.workbenchImplementationManifest,
        bindings.workbenchImplementationManifest,
      ) ||
      !canonicalValuesEqual(evidence.source, bindings.source) ||
      verification.fileName !== bindings.source.fileName ||
      verification.sha256 !== bindings.source.sha256 ||
      verification.byteLength !== bindings.source.byteLength ||
      evidence.epochBindingSha256 !== sourceEpochBindingSha256(bindings, verification)
    ) {
      throw new GrandHallT554NativeReviewSessionError(
        "RESOURCE_FAILURE",
        "The opened source epoch does not match its fixed registry binding.",
      );
    }
    return evidence;
  }

  private nextGeneration(): number {
    if (!Number.isSafeInteger(this.nextGenerationValue)) {
      throw new GrandHallT554NativeReviewSessionError(
        "RESOURCE_FAILURE",
        "The render-generation bound was exhausted.",
      );
    }
    const generation = this.nextGenerationValue;
    this.nextGenerationValue += 1;
    return generation;
  }

  private async appendSourceEvent(
    active: ActiveSource,
    eventType: string,
    payload: unknown,
  ): Promise<void> {
    const replay = await this.appendEvent(
      active,
      active.sourceJournal,
      active.sourceJournalRevision,
      eventType,
      payload,
    );
    active.sourceJournalRevision = replay.revision;
  }

  private deliveryResolution(
    capturedActive: ActiveSource,
    column: number,
    row: number,
    capturedPhase: GrandHallT554NativeReviewSessionPhaseV1,
    capturedRenderGeneration: number,
    buffers: readonly Buffer[],
  ): {
    readonly commit: () => Promise<void>;
    readonly discard: () => Promise<void>;
  } {
    let resolved = false;
    let destroyed = false;
    const forceDestroy = (): void => {
      if (destroyed) return;
      let firstError: unknown;
      for (const buffer of buffers) {
        try {
          buffer.fill(0);
        } catch (error) {
          firstError ??= error;
        }
      }
      destroyed = true;
      capturedActive.pendingTileDestroys.delete(forceDestroy);
      if (firstError !== undefined) {
        throw new GrandHallT554NativeReviewSessionError(
          "RESOURCE_CLEANUP_FAILED",
          "At least one prepared tile buffer could not be zeroed.",
          firstError,
        );
      }
    };
    const commit = (): Promise<void> => {
      if (resolved) {
        return Promise.reject(new GrandHallT554NativeReviewSessionError(
          "DELIVERY_ALREADY_RESOLVED",
          "This prepared tile delivery was already resolved.",
        ));
      }
      resolved = true;
      return this.lane.run(async () => {
        let operationError: Error | undefined;
        try {
          const active = this.active;
          if (
            active === undefined || active !== capturedActive || active.failed ||
            active.phase !== capturedPhase ||
            active.renderGeneration !== capturedRenderGeneration
          ) {
            throw new GrandHallT554NativeReviewSessionError(
              "SOURCE_STALE",
              "The successfully sent tile no longer belongs to the active review generation.",
            );
          }
          try {
            if (capturedPhase === "source_review") {
              active.sourceCoverage.recordDeliveredTile(column, row);
            } else if (capturedPhase === "include_mask_review") {
              if (active.maskCoverage === undefined) {
                throw new Error("Frozen-mask delivery coverage is unavailable.");
              }
              active.maskCoverage.recordDeliveredTile(column, row);
            }
          } catch (error) {
            const cause = await this.destroyAfterFailure(active, error);
            throw new GrandHallT554NativeReviewSessionError(
              "RESOURCE_FAILURE",
              "The successfully sent tile could not be committed to server delivery state.",
              cause,
            );
          }
        } catch (error) {
          operationError = error instanceof Error
            ? error
            : new Error("Prepared tile delivery failed with a non-Error cause.", { cause: error });
        }
        try {
          forceDestroy();
        } catch (error) {
          const cause = this.active === capturedActive
            ? await this.destroyAfterFailure(capturedActive, error)
            : error;
          throw new GrandHallT554NativeReviewSessionError(
            "RESOURCE_CLEANUP_FAILED",
            "A prepared tile buffer could not prove complete destruction.",
            cause,
          );
        }
        if (operationError !== undefined) throw operationError;
      });
    };
    const discard = (): Promise<void> => {
      if (resolved) {
        return Promise.reject(new GrandHallT554NativeReviewSessionError(
          "DELIVERY_ALREADY_RESOLVED",
          "This prepared tile delivery was already resolved.",
        ));
      }
      resolved = true;
      return this.lane.run(async () => {
        try {
          forceDestroy();
        } catch (error) {
          const cause = this.active === capturedActive
            ? await this.destroyAfterFailure(capturedActive, error)
            : error;
          throw new GrandHallT554NativeReviewSessionError(
            "RESOURCE_CLEANUP_FAILED",
            "An aborted prepared tile could not prove complete buffer destruction.",
            cause,
          );
        }
      });
    };
    capturedActive.pendingTileDestroys.add(forceDestroy);
    return { commit, discard };
  }

  private async appendEvent(
    active: ActiveSource,
    journal: SessionJournal,
    expectedRevision: number,
    eventType: string,
    payload: unknown,
  ): Promise<{ readonly revision: number }> {
    try {
      return await journal.append({
        expectedRevision,
        eventType,
        payload: toCanonicalJson(payload),
      });
    } catch (error) {
      const cause = await this.destroyAfterFailure(active, error);
      throw new GrandHallT554NativeReviewSessionError(
        "DURABILITY_FAILURE",
        "The native-review mutation was not acknowledged; its journal append failed and active custody was abandoned.",
        cause,
      );
    }
  }

  private async destroyAfterFailure(active: ActiveSource, error: unknown): Promise<unknown> {
    active.failed = true;
    this.poisonSession();
    try {
      await this.destroyActiveSource();
      return error;
    } catch (cleanupError) {
      return { operationError: error, cleanupError };
    }
  }

  private async destroyActiveSourceOrPoison(): Promise<void> {
    try {
      await this.destroyActiveSource();
    } catch (error) {
      this.poisonSession();
      throw error;
    }
  }

  private async destroyActiveSource(): Promise<void> {
    const active = this.active;
    if (active === undefined) return;
    this.active = undefined;
    let firstError: unknown;
    for (const destroy of active.pendingTileDestroys) {
      try {
        destroy();
      } catch (error) {
        firstError ??= error;
      }
    }
    active.pendingTileDestroys.clear();
    try {
      active.maskStore.abandon();
    } catch (error) {
      firstError ??= error;
    }
    try {
      await active.epoch.abandon();
    } catch (error) {
      firstError ??= error;
    }
    active.maskCoverage = undefined;
    active.maskJournal = undefined;
    if (firstError !== undefined) {
      throw new GrandHallT554NativeReviewSessionError(
        "RESOURCE_CLEANUP_FAILED",
        "The prior source could not prove complete custody destruction.",
        firstError,
      );
    }
  }
}

function createSession(
  options: GrandHallT554NativeReviewInjectedSessionOptionsV1,
  dependencies: GrandHallT554NativeReviewSessionDependenciesV1,
): Promise<GrandHallT554NativeReviewSessionControllerV1> {
  const requestedJournalRoot = requireAbsoluteRoot(
    options.journalWorkspaceRoot,
    "Native-review journal workspace root",
  );
  const sessionNonce = parseInput(NonceSchema, dependencies.newNonce());
  return dependencies.reserveSessionJournalRoot(requestedJournalRoot).then((reservedRoot) =>
    new GrandHallT554NativeReviewSessionControllerV1(
    options.registry,
    options.workbenchImplementationManifest,
    {
      journalWorkspaceRoot: reservedRoot,
      maskPublicationDirectory: options.maskPublicationDirectory,
    },
    sessionNonce,
    dependencies,
  ));
}

export const __testOnlyGrandHallT554NativeReviewSessionV1 = Object.freeze({
  createSession,
  reserveEmptySessionJournalRoot,
});
