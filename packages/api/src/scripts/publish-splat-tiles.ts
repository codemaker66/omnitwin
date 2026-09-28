import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { S3Client, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

// ---------------------------------------------------------------------------
// Publish staged Gaussian-splat tiles, or one versioned room package, to R2.
//
// Tile bytes are deliberately not in the repository (roughly a gigabyte across
// the eight Trades Hall rooms), so production reads them from R2 under the same
// path shape the dev middleware serves: splats/<venue>/<room>/<tile>.
//
// Idempotent and safe to re-run: a tile already present at the same byte length
// is skipped, so a partial or interrupted run resumes rather than re-uploading a
// gigabyte. It only reads the staging root and writes objects; it never deletes,
// and never touches a capture root.
//
// A room package (--package <room>/<package>/v<number>, e.g. the Grand Hall's
// photographic floor skin) is checksummed and immutable per version: a rebuilt
// package is staged and published as the next version (v2) rather than
// overwriting v1, because objects are cached as immutable for a year.
//
// Credentials come from packages/api/.env and are never printed.
//
//   pnpm --filter @omnitwin/api exec tsx src/scripts/publish-splat-tiles.ts \
//     --staged "D:\\claude\\splats" [--venue trades-hall] [--dry-run]
//
//   pnpm --filter @omnitwin/api exec tsx src/scripts/publish-splat-tiles.ts \
//     --staged "D:\\claude\\splats" --package grand-hall/floor-skin/v1 [--dry-run]
// ---------------------------------------------------------------------------

interface R2Config {
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
  readonly publicUrl: string;
}

/** Reads R2 settings from packages/api/.env without echoing secrets. */
function readR2Config(envPath: string): R2Config | string {
  if (!existsSync(envPath)) return `No env file at ${envPath}`;
  const values = new Map<string, string>();
  for (const rawLine of readFileSync(envPath, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    values.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim().replace(/^"|"$/g, ""));
  }
  const required = [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
    "R2_PUBLIC_URL",
  ] as const;
  const missing = required.filter((key) => (values.get(key) ?? "").length === 0);
  if (missing.length > 0) return `Missing in ${envPath}: ${missing.join(", ")}`;
  return {
    accountId: values.get("R2_ACCOUNT_ID") ?? "",
    accessKeyId: values.get("R2_ACCESS_KEY_ID") ?? "",
    secretAccessKey: values.get("R2_SECRET_ACCESS_KEY") ?? "",
    bucket: values.get("R2_BUCKET_NAME") ?? "",
    publicUrl: (values.get("R2_PUBLIC_URL") ?? "").replace(/\/$/, ""),
  };
}

/** Splat tiles are immutable: a tile is fixed by the capture it came from. */
const CACHE_CONTROL = "public, max-age=31536000, immutable";
const CONTENT_TYPE = "application/octet-stream";
/** Tiles, plus Spark's prebuilt level-of-detail trees (`.rad` header, `.radc` chunks). */
const SERVABLE = [".sog", ".spz", ".ply", ".splat", ".ksplat", ".rad", ".radc"];
/** Where `lcc2 lod` puts a room's prebuilt trees, beside its tiles. */
const LOD_DIR = "lod";

export interface Tile {
  readonly room: string;
  /** Path relative to the room: `0_0.sog`, or `lod/0_0-lod.rad`. */
  readonly file: string;
  readonly path: string;
  readonly bytes: number;
}

function servable(file: string): boolean {
  const lower = file.toLowerCase();
  return SERVABLE.some((ext) => lower.endsWith(ext));
}

/**
 * Everything under a venue's staging root that the viewer can load: the tiles
 * in each room, and the prebuilt trees one level down in `lod/`. A tree's
 * header names its chunks relative to itself, so both go up under the same
 * `lod/` prefix and resolve on the bucket exactly as they do on disk.
 */
export function collectTiles(stagedRoot: string, venue: string): Tile[] {
  const venueRoot = join(stagedRoot, venue);
  if (!existsSync(venueRoot)) return [];
  const tiles: Tile[] = [];
  for (const room of readdirSync(venueRoot)) {
    const roomDir = join(venueRoot, room);
    if (!statSync(roomDir).isDirectory()) continue;
    for (const file of readdirSync(roomDir)) {
      const path = join(roomDir, file);
      if (file === LOD_DIR && statSync(path).isDirectory()) {
        for (const tree of readdirSync(path)) {
          if (!servable(tree)) continue;
          const treePath = join(path, tree);
          tiles.push({ room, file: `${LOD_DIR}/${tree}`, path: treePath, bytes: statSync(treePath).size });
        }
        continue;
      }
      if (!servable(file)) continue;
      tiles.push({ room, file, path, bytes: statSync(path).size });
    }
  }
  return tiles.sort((a, b) => a.room.localeCompare(b.room) || a.file.localeCompare(b.file));
}

export interface PackageFile {
  readonly key: string;
  readonly path: string;
  readonly bytes: number;
  readonly contentType: string;
  readonly sha256: string;
}

/** Package files keep their real content type; splat tiles never need one. */
const PACKAGE_CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ktx2": "image/ktx2",
};

