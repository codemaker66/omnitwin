/**
 * Operator script: register the Reception Room XGRIDS LCC2 *SPZ* export as the
 * primary Reception Room runtime visual, replacing the prior SOG package.
 *
 * The new bundle (`reception-room_xgrids_lcc2_spz_visual`) is the same PortalCam
 * capture re-exported to `.spz` (scanDuration 908.0854752063751 matches the SOG
 * intake). It uploads the seven manifest room SPZ chunks to R2 (env.spz is an
 * environment chunk, excluded from the served room total), registers each as a
 * `usable` / `unverified` splat asset version, and upserts the
 * trades-hall / reception-room runtime package to point its primary visual at
 * the new SPZ. Statuses stay internal: package `internal_ready` / `unverified`,
 * which the runtime API surfaces as "Runtime asset loaded, not yet
 * verified/signed". It does NOT establish signed alignment, exposure approval,
 * or mark T-091/T-091A complete, and it makes no public/customer-facing claims.
 *
 * Re-runnable: an asset already uploaded+registered at the same r2Key is reused
 * rather than duplicated.
 *
 * Run from packages/api:
 *   node --env-file=.env --import tsx src/scripts/register-reception-room-spz-runtime.ts <bundle-dir>
 * where <bundle-dir> contains `lcc2-result/data/3dgs/*.spz`.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { S3Client } from "@aws-sdk/client-s3";
import { and, eq } from "drizzle-orm";
import { createDb, type Database } from "../db/client.js";
import { assetVersions, runtimePackages } from "../db/schema.js";

const VENUE_SLUG = "trades-hall";
const ROOM_SLUG = "reception-room";
// Reuse the existing Reception Room PortalCam capture session (same scan).
const CAPTURE_SESSION_ID = "a7225d50-0403-46ac-8490-ecc78f6450e7";
// Distinguishes the SPZ re-export (build start 2026-06-15) from the SOG keys.
const R2_PREFIX = "venues/trades-hall/rooms/reception-room/xgrids/2026-06-15/lcc2-result-spz/data/3dgs";
// The seven manifest room chunks. env.spz is an environment chunk and is NOT a
// room chunk, so it is neither served nor required here.
const ROOM_CHUNK_FILES = [
  "0_0.spz",
  "0_2_0.spz",
  "0_3_0.spz",
  "0_3_0_0.spz",
  "0_7_0_1.spz",
  "0_8_0_0.spz",
  "0_13_0_0.spz",
] as const;
const PRIMARY_FILE = "0_0.spz";

interface RegisteredChunk {
  readonly id: string;
  readonly fileName: string;
}

function writeInfo(message: string): void {
  process.stdout.write(`${message}\n`);
}

function writeError(error: unknown): void {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function makeS3Client(): Promise<S3Client> {
  const { S3Client: S3ClientCtor } = await import("@aws-sdk/client-s3");
  return new S3ClientCtor({
    region: "auto",
    endpoint: `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    maxAttempts: 3,
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
}

async function uploadAndRegisterChunk(
  db: Database,
  s3: S3Client,
  bucket: string,
  bundleDir: string,
  fileName: string,
): Promise<RegisteredChunk> {
  const r2Key = `${R2_PREFIX}/${fileName}`;

  const [existing] = await db
    .select()
    .from(assetVersions)
    .where(and(eq(assetVersions.r2Key, r2Key), eq(assetVersions.venueSlug, VENUE_SLUG)))
    .limit(1);
  if (existing !== undefined) {
    writeInfo(`  reuse  ${fileName} -> ${existing.id} (already registered at ${r2Key})`);
    return { id: existing.id, fileName };
  }

  const body = await readFile(join(bundleDir, "lcc2-result", "data", "3dgs", fileName));
  const sha256 = createHash("sha256").update(body).digest("hex");

  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: r2Key,
    Body: body,
    ContentType: "application/octet-stream",
  }));

  const [version] = await db.insert(assetVersions).values({
    venueSlug: VENUE_SLUG,
    roomSlug: ROOM_SLUG,
    captureSessionId: CAPTURE_SESSION_ID,
    assetKind: "splat",
    sourceType: "xgrids",
    fileName,
    fileExt: ".spz",
    r2Key,
    externalUrl: null,
    mimeType: "application/octet-stream",
    sha256,
    sizeBytes: body.byteLength,
    evidenceStatus: "unverified",
    runtimeStatus: "usable",
    notes: "Reception Room XGRIDS LCC2 SPZ room chunk (Reception Room Mobile). Internal runtime visual; human QA, signed alignment, and exposure review still required.",
  }).returning();
  if (version === undefined) throw new Error(`Failed to register asset version for ${fileName}`);

  writeInfo(`  upload ${fileName} -> ${version.id} (${String(body.byteLength)} bytes, sha256 ${sha256.slice(0, 12)}...)`);
  return { id: version.id, fileName };
}

async function upsertRuntimePackage(db: Database, primaryAssetVersionId: string): Promise<string> {
  const manifestJson = {
    schemaVersion: "venviewer.runtime-package.v1" as const,
    venueSlug: VENUE_SLUG,
    roomSlug: ROOM_SLUG,
    packageType: "room-runtime" as const,
    assets: {
      primaryVisualAssetVersionId: primaryAssetVersionId,
      semanticMeshAssetVersionId: null,
      collisionAssetVersionId: null,
      pointCloudAssetVersionId: null,
    },
    generatedAt: new Date().toISOString(),
    notes: "Internal smoke package for the Reception Room XGRIDS LCC2 SPZ output (Reception Room Mobile). The runtime API serves the seven manifest room SPZ chunks and excludes env.spz; visual composition, room-local transform, exposure tier, and signing still require human QA. Runtime asset loaded, not yet verified/signed.",
  };

  const values = {
    venueSlug: VENUE_SLUG,
    roomSlug: ROOM_SLUG,
    primaryVisualAssetVersionId: primaryAssetVersionId,
    semanticMeshAssetVersionId: null,
    collisionAssetVersionId: null,
    pointCloudAssetVersionId: null,
    manifestJson,
    evidenceStatus: "unverified" as const,
    runtimeStatus: "internal_ready" as const,
    updatedAt: new Date(),
  };

  const [existing] = await db
    .select()
    .from(runtimePackages)
    .where(and(eq(runtimePackages.venueSlug, VENUE_SLUG), eq(runtimePackages.roomSlug, ROOM_SLUG)))
    .limit(1);

  const [pkg] = existing === undefined
    ? await db.insert(runtimePackages).values(values).returning()
    : await db.update(runtimePackages).set(values).where(eq(runtimePackages.id, existing.id)).returning();
  if (pkg === undefined) throw new Error("Failed to upsert runtime package");
  return pkg.id;
}

async function main(): Promise<void> {
  const bundleDir = process.argv[2];
  if (bundleDir === undefined) {
    throw new Error("Usage: register-reception-room-spz-runtime.ts <bundle-dir>");
  }
  const databaseUrl = requireEnv("DATABASE_URL");
  const bucket = requireEnv("R2_BUCKET_NAME");

  const db = createDb(databaseUrl);
  const s3 = await makeS3Client();

  writeInfo(`Registering Reception Room SPZ runtime from ${bundleDir}`);
  writeInfo(`Bundle dir: ${basename(bundleDir)}`);

  const registered: RegisteredChunk[] = [];
  for (const fileName of ROOM_CHUNK_FILES) {
    registered.push(await uploadAndRegisterChunk(db, s3, bucket, bundleDir, fileName));
  }

  const primary = registered.find((chunk) => chunk.fileName === PRIMARY_FILE);
  if (primary === undefined) throw new Error(`Primary chunk ${PRIMARY_FILE} was not registered`);

  const packageId = await upsertRuntimePackage(db, primary.id);

  writeInfo("");
  writeInfo(`Runtime package ${packageId} upserted.`);
  writeInfo(`  venue/room: ${VENUE_SLUG}/${ROOM_SLUG}`);
  writeInfo(`  primary visual: ${primary.id} (${PRIMARY_FILE})`);
  writeInfo(`  served room chunks: ${String(registered.length)} (env.spz excluded)`);
  writeInfo("  status: internal_ready / unverified");
}

main().then(
  () => { process.exit(0); },
  (error: unknown) => {
    writeError(error);
    process.exit(1);
  },
);
