import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { files, spaces, enquiries, referenceLoadouts } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate, isPlatformAdmin, type JwtUser } from "../middleware/auth.js";
import { canManageVenue, canWritePricing } from "../utils/query.js";
import { competitorVenueOf } from "../services/competitor-watch-data.js";
import type { Env } from "../env.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

// competitor_watch: a screenshot or brochure kept with a price capture; its
// context id is the competitor's, scoped to the people who set prices.
export const UPLOAD_CONTEXTS = ["venue", "space", "asset", "enquiry", "loadout", "public_marketing", "competitor_watch"] as const;
const UPLOAD_VISIBILITIES = ["private", "public"] as const;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const SHA256_HEX = /^[a-f0-9]{64}$/;

export type AllowedContentType = typeof ALLOWED_CONTENT_TYPES[number];
export type UploadContext = typeof UPLOAD_CONTEXTS[number];
export type UploadVisibility = typeof UPLOAD_VISIBILITIES[number];

const PresignedBody = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.enum(ALLOWED_CONTENT_TYPES),
  contentLengthBytes: z.number().int().positive(),
  context: z.enum(UPLOAD_CONTEXTS),
  contextId: z.uuid(),
  visibility: z.enum(UPLOAD_VISIBILITIES).default("private"),
  sha256: z.string().regex(SHA256_HEX).optional(),
}).superRefine((body, ctx) => {
  const maxBytes = maxBytesForContentType(body.contentType);
  if (body.contentLengthBytes > maxBytes) {
    ctx.addIssue({
      code: "custom",
      path: ["contentLengthBytes"],
      message: `File exceeds ${formatBytes(maxBytes)} limit for ${body.contentType}`,
    });
  }

  if (!filenameMatchesContentType(body.filename, body.contentType)) {
    ctx.addIssue({
      code: "custom",
      path: ["filename"],
      message: "Filename extension does not match content type",
    });
  }

  if (body.context === "public_marketing" && body.visibility !== "public") {
    ctx.addIssue({
      code: "custom",
      path: ["visibility"],
      message: "public_marketing uploads must be explicitly public",
    });
  }

  if (body.context !== "public_marketing" && body.visibility === "public") {
    ctx.addIssue({
      code: "custom",
      path: ["visibility"],
      message: "Only public_marketing uploads may request public visibility",
    });
  }
});

const ListFilesParams = z.object({
  context: z.enum(UPLOAD_CONTEXTS),
  contextId: z.uuid(),
});

/** Extract file extension from content type. */
function extFromContentType(ct: AllowedContentType): string {
  switch (ct) {
    case "image/jpeg": return "jpg";
    case "image/png": return "png";
    case "image/webp": return "webp";
    case "application/pdf": return "pdf";
  }
}

function allowedExtensionsForContentType(ct: AllowedContentType): readonly string[] {
  switch (ct) {
    case "image/jpeg": return ["jpg", "jpeg"];
    case "image/png": return ["png"];
    case "image/webp": return ["webp"];
    case "application/pdf": return ["pdf"];
  }
}

function maxBytesForContentType(ct: AllowedContentType): number {
  return ct === "application/pdf" ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
}

function formatBytes(bytes: number): string {
  const mib = bytes / (1024 * 1024);
  return `${String(mib)} MiB`;
}

export function filenameMatchesContentType(filename: string, contentType: AllowedContentType): boolean {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot < 0 || lastDot === filename.length - 1) return false;
  const ext = filename.slice(lastDot + 1).toLowerCase();
  return allowedExtensionsForContentType(contentType).includes(ext);
}

export function publicUrlForVisibility(env: Env, key: string, visibility: UploadVisibility): string | null {
  if (visibility !== "public") return null;
  if (env.R2_PUBLIC_URL === undefined) return null;
  return `${env.R2_PUBLIC_URL.replace(/\/+$/, "")}/${key}`;
}

