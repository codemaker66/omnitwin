import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { files } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
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
  context: z.enum(["venue", "space", "asset", "enquiry"]),
  contextId: z.string().uuid(),
});

const ListFilesParams = z.object({
  context: z.enum(["venue", "space", "asset", "enquiry"]),
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

    // Check R2 is configured
    if (env.R2_ACCOUNT_ID === undefined || env.R2_BUCKET_NAME === undefined || env.R2_PUBLIC_URL === undefined) {
      return reply.status(503).send({ error: "File uploads not configured", code: "UPLOADS_DISABLED" });
    }

    const ext = extFromContentType(parsed.data.contentType);
    const fileKey = `${parsed.data.context}/${parsed.data.contextId}/${randomUUID()}.${ext}`;

    const uploadUrl = await createPresignedUrl(env, fileKey, parsed.data.contentType);
    const publicUrl = `${env.R2_PUBLIC_URL}/${fileKey}`;

    // Record the file in the database
    await db.insert(files).values({
      fileKey,
      filename: parsed.data.filename,
      contentType: parsed.data.contentType,
      context: parsed.data.context,
      contextId: parsed.data.contextId,
      uploadedBy: request.user.id,
    });

    return reply.status(201).send({
      data: { uploadUrl, fileKey, publicUrl },
    });
  });

  // GET /uploads/:context/:contextId — list files for a resource
  server.get("/:context/:contextId", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ListFilesParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
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
