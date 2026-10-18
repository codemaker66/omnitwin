import Fastify, { type FastifyInstance } from "fastify";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../db/client.js";
import { validateEnv, type Env } from "../env.js";
import type { JwtUser } from "../middleware/auth.js";

// ---------------------------------------------------------------------------
// Private uploads never share the publicly served bucket.
//
// The R2_* bucket is published through its r2.dev URL, which serves every
// object to anyone holding the key, signed or not. Private uploads (venue
// files, spaces, loadouts, enquiry attachments, the asset catalogue) must
// therefore live in the PRIVATE_UPLOADS_R2_* bucket, which has no public URL,
// so a signed URL is the only way to read them. These tests pin:
//
//   1. Every private upload scope resolves to the private bucket, and the key
//      prefix must agree with the visibility, whatever the context.
//   2. Without the private bucket, private uploads are refused (503) — never
//      written to the public bucket instead.
//   3. Presigned writes and signed reads use the private bucket's own token.
//   4. Loadout photos are read by venue staff only, through signed URLs, and
//      only for files uploaded into that loadout's own scope.
// ---------------------------------------------------------------------------

interface RecordedCommand {
  readonly kind: "put" | "get";
  readonly input: { readonly Bucket: string; readonly Key: string };
}

interface FakeClientConfig {
  readonly endpoint: string;
  readonly credentials: { readonly accessKeyId: string };
}

const s3 = vi.hoisted(() => ({ commands: [] as RecordedCommand[] }));

vi.mock("@aws-sdk/client-s3", () => {
  class S3Client {
    readonly config: FakeClientConfig;
    constructor(config: FakeClientConfig) { this.config = config; }
  }
  class PutObjectCommand {
    readonly input: RecordedCommand["input"];
    constructor(input: RecordedCommand["input"]) {
      this.input = input;
      s3.commands.push({ kind: "put", input });
    }
  }
  class GetObjectCommand {
    readonly input: RecordedCommand["input"];
    constructor(input: RecordedCommand["input"]) {
      this.input = input;
      s3.commands.push({ kind: "get", input });
    }
  }
  return { S3Client, PutObjectCommand, GetObjectCommand };
});

// A deterministic stand-in for SigV4 that still records which endpoint,
// bucket, key and token a URL was signed for.
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: (
    client: { readonly config: FakeClientConfig },
    command: { readonly input: RecordedCommand["input"] },
    options: { readonly expiresIn: number },
  ): Promise<string> => Promise.resolve(
    `${client.config.endpoint}/${command.input.Bucket}/${command.input.Key}` +
    `?X-Amz-Credential=${client.config.credentials.accessKeyId}` +
    `&X-Amz-Expires=${String(options.expiresIn)}&X-Amz-Signature=test`,
  ),
}));

const {
  UPLOAD_CONTEXTS,
  buildScopedFileKey,
  resolveUploadScope,
  uploadRoutes,
  uploadStorageFor,
} = await import("../routes/uploads.js");
const { referenceLoadoutRoutes } = await import("../routes/reference-loadouts.js");

const VENUE_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_VENUE_ID = "00000000-0000-4000-8000-000000000002";
const SPACE_ID = "00000000-0000-4000-8000-000000000003";
const LOADOUT_ID = "00000000-0000-4000-8000-000000000004";
const FILE_ID = "00000000-0000-4000-8000-000000000005";
const PHOTO_ID = "00000000-0000-4000-8000-000000000006";

const PUBLIC_BUCKET = "omnitwin-uploads-test";
const PRIVATE_BUCKET = "omnitwin-private-uploads-test";
const PUBLIC_URL = "https://pub-public-test.r2.dev";

const PUBLIC_R2 = {
  R2_ACCOUNT_ID: "public-account",
  R2_ACCESS_KEY_ID: "public-access-key",
  R2_SECRET_ACCESS_KEY: "public-secret-key",
  R2_BUCKET_NAME: PUBLIC_BUCKET,
  R2_PUBLIC_URL: PUBLIC_URL,
} as const;

const PRIVATE_R2 = {
  PRIVATE_UPLOADS_R2_ACCOUNT_ID: "private-account",
  PRIVATE_UPLOADS_R2_ACCESS_KEY_ID: "private-access-key",
  PRIVATE_UPLOADS_R2_SECRET_ACCESS_KEY: "private-secret-key",
  PRIVATE_UPLOADS_R2_BUCKET: PRIVATE_BUCKET,
} as const;

