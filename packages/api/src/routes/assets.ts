import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  AdminRoomsQuerySchema,
  ApprovedRoomRuntimeProfileSchema,
  AssetVersionSchema,
  CaptureControlSourceRecordQuerySchema,
  CaptureControlSourceRegistrationSchema,
  CaptureSessionSchema,
  CreateRuntimePackageRevisionInputSchema,
  LatestRuntimePackageQuerySchema,
  PublicRoomRuntimeVisualSchema,
  RegisterCaptureControlSourceRecordInputSchema,
  RegisterCaptureSessionInputSchema,
  RegisterAssetVersionInputSchema,
  RegisterRuntimeQaRecordInputSchema,
  RegisterRuntimeTransformArtifactInputSchema,
  RoomManifestQuerySchema,
  RoomManifestSchema,
  RoomAssetStatusSchema,
  RuntimeFileExtensionSchema,
  ReviewedRuntimeProfileIdSchema,
  RuntimePackageManifestJsonSchema,
  RuntimePackageRevisionCreateResponseSchema,
  RuntimeQaRecordQuerySchema,
  RuntimeQaRecordRegistrationSchema,
  RuntimeQaRecordV0Schema,
  RuntimePackageSchema,
  TransformArtifactV0Schema,
  RuntimeTransformArtifactQuerySchema,
  RuntimeTransformArtifactSchema,
  TRADES_HALL_RUNTIME_ROOMS,
  assetKindAllowsExtension,
  isForbiddenAssetFixtureKey,
  splatExtensionForKey,
  runtimeQaRecordAllowsPublicExposure,
  runtimeQaRecordSignedTransformArtifactId,
  runtimeQaRecordSignedTransformArtifactSha256,
  type AssetVersion,
  type ApprovedRoomRuntimeProfile,
  type CaptureControlSourceRegistration,
  type CaptureSession,
  type CaptureControlFreshnessStatus,
  type PublicRoomRuntimeVisual,
  type ReviewedRuntimeProfileId,
  type RuntimeQaRecordRegistration,
  type RegisterRuntimePackageInput,
  type ReviewedCaptureControlStatus,
  type ReviewedRuntimeQaStatus,
  type RoomRuntimeControlEvidenceChainStatus,
  type RoomManifest,
  type RoomAssetStatus,
  type RuntimePackage,
  type RuntimeTransformArtifact,
} from "@omnitwin/types";
import {
  assetDefinitions,
  assetVersions,
  captureControlSourceRecords,
  captureSessions,
  roomManifests,
  runtimePackages,
  runtimeQaRecords,
  runtimeTransformArtifacts,
} from "../db/schema.js";
import type { Database } from "../db/client.js";
import type { Env } from "../env.js";
import { runtimeAssetStorageKeySha256 } from "../lib/runtime-asset-receipt.js";
import {
  RuntimeProfileVerifiedByteCache,
} from "../lib/runtime-profile-verified-byte-cache.js";
import { runtimeTransformArtifactSha256 } from "../lib/runtime-transform-artifact-receipt.js";
import {
  isReceptionReviewedProfilePresentationCandidate,
  matchReceptionReviewedRuntimeProfile,
} from "../lib/reception-reviewed-runtime-profile.js";
import { authenticate, authorizePlatformAdmin } from "../middleware/auth.js";
import {
  RuntimePackageRevisionConflictError,
  RuntimePackageRevisionIntegrityError,
  createDatabaseRuntimePackageRevisionStore,
  createRuntimePackageRevision,
} from "../services/runtime-package-revisions.js";

// ---------------------------------------------------------------------------
// Asset routes
//
// Public:
//   GET /assets
//   GET /assets/runtime-packages/approved-profile?venue=trades-hall&room=reception-room
//   GET /assets/runtime-packages/public-room-visual?... (retired safe fallback only)
//   GET /assets/runtime-profiles/:profileId/members/:memberIndex/content.sog
//
// Platform-admin/internal:
//   GET /assets/runtime-packages/latest?venue=trades-hall&room=grand-hall
//   GET /assets/runtime-assets/:assetVersionId
//
// Admin:
//   POST /admin/assets/capture-session
//   POST /admin/assets/register-version
//   POST /admin/assets/runtime-package-revisions
//   POST /admin/assets/register-runtime-package (deprecated; always 410 after auth)
//   POST /admin/assets/register-runtime-transform-artifact
//   GET  /admin/assets/runtime-transform-artifacts?runtimePackageId=...
//   POST /admin/assets/register-runtime-qa-record
//   GET  /admin/assets/runtime-qa-records?runtimePackageId=...
//   POST /admin/assets/register-capture-control-source
//   GET  /admin/assets/capture-control-sources?venue=trades-hall
//   GET  /admin/assets/rooms?venue=trades-hall
//   GET  /admin/assets/room-manifests
// ---------------------------------------------------------------------------

export type AssetVersionRow = typeof assetVersions.$inferSelect;
export type CaptureSessionRow = typeof captureSessions.$inferSelect;
export type CaptureControlSourceRecordRow = typeof captureControlSourceRecords.$inferSelect;
export type RoomManifestRow = typeof roomManifests.$inferSelect;
export type RuntimePackageRow = typeof runtimePackages.$inferSelect;
export type RuntimeQaRecordRow = typeof runtimeQaRecords.$inferSelect;
export type RuntimeTransformArtifactRow = typeof runtimeTransformArtifacts.$inferSelect;

interface PublicReviewedProfileResolution {
  readonly pkg: RuntimePackageRow;
  readonly visualAssets: readonly AssetVersionRow[];
  readonly profileId: ReviewedRuntimeProfileId;
  readonly reviewedTransformArtifactSha256: string;
}

interface PublicRuntimeProfileMemberAuthorization {
  readonly profileId: ReviewedRuntimeProfileId;
  readonly runtimePackageId: string;
  readonly runtimePackageRevision: number;
  readonly runtimePackageContentDigest: string | null;
  readonly reviewedTransformArtifactSha256: string;
  readonly memberIndex: number;
  readonly assetVersionId: string;
  readonly r2Key: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly fileName: string;
  readonly fileExt: string;
}

class RuntimeProfileMemberIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeProfileMemberIntegrityError";
  }
}

class RuntimeProfileMemberUpstreamTimeoutError extends Error {
  constructor() {
    super("Runtime profile member storage timed out");
    this.name = "RuntimeProfileMemberUpstreamTimeoutError";
  }
}

const RuntimeAssetParamsSchema = z.object({
  assetVersionId: z.string().uuid(),
  fileName: z.string().min(1).max(255).optional(),
}).strict();
const RuntimeProfileMemberParamsSchema = z.object({
  profileId: ReviewedRuntimeProfileIdSchema,
  memberIndex: z.coerce.number().int().nonnegative().max(15),
  memberFileName: z.literal("content.sog"),
}).strict();
const HTTP_RANGE_HEADER_PATTERN = /^bytes=\d*-\d*$/u;
const MAX_PUBLIC_RUNTIME_PROFILE_MEMBER_BYTES = 16 * 1024 * 1024;
const MAX_CONCURRENT_PUBLIC_RUNTIME_PROFILE_TRANSFERS = 2;
const MAX_QUEUED_PUBLIC_RUNTIME_PROFILE_TRANSFERS = 16;
const PUBLIC_RUNTIME_PROFILE_QUEUE_TIMEOUT_MS = 300_000;
const PUBLIC_RUNTIME_PROFILE_UPSTREAM_TIMEOUT_MS = 30_000;
const PUBLIC_RUNTIME_PROFILE_TRANSFER_DEADLINE_MS = 180_000;
const PUBLIC_RUNTIME_PROFILE_ROUTE_RATE_LIMIT_PER_MINUTE = 24;
const PUBLIC_RUNTIME_PROFILE_VERIFIED_CACHE_BYTES = 64 * 1024 * 1024;
const PUBLIC_RUNTIME_PROFILE_VERIFIED_CACHE_ENTRIES = 16;
const PUBLIC_RUNTIME_PROFILE_VERIFIED_CACHE_TTL_MS = 5 * 60_000;

type S3ClientType = import("@aws-sdk/client-s3").S3Client;

const RECEPTION_ROOM_RUNTIME_PACKAGE_ID = "71687e9e-c23d-4f51-b3dd-a6a82c97978d";
const RECEPTION_ROOM_RUNTIME_CONTROL_EVIDENCE_CHAIN_REF =
  "docs/operations/reception-room-runtime-control-evidence-chain-status-2026-06-16.json";

interface RuntimeControlEvidenceChainDashboardSummary {
  readonly status: RoomRuntimeControlEvidenceChainStatus;
  readonly ref: string | null;
  readonly requiredCoordinatePairCount: number | null;
  readonly reviewedCoordinatePairCount: number | null;
  readonly safeCopy: string;
  readonly nextAction: string;
}

let cachedS3: S3ClientType | null = null;
let cachedRuntimeProfileS3: S3ClientType | null = null;
let activePublicRuntimeProfileTransfers = 0;
const queuedPublicRuntimeProfileTransfers: PublicRuntimeProfileTransferWaiter[] = [];
const publicRuntimeProfileVerifiedBytes = new RuntimeProfileVerifiedByteCache({
  maximumBytes: PUBLIC_RUNTIME_PROFILE_VERIFIED_CACHE_BYTES,
  maximumEntries: PUBLIC_RUNTIME_PROFILE_VERIFIED_CACHE_ENTRIES,
  ttlMilliseconds: PUBLIC_RUNTIME_PROFILE_VERIFIED_CACHE_TTL_MS,
});

interface PublicRuntimeProfileTransferWaiter {
  readonly activate: () => void;
}

interface PublicRuntimeProfileResponseLifecycle {
  readonly writableFinished: boolean;
  once(event: "finish" | "close", listener: () => void): unknown;
  off(event: "finish" | "close", listener: () => void): unknown;
  destroy(error?: Error): unknown;
}

function publicRuntimeProfileTransferRelease(): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = queuedPublicRuntimeProfileTransfers.shift();
    if (next !== undefined) {
      // Hand the same active slot to the oldest bounded waiter. The active
      // count deliberately stays unchanged until that request also finishes.
      next.activate();
      return;
    }
    activePublicRuntimeProfileTransfers -= 1;
  };
}

export function tryAcquirePublicRuntimeProfileTransfer(): (() => void) | null {
  if (activePublicRuntimeProfileTransfers >= MAX_CONCURRENT_PUBLIC_RUNTIME_PROFILE_TRANSFERS) {
    return null;
  }
  activePublicRuntimeProfileTransfers += 1;
  return publicRuntimeProfileTransferRelease();
}

/**
 * Wait for one of the two per-process response-buffer slots instead of making
 * the third and fourth members of a four-file profile fail with HTTP 429.
 * The queue is FIFO, bounded, abortable, and time-limited.
 */
export function acquirePublicRuntimeProfileTransfer(
  signal?: AbortSignal,
): Promise<(() => void) | null> {
  const immediate = tryAcquirePublicRuntimeProfileTransfer();
  if (immediate !== null) return Promise.resolve(immediate);
  if (
    signal?.aborted === true ||
    queuedPublicRuntimeProfileTransfers.length >= MAX_QUEUED_PUBLIC_RUNTIME_PROFILE_TRANSFERS
  ) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const removeFromQueue = (): void => {
      const index = queuedPublicRuntimeProfileTransfers.indexOf(waiter);
      if (index >= 0) queuedPublicRuntimeProfileTransfers.splice(index, 1);
    };
    const cleanup = (): void => {
      if (timeout !== null) clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
    };
    const cancel = (): void => {
      if (settled) return;
      settled = true;
      removeFromQueue();
      cleanup();
      resolve(null);
    };
    const waiter: PublicRuntimeProfileTransferWaiter = {
      activate: () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(publicRuntimeProfileTransferRelease());
      },
    };

    queuedPublicRuntimeProfileTransfers.push(waiter);
    timeout = setTimeout(cancel, PUBLIC_RUNTIME_PROFILE_QUEUE_TIMEOUT_MS);
    signal?.addEventListener("abort", cancel, { once: true });
    // AbortSignal does not replay an abort that happened just before listener
    // registration, so close the race explicitly after the waiter is ready.
    if (signal?.aborted === true) cancel();
  });
}

/**
 * Keep a verified response's memory slot until both the handler work and the
 * Node response are settled. On an early client close the upstream operation
 * is aborted first, but the slot is not reused until that work has unwound.
 */
export function bindPublicRuntimeProfileTransferToResponse(
  response: PublicRuntimeProfileResponseLifecycle,
  releaseTransfer: () => void,
  abortUpstream: () => void,
  deadlineMilliseconds = PUBLIC_RUNTIME_PROFILE_TRANSFER_DEADLINE_MS,
): () => void {
  let responseSettled = false;
  let workSettled = false;
  let released = false;
  let upstreamAborted = false;
  let deadline: ReturnType<typeof setTimeout> | null = null;
  const abortUpstreamOnce = (): void => {
    if (upstreamAborted) return;
    upstreamAborted = true;
    abortUpstream();
  };
  const clearDeadline = (): void => {
    if (deadline === null) return;
    clearTimeout(deadline);
    deadline = null;
  };
  const releaseWhenFullySettled = (): void => {
    if (released || !responseSettled || !workSettled) return;
    released = true;
    releaseTransfer();
  };
  const settleResponse = (): void => {
    if (responseSettled) return;
    responseSettled = true;
    clearDeadline();
    response.off("finish", handleFinish);
    response.off("close", handleClose);
    releaseWhenFullySettled();
  };
  const handleFinish = (): void => {
    settleResponse();
  };
  const handleClose = (): void => {
    if (!response.writableFinished) abortUpstreamOnce();
    settleResponse();
  };
  const handleDeadline = (): void => {
    deadline = null;
    abortUpstreamOnce();
    try {
      response.destroy();
    } finally {
      // A custom or already-detached response may not emit `close` after
      // destroy(). Mark it settled here so the capacity lease can still be
      // released once the handler work has unwound.
      settleResponse();
    }
  };
  response.once("finish", handleFinish);
  response.once("close", handleClose);
  deadline = setTimeout(handleDeadline, deadlineMilliseconds);
  deadline.unref();
  return () => {
    if (workSettled) return;
    workSettled = true;
    releaseWhenFullySettled();
  };
}

