import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  RegisterRuntimePackageInputSchema,
  RuntimePackageContentDigestSchema,
  RuntimePackageManifestJsonSchema,
  RuntimePackagePreviewSchema,
  type ReviewedRuntimeProfileId,
  type RuntimePackagePreview,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { assetVersions, runtimePackages } from "../db/schema.js";
import type { Env } from "../env.js";
import {
  canonicalRuntimeAssetStorageKey,
  runtimeAssetStorageKeySha256,
} from "../lib/runtime-asset-receipt.js";
import { matchReceptionReviewedRuntimeProfile } from "../lib/reception-reviewed-runtime-profile.js";
import { authenticate, authorizePlatformAdmin } from "../middleware/auth.js";
import { computeRuntimePackageRevisionDigest } from "../services/runtime-package-revisions.js";
import {
  bindPublicRuntimeProfileTransferToResponse,
  resolveRuntimeVisualAssetComposition,
  type AssetVersionRow,
  type RuntimePackageRow,
} from "./assets.js";

const PreviewPackageParamsSchema = z.object({
  runtimePackageId: z.string().uuid(),
}).strict();

const PreviewAssetParamsSchema = PreviewPackageParamsSchema.extend({
  assetVersionId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(255),
}).strict();

export interface RuntimePackagePreviewSource {
  readonly runtimePackage: RuntimePackageRow;
  readonly candidateVisualAssets: readonly AssetVersionRow[];
}

export interface RuntimePackagePreviewObject {
  readonly body: Readable;
  readonly contentLength: number;
  readonly contentType: string | null;
  readonly etag: string | null;
}

type PreviewSourceLoader = (
  runtimePackageId: string,
) => Promise<RuntimePackagePreviewSource | null>;
type PreviewObjectLoader = (
  r2Key: string,
  signal: AbortSignal,
) => Promise<RuntimePackagePreviewObject | null>;

export interface RuntimePackagePreviewRoutesOptions {
  readonly db: Database;
  readonly env: Env;
  /** Deterministic test seam. Production performs the exact database lookup. */
  readonly loadPreviewSource?: PreviewSourceLoader;
  /** Deterministic test seam. Production streams the exact protected R2 object. */
  readonly loadRuntimeAssetObject?: PreviewObjectLoader;
  readonly now?: () => Date;
}

let cachedPreviewS3: import("@aws-sdk/client-s3").S3Client | null = null;
const MAX_VERIFIED_PREVIEW_ASSET_BYTES = 16 * 1024 * 1024;
const MAX_CONCURRENT_VERIFIED_PREVIEW_TRANSFERS = 4;
const VERIFIED_PREVIEW_UPSTREAM_TIMEOUT_MS = 60_000;
let activeVerifiedPreviewTransfers = 0;

export function previewStorageConfigured(env: Env): boolean {
  return env.RUNTIME_PROFILE_R2_ACCOUNT_ID !== undefined &&
    env.RUNTIME_PROFILE_R2_ACCESS_KEY_ID !== undefined &&
    env.RUNTIME_PROFILE_R2_SECRET_ACCESS_KEY !== undefined &&
    env.RUNTIME_PROFILE_R2_PRIVATE_BUCKET !== undefined;
}

function r2ObjectKey(r2Key: string): string {
  return canonicalRuntimeAssetStorageKey(r2Key);
}

function tryAcquireVerifiedPreviewTransfer(): (() => void) | null {
  if (activeVerifiedPreviewTransfers >= MAX_CONCURRENT_VERIFIED_PREVIEW_TRANSFERS) return null;
  activeVerifiedPreviewTransfers += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeVerifiedPreviewTransfers -= 1;
  };
}