const BOTH_BUCKETS: Env = validateEnv({ DATABASE_URL: "postgresql://unused/unused", ...PUBLIC_R2, ...PRIVATE_R2 });
const PUBLIC_ONLY: Env = validateEnv({ DATABASE_URL: "postgresql://unused/unused", ...PUBLIC_R2 });

const admin: JwtUser = {
  id: "admin-user", email: "admin@private-uploads.invalid", name: "Platform Admin",
  role: "admin", platformRole: "admin", venueId: null,
};

function bearer(user: { id: string; email: string; role: string; venueId: string | null; platformRole?: string }): Record<string, string> {
  return { authorization: `Bearer ${JSON.stringify(user)}` };
}

const STAFF = bearer({ id: "staff-user", email: "staff@private-uploads.invalid", role: "staff", venueId: VENUE_ID });
const OUTSIDER = bearer({ id: "outsider", email: "outsider@private-uploads.invalid", role: "staff", venueId: OTHER_VENUE_ID });
const ADMIN = bearer({ id: admin.id, email: admin.email, role: "admin", platformRole: "admin", venueId: null });

// ---------------------------------------------------------------------------
// A database whose successive select chains resolve to the queued rows. The
// join condition of every innerJoin is captured so tests can read its SQL.
// ---------------------------------------------------------------------------

interface FakeSelectChain {
  from: (table: unknown) => FakeSelectChain;
  where: (...conditions: readonly unknown[]) => FakeSelectChain;
  innerJoin: (table: unknown, condition: SQL) => FakeSelectChain;
  orderBy: (...columns: readonly unknown[]) => Promise<readonly unknown[]>;
  limit: (count: number) => Promise<readonly unknown[]>;
}

interface FakeInsert {
  values: (values: Record<string, unknown>) => { returning: () => Promise<readonly unknown[]> };
}

interface FakeDb {
  readonly db: Database;
  readonly joins: SQL[];
  readonly inserted: Record<string, unknown>[];
}

function fakeDb(selects: readonly (readonly unknown[])[]): FakeDb {
  const joins: SQL[] = [];
  const inserted: Record<string, unknown>[] = [];
  let next = 0;
  const select = (): FakeSelectChain => {
    const rows = selects[next] ?? [];
    next += 1;
    const chain: FakeSelectChain = {
      from: () => chain,
      where: () => chain,
      innerJoin: (_table, condition) => { joins.push(condition); return chain; },
      orderBy: () => Promise.resolve(rows),
      limit: () => Promise.resolve(rows),
    };
    return chain;
  };
  const insert = (): FakeInsert => ({
    values: (values) => {
      inserted.push(values);
      return { returning: () => Promise.resolve([{ id: FILE_ID, ...values }]) };
    },
  });
  const db = {} as Database;
  Reflect.set(db, "select", select);
  Reflect.set(db, "insert", insert);
  return { db, joins, inserted };
}

/** A database any read of which fails the test: the request must be refused first. */
const untouchableDb = {} as Database;
Reflect.set(untouchableDb, "select", (): never => { throw new Error("database read before authorization"); });

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  s3.commands.length = 0;
});
afterEach(() => { vi.unstubAllEnvs(); });

// ---------------------------------------------------------------------------
// Storage routing
// ---------------------------------------------------------------------------