export function packageContentType(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot === -1 ? "" : name.slice(dot).toLowerCase();
  return PACKAGE_CONTENT_TYPES[ext] ?? CONTENT_TYPE;
}

const PACKAGE_PATH_SEGMENT = /^[a-z0-9][a-z0-9-]*$/;
const PACKAGE_PATH_VERSION = /^v[0-9]+$/;

/**
 * A room package (T-639) is a small, versioned bundle staged beside a room's
 * splat tiles — e.g. the Grand Hall's photographic floor skin. Every file
 * directly inside the version directory is collected (no recursion, so a
 * `scratch/` working folder beside the package is never published); the
 * manifest (the one file ending in `.json`) sorts last so a reader never
 * finds a manifest whose other files are absent.
 */
export function collectPackage(stagedRoot: string, venue: string, packagePath: string): PackageFile[] {
  const segments = packagePath.split("/");
  const validPackagePath = segments.length === 3 && segments.every((segment, index) => (
    index === 2 ? PACKAGE_PATH_VERSION.test(segment) : PACKAGE_PATH_SEGMENT.test(segment)
  ));
  if (!validPackagePath) {
    throw new Error(`Invalid package path "${packagePath}": expected <room>/<package>/v<number>`);
  }

  const dir = join(stagedRoot, venue, packagePath);
  if (!existsSync(dir)) return [];

  const names = readdirSync(dir).filter((name) => statSync(join(dir, name)).isFile());
  names.sort((a, b) => {
    const aJson = a.toLowerCase().endsWith(".json");
    const bJson = b.toLowerCase().endsWith(".json");
    if (aJson !== bJson) return aJson ? 1 : -1;
    return a.localeCompare(b);
  });

  return names.map((name) => {
    const path = join(dir, name);
    const bytes = readFileSync(path);
    return {
      key: `splats/${venue}/${packagePath}/${name}`,
      path,
      bytes: bytes.byteLength,
      contentType: packageContentType(name),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  });
}

export type PackageUploadAction = "put" | "skip" | "conflict";

/**
 * A published package version is immutable: the same bytes may be re-sent (a
 * resumed or repeated run skips them), but different or unverifiable bytes at
 * an already-published key are a conflict rather than a silent overwrite —
 * unlike tile mode's byte-length-only check, which cannot tell a rebuilt
 * fixed-size `.i16`/`.u8` file from the one already on the bucket.
 */
export function packageUploadAction(
  localSha256: string,
  remote: { readonly sha256: string | undefined } | null,
): PackageUploadAction {
  if (remote === null) return "put";
  if (remote.sha256 === localSha256) return "skip";
  return "conflict";
}

/** A HEAD miss surfaces as this error shape; any other HEAD failure is real. */
function isNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const value = error as Error & { name: string; $metadata?: { httpStatusCode?: number } };
  return value.name === "NotFound" || value.$metadata?.httpStatusCode === 404;
}

/**
 * Publishes one staged room package version. Every object is checksummed
 * (see `packageUploadAction`): a matching key is skipped so a resumed or
 * repeated run is safe, but a key already published with different bytes is
 * a failure rather than a silent overwrite. The manifest — the collected
 * order's final `.json` file — is withheld if any earlier file in this run
 * failed, so a reader never finds a manifest whose files are absent.
 */