async function previewS3Client(env: Env): Promise<import("@aws-sdk/client-s3").S3Client> {
  if (cachedPreviewS3 !== null) return cachedPreviewS3;
  const { S3Client } = await import("@aws-sdk/client-s3");
  cachedPreviewS3 = new S3Client({
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
  return cachedPreviewS3;
}

async function loadProtectedRuntimeAssetObject(
  env: Env,
  r2Key: string,
  signal: AbortSignal,
): Promise<RuntimePackagePreviewObject | null> {
  if (!previewStorageConfigured(env)) return null;
  const key = r2ObjectKey(r2Key);
  if (key.length === 0) return null;

  const s3 = await previewS3Client(env);
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const object = await s3.send(
    new GetObjectCommand({
      Bucket: env.RUNTIME_PROFILE_R2_PRIVATE_BUCKET,
      Key: key,
    }),
    { abortSignal: signal },
  );
  if (!(object.Body instanceof Readable)) {
    const possibleBody = object.Body as { destroy?: () => void } | undefined;
    possibleBody?.destroy?.();
    return null;
  }
  if (object.ContentLength === undefined) {
    object.Body.destroy();
    return null;
  }
  return {
    body: object.Body,
    contentLength: object.ContentLength,
    contentType: object.ContentType ?? null,
    etag: object.ETag ?? null,
  };
}

function declaredVisualAssetIds(pkg: RuntimePackageRow): readonly string[] {
  const parsed = RuntimePackageManifestJsonSchema.safeParse(pkg.manifestJson);
  if (!parsed.success) return [];
  const declared = parsed.data.assets.visualAssetVersionIds;
  if (declared !== undefined) return declared;
  return pkg.primaryVisualAssetVersionId === null ? [] : [pkg.primaryVisualAssetVersionId];
}

async function loadExactPreviewSource(
  db: Database,
  runtimePackageId: string,
): Promise<RuntimePackagePreviewSource | null> {
  const [runtimePackage] = await db
    .select()
    .from(runtimePackages)
    .where(eq(runtimePackages.id, runtimePackageId))
    .limit(1);
  if (runtimePackage === undefined) return null;

  const declaredIds = declaredVisualAssetIds(runtimePackage);
  const candidateVisualAssets = declaredIds.length === 0
    ? []
    : await db
      .select()
      .from(assetVersions)
      .where(inArray(assetVersions.id, [...declaredIds]));
  return { runtimePackage, candidateVisualAssets };
}

function iso(value: Date): string {
  return value.toISOString();
}

function immutablePreviewEligibilityError(pkg: RuntimePackageRow): string | null {
  if (
    pkg.identityKind !== "content_sha256" ||
    !RuntimePackageContentDigestSchema.safeParse(pkg.contentDigest).success
  ) {
    return "RUNTIME_PACKAGE_PREVIEW_NOT_IMMUTABLE";
  }
  const storedInput = RegisterRuntimePackageInputSchema.safeParse({
    venueSlug: pkg.venueSlug,
    roomSlug: pkg.roomSlug,
    primaryVisualAssetVersionId: pkg.primaryVisualAssetVersionId,
    semanticMeshAssetVersionId: pkg.semanticMeshAssetVersionId,
    collisionAssetVersionId: pkg.collisionAssetVersionId,
    pointCloudAssetVersionId: pkg.pointCloudAssetVersionId,
    manifestJson: pkg.manifestJson,
    evidenceStatus: pkg.evidenceStatus,
    runtimeStatus: pkg.runtimeStatus,
  });
  if (
    !storedInput.success ||
    computeRuntimePackageRevisionDigest(storedInput.data) !== pkg.contentDigest
  ) {
    return "RUNTIME_PACKAGE_PREVIEW_NOT_IMMUTABLE";
  }
  if (
    (pkg.runtimeStatus !== "internal_ready" && pkg.runtimeStatus !== "published") ||
    pkg.evidenceStatus === "rejected" ||
    pkg.primaryVisualAssetVersionId === null
  ) {
    return "RUNTIME_PACKAGE_PREVIEW_NOT_LOADABLE";
  }
  return null;
}

function protectedStorageError(assets: readonly AssetVersionRow[]): string | null {
  const keys: string[] = [];
  for (const asset of assets) {
    if (
      asset.externalUrl !== null ||
      asset.r2Key === null ||
      r2ObjectKey(asset.r2Key).length === 0 ||
      asset.sizeBytes === null ||
      asset.sizeBytes <= 0 ||
      asset.sizeBytes > MAX_VERIFIED_PREVIEW_ASSET_BYTES ||
      !RuntimePackageContentDigestSchema.safeParse(asset.sha256).success ||
      (asset.fileExt !== ".sog" && asset.fileExt !== ".spz")
    ) {
      return "RUNTIME_PACKAGE_PREVIEW_STORAGE_INVALID";
    }
    keys.push(r2ObjectKey(asset.r2Key));
  }
  return new Set(keys).size === keys.length
    ? null
    : "RUNTIME_PACKAGE_PREVIEW_STORAGE_INVALID";
}

function immutableCompositionReceiptError(
  pkg: RuntimePackageRow,
  assets: readonly AssetVersionRow[],
): string | null {
  const manifest = RuntimePackageManifestJsonSchema.safeParse(pkg.manifestJson);
  if (!manifest.success) return "RUNTIME_PACKAGE_PREVIEW_RECEIPTS_INVALID";
  const receipts = manifest.data.assets.visualAssetReceipts;
  if (receipts === undefined || receipts.length !== assets.length) {
    return "RUNTIME_PACKAGE_PREVIEW_RECEIPTS_REQUIRED";
  }

  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index];
    const receipt = receipts[index];
    if (
      asset === undefined ||
      receipt === undefined ||
      asset.r2Key === null ||
      receipt.assetVersionId !== asset.id ||
      receipt.fileName !== asset.fileName ||
      receipt.fileExt !== asset.fileExt ||
      receipt.sha256 !== asset.sha256 ||
      receipt.sizeBytes !== asset.sizeBytes ||
      receipt.storageKeySha256 !== runtimeAssetStorageKeySha256(asset.r2Key)
    ) {
      return "RUNTIME_PACKAGE_PREVIEW_RECEIPTS_INVALID";
    }
  }
  return null;
}