async function getS3Client(env: Env): Promise<S3ClientType> {
  if (cachedS3 !== null) return cachedS3;

  const { S3Client } = await import("@aws-sdk/client-s3");
  cachedS3 = new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID ?? ""}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    maxAttempts: 3,
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? "",
    },
  });
  return cachedS3;
}

async function getRuntimeProfileS3Client(env: Env): Promise<S3ClientType> {
  if (cachedRuntimeProfileS3 !== null) return cachedRuntimeProfileS3;

  const { S3Client } = await import("@aws-sdk/client-s3");
  cachedRuntimeProfileS3 = new S3Client({
    region: "auto",
    endpoint: `https://${env.RUNTIME_PROFILE_R2_ACCOUNT_ID ?? ""}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    maxAttempts: 3,
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: env.RUNTIME_PROFILE_R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: env.RUNTIME_PROFILE_R2_SECRET_ACCESS_KEY ?? "",
    },
  });
  return cachedRuntimeProfileS3;
}

function dateToIso(value: Date): string {
  return value.toISOString();
}

function r2PublicPath(r2Key: string): string {
  return r2Key.replace(/^r2:/, "").replace(/^\/+/, "");
}

function runtimeAssetOrigin(request: FastifyRequest): string | null {
  const forwardedHost = request.headers["x-forwarded-host"];
  const hostHeader = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost ?? request.headers.host;
  if (hostHeader === undefined || !/^[a-z0-9.-]+(?::\d+)?$/iu.test(hostHeader)) return null;

  const forwardedProto = request.headers["x-forwarded-proto"];
  const protocolHeader = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const protocol = protocolHeader === "https" || protocolHeader === "http" ? protocolHeader : request.protocol;
  return `${protocol}://${hostHeader}`;
}

function resolveAssetUrl(row: AssetVersionRow, requestOrigin: string | null): string | null {
  if (row.externalUrl !== null) return row.externalUrl;
  if (row.r2Key === null) return null;
  if (requestOrigin === null) return null;
  return `${requestOrigin}/assets/runtime-assets/${row.id}/${encodeURIComponent(row.fileName)}`;
}

function publicRuntimeProfileOrigin(env: Env): string | null {
  if (env.PUBLIC_API_ORIGIN === undefined) return null;
  try {
    return new URL(env.PUBLIC_API_ORIGIN).origin;
  } catch {
    return null;
  }
}

function trustedRuntimeAssetOrigin(env: Env, request: FastifyRequest): string | null {
  const configured = publicRuntimeProfileOrigin(env);
  if (configured !== null) return configured;
  return env.NODE_ENV === "production" ? null : runtimeAssetOrigin(request);
}

class RuntimePackageRevisionAdmissionError extends Error {
  constructor(
    readonly statusCode: 400 | 503,
    readonly code: "VALIDATION_ERROR" | "RUNTIME_VISUAL_URLS_UNAVAILABLE",
    readonly details: unknown,
  ) {
    super(code);
    this.name = "RuntimePackageRevisionAdmissionError";
  }
}

export function resolveRuntimeVisualAssetUrls(
  visualAssetVersions: readonly AssetVersionRow[],
  requestOrigin: string | null,
): readonly string[] | null {
  const urls: string[] = [];
  const uniqueUrls = new Set<string>();
  for (const asset of visualAssetVersions) {
    const url = resolveAssetUrl(asset, requestOrigin);
    if (url === null || uniqueUrls.has(url)) return null;
    uniqueUrls.add(url);
    urls.push(url);
  }
  return urls;
}

function r2IsConfigured(env: Env): boolean {
  return env.R2_ACCOUNT_ID !== undefined &&
    env.R2_ACCESS_KEY_ID !== undefined &&
    env.R2_SECRET_ACCESS_KEY !== undefined &&
    env.R2_BUCKET_NAME !== undefined;
}

export function runtimeProfileR2IsConfigured(env: Env): boolean {
  return env.RUNTIME_PROFILE_R2_ACCOUNT_ID !== undefined &&
    env.RUNTIME_PROFILE_R2_ACCESS_KEY_ID !== undefined &&
    env.RUNTIME_PROFILE_R2_SECRET_ACCESS_KEY !== undefined &&
    env.RUNTIME_PROFILE_R2_PRIVATE_BUCKET !== undefined;
}

export async function readBoundedRuntimeProfileMemberBytes(
  body: Readable,
  expectedSizeBytes: number,
): Promise<Buffer | null> {
  if (
    !Number.isSafeInteger(expectedSizeBytes) ||
    expectedSizeBytes <= 0 ||
    expectedSizeBytes > MAX_PUBLIC_RUNTIME_PROFILE_MEMBER_BYTES
  ) {
    body.destroy();
    return null;
  }

  const output = Buffer.allocUnsafe(expectedSizeBytes);
  let receivedBytes = 0;
  try {
    for await (const chunk of body) {
      const chunkBytes = typeof chunk === "string"
        ? Buffer.from(chunk)
        : Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk as Uint8Array);
      receivedBytes += chunkBytes.byteLength;
      if (receivedBytes > expectedSizeBytes) return null;
      chunkBytes.copy(output, receivedBytes - chunkBytes.byteLength);
    }
  } finally {
    if (!body.destroyed) body.destroy();
  }

  return receivedBytes === expectedSizeBytes ? output : null;
}

export async function readVerifiedRuntimeProfileMemberBytes(
  body: Readable,
  expectedSizeBytes: number,
  expectedSha256: string,
): Promise<Buffer | null> {
  if (!/^[a-f0-9]{64}$/u.test(expectedSha256)) {
    body.destroy();
    return null;
  }
  const bytes = await readBoundedRuntimeProfileMemberBytes(body, expectedSizeBytes);
  if (bytes === null || createHash("sha256").update(bytes).digest("hex") !== expectedSha256) {
    return null;
  }
  return bytes;
}

export function resolveVerifiedRuntimeProfileResponseRange(
  requestedRange: string | undefined,
  totalBytes: number,
): { readonly start: number; readonly end: number; readonly partial: boolean } | null {
  if (requestedRange === undefined) {
    return { start: 0, end: totalBytes - 1, partial: false };
  }
  const match = /^bytes=(\d*)-(\d*)$/u.exec(requestedRange);
  if (match === null) return null;
  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  if (startText.length === 0) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return {
      start: Math.max(0, totalBytes - suffixLength),
      end: totalBytes - 1,
      partial: true,
    };
  }

  const start = Number(startText);
  const requestedEnd = endText.length === 0 ? totalBytes - 1 : Number(endText);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= totalBytes ||
    requestedEnd < start
  ) {
    return null;
  }
  return {
    start,
    end: Math.min(requestedEnd, totalBytes - 1),
    partial: true,
  };
}

function validationError(reply: FastifyReply, details: unknown): FastifyReply {
  return reply.status(400).send({
    error: "Validation failed",
    code: "VALIDATION_ERROR",
    details,
  });
}

function isPostgresUniqueViolation(error: unknown): boolean {
  let cursor: unknown = error;
  const visited = new Set<unknown>();
  while (typeof cursor === "object" && cursor !== null && !visited.has(cursor)) {
    visited.add(cursor);
    const record = cursor as Record<string, unknown>;
    if (record["code"] === "23505") return true;
    cursor = record["cause"];
  }
  return false;
}

function serializeAssetVersion(row: AssetVersionRow): AssetVersion {
  return AssetVersionSchema.parse({
    id: row.id,
    venueSlug: row.venueSlug,
    roomSlug: row.roomSlug,
    captureSessionId: row.captureSessionId,
    assetKind: row.assetKind,
    sourceType: row.sourceType,
    fileName: row.fileName,
    fileExt: row.fileExt,
    r2Key: row.r2Key,
    externalUrl: row.externalUrl,
    mimeType: row.mimeType,
    sha256: row.sha256,
    sizeBytes: row.sizeBytes,
    evidenceStatus: row.evidenceStatus,
    runtimeStatus: row.runtimeStatus,
    notes: row.notes,
    createdAt: dateToIso(row.createdAt),
    updatedAt: dateToIso(row.updatedAt),
  });
}

function serializeCaptureSession(row: CaptureSessionRow): CaptureSession {
  return CaptureSessionSchema.parse({
    id: row.id,
    venueSlug: row.venueSlug,
    roomSlug: row.roomSlug,
    captureSource: row.captureSource,
    captureDevice: row.captureDevice,
    captureDate: row.captureDate,
    operatorName: row.operatorName,
    sourceProjectName: row.sourceProjectName,
    notes: row.notes,
    status: row.status,
    createdAt: dateToIso(row.createdAt),
    updatedAt: dateToIso(row.updatedAt),
  });
}

function serializeRoomManifest(row: RoomManifestRow): RoomManifest {
  return RoomManifestSchema.parse({
    id: row.id,
    venueSlug: row.venueSlug,
    roomSlug: row.roomSlug,
    displayName: row.displayName,
    matterportMasterReference: row.matterportMasterReference,
    alignmentStatus: row.alignmentStatus,
    primaryCaptureSource: row.primaryCaptureSource,
    notes: row.notes,
    createdAt: dateToIso(row.createdAt),
    updatedAt: dateToIso(row.updatedAt),
  });
}

function assetStorageReferences(version: AssetVersionRow): readonly string[] {
  return [version.r2Key, version.externalUrl].filter((value): value is string => value !== null);
}

function isServableRuntimeVisualAsset(version: AssetVersionRow): boolean {
  if (version.assetKind !== "splat" || version.runtimeStatus !== "usable") return false;
  if (version.evidenceStatus === "rejected") return false;
  if (version.roomSlug === null) return false;
  const references = assetStorageReferences(version);
  if (references.length === 0 || references.some(isForbiddenAssetFixtureKey)) return false;

  const extensions = references.map(splatExtensionForKey);
  if (extensions.some((extension) => extension === null)) return false;

  const parsedFileExt = RuntimeFileExtensionSchema.safeParse(version.fileExt);
  if (!parsedFileExt.success) return false;

  return extensions.every((extension) => extension === parsedFileExt.data) &&
    assetKindAllowsExtension("splat", parsedFileExt.data);
}

function runtimePackageCanLoad(pkg: RuntimePackageRow): boolean {
  if (pkg.evidenceStatus === "rejected") return false;
  return pkg.runtimeStatus === "internal_ready" || pkg.runtimeStatus === "published";
}

type RuntimeVisualCompositionPackage = Pick<
  RuntimePackageRow,
  "venueSlug" | "roomSlug" | "primaryVisualAssetVersionId" | "manifestJson"
>;

function declaredRuntimeVisualAssetVersionIds(
  pkg: RuntimeVisualCompositionPackage,
): readonly string[] | null {
  const parsedManifest = RuntimePackageManifestJsonSchema.safeParse(pkg.manifestJson);
  if (!parsedManifest.success) return null;

  const manifest = parsedManifest.data;
  if (
    manifest.venueSlug !== pkg.venueSlug ||
    manifest.roomSlug !== pkg.roomSlug ||
    manifest.assets.primaryVisualAssetVersionId !== pkg.primaryVisualAssetVersionId
  ) {
    return null;
  }

  if (manifest.assets.visualAssetVersionIds !== undefined) {
    return manifest.assets.visualAssetVersionIds;
  }
  return pkg.primaryVisualAssetVersionId === null ? [] : [pkg.primaryVisualAssetVersionId];
}

export function resolveRuntimeVisualAssetComposition(
  pkg: RuntimeVisualCompositionPackage,
  candidateAssets: readonly AssetVersionRow[],
): readonly AssetVersionRow[] | null {
  const declaredIds = declaredRuntimeVisualAssetVersionIds(pkg);
  if (declaredIds === null || candidateAssets.length !== declaredIds.length) return null;

  const declaredIdSet = new Set(declaredIds);
  const candidatesById = new Map<string, AssetVersionRow>();
  for (const candidate of candidateAssets) {
    if (
      !declaredIdSet.has(candidate.id) ||
      candidatesById.has(candidate.id) ||
      candidate.venueSlug !== pkg.venueSlug ||
      candidate.roomSlug !== pkg.roomSlug ||
      !isServableRuntimeVisualAsset(candidate)
    ) {
      return null;
    }
    candidatesById.set(candidate.id, candidate);
  }

  const orderedAssets: AssetVersionRow[] = [];
  for (const id of declaredIds) {
    const asset = candidatesById.get(id);
    if (asset === undefined) return null;
    orderedAssets.push(asset);
  }
  return orderedAssets;
}

function serializeRuntimePackage(
  pkg: RuntimePackageRow,
  primaryVisualAssetVersion: AssetVersionRow | null,
  requestOrigin: string | null,
  visualAssetVersions: readonly AssetVersionRow[] = [],
): RuntimePackage | null {
  const serializedAsset = primaryVisualAssetVersion === null ? null : serializeAssetVersion(primaryVisualAssetVersion);
  const exposesRuntimeUrls = pkg.runtimeStatus === "published";
  const primaryVisualAssetUrl = !exposesRuntimeUrls || primaryVisualAssetVersion === null
    ? null
    : resolveAssetUrl(primaryVisualAssetVersion, requestOrigin);
  const visualAssetUrls = exposesRuntimeUrls
    ? resolveRuntimeVisualAssetUrls(visualAssetVersions, requestOrigin)
    : [];
  if (
    visualAssetUrls === null ||
    (exposesRuntimeUrls && primaryVisualAssetVersion !== null && primaryVisualAssetUrl === null)
  ) {
    return null;
  }
  return RuntimePackageSchema.parse({
    id: pkg.id,
    venueSlug: pkg.venueSlug,
    roomSlug: pkg.roomSlug,
    primaryVisualAssetVersionId: pkg.primaryVisualAssetVersionId,
    semanticMeshAssetVersionId: pkg.semanticMeshAssetVersionId,
    collisionAssetVersionId: pkg.collisionAssetVersionId,
    pointCloudAssetVersionId: pkg.pointCloudAssetVersionId,
    manifestJson: pkg.manifestJson,
    evidenceStatus: pkg.evidenceStatus,
    runtimeStatus: pkg.runtimeStatus,
    createdAt: dateToIso(pkg.createdAt),
    updatedAt: dateToIso(pkg.updatedAt),
    primaryVisualAssetVersion: serializedAsset,
    primaryVisualAssetUrl,
    visualAssetUrls,
  });
}

