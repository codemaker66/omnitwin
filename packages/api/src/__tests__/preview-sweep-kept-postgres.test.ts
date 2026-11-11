import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { cleanupPreviewConfigurations } from "../services/cleanup.js";

// ---------------------------------------------------------------------------
// The preview sweep removes only a plan nobody is using (release audit
// public-surface-3 and enquiries-crm-5).
//
// The nightly sweep hard-deletes ownerless public previews, and a delete of a
// configuration cascades through, or clears, every table that points at it.
// It used to spare only a plan with an enquiry, a handoff pack or a working
// view-only link. A visitor's plan the venue had linked to an event, put in a
// proposal, reviewed or approved was deleted after 72 hours without a save,
// with its event link, review trail, approved sheet and ticks; and a plan
// whose reference the database refuses to drop stopped the whole batch.
//
// The rule now: a plan goes only when it has had no save for more than 72
// hours and nothing refers to it but its own pieces. Every foreign key into
// configurations is given one of three meanings below, read from the
// catalogue of the whole migration set, so a new table that points at a plan
// fails here until someone decides what it means to the sweep. Each key is
// then tried from both sides on real PostgreSQL: a plan with one such row,
// and the same plan without it.
//
// Opt-in, disposable loopback PostgreSQL only; never reads DATABASE_URL/.env.
// It shares the supplier records suite's migrated database (the API's test
// files run one at a time, and every case here judges only its own rows), so
// CI already gives it one:
//   VENVIEWER_SUPPLIER_RECORDS_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<port>/venviewer_supplier_records_test
// The role must be a superuser: the per-key cases write one row with its
// other keys and checks set aside, inside a transaction that is rolled back.
// ---------------------------------------------------------------------------

const explicitUrl = process.env["VENVIEWER_SUPPLIER_RECORDS_TEST_DATABASE_URL"];

function assertTestTarget(raw: string): void {
  const url = new URL(raw);
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1"
    || url.pathname !== "/venviewer_supplier_records_test" || url.search !== "" || url.hash !== "") {
    throw new Error("Preview sweep tests require the explicit loopback venviewer_supplier_records_test database");
  }
}

describe("preview sweep PostgreSQL target guard", () => {
  it.each([
    "postgresql://user@production.example/venviewer_supplier_records_test",
    "postgresql://postgres@127.0.0.1/production",
    "postgres://postgres@127.0.0.1/venviewer_supplier_records_test",
    "postgresql://postgres@127.0.0.1/venviewer_supplier_records_test?host=production.example",
  ])("rejects an unsafe target: %s", (url) => {
    expect(() => { assertTestTarget(url); }).toThrow();
  });
});

const KEEPS = "keeps the plan";
const GOES = "goes with the plan";
const OUTLIVES = "is kept without the plan";
type Meaning = typeof KEEPS | typeof GOES | typeof OUTLIVES;

/** Every foreign key into configurations ("table.column"), and what a row
 *  under it means to the sweep. */
const KEYS: Readonly<Record<string, Meaning>> = {
  // What the venue, or anyone signed in, has made of the plan.
  "enquiries.configuration_id": KEEPS,
  "handoff_packs.config_id": KEEPS,
  "event_configuration_links.configuration_id": KEEPS,
  "layout_variants.configuration_id": KEEPS,
  "phase_layout_snapshots.configuration_id": KEEPS,
  "event_plan_changes.configuration_id": KEEPS,
  "proposals.configuration_id": KEEPS,
  "revenue_scenarios.configuration_id": KEEPS,
  "configuration_sheet_snapshots.configuration_id": KEEPS,
  "configuration_review_history.configuration_id": KEEPS,
  "hallkeeper_progress.config_id": KEEPS,
  "canonical_layout_snapshots.configuration_id": KEEPS,
  "evidence_items.config_id": KEEPS,
  "check_results.config_id": KEEPS,
  "assumption_records.config_id": KEEPS,
  "review_gates.config_id": KEEPS,
  "claim_states.config_id": KEEPS,
  "evidence_packs.config_id": KEEPS,
  "stale_evidence_events.config_id": KEEPS,
  "guest_flow_scenarios.configuration_id": KEEPS,
  "navmesh_versions.configuration_id": KEEPS,
  "guest_flow_replays.configuration_id": KEEPS,
  "event_architect_runs.selected_configuration_id": KEEPS,
  "event_architect_candidates.configuration_id": KEEPS,
  "event_architect_ops_reviews.configuration_id": KEEPS,
  "photo_references.configuration_id": KEEPS,
  // The plan's own pieces: saved with it, deleted with it.
  "placed_objects.configuration_id": GOES,
  "configuration_layout_revisions.configuration_id": GOES,
  "layout_aliases.configuration_id": GOES,
  "configuration_claim_secrets.configuration_id": GOES,
  "review_sessions.configuration_id": GOES,
  "action_log.configuration_id": GOES,
  // Only a working link keeps a plan (its own case below); the row written
  // here expired in 2000.
  "configuration_view_tokens.configuration_id": GOES,
  // A client's remembered allergy note names the layout it came from only
  // while that layout exists, and is only ever saved from an owned one.
  "remembered_dietary_notes.source_configuration_id": OUTLIVES,
};