describe("upload storage routing", () => {
  it.each(UPLOAD_CONTEXTS)("routes every %s upload to the bucket its visibility demands", async (context) => {
    const visibility = context === "public_marketing" ? "public" : "private";
    const { db } = fakeDb([[{ venueId: VENUE_ID, userId: admin.id }]]);

    const scope = await resolveUploadScope(db, admin, context, VENUE_ID, visibility);
    expect(scope).not.toBeNull();
    if (scope === null) return;

    const key = buildScopedFileKey(scope, "image/jpeg");
    const storage = uploadStorageFor(BOTH_BUCKETS, scope.visibility, key);

    if (visibility === "private") {
      expect(key.startsWith("private/")).toBe(true);
      expect(storage?.bucket).toBe(PRIVATE_BUCKET);
      expect(storage?.accessKeyId).toBe(PRIVATE_R2.PRIVATE_UPLOADS_R2_ACCESS_KEY_ID);
    } else {
      expect(key.startsWith("public/")).toBe(true);
      expect(storage?.bucket).toBe(PUBLIC_BUCKET);
    }
  });

  it("refuses private storage instead of falling back to the public bucket", () => {
    const key = `private/venues/${VENUE_ID}/venue-files/plan.pdf`;
    expect(uploadStorageFor(PUBLIC_ONLY, "private", key)).toBeNull();
    expect(uploadStorageFor(PUBLIC_ONLY, "public", `public/marketing/${VENUE_ID}/hero.jpg`)?.bucket).toBe(PUBLIC_BUCKET);
  });

  it("refuses a key whose prefix disagrees with its visibility", () => {
    expect(uploadStorageFor(BOTH_BUCKETS, "public", `private/venues/${VENUE_ID}/venue-files/plan.pdf`)).toBeNull();
    expect(uploadStorageFor(BOTH_BUCKETS, "private", `public/marketing/${VENUE_ID}/hero.jpg`)).toBeNull();
    expect(uploadStorageFor(BOTH_BUCKETS, "private", "venues/trades-hall/rooms/reception-room/0_0.sog")).toBeNull();
    expect(uploadStorageFor(BOTH_BUCKETS, "public", "splats/trades-hall/grand-hall/0_0.sog")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// POST /uploads/presigned and GET /uploads/:context/:contextId
// ---------------------------------------------------------------------------

async function uploadsServer(env: Env, db: Database): Promise<FastifyInstance> {
  const server = Fastify();
  await server.register(uploadRoutes, { db, env, prefix: "/uploads" });
  await server.ready();
  return server;
}

const PRIVATE_PRESIGN = {
  filename: "floor-plan.pdf",
  contentType: "application/pdf",
  contentLengthBytes: 2048,
  context: "venue",
  contextId: VENUE_ID,
} as const;

describe("POST /uploads/presigned", () => {
  it("signs a private upload for the private bucket with the private token", async () => {
    const fake = fakeDb([]);
    const server = await uploadsServer(BOTH_BUCKETS, fake.db);
    const response = await server.inject({ method: "POST", url: "/uploads/presigned", headers: STAFF, payload: PRIVATE_PRESIGN });
    await server.close();

    expect(response.statusCode).toBe(201);
    const { data } = response.json<{ data: { uploadUrl: string; fileKey: string; publicUrl: string | null } }>();
    expect(data.fileKey.startsWith(`private/venues/${VENUE_ID}/venue-files/`)).toBe(true);
    expect(data.uploadUrl).toBe(
      `https://private-account.r2.cloudflarestorage.com/${PRIVATE_BUCKET}/${data.fileKey}` +
      "?X-Amz-Credential=private-access-key&X-Amz-Expires=600&X-Amz-Signature=test",
    );
    expect(data.publicUrl).toBeNull();
    expect(response.body).not.toContain(PUBLIC_BUCKET);
    expect(response.body).not.toContain(PUBLIC_URL);
    expect(s3.commands).toEqual([expect.objectContaining({ kind: "put", input: expect.objectContaining({ Bucket: PRIVATE_BUCKET }) })]);
    expect(fake.inserted).toEqual([expect.objectContaining({ fileKey: data.fileKey, visibility: "private" })]);
  });

  it("refuses a private upload when only the public bucket is configured", async () => {
    const fake = fakeDb([]);
    const server = await uploadsServer(PUBLIC_ONLY, fake.db);
    const response = await server.inject({ method: "POST", url: "/uploads/presigned", headers: STAFF, payload: PRIVATE_PRESIGN });
    await server.close();

    expect(response.statusCode).toBe(503);
    expect(response.json<{ code: string }>().code).toBe("UPLOADS_DISABLED");
    expect(s3.commands).toEqual([]);
    expect(fake.inserted).toEqual([]);
  });

  it("keeps explicit public marketing uploads in the public bucket", async () => {
    const server = await uploadsServer(BOTH_BUCKETS, fakeDb([]).db);
    const response = await server.inject({
      method: "POST",
      url: "/uploads/presigned",
      headers: ADMIN,
      payload: { filename: "hero.jpg", contentType: "image/jpeg", contentLengthBytes: 4096, context: "public_marketing", contextId: VENUE_ID, visibility: "public" },
    });
    await server.close();

    expect(response.statusCode).toBe(201);
    const { data } = response.json<{ data: { uploadUrl: string; fileKey: string; publicUrl: string } }>();
    expect(data.uploadUrl).toContain(`/${PUBLIC_BUCKET}/public/marketing/${VENUE_ID}/`);
    expect(data.publicUrl).toBe(`${PUBLIC_URL}/${data.fileKey}`);
    expect(response.body).not.toContain(PRIVATE_BUCKET);
  });
});

describe("GET /uploads/:context/:contextId", () => {
  it("serves private files only through five-minute URLs signed for the private bucket", async () => {
    const fileKey = `private/venues/${VENUE_ID}/venue-files/${FILE_ID}.pdf`;
    const row = {
      id: FILE_ID, fileKey, filename: "floor-plan.pdf", contentType: "application/pdf",
      contentLengthBytes: 2048, sha256: null, context: "venue", contextId: VENUE_ID,
      visibility: "private", uploadedBy: "staff-user", uploadedAt: "2026-10-18T12:00:00.000Z",
    };
    const server = await uploadsServer(BOTH_BUCKETS, fakeDb([[row]]).db);
    const response = await server.inject({ method: "GET", url: `/uploads/venue/${VENUE_ID}`, headers: STAFF });
    await server.close();

    expect(response.statusCode).toBe(200);
    const [file] = response.json<{ data: { publicUrl: string | null; readUrl: string | null }[] }>().data;
    expect(file?.publicUrl).toBeNull();
    expect(file?.readUrl).toBe(
      `https://private-account.r2.cloudflarestorage.com/${PRIVATE_BUCKET}/${fileKey}` +
      "?X-Amz-Credential=private-access-key&X-Amz-Expires=300&X-Amz-Signature=test",
    );
    expect(response.body).not.toContain(PUBLIC_URL);
  });
});

// ---------------------------------------------------------------------------
// Loadout photos
// ---------------------------------------------------------------------------

async function loadoutServer(db: Database): Promise<FastifyInstance> {
  const server = Fastify();
  await server.register(referenceLoadoutRoutes, { db, env: BOTH_BUCKETS, prefix: "/venues/:venueId/spaces/:spaceId/loadouts" });
  await server.ready();
  return server;
}

const LOADOUT_URL = `/venues/${VENUE_ID}/spaces/${SPACE_ID}/loadouts`;

describe("loadout reads", () => {
  it.each([LOADOUT_URL, `${LOADOUT_URL}/${LOADOUT_ID}`])("refuses an anonymous read of %s before touching the database", async (url) => {
    const server = await loadoutServer(untouchableDb);
    const response = await server.inject({ method: "GET", url });
    await server.close();
    expect(response.statusCode).toBe(401);
  });

  it.each([LOADOUT_URL, `${LOADOUT_URL}/${LOADOUT_ID}`])("refuses staff of another venue reading %s", async (url) => {
    const server = await loadoutServer(untouchableDb);
    const response = await server.inject({ method: "GET", url, headers: OUTSIDER });
    await server.close();
    expect(response.statusCode).toBe(403);
  });

  it("gives venue staff signed photo URLs for files of this loadout only", async () => {
    const fileKey = `private/venues/${VENUE_ID}/loadouts/${LOADOUT_ID}/${FILE_ID}.jpg`;
    const fake = fakeDb([
      [{ id: VENUE_ID }],
      [{ id: SPACE_ID }],
      [{
        id: LOADOUT_ID, venueId: VENUE_ID, spaceId: SPACE_ID, name: "Masonic dinner",
        description: null, createdBy: "staff-user", createdAt: "2026-10-18T12:00:00.000Z",
        updatedAt: "2026-10-18T12:00:00.000Z", deletedAt: null,
      }],
      [{
        id: PHOTO_ID, fileId: FILE_ID, caption: "Top table", sortOrder: 0,
        fileKey, filename: "top-table.jpg", contentType: "image/jpeg", visibility: "private",
      }],
    ]);
    const server = await loadoutServer(fake.db);
    const response = await server.inject({ method: "GET", url: `${LOADOUT_URL}/${LOADOUT_ID}`, headers: STAFF });
    await server.close();

    expect(response.statusCode).toBe(200);
    const { photos } = response.json<{ data: { photos: Record<string, unknown>[] } }>().data;
    expect(photos).toEqual([{
      id: PHOTO_ID, fileId: FILE_ID, caption: "Top table", sortOrder: 0,
      fileKey, filename: "top-table.jpg", contentType: "image/jpeg",
      readUrl: `https://private-account.r2.cloudflarestorage.com/${PRIVATE_BUCKET}/${fileKey}` +
        "?X-Amz-Credential=private-access-key&X-Amz-Expires=300&X-Amz-Signature=test",
    }]);
    expect(response.body).not.toContain(PUBLIC_URL);

    // The photo join is scoped to files uploaded into this loadout.
    const [join] = fake.joins;
    expect(join).toBeDefined();
    if (join === undefined) return;
    const query = new PgDialect().sqlToQuery(join);
    expect(query.sql).toContain(`"files"."context" = $`);
    expect(query.sql).toContain(`"files"."context_id" = $`);
    expect(query.params).toEqual(expect.arrayContaining(["loadout", LOADOUT_ID]));
  });
});