export function serializeApprovedRoomRuntimeProfile(
  pkg: RuntimePackageRow,
  visualAssetVersions: readonly AssetVersionRow[],
  requestOrigin: string | null,
  reviewedTransformArtifactSha256: string | null,
): ApprovedRoomRuntimeProfile | null {
  const profileId = matchReceptionReviewedRuntimeProfile(pkg, visualAssetVersions);
  if (
    profileId === null ||
    !isReceptionReviewedProfilePresentationCandidate(
      profileId,
      reviewedTransformArtifactSha256,
    ) ||
    requestOrigin === null
  ) {
    return null;
  }
  const visualAssetUrls = visualAssetVersions.map((_asset, index) =>
    `${requestOrigin}/assets/runtime-profiles/${encodeURIComponent(profileId)}` +
      `/members/${String(index)}/content.sog`
  );
  if (visualAssetUrls.some((url) => !isClientSafeVisualUrl(url))) return null;

  const parsed = ApprovedRoomRuntimeProfileSchema.safeParse({
    scope: "approved_room_runtime_profile",
    venueSlug: pkg.venueSlug,
    roomSlug: pkg.roomSlug,
    profileId,
    visualAssetUrls,
  });
  return parsed.success ? parsed.data : null;
}

function serializeRuntimeQaRecord(row: RuntimeQaRecordRow): RuntimeQaRecordRegistration {
  return RuntimeQaRecordRegistrationSchema.parse({
    id: row.id,
    runtimePackageId: row.runtimePackageId,
    venueSlug: row.venueSlug,
    roomSlug: row.roomSlug,
    recordId: row.recordId,
    record: row.recordJson,
    signedTransformArtifactId: row.signedTransformArtifactId,
    publicExposureDecision: row.publicExposureDecision,
    assetEvidenceStatus: row.assetEvidenceStatus,
    runtimeStatus: row.runtimeStatus,
    reviewedBy: row.reviewedBy,
    createdAt: dateToIso(row.createdAt),
    updatedAt: dateToIso(row.updatedAt),
  });
}

function serializeRuntimeTransformArtifact(row: RuntimeTransformArtifactRow): RuntimeTransformArtifact {
  return RuntimeTransformArtifactSchema.parse({
    id: row.id,
    runtimePackageId: row.runtimePackageId,
    venueSlug: row.venueSlug,
    roomSlug: row.roomSlug,
    transformArtifactId: row.transformArtifactId,
    transformArtifact: row.transformArtifact,
    reviewNote: row.reviewNote,
    registeredBy: row.registeredBy,
    createdAt: dateToIso(row.createdAt),
    updatedAt: dateToIso(row.updatedAt),
  });
}

function serializeCaptureControlSourceRecord(
  row: CaptureControlSourceRecordRow,
): CaptureControlSourceRegistration {
  return CaptureControlSourceRegistrationSchema.parse({
    id: row.id,
    venueSlug: row.venueSlug,
    roomSlug: row.roomSlug,
    runtimePackageId: row.runtimePackageId,
    transformArtifactId: row.transformArtifactId,
    sourceId: row.sourceId,
    sourceClass: row.sourceClass,
    poseAuthorityLevel: row.poseAuthorityLevel,
    qaStatus: row.qaStatus,
    source: row.sourceRecord,
    reviewNote: row.reviewNote,
    registeredBy: row.registeredBy,
    createdAt: dateToIso(row.createdAt),
    updatedAt: dateToIso(row.updatedAt),
  });
}

function unavailablePublicRoomRuntimeVisual(venueSlug: string, roomSlug: string): PublicRoomRuntimeVisual {
  return PublicRoomRuntimeVisualSchema.parse({
    venueSlug,
    roomSlug,
    runtimeVisualAvailable: false,
    visualUrl: null,
    visualLabel: "Visual preview",
    safeCopy: "Runtime room visual is not currently available for this public preview. Final details are confirmed by the venue team.",
    humanReviewRequired: true,
  });
}

function roomAllowsPublicRuntimePresentation(
  venueSlug: string,
  roomSlug: string,
): boolean {
  if (venueSlug !== "trades-hall") return false;
  return TRADES_HALL_RUNTIME_ROOMS.some((room) =>
    room.slug === roomSlug && room.publicShowcaseEnabled
  );
}

function isClientSafeVisualUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      !["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function runtimeQaRecordAllowsPublicRoomVisual(
  row: RuntimeQaRecordRow | null | undefined,
  transformArtifact: RuntimeTransformArtifactRow | null | undefined,
): boolean {
  if (row === null || row === undefined) return false;
  if (transformArtifact === null || transformArtifact === undefined) return false;
  const parsedRecord = RuntimeQaRecordV0Schema.safeParse(row.recordJson);
  const parsedTransform = TransformArtifactV0Schema.safeParse(transformArtifact.transformArtifact);
  if (!parsedRecord.success || !parsedTransform.success) return false;
  const record = parsedRecord.data;
  if (!runtimeQaRecordAllowsPublicExposure(record)) return false;

  const signedTransformArtifactId = runtimeQaRecordSignedTransformArtifactId(record);
  const signedTransformArtifactSha256 = runtimeQaRecordSignedTransformArtifactSha256(record);
  if (signedTransformArtifactId === null || signedTransformArtifactSha256 === null) return false;
  if (row.signedTransformArtifactId !== signedTransformArtifactId) return false;
  if (row.publicExposureDecision !== "approved_public") return false;
  if (row.assetEvidenceStatus !== "human_reviewed") return false;
  if (row.runtimeStatus !== "published") return false;
  if (row.publicExposureDecision !== record.publicExposure.decision) return false;
  if (row.assetEvidenceStatus !== record.assetEvidenceStatus) return false;
  if (row.runtimeStatus !== record.runtimeStatus) return false;

  const qaCreatedAt = row.createdAt instanceof Date ? row.createdAt.getTime() : Number.NaN;
  const transformUpdatedAt = transformArtifact.updatedAt instanceof Date
    ? transformArtifact.updatedAt.getTime()
    : Number.NaN;
  if (
    !Number.isFinite(qaCreatedAt) ||
    !Number.isFinite(transformUpdatedAt) ||
    transformUpdatedAt > qaCreatedAt
  ) {
    return false;
  }

  return transformArtifact.runtimePackageId === row.runtimePackageId &&
    transformArtifact.venueSlug === row.venueSlug &&
    transformArtifact.roomSlug === row.roomSlug &&
    transformArtifact.transformArtifactId === signedTransformArtifactId &&
    parsedTransform.data.id === signedTransformArtifactId &&
    runtimeTransformArtifactSha256(parsedTransform.data) === signedTransformArtifactSha256;
}

async function findRuntimeTransformArtifact(
  db: Database,
  runtimePackageId: string,
  transformArtifactId: string | null,
): Promise<RuntimeTransformArtifactRow | null> {
  if (transformArtifactId === null) return null;
  const [row] = await db
    .select()
    .from(runtimeTransformArtifacts)
    .where(and(
      eq(runtimeTransformArtifacts.runtimePackageId, runtimePackageId),
      eq(runtimeTransformArtifacts.transformArtifactId, transformArtifactId),
    ))
    .limit(1);
  return row ?? null;
}

async function findRuntimeTransformArtifactForQaRecord(
  db: Database,
  row: RuntimeQaRecordRow | null,
): Promise<RuntimeTransformArtifactRow | null> {
  if (row === null || row === undefined) return null;
  const parsedRecord = RuntimeQaRecordV0Schema.safeParse(row.recordJson);
  if (!parsedRecord.success) return null;
  return findRuntimeTransformArtifact(
    db,
    row.runtimePackageId,
    runtimeQaRecordSignedTransformArtifactId(parsedRecord.data),
  );
}

async function findAssetVersion(db: Database, id: string | null | undefined): Promise<AssetVersionRow | null> {
  if (id === null || id === undefined) return null;
  const [row] = await db
    .select()
    .from(assetVersions)
    .where(eq(assetVersions.id, id))
    .limit(1);
  return row ?? null;
}

async function findRuntimeQaRecordByImmutableKey(
  db: Database,
  runtimePackageId: string,
  recordId: string,
): Promise<RuntimeQaRecordRow | null> {
  const [row] = await db
    .select()
    .from(runtimeQaRecords)
    .where(and(
      eq(runtimeQaRecords.runtimePackageId, runtimePackageId),
      eq(runtimeQaRecords.recordId, recordId),
    ))
    .limit(1);
  return row ?? null;
}

export function runtimeQaRecordAllowsPublicRuntimePackage(
  pkg: RuntimePackageRow,
  row: RuntimeQaRecordRow | null | undefined,
  transformArtifact: RuntimeTransformArtifactRow | null | undefined,
): boolean {
  if (row === null || row === undefined) return false;
  const parsedRecord = RuntimeQaRecordV0Schema.safeParse(row.recordJson);
  if (!parsedRecord.success) return false;
  const record = parsedRecord.data;
  return transformArtifact !== null &&
    transformArtifact !== undefined &&
    row.runtimePackageId === pkg.id &&
    row.venueSlug === pkg.venueSlug &&
    row.roomSlug === pkg.roomSlug &&
    record.runtimePackageId === pkg.id &&
    record.venueSlug === pkg.venueSlug &&
    record.roomSlug === pkg.roomSlug &&
    pkg.evidenceStatus === "human_reviewed" &&
    row.assetEvidenceStatus === pkg.evidenceStatus &&
    record.assetEvidenceStatus === pkg.evidenceStatus &&
    row.runtimeStatus === pkg.runtimeStatus &&
    record.runtimeStatus === pkg.runtimeStatus &&
    transformArtifact.runtimePackageId === pkg.id &&
    transformArtifact.venueSlug === pkg.venueSlug &&
    transformArtifact.roomSlug === pkg.roomSlug &&
    transformArtifact.transformArtifact.id === transformArtifact.transformArtifactId &&
    runtimeQaRecordAllowsPublicRoomVisual(row, transformArtifact);
}

async function findAssetVersions(
  db: Database,
  ids: readonly string[],
): Promise<readonly AssetVersionRow[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(assetVersions)
    .where(inArray(assetVersions.id, [...ids]));
}

async function findRuntimeVisualAssetComposition(
  db: Database,
  pkg: RuntimeVisualCompositionPackage,
): Promise<readonly AssetVersionRow[] | null> {
  const declaredIds = declaredRuntimeVisualAssetVersionIds(pkg);
  if (declaredIds === null) return null;
  const candidates = await findAssetVersions(db, declaredIds);
  return resolveRuntimeVisualAssetComposition(pkg, candidates);
}

async function findLatestPublishedRuntimePackage(
  db: Database,
  venueSlug: string,
  roomSlug: string,
): Promise<RuntimePackageRow | null> {
  const [row] = await db
    .select()
    .from(runtimePackages)
    .where(and(
      eq(runtimePackages.venueSlug, venueSlug),
      eq(runtimePackages.roomSlug, roomSlug),
      eq(runtimePackages.runtimeStatus, "published"),
    ))
    .orderBy(desc(runtimePackages.revision))
    .limit(1);
  return row ?? null;
}

async function latestRuntimeQaRecord(db: Database, runtimePackageId: string): Promise<RuntimeQaRecordRow | null> {
  const [row] = await db
    .select()
    .from(runtimeQaRecords)
    .where(eq(runtimeQaRecords.runtimePackageId, runtimePackageId))
    .orderBy(desc(runtimeQaRecords.updatedAt), desc(runtimeQaRecords.createdAt))
    .limit(1);
  return row ?? null;
}

async function findRuntimePackage(db: Database, id: string): Promise<RuntimePackageRow | null> {
  const [row] = await db
    .select()
    .from(runtimePackages)
    .where(eq(runtimePackages.id, id))
    .limit(1);
  return row ?? null;
}

function validateRuntimeTransformPackageLink(
  input: { venueSlug: string; roomSlug: string },
  pkg: RuntimePackageRow,
): string | null {
  if (pkg.venueSlug !== input.venueSlug || pkg.roomSlug !== input.roomSlug) {
    return "Runtime transform artifact must target the same venue and room as the runtime package.";
  }
  if (pkg.runtimeStatus === "archived" || pkg.evidenceStatus === "rejected") {
    return "Runtime transform artifacts cannot be registered against rejected or archived runtime packages.";
  }
  return null;
}

export function runtimeTransformArtifactRegistrationIsExactRetry(
  existing: RuntimeTransformArtifactRow,
  input: {
    readonly runtimePackageId: string;
    readonly venueSlug: string;
    readonly roomSlug: string;
    readonly transformArtifact: unknown;
    readonly reviewNote?: string | null;
  },
): boolean {
  const storedArtifact = TransformArtifactV0Schema.safeParse(existing.transformArtifact);
  const requestedArtifact = TransformArtifactV0Schema.safeParse(input.transformArtifact);
  return storedArtifact.success &&
    requestedArtifact.success &&
    existing.runtimePackageId === input.runtimePackageId &&
    existing.venueSlug === input.venueSlug &&
    existing.roomSlug === input.roomSlug &&
    existing.transformArtifactId === requestedArtifact.data.id &&
    existing.reviewNote === (input.reviewNote ?? null) &&
    runtimeTransformArtifactSha256(storedArtifact.data) ===
      runtimeTransformArtifactSha256(requestedArtifact.data);
}

