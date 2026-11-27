/* eslint-disable no-console */
// ---------------------------------------------------------------------------
// Move private uploads out of the public bucket (T-668), once, after #134.
//
// Until #134, every upload went to R2_BUCKET_NAME, the bucket r2.dev serves to
// anyone holding a key. From 11 November 2026 (0bdb996a) uploads reached it
// again, so enquiry files, venue files, loadout photos and competitor-watch
// screenshots written since then sit there under `private/…` keys. #134 reads
// `private/…` keys only from the PRIVATE_UPLOADS_R2_* bucket, so each such
// object must move there with its key unchanged: until it does, r2.dev still
// serves it, and the API's signed link to it points at a missing object.
//
// For each object under `private/` in the public bucket it copies the object
// to the private bucket (same key, same content type), checks the copy's size,
// and only then deletes the original. An object already in the private bucket
// at the same size is not copied again, so a run that stops part-way resumes.
// A failure keeps the original and is listed; the run then exits 1. `public/`
// and every other prefix are never touched.
//
// Without --apply it writes nothing and reports what it would do. It prints
// counts and the keys that failed (keys are ids, never filenames or names),
// never a credential. Settings come from the process environment, as on
// Railway, so the values are never typed or stored:
//
//   railway run --service @omnitwin/api --environment production -- \
//     pnpm --filter @omnitwin/api exec tsx src/scripts/move-private-uploads.ts [--apply]
//
// Exit codes: 0 = done (or nothing to do), 1 = a failure or bad settings
// ---------------------------------------------------------------------------

import { pathToFileURL } from "node:url";
import { z } from "zod";

export const PRIVATE_KEY_PREFIX = "private/";

/** The few bucket operations the move needs, so a fake can stand in. */
export interface MoveObjectStore {
  /** Every key under the prefix, with its size in bytes. */
  list(prefix: string): Promise<readonly { readonly key: string; readonly size: number }[]>;
  /** The object's size, or null when there is no such object. */
  size(key: string): Promise<number | null>;
  read(key: string): Promise<{ readonly body: Uint8Array; readonly contentType: string | undefined }>;
  write(key: string, body: Uint8Array, contentType: string | undefined): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface MoveReport {
  /** Objects under `private/` in the public bucket when the run began. */
  readonly found: number;
  /** Copied to the private bucket (or, without --apply, would be). */
  readonly copied: number;
  /** Already in the private bucket at the same size, so not copied again. */
  readonly alreadyMoved: number;
  /** Originals deleted from the public bucket (none without --apply). */
  readonly removed: number;
  /** Keys left in the public bucket because a step failed, and why. */
  readonly failed: readonly { readonly key: string; readonly reason: string }[];
}

export async function movePrivateUploads(
  source: MoveObjectStore,
  destination: MoveObjectStore,
  options: { readonly apply: boolean },
): Promise<MoveReport> {
  const objects = (await source.list(PRIVATE_KEY_PREFIX)).filter(({ key }) => key.startsWith(PRIVATE_KEY_PREFIX));
  let copied = 0;
  let alreadyMoved = 0;
  let removed = 0;
  const failed: { key: string; reason: string }[] = [];

  for (const { key, size } of objects) {
    try {
      const existing = await destination.size(key);
      if (existing === size) {
        alreadyMoved += 1;
      } else {
        if (options.apply) {
          const { body, contentType } = await source.read(key);
          if (body.byteLength !== size) throw new Error("read a different size than listed");
          await destination.write(key, body, contentType);
          if ((await destination.size(key)) !== size) throw new Error("the copy is not the original's size");
        }
        copied += 1;
      }
      if (options.apply) {
        await source.remove(key);
        removed += 1;
      }
    } catch (error: unknown) {
      failed.push({ key, reason: error instanceof Error ? `${error.name}: ${error.message}` : "unknown error" });
    }
  }

  return { found: objects.length, copied, alreadyMoved, removed, failed };
}

// ---------------------------------------------------------------------------
// R2, through the S3 API
// ---------------------------------------------------------------------------

const SettingsSchema = z.object({
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET_NAME: z.string().min(1),
  PRIVATE_UPLOADS_R2_ACCOUNT_ID: z.string().min(1),
  PRIVATE_UPLOADS_R2_ACCESS_KEY_ID: z.string().min(1),
  PRIVATE_UPLOADS_R2_SECRET_ACCESS_KEY: z.string().min(1),
  PRIVATE_UPLOADS_R2_BUCKET: z.string().min(1),
}).refine((settings) => settings.R2_BUCKET_NAME !== settings.PRIVATE_UPLOADS_R2_BUCKET, {
  message: "the public and private buckets must differ",
});

interface Bucket {
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly name: string;
}

async function r2Store(bucket: Bucket): Promise<MoveObjectStore> {
  const {
    S3Client, ListObjectsV2Command, HeadObjectCommand, GetObjectCommand, PutObjectCommand, DeleteObjectCommand,
  } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${bucket.accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    maxAttempts: 3,
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: { accessKeyId: bucket.accessKeyId, secretAccessKey: bucket.secretAccessKey },
  });
  return {
    async list(prefix) {
      const objects: { key: string; size: number }[] = [];
      let token: string | undefined;
      do {
        const page = await client.send(new ListObjectsV2Command({ Bucket: bucket.name, Prefix: prefix, ContinuationToken: token }));
        for (const object of page.Contents ?? []) {
          if (object.Key !== undefined) objects.push({ key: object.Key, size: object.Size ?? 0 });
        }
        token = page.IsTruncated === true ? page.NextContinuationToken : undefined;
      } while (token !== undefined);
      return objects;
    },
    async size(key) {
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket: bucket.name, Key: key }));
        return head.ContentLength ?? 0;
      } catch (error: unknown) {
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404) return null;
        throw error;
      }
    },
    async read(key) {
      const object = await client.send(new GetObjectCommand({ Bucket: bucket.name, Key: key }));
      if (object.Body === undefined) throw new Error("empty response");
      return { body: await object.Body.transformToByteArray(), contentType: object.ContentType };
    },
    async write(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: bucket.name, Key: key, Body: body, ContentType: contentType }));
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket.name, Key: key }));
    },
  };
}

