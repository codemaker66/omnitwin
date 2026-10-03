import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Migration 0085 on isolated PostgreSQL (T-635, roadmap X1; Tier B #16).
//
// Proposal templates by room and occasion. The table must keep a template's
// room to its own venue, keep names and occasions in the shape the API
// matches on, hold lines to an array of at most 40, refuse an empty
// template, allow one live template per name at a venue whatever its case,
// and free the name when a template is removed. Running it again changes
// nothing, and a copy of the table elsewhere in the same database never
// stops its constraints being added.
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
    throw new Error("Proposal template migration tests require their explicit isolated loopback database");
  }
}

async function applyMigration(pool: Pool): Promise<void> {
  const migration = await readFile(resolve("drizzle", "0085_proposal_templates.sql"), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim() !== "") await client.query(statement);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

describe.skipIf(testUrl === undefined)("migration 0085 on isolated PostgreSQL", () => {
  const fixtureSchema = `proposal_templates_${randomUUID().replaceAll("-", "")}`;
  const venue = randomUUID();
  const otherVenue = randomUUID();
  const grandHall = randomUUID();
  const otherRoom = randomUUID();
  const staff = randomUUID();
  let pool: Pool;

  interface Template {
    readonly venue?: string;
    readonly space?: string | null;
    readonly occasion?: string | null;
    readonly name?: string;
    readonly message?: string;
    readonly lines?: string;
    readonly deletedBy?: string | null;
    readonly deletedAt?: string | null;
  }

  async function insert(template: Template = {}): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO proposal_templates (id, venue_id, space_id, occasion, name, message, lines, created_by, deleted_by, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)`,
      [
        id,
        template.venue ?? venue,
        template.space === undefined ? grandHall : template.space,
        template.occasion === undefined ? "wedding" : template.occasion,
        template.name ?? `Grand Hall wedding ${id}`,
        template.message ?? "Thank you for thinking of the Grand Hall.",
        template.lines ?? "[]",
        staff,
        template.deletedBy ?? null,
        template.deletedAt ?? null,
      ],
    );
    return id;
  }
  async function refusal(template: Template): Promise<string | null> {
    try {
      await insert(template);
      return null;
    } catch (error) {
      return (error as { code?: string }).code ?? "unknown";
    }
  }
  async function catalogue(): Promise<{ constraints: string[]; indexes: string[] }> {
    const constraints = (await pool.query<{ conname: string }>(
      `SELECT c.conname FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = $1 AND t.relname = 'proposal_templates' ORDER BY c.conname`,
      [fixtureSchema],
    )).rows.map((row) => row.conname);
    const indexes = (await pool.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'proposal_templates' ORDER BY indexname",
      [fixtureSchema],
    )).rows.map((row) => row.indexname);
    return { constraints, indexes };
  }

  /** The tables 0085 refers to, with the keys it relies on. */
  async function referenced(on: Pool): Promise<void> {
    await on.query(`CREATE TABLE venues (id uuid PRIMARY KEY)`);
    await on.query(`CREATE TABLE users (id uuid PRIMARY KEY)`);
    await on.query(`CREATE TABLE spaces (
      id uuid PRIMARY KEY, venue_id uuid NOT NULL REFERENCES venues(id),
      CONSTRAINT spaces_id_venue_unique UNIQUE (id, venue_id))`);
  }

  // A copy of the table already elsewhere in the database, as another test's
  // own schema holds one: the constraints are still added here.
  const elsewhereSchema = `${fixtureSchema}_elsewhere`;

  beforeAll(async () => {
    const elsewhere = new Pool({ connectionString: testUrl, application_name: elsewhereSchema, max: 1, options: `-c search_path=${elsewhereSchema}` });
    try {
      await elsewhere.query(`CREATE SCHEMA "${elsewhereSchema}"`);
      await referenced(elsewhere);
      await applyMigration(elsewhere);
    } finally {
      await elsewhere.end();
    }

    pool = new Pool({ connectionString: testUrl, application_name: fixtureSchema, max: 2, options: `-c search_path=${fixtureSchema}` });
    await pool.query(`CREATE SCHEMA "${fixtureSchema}"`);
    await referenced(pool);
    await pool.query("INSERT INTO venues (id) VALUES ($1), ($2)", [venue, otherVenue]);
    await pool.query("INSERT INTO users (id) VALUES ($1)", [staff]);
    await pool.query("INSERT INTO spaces (id, venue_id) VALUES ($1, $2), ($3, $4)", [grandHall, venue, otherRoom, otherVenue]);
    await applyMigration(pool);
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
    await pool.query(`DROP SCHEMA IF EXISTS "${elsewhereSchema}" CASCADE`);
    await pool.end();
  });

  it("keeps a template for a room of its venue, for any room and for any occasion", async () => {
    await insert();
    await insert({ space: null });
    await insert({ occasion: null });
    await insert({ message: "", lines: JSON.stringify([{ kind: "typed", description: "Piper", quantity: 1 }]) });
  });

  it("refuses a room of another venue", async () => {
    expect(await refusal({ space: otherRoom })).toBe("23503");
    expect(await refusal({ venue: otherVenue, space: grandHall })).toBe("23503");
  });

  it("holds names and occasions to the shape the templates are matched on", async () => {
    expect(await refusal({ name: " Grand Hall wedding" })).toBe("23514");
    expect(await refusal({ name: "" })).toBe("23514");
    expect(await refusal({ occasion: "Wedding" })).toBe("23514");
    expect(await refusal({ occasion: " wedding" })).toBe("23514");
    expect(await refusal({ occasion: "" })).toBe("23514");
  });

  it("holds the message and lines to their bounds, and refuses an empty template", async () => {
    expect(await refusal({ message: "x".repeat(4001) })).toBe("23514");
    await insert({ message: "x".repeat(4000) });
    expect(await refusal({ lines: "{}" })).toBe("23514");
    expect(await refusal({ lines: "\"Grand Hall hire\"" })).toBe("23514");
    const typed = { kind: "typed", description: "Piper", quantity: 1 };
    expect(await refusal({ lines: JSON.stringify(Array.from({ length: 41 }, () => typed)) })).toBe("23514");
    await insert({ lines: JSON.stringify(Array.from({ length: 40 }, () => typed)) });
    expect(await refusal({ message: "", lines: "[]" })).toBe("23514");
  });

  it("keeps one live template per name at a venue, whatever its case, and frees the name when one is removed", async () => {
    const first = await insert({ name: "Saloon drinks" });
    expect(await refusal({ name: "SALOON DRINKS" })).toBe("23505");
    await insert({ name: "Saloon drinks", venue: otherVenue, space: null });

    await pool.query("UPDATE proposal_templates SET deleted_at = now(), deleted_by = $2 WHERE id = $1", [first, staff]);
    const second = await insert({ name: "saloon drinks" });
    // The removed one cannot come back under a name now in use.
    await expect(pool.query("UPDATE proposal_templates SET deleted_at = NULL, deleted_by = NULL WHERE id = $1", [first]))
      .rejects.toMatchObject({ code: "23505" });
    expect(second).not.toBe(first);
  });

  it("names who removed a template only with the removal", async () => {
    expect(await refusal({ deletedBy: staff, deletedAt: null })).toBe("23514");
    await insert({ deletedBy: staff, deletedAt: "2026-09-29T20:00:00Z" });
  });

  it("keeps a template when the person who wrote it is removed", async () => {
    const leaver = randomUUID();
    await pool.query("INSERT INTO users (id) VALUES ($1)", [leaver]);
    const id = randomUUID();
    await pool.query(
      `INSERT INTO proposal_templates (id, venue_id, name, message, created_by, updated_by)
       VALUES ($1, $2, $3, 'Words.', $4, $4)`,
      [id, venue, `Kept ${id}`, leaver],
    );
    await pool.query("DELETE FROM users WHERE id = $1", [leaver]);
    const kept = (await pool.query<{ created_by: string | null; updated_by: string | null }>(
      "SELECT created_by, updated_by FROM proposal_templates WHERE id = $1", [id],
    )).rows[0];
    expect(kept).toEqual({ created_by: null, updated_by: null });
  });

  it("changes nothing when it runs again", async () => {
    const before = await catalogue();
    const rows = (await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM proposal_templates")).rows[0]?.count;
    await applyMigration(pool);
    expect(await catalogue()).toEqual(before);
    expect((await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM proposal_templates")).rows[0]?.count).toBe(rows);
    expect(before.indexes).toContain("proposal_templates_live_name");
    expect(before.constraints).toEqual(expect.arrayContaining([
      "proposal_templates_space_venue_fk", "proposal_templates_name_shape", "proposal_templates_occasion_shape",
      "proposal_templates_message_length", "proposal_templates_lines_shape", "proposal_templates_not_empty",
      "proposal_templates_removal",
    ]));
  });
});