async function readVerifiedPreviewBytes(
  object: RuntimePackagePreviewObject,
  expectedSize: number,
  expectedSha256: string,
  signal: AbortSignal,
): Promise<Buffer | null> {
  const verifiedBytes = Buffer.allocUnsafe(expectedSize);
  let received = 0;
  const hash = createHash("sha256");

  try {
    for await (const chunk of object.body) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const bytes = typeof chunk === "string"
        ? Buffer.from(chunk)
        : Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk as Uint8Array);
      received += bytes.byteLength;
      if (received > expectedSize || received > MAX_VERIFIED_PREVIEW_ASSET_BYTES) {
        return null;
      }
      bytes.copy(verifiedBytes, received - bytes.byteLength);
      hash.update(bytes);
    }
    if (received !== expectedSize || hash.digest("hex") !== expectedSha256) return null;
    return verifiedBytes;
  } finally {
    if (!object.body.destroyed) object.body.destroy();
  }
}

function assemblePreview(
  pkg: RuntimePackageRow,
  visualAssets: readonly AssetVersionRow[],
  reviewedProfileId: ReviewedRuntimeProfileId | null,
  issuedAt: Date,
): RuntimePackagePreview | null {
  if (pkg.contentDigest === null) return null;
  const preview = RuntimePackagePreviewSchema.safeParse({
    scope: "exact_private_runtime_package_preview",
    runtimePackageId: pkg.id,
    venueSlug: pkg.venueSlug,
    roomSlug: pkg.roomSlug,
    revision: pkg.revision,
    identityKind: pkg.identityKind,
    contentDigest: pkg.contentDigest,
    manifestJson: pkg.manifestJson,
    evidenceStatus: pkg.evidenceStatus,
    runtimeStatus: pkg.runtimeStatus,
    reviewedProfileId,
    issuedAt: iso(issuedAt),
    visualAssets: visualAssets.map((asset) => ({
      assetVersionId: asset.id,
      fileName: asset.fileName,
      fileExt: asset.fileExt,
      sha256: asset.sha256,
      sizeBytes: asset.sizeBytes,
    })),
  });
  return preview.success ? preview.data : null;
}

function resolveEligibleComposition(
  source: RuntimePackagePreviewSource,
  requestedId: string,
):
  | {
      readonly ok: true;
      readonly pkg: RuntimePackageRow;
      readonly assets: readonly AssetVersionRow[];
      readonly reviewedProfileId: ReviewedRuntimeProfileId | null;
    }
  | { readonly ok: false; readonly status: 404 | 409; readonly code: string; readonly message: string } {
  const pkg = source.runtimePackage;
  if (pkg.id !== requestedId) {
    return {
      ok: false,
      status: 404,
      code: "RUNTIME_PACKAGE_PREVIEW_NOT_FOUND",
      message: "Runtime package preview was not found",
    };
  }
  const eligibilityError = immutablePreviewEligibilityError(pkg);
  if (eligibilityError !== null) {
    return {
      ok: false,
      status: 409,
      code: eligibilityError,
      message: "Runtime package is not eligible for exact private preview",
    };
  }
  const assets = resolveRuntimeVisualAssetComposition(pkg, source.candidateVisualAssets);
  if (assets === null || assets.length === 0) {
    return {
      ok: false,
      status: 409,
      code: "RUNTIME_PACKAGE_PREVIEW_COMPOSITION_INVALID",
      message: "Runtime package visual composition is incomplete or inconsistent",
    };
  }
  const storageError = protectedStorageError(assets);
  if (storageError !== null) {
    return {
      ok: false,
      status: 409,
      code: storageError,
      message: "Runtime package does not have a complete protected visual asset set",
    };
  }
  const receiptError = immutableCompositionReceiptError(pkg, assets);
  if (receiptError !== null) {
    return {
      ok: false,
      status: 409,
      code: receiptError,
      message: "Runtime package visual members do not match immutable package receipts",
    };
  }
  const reviewedProfileId = matchReceptionReviewedRuntimeProfile(pkg, assets);
  if (
    pkg.venueSlug === "trades-hall" &&
    pkg.roomSlug === "reception-room" &&
    reviewedProfileId === null
  ) {
    return {
      ok: false,
      status: 409,
      code: "RUNTIME_PACKAGE_PREVIEW_PROFILE_UNAPPROVED",
      message: "Reception runtime package does not match a reviewed profile",
    };
  }
  return { ok: true, pkg, assets, reviewedProfileId };
}