interface Outcome {
  /** The plan the row points at. */
  readonly plan: "kept" | "removed" | `sweep refused: ${string}`;
  /** The row itself. */
  readonly row: "kept" | "removed" | "kept without the plan";
  /** The same plan with no such row, swept in the same run. */
  readonly planNothingRefersTo: "kept" | "removed";
}

const EXPECTED: Readonly<Record<Meaning, Outcome>> = {
  [KEEPS]: { plan: "kept", row: "kept", planNothingRefersTo: "removed" },
  [GOES]: { plan: "removed", row: "removed", planNothingRefersTo: "removed" },
  [OUTLIVES]: { plan: "removed", row: "kept without the plan", planNothingRefersTo: "removed" },
};

const HOUR_MS = 3_600_000;
const NOW = new Date();
const before = (ms: number): Date => new Date(NOW.getTime() - ms);

/** A value for a required column of a row that exists only to point at a plan. */
function testValue(type: string): string {
  switch (type) {
    case "uuid": return "gen_random_uuid()";
    case "timestamp with time zone": return "'2000-01-01T00:00:00Z'::timestamptz";
    case "integer": case "bigint": case "numeric": return "1";
    case "character varying": case "text": return "'x'";
    case "jsonb": return "'{}'::jsonb";
    case "boolean": return "false";
    case "date": return "'2000-01-01'::date";
    default: throw new Error(`No test value for a ${type} column: add one to testValue`);
  }
}

/** Thrown to roll a case back; carries what the sweep did out of the transaction. */
class Undo extends Error {
  constructor(readonly outcome: Outcome) {
    super("The case is rolled back");
    this.name = "Undo";
  }
}

function refusal(error: unknown): string {
  const cause: unknown = error instanceof Error && error.cause !== undefined ? error.cause : error;
  if (typeof cause !== "object" || cause === null) return String(cause);
  const code = "code" in cause && typeof cause.code === "string" ? cause.code : "no code";
  const constraint = "constraint" in cause && typeof cause.constraint === "string" ? ` ${cause.constraint}` : "";
  const message = "message" in cause && typeof cause.message === "string" ? `: ${cause.message}` : "";
  return `${code}${constraint}${message}`;
}