export function runtimeQaRecordRegistrationIsExactRetry(
  existing: RuntimeQaRecordRow,
  input: {
    readonly runtimePackageId: string;
    readonly venueSlug: string;
    readonly roomSlug: string;
    readonly record: RuntimeQaRecordRow["recordJson"];
  },
): boolean {
  const storedRecord = RuntimeQaRecordV0Schema.safeParse(existing.recordJson);
  const requestedRecord = RuntimeQaRecordV0Schema.safeParse(input.record);
  return storedRecord.success &&
    requestedRecord.success &&
    existing.runtimePackageId === input.runtimePackageId &&
    existing.venueSlug === input.venueSlug &&
    existing.roomSlug === input.roomSlug &&
    existing.recordId === requestedRecord.data.recordId &&
    existing.signedTransformArtifactId ===
      runtimeQaRecordSignedTransformArtifactId(requestedRecord.data) &&
    existing.publicExposureDecision === requestedRecord.data.publicExposure.decision &&
    existing.assetEvidenceStatus === requestedRecord.data.assetEvidenceStatus &&
    existing.runtimeStatus === requestedRecord.data.runtimeStatus &&
    JSON.stringify(storedRecord.data) === JSON.stringify(requestedRecord.data);
}

function validateRuntimeQaPackageLink(
  input: { venueSlug: string; roomSlug: string; record: { assetEvidenceStatus: string; runtimeStatus: string } },
  pkg: RuntimePackageRow,
): string | null {
  if (pkg.venueSlug !== input.venueSlug || pkg.roomSlug !== input.roomSlug) {
    return "Runtime QA record must target the same venue and room as the runtime package.";
  }
  if (pkg.evidenceStatus !== input.record.assetEvidenceStatus) {
    return "Runtime QA asset evidence status must match the runtime package evidence status.";
  }
  if (pkg.runtimeStatus !== input.record.runtimeStatus) {
    return "Runtime QA runtime status must match the runtime package runtime status.";
  }
  return null;
}

function validateRuntimeQaSignedTransformLink(
  input: { venueSlug: string; roomSlug: string; runtimePackageId: string; record: { viewTransform: { signedTransformArtifactId: string | null } } },
  transformArtifact: RuntimeTransformArtifactRow | null,
): string | null {
  const signedTransformArtifactId = input.record.viewTransform.signedTransformArtifactId;
  if (signedTransformArtifactId === null) return null;
  if (transformArtifact === null) {
    return "Runtime QA signed transform artifact must be registered for the same runtime package.";
  }
  if (
    transformArtifact.runtimePackageId !== input.runtimePackageId ||
    transformArtifact.venueSlug !== input.venueSlug ||
    transformArtifact.roomSlug !== input.roomSlug ||
    transformArtifact.transformArtifactId !== signedTransformArtifactId
  ) {
    return "Runtime QA signed transform artifact must target the same runtime package, venue, and room.";
  }
  return null;
}

function validateCaptureControlRuntimePackageLink(
  input: { venueSlug: string; roomSlug: string; runtimePackageId?: string | null },
  pkg: RuntimePackageRow | null,
): string | null {
  const runtimePackageId = input.runtimePackageId ?? null;
  if (runtimePackageId === null) return null;
  if (pkg === null) return "Capture control runtime package not found.";
  if (pkg.venueSlug !== input.venueSlug || pkg.roomSlug !== input.roomSlug) {
    return "Capture control source must target the same venue and room as the runtime package.";
  }
  return null;
}

function validateCaptureControlTransformLink(
  input: { venueSlug: string; roomSlug: string; runtimePackageId?: string | null; transformArtifactId?: string | null },
  transformArtifact: RuntimeTransformArtifactRow | null,
): string | null {
  const transformArtifactId = input.transformArtifactId ?? null;
  if (transformArtifactId === null) return null;
  const runtimePackageId = input.runtimePackageId ?? null;
  if (runtimePackageId === null) {
    return "Capture control transform links require a runtime package id.";
  }
  if (transformArtifact === null) {
    return "Capture control transform artifact must be registered for the same runtime package.";
  }
  if (
    transformArtifact.runtimePackageId !== runtimePackageId ||
    transformArtifact.venueSlug !== input.venueSlug ||
    transformArtifact.roomSlug !== input.roomSlug ||
    transformArtifact.transformArtifactId !== transformArtifactId
  ) {
    return "Capture control transform artifact must target the same runtime package, venue, and room.";
  }
  return null;
}

function validateAssetReference(
  input: RegisterRuntimePackageInput,
  row: AssetVersionRow | null,
  field: "primaryVisualAssetVersionId" | "semanticMeshAssetVersionId" | "collisionAssetVersionId" | "pointCloudAssetVersionId",
): string | null {
  const requestedId = input[field] ?? null;
  if (requestedId === null) return null;
  if (row === null) return `${field} does not exist.`;
  if (row.venueSlug !== input.venueSlug || row.roomSlug !== input.roomSlug) {
    return `${field} must reference an asset from the same venue and room.`;
  }
  if (row.evidenceStatus === "rejected" || row.runtimeStatus === "rejected" || row.runtimeStatus === "archived") {
    return `${field} must not reference a rejected or archived asset.`;
  }
  if (runtimePackageInputCanLoad(input) && row.runtimeStatus !== "usable") {
    return `${field} must reference a usable asset before the package can be loadable.`;
  }
  return null;
}

function runtimePackageInputCanLoad(input: RegisterRuntimePackageInput): boolean {
  return input.runtimeStatus === "internal_ready" || input.runtimeStatus === "published";
}

function validatePrimaryVisualAsset(input: RegisterRuntimePackageInput, row: AssetVersionRow | null): string | null {
  const baseError = validateAssetReference(input, row, "primaryVisualAssetVersionId");
  if (baseError !== null) return baseError;
  if ((input.primaryVisualAssetVersionId ?? null) === null) return null;
  if (row === null) return "primaryVisualAssetVersionId does not exist.";
  if (!isServableRuntimeVisualAsset(row)) {
    return "primaryVisualAssetVersionId must reference a non-fixture splat asset with a supported Spark file extension.";
  }
  return null;
}

export function validateRuntimeVisualAssetReceipts(
  input: RegisterRuntimePackageInput,
  rows: readonly AssetVersionRow[],
): string | null {
  const receipts = input.manifestJson.assets.visualAssetReceipts;
  if (receipts === undefined) return null;
  if (receipts.length !== rows.length) {
    return "Visual asset receipts must exactly match the resolved visual composition.";
  }

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const receipt = receipts[index];
    if (row === undefined || receipt === undefined || row.r2Key === null) {
      return "Every visual asset receipt must bind one protected R2 asset.";
    }
    if (
      receipt.assetVersionId !== row.id ||
      receipt.fileName !== row.fileName ||
      receipt.fileExt !== row.fileExt ||
      receipt.sha256 !== row.sha256 ||
      receipt.sizeBytes !== row.sizeBytes ||
      receipt.storageKeySha256 !== runtimeAssetStorageKeySha256(row.r2Key)
    ) {
      return `Visual asset receipt ${String(index)} does not match its registered immutable member.`;
    }
  }
  return null;
}

function firstValidationMessage(messages: readonly (string | null)[]): string | null {
  return messages.find((message): message is string => message !== null) ?? null;
}

function latestPackageByRoom(rows: readonly RuntimePackageRow[]): Map<string, RuntimePackageRow> {
  const byRoom = new Map<string, RuntimePackageRow>();
  for (const row of rows) {
    if (!byRoom.has(row.roomSlug)) {
      byRoom.set(row.roomSlug, row);
    }
  }
  return byRoom;
}

function roomSplatStatus(defaultCopy: string, splatExists: boolean): string {
  return splatExists ? "registered splat asset" : defaultCopy;
}

function runtimePackageStatusCopy(pkg: RuntimePackageRow | undefined): string {
  if (pkg === undefined) return "no runtime package registered";
  switch (pkg.runtimeStatus) {
    case "draft":
      return "runtime package draft";
    case "internal_ready":
      return "runtime package internal ready";
    case "published":
      return "runtime package published";
    case "archived":
      return "runtime package archived";
  }
  return "runtime package status unavailable";
}

function runtimePackageSafeCopy(defaultCopy: string, pkg: RuntimePackageRow | undefined): string {
  if (pkg === undefined) return defaultCopy;
  if (!runtimePackageCanLoad(pkg)) return "Runtime package registered, not ready to load";
  switch (pkg.evidenceStatus) {
    case "unverified":
      return "Runtime asset loaded, not yet verified/signed.";
    case "machine_checked":
      return "Runtime asset loaded, machine checked; human review required.";
    case "human_reviewed":
      return "Runtime asset loaded, human reviewed.";
    case "rejected":
      return "Runtime asset rejected in review - not loaded";
  }
  return "Runtime package registered, human review required";
}

function roomStatusNextAction(defaultAction: string, splatExists: boolean, pkg: RuntimePackageRow | undefined): string {
  if (!splatExists) return defaultAction;
  if (pkg === undefined) return "Register a runtime package for this room";
  if (!runtimePackageCanLoad(pkg)) return "Review runtime package status before loading";
  return "Open the internal runtime view";
}

function transformArtifactCountsByPackage(
  rows: readonly RuntimeTransformArtifactRow[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.runtimePackageId, (counts.get(row.runtimePackageId) ?? 0) + 1);
  }
  return counts;
}

function latestTransformArtifactIdByPackage(
  rows: readonly RuntimeTransformArtifactRow[],
): Map<string, string> {
  const byPackage = new Map<string, string>();
  for (const row of rows) {
    if (!byPackage.has(row.runtimePackageId)) {
      byPackage.set(row.runtimePackageId, row.transformArtifactId);
    }
  }
  return byPackage;
}

function latestQaRecordByPackage(
  rows: readonly RuntimeQaRecordRow[],
): Map<string, RuntimeQaRecordRow> {
  const byPackage = new Map<string, RuntimeQaRecordRow>();
  for (const row of rows) {
    if (!byPackage.has(row.runtimePackageId)) {
      byPackage.set(row.runtimePackageId, row);
    }
  }
  return byPackage;
}

function captureControlSourcesForRoom(
  rows: readonly CaptureControlSourceRecordRow[],
  roomSlug: string,
): readonly CaptureControlSourceRecordRow[] {
  return rows.filter((row) => row.roomSlug === roomSlug);
}

function captureControlTransformLinked(
  source: CaptureControlSourceRecordRow | undefined,
  pkg: RuntimePackageRow | undefined,
  latestTransformArtifactId: string | null,
): boolean {
  return source !== undefined &&
    pkg !== undefined &&
    source.runtimePackageId === pkg.id &&
    source.transformArtifactId !== null &&
    source.transformArtifactId === latestTransformArtifactId;
}

function reviewedTransformSafeCopy(pkg: RuntimePackageRow | undefined, count: number): string {
  if (pkg === undefined) return "runtime package required before transform review";
  if (count === 0) return "no reviewed runtime transform registered";
  return count === 1
    ? "reviewed runtime transform artifact registered"
    : `${String(count)} reviewed runtime transform artifacts registered`;
}

function reviewedQaStatus(
  pkg: RuntimePackageRow | undefined,
  qaRecord: RuntimeQaRecordRow | undefined,
): ReviewedRuntimeQaStatus {
  if (pkg === undefined || qaRecord === undefined) return "missing";
  switch (qaRecord.publicExposureDecision) {
    case "blocked_internal_only":
    case "approved_internal_preview":
    case "approved_public":
      return qaRecord.publicExposureDecision;
    default:
      return "missing";
  }
}

function qaSignedTransformLinked(
  qaRecord: RuntimeQaRecordRow | undefined,
  latestTransformArtifactId: string | null,
): boolean {
  return qaRecord !== undefined &&
    qaRecord.signedTransformArtifactId !== null &&
    qaRecord.signedTransformArtifactId === latestTransformArtifactId;
}

function reviewedQaSafeCopy(
  pkg: RuntimePackageRow | undefined,
  qaRecord: RuntimeQaRecordRow | undefined,
  signedTransformLinked: boolean,
): string {
  if (pkg === undefined) return "runtime package required before runtime QA review";
  if (qaRecord === undefined) return "no runtime QA record registered";

  switch (qaRecord.publicExposureDecision) {
    case "blocked_internal_only":
      return "runtime QA recorded; public exposure blocked";
    case "approved_internal_preview":
      return "runtime QA approved for internal preview only";
    case "approved_public":
      return signedTransformLinked
        ? "runtime QA approved for public exposure with linked transform artifact"
        : "runtime QA approval missing its registered transform artifact link";
    default:
      return "runtime QA record has unsupported public exposure state";
  }
}

function captureControlStatus(
  sourceCount: number,
  transformLinked: boolean,
): ReviewedCaptureControlStatus {
  if (sourceCount === 0) return "missing";
  if (transformLinked) return "linked_to_transform";
  return "source_registered";
}

function captureControlSafeCopy(
  sourceCount: number,
  source: CaptureControlSourceRecordRow | undefined,
  transformLinked: boolean,
  freshnessStatus: CaptureControlFreshnessStatus,
): string {
  if (sourceCount === 0 || source === undefined) return "no capture-control source registered";
  if (freshnessStatus === "stale_for_runtime_package") {
    return "capture-control source registered; stale evidence review required";
  }
  if (transformLinked) return "capture-control source linked to latest transform artifact";
  if (source.transformArtifactId !== null) return "capture-control source linked to a non-current transform artifact";
  return "capture-control source registered; signed transform still required";
}

function captureControlAuthoritySafeCopy(source: CaptureControlSourceRecordRow | undefined): string {
  if (source === undefined) return "no capture-control authority recorded";
  switch (source.poseAuthorityLevel) {
    case "measured_control":
      return "measured control source recorded; review before operational reliance";
    case "validated_fiducial_control":
      return "fiducial control source recorded; review before operational reliance";
    case "manual_landmark_control":
      return "manual landmark control source recorded; reviewer confirmation required";
    case "known_pose_colmap":
      return "known-pose COLMAP source recorded; review before operational reliance";
    case "colmap_reconstructed":
      return "COLMAP reconstructed source recorded; metric scale still requires external control";
    case "visual_alignment_only":
      return "visual-only alignment source recorded; not measurement control";
    default:
      return "capture-control authority source recorded; review required";
  }
}