// ---------------------------------------------------------------------------
// Storage routing
//
// Visibility picks the bucket, and the key prefix must agree with it.
// Private keys (`private/…`) live only in the PRIVATE_UPLOADS_R2_* bucket,
// which has no public URL, so a signed URL is the only way to read them.
// Public keys (`public/…`) live only in the R2_* bucket, which r2.dev serves
// to anyone. There is no fallback: without the private bucket, private
// uploads are refused rather than written where r2.dev would publish them.
// ---------------------------------------------------------------------------

export interface UploadStorage {
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
}

const VISIBILITY_KEY_PREFIX: Readonly<Record<UploadVisibility, string>> = {
  private: "private/",
  public: "public/",
};

/** The bucket a key of this visibility is written to and read from, or null
 *  when that storage is not configured or the key's prefix disagrees with
 *  the visibility. */
export function uploadStorageFor(env: Env, visibility: UploadVisibility, key: string): UploadStorage | null {
  if (!key.startsWith(VISIBILITY_KEY_PREFIX[visibility])) return null;

  if (visibility === "private") {
    if (
      env.PRIVATE_UPLOADS_R2_ACCOUNT_ID === undefined ||
      env.PRIVATE_UPLOADS_R2_ACCESS_KEY_ID === undefined ||
      env.PRIVATE_UPLOADS_R2_SECRET_ACCESS_KEY === undefined ||
      env.PRIVATE_UPLOADS_R2_BUCKET === undefined
    ) {
      return null;
    }
    return {
      accountId: env.PRIVATE_UPLOADS_R2_ACCOUNT_ID,
      accessKeyId: env.PRIVATE_UPLOADS_R2_ACCESS_KEY_ID,
      secretAccessKey: env.PRIVATE_UPLOADS_R2_SECRET_ACCESS_KEY,
      bucket: env.PRIVATE_UPLOADS_R2_BUCKET,
    };
  }

  if (
    env.R2_ACCOUNT_ID === undefined ||
    env.R2_ACCESS_KEY_ID === undefined ||
    env.R2_SECRET_ACCESS_KEY === undefined ||
    env.R2_BUCKET_NAME === undefined
  ) {
    return null;
  }
  return {
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET_NAME,
  };
}

// ---------------------------------------------------------------------------
// S3 clients (lazy, one per credential set)
// ---------------------------------------------------------------------------

type S3ClientType = import("@aws-sdk/client-s3").S3Client;

const s3Clients = new Map<string, S3ClientType>();

async function getS3Client(storage: UploadStorage): Promise<S3ClientType> {
  const cacheKey = `${storage.accountId}\u0000${storage.accessKeyId}`;
  const cached = s3Clients.get(cacheKey);
  if (cached !== undefined) return cached;

  const { S3Client } = await import("@aws-sdk/client-s3");
  // As the asset clients do: without WHEN_REQUIRED, SDK 3.729+ presigns a
  // PUT with the CRC32 of an empty body, which R2 then holds the upload to.
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${storage.accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    maxAttempts: 3,
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: storage.accessKeyId,
      secretAccessKey: storage.secretAccessKey,
    },
  });
  s3Clients.set(cacheKey, client);
  return client;
}

async function createPresignedUrl(
  storage: UploadStorage,
  key: string,
  contentType: AllowedContentType,
  contentLengthBytes: number,
): Promise<string> {
  const s3 = await getS3Client(storage);
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");

  const command = new PutObjectCommand({
    Bucket: storage.bucket,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLengthBytes,
  });

  // The presigner leaves Content-Type unsigned by default, which would let an
  // uploader store, say, HTML under a PDF's key and have staff open it.
  return getSignedUrl(s3, command, { expiresIn: 600, signableHeaders: new Set(["content-type"]) }); // 10 minutes
}

async function createSignedReadUrl(storage: UploadStorage, key: string): Promise<string> {
  const s3 = await getS3Client(storage);
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");

  const command = new GetObjectCommand({
    Bucket: storage.bucket,
    Key: key,
  });

  return getSignedUrl(s3, command, { expiresIn: 300 }); // 5 minutes
}