describe.skipIf(explicitUrl === undefined)("the preview sweep keeps what a plan is used for, on migrated PostgreSQL", () => {
  let pool: Pool;
  let db: Database;
  const applicationName = `preview-sweep-kept-${randomUUID().slice(0, 8)}`;
  const venueId = randomUUID();
  const roomId = randomUUID();
  const staffId = randomUUID();

  beforeAll(async () => {
    if (explicitUrl === undefined) throw new Error("Explicit test URL required");
    assertTestTarget(explicitUrl);
    pool = new Pool({ connectionString: explicitUrl, application_name: applicationName, max: 4 });
    const target = await pool.query<{ database: string }>("SELECT current_database() AS database");
    expect(target.rows[0]?.database).toBe("venviewer_supplier_records_test");
    await migrate(drizzle(pool), { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
    db = drizzle(pool, { schema });
    await db.insert(schema.venues).values({ id: venueId, name: "Synthetic sweep venue", slug: venueId, address: "Test only" });
    await db.insert(schema.users).values({ id: staffId, venueId, name: "Sweep staff", email: `${staffId}@sweep.test`, role: "staff" });
    await db.insert(schema.spaces).values({ id: roomId, venueId, name: "Grand Hall", slug: roomId,
      widthM: "21", lengthM: "10.5", heightM: "7",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 10.5 }, { x: 0, y: 10.5 }] });
  }, 300_000);

  afterAll(async () => { await pool?.end(); });

  /** An ownerless public preview, as POST /public/configurations makes one,
   *  last saved the given time before the sweep's clock. */
  async function visitorPlan(on: Database, savedBefore: number): Promise<string> {
    const saved = before(savedBefore);
    const [plan] = await on.insert(schema.configurations).values({
      venueId, spaceId: roomId, userId: null, name: "Visitor plan", layoutStyle: "custom",
      isPublicPreview: true, visibility: "public", createdAt: before(30 * 24 * HOUR_MS), updatedAt: saved,
    }).returning({ id: schema.configurations.id });
    if (plan === undefined) throw new Error("The plan was not made");
    return plan.id;
  }

  async function plansLeft(on: Database, ids: readonly string[]): Promise<Set<string>> {
    const rows = await on.select({ id: schema.configurations.id }).from(schema.configurations)
      .where(inArray(schema.configurations.id, [...ids]));
    return new Set(rows.map((row) => row.id));
  }

  /**
   * One sweep over two plans left for 73 hours: one that a single row under
   * the key points at, and one nothing points at. The row is written with
   * its table's other keys, triggers and checks set aside, because only its
   * key to the plan is under test; the sweep then runs with every key and
   * trigger in force, and the whole case is rolled back.
   */
  async function sweepWithOneRow(key: string): Promise<Outcome> {
    const [table, column] = key.split(".");
    if (table === undefined || column === undefined) throw new Error(`Not a table.column key: ${key}`);
    const columns = (await pool.query<{ name: string; type: string; required: boolean }>(
      `SELECT a.attname AS name, format_type(a.atttypid, NULL) AS type,
              a.attnotnull AND NOT a.atthasdef AND a.attidentity = '' AND a.attgenerated = '' AS required
       FROM pg_attribute a WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`,
      [table])).rows;
    const checks = (await pool.query<{ name: string }>(
      "SELECT conname AS name FROM pg_constraint WHERE conrelid = $1::regclass AND contype = 'c'", [table])).rows;
    const primaryKey = (await pool.query<{ name: string }>(
      `SELECT a.attname AS name FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
       WHERE c.conrelid = $1::regclass AND c.contype = 'p'`, [table])).rows.map((row) => row.name);
    // The row's keys to other tables are left empty. A parent that does not
    // exist would do for the insert, but PostgreSQL checks every key of a row
    // again when the transaction that wrote it changes it, as ON DELETE SET
    // NULL does, and would refuse the delete for a reason no real row has.
    const otherKeys = new Set((await pool.query<{ name: string }>(
      `SELECT DISTINCT a.attname AS name FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
       WHERE c.conrelid = $1::regclass AND c.contype = 'f' AND c.confrelid <> 'configurations'::regclass`,
      [table])).rows.map((row) => row.name).filter((name) => !primaryKey.includes(name)));

    try {
      await db.transaction(async (tx) => {
        const referredTo = await visitorPlan(tx, 73 * HOUR_MS);
        const nothingRefersTo = await visitorPlan(tx, 73 * HOUR_MS);

        for (const check of checks) {
          await tx.execute(sql`ALTER TABLE ${sql.identifier(table)} DROP CONSTRAINT ${sql.identifier(check.name)}`);
        }
        for (const candidate of columns) {
          if (!candidate.required || !otherKeys.has(candidate.name)) continue;
          await tx.execute(sql`ALTER TABLE ${sql.identifier(table)} ALTER COLUMN ${sql.identifier(candidate.name)} DROP NOT NULL`);
        }
        const filled = columns.filter((candidate) => candidate.name === column || (candidate.required && !otherKeys.has(candidate.name)));
        await tx.execute(sql`SET LOCAL session_replication_role = replica`);
        const made = await tx.execute(sql`
          INSERT INTO ${sql.identifier(table)} (${sql.join(filled.map((candidate) => sql.identifier(candidate.name)), sql`, `)})
          VALUES (${sql.join(filled.map((candidate) => (candidate.name === column ? sql`${referredTo}::uuid` : sql.raw(testValue(candidate.type)))), sql`, `)})
          RETURNING to_jsonb(${sql.identifier(table)}.*) AS made`);
        await tx.execute(sql`SET LOCAL session_replication_role = origin`);
        const row: unknown = made.rows[0]?.["made"];
        if (typeof row !== "object" || row === null) throw new Error(`No row was written to ${table}`);
        const written: Readonly<Record<string, unknown>> = { ...row };

        try {
          await cleanupPreviewConfigurations(tx, NOW);
        } catch (error) {
          // A refused batch deletes nothing: both plans and the row stand.
          throw new Undo({ plan: `sweep refused: ${refusal(error)}`, row: "kept", planNothingRefersTo: "kept" });
        }

        const left = await plansLeft(tx, [referredTo, nothingRefersTo]);
        const others = primaryKey.filter((name) => name !== column);
        const sameRow = others.length === 0
          ? sql`${sql.identifier(column)} = ${referredTo}::uuid`
          : sql.join(others.map((name) => {
            const value = written[name];
            if (typeof value !== "string") throw new Error(`${table}.${name} is not a text key`);
            return sql`${sql.identifier(name)}::text = ${value}`;
          }), sql` AND `);
        const after = await tx.execute(sql`SELECT ${sql.identifier(column)}::text AS ref FROM ${sql.identifier(table)} WHERE ${sameRow}`);
        const stillThere = after.rows[0];
        throw new Undo({
          plan: left.has(referredTo) ? "kept" : "removed",
          row: stillThere === undefined ? "removed" : stillThere["ref"] === null ? "kept without the plan" : "kept",
          planNothingRefersTo: left.has(nothingRefersTo) ? "kept" : "removed",
        });
      });
    } catch (error) {
      if (error instanceof Undo) return error.outcome;
      throw error;
    }
    throw new Error("The case ended without being rolled back");
  }

  it("gives every key that points at a plan a meaning here", async () => {
    const keys = await pool.query<{ key: string }>(`
      SELECT c.conrelid::regclass::text || '.' || a.attname AS key
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.confrelid = 'configurations'::regclass
      ORDER BY 1`);
    // A key missing from KEYS is a table the sweep has not been told about:
    // decide whether its rows keep a plan (add it to PLAN_KEPT_BY in
    // services/cleanup.ts) or go with it, then record that in KEYS.
    expect(keys.rows.map((row) => row.key)).toEqual(Object.keys(KEYS).sort());
  });

  it.each(Object.entries(KEYS))("%s: a row there %s", async (key, meaning) => {
    expect(await sweepWithOneRow(key)).toEqual(EXPECTED[meaning]);
  }, 60_000);

  it("removes a plan only once it has gone more than 72 hours without a save", async () => {
    const insideByASecond = await visitorPlan(db, 72 * HOUR_MS - 1000);
    const onTheHour = await visitorPlan(db, 72 * HOUR_MS);
    const outsideByASecond = await visitorPlan(db, 72 * HOUR_MS + 1000);
    // Made a month ago and saved yesterday: judged by the save, not by its age.
    const savedYesterday = await visitorPlan(db, 24 * HOUR_MS);
    const [owned] = await db.insert(schema.configurations).values({
      venueId, spaceId: roomId, userId: staffId, name: "Owned plan", layoutStyle: "custom",
      createdAt: before(90 * 24 * HOUR_MS), updatedAt: before(90 * 24 * HOUR_MS),
    }).returning({ id: schema.configurations.id });
    if (owned === undefined) throw new Error("The owned plan was not made");

    await cleanupPreviewConfigurations(db, NOW);

    expect(await plansLeft(db, [insideByASecond, onTheHour, outsideByASecond, savedYesterday, owned.id]))
      .toEqual(new Set([insideByASecond, onTheHour, savedYesterday, owned.id]));
  });

  it("keeps a plan a working view-only link shows", async () => {
    const shown = await visitorPlan(db, 73 * HOUR_MS);
    const stopped = await visitorPlan(db, 73 * HOUR_MS);
    const link = { tokenPrefix: "abcdefgh", createdAt: before(5 * 24 * HOUR_MS), expiresAt: new Date(NOW.getTime() + 24 * HOUR_MS) };
    await db.insert(schema.configurationViewTokens).values([
      { ...link, configurationId: shown, tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "0") },
      { ...link, configurationId: stopped, tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "1"), revokedAt: before(HOUR_MS) },
    ]);

    await cleanupPreviewConfigurations(db, NOW);

    expect(await plansLeft(db, [shown, stopped])).toEqual(new Set([shown]));
  });

  it("keeps a visitor's plan the venue linked to an event, reviewed and approved, with all of it", async () => {
    const plan = await visitorPlan(db, 10 * 24 * HOUR_MS);
    const nobodyUsed = await visitorPlan(db, 10 * 24 * HOUR_MS);
    const eventId = randomUUID();
    await db.insert(schema.events).values({ id: eventId, venueId, createdBy: staffId, name: "DEMO ONLY sweep dinner" });
    await db.insert(schema.eventConfigurationLinks).values({ eventId, configurationId: plan, linkType: "source_configuration" });
    const approvedAt = before(9 * 24 * HOUR_MS);
    await db.insert(schema.configurationSheetSnapshots).values({ configurationId: plan, version: 1,
      payload: { fixture: "preview sweep" }, sourceHash: "c".repeat(64), createdBy: staffId, approvedAt, approvedBy: staffId });
    await db.insert(schema.configurationReviewHistory).values([
      { configurationId: plan, fromStatus: "draft", toStatus: "submitted", changedBy: staffId },
      { configurationId: plan, fromStatus: "submitted", toStatus: "approved", changedBy: staffId },
    ]);
    // An approval does not count as a save: updated_at stays where it was.
    await pool.query("UPDATE configurations SET review_status = 'approved', approved_at = $2, approved_by = $3 WHERE id = $1",
      [plan, approvedAt, staffId]);
    await db.insert(schema.hallkeeperProgress).values({ configId: plan, eventId, rowKey: "setup|hall|round-table|0", checkedBy: staffId });

    await cleanupPreviewConfigurations(db, NOW);

    expect(await plansLeft(db, [plan, nobodyUsed])).toEqual(new Set([plan]));
    const kept = await pool.query<Record<string, number>>(`SELECT
        (SELECT count(*)::int FROM event_configuration_links WHERE configuration_id = $1) AS event_links,
        (SELECT count(*)::int FROM configuration_sheet_snapshots WHERE configuration_id = $1 AND approved_at IS NOT NULL) AS approved_sheets,
        (SELECT count(*)::int FROM configuration_review_history WHERE configuration_id = $1) AS review_moves,
        (SELECT count(*)::int FROM hallkeeper_progress WHERE config_id = $1) AS ticks`, [plan]);
    expect(kept.rows[0]).toEqual({ event_links: 1, approved_sheets: 1, review_moves: 2, ticks: 1 });
  });

  it("leaves a plan alone while the venue is linking it to an event", async () => {
    const plan = await visitorPlan(db, 10 * 24 * HOUR_MS);
    const eventId = randomUUID();
    await db.insert(schema.events).values({ id: eventId, venueId, createdBy: staffId, name: "DEMO ONLY sweep reception" });

    // POST /events/:id/configuration-links, stopped before its commit: the
    // layout's row under a share lock, then the link (routes/events.ts).
    const linking = await pool.connect();
    try {
      await linking.query("BEGIN");
      await linking.query("SELECT id FROM configurations WHERE id = $1 FOR SHARE", [plan]);
      await linking.query(
        "INSERT INTO event_configuration_links (event_id, configuration_id, link_type) VALUES ($1, $2, 'source_configuration')",
        [eventId, plan]);

      let settled = false;
      const sweep = cleanupPreviewConfigurations(db, NOW).finally(() => { settled = true; });
      sweep.catch(() => undefined);
      // Until the sweep has finished without the plan, or stands waiting for
      // its row: only then does the link commit.
      for (let poll = 0; poll < 400 && !settled; poll += 1) {
        const waiting = await pool.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
          [applicationName]);
        if ((waiting.rows[0]?.n ?? 0) > 0) break;
        await new Promise((next) => { setTimeout(next, 50); });
      }
      await linking.query("COMMIT");
      await sweep;
    } catch (error) {
      await linking.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      linking.release();
    }

    expect(await plansLeft(db, [plan])).toEqual(new Set([plan]));
    const links = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM event_configuration_links WHERE event_id = $1 AND configuration_id = $2", [eventId, plan]);
    expect(links.rows[0]).toEqual({ n: 1 });
  }, 60_000);
});
