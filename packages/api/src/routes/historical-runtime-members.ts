import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  CanonicalLayoutSnapshotV0Schema,
  PhaseLayoutRuntimeAvailableBindingSchema,
  RegisterRuntimePackageInputSchema,
  RuntimePackageManifestJsonSchema,
  canonicalLayoutSnapshotDigest,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import {
  assetVersions,
  eventPhases,
  phaseLayoutSnapshots,
  runtimePackages,
  runtimePresentationAdmissionMembers,
  runtimePresentationAdmissions,
  spaces,
  venues,
} from "../db/schema.js";
import type { Env } from "../env.js";
import { runtimeAssetStorageKeySha256 } from "../lib/runtime-asset-receipt.js";
import { authenticate } from "../middleware/auth.js";
import {
  MAX_HISTORICAL_RUNTIME_MEMBER_BYTES,
  RuntimePresentationAdmissionBodySchema,
  runtimePackageManifestDigest,
  runtimePresentationAdmissionDigest,
} from "../services/phase-layout-runtime-admission.js";
import { computeRuntimePackageRevisionDigest } from "../services/runtime-package-revisions.js";
import { canReadVenuePlanningData } from "../utils/query.js";
import { bindPublicRuntimeProfileTransferToResponse } from "./assets.js";

const HistoricalRuntimeMemberParamsSchema = z.object({
  venueId: z.string().uuid(),
  spaceId: z.string().uuid(),
  bindingId: z.string().uuid(),
  memberIndex: z.coerce.number().int().nonnegative().max(7),
  fileName: z.string().trim().min(1).max(255).regex(/^[^/\\]+$/u),
}).strict();

export type HistoricalRuntimeMemberByteLoader = (
  storageKey: string,
  expectedSizeBytes: number,
  signal: AbortSignal,
) => Promise<Buffer>;

interface HistoricalRuntimeMemberDescriptor {
  readonly bindingDigest: string;
  readonly runtimePackageContentDigest: string;
  readonly assetVersionId: string;
  readonly memberIndex: number;
  readonly fileName: string;
  readonly fileExt: ".sog" | ".spz";
  readonly mimeType: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly storageKey: string;
  readonly storageKeySha256: string;
}

let cachedS3: import("@aws-sdk/client-s3").S3Client | null = null;
const MAX_CONCURRENT_HISTORICAL_RUNTIME_TRANSFERS = 4;
const HISTORICAL_RUNTIME_UPSTREAM_TIMEOUT_MS = 60_000;
let activeHistoricalRuntimeTransfers = 0;

export function tryAcquireHistoricalRuntimeTransfer(): (() => void) | null {
  if (activeHistoricalRuntimeTransfers >= MAX_CONCURRENT_HISTORICAL_RUNTIME_TRANSFERS) {
    return null;
  }
  activeHistoricalRuntimeTransfers += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeHistoricalRuntimeTransfers -= 1;
  };
}

function runtimeProfileR2Configured(env: Env): boolean {
  return env.RUNTIME_PROFILE_R2_ACCOUNT_ID !== undefined &&
    env.RUNTIME_PROFILE_R2_ACCESS_KEY_ID !== undefined &&
    env.RUNTIME_PROFILE_R2_SECRET_ACCESS_KEY !== undefined &&
    env.RUNTIME_PROFILE_R2_PRIVATE_BUCKET !== undefined;
}

