import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";

// ---------------------------------------------------------------------------
// Migration 0103 on the migrated platform database: product writes take the
// foundry's global lock shared, so they no longer wait for one another or
// deadlock a review submit, while the kill switch and the foundry's own
// tables still take it exclusively and order against every product write.
// Each wait is proved with lock_timeout, never with a clock.
// ---------------------------------------------------------------------------

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Foundry product lock tests require the explicit disposable platform database");
  }
}

/** The tables 0058 root-locks that are the product's, not the foundry's. */
const PRODUCT_TABLES = [
  "venues", "spaces", "asset_definitions", "configurations", "configuration_sheet_snapshots",
  "photo_references", "files", "website_embed_configs", "asset_versions", "runtime_packages",
  "reconstruction_releases", "reconstruction_release_qa_runs", "reconstruction_release_reviews",
  "reconstruction_review_evidence_artifacts", "reconstruction_release_attestations",
  "reconstruction_release_publications", "reconstruction_release_channels",
  "reconstruction_release_channel_events",
] as const;

const GLOBAL_LOCK = "hashtextextended('foundry-kill:0:global', 0)";
const LOCK_NOT_AVAILABLE = "55P03";

describe.skipIf(target === undefined)("the foundry's global lock, shared by product writes", () => {
  const applicationName = `foundry_product_lock_${randomUUID()}`;
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const venueId = randomUUID();
  const spaceId = randomUUID();
  const clients: PoolClient[] = [];
  const layouts: string[] = [];
  /** A quarantine namespace of this run's own, as the foundry registers one. */
  const quarantine = { profileId: `t677-${randomUUID()}`, bucket: `t677-${randomBytes(4).toString("hex")}`, rootPrefix: "quarantine/root/" };

  async function layout(): Promise<string> {
    const id = randomUUID();
    await db.insert(schema.configurations).values({ id, spaceId, venueId, name: "TEST ONLY lock layout", layoutStyle: "dinner-banquet" });
    layouts.push(id);
    return id;
  }

  /** An object key inside the quarantine namespace. */
  function quarantined(name: string): string {
    return `${quarantine.bucket}/${quarantine.rootPrefix}${name}.png`;
  }

  function digest(): string {
    return `sha256:${randomBytes(32).toString("hex")}`;
  }

  /** Runs statements with the foundry's own guards off: the fixture's
   *  quarantine profile and its cleanup only, on this disposable database. */
  async function asFoundry(statements: readonly (readonly [string, readonly unknown[]])[]): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      for (const [sql, params] of statements) await client.query(sql, [...params]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async function securityEventsFor(ids: readonly string[]): Promise<string[]> {
    const events = await pool.query<{ offending_row_id: string }>(
      "SELECT offending_row_id FROM foundry_derivative_quarantine_security_events_v1 WHERE offending_table = 'configurations' AND offending_row_id = ANY($1::text[])",
      [ids]);
    return events.rows.map((row) => row.offending_row_id).sort();
  }

  /** A connection with a transaction open, kept until the test ends it. */
  async function open(): Promise<PoolClient> {
    const client = await pool.connect();
    clients.push(client);
    await client.query("BEGIN");
    return client;
  }

  async function close(client: PoolClient, end: "COMMIT" | "ROLLBACK" = "COMMIT"): Promise<void> {
    await client.query(end);
    clients.splice(clients.indexOf(client), 1);
    client.release();
  }

  /** The SQLSTATE a statement fails with when it may wait 300 ms at most, or null. */
  async function failureWithin300ms(client: PoolClient, sql: string, params: unknown[] = []): Promise<string | null> {
    await client.query("SAVEPOINT bounded");
    await client.query("SET LOCAL lock_timeout = '300ms'");
    try {
      await client.query(sql, params);
      await client.query("RELEASE SAVEPOINT bounded");
      return null;
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT bounded");
      return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "unknown";
    }
  }

  /** Null once the statement succeeds, or the SQLSTATE it fails with. */
  function outcome(statement: Promise<unknown>): Promise<string | null> {
    return statement.then(() => null, (error: unknown) =>
      typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "unknown");
  }

  async function waitForLockWaiters(count: number): Promise<void> {
    for (let tries = 0; ; tries += 1) {
      const waiting = await pool.query<{ waiting: string }>(
        "SELECT count(*) AS waiting FROM pg_stat_activity WHERE datname = current_database() AND application_name = $1 AND wait_event_type = 'Lock'",
        [applicationName],
      );
      if (Number(waiting.rows[0]?.waiting ?? 0) >= count) return;
      if (tries > 200) throw new Error(`never saw ${String(count)} waiting for a lock`);
      await new Promise((settle) => { setTimeout(settle, 10); });
    }
  }

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: applicationName, max: 6,
      options: "-c statement_timeout=15000" });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    await db.insert(schema.venues).values({ id: venueId, name: "TEST ONLY lock venue", slug: venueId, address: "Disposable fixture" });
    await db.insert(schema.spaces).values({ id: spaceId, venueId, name: "Room", slug: "room", widthM: "10", lengthM: "10", heightM: "3",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] });
    await asFoundry([[`INSERT INTO foundry_derivative_quarantine_storage_profiles_v1 (
        profile_id, profile_version, profile_sha256, bucket, root_prefix, object_versioning_required,
        object_lock_required, create_if_absent_required, broker_policy_sha256, custodian_policy_sha256,
        kms_configuration_sha256, retention_configuration_sha256, retention_days, valid_from, expires_at,
        profile_json, infrastructure_receipt_sha256, registered_by_user_id, idempotency_key, registered_at)
      VALUES ($1, 'v1', $2, $3, $4, true, true, true, $5, $5, $5, $5, 30, now() - interval '1 day',
        now() + interval '1 year', '{}'::jsonb, $5, gen_random_uuid(), $1, now())`,
      [quarantine.profileId, digest(), quarantine.bucket, quarantine.rootPrefix, digest()]]]);
    expect((await pool.query<{ detects: boolean }>("SELECT public.fdv1_ref_is_quarantine($1) AS detects", [quarantined("probe")])).rows[0]?.detects).toBe(true);
  }, 60000);

  // A failed test leaves its transactions open; end them all at once, so the
  // ones holding a lock let the ones waiting for it finish too.
  afterEach(async () => {
    await Promise.allSettled(clients.splice(0).map(async (client) => {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }));
  });

  afterAll(async () => {
    if (pool === undefined) return;
    await asFoundry([
      ["DELETE FROM foundry_derivative_quarantine_security_events_v1 WHERE offending_table = 'configurations' AND offending_row_id = ANY($1::text[])", [layouts]],
      ["DELETE FROM foundry_derivative_quarantine_storage_profiles_v1 WHERE profile_id = $1", [quarantine.profileId]],
    ]);
    await pool.end();
  });

  it("keeps 0058's 57 root and 18 guard triggers, naming exactly the product tables to share", async () => {
    const triggers = await pool.query<{ tgname: string; relname: string; proname: string; tgenabled: string }>(
      `SELECT t.tgname, c.relname, p.proname, t.tgenabled FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
       WHERE (t.tgname LIKE 'fdv1_root_%' OR t.tgname LIKE 'fdv1_public_%') AND NOT t.tgisinternal`);
    const rootTriggers = triggers.rows.filter((row) => row.tgname.startsWith("fdv1_root_"));
    const guardTriggers = triggers.rows.filter((row) => row.tgname.startsWith("fdv1_public_"));
    expect(rootTriggers).toHaveLength(57);
    expect(new Set(rootTriggers.map((row) => row.proname))).toEqual(new Set(["fdv1_root_trigger"]));
    expect(guardTriggers.map((row) => row.relname).sort()).toEqual([...PRODUCT_TABLES].sort());
    expect(new Set(guardTriggers.map((row) => row.proname))).toEqual(new Set(["fdv1_public_guard"]));
    expect(new Set(triggers.rows.map((row) => row.tgenabled))).toEqual(new Set(["O"]));
    const productTables = rootTriggers.map((row) => row.relname).filter((relation) => !relation.startsWith("foundry_"));
    expect(productTables.sort()).toEqual([...PRODUCT_TABLES].sort());
    const [root] = (await pool.query<{ prosrc: string }>("SELECT prosrc FROM pg_proc WHERE proname = 'fdv1_root_trigger'")).rows;
    const sharedList = /ARRAY\[([^\]]*)\]/u.exec(root?.prosrc ?? "")?.[1] ?? "";
    expect((sharedList.match(/'[a-z0-9_]+'/gu) ?? []).map((quoted) => quoted.slice(1, -1)).sort()).toEqual([...PRODUCT_TABLES].sort());
  });

  it("takes it shared, and only shared, on each product table", async () => {
    // Where the global key shows in pg_locks, learnt by taking it.
    const probe = await open();
    await probe.query(`SELECT pg_advisory_xact_lock_shared(${GLOBAL_LOCK})`);
    const [key] = (await probe.query<{ classid: string; objid: string }>(
      "SELECT classid::text AS classid, objid::text AS objid FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND objsubid = 1")).rows;
    await close(probe, "ROLLBACK");
    if (key === undefined) throw new Error("the global key was not held");
    const modes: Record<string, string[]> = {};
    for (const table of PRODUCT_TABLES) {
      const [column] = (await pool.query<{ attname: string }>(
        "SELECT attname FROM pg_attribute WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '' ORDER BY attnum LIMIT 1",
        [table])).rows;
      if (column === undefined) throw new Error(`${table} has no column to write`);
      const writing = await open();
      // The statement trigger fires though no row matches.
      await writing.query(`UPDATE "${table}" SET "${column.attname}" = "${column.attname}" WHERE false`);
      modes[table] = (await writing.query<{ mode: string }>(
        "SELECT mode FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND objsubid = 1 AND classid::text = $1 AND objid::text = $2",
        [key.classid, key.objid])).rows.map((row) => row.mode);
      await close(writing, "ROLLBACK");
    }
    expect(modes).toEqual(Object.fromEntries(PRODUCT_TABLES.map((table) => [table, ["ShareLock"]])));
  });

  it("changes nothing in the public guard but the lock it takes", async () => {
    const migration = await readFile(resolve(import.meta.dirname, "../../drizzle/0058_foundry_derivative_activation_disabled.sql"), "utf8");
    const start = migration.indexOf('CREATE FUNCTION "fdv1_public_guard"()');
    const bodyStart = migration.indexOf("AS $$", start) + "AS $$".length;
    const bodyEnd = migration.indexOf("$$;", bodyStart);
    const original = migration.slice(bodyStart, bodyEnd);
    expect(original.match(/PERFORM public\."fdv1_lock_root"\(\);/gu)).toHaveLength(1);
    const installed = await pool.query<{ prosrc: string }>("SELECT prosrc FROM pg_proc WHERE proname = 'fdv1_public_guard'");
    expect(installed.rows[0]?.prosrc).toBe(original.replace('PERFORM public."fdv1_lock_root"();', 'PERFORM public."fdv1_lock_root_shared"();'));
  });

  it("lets a product write proceed while another is open", async () => {
    const first = await layout();
    const second = await layout();
    const writing = await open();
    await writing.query("UPDATE configurations SET name = name WHERE id = $1", [first]);
    const other = await open();
    // Under 0058's exclusive lock each of these waited for the open write.
    expect(await failureWithin300ms(other, "UPDATE configurations SET name = name WHERE id = $1", [second])).toBeNull();
    expect(await failureWithin300ms(other, "UPDATE venues SET name = name WHERE id = $1", [venueId])).toBeNull();
    await close(other);
    await close(writing);
  });

  it("does not deadlock a submit, which locks the layout first, with a save, which takes the lock first", async () => {
    const id = await layout();
    const holder = await open();
    await holder.query("SELECT id FROM configurations WHERE id = $1 FOR UPDATE", [id]);
    const submit = await open();
    const submitLocked = outcome(submit.query("SELECT id FROM configurations WHERE id = $1 FOR UPDATE", [id]));
    await waitForLockWaiters(1);
    const save = await open();
    const saved = outcome(save.query("UPDATE configurations SET revision = revision + 1 WHERE id = $1", [id]));
    await waitForLockWaiters(2);
    await close(holder);
    expect(await submitLocked).toBeNull();
    // The submit's first write after its row lock: under 0058 it waited for
    // the save's exclusive lock while the save waited for the row, and
    // PostgreSQL rolled one back (40P01).
    expect(await outcome(submit.query("UPDATE configurations SET review_status = 'submitted' WHERE id = $1", [id]))).toBeNull();
    await close(submit);
    expect(await saved).toBeNull();
    await close(save);
    const [row] = (await pool.query<{ review_status: string; revision: number }>(
      "SELECT review_status, revision FROM configurations WHERE id = $1", [id])).rows;
    expect(row).toEqual({ review_status: "submitted", revision: 2 });
  });

  it("still makes a product write wait for the kill switch, and the kill switch for a product write", async () => {
    const id = await layout();
    const kill = await open();
    await kill.query(`SELECT pg_advisory_xact_lock(${GLOBAL_LOCK})`);
    const writer = await open();
    expect(await failureWithin300ms(writer, "UPDATE configurations SET name = name WHERE id = $1", [id])).toBe(LOCK_NOT_AVAILABLE);
    await close(writer, "ROLLBACK");
    await close(kill);

    const writing = await open();
    await writing.query("UPDATE configurations SET name = name WHERE id = $1", [id]);
    const killing = await open();
    expect(await failureWithin300ms(killing, `SELECT pg_advisory_xact_lock(${GLOBAL_LOCK})`)).toBe(LOCK_NOT_AVAILABLE);
    await close(killing, "ROLLBACK");
    await close(writing);
  });

  it("keeps the foundry's own root trigger exclusive against product writes, both ways", async () => {
    const id = await layout();
    // A statement trigger fires whether or not a row matches, and no row
    // trigger does: this takes only the kill-switch table's root lock.
    const foundryWrite = "UPDATE foundry_kill_switch_events SET recorded_at = recorded_at WHERE false";
    const foundry = await open();
    await foundry.query(foundryWrite);
    const writer = await open();
    expect(await failureWithin300ms(writer, "UPDATE configurations SET name = name WHERE id = $1", [id])).toBe(LOCK_NOT_AVAILABLE);
    await close(writer, "ROLLBACK");
    await close(foundry);

    const writing = await open();
    await writing.query("UPDATE configurations SET name = name WHERE id = $1", [id]);
    const after = await open();
    expect(await failureWithin300ms(after, foundryWrite)).toBe(LOCK_NOT_AVAILABLE);
    await close(after, "ROLLBACK");
    await close(writing);
  });

  it("refuses and records two quarantined references named at once by writes that hold the lock", async () => {
    const first = await layout();
    const second = await layout();
    const one = await open();
    await one.query("UPDATE configurations SET name = name WHERE id = $1", [first]);
    const other = await open();
    expect(await failureWithin300ms(other, "UPDATE configurations SET name = name WHERE id = $1", [second])).toBeNull();
    // Each now names a quarantined object. Had the guard's security event
    // taken the lock exclusively, each would wait for the other's shared hold
    // and PostgreSQL would roll one back (40P01).
    expect(await failureWithin300ms(one, "UPDATE configurations SET thumbnail_url = $2 WHERE id = $1", [first, quarantined("first")])).toBeNull();
    expect(await failureWithin300ms(other, "UPDATE configurations SET thumbnail_url = $2 WHERE id = $1", [second, quarantined("second")])).toBeNull();
    await close(one);
    await close(other);
    const rows = await pool.query<{ thumbnail_url: string | null }>("SELECT thumbnail_url FROM configurations WHERE id = ANY($1::uuid[])", [[first, second]]);
    expect(rows.rows.map((row) => row.thumbnail_url)).toEqual([null, null]);
    expect(await securityEventsFor([first, second])).toEqual([first, second].sort());
  });

  it("records the event when a save waits on the row a detection holds", async () => {
    const saved = await layout();
    const named = await layout();
    const save = await open();
    await save.query("UPDATE configurations SET name = name WHERE id = $1", [saved]);
    const detecting = await open();
    // Had the event's insert asked for the lock exclusively, it would wait for
    // the save's shared hold, the save would then wait for this row, and the
    // rollback of the deadlock could take the event with it.
    expect(await failureWithin300ms(detecting, "UPDATE configurations SET thumbnail_url = $2 WHERE id = $1", [named, quarantined("named")])).toBeNull();
    const waited = outcome(save.query("UPDATE configurations SET name = name WHERE id = $1", [named]));
    await waitForLockWaiters(1);
    await close(detecting);
    expect(await waited).toBeNull();
    await close(save);
    expect(await securityEventsFor([named])).toEqual([named]);
  });
});
