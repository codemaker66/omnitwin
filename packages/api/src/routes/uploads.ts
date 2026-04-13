import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { files, spaces, enquiries, referenceLoadouts } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
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

const PresignedBody = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.enum(ALLOWED_CONTENT_TYPES),
  context: z.enum(["venue", "space", "asset", "enquiry", "loadout"]),
  contextId: z.string().uuid(),
});

const ListFilesParams = z.object({
  context: z.enum(["venue", "space", "asset", "enquiry", "loadout"]),
  contextId: z.string().uuid(),
});

/** Extract file extension from content type. */
function extFromContentType(ct: string): string {
  switch (ct) {
    case "image/jpeg": return "jpg";
    case "image/png": return "png";
    case "image/webp": return "webp";
    case "application/pdf": return "pdf";
    default: return "bin";
  }
}

// ---------------------------------------------------------------------------
// S3 client factory (lazy — only created when R2 env vars are present)
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
  contentType: string,
): Promise<string> {
  const s3 = await getS3Client(env);
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");

  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME ?? "",
    Key: key,
    ContentType: contentType,
  });

  return getSignedUrl(s3, command, { expiresIn: 600 }); // 10 minutes
}

// ---------------------------------------------------------------------------
// Authorization — verify user can access the referenced resource
// ---------------------------------------------------------------------------

async function verifyContextAccess(
  db: Database,
  user: { id: string; role: string; venueId: string | null },
  context: string,
  contextId: string,
): Promise<boolean> {
  // Admins can access everything
  if (user.role === "admin") return true;

  // Assets are global catalogue items — any authenticated user can upload
  if (context === "asset") return true;

  if (context === "venue") {
    // Must be staff/hallkeeper at this venue
    return canManageVenue(user as Parameters<typeof canManageVenue>[0], contextId);
  }

  if (context === "space") {
    // Look up the space's venue, then check venue access
    const [space] = await db.select({ venueId: spaces.venueId })
      .from(spaces).where(and(eq(spaces.id, contextId), isNull(spaces.deletedAt))).limit(1);
    if (space === undefined) return false;
    return canManageVenue(user as Parameters<typeof canManageVenue>[0], space.venueId);
  }

  if (context === "loadout") {
    // Look up the loadout's venue, then check venue access
    const [loadout] = await db.select({ venueId: referenceLoadouts.venueId })
      .from(referenceLoadouts).where(and(eq(referenceLoadouts.id, contextId), isNull(referenceLoadouts.deletedAt))).limit(1);
    if (loadout === undefined) return false;
    return canManageVenue(user as Parameters<typeof canManageVenue>[0], loadout.venueId);
  }

  if (context === "enquiry") {
    // User must own the enquiry OR be venue staff
    const [enq] = await db.select({ userId: enquiries.userId, venueId: enquiries.venueId })
      .from(enquiries).where(eq(enquiries.id, contextId)).limit(1);
    if (enq === undefined) return false;
    if (enq.userId === user.id) return true;
    return canManageVenue(user as Parameters<typeof canManageVenue>[0], enq.venueId);
  }

  return false;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export async function uploadRoutes(
  server: FastifyInstance,
  opts: { db: Database; env: Env },
): Promise<void> {
  const { db, env } = opts;

  // POST /uploads/presigned — get a presigned upload URL
  server.post("/presigned", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = PresignedBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    // Verify user can access the referenced resource
    const allowed = await verifyContextAccess(db, request.user, parsed.data.context, parsed.data.contextId);
    if (!allowed) {
      return reply.status(403).send({ error: "You do not have access to this resource", code: "FORBIDDEN" });
    }

    // Check R2 is configured
    if (env.R2_ACCOUNT_ID === undefined || env.R2_BUCKET_NAME === undefined || env.R2_PUBLIC_URL === undefined) {
      return reply.status(503).send({ error: "File uploads not configured", code: "UPLOADS_DISABLED" });
    }

    const ext = extFromContentType(parsed.data.contentType);
    const fileKey = `${parsed.data.context}/${parsed.data.contextId}/${randomUUID()}.${ext}`;

    const uploadUrl = await createPresignedUrl(env, fileKey, parsed.data.contentType);
    const publicUrl = `${env.R2_PUBLIC_URL}/${fileKey}`;

    // Record the file in the database and return its ID
    const [file] = await db.insert(files).values({
      fileKey,
      filename: parsed.data.filename,
      contentType: parsed.data.contentType,
      context: parsed.data.context,
      contextId: parsed.data.contextId,
      uploadedBy: request.user.id,
    }).returning();

    return reply.status(201).send({
      data: { fileId: file?.id, uploadUrl, fileKey, publicUrl },
    });
  });

  // GET /uploads/:context/:contextId — list files for a resource
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

    return { data: rows };
  });
}
