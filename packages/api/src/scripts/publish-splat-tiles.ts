import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { S3Client, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

// ---------------------------------------------------------------------------
// Publish staged Gaussian-splat tiles to R2.
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
// Credentials come from packages/api/.env and are never printed.
//
//   pnpm --filter @omnitwin/api exec tsx src/scripts/publish-splat-tiles.ts \
//     --staged "D:\\claude\\splats" [--venue trades-hall] [--dry-run]
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
const SERVABLE = [".sog", ".spz", ".ply", ".splat", ".ksplat"];

interface Tile {
  readonly room: string;
  readonly file: string;
  readonly path: string;
  readonly bytes: number;
}

function collectTiles(stagedRoot: string, venue: string): Tile[] {
  const venueRoot = join(stagedRoot, venue);
  if (!existsSync(venueRoot)) return [];
  const tiles: Tile[] = [];
  for (const room of readdirSync(venueRoot)) {
    const roomDir = join(venueRoot, room);
    if (!statSync(roomDir).isDirectory()) continue;
    for (const file of readdirSync(roomDir)) {
      if (!SERVABLE.some((ext) => file.toLowerCase().endsWith(ext))) continue;
      const path = join(roomDir, file);
      tiles.push({ room, file, path, bytes: statSync(path).size });
    }
  }
  return tiles.sort((a, b) => a.room.localeCompare(b.room) || a.file.localeCompare(b.file));
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

void main();