function captureControlStalenessSafeCopy(source: CaptureControlSourceRecordRow | undefined): string {
  if (source === undefined) return "no capture-control staleness policy recorded";
  const count = source.sourceRecord.staleWhen.length;
  if (count === 0) return "capture-control source has no staleness triggers recorded";
  return count === 1
    ? "capture-control source has 1 staleness trigger recorded"
    : `capture-control source has ${String(count)} staleness triggers recorded`;
}

function captureControlActiveStalenessTriggers(
  source: CaptureControlSourceRecordRow | undefined,
  pkg: RuntimePackageRow | undefined,
): readonly string[] {
  if (source === undefined) return [];
  const activeTriggers: string[] = [];
  const staleWhen = new Set<string>(source.sourceRecord.staleWhen);

  if (
    staleWhen.has("runtime_package_changed") &&
    source.runtimePackageId !== null &&
    (pkg === undefined || source.runtimePackageId !== pkg.id)
  ) {
    activeTriggers.push("runtime_package_changed");
  }
  if (staleWhen.has("source_pose_rejected") && source.qaStatus === "rejected") {
    activeTriggers.push("source_pose_rejected");
  }
  if (staleWhen.has("manual_contestation") && source.qaStatus === "contested") {
    activeTriggers.push("manual_contestation");
  }
  if (staleWhen.has("review_expired") && source.qaStatus === "stale") {
    activeTriggers.push("review_expired");
  }
  if (staleWhen.has("capture_session_superseded") && source.qaStatus === "superseded") {
    activeTriggers.push("capture_session_superseded");
  }

  return activeTriggers;
}

function captureControlFreshnessStatus(
  source: CaptureControlSourceRecordRow | undefined,
  pkg: RuntimePackageRow | undefined,
  activeStalenessTriggers: readonly string[],
): CaptureControlFreshnessStatus {
  if (source === undefined) return "missing";
  if (activeStalenessTriggers.length > 0) return "stale_for_runtime_package";
  if (source.runtimePackageId !== null && pkg !== undefined && source.runtimePackageId === pkg.id) {
    return "current_for_runtime_package";
  }
  return "not_checked";
}

function runtimeControlEvidenceChainSummary(
  venueSlug: string,
  roomSlug: string,
  pkg: RuntimePackageRow | undefined,
): RuntimeControlEvidenceChainDashboardSummary {
  if (pkg === undefined) {
    return {
      status: "not_recorded",
      ref: null,
      requiredCoordinatePairCount: null,
      reviewedCoordinatePairCount: null,
      safeCopy: "runtime package required before runtime-control chain review",
      nextAction: "Register a runtime package before reviewing coordinate-pair evidence",
    };
  }

  if (venueSlug !== "trades-hall" || roomSlug !== "reception-room") {
    return {
      status: "not_recorded",
      ref: null,
      requiredCoordinatePairCount: null,
      reviewedCoordinatePairCount: null,
      safeCopy: "runtime-control evidence chain not recorded for this room",
      nextAction: "Create runtime-control source evidence before signed-transform review",
    };
  }

  if (pkg.id !== RECEPTION_ROOM_RUNTIME_PACKAGE_ID) {
    return {
      status: "not_recorded",
      ref: null,
      requiredCoordinatePairCount: null,
      reviewedCoordinatePairCount: null,
      safeCopy: "runtime-control evidence chain is not recorded for the latest runtime package",
      nextAction: "Regenerate runtime-control chain status for the latest runtime package",
    };
  }

  return {
    status: "blocked_missing_coordinate_pair_intake",
    ref: RECEPTION_ROOM_RUNTIME_CONTROL_EVIDENCE_CHAIN_REF,
    requiredCoordinatePairCount: 4,
    reviewedCoordinatePairCount: 0,
    safeCopy: "runtime-control chain blocked because reviewed coordinate-pair intake is missing",
    nextAction: "Collect the four reviewed ARF to CVF landmark measurements",
  };
}

export function buildRoomAssetStatuses(
  venueSlug: string,
  manifests: readonly RoomManifestRow[],
  splatRows: readonly AssetVersionRow[],
  packageRows: readonly RuntimePackageRow[],
  transformArtifactRows: readonly RuntimeTransformArtifactRow[] = [],
  qaRecordRows: readonly RuntimeQaRecordRow[] = [],
  captureControlRows: readonly CaptureControlSourceRecordRow[] = [],
): readonly RoomAssetStatus[] {
  const manifestByRoom = new Map(manifests.map((manifest) => [manifest.roomSlug, manifest]));
  const splatRooms = new Set(splatRows
    .filter((row) => row.assetKind === "splat" && row.roomSlug !== null && row.runtimeStatus !== "archived")
    .map((row) => row.roomSlug as string));
  const packageByRoom = latestPackageByRoom(packageRows);
  const transformCountsByPackage = transformArtifactCountsByPackage(transformArtifactRows);
  const latestTransformByPackage = latestTransformArtifactIdByPackage(transformArtifactRows);
  const latestQaByPackage = latestQaRecordByPackage(qaRecordRows);
  const defaults = venueSlug === "trades-hall" ? TRADES_HALL_RUNTIME_ROOMS : [];

  return defaults.map((room) => {
    const manifest = manifestByRoom.get(room.slug);
    const pkg = packageByRoom.get(room.slug);
    const splatExists = splatRooms.has(room.slug);
    const reviewedTransformArtifactCount = pkg === undefined
      ? 0
      : transformCountsByPackage.get(pkg.id) ?? 0;
    const latestTransformArtifactId = pkg === undefined ? null : latestTransformByPackage.get(pkg.id) ?? null;
    const qaRecord = pkg === undefined ? undefined : latestQaByPackage.get(pkg.id);
    const linkedSignedTransform = qaSignedTransformLinked(qaRecord, latestTransformArtifactId);
    const captureSources = captureControlSourcesForRoom(captureControlRows, room.slug);
    const latestCaptureSource = captureSources[0];
    const linkedCaptureControlTransform = captureControlTransformLinked(
      latestCaptureSource,
      pkg,
      latestTransformArtifactId,
    );
    const activeCaptureControlStalenessTriggers = captureControlActiveStalenessTriggers(latestCaptureSource, pkg);
    const captureControlFreshness = captureControlFreshnessStatus(
      latestCaptureSource,
      pkg,
      activeCaptureControlStalenessTriggers,
    );
    const runtimeControlEvidenceChain = runtimeControlEvidenceChainSummary(
      venueSlug,
      room.slug,
      pkg,
    );
    return RoomAssetStatusSchema.parse({
      venueSlug,
      roomSlug: room.slug,
      displayName: manifest?.displayName ?? room.displayName,
      roomGroup: room.roomGroup,
      defaultStatus: room.defaultStatus,
      captureStatus: room.captureStatus,
      registryRuntimeStatus: room.registryRuntimeStatus,
      publicShowcaseEnabled: room.publicShowcaseEnabled,
      internalVisualEnabled: room.internalVisualEnabled,
      primaryCaptureSource: manifest?.primaryCaptureSource ?? room.primaryCaptureSource,
      currentState: room.currentState,
      splatStatus: roomSplatStatus(room.safeCopy, splatExists),
      splatExists,
      runtimePackageStatus: runtimePackageStatusCopy(pkg),
      runtimePackageExists: pkg !== undefined,
      reviewedTransformStatus: reviewedTransformArtifactCount > 0 ? "registered" : "missing",
      reviewedTransformArtifactCount,
      latestTransformArtifactId,
      reviewedTransformSafeCopy: reviewedTransformSafeCopy(pkg, reviewedTransformArtifactCount),
      reviewedQaStatus: reviewedQaStatus(pkg, qaRecord),
      latestQaRecordId: qaRecord?.recordId ?? null,
      qaSignedTransformArtifactId: qaRecord?.signedTransformArtifactId ?? null,
      qaSignedTransformLinked: linkedSignedTransform,
      reviewedQaSafeCopy: reviewedQaSafeCopy(pkg, qaRecord, linkedSignedTransform),
      captureControlStatus: captureControlStatus(captureSources.length, linkedCaptureControlTransform),
      captureControlSourceCount: captureSources.length,
      latestCaptureControlSourceRecordId: latestCaptureSource?.id ?? null,
      latestCaptureControlSourceId: latestCaptureSource?.sourceId ?? null,
      latestCaptureControlSourceClass: latestCaptureSource?.sourceClass ?? null,
      latestCaptureControlPoseAuthorityLevel: latestCaptureSource?.poseAuthorityLevel ?? null,
      latestCaptureControlAlignmentMethods: latestCaptureSource?.sourceRecord.alignmentMethods ?? [],
      latestCaptureControlStalenessTriggers: latestCaptureSource?.sourceRecord.staleWhen ?? [],
      latestCaptureControlActiveStalenessTriggers: activeCaptureControlStalenessTriggers,
      captureControlFreshnessStatus: captureControlFreshness,
      latestCaptureControlQaStatus: latestCaptureSource?.qaStatus ?? null,
      captureControlLinkedTransformArtifactId: latestCaptureSource?.transformArtifactId ?? null,
      captureControlTransformLinked: linkedCaptureControlTransform,
      captureControlAuthoritySafeCopy: captureControlAuthoritySafeCopy(latestCaptureSource),
      captureControlStalenessSafeCopy: captureControlStalenessSafeCopy(latestCaptureSource),
      captureControlSafeCopy: captureControlSafeCopy(
        captureSources.length,
        latestCaptureSource,
        linkedCaptureControlTransform,
        captureControlFreshness,
      ),
      runtimeControlEvidenceChainStatus: runtimeControlEvidenceChain.status,
      runtimeControlEvidenceChainRef: runtimeControlEvidenceChain.ref,
      runtimeControlRequiredCoordinatePairCount: runtimeControlEvidenceChain.requiredCoordinatePairCount,
      runtimeControlReviewedCoordinatePairCount: runtimeControlEvidenceChain.reviewedCoordinatePairCount,
      runtimeControlEvidenceChainSafeCopy: runtimeControlEvidenceChain.safeCopy,
      runtimeControlEvidenceChainNextAction: runtimeControlEvidenceChain.nextAction,
      evidenceStatus: pkg?.evidenceStatus ?? null,
      runtimeStatus: pkg?.runtimeStatus ?? null,
      nextAction: roomStatusNextAction(room.nextAction, splatExists, pkg),
      safeCopy: runtimePackageSafeCopy(room.safeCopy, pkg),
    });
  });
}