async function runPackageMode(
  stagedRoot: string,
  venue: string,
  packagePath: string,
  config: R2Config,
  dryRun: boolean,
): Promise<void> {
  let files: PackageFile[];
  try {
    files = collectPackage(stagedRoot, venue, packagePath);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }

  if (files.length === 0) {
    process.stderr.write(`No package files under ${join(stagedRoot, venue, packagePath)}.\n`);
    process.exitCode = 1;
    return;
  }

  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  process.stdout.write(
    `${String(files.length)} files, ${(totalBytes / 1024 / 1024).toFixed(0)} MB -> ` +
    `bucket ${config.bucket} as splats/${venue}/${packagePath}/<file>\n`,
  );
  process.stdout.write(`Public base: ${config.publicUrl}\n\n`);

  if (dryRun) {
    for (const file of files) {
      process.stdout.write(`  would put ${file.key} (${file.contentType}, sha256 ${file.sha256.slice(0, 12)})\n`);
    }
    return;
  }

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });

  let uploaded = 0;
  let skipped = 0;
  let uploadedBytes = 0;
  const failures: string[] = [];

  for (const [index, file] of files.entries()) {
    const isManifest = file.key.toLowerCase().endsWith(".json");
    if (isManifest && failures.length > 0) {
      failures.push(`${file.key}: manifest withheld because ${String(failures.length)} package file(s) failed`);
      continue;
    }

    try {
      let remote: { readonly sha256: string | undefined } | null;
      try {
        const head = await s3.send(new HeadObjectCommand({ Bucket: config.bucket, Key: file.key }));
        remote = { sha256: head.Metadata?.["sha256"] };
      } catch (headError) {
        if (!isNotFound(headError)) throw headError;
        remote = null;
      }

      const action = packageUploadAction(file.sha256, remote);
      if (action === "skip") {
        skipped += 1;
        continue;
      }
      if (action === "conflict") {
        failures.push(
          `${file.key}: already published with different bytes; stage and publish a new version directory instead`,
        );
        continue;
      }

      const body = readFileSync(file.path);
      await s3.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: file.key,
        Body: body,
        ContentType: file.contentType,
        CacheControl: CACHE_CONTROL,
        ChecksumSHA256: createHash("sha256").update(body).digest("base64"),
        Metadata: { sha256: file.sha256 },
      }));
      uploaded += 1;
      uploadedBytes += file.bytes;
      process.stdout.write(
        `[${String(index + 1).padStart(3)}/${String(files.length)}] ${file.key} ` +
        `(${(file.bytes / 1024 / 1024).toFixed(1)} MB)\n`,
      );
    } catch (error) {
      failures.push(`${file.key}: ${String(error)}`);
    }
  }

  process.stdout.write(
    `\nuploaded ${String(uploaded)} (${(uploadedBytes / 1024 / 1024).toFixed(0)} MB), ` +
    `skipped ${String(skipped)} already present, failed ${String(failures.length)}\n`,
  );
  for (const failure of failures) process.stdout.write(`  FAILED ${failure}\n`);
  if (failures.length > 0) process.exitCode = 1;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (name: string): string | null => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? null : argv[i + 1] ?? null;
  };
  const stagedRoot = flag("staged");
  const venue = flag("venue") ?? "trades-hall";
  const dryRun = argv.includes("--dry-run");
  const packagePath = flag("package");

  if (stagedRoot === null) {
    process.stderr.write("Provide --staged <staging root>.\n");
    process.exitCode = 1;
    return;
  }

  const config = readR2Config(join(process.cwd(), ".env"));
  if (typeof config === "string") {
    process.stderr.write(`${config}\n`);
    process.exitCode = 1;
    return;
  }

  if (packagePath !== null) {
    await runPackageMode(stagedRoot, venue, packagePath, config, dryRun);
    return;
  }

  const tiles = collectTiles(stagedRoot, venue);
  if (tiles.length === 0) {
    process.stderr.write(`No tiles found under ${join(stagedRoot, venue)}.\n`);
    process.exitCode = 1;
    return;
  }

  const totalBytes = tiles.reduce((sum, tile) => sum + tile.bytes, 0);
  process.stdout.write(
    `${String(tiles.length)} tiles, ${(totalBytes / 1024 / 1024).toFixed(0)} MB -> ` +
    `bucket ${config.bucket} as splats/${venue}/<room>/<tile>\n`,
  );
  process.stdout.write(`Public base: ${config.publicUrl}\n\n`);

  if (dryRun) {
    for (const tile of tiles.slice(0, 5)) {
      process.stdout.write(`  would put splats/${venue}/${tile.room}/${tile.file}\n`);
    }
    process.stdout.write(`  ... and ${String(Math.max(0, tiles.length - 5))} more (dry run)\n`);
    return;
  }

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });

  let uploaded = 0;
  let skipped = 0;
  let uploadedBytes = 0;
  const failures: string[] = [];

  for (const [index, tile] of tiles.entries()) {
    const key = `splats/${venue}/${tile.room}/${tile.file}`;
    try {
      // Already present at the same length: skip, so an interrupted run resumes.
      const head = await s3
        .send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }))
        .catch(() => null);
      if (head !== null && head.ContentLength === tile.bytes) {
        skipped += 1;
        continue;
      }

      const body = readFileSync(tile.path);
      await s3.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: body,
        ContentType: CONTENT_TYPE,
        CacheControl: CACHE_CONTROL,
        ChecksumSHA256: createHash("sha256").update(body).digest("base64"),
      }));
      uploaded += 1;
      uploadedBytes += tile.bytes;
      process.stdout.write(
        `[${String(index + 1).padStart(3)}/${String(tiles.length)}] ${key} ` +
        `(${(tile.bytes / 1024 / 1024).toFixed(1)} MB)\n`,
      );
    } catch (error) {
      failures.push(`${key}: ${String(error)}`);
    }
  }

  process.stdout.write(
    `\nuploaded ${String(uploaded)} (${(uploadedBytes / 1024 / 1024).toFixed(0)} MB), ` +
    `skipped ${String(skipped)} already present, failed ${String(failures.length)}\n`,
  );
  for (const failure of failures) process.stdout.write(`  FAILED ${failure}\n`);
  if (failures.length > 0) process.exitCode = 1;
}

// Run only when invoked directly; importing the module (as its test does)
// must not start an upload or touch the exit code.
const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) void main();