async function main(): Promise<number> {
  const apply = process.argv.includes("--apply");
  const parsed = SettingsSchema.safeParse(process.env);
  if (!parsed.success) {
    // Names only: a value is never printed.
    const names = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || issue.message))];
    console.error(`Missing or invalid settings: ${names.join(", ")}`);
    return 1;
  }
  const settings = parsed.data;
  const source = await r2Store({
    accountId: settings.R2_ACCOUNT_ID,
    accessKeyId: settings.R2_ACCESS_KEY_ID,
    secretAccessKey: settings.R2_SECRET_ACCESS_KEY,
    name: settings.R2_BUCKET_NAME,
  });
  const destination = await r2Store({
    accountId: settings.PRIVATE_UPLOADS_R2_ACCOUNT_ID,
    accessKeyId: settings.PRIVATE_UPLOADS_R2_ACCESS_KEY_ID,
    secretAccessKey: settings.PRIVATE_UPLOADS_R2_SECRET_ACCESS_KEY,
    name: settings.PRIVATE_UPLOADS_R2_BUCKET,
  });

  const report = await movePrivateUploads(source, destination, { apply });
  const mode = apply ? "Moved" : "Dry run (nothing written; add --apply to move)";
  console.log(`${mode}: ${String(report.found)} private objects in the public bucket; ` +
    `${String(report.copied)} ${apply ? "copied" : "to copy"}, ${String(report.alreadyMoved)} already in the private bucket, ` +
    `${String(report.removed)} removed from the public bucket, ${String(report.failed.length)} failed.`);
  for (const { key, reason } of report.failed) console.error(`Kept in the public bucket: ${key} (${reason})`);
  return report.failed.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => { process.exit(code); },
    (error: unknown) => {
      console.error(`Move failed: ${error instanceof Error ? error.name : "unknown error"}`);
      process.exit(1);
    },
  );
}
