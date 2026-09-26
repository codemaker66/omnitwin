import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CANONICAL_ASSETS } from "@omnitwin/types";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tagEndingWith } from "./migration-text.js";

// The catalogue reconcile refuses to act on a set larger than the release
// plan described. Reading the SQL proves the guard is written; only a database
// proves it fires, and — the half that matters — that firing leaves everything
// exactly as it was. A guard that aborted after renaming half the rows would
// be worse than no guard at all.
//
// Opt-in, isolated, loopback only. Each case builds its own throwaway schema,
// so nothing here can reach a shared database even by accident.
const databaseUrl = process.env["VENVIEWER_RECONCILE_TEST_DATABASE_URL"];
if (databaseUrl !== undefined) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost"].includes(url.hostname)
    || !url.pathname.startsWith("/venviewer_reconcile_")) {
    throw new Error("Reconcile guard tests require their own isolated loopback database");
  }
}

async function migrationSql(suffix: string): Promise<string> {
  return readFile(resolve("drizzle", `${await tagEndingWith(suffix)}.sql`), "utf8");
}

describe.skipIf(databaseUrl === undefined)("reconcile guards on isolated PostgreSQL", () => {
  let pool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `reconcile_${randomUUID().replaceAll("-", "")}`;
    pool = new Pool({ connectionString: databaseUrl, max: 4, options: `-c search_path=${schema}` });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    // The table the reconcile touches, plus the three it probes for
    // references. Minimal but real shapes.
    await pool.query(`CREATE TABLE asset_definitions (
      id uuid PRIMARY KEY, name varchar(200) NOT NULL, category varchar(50) NOT NULL,
      width_m numeric(5,3) NOT NULL, depth_m numeric(5,3) NOT NULL, height_m numeric(5,3) NOT NULL,
      seat_count integer, collision_type varchar(20) NOT NULL DEFAULT 'box',
      mesh_url text, thumbnail_url text,
      created_at timestamptz NOT NULL DEFAULT now())`);
    for (const table of ["placed_objects", "venue_inventory_stock", "venue_inventory_receipts"]) {
      await pool.query(`CREATE TABLE ${table} (asset_definition_id uuid)`);
    }
  });

  afterEach(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  });

  async function rowCount(table: string): Promise<number> {
    const result = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table}`);
    return Number(result.rows[0]?.count ?? "0");
  }

  /** A non-canonical catalogue row, of the kind the retirement targets. */
  async function plantLegacy(index: number): Promise<void> {
    await pool.query(
      `INSERT INTO asset_definitions (id, name, category, width_m, depth_m, height_m, collision_type)
       VALUES ($1, $2, 'chair', 0.45, 0.45, 0.9, 'box')`,
      [`aaaaaaaa-0000-4000-8000-${String(index).padStart(12, "0")}`, `Legacy item ${String(index)}`]);
  }

  describe("the catalogue reconcile", () => {
    it("registers the catalogue and retires the expected number without complaint", async () => {
      for (let index = 1; index <= 8; index += 1) await plantLegacy(index);
      await pool.query(await migrationSql("_catalogue_reconcile"));
      expect(await rowCount("asset_definitions")).toBe(CANONICAL_ASSETS.length + 8);
      const retired = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM asset_definitions WHERE name LIKE '% (retired)'");
      expect(Number(retired.rows[0]?.count)).toBe(8);
    });

    it("aborts on one more than expected and renames nothing", async () => {
      for (let index = 1; index <= 9; index += 1) await plantLegacy(index);
      const before = await pool.query("SELECT id, name FROM asset_definitions ORDER BY id");
      await expect(pool.query(await migrationSql("_catalogue_reconcile"))).rejects.toMatchObject({
        code: "23514", message: expect.stringContaining("CATALOGUE_RECONCILE_UNEXPECTED_SCOPE"),
      });
      // The file is one transaction: no registration, no rename, nothing.
      const after = await pool.query("SELECT id, name FROM asset_definitions ORDER BY id");
      expect(after.rows).toEqual(before.rows);
      expect(await rowCount("asset_definitions")).toBe(9);
    });

    it("names the offending rows so a person can decide", async () => {
      for (let index = 1; index <= 9; index += 1) await plantLegacy(index);
      await expect(pool.query(await migrationSql("_catalogue_reconcile")))
        .rejects.toMatchObject({ message: expect.stringContaining("Legacy item 9") });
    });
  });
});