export async function assetRoutes(
  server: FastifyInstance,
  opts: { db: Database; env: Env },
): Promise<void> {
  const { db, env } = opts;

  async function resolvePublicReviewedProfile(
    venueSlug: string,
    roomSlug: string,
    requestedProfileId?: ReviewedRuntimeProfileId,
  ): Promise<PublicReviewedProfileResolution | null> {
    if (!runtimeProfileR2IsConfigured(env)) return null;
    if (!roomAllowsPublicRuntimePresentation(venueSlug, roomSlug)) return null;
    const pkg = await findLatestPublishedRuntimePackage(db, venueSlug, roomSlug);
    if (pkg === null || pkg.runtimeStatus !== "published" || !runtimePackageCanLoad(pkg)) {
      return null;
    }
    const visualAssets = await findRuntimeVisualAssetComposition(db, pkg);
    if (visualAssets === null || visualAssets.length === 0) return null;
    const profileId = matchReceptionReviewedRuntimeProfile(pkg, visualAssets);
    if (
      profileId === null ||
      (requestedProfileId !== undefined && profileId !== requestedProfileId)
    ) {
      return null;
    }
    const qaRecord = await latestRuntimeQaRecord(db, pkg.id);
    const transformArtifact = await findRuntimeTransformArtifactForQaRecord(db, qaRecord);
    if (!runtimeQaRecordAllowsPublicRuntimePackage(pkg, qaRecord, transformArtifact)) return null;
    const parsedQaRecord = RuntimeQaRecordV0Schema.safeParse(qaRecord?.recordJson);
    const reviewedTransformArtifactSha256 = parsedQaRecord.success
      ? runtimeQaRecordSignedTransformArtifactSha256(parsedQaRecord.data)
      : null;
    if (
      reviewedTransformArtifactSha256 === null ||
      !isReceptionReviewedProfilePresentationCandidate(
        profileId,
        reviewedTransformArtifactSha256,
      )
    ) {
      return null;
    }
    return { pkg, visualAssets, profileId, reviewedTransformArtifactSha256 };
  }

  function publicRuntimeProfileMemberAuthorization(
    resolved: PublicReviewedProfileResolution,
    memberIndex: number,
  ): PublicRuntimeProfileMemberAuthorization | null {
    const asset = resolved.visualAssets[memberIndex];
    if (
      asset === undefined ||
      !isServableRuntimeVisualAsset(asset) ||
      asset.r2Key === null ||
      asset.sha256 === null ||
      asset.sizeBytes === null ||
      asset.sizeBytes <= 0 ||
      asset.sizeBytes > MAX_PUBLIC_RUNTIME_PROFILE_MEMBER_BYTES
    ) {
      return null;
    }
    return {
      profileId: resolved.profileId,
      runtimePackageId: resolved.pkg.id,
      runtimePackageRevision: resolved.pkg.revision,
      runtimePackageContentDigest: resolved.pkg.contentDigest,
      reviewedTransformArtifactSha256: resolved.reviewedTransformArtifactSha256,
      memberIndex,
      assetVersionId: asset.id,
      r2Key: asset.r2Key,
      sha256: asset.sha256,
      sizeBytes: asset.sizeBytes,
      fileName: asset.fileName,
      fileExt: asset.fileExt,
    };
  }

  function samePublicRuntimeProfileMemberAuthorization(
    left: PublicRuntimeProfileMemberAuthorization,
    right: PublicRuntimeProfileMemberAuthorization | null,
  ): boolean {
    return right !== null &&
      left.profileId === right.profileId &&
      left.runtimePackageId === right.runtimePackageId &&
      left.runtimePackageRevision === right.runtimePackageRevision &&
      left.runtimePackageContentDigest === right.runtimePackageContentDigest &&
      left.reviewedTransformArtifactSha256 === right.reviewedTransformArtifactSha256 &&
      left.memberIndex === right.memberIndex &&
      left.assetVersionId === right.assetVersionId &&
      left.r2Key === right.r2Key &&
      left.sha256 === right.sha256 &&
      left.sizeBytes === right.sizeBytes &&
      left.fileName === right.fileName &&
      left.fileExt === right.fileExt;
  }

  server.get("/", async () => {
    const rows = await db.select().from(assetDefinitions).orderBy(assetDefinitions.name);
    return { data: rows };
  });

  server.get(
    "/runtime-packages/latest",
    { preHandler: [authenticate, authorizePlatformAdmin()] },
    async (request, reply) => {
      const parsedQuery = LatestRuntimePackageQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return validationError(reply, parsedQuery.error.issues);
      }

      try {
        const [row] = await db
          .select({ pkg: runtimePackages, primaryVisualAssetVersion: assetVersions })
          .from(runtimePackages)
          .innerJoin(assetVersions, eq(runtimePackages.primaryVisualAssetVersionId, assetVersions.id))
          .where(and(
            eq(runtimePackages.venueSlug, parsedQuery.data.venue),
            eq(runtimePackages.roomSlug, parsedQuery.data.room),
            eq(runtimePackages.runtimeStatus, "published"),
            eq(assetVersions.runtimeStatus, "usable"),
          ))
          .orderBy(desc(runtimePackages.revision))
          .limit(1);

        if (
          row === undefined ||
          row.pkg.runtimeStatus !== "published" ||
          !runtimePackageCanLoad(row.pkg) ||
          !isServableRuntimeVisualAsset(row.primaryVisualAssetVersion)
        ) {
          return { data: null };
        }

        const visualAssetVersions = await findRuntimeVisualAssetComposition(db, row.pkg);
        if (visualAssetVersions === null) {
          return { data: null };
        }
        return {
          data: serializeRuntimePackage(
            row.pkg,
            row.primaryVisualAssetVersion,
            trustedRuntimeAssetOrigin(env, request),
            visualAssetVersions,
          ),
        };
      } catch (error: unknown) {
        request.log.warn({
          err: error,
          venueSlug: parsedQuery.data.venue,
          roomSlug: parsedQuery.data.room,
        }, "runtime package registry lookup unavailable; returning empty runtime package state");
        return { data: null };
      }
    },
  );

  server.get("/runtime-packages/approved-profile", async (request, reply) => {
    reply.header("cache-control", "private, no-store");
    const parsedQuery = LatestRuntimePackageQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return validationError(reply, parsedQuery.error.issues);
    }

    try {
      const resolved = await resolvePublicReviewedProfile(
        parsedQuery.data.venue,
        parsedQuery.data.room,
      );
      const trustedOrigin = publicRuntimeProfileOrigin(env);
      if (resolved === null || trustedOrigin === null) return { data: null };
      return {
        data: serializeApprovedRoomRuntimeProfile(
          resolved.pkg,
          resolved.visualAssets,
          trustedOrigin,
          resolved.reviewedTransformArtifactSha256,
        ),
      };
    } catch (error: unknown) {
      request.log.warn({
        err: error,
        venueSlug: parsedQuery.data.venue,
        roomSlug: parsedQuery.data.room,
      }, "approved runtime profile lookup unavailable; returning safe fallback state");
      return { data: null };
    }
  });

  server.get("/runtime-packages/public-room-visual", async (request, reply) => {
    reply.header("cache-control", "public, max-age=60");
    const parsedQuery = LatestRuntimePackageQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return validationError(reply, parsedQuery.error.issues);
    }

    // Retired by design: raw external URLs cannot re-run release gates or
    // verify physical bytes. Every room must eventually use a reviewed,
    // anonymous profile-member route. Until then the public UI gets fallback.
    return {
      data: unavailablePublicRoomRuntimeVisual(
        parsedQuery.data.venue,
        parsedQuery.data.room,
      ),
    };
  });

  function parseRuntimeAssetRange(request: FastifyRequest, reply: FastifyReply): string | undefined | FastifyReply {
    const rangeHeader = request.headers.range;
    const range = typeof rangeHeader === "string" ? rangeHeader : undefined;
    if (range !== undefined && !HTTP_RANGE_HEADER_PATTERN.test(range)) {
      return reply.status(416).send({
        error: "Unsupported range request",
        code: "UNSUPPORTED_RANGE",
      });
    }
    return range;
  }

  async function sendRuntimeAssetBytes(
    asset: AssetVersionRow,
    range: string | undefined,
    cacheControl: string,
    reply: FastifyReply,
  ): Promise<FastifyReply> {
    if (asset.r2Key === null) {
      return reply.status(404).send({
        error: "Runtime asset is not available",
        code: "RUNTIME_ASSET_NOT_AVAILABLE",
      });
    }

    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const s3 = await getS3Client(env);
    const object = await s3.send(new GetObjectCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key: r2PublicPath(asset.r2Key),
      Range: range,
    }));
    if (object.Body === undefined) {
      return reply.status(502).send({
        error: "Runtime asset object was empty",
        code: "RUNTIME_ASSET_EMPTY",
      });
    }

    if (!(object.Body instanceof Readable)) {
      return reply.status(502).send({
        error: "Runtime asset object was not a server byte stream",
        code: "RUNTIME_ASSET_NOT_STREAMABLE",
      });
    }
    const responseStatus = object.ContentRange === undefined ? 200 : 206;
    reply
      .status(responseStatus)
      .header("accept-ranges", object.AcceptRanges ?? "bytes")
      .header("content-type", asset.mimeType ?? object.ContentType ?? "application/octet-stream")
      .header("cache-control", cacheControl);
    if (object.ContentLength !== undefined) reply.header("content-length", String(object.ContentLength));
    if (object.ContentRange !== undefined) reply.header("content-range", object.ContentRange);
    if (object.ETag !== undefined) reply.header("etag", object.ETag);
    return reply.send(object.Body);
  }

  async function loadVerifiedRuntimeProfileMemberBytes(
    asset: AssetVersionRow,
    consumerSignal: AbortSignal,
  ): Promise<Buffer> {
    if (
      asset.r2Key === null ||
      asset.sha256 === null ||
      asset.sizeBytes === null ||
      asset.sizeBytes <= 0 ||
      asset.sizeBytes > MAX_PUBLIC_RUNTIME_PROFILE_MEMBER_BYTES
    ) {
      throw new RuntimeProfileMemberIntegrityError("Runtime profile member identity is incomplete");
    }
    const r2Key = asset.r2Key;
    const sha256 = asset.sha256;
    const sizeBytes = asset.sizeBytes;
    try {
      return await publicRuntimeProfileVerifiedBytes.load(
        { sha256, sizeBytes },
        consumerSignal,
        async (sharedSignal) => {
          const controller = new AbortController();
          let activeBody: Readable | null = null;
          let upstreamTimedOut = false;
          const abortStorage = (): void => {
            controller.abort(sharedSignal.reason);
            const reason = sharedSignal.reason instanceof Error
              ? sharedSignal.reason
              : new DOMException("Runtime profile storage request aborted", "AbortError");
            activeBody?.destroy(reason);
          };
          sharedSignal.addEventListener("abort", abortStorage, { once: true });
          if (sharedSignal.aborted) abortStorage();
          const timeout = setTimeout(() => {
            upstreamTimedOut = true;
            const timeoutError = new RuntimeProfileMemberUpstreamTimeoutError();
            controller.abort(timeoutError);
            activeBody?.destroy(timeoutError);
          }, PUBLIC_RUNTIME_PROFILE_UPSTREAM_TIMEOUT_MS);
          timeout.unref();
          try {
            const { GetObjectCommand } = await import("@aws-sdk/client-s3");
            const s3 = await getRuntimeProfileS3Client(env);
            const object = await s3.send(new GetObjectCommand({
              Bucket: env.RUNTIME_PROFILE_R2_PRIVATE_BUCKET,
              Key: r2PublicPath(r2Key),
            }), { abortSignal: controller.signal });
            if (!(object.Body instanceof Readable)) {
              const possibleBody = object.Body as { destroy?: () => void } | undefined;
              possibleBody?.destroy?.();
              throw new RuntimeProfileMemberIntegrityError(
                "Runtime profile member was not a server byte stream",
              );
            }
            activeBody = object.Body;
            const bytes = await readBoundedRuntimeProfileMemberBytes(
              object.Body,
              sizeBytes,
            );
            if (bytes === null) {
              throw new RuntimeProfileMemberIntegrityError(
                "Runtime profile member failed its registered size check",
              );
            }
            return bytes;
          } catch (error: unknown) {
            if (upstreamTimedOut) throw new RuntimeProfileMemberUpstreamTimeoutError();
            throw error;
          } finally {
            clearTimeout(timeout);
            sharedSignal.removeEventListener("abort", abortStorage);
            if (activeBody !== null && !activeBody.destroyed) activeBody.destroy();
          }
        });
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message === "Verified runtime profile bytes did not match their immutable identity"
      ) {
        throw new RuntimeProfileMemberIntegrityError(
          "Runtime profile member failed its registered SHA-256 check",
        );
      }
      throw error;
    }
  }

  async function streamRuntimeAsset(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const parsedParams = RuntimeAssetParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return validationError(reply, parsedParams.error.issues);
    }

    const parsedRange = parseRuntimeAssetRange(request, reply);
    if (typeof parsedRange !== "string" && parsedRange !== undefined) return parsedRange;
    if (!r2IsConfigured(env)) {
      return reply.status(503).send({
        error: "Runtime asset storage is not configured",
        code: "RUNTIME_ASSET_STORAGE_DISABLED",
      });
    }

    try {
      const asset = await findAssetVersion(db, parsedParams.data.assetVersionId);
      const pkg = asset === null || asset.roomSlug === null
        ? null
        : await findLatestPublishedRuntimePackage(db, asset.venueSlug, asset.roomSlug);
      const visualAssetVersions = pkg === null
        ? null
        : await findRuntimeVisualAssetComposition(db, pkg);

      if (
        asset === null ||
        pkg === null ||
        pkg.runtimeStatus !== "published" ||
        !runtimePackageCanLoad(pkg) ||
        visualAssetVersions === null ||
        !visualAssetVersions.some((version) => version.id === asset.id) ||
        !isServableRuntimeVisualAsset(asset) ||
        asset.r2Key === null ||
        (parsedParams.data.fileName !== undefined && parsedParams.data.fileName !== asset.fileName)
      ) {
        return reply.status(404).send({
          error: "Runtime asset is not available",
          code: "RUNTIME_ASSET_NOT_AVAILABLE",
        });
      }

      const response = await sendRuntimeAssetBytes(asset, parsedRange, "private, max-age=300", reply);
      return response;
    } catch (error: unknown) {
      request.log.warn({
        err: error,
        assetVersionId: parsedParams.data.assetVersionId,
      }, "runtime asset stream failed");
      return reply.status(502).send({
        error: "Runtime asset could not be streamed",
        code: "RUNTIME_ASSET_STREAM_FAILED",
      });
    }
  }

  async function streamRuntimeProfileMember(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FastifyReply> {
    reply.header("cache-control", "private, no-store");
    const parsedParams = RuntimeProfileMemberParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return validationError(reply, parsedParams.error.issues);
    }

    const parsedRange = parseRuntimeAssetRange(request, reply);
    if (typeof parsedRange !== "string" && parsedRange !== undefined) return parsedRange;

    const controller = new AbortController();
    let clientDisconnected = false;
    const abortForClientDisconnect = (): void => {
      if (reply.raw.writableFinished) return;
      clientDisconnected = true;
      controller.abort(new DOMException("Runtime profile client disconnected", "AbortError"));
    };
    reply.raw.once("close", abortForClientDisconnect);
    const releaseTransfer = await acquirePublicRuntimeProfileTransfer(controller.signal);
    if (releaseTransfer === null) {
      reply.raw.off("close", abortForClientDisconnect);
      if (clientDisconnected) return reply;
      return reply
        .status(429)
        .header("retry-after", "1")
        .send({
          error: "Runtime profile transfer queue is temporarily full",
          code: "RUNTIME_PROFILE_TRANSFER_LIMIT_REACHED",
        });
    }
    if (clientDisconnected || reply.raw.destroyed) {
      reply.raw.off("close", abortForClientDisconnect);
      releaseTransfer();
      return reply;
    }
    const markWorkSettled = bindPublicRuntimeProfileTransferToResponse(
      reply.raw,
      releaseTransfer,
      abortForClientDisconnect,
      PUBLIC_RUNTIME_PROFILE_TRANSFER_DEADLINE_MS,
    );
    reply.raw.off("close", abortForClientDisconnect);

    try {
      const resolved = await resolvePublicReviewedProfile(
        "trades-hall",
        "reception-room",
        parsedParams.data.profileId,
      );
      const authorization = resolved === null
        ? null
        : publicRuntimeProfileMemberAuthorization(
          resolved,
          parsedParams.data.memberIndex,
        );
      if (resolved === null || authorization === null) {
        return reply.status(404).send({
          error: "Runtime profile member is not available",
          code: "RUNTIME_PROFILE_MEMBER_NOT_AVAILABLE",
        });
      }
      if (!runtimeProfileR2IsConfigured(env)) {
        return reply.status(503).send({
          error: "Private runtime profile storage is not configured",
          code: "RUNTIME_PROFILE_STORAGE_DISABLED",
        });
      }

      const responseRange = resolveVerifiedRuntimeProfileResponseRange(
        parsedRange,
        authorization.sizeBytes,
      );
      if (responseRange === null) {
        return reply
          .status(416)
          .header("content-range", `bytes */${String(authorization.sizeBytes)}`)
          .send({
            error: "Requested byte range is not satisfiable",
            code: "RUNTIME_PROFILE_MEMBER_RANGE_NOT_SATISFIABLE",
          });
      }

      const asset = resolved.visualAssets[parsedParams.data.memberIndex];
      if (asset === undefined) {
        return reply.status(404).send({
          error: "Runtime profile member is not available",
          code: "RUNTIME_PROFILE_MEMBER_NOT_AVAILABLE",
        });
      }
      const verifiedBytes = await loadVerifiedRuntimeProfileMemberBytes(
        asset,
        controller.signal,
      );

      // Release decisions can change while a request waits or storage is
      // fetched. Re-run every package, QA and transform gate immediately
      // before sending bytes and require the exact same immutable member.
      const current = await resolvePublicReviewedProfile(
        "trades-hall",
        "reception-room",
        parsedParams.data.profileId,
      );
      const currentAuthorization = current === null
        ? null
        : publicRuntimeProfileMemberAuthorization(
          current,
          parsedParams.data.memberIndex,
        );
      if (!samePublicRuntimeProfileMemberAuthorization(authorization, currentAuthorization)) {
        return reply.status(409).send({
          error: "Runtime profile approval changed before the member could be released",
          code: "RUNTIME_PROFILE_AUTHORIZATION_CHANGED",
        });
      }

      const body = verifiedBytes.subarray(responseRange.start, responseRange.end + 1);
      reply
        .status(responseRange.partial ? 206 : 200)
        .header("accept-ranges", "bytes")
        .header("content-type", asset.mimeType ?? "application/octet-stream")
        .header("content-length", String(body.byteLength))
        .header("cache-control", "private, no-store");
      if (responseRange.partial) {
        reply.header(
          "content-range",
          `bytes ${String(responseRange.start)}-${String(responseRange.end)}/${String(authorization.sizeBytes)}`,
        );
      }
      return reply.send(body);
    } catch (error: unknown) {
      if (clientDisconnected || controller.signal.aborted) return reply;
      if (error instanceof RuntimeProfileMemberUpstreamTimeoutError) {
        return reply.status(504).send({
          error: "Runtime profile member storage timed out",
          code: "RUNTIME_PROFILE_MEMBER_UPSTREAM_TIMEOUT",
        });
      }
      if (error instanceof RuntimeProfileMemberIntegrityError) {
        return reply.status(409).send({
          error: "Runtime profile member failed byte verification",
          code: "RUNTIME_PROFILE_MEMBER_INTEGRITY_FAILED",
        });
      }
      request.log.warn({
        err: error,
        profileId: parsedParams.data.profileId,
        memberIndex: parsedParams.data.memberIndex,
      }, "runtime profile member stream failed");
      return reply.status(502).send({
        error: "Runtime profile member could not be streamed",
        code: "RUNTIME_PROFILE_MEMBER_STREAM_FAILED",
      });
    } finally {
      markWorkSettled();
    }
  }

  server.get(
    "/runtime-assets/:assetVersionId",
    { preHandler: [authenticate, authorizePlatformAdmin()] },
    streamRuntimeAsset,
  );
  server.get(
    "/runtime-assets/:assetVersionId/:fileName",
    { preHandler: [authenticate, authorizePlatformAdmin()] },
    streamRuntimeAsset,
  );
  server.get(
    "/runtime-profiles/:profileId/members/:memberIndex/:memberFileName",
    {
      config: {
        rateLimit: {
          max: PUBLIC_RUNTIME_PROFILE_ROUTE_RATE_LIMIT_PER_MINUTE,
          timeWindow: "1 minute",
        },
      },
    },
    streamRuntimeProfileMember,
  );
}

