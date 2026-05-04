import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { files, spaces, enquiries, referenceLoadouts } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import type { JwtUser } from "../middleware/auth.js";
import { canManageVenue } from "../utils/query.js";
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

const UPLOAD_CONTEXTS = ["venue", "space", "asset", "enquiry", "loadout", "public_marketing"] as const;
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
  contextId: z.string().uuid(),
  visibility: z.enum(UPLOAD_VISIBILITIES).default("private"),
  sha256: z.string().regex(SHA256_HEX).optional(),
}).superRefine((body, ctx) => {
  const maxBytes = maxBytesForContentType(body.contentType);
  if (body.contentLengthBytes > maxBytes) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["contentLengthBytes"],
      message: `File exceeds ${formatBytes(maxBytes)} limit for ${body.contentType}`,
    });
  }

  if (!filenameMatchesContentType(body.filename, body.contentType)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["filename"],
      message: "Filename extension does not match content type",
    });
  }

  if (body.context === "public_marketing" && body.visibility !== "public") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["visibility"],
      message: "public_marketing uploads must be explicitly public",
    });
  }

  if (body.context !== "public_marketing" && body.visibility === "public") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["visibility"],
      message: "Only public_marketing uploads may request public visibility",
    });
  }
});

const ListFilesParams = z.object({
  context: z.enum(UPLOAD_CONTEXTS),
  contextId: z.string().uuid(),
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
// S3 client factory (lazy - only created when R2 env vars are present)
// ---------------------------------------------------------------------------

type S3ClientType = import("@aws-sdk/client-s3").S3Client;

let cachedS3: S3ClientType | null = null;

async function getS3Client(env: Env): Promise<S3ClientType> {
  if (cachedS3 !== null) return cachedS3;

  const { S3Client } = await import("@aws-sdk/client-s3");
  cachedS3 = new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID ?? ""}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? "",
    },
  });
  return cachedS3;
}

async function createPresignedUrl(
  env: Env,
  key: string,
  contentType: AllowedContentType,
  contentLengthBytes: number,
): Promise<string> {
  const s3 = await getS3Client(env);
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");

  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME ?? "",
    Key: key,
    ContentType: contentType,
    ContentLength: contentLengthBytes,
  });

  return getSignedUrl(s3, command, { expiresIn: 600 }); // 10 minutes
}

async function createSignedReadUrl(env: Env, key: string): Promise<string | null> {
  if (
    env.R2_ACCOUNT_ID === undefined ||
    env.R2_ACCESS_KEY_ID === undefined ||
    env.R2_SECRET_ACCESS_KEY === undefined ||
    env.R2_BUCKET_NAME === undefined
  ) {
    return null;
  }

  const s3 = await getS3Client(env);
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");

  const command = new GetObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: key,
  });

  return getSignedUrl(s3, command, { expiresIn: 300 }); // 5 minutes
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
    if (user.role !== "admin" || visibility !== "public") return null;
    return { venueId: null, keyPrefix: `public/marketing/${contextId}`, visibility };
  }

  if (visibility !== "private") return null;

  if (context === "asset") {
    if (user.role !== "admin") return null;
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
  const publicUrl = publicUrlForVisibility(env, row.fileKey, visibility);
  const readUrl = visibility === "private" ? await createSignedReadUrl(env, row.fileKey) : publicUrl;
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

    // Check R2 is configured
    if (
      env.R2_ACCOUNT_ID === undefined ||
      env.R2_ACCESS_KEY_ID === undefined ||
      env.R2_SECRET_ACCESS_KEY === undefined ||
      env.R2_BUCKET_NAME === undefined
    ) {
      return reply.status(503).send({ error: "File uploads not configured", code: "UPLOADS_DISABLED" });
    }

    const fileKey = buildScopedFileKey(scope, parsed.data.contentType);

    const uploadUrl = await createPresignedUrl(
      env,
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
    return { data };
  });
}
