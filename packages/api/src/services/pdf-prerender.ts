import { eq } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { HallkeeperSheetV2 } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { configurationSheetSnapshots } from "../db/schema.js";
import type { Env } from "../env.js";
import { generateSheetPdfV2 } from "./hallkeeper-pdf-v2.js";

// ---------------------------------------------------------------------------
// PDF pre-render service
//
// When a sheet snapshot is approved, the hallkeeper WILL eventually
// open the PDF — either by clicking the "Open Hallkeeper Sheet" button
// in the approval email or by scanning the QR code on a tablet.
// Rendering the PDF on every request ties up the Fastify event loop
// (pdfkit is cpu-bound) and forces the user to wait on a 200-500ms
// synchronous render.
//
// This service pre-renders the PDF once at approval time, uploads the
// bytes to R2, and stores the public URL on
// `configuration_sheet_snapshots.pdfUrl`. The /sheet route then
// short-circuits to a 302 redirect when `pdfUrl` is present, cutting
// the hot path from "read DB + render PDF + stream bytes" to "read
// one column + redirect".
//
// Idempotency: the R2 object key embeds the snapshot's source hash,
// so re-rendering an unchanged snapshot overwrites the same key with
// the same bytes — safe. The `pdfUrl` update is a simple SET by ID.
//
// Failure policy: pre-render is FIRE-AND-FORGET after approval. If it
// fails, the /sheet route falls back to on-demand generation (the
// pre-approval behavior). An ops alarm on log-ERROR lines catches
// systematic failures without blocking the approval flow.
// ---------------------------------------------------------------------------

export interface PdfPrerenderResult {
  readonly status: "uploaded" | "skipped-no-r2" | "failed";
  readonly pdfUrl: string | null;
  readonly bytes: number;
}

/**
 * Build the deterministic R2 object key for a snapshot's pre-rendered
 * PDF. Embedding `sourceHash` means re-rendering the same snapshot
 * produces the same key — downstream caches stay warm, CDN edge
 * stays valid.
 *
 * Shape: `sheets/{configId}/v{version}-{sourceHash}.pdf`
 *   - prefix keeps sheet PDFs segregated from other upload contexts
 *   - configId makes listing-per-config cheap
 *   - version makes humans reading the key know which revision
 *   - sourceHash is the deterministic content fingerprint
 */
export function pdfObjectKey(
  configId: string,
  version: number,
  sourceHash: string,
): string {
  return `sheets/${configId}/v${String(version)}-${sourceHash}.pdf`;
}

/**
 * Build the public URL for a pre-rendered PDF. When `R2_PUBLIC_URL`
 * is a CDN host (Cloudflare R2 public bucket or custom domain), this
 * is the canonical hallkeeper-accessible URL.
 */
function publicUrlFor(env: Env, key: string): string | null {
  if (env.R2_PUBLIC_URL === undefined) return null;
  const base = env.R2_PUBLIC_URL.replace(/\/+$/, "");
  return `${base}/${key}`;
}

/**
 * Pre-render the PDF for a single approved snapshot and upload to R2.
 * Safe to fire-and-forget from the approval handler. Returns a
 * structured result for callers that want to surface status.
 *
 * If R2 is not configured (R2_BUCKET_NAME or R2_PUBLIC_URL missing),
 * returns `{ status: "skipped-no-r2" }` without error — the /sheet
 * route falls back to on-demand rendering. This keeps dev
 * environments without R2 fully functional.
 */
export async function prerenderSnapshotPdf(
  db: Database,
  env: Env,
  logger: FastifyBaseLogger,
  opts: {
    readonly snapshotId: string;
    readonly configId: string;
    readonly version: number;
    readonly sourceHash: string;
    readonly payload: HallkeeperSheetV2;
  },
): Promise<PdfPrerenderResult> {
  if (
    env.R2_BUCKET_NAME === undefined
    || env.R2_PUBLIC_URL === undefined
    || env.R2_ACCOUNT_ID === undefined
  ) {
    logger.info(
      { snapshotId: opts.snapshotId },
      "pdf-prerender: R2 not configured — skipping (route will render on demand)",
    );
    return { status: "skipped-no-r2", pdfUrl: null, bytes: 0 };
  }

  try {
    const pdfBuffer = await generateSheetPdfV2(opts.payload);
    const key = pdfObjectKey(opts.configId, opts.version, opts.sourceHash);

    // Lazy-load S3 SDK — matches the pattern in routes/uploads.ts and
    // keeps the cold-start bundle smaller.
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = new S3Client({
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID ?? "",
        secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? "",
      },
    });

    await client.send(new PutObjectCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key: key,
      Body: pdfBuffer,
      ContentType: "application/pdf",
      // Long cache TTL — the content at a given source-hashed key is
      // immutable. If a future revision is approved, the key changes,
      // the CDN doesn't need purging. This is the whole point of
      // hashing the source into the key.
      CacheControl: "public, max-age=31536000, immutable",
    }));

    const pdfUrl = publicUrlFor(env, key);
    if (pdfUrl === null) {
      // Unreachable per the env guard at the top — belt-and-braces.
      return { status: "skipped-no-r2", pdfUrl: null, bytes: pdfBuffer.length };
    }

    await db.update(configurationSheetSnapshots)
      .set({ pdfUrl })
      .where(eq(configurationSheetSnapshots.id, opts.snapshotId));

    logger.info(
      { snapshotId: opts.snapshotId, pdfUrl, bytes: pdfBuffer.length },
      "pdf-prerender: uploaded and snapshot.pdfUrl updated",
    );
    return { status: "uploaded", pdfUrl, bytes: pdfBuffer.length };
  } catch (err) {
    logger.error(
      { err, snapshotId: opts.snapshotId, configId: opts.configId },
      "pdf-prerender: failed — falling back to on-demand rendering at request time",
    );
    return { status: "failed", pdfUrl: null, bytes: 0 };
  }
}

/**
 * Fire-and-forget convenience wrapper. Returns void immediately; the
 * caller doesn't await the network I/O. Errors are captured by the
 * underlying `prerenderSnapshotPdf` logger — no unhandled rejection
 * escapes.
 *
 * Use this from the approval handler so the approve response returns
 * as soon as the DB transition commits; pre-render runs in the
 * background.
 */
export function schedulePrerender(
  db: Database,
  env: Env,
  logger: FastifyBaseLogger,
  opts: {
    readonly snapshotId: string;
    readonly configId: string;
    readonly version: number;
    readonly sourceHash: string;
    readonly payload: HallkeeperSheetV2;
  },
): void {
  void prerenderSnapshotPdf(db, env, logger, opts).catch((err: unknown) => {
    logger.error({ err }, "pdf-prerender: uncaught promise rejection");
  });
}
