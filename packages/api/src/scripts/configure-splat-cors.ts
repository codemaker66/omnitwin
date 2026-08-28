import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GetBucketCorsCommand, PutBucketCorsCommand, S3Client } from "@aws-sdk/client-s3";

// ---------------------------------------------------------------------------
// Allow the web app to fetch splat tiles from R2.
//
// An R2 public bucket serves its objects to anyone, but it does NOT send CORS
// headers unless a policy says to. Splats are fetched as ArrayBuffers, which is
// a CORS-governed request, so without this every tile returns 200 to the
// network and is then discarded by the browser — the room renders nothing and
// honestly reports every part as failed.
//
// Read-only, idempotent and scoped: GET/HEAD from the app's own origins. It
// never opens the bucket for writes and never allows credentials.
//
//   pnpm --filter @omnitwin/api exec tsx src/scripts/configure-splat-cors.ts [--apply]
//
// Without --apply it prints the current and proposed policies and changes
// nothing.
// ---------------------------------------------------------------------------

/**
 * Origins allowed to read tiles.
 *
 * Vercel preview deployments each get their own hostname, so the wildcard
 * covers them; production and local development are named explicitly.
 */
const ALLOWED_ORIGINS = [
  "https://venviewer.com",
  "https://www.venviewer.com",
  "https://*.vercel.app",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5192",
] as const;

interface R2Config {
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
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
  ] as const;
  const missing = required.filter((key) => (values.get(key) ?? "").length === 0);
  if (missing.length > 0) return `Missing in ${envPath}: ${missing.join(", ")}`;
  return {
    accountId: values.get("R2_ACCOUNT_ID") ?? "",
    accessKeyId: values.get("R2_ACCESS_KEY_ID") ?? "",
    secretAccessKey: values.get("R2_SECRET_ACCESS_KEY") ?? "",
    bucket: values.get("R2_BUCKET_NAME") ?? "",
  };
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const config = readR2Config(join(process.cwd(), ".env"));
  if (typeof config === "string") {
    process.stderr.write(`${config}\n`);
    process.exitCode = 1;
    return;
  }

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  const current = await s3
    .send(new GetBucketCorsCommand({ Bucket: config.bucket }))
    .catch(() => null);
  process.stdout.write(
    `bucket ${config.bucket}\ncurrent CORS: ${
      current === null ? "none" : JSON.stringify(current.CORSRules)
    }\n\n`,
  );

  const rules = [
    {
      AllowedOrigins: [...ALLOWED_ORIGINS],
      // Reading tiles only. The bucket is never opened for browser writes.
      AllowedMethods: ["GET", "HEAD"],
      AllowedHeaders: ["*"],
      ExposeHeaders: ["Content-Length", "Content-Type"],
      MaxAgeSeconds: 86400,
    },
  ];

  if (!apply) {
    process.stdout.write(
      `proposed: ${JSON.stringify(rules, null, 2)}\n\nRe-run with --apply to set it.\n`,
    );
    return;
  }

  await s3.send(new PutBucketCorsCommand({
    Bucket: config.bucket,
    CORSConfiguration: { CORSRules: rules },
  }));

  const after = await s3
    .send(new GetBucketCorsCommand({ Bucket: config.bucket }))
    .catch(() => null);
  process.stdout.write(
    `applied. now: ${after === null ? "unreadable" : JSON.stringify(after.CORSRules)}\n`,
  );
}

void main();