export async function adminAssetRoutes(
  server: FastifyInstance,
  opts: { db: Database; env: Env },
): Promise<void> {
  const { db } = opts;
  const runtimePackageRevisionStore = createDatabaseRuntimePackageRevisionStore(db);

  server.post(
    "/capture-session",
    { preHandler: [authenticate, authorizePlatformAdmin()] },
    async (request, reply) => {
      const parsed = RegisterCaptureSessionInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return validationError(reply, parsed.error.issues);
      }

      const input = parsed.data;
      const [session] = await db.insert(captureSessions).values({
        venueSlug: input.venueSlug,
        roomSlug: input.roomSlug ?? null,
        captureSource: input.captureSource,
        captureDevice: input.captureDevice ?? null,
        captureDate: input.captureDate ?? null,
        operatorName: input.operatorName ?? null,
        sourceProjectName: input.sourceProjectName ?? null,
        notes: input.notes ?? null,
        status: input.status,
      }).returning();

      if (session === undefined) {
        return reply.status(500).send({ error: "Failed to register capture session", code: "CAPTURE_SESSION_REGISTER_FAILED" });
      }

      request.log.info({
        userId: request.user.id,
        captureSessionId: session.id,
        venueSlug: session.venueSlug,
        roomSlug: session.roomSlug,
        captureSource: session.captureSource,
        status: session.status,
      }, "capture session registered");

      return reply.status(201).send({ data: serializeCaptureSession(session) });
    },
  );

  server.get(
    "/rooms",
    { preHandler: [authenticate, authorizePlatformAdmin()] },
    async (request, reply) => {
      const parsedQuery = AdminRoomsQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return validationError(reply, parsedQuery.error.issues);
      }

      const venueSlug = parsedQuery.data.venue;
      const [
        manifestRows,
        splatRows,
        packageRows,
        transformArtifactRows,
        qaRecordRows,
        captureControlRows,
      ] = await Promise.all([
        db
          .select()
          .from(roomManifests)
          .where(eq(roomManifests.venueSlug, venueSlug))
          .orderBy(roomManifests.roomSlug),
        db
          .select()
          .from(assetVersions)
          .where(and(eq(assetVersions.venueSlug, venueSlug), eq(assetVersions.assetKind, "splat")))
          .orderBy(desc(assetVersions.updatedAt), desc(assetVersions.createdAt)),
        db
          .select()
          .from(runtimePackages)
          .where(eq(runtimePackages.venueSlug, venueSlug))
          .orderBy(desc(runtimePackages.revision)),
        db
          .select()
          .from(runtimeTransformArtifacts)
          .where(eq(runtimeTransformArtifacts.venueSlug, venueSlug))
          .orderBy(desc(runtimeTransformArtifacts.updatedAt), desc(runtimeTransformArtifacts.createdAt)),
        db
          .select()
          .from(runtimeQaRecords)
          .where(eq(runtimeQaRecords.venueSlug, venueSlug))
          .orderBy(desc(runtimeQaRecords.updatedAt), desc(runtimeQaRecords.createdAt)),
        db
          .select()
          .from(captureControlSourceRecords)
          .where(eq(captureControlSourceRecords.venueSlug, venueSlug))
          .orderBy(desc(captureControlSourceRecords.updatedAt), desc(captureControlSourceRecords.createdAt)),
      ]);

      return { data: buildRoomAssetStatuses(
        venueSlug,
        manifestRows,
        splatRows,
        packageRows,
        transformArtifactRows,
        qaRecordRows,
        captureControlRows,
      ) };
    },
  );

  server.post(
    "/register-version",
    { preHandler: [authenticate, authorizePlatformAdmin()] },
    async (request, reply) => {
      const parsed = RegisterAssetVersionInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return validationError(reply, parsed.error.issues);
      }

      const input = parsed.data;
      const [version] = await db.insert(assetVersions).values({
        venueSlug: input.venueSlug,
        roomSlug: input.roomSlug ?? null,
        captureSessionId: input.captureSessionId ?? null,
        assetKind: input.assetKind,
        sourceType: input.sourceType,
        fileName: input.fileName,
        fileExt: input.fileExt,
        r2Key: input.r2Key ?? null,
        externalUrl: input.externalUrl ?? null,
        mimeType: input.mimeType ?? null,
        sha256: input.sha256 ?? null,
        sizeBytes: input.sizeBytes ?? null,
        evidenceStatus: input.evidenceStatus,
        runtimeStatus: input.runtimeStatus,
        notes: input.notes ?? null,
      }).returning();

      if (version === undefined) {
        return reply.status(500).send({ error: "Failed to register asset version", code: "ASSET_REGISTER_FAILED" });
      }

      request.log.info({
        userId: request.user.id,
        assetVersionId: version.id,
        venueSlug: version.venueSlug,
        roomSlug: version.roomSlug,
        assetKind: version.assetKind,
        sourceType: version.sourceType,
        runtimeStatus: version.runtimeStatus,
      }, "asset version registered");

      return reply.status(201).send({ data: serializeAssetVersion(version) });
    },
  );

  server.post(
    "/register-runtime-package",
    { preHandler: [authenticate, authorizePlatformAdmin()] },
    async (_request, reply) => reply.status(410).send({
      error: "This mutable runtime-package endpoint has been retired. Create an immutable revision instead.",
      code: "RUNTIME_PACKAGE_MUTABLE_REGISTRATION_RETIRED",
      replacement: "/admin/assets/runtime-package-revisions",
    }),
  );

  server.post(
    "/runtime-package-revisions",
    { preHandler: [authenticate, authorizePlatformAdmin()] },
    async (request, reply) => {
      const parsed = CreateRuntimePackageRevisionInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return validationError(reply, parsed.error.issues);
      }

      const input = parsed.data.package;
      const requestOrigin = trustedRuntimeAssetOrigin(opts.env, request);
      let admittedAssets: {
        readonly primaryVisualAsset: AssetVersionRow | null;
        readonly runtimeVisualAssetComposition: readonly AssetVersionRow[];
      } | undefined;

      let creation;
      try {
        creation = await createRuntimePackageRevision(runtimePackageRevisionStore, parsed.data, {
          beforeInsert: async () => {
            const [
              primaryVisualAsset,
              semanticMeshAsset,
              collisionAsset,
              pointCloudAsset,
              runtimeVisualAssetComposition,
            ] = await Promise.all([
              findAssetVersion(db, input.primaryVisualAssetVersionId),
              findAssetVersion(db, input.semanticMeshAssetVersionId),
              findAssetVersion(db, input.collisionAssetVersionId),
              findAssetVersion(db, input.pointCloudAssetVersionId),
              findRuntimeVisualAssetComposition(db, {
                venueSlug: input.venueSlug,
                roomSlug: input.roomSlug,
                primaryVisualAssetVersionId: input.primaryVisualAssetVersionId ?? null,
                manifestJson: input.manifestJson,
              }),
            ]);
            if (runtimeVisualAssetComposition === null) {
              throw new RuntimePackageRevisionAdmissionError(
                400,
                "VALIDATION_ERROR",
                "Visual asset composition must reference exactly the registered, usable, non-fixture splat assets declared for the same venue and room.",
              );
            }
            const assetError = firstValidationMessage([
              validatePrimaryVisualAsset(input, primaryVisualAsset),
              validateRuntimeVisualAssetReceipts(input, runtimeVisualAssetComposition),
              validateAssetReference(input, semanticMeshAsset, "semanticMeshAssetVersionId"),
              validateAssetReference(input, collisionAsset, "collisionAssetVersionId"),
              validateAssetReference(input, pointCloudAsset, "pointCloudAssetVersionId"),
            ]);
            if (assetError !== null) {
              throw new RuntimePackageRevisionAdmissionError(400, "VALIDATION_ERROR", assetError);
            }
            if (
              input.runtimeStatus === "published" &&
              resolveRuntimeVisualAssetUrls(runtimeVisualAssetComposition, requestOrigin) === null
            ) {
              throw new RuntimePackageRevisionAdmissionError(
                503,
                "RUNTIME_VISUAL_URLS_UNAVAILABLE",
                "Runtime visual URLs could not be resolved as a complete set",
              );
            }
            admittedAssets = { primaryVisualAsset, runtimeVisualAssetComposition };
          },
        });
      } catch (error) {
        if (error instanceof RuntimePackageRevisionAdmissionError) {
          if (error.statusCode === 400) return validationError(reply, error.details);
          return reply.status(503).send({
            error: error.details,
            code: error.code,
          });
        }
        if (error instanceof RuntimePackageRevisionConflictError) {
          return reply.status(409).send({
            error: error.message,
            code: error.code,
            requestedRevision: error.requestedRevision,
            expectedRevision: error.expectedRevision,
          });
        }
        if (error instanceof RuntimePackageRevisionIntegrityError) {
          request.log.error({ error }, "runtime package revision integrity check failed");
          return reply.status(500).send({
            error: "Runtime package revision integrity check failed",
            code: error.code,
          });
        }
        throw error;
      }

      request.log.info({
        userId: request.user.id,
        runtimePackageId: creation.row.id,
        revision: creation.row.revision,
        contentDigest: creation.contentDigest,
        created: creation.created,
        venueSlug: creation.row.venueSlug,
        roomSlug: creation.row.roomSlug,
        runtimeStatus: creation.row.runtimeStatus,
      }, "immutable runtime package revision resolved");

      const serializationAssets = creation.created
        ? admittedAssets
        : { primaryVisualAsset: null, runtimeVisualAssetComposition: [] };
      if (serializationAssets === undefined) {
        request.log.error({ runtimePackageId: creation.row.id }, "runtime package admission result was lost");
        return reply.status(500).send({
          error: "Runtime package admission result was not available",
          code: "RUNTIME_PACKAGE_ADMISSION_RESULT_MISSING",
        });
      }
      const serializedPackage = serializeRuntimePackage(
        creation.row,
        serializationAssets.primaryVisualAsset,
        requestOrigin,
        serializationAssets.runtimeVisualAssetComposition,
      );
      if (serializedPackage === null) {
        return reply.status(500).send({
          error: "Registered runtime package could not be serialized as a complete visual set",
          code: "RUNTIME_PACKAGE_SERIALIZATION_FAILED",
        });
      }
      const response = RuntimePackageRevisionCreateResponseSchema.parse({
        data: serializedPackage,
        receipt: {
          packageId: creation.row.id,
          revision: creation.row.revision,
          contentDigest: creation.contentDigest,
          created: creation.created,
        },
      });
      return reply.status(creation.created ? 201 : 200).send(response);
    },
  );

  server.post(
    "/register-runtime-transform-artifact",
    { preHandler: [authenticate, authorizePlatformAdmin()] },
    async (request, reply) => {
      const parsed = RegisterRuntimeTransformArtifactInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return validationError(reply, parsed.error.issues);
      }

      const input = parsed.data;
      const runtimePackage = await findRuntimePackage(db, input.runtimePackageId);
      if (runtimePackage === null) {
        return reply.status(404).send({ error: "Runtime package not found", code: "RUNTIME_PACKAGE_NOT_FOUND" });
      }

      const linkError = validateRuntimeTransformPackageLink(input, runtimePackage);
      if (linkError !== null) {
        return validationError(reply, linkError);
      }

      const values = {
        runtimePackageId: input.runtimePackageId,
        venueSlug: input.venueSlug,
        roomSlug: input.roomSlug,
        transformArtifactId: input.transformArtifact.id,
        transformArtifact: input.transformArtifact,
        reviewNote: input.reviewNote ?? null,
        registeredBy: request.user.id,
        updatedAt: new Date(),
      };

      const existingArtifact = await findRuntimeTransformArtifact(
        db,
        input.runtimePackageId,
        input.transformArtifact.id,
      );

      if (existingArtifact !== null) {
        if (!runtimeTransformArtifactRegistrationIsExactRetry(existingArtifact, input)) {
          return reply.status(409).send({
            error: "A transform artifact id is immutable; register changed content under a new id",
            code: "RUNTIME_TRANSFORM_ARTIFACT_IMMUTABLE",
          });
        }
        return reply.status(200).send({ data: serializeRuntimeTransformArtifact(existingArtifact) });
      }

      let artifact: RuntimeTransformArtifactRow | undefined;
      try {
        [artifact] = await db.insert(runtimeTransformArtifacts).values(values).returning();
      } catch (error) {
        if (!isPostgresUniqueViolation(error)) throw error;
        const racedArtifact = await findRuntimeTransformArtifact(
          db,
          input.runtimePackageId,
          input.transformArtifact.id,
        );
        if (racedArtifact === null) throw error;
        if (!runtimeTransformArtifactRegistrationIsExactRetry(racedArtifact, input)) {
          return reply.status(409).send({
            error: "A transform artifact id is immutable; register changed content under a new id",
            code: "RUNTIME_TRANSFORM_ARTIFACT_IMMUTABLE",
          });
        }
        return reply.status(200).send({ data: serializeRuntimeTransformArtifact(racedArtifact) });
      }

      if (artifact === undefined) {
        return reply.status(500).send({
          error: "Failed to register runtime transform artifact",
          code: "RUNTIME_TRANSFORM_ARTIFACT_REGISTER_FAILED",
        });
      }

      request.log.info({
        userId: request.user.id,
        runtimePackageId: artifact.runtimePackageId,
        runtimeTransformArtifactId: artifact.id,
        transformArtifactId: artifact.transformArtifactId,
        venueSlug: artifact.venueSlug,
        roomSlug: artifact.roomSlug,
      }, "runtime transform artifact registered");

      return reply.status(201).send({ data: serializeRuntimeTransformArtifact(artifact) });
    },
  );

  server.get(
    "/runtime-transform-artifacts",
    { preHandler: [authenticate, authorizePlatformAdmin()] },
    async (request, reply) => {
      const parsedQuery = RuntimeTransformArtifactQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return validationError(reply, parsedQuery.error.issues);
      }

      const rows = await db
        .select()
        .from(runtimeTransformArtifacts)
        .where(eq(runtimeTransformArtifacts.runtimePackageId, parsedQuery.data.runtimePackageId))
        .orderBy(desc(runtimeTransformArtifacts.updatedAt), desc(runtimeTransformArtifacts.createdAt));

      return { data: rows.map(serializeRuntimeTransformArtifact) };
    },
  );

  server.post(
    "/register-capture-control-source",
    { preHandler: [authenticate, authorizePlatformAdmin()] },
    async (request, reply) => {
      const parsed = RegisterCaptureControlSourceRecordInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return validationError(reply, parsed.error.issues);
      }

      const input = parsed.data;
      const runtimePackageId = input.runtimePackageId ?? null;
      const transformArtifactId = input.transformArtifactId ?? null;
      const runtimePackage = runtimePackageId === null ? null : await findRuntimePackage(db, runtimePackageId);
      if (runtimePackageId !== null && runtimePackage === null) {
        return reply.status(404).send({
          error: "Runtime package not found",
          code: "RUNTIME_PACKAGE_NOT_FOUND",
        });
      }

      const runtimePackageError = validateCaptureControlRuntimePackageLink(input, runtimePackage);
      if (runtimePackageError !== null) {
        return validationError(reply, runtimePackageError);
      }

      const transformArtifact = transformArtifactId === null || runtimePackageId === null
        ? null
        : await findRuntimeTransformArtifact(db, runtimePackageId, transformArtifactId);
      const transformArtifactError = validateCaptureControlTransformLink(input, transformArtifact);
      if (transformArtifactError !== null) {
        return validationError(reply, transformArtifactError);
      }

      const values = {
        venueSlug: input.venueSlug,
        roomSlug: input.roomSlug,
        runtimePackageId,
        transformArtifactId,
        sourceId: input.source.sourceId,
        sourceClass: input.source.sourceClass,
        poseAuthorityLevel: input.source.poseAuthorityLevel,
        qaStatus: input.source.qaStatus,
        sourceRecord: input.source,
        reviewNote: input.reviewNote ?? null,
        registeredBy: request.user.id,
        updatedAt: new Date(),
      };

      const [existingSource] = await db
        .select()
        .from(captureControlSourceRecords)
        .where(and(
          eq(captureControlSourceRecords.venueSlug, input.venueSlug),
          eq(captureControlSourceRecords.roomSlug, input.roomSlug),
          eq(captureControlSourceRecords.sourceId, input.source.sourceId),
        ))
        .limit(1);

      const [source] = existingSource === undefined
        ? await db.insert(captureControlSourceRecords).values(values).returning()
        : await db
          .update(captureControlSourceRecords)
          .set(values)
          .where(eq(captureControlSourceRecords.id, existingSource.id))
          .returning();

      if (source === undefined) {
        return reply.status(500).send({
          error: "Failed to register capture control source",
          code: "CAPTURE_CONTROL_SOURCE_REGISTER_FAILED",
        });
      }

      request.log.info({
        userId: request.user.id,
        captureControlSourceId: source.id,
        sourceId: source.sourceId,
        venueSlug: source.venueSlug,
        roomSlug: source.roomSlug,
        runtimePackageId: source.runtimePackageId,
        transformArtifactId: source.transformArtifactId,
        qaStatus: source.qaStatus,
      }, "capture control source registered");

      return reply.status(201).send({ data: serializeCaptureControlSourceRecord(source) });
    },
  );

  server.get(
    "/capture-control-sources",
    { preHandler: [authenticate, authorizePlatformAdmin()] },
    async (request, reply) => {
      const parsedQuery = CaptureControlSourceRecordQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return validationError(reply, parsedQuery.error.issues);
      }

      const query = parsedQuery.data;
      const filters: SQL[] = [eq(captureControlSourceRecords.venueSlug, query.venue)];
      if (query.room !== undefined) {
        filters.push(eq(captureControlSourceRecords.roomSlug, query.room));
      }
      if (query.runtimePackageId !== undefined) {
        filters.push(eq(captureControlSourceRecords.runtimePackageId, query.runtimePackageId));
      }
      if (query.transformArtifactId !== undefined) {
        filters.push(eq(captureControlSourceRecords.transformArtifactId, query.transformArtifactId));
      }

      const rows = await db
        .select()
        .from(captureControlSourceRecords)
        .where(and(...filters))
        .orderBy(desc(captureControlSourceRecords.updatedAt), desc(captureControlSourceRecords.createdAt));

      return { data: rows.map(serializeCaptureControlSourceRecord) };
    },
  );

  server.post(
    "/register-runtime-qa-record",
    { preHandler: [authenticate, authorizePlatformAdmin()] },
    async (request, reply) => {
      const parsed = RegisterRuntimeQaRecordInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return validationError(reply, parsed.error.issues);
      }

      const input = parsed.data;
      const runtimePackage = await findRuntimePackage(db, input.runtimePackageId);
      if (runtimePackage === null) {
        return reply.status(404).send({ error: "Runtime package not found", code: "RUNTIME_PACKAGE_NOT_FOUND" });
      }

      const linkError = validateRuntimeQaPackageLink(input, runtimePackage);
      if (linkError !== null) {
        return validationError(reply, linkError);
      }

      const signedTransformArtifact = await findRuntimeTransformArtifact(
        db,
        input.runtimePackageId,
        runtimeQaRecordSignedTransformArtifactId(input.record),
      );
      const transformLinkError = validateRuntimeQaSignedTransformLink(input, signedTransformArtifact);
      if (transformLinkError !== null) {
        return validationError(reply, transformLinkError);
      }

      const signedTransformArtifactId = runtimeQaRecordSignedTransformArtifactId(input.record);
      let boundRecord = input.record;
      if (signedTransformArtifactId !== null) {
        const parsedArtifact = TransformArtifactV0Schema.safeParse(
          signedTransformArtifact?.transformArtifact,
        );
        if (!parsedArtifact.success) {
          return validationError(reply, "Registered signed transform content is invalid.");
        }
        const exactTransformSha256 = runtimeTransformArtifactSha256(parsedArtifact.data);
        const requestedTransformSha256 = runtimeQaRecordSignedTransformArtifactSha256(input.record);
        if (
          requestedTransformSha256 !== null &&
          requestedTransformSha256 !== exactTransformSha256
        ) {
          return validationError(
            reply,
            "Runtime QA signed transform SHA-256 does not match the registered transform content.",
          );
        }
        boundRecord = RuntimeQaRecordV0Schema.parse({
          ...input.record,
          viewTransform: {
            ...input.record.viewTransform,
            signedTransformArtifactSha256: exactTransformSha256,
          },
        });
      }

      const values = {
        runtimePackageId: input.runtimePackageId,
        venueSlug: input.venueSlug,
        roomSlug: input.roomSlug,
        recordId: boundRecord.recordId,
        recordJson: boundRecord,
        signedTransformArtifactId: runtimeQaRecordSignedTransformArtifactId(boundRecord),
        publicExposureDecision: boundRecord.publicExposure.decision,
        assetEvidenceStatus: boundRecord.assetEvidenceStatus,
        runtimeStatus: boundRecord.runtimeStatus,
        reviewedBy: request.user.id,
        updatedAt: new Date(),
      };

      const existingRecord = await findRuntimeQaRecordByImmutableKey(
        db,
        input.runtimePackageId,
        input.record.recordId,
      );

      if (existingRecord !== null) {
        if (!runtimeQaRecordRegistrationIsExactRetry(existingRecord, {
          runtimePackageId: input.runtimePackageId,
          venueSlug: input.venueSlug,
          roomSlug: input.roomSlug,
          record: boundRecord,
        })) {
          return reply.status(409).send({
            error: "A runtime QA record id is immutable; register a changed review under a new id",
            code: "RUNTIME_QA_RECORD_IMMUTABLE",
          });
        }
        return reply.status(200).send({ data: serializeRuntimeQaRecord(existingRecord) });
      }

      let record: RuntimeQaRecordRow | undefined;
      try {
        [record] = await db.insert(runtimeQaRecords).values(values).returning();
      } catch (error) {
        if (!isPostgresUniqueViolation(error)) throw error;
        const racedRecord = await findRuntimeQaRecordByImmutableKey(
          db,
          input.runtimePackageId,
          input.record.recordId,
        );
        if (racedRecord === null) throw error;
        if (!runtimeQaRecordRegistrationIsExactRetry(racedRecord, {
          runtimePackageId: input.runtimePackageId,
          venueSlug: input.venueSlug,
          roomSlug: input.roomSlug,
          record: boundRecord,
        })) {
          return reply.status(409).send({
            error: "A runtime QA record id is immutable; register a changed review under a new id",
            code: "RUNTIME_QA_RECORD_IMMUTABLE",
          });
        }
        return reply.status(200).send({ data: serializeRuntimeQaRecord(racedRecord) });
      }

      if (record === undefined) {
        return reply.status(500).send({
          error: "Failed to register runtime QA record",
          code: "RUNTIME_QA_RECORD_REGISTER_FAILED",
        });
      }

      request.log.info({
        userId: request.user.id,
        runtimePackageId: record.runtimePackageId,
        runtimeQaRecordId: record.id,
        recordId: record.recordId,
        venueSlug: record.venueSlug,
        roomSlug: record.roomSlug,
        publicExposureDecision: record.publicExposureDecision,
      }, "runtime QA record registered");

      return reply.status(201).send({ data: serializeRuntimeQaRecord(record) });
    },
  );

  server.get(
    "/runtime-qa-records",
    { preHandler: [authenticate, authorizePlatformAdmin()] },
    async (request, reply) => {
      const parsedQuery = RuntimeQaRecordQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return validationError(reply, parsedQuery.error.issues);
      }

      const rows = await db
        .select()
        .from(runtimeQaRecords)
        .where(eq(runtimeQaRecords.runtimePackageId, parsedQuery.data.runtimePackageId))
        .orderBy(desc(runtimeQaRecords.updatedAt), desc(runtimeQaRecords.createdAt));

      return { data: rows.map(serializeRuntimeQaRecord) };
    },
  );

  server.get(
    "/room-manifests",
    { preHandler: [authenticate, authorizePlatformAdmin()] },
    async (request, reply) => {
      const parsedQuery = RoomManifestQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return validationError(reply, parsedQuery.error.issues);
      }

      const filters = parsedQuery.data.venue === undefined
        ? undefined
        : parsedQuery.data.room === undefined
          ? eq(roomManifests.venueSlug, parsedQuery.data.venue)
          : and(
            eq(roomManifests.venueSlug, parsedQuery.data.venue),
            eq(roomManifests.roomSlug, parsedQuery.data.room),
          );

      const baseQuery = db.select().from(roomManifests);
      const rows = filters === undefined
        ? await baseQuery.orderBy(roomManifests.venueSlug, roomManifests.roomSlug)
        : await baseQuery.where(filters).orderBy(roomManifests.venueSlug, roomManifests.roomSlug);

      return { data: rows.map(serializeRoomManifest) };
    },
  );
}