/** Where a client reads a stored upload: a five-minute signed URL for a
 *  private file, the permanent public URL for a public one, or null when the
 *  file's storage is not configured. */
export async function readUrlForUpload(
  env: Env,
  fileKey: string,
  visibility: UploadVisibility,
): Promise<string | null> {
  const storage = uploadStorageFor(env, visibility, fileKey);
  if (storage === null) return null;
  if (visibility === "public") return publicUrlForVisibility(env, fileKey, "public");
  return createSignedReadUrl(storage, fileKey);
}

// ---------------------------------------------------------------------------
// Authorization - verify user can access the referenced resource
// ---------------------------------------------------------------------------

export interface UploadScope {
  readonly venueId: string | null;
  readonly keyPrefix: string;
  readonly visibility: UploadVisibility;
}

export async function resolveUploadScope(
  db: Database,
  user: JwtUser,
  context: UploadContext,
  contextId: string,
  visibility: UploadVisibility = "private",
): Promise<UploadScope | null> {
  if (context === "public_marketing") {
    if (!isPlatformAdmin(user) || visibility !== "public") return null;
    return { venueId: null, keyPrefix: `public/marketing/${contextId}`, visibility };
  }

  if (visibility !== "private") return null;

  if (context === "asset") {
    if (!isPlatformAdmin(user)) return null;
    return { venueId: null, keyPrefix: `private/catalogue/assets/${contextId}`, visibility };
  }

  if (context === "venue") {
    // Must be staff/hallkeeper at this venue
    if (!canManageVenue(user, contextId)) return null;
    return { venueId: contextId, keyPrefix: `private/venues/${contextId}/venue-files`, visibility };
  }

  if (context === "space") {
    // Look up the space's venue, then check venue access
    const [space] = await db.select({ venueId: spaces.venueId })
      .from(spaces).where(and(eq(spaces.id, contextId), isNull(spaces.deletedAt))).limit(1);
    if (space === undefined || !canManageVenue(user, space.venueId)) return null;
    return { venueId: space.venueId, keyPrefix: `private/venues/${space.venueId}/spaces/${contextId}`, visibility };
  }

  if (context === "loadout") {
    // Look up the loadout's venue, then check venue access
    const [loadout] = await db.select({ venueId: referenceLoadouts.venueId })
      .from(referenceLoadouts).where(and(eq(referenceLoadouts.id, contextId), isNull(referenceLoadouts.deletedAt))).limit(1);
    if (loadout === undefined || !canManageVenue(user, loadout.venueId)) return null;
    return { venueId: loadout.venueId, keyPrefix: `private/venues/${loadout.venueId}/loadouts/${contextId}`, visibility };
  }

  if (context === "enquiry") {
    // User must own the enquiry OR be venue staff
    const [enq] = await db.select({ userId: enquiries.userId, venueId: enquiries.venueId })
      .from(enquiries).where(eq(enquiries.id, contextId)).limit(1);
    if (enq === undefined) return null;
    const allowed = enq.userId === user.id || canManageVenue(user, enq.venueId);
    if (!allowed) return null;
    return { venueId: enq.venueId, keyPrefix: `private/venues/${enq.venueId}/enquiries/${contextId}`, visibility };
  }

  if (context === "competitor_watch") {
    // The competitor's venue, and only those who keep its watch.
    const venueId = await competitorVenueOf(db, contextId);
    if (venueId === null || !canWritePricing(user, venueId)) return null;
    return { venueId, keyPrefix: `private/venues/${venueId}/competitor-watch/${contextId}`, visibility };
  }

  return null;
}

async function verifyContextAccess(
  db: Database,
  user: JwtUser,
  context: UploadContext,
  contextId: string,
): Promise<boolean> {
  const visibility: UploadVisibility = context === "public_marketing" ? "public" : "private";
  return (await resolveUploadScope(db, user, context, contextId, visibility)) !== null;
}

export function buildScopedFileKey(scope: UploadScope, contentType: AllowedContentType): string {
  return `${scope.keyPrefix}/${randomUUID()}.${extFromContentType(contentType)}`;
}