function validationFailure(details: unknown): {
  readonly error: string;
  readonly code: string;
  readonly details: unknown;
} {
  return {
    error: "Valid immutable package and asset identifiers are required",
    code: "VALIDATION_ERROR",
    details,
  };
}

export async function runtimePackagePreviewRoutes(
  server: FastifyInstance,
  opts: RuntimePackagePreviewRoutesOptions,
): Promise<void> {
  const loadSource = opts.loadPreviewSource ?? ((id: string) => loadExactPreviewSource(opts.db, id));
  const loadObject = opts.loadRuntimeAssetObject ?? ((key: string, signal: AbortSignal) =>
    loadProtectedRuntimeAssetObject(opts.env, key, signal));
  const now = opts.now ?? (() => new Date());

  server.get(
    "/runtime-package-previews/:runtimePackageId",
    { preHandler: [authenticate, authorizePlatformAdmin()] },
    async (request, reply) => {
      const parsed = PreviewPackageParamsSchema.safeParse(request.params);
      if (!parsed.success) return reply.status(400).send(validationFailure(parsed.error.issues));

      try {
        const source = await loadSource(parsed.data.runtimePackageId);
        if (source === null) {
          return reply.status(404).send({
            error: "Runtime package preview was not found",
            code: "RUNTIME_PACKAGE_PREVIEW_NOT_FOUND",
          });
        }
        const composition = resolveEligibleComposition(source, parsed.data.runtimePackageId);
        if (!composition.ok) {
          return reply.status(composition.status).send({
            error: composition.message,
            code: composition.code,
          });
        }
        const preview = assemblePreview(
          composition.pkg,
          composition.assets,
          composition.reviewedProfileId,
          now(),
        );
        if (preview === null) {
          return reply.status(500).send({
            error: "Runtime package preview response failed its integrity contract",
            code: "RUNTIME_PACKAGE_PREVIEW_SERIALIZATION_FAILED",
          });
        }

        request.log.info({
          userId: request.user.id,
          runtimePackageId: composition.pkg.id,
          revision: composition.pkg.revision,
          contentDigest: composition.pkg.contentDigest,
          visualAssetVersionIds: composition.assets.map((asset) => asset.id),
        }, "exact authenticated runtime package preview resolved");
        return reply
          .header("cache-control", "private, no-store, max-age=0")
          .header("pragma", "no-cache")
          .header("vary", "Origin, Authorization")
          .send({ data: preview });
      } catch (error: unknown) {
        request.log.warn({ err: error }, "exact runtime package preview metadata failed");
        return reply.status(502).send({
          error: "Runtime package preview could not be resolved",
          code: "RUNTIME_PACKAGE_PREVIEW_RESOLUTION_FAILED",
        });
      }
    },
  );

  server.get(
    "/runtime-package-previews/:runtimePackageId/assets/:assetVersionId/:fileName",
    { preHandler: [authenticate, authorizePlatformAdmin()] },
    async (request, reply) => {
      const parsed = PreviewAssetParamsSchema.safeParse(request.params);
      if (!parsed.success) return reply.status(400).send(validationFailure(parsed.error.issues));

      const upstreamController = new AbortController();
      let clientDisconnected = false;
      const abortForClientDisconnect = (): void => {
        if (reply.raw.writableFinished) return;
        clientDisconnected = true;
        upstreamController.abort(
          new DOMException("Runtime preview client disconnected", "AbortError"),
        );
      };
      // Register before the database lookup so a disconnect cannot be missed
      // and later turn into an orphaned verified-transfer slot.
      reply.raw.once("close", abortForClientDisconnect);
      let markWorkSettled: (() => void) | null = null;
      try {
        const source = await loadSource(parsed.data.runtimePackageId);
        if (clientDisconnected || reply.raw.destroyed) return reply;
        if (source === null) {
          return reply.status(404).send({
            error: "Runtime preview asset was not found",
            code: "RUNTIME_PACKAGE_PREVIEW_ASSET_NOT_FOUND",
          });
        }
        const composition = resolveEligibleComposition(source, parsed.data.runtimePackageId);
        if (!composition.ok) {
          return reply.status(composition.status).send({
            error: composition.message,
            code: composition.code,
          });
        }
        const asset = composition.assets.find((candidate) =>
          candidate.id === parsed.data.assetVersionId &&
          candidate.fileName === parsed.data.fileName,
        );
        if (
          asset === undefined ||
          asset.r2Key === null ||
          asset.sizeBytes === null ||
          asset.sha256 === null
        ) {
          return reply.status(404).send({
            error: "Runtime preview asset was not found in the exact package",
            code: "RUNTIME_PACKAGE_PREVIEW_ASSET_NOT_FOUND",
          });
        }

        const releaseTransfer = tryAcquireVerifiedPreviewTransfer();
        if (releaseTransfer === null) {
          if (clientDisconnected || reply.raw.destroyed) return reply;
          return reply
            .header("retry-after", "1")
            .header("cache-control", "private, no-store, max-age=0")
            .status(429)
            .send({
              error: "Private runtime preview is busy; try again shortly",
              code: "RUNTIME_PACKAGE_PREVIEW_BUSY",
            });
        }
        if (clientDisconnected || reply.raw.destroyed) {
          releaseTransfer();
          return reply;
        }
        let activeBody: Readable | null = null;
        const abortUpstream = (): void => {
          upstreamController.abort();
          if (activeBody !== null && !activeBody.destroyed) activeBody.destroy();
        };
        markWorkSettled = bindPublicRuntimeProfileTransferToResponse(
          reply.raw,
          releaseTransfer,
          abortUpstream,
        );
        reply.raw.off("close", abortForClientDisconnect);
        const upstreamDeadline = setTimeout(
          abortUpstream,
          VERIFIED_PREVIEW_UPSTREAM_TIMEOUT_MS,
        );
        upstreamDeadline.unref();

        let object: RuntimePackagePreviewObject;
        let verifiedBytes: Buffer;
        try {
          const loadedObject = await loadObject(asset.r2Key, upstreamController.signal);
          activeBody = loadedObject?.body instanceof Readable ? loadedObject.body : null;
          if (
            loadedObject === null ||
            !(loadedObject.body instanceof Readable) ||
            loadedObject.contentLength !== asset.sizeBytes
          ) {
            if (loadedObject?.body instanceof Readable) loadedObject.body.destroy();
            return reply.status(502).send({
              error: "Protected runtime preview asset failed its registered size check",
              code: "RUNTIME_PACKAGE_PREVIEW_ASSET_INTEGRITY_FAILED",
            });
          }

          const verified = await readVerifiedPreviewBytes(
            loadedObject,
            asset.sizeBytes,
            asset.sha256,
            upstreamController.signal,
          );
          if (verified === null) {
            return reply.status(502).send({
              error: "Protected runtime preview asset failed its registered byte fingerprint check",
              code: "RUNTIME_PACKAGE_PREVIEW_ASSET_INTEGRITY_FAILED",
            });
          }
          object = loadedObject;
          verifiedBytes = verified;
        } finally {
          clearTimeout(upstreamDeadline);
          if (activeBody !== null && !activeBody.destroyed) activeBody.destroy();
          activeBody = null;
        }

        request.log.info({
          userId: request.user.id,
          runtimePackageId: composition.pkg.id,
          assetVersionId: asset.id,
          sizeBytes: asset.sizeBytes,
        }, "authenticated runtime package preview asset streamed");

        reply
          .header("content-type", asset.mimeType ?? object.contentType ?? "application/octet-stream")
          .header("content-length", String(object.contentLength))
          .header("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`)
          .header("cache-control", "private, no-store, max-age=0")
          .header("pragma", "no-cache")
          .header("vary", "Origin, Authorization")
          .header("x-content-sha256", asset.sha256)
          .header("x-content-type-options", "nosniff")
          .header("cross-origin-resource-policy", "same-site");
        if (object.etag !== null) reply.header("etag", object.etag);
        return reply.send(verifiedBytes);
      } catch (error: unknown) {
        if (reply.raw.destroyed || clientDisconnected) return reply;
        request.log.warn({ err: error }, "authenticated runtime package preview asset failed");
        return reply.status(502).send({
          error: "Runtime preview asset could not be streamed",
          code: "RUNTIME_PACKAGE_PREVIEW_ASSET_STREAM_FAILED",
        });
      } finally {
        reply.raw.off("close", abortForClientDisconnect);
        markWorkSettled?.();
      }
    },
  );
}
