import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import type { Database } from "../db/client.js";
import { cleanupOrphanedFiles, type UploadObjectStore } from "../services/cleanup.js";

// ---------------------------------------------------------------------------
// Orphaned uploads leave the bucket with their rows, on isolated PostgreSQL.
//
// An upload presigned for a loadout but never attached to it is an orphan
// once it is a day old. The pass used to delete its row and leave the object
// in the bucket, with nothing pointing at it. Now each orphan's object is
// deleted first, through the store, and only then its row; an object that
// cannot be deleted keeps its row for the next run. The store here is a fake
// that records what it is asked to delete and can refuse a key.
//
// Opt-in, isolated PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

const testUrl = process.env["VENVIEWER_ROUTE_TEST_DATABASE_URL"];
if (testUrl !== undefined) {
  const parsed = new URL(testUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || parsed.hostname !== "127.0.0.1" || parsed.port !== "55476"
    || parsed.pathname !== "/venviewer_route_atomicity_test"
    || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Orphaned upload tests require their explicit isolated loopback database");
  }
}

const NOW = new Date("2026-10-27T02:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const STAFF = randomUUID();
const LOADOUT = randomUUID();

/** A fake bucket: what it was asked to delete, and the keys it refuses. */
class FakeStore implements UploadObjectStore {
  readonly removed: string[] = [];
  readonly failing = new Set<string>();
  unreachable = false;
  remove(fileKey: string): Promise<boolean> {
    if (this.unreachable) return Promise.resolve(false);
    if (this.failing.has(fileKey)) return Promise.reject(new Error("R2 answered 500"));
    this.removed.push(fileKey);
    return Promise.resolve(true);
  }
}

describe.skipIf(testUrl === undefined)("orphaned uploads on isolated PostgreSQL", () => {
  let pool: Pool;
  let db: Database;
  const fixtureSchema = `orphaned_files_${randomUUID().replaceAll("-", "")}`;
  const tables: PgTable[] = [schema.files, schema.referencePhotos];

  beforeAll(async () => {
    pool = new Pool({ connectionString: testUrl, application_name: fixtureSchema, max: 4, options: `-c search_path=${fixtureSchema}` });
    await pool.query(`CREATE SCHEMA "${fixtureSchema}"`);
    for (const table of tables) {
      const config = getTableConfig(table);
      const columns = config.columns.map((column) => {
        let defaultSql = "";
        if (column.name === "id") defaultSql = " primary key default gen_random_uuid()";
        else if (column.name === "created_at" || column.name === "uploaded_at") defaultSql = " default now()";
        else if (typeof column.default === "number") defaultSql = ` default ${String(column.default)}`;
        else if (typeof column.default === "string") defaultSql = ` default '${column.default.replaceAll("'", "''")}'`;
        return `"${column.name}" ${column.getSQLType()}${defaultSql}`;
      });
      await pool.query(`CREATE TABLE "${config.name}" (${columns.join(", ")})`);
    }
    db = drizzle(pool, { schema });
  }, 120_000);

  afterAll(async () => {
    if (pool !== undefined) {
      await pool.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
      await pool.end();
    }
  }, 30_000);

  beforeEach(async () => {
    await pool.query(`TRUNCATE ${tables.map((table) => `"${getTableConfig(table).name}"`).join(", ")}`);
  });

  /** A file row uploaded `ageMs` before NOW; returns its key. */
  async function upload(name: string, ageMs: number, context = "loadout"): Promise<{ id: string; key: string }> {
    const id = randomUUID();
    const key = `private/venues/v/loadouts/${LOADOUT}/${name}.jpg`;
    await pool.query(
      `INSERT INTO files (id, file_key, filename, content_type, context, context_id, visibility, uploaded_by, uploaded_at)
       VALUES ($1, $2, $3, 'image/jpeg', $4, $5, 'private', $6, $7)`,
      [id, key, `${name}.jpg`, context, LOADOUT, STAFF, new Date(NOW.getTime() - ageMs)],
    );
    return { id, key };
  }

  async function rows(): Promise<string[]> {
    return (await pool.query<{ file_key: string }>("SELECT file_key FROM files ORDER BY file_key")).rows.map((row) => row.file_key);
  }

  it("deletes a day-old orphan's object, then its row, and leaves everything else", async () => {
    const orphan = await upload("abandoned", 2 * DAY);
    const attached = await upload("attached", 2 * DAY);
    await pool.query("INSERT INTO reference_photos (id, loadout_id, file_id, sort_order) VALUES ($1, $2, $3, 0)", [randomUUID(), LOADOUT, attached.id]);
    const fresh = await upload("fresh", 2 * 60 * 60 * 1000);
    const venueFile = await upload("venue-plan", 2 * DAY, "venue");
    const store = new FakeStore();

    expect(await cleanupOrphanedFiles(db, store, NOW)).toEqual({ deleted: 1, kept: 0 });

    expect(store.removed).toEqual([orphan.key]);
    expect(await rows()).toEqual([attached.key, fresh.key, venueFile.key].sort());
  });

  it("keeps an orphan whose object could not be deleted, and deletes it on the next run", async () => {
    const stuck = await upload("stuck", 3 * DAY);
    const other = await upload("other", 2 * DAY);
    const store = new FakeStore();
    store.failing.add(stuck.key);

    expect(await cleanupOrphanedFiles(db, store, NOW)).toEqual({ deleted: 1, kept: 1 });
    expect(store.removed).toEqual([other.key]);
    expect(await rows()).toEqual([stuck.key]);

    store.failing.clear();
    expect(await cleanupOrphanedFiles(db, store, NOW)).toEqual({ deleted: 1, kept: 0 });
    expect(await rows()).toEqual([]);
  });

  it("keeps every orphan when the bucket cannot be reached from here", async () => {
    const orphan = await upload("abandoned", 2 * DAY);
    const store = new FakeStore();
    store.unreachable = true;

    expect(await cleanupOrphanedFiles(db, store, NOW)).toEqual({ deleted: 0, kept: 1 });
    expect(await rows()).toEqual([orphan.key]);
  });

  it("skips an orphan that is being attached at that moment", async () => {
    const attaching = await upload("attaching", 2 * DAY);
    const orphan = await upload("abandoned", 2 * DAY);
    const store = new FakeStore();
    // Attaching a photo checks its file's key, which takes this lock on the row.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT 1 FROM files WHERE id = $1 FOR KEY SHARE", [attaching.id]);

      expect(await cleanupOrphanedFiles(db, store, NOW)).toEqual({ deleted: 1, kept: 0 });
      expect(store.removed).toEqual([orphan.key]);
      expect(await rows()).toEqual([attaching.key]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