async function s3Client(env: Env): Promise<import("@aws-sdk/client-s3").S3Client> {
  if (cachedS3 !== null) return cachedS3;
  const { S3Client } = await import("@aws-sdk/client-s3");
  cachedS3 = new S3Client({
    region: "auto",
    endpoint: `https://${env.RUNTIME_PROFILE_R2_ACCOUNT_ID ?? ""}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.RUNTIME_PROFILE_R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: env.RUNTIME_PROFILE_R2_SECRET_ACCESS_KEY ?? "",
    },
  });
  return cachedS3;
}

function privateObjectKey(storageKey: string): string {
  return storageKey.replace(/^r2:/u, "").replace(/^\/+/u, "");
}

function historicalRuntimeAbortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Historical runtime transfer was cancelled", "AbortError");
}

export async function readBoundedHistoricalRuntimeMember(
  body: Readable,
  expectedSizeBytes: number,
  signal: AbortSignal,
): Promise<Buffer> {
  if (
    !Number.isSafeInteger(expectedSizeBytes) || expectedSizeBytes <= 0 ||
    expectedSizeBytes > MAX_HISTORICAL_RUNTIME_MEMBER_BYTES
  ) {
    body.destroy();
    throw new Error("Historical runtime member exceeds the verified byte limit");
  }
  const abortBody = (): void => {
    if (!body.destroyed) body.destroy(historicalRuntimeAbortError(signal));
  };
  signal.addEventListener("abort", abortBody, { once: true });
  if (signal.aborted) abortBody();
  const bytes = Buffer.allocUnsafe(expectedSizeBytes);
  let offset = 0;
  try {
    for await (const chunk of body) {
      const part = typeof chunk === "string"
        ? Buffer.from(chunk)
        : Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk as Uint8Array);
      if (offset + part.byteLength > expectedSizeBytes) {
        throw new Error("Historical runtime member exceeded its exact size");
      }
      part.copy(bytes, offset);
      offset += part.byteLength;
    }
  } finally {
    signal.removeEventListener("abort", abortBody);
    if (!body.destroyed) body.destroy();
  }
  if (offset !== expectedSizeBytes) {
    throw new Error("Historical runtime member did not match its exact size");
  }
  return bytes;
}

function productionLoader(env: Env): HistoricalRuntimeMemberByteLoader {
  return async (storageKey, expectedSizeBytes, signal) => {
    if (!runtimeProfileR2Configured(env)) {
      throw new Error("Historical runtime private storage is not configured");
    }
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await s3Client(env);
    const object = await client.send(
      new GetObjectCommand({
        Bucket: env.RUNTIME_PROFILE_R2_PRIVATE_BUCKET,
        Key: privateObjectKey(storageKey),
      }),
      { abortSignal: signal },
    );
    if (!(object.Body instanceof Readable)) {
      const possibleBody = object.Body as { destroy?: () => void } | undefined;
      possibleBody?.destroy?.();
      throw new Error("Historical runtime member was not a server byte stream");
    }
    return readBoundedHistoricalRuntimeMember(object.Body, expectedSizeBytes, signal);
  };
}

function notFound(reply: FastifyReply): FastifyReply {
  return reply.status(404).send({ error: "Historical runtime member not found", code: "NOT_FOUND" });
}

function sameDescriptor(
  left: HistoricalRuntimeMemberDescriptor,
  right: HistoricalRuntimeMemberDescriptor,
): boolean {
  return left.bindingDigest === right.bindingDigest &&
    left.runtimePackageContentDigest === right.runtimePackageContentDigest &&
    left.assetVersionId === right.assetVersionId &&
    left.memberIndex === right.memberIndex &&
    left.fileName === right.fileName &&
    left.fileExt === right.fileExt &&
    left.mimeType === right.mimeType &&
    left.sha256 === right.sha256 &&
    left.sizeBytes === right.sizeBytes &&
    left.storageKeySha256 === right.storageKeySha256 &&
    runtimeAssetStorageKeySha256(left.storageKey) === runtimeAssetStorageKeySha256(right.storageKey);
}

async function resolveMemberDescriptor(
  db: Database,
  params: z.infer<typeof HistoricalRuntimeMemberParamsSchema>,
): Promise<HistoricalRuntimeMemberDescriptor | null> {
  const [row] = await db.select({
    snapshot: phaseLayoutSnapshots,
    pkg: runtimePackages,
    admission: runtimePresentationAdmissions,
    venueSlug: venues.slug,
    spaceSlug: spaces.slug,
  }).from(phaseLayoutSnapshots)
    .innerJoin(eventPhases, eq(phaseLayoutSnapshots.eventPhaseId, eventPhases.id))
    .innerJoin(spaces, eq(eventPhases.spaceId, spaces.id))
    .innerJoin(venues, eq(spaces.venueId, venues.id))
    .innerJoin(runtimePackages, and(
      eq(phaseLayoutSnapshots.runtimePackageId, runtimePackages.id),
      eq(phaseLayoutSnapshots.runtimeVenueSlug, runtimePackages.venueSlug),
      eq(phaseLayoutSnapshots.runtimeRoomSlug, runtimePackages.roomSlug),
      eq(phaseLayoutSnapshots.runtimePackageContentDigest, runtimePackages.contentDigest),
    ))
    .innerJoin(runtimePresentationAdmissions, and(
      eq(phaseLayoutSnapshots.runtimePresentationAdmissionId, runtimePresentationAdmissions.id),
      eq(phaseLayoutSnapshots.runtimePackageId, runtimePresentationAdmissions.runtimePackageId),
      eq(
        phaseLayoutSnapshots.runtimePackageContentDigest,
        runtimePresentationAdmissions.runtimePackageContentDigest,
      ),
      eq(phaseLayoutSnapshots.runtimeVenueSlug, runtimePresentationAdmissions.venueSlug),
      eq(phaseLayoutSnapshots.runtimeRoomSlug, runtimePresentationAdmissions.roomSlug),
      eq(phaseLayoutSnapshots.runtimeManifestDigest, runtimePresentationAdmissions.runtimeManifestDigest),
      eq(
        phaseLayoutSnapshots.runtimePresentationAdmissionDigest,
        runtimePresentationAdmissions.admissionDigest,
      ),
    ))
    .where(and(
      eq(phaseLayoutSnapshots.id, params.bindingId),
      eq(phaseLayoutSnapshots.runtimeBindingState, "available"),
      eq(phaseLayoutSnapshots.runtimePresentationAdmissionDecision, "approved"),
      eq(runtimePresentationAdmissions.decision, "approved"),
      eq(venues.id, params.venueId),
      eq(spaces.id, params.spaceId),
      isNull(venues.deletedAt),
      isNull(spaces.deletedAt),
    )).limit(1);
  if (row === undefined) return null;

  const binding = PhaseLayoutRuntimeAvailableBindingSchema.safeParse(row.snapshot.runtimeBinding);
  const payload = CanonicalLayoutSnapshotV0Schema.safeParse(row.snapshot.payload);
  const manifest = RuntimePackageManifestJsonSchema.safeParse(row.pkg.manifestJson);
  const packageInput = RegisterRuntimePackageInputSchema.safeParse({
    venueSlug: row.pkg.venueSlug,
    roomSlug: row.pkg.roomSlug,
    primaryVisualAssetVersionId: row.pkg.primaryVisualAssetVersionId,
    semanticMeshAssetVersionId: row.pkg.semanticMeshAssetVersionId,
    collisionAssetVersionId: row.pkg.collisionAssetVersionId,
    pointCloudAssetVersionId: row.pkg.pointCloudAssetVersionId,
    manifestJson: row.pkg.manifestJson,
    evidenceStatus: row.pkg.evidenceStatus,
    runtimeStatus: row.pkg.runtimeStatus,
  });
  const admissionBody = RuntimePresentationAdmissionBodySchema.safeParse(row.admission.admissionBody);
  if (
    !binding.success || !payload.success || !manifest.success || !packageInput.success ||
    !admissionBody.success || row.snapshot.runtimeBindingDigest === null ||
    row.snapshot.runtimePackageContentDigest === null || row.pkg.contentDigest === null ||
    row.snapshot.frozenAt === null || row.snapshot.frozenBy === null ||
    binding.data.bindingId !== row.snapshot.id ||
    binding.data.bindingDigest !== row.snapshot.runtimeBindingDigest ||
    binding.data.canonicalSnapshotId !== row.snapshot.canonicalSnapshotId ||
    binding.data.snapshotHash !== row.snapshot.snapshotHash ||
    binding.data.boundBy !== row.snapshot.frozenBy ||
    new Date(binding.data.boundAt).getTime() !== row.snapshot.frozenAt.getTime() ||
    binding.data.venueId !== params.venueId || binding.data.spaceId !== params.spaceId ||
    binding.data.venueSlug !== row.venueSlug || binding.data.spaceSlug !== row.spaceSlug ||
    binding.data.runtimePackageId !== row.pkg.id ||
    binding.data.runtimePackageContentDigest !== row.pkg.contentDigest ||
    binding.data.runtimeManifestDigest !== row.snapshot.runtimeManifestDigest ||
    payload.data.venueRuntime.runtimePackageId !== row.pkg.id ||
    payload.data.venueRuntime.runtimeVenueManifestDigest !== row.snapshot.runtimeManifestDigest ||
    canonicalLayoutSnapshotDigest(payload.data) !== row.snapshot.snapshotHash ||
    row.pkg.identityKind !== "content_sha256" ||
    computeRuntimePackageRevisionDigest(packageInput.data) !== row.pkg.contentDigest ||
    runtimePackageManifestDigest(manifest.data) !== row.snapshot.runtimeManifestDigest ||
    runtimePresentationAdmissionDigest(admissionBody.data) !== row.admission.admissionDigest ||
    admissionBody.data.admissionId !== row.admission.id ||
    admissionBody.data.runtimePackageId !== row.admission.runtimePackageId ||
    admissionBody.data.runtimePackageContentDigest !== row.admission.runtimePackageContentDigest ||
    admissionBody.data.venueSlug !== row.admission.venueSlug ||
    admissionBody.data.roomSlug !== row.admission.roomSlug ||
    admissionBody.data.runtimeManifestDigest !== row.admission.runtimeManifestDigest ||
    admissionBody.data.reviewedProfileId !== row.admission.reviewedProfileId ||
    admissionBody.data.reviewedProfileManifestFingerprint !==
      row.admission.reviewedProfileManifestFingerprint ||
    admissionBody.data.runtimeQaRecordId !== row.admission.runtimeQaRecordId ||
    admissionBody.data.runtimeQaRecordKey !== row.admission.runtimeQaRecordKey ||
    admissionBody.data.runtimeQaRecordDigest !== row.admission.runtimeQaRecordDigest ||
    admissionBody.data.runtimeQaDecision !== row.admission.runtimeQaDecision ||
    admissionBody.data.runtimeQaReviewedBy !== row.admission.runtimeQaReviewedBy ||
    new Date(admissionBody.data.runtimeQaReviewedAt).getTime() !==
      row.admission.runtimeQaReviewedAt.getTime() ||
    admissionBody.data.runtimeTransformArtifactRowId !==
      row.admission.runtimeTransformArtifactRowId ||
    admissionBody.data.runtimeTransformArtifactId !== row.admission.runtimeTransformArtifactId ||
    admissionBody.data.runtimeTransformArtifactDigest !==
      row.admission.runtimeTransformArtifactDigest ||
    admissionBody.data.sceneAuthorityArtifactRowId !==
      row.admission.sceneAuthorityArtifactRowId ||
    admissionBody.data.sceneAuthorityArtifactKind !== row.admission.sceneAuthorityArtifactKind ||
    admissionBody.data.sceneAuthorityArtifactId !== row.admission.sceneAuthorityArtifactId ||
    admissionBody.data.sceneAuthorityMapDigest !== row.admission.sceneAuthorityMapDigest ||
    admissionBody.data.rightsEvidenceDigest !== row.admission.rightsEvidenceDigest ||
    admissionBody.data.memberCount !== row.admission.memberCount ||
    admissionBody.data.decision !== row.admission.decision ||
    admissionBody.data.reviewedBy !== row.admission.reviewedBy ||
    new Date(admissionBody.data.reviewedAt).getTime() !== row.admission.reviewedAt.getTime() ||
    row.admission.memberCount !== binding.data.visualAssets.length ||
    row.admission.reviewedAt > row.snapshot.frozenAt || row.admission.createdAt > row.snapshot.frozenAt
  ) return null;

  const memberRows = await db.select({
    member: runtimePresentationAdmissionMembers,
    asset: assetVersions,
  }).from(runtimePresentationAdmissionMembers)
    .innerJoin(assetVersions, and(
      eq(runtimePresentationAdmissionMembers.assetVersionId, assetVersions.id),
      eq(runtimePresentationAdmissionMembers.venueSlug, assetVersions.venueSlug),
      eq(runtimePresentationAdmissionMembers.roomSlug, assetVersions.roomSlug),
      eq(runtimePresentationAdmissionMembers.fileName, assetVersions.fileName),
      eq(runtimePresentationAdmissionMembers.fileExt, assetVersions.fileExt),
      eq(runtimePresentationAdmissionMembers.mimeType, assetVersions.mimeType),
      eq(runtimePresentationAdmissionMembers.sha256, assetVersions.sha256),
      eq(runtimePresentationAdmissionMembers.sizeBytes, assetVersions.sizeBytes),
    ))
    .where(eq(runtimePresentationAdmissionMembers.admissionId, row.admission.id))
    .orderBy(runtimePresentationAdmissionMembers.memberIndex);
  const declaredIds = manifest.data.assets.visualAssetVersionIds;
  const receipts = manifest.data.assets.visualAssetReceipts;
  if (
    declaredIds === undefined || receipts === undefined ||
    memberRows.length !== row.admission.memberCount ||
    memberRows.length !== binding.data.visualAssets.length ||
    memberRows.length !== declaredIds.length
  ) return null;

  for (const [index, memberRow] of memberRows.entries()) {
    const frozen = binding.data.visualAssets[index];
    const receipt = receipts[index];
    const { member, asset } = memberRow;
    if (
      frozen === undefined || receipt === undefined || member.memberIndex !== index ||
      frozen.memberIndex !== index || declaredIds[index] !== asset.id ||
      frozen.assetVersionId !== asset.id || frozen.fileName !== asset.fileName ||
      frozen.fileExt !== asset.fileExt || frozen.mimeType !== asset.mimeType ||
      frozen.sha256 !== asset.sha256 || frozen.sizeBytes !== asset.sizeBytes ||
      receipt.assetVersionId !== asset.id || receipt.fileName !== asset.fileName ||
      receipt.fileExt !== asset.fileExt || receipt.sha256 !== asset.sha256 ||
      receipt.sizeBytes !== asset.sizeBytes ||
      asset.r2Key === null || asset.externalUrl !== null || asset.mimeType === null ||
      asset.sha256 === null || asset.sizeBytes === null ||
      member.storageKeySha256 !== receipt.storageKeySha256 ||
      runtimeAssetStorageKeySha256(asset.r2Key) !== member.storageKeySha256
    ) return null;
  }

  const target = memberRows[params.memberIndex];
  const frozen = binding.data.visualAssets[params.memberIndex];
  if (
    target === undefined || frozen === undefined ||
    target.member.fileName !== params.fileName || target.asset.r2Key === null ||
    target.asset.mimeType === null || target.asset.sha256 === null || target.asset.sizeBytes === null ||
    (target.asset.fileExt !== ".sog" && target.asset.fileExt !== ".spz")
  ) return null;
  return {
    bindingDigest: binding.data.bindingDigest,
    runtimePackageContentDigest: binding.data.runtimePackageContentDigest,
    assetVersionId: target.asset.id,
    memberIndex: params.memberIndex,
    fileName: target.asset.fileName,
    fileExt: target.asset.fileExt,
    mimeType: target.asset.mimeType,
    sha256: target.asset.sha256,
    sizeBytes: target.asset.sizeBytes,
    storageKey: target.asset.r2Key,
    storageKeySha256: target.member.storageKeySha256,
  };
}

export async function historicalRuntimeMemberRoutes(
  server: FastifyInstance,
  opts: {
    readonly db: Database;
    readonly env: Env;
    readonly loadMemberBytes?: HistoricalRuntimeMemberByteLoader;
  },
): Promise<void> {
  const loadMemberBytes = opts.loadMemberBytes ?? productionLoader(opts.env);
  server.get(
    "/venues/:venueId/spaces/:spaceId/runtime-bindings/:bindingId/members/:memberIndex/:fileName",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const upstreamController = new AbortController();
      let clientDisconnected = false;
      const abortForClientDisconnect = (): void => {
        if (reply.raw.writableFinished) return;
        clientDisconnected = true;
        upstreamController.abort(
          new DOMException("Historical runtime client disconnected", "AbortError"),
        );
      };
      // Register before database work so a rapid scrub cannot leave a later
      // private-object read orphaned after its browser request is cancelled.
      reply.raw.once("close", abortForClientDisconnect);
      let markWorkSettled: (() => void) | null = null;
      try {
        const params = HistoricalRuntimeMemberParamsSchema.safeParse(request.params);
        if (!params.success) return notFound(reply);
        if (!canReadVenuePlanningData(request.user, params.data.venueId)) return notFound(reply);

        const before = await resolveMemberDescriptor(opts.db, params.data);
        if (clientDisconnected || reply.raw.destroyed) return reply;
        if (before === null) return notFound(reply);
        const releaseTransfer = tryAcquireHistoricalRuntimeTransfer();
        if (releaseTransfer === null) {
          return reply
            .header("retry-after", "1")
            .header("cache-control", "private, no-store")
            .status(429)
            .send({
              error: "Historical runtime delivery is busy; try again shortly",
              code: "RUNTIME_MEMBER_BUSY",
            });
        }
        if (clientDisconnected || reply.raw.destroyed) {
          releaseTransfer();
          return reply;
        }
        markWorkSettled = bindPublicRuntimeProfileTransferToResponse(
          reply.raw,
          releaseTransfer,
          () => { upstreamController.abort(); },
          HISTORICAL_RUNTIME_UPSTREAM_TIMEOUT_MS,
        );
        reply.raw.off("close", abortForClientDisconnect);
        let bytes: Buffer;
        try {
          bytes = await loadMemberBytes(
            before.storageKey,
            before.sizeBytes,
            upstreamController.signal,
          );
        } catch {
          if (clientDisconnected || reply.raw.destroyed || upstreamController.signal.aborted) {
            return reply;
          }
          return reply.status(503).send({
            error: "Historical runtime member bytes are temporarily unavailable",
            code: "RUNTIME_MEMBER_UNAVAILABLE",
          });
        }
        if (clientDisconnected || reply.raw.destroyed) return reply;
        if (
          bytes.byteLength !== before.sizeBytes ||
          createHash("sha256").update(bytes).digest("hex") !== before.sha256
        ) {
          return reply.status(409).send({
            error: "Historical runtime member failed its immutable byte verification",
            code: "RUNTIME_MEMBER_INTEGRITY_FAILED",
          });
        }
        const after = await resolveMemberDescriptor(opts.db, params.data);
        if (after === null || !sameDescriptor(before, after)) return notFound(reply);

        return reply
          .header("content-type", before.mimeType)
          .header("content-length", String(bytes.byteLength))
          .header("cache-control", "private, no-store")
          .header("x-content-type-options", "nosniff")
          .header("x-content-sha256", before.sha256)
          .header("x-runtime-binding-digest", before.bindingDigest)
          .header("x-runtime-package-content-digest", before.runtimePackageContentDigest)
          .header("x-asset-version-id", before.assetVersionId)
          .send(bytes);
      } finally {
        reply.raw.off("close", abortForClientDisconnect);
        markWorkSettled?.();
      }
    },
  );
}