type FileRow = typeof files.$inferSelect;

async function serializeFileRow(env: Env, row: FileRow): Promise<FileRow & {
  readonly publicUrl: string | null;
  readonly readUrl: string | null;
}> {
  const visibility = row.visibility === "public" ? "public" : "private";
  // A public URL only for a key the public bucket actually holds.
  const publicUrl = uploadStorageFor(env, visibility, row.fileKey) === null
    ? null
    : publicUrlForVisibility(env, row.fileKey, visibility);
  const readUrl = await readUrlForUpload(env, row.fileKey, visibility);
  return { ...row, publicUrl, readUrl };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export async function uploadRoutes(
  server: FastifyInstance,
  opts: { db: Database; env: Env },
): Promise<void> {
  const { db, env } = opts;

  // POST /uploads/presigned - get a presigned upload URL
  server.post("/presigned", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = PresignedBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const scope = await resolveUploadScope(
      db,
      request.user,
      parsed.data.context,
      parsed.data.contextId,
      parsed.data.visibility,
    );
    if (scope === null) {
      request.log.warn({
        userId: request.user.id,
        context: parsed.data.context,
        contextId: parsed.data.contextId,
        visibility: parsed.data.visibility,
      }, "upload presign denied");
      return reply.status(403).send({ error: "You do not have access to this resource", code: "FORBIDDEN" });
    }

    const fileKey = buildScopedFileKey(scope, parsed.data.contentType);

    // Refuse rather than fall back: a private file must never be written to
    // the publicly served bucket because the private one is missing.
    const storage = uploadStorageFor(env, scope.visibility, fileKey);
    if (storage === null) {
      return reply.status(503).send({ error: "File uploads not configured", code: "UPLOADS_DISABLED" });
    }

    const uploadUrl = await createPresignedUrl(
      storage,
      fileKey,
      parsed.data.contentType,
      parsed.data.contentLengthBytes,
    );
    const publicUrl = publicUrlForVisibility(env, fileKey, scope.visibility);

    // Record the file in the database and return its ID
    const [file] = await db.insert(files).values({
      fileKey,
      filename: parsed.data.filename,
      contentType: parsed.data.contentType,
      contentLengthBytes: parsed.data.contentLengthBytes,
      sha256: parsed.data.sha256 ?? null,
      context: parsed.data.context,
      contextId: parsed.data.contextId,
      visibility: scope.visibility,
      uploadedBy: request.user.id,
    }).returning();

    if (file === undefined) {
      return reply.status(500).send({ error: "Failed to record upload", code: "UPLOAD_RECORD_FAILED" });
    }

    request.log.info({
      userId: request.user.id,
      fileId: file.id,
      fileKey,
      bucket: storage.bucket,
      context: parsed.data.context,
      contextId: parsed.data.contextId,
      venueId: scope.venueId,
      visibility: scope.visibility,
      contentType: parsed.data.contentType,
      contentLengthBytes: parsed.data.contentLengthBytes,
    }, "upload presign issued");

    return reply.status(201).send({
      data: {
        fileId: file.id,
        uploadUrl,
        fileKey,
        publicUrl,
        readUrl: null,
        visibility: scope.visibility,
      },
    });
  });

  // GET /uploads/:context/:contextId - list files for a resource
  server.get("/:context/:contextId", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ListFilesParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    }

    // Verify user can access the referenced resource
    const allowed = await verifyContextAccess(db, request.user, params.data.context, params.data.contextId);
    if (!allowed) {
      return reply.status(403).send({ error: "You do not have access to this resource", code: "FORBIDDEN" });
    }

    const rows = await db.select()
      .from(files)
      .where(and(
        eq(files.context, params.data.context),
        eq(files.contextId, params.data.contextId),
      ))
      .orderBy(files.uploadedAt);

    const data = await Promise.all(rows.map((row) => serializeFileRow(env, row)));
    // The body carries live signed URLs: no shared or browser cache may keep it.
    reply.header("Cache-Control", "private, no-store");
    return { data };
  });
}
