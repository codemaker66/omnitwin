import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";

// ---------------------------------------------------------------------------
// Migration 0079 on isolated PostgreSQL (T-635, roadmap N6).
//
// A venue-path enquiry named no room but was filed against the venue's first,
// and the route wrote the walkthrough's note in front of the guest's words.
// 0079 adds enquiries.source and enquiries.room_chosen, fills them only where
// a row proves them, and takes the note out of every message. Here every kind
// of row the enquiry routes have written, before and after the website's form
// stopped writing the note, meets 0079 exactly as it ships, on a table built
// as the running release defines it.
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
    throw new Error("Enquiry source migration tests require their explicit isolated loopback database");
  }
}

const NOTE = "Sent from the venue's virtual walkthrough (the twin).";
// Production's API was read running the fix's build at 22:22:59 UTC on 26 September.
const BEFORE_FIX = "2026-09-26T21:00:00Z";
const AFTER_FIX = "2026-09-27T09:30:00Z";

interface Row {
  readonly id: string;
  readonly source: string | null;
  readonly room_chosen: boolean;
  readonly message: string | null;
}

interface Written {
  readonly configurationId?: string;
  readonly eventType: string;
  readonly message: string | null;
  readonly createdAt: string;
  readonly fixture?: string;
}

describe.skipIf(testUrl === undefined)("migration 0079 on isolated PostgreSQL", () => {
  const fixtureSchema = `enquiry_source_${randomUUID().replaceAll("-", "")}`;
  let pool: Pool;
  const ids = {
    planner: randomUUID(),
    walkthrough: randomUUID(),
    walkthroughEmpty: randomUUID(),
    website: randomUUID(),
    quoted: randomUUID(),
    access: randomUUID(),
    olderWithNote: randomUUID(),
    olderWithoutNote: randomUUID(),
    olderPricing: randomUUID(),
    fixture: randomUUID(),
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: testUrl, application_name: fixtureSchema, max: 2, options: `-c search_path=${fixtureSchema}` });
    await pool.query(`CREATE SCHEMA "${fixtureSchema}"`);
    // The table as the running release defines it, before 0079.
    const config = getTableConfig(schema.enquiries);
    expect(config.columns.map((column) => column.name)).not.toContain("source");
    const columns = config.columns.map((column) => {
      let defaultSql = "";
      if (column.name === "id") defaultSql = " primary key default gen_random_uuid()";
      else if (column.name === "created_at" || column.name === "updated_at") defaultSql = " default now()";
      else if (column.name === "state") defaultSql = " default 'submitted'";
      return `"${column.name}" ${column.getSQLType()}${defaultSql}`;
    });
    await pool.query(`CREATE TABLE "${config.name}" (${columns.join(", ")})`);

    const venue = randomUUID();
    const flagship = randomUUID();
    const insert = async (id: string, row: Written): Promise<void> => {
      await pool.query(
        `INSERT INTO enquiries (id, venue_id, space_id, configuration_id, name, email, event_type, message, created_at, fixture_source)
         VALUES ($1, $2, $3, $4, 'Fixture guest', 'guest@example.test', $5, $6, $7, $8)`,
        [id, venue, flagship, row.configurationId ?? null, row.eventType, row.message, row.createdAt, row.fixture ?? null],
      );
    };
    await insert(ids.planner, { configurationId: randomUUID(), eventType: "wedding", message: "We would like the Saloon laid for dinner.", createdAt: BEFORE_FIX });
    await insert(ids.walkthrough, { eventType: "wedding", message: `${NOTE}\n\nIs Saturday 14 May free?`, createdAt: AFTER_FIX });
    await insert(ids.walkthroughEmpty, { eventType: "wedding", message: NOTE, createdAt: AFTER_FIX });
    await insert(ids.website, { eventType: "dinner", message: "A Saturday in May, about 120.", createdAt: AFTER_FIX });
    await insert(ids.quoted, { eventType: "dinner", message: `Your page said: ${NOTE}`, createdAt: AFTER_FIX });
    await insert(ids.access, { eventType: "venue-access", message: "Please let me into the workspace.", createdAt: AFTER_FIX });
    await insert(ids.olderWithNote, { eventType: "wedding", message: `${NOTE}\n\nDo you take June Fridays?`, createdAt: BEFORE_FIX });
    await insert(ids.olderWithoutNote, { eventType: "dinner", message: "About 80, black tie.", createdAt: BEFORE_FIX });
    await insert(ids.olderPricing, { eventType: "venue-enquiry", message: `${NOTE}\n\nWe run a hall in Leith.`, createdAt: BEFORE_FIX });
    await insert(ids.fixture, { eventType: "wedding", message: `${NOTE}\n\nA seeded question.`, createdAt: AFTER_FIX, fixture: "demo-seed" });

    // Migration 0079 exactly as it ships, in one transaction as the migrator runs it.
    const migration = await readFile(resolve("drizzle", "0079_enquiry_source_and_room_choice.sql"), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const statement of migration.split("--> statement-breakpoint")) {
        if (statement.trim() !== "") await client.query(statement);
      }
      await client.query("COMMIT");
    } finally {
      client.release();
    }
  }, 120_000);

  afterAll(async () => {
    if (pool !== undefined) {
      // Only the random schema created by this invocation is removed.
      await pool.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
      await pool.end();
    }
  });

  async function row(id: string): Promise<Row> {
    const { rows } = await pool.query<Row>("SELECT id, source, room_chosen, message FROM enquiries WHERE id = $1", [id]);
    const found = rows[0];
    if (found === undefined) throw new Error(`no enquiry ${id}`);
    return found;
  }

  it("marks the planner's enquiry as the guest's own room, and leaves its message", async () => {
    expect(await row(ids.planner)).toMatchObject({ source: "planner", room_chosen: true, message: "We would like the Saloon laid for dinner." });
  });

  it("gives a walkthrough enquiry since the fix its source, and the guest their own words back", async () => {
    expect(await row(ids.walkthrough)).toMatchObject({ source: "walkthrough", room_chosen: false, message: "Is Saturday 14 May free?" });
    expect(await row(ids.walkthroughEmpty)).toMatchObject({ source: "walkthrough", room_chosen: false, message: null });
  });

  it("files the website's form, the workspace gate and the pricing page as the website, with no room chosen", async () => {
    expect(await row(ids.website)).toMatchObject({ source: "website", room_chosen: false, message: "A Saturday in May, about 120." });
    expect(await row(ids.access)).toMatchObject({ source: "website", room_chosen: false, message: "Please let me into the workspace." });
    expect(await row(ids.olderPricing)).toMatchObject({ source: "website", room_chosen: false, message: "We run a hall in Leith." });
  });

  it("names no source for an older enquiry the note cannot place, and still gives back the guest's words", async () => {
    expect(await row(ids.olderWithNote)).toMatchObject({ source: null, room_chosen: false, message: "Do you take June Fridays?" });
    expect(await row(ids.olderWithoutNote)).toMatchObject({ source: null, room_chosen: false, message: "About 80, black tie." });
  });

  it("names no source for a seed fixture, and takes out only the note the route wrote first", async () => {
    expect(await row(ids.fixture)).toMatchObject({ source: null, room_chosen: false, message: "A seeded question." });
    expect(await row(ids.quoted)).toMatchObject({ source: "website", message: `Your page said: ${NOTE}` });
  });

  it("keeps a new enquiry's room as chosen unless it says otherwise, and holds source to its words", async () => {
    const id = randomUUID();
    await pool.query(`INSERT INTO enquiries (id, venue_id, space_id, name, email) VALUES ($1, $2, $2, 'New', 'new@example.test')`, [id, randomUUID()]);
    expect(await row(id)).toMatchObject({ source: null, room_chosen: true });
    await expect(pool.query("UPDATE enquiries SET source = 'fax' WHERE id = $1", [id])).rejects.toMatchObject({ code: "23514" });
    for (const source of ["website", "walkthrough", "planner", "phone", "email"]) {
      await pool.query("UPDATE enquiries SET source = $2 WHERE id = $1", [id, source]);
    }
  });
});
