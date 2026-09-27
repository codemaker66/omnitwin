import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Migration 0081 on isolated PostgreSQL (T-635, roadmap X1).
//
// 0081 makes pg_trgm available so the client search can find a name that was
// heard rather than read. Here the migration runs exactly as it ships, twice,
// and the matches the search will rely on are asked of the database itself.
//
// Opt-in, isolated PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

const TAG = "0081_trigram_search";
const testUrl = process.env["VENVIEWER_ROUTE_TEST_DATABASE_URL"];
if (testUrl !== undefined) {
  const parsed = new URL(testUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || parsed.hostname !== "127.0.0.1" || parsed.port !== "55476"
    || parsed.pathname !== "/venviewer_route_atomicity_test"
    || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("The trigram migration test requires its explicit isolated loopback database");
  }
}

describe("migration 0081 in the journal", () => {
  it("follows 0080 and changes no table", async () => {
    const journal = z.object({
      entries: z.array(z.object({ idx: z.number(), when: z.number(), tag: z.string() })),
    }).parse(JSON.parse(await readFile(resolve("drizzle", "meta", "_journal.json"), "utf8")));
    const entry = journal.entries.find((candidate) => candidate.tag === TAG);
    const previous = journal.entries.find((candidate) => candidate.tag === "0080_enquiry_source_refill");
    expect(entry?.idx).toBe((previous?.idx ?? Number.NaN) + 1);
    expect(entry?.when).toBeGreaterThan(previous?.when ?? Number.POSITIVE_INFINITY);
    const sql = await readFile(resolve("drizzle", `${TAG}.sql`), "utf8");
    const statements = sql.split("\n").filter((line) => line.trim() !== "" && !line.startsWith("--"));
    expect(statements).toEqual(["CREATE EXTENSION IF NOT EXISTS pg_trgm;"]);
  });
});

describe.skipIf(testUrl === undefined)("migration 0081 on isolated PostgreSQL", () => {
  let pool: Pool;

  beforeAll(async () => {
    if (testUrl === undefined) throw new Error("Explicit target required");
    pool = new Pool({ connectionString: testUrl });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name)
      .toBe("venviewer_route_atomicity_test");
  });

  afterAll(async () => { await pool?.end(); });

  it("makes pg_trgm available, and running it again changes nothing", async () => {
    const migration = await readFile(resolve("drizzle", `${TAG}.sql`), "utf8");
    await pool.query(migration);
    await pool.query(migration);
    const installed = await pool.query<{ extname: string }>("SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'");
    expect(installed.rows).toEqual([{ extname: "pg_trgm" }]);
  });

  it("finds the names the search will be asked for, and not a stranger", async () => {
    const { rows } = await pool.query<{ mac: boolean; typo: boolean; within: boolean; stranger: boolean }>(`
      SELECT
        lower('Mcdonald') % lower('MacDonald') AS mac,
        lower('Hendersen') % lower('Henderson') AS typo,
        lower('henderson') <% lower('Ailsa Henderson wedding') AS within,
        lower('Mcdonald') % lower('Robertson') AS stranger
    `);
    expect(rows[0]).toEqual({ mac: true, typo: true, within: true, stranger: false });
  });
});
