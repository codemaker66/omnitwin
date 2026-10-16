import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Migration 0089, pricing rule windows, on isolated PostgreSQL.
//
// The schema half is proven by running the whole migration set on an empty
// database. The data half is the SQL production will run over rules that
// already exist, so it is exercised as written: the file's non-ALTER
// statements are replayed over rows named as the venue's price sheet names
// them, and the windows they earn are read back.
//
// Opt-in, isolated PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

const testUrl = process.env["VENVIEWER_PRICING_WINDOWS_TEST_DATABASE_URL"];
if (testUrl !== undefined) {
  const parsed = new URL(testUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || parsed.hostname !== "127.0.0.1"
    || parsed.pathname !== "/venviewer_pricing_windows_test"
    || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Pricing window migration tests require their explicit isolated loopback database");
  }
}

const VENUE = "77777777-7777-4777-8777-777777777701";
const ROOM = "77777777-7777-4777-8777-777777777702";
const HALF = "77777777-7777-4777-8777-777777777710";
const SALOON_HALF = "77777777-7777-4777-8777-777777777711";
const FULL = "77777777-7777-4777-8777-777777777712";
const EVENING = "77777777-7777-4777-8777-777777777713";
const EXCLUSIVE = "77777777-7777-4777-8777-777777777714";
const TWO_APART = "77777777-7777-4777-8777-777777777715";
const HYPHEN = "77777777-7777-4777-8777-777777777716";
const ALREADY = "77777777-7777-4777-8777-777777777717";

interface RuleRow {
  readonly id: string;
  readonly name: string;
  readonly amount: string;
  readonly space_id: string | null;
  readonly is_active: boolean;
  readonly applies_from: string | null;
  readonly applies_until: string | null;
}

describe.skipIf(testUrl === undefined)("migration 0089: pricing rule windows", () => {
  let pool: Pool;
  let dataStatements: readonly string[];

  beforeAll(async () => {
    pool = new Pool({ connectionString: testUrl, application_name: `pricing_windows_${randomUUID().slice(0, 8)}`, max: 4 });
    await migrate(drizzle(pool), { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
    const sql = readFileSync(resolve(import.meta.dirname, "../../drizzle/0089_pricing_rule_windows.sql"), "utf8");
    dataStatements = sql.split("--> statement-breakpoint")
      .map((statement) => statement.replace(/^\s*--.*$/gmu, "").trim())
      .filter((statement) => statement.length > 0 && !statement.startsWith("ALTER TABLE"));
    expect(dataStatements).toHaveLength(4);
  }, 300_000);

  afterAll(async () => {
    await pool.query("DELETE FROM pricing_rules WHERE venue_id = $1", [VENUE]);
    await pool.query("DELETE FROM spaces WHERE id = $1", [ROOM]);
    await pool.query("DELETE FROM venues WHERE id = $1", [VENUE]);
    await pool.end();
  });

  async function insertRule(id: string, name: string, amount: number, window: readonly [string, string] | null = null): Promise<void> {
    await pool.query(
      `INSERT INTO pricing_rules (id, venue_id, space_id, name, type, amount, currency, is_active, applies_from, applies_until)
       VALUES ($1, $2, $3, $4, 'flat_rate', $5, 'GBP', true, $6, $7)`,
      [id, VENUE, id === EXCLUSIVE ? null : ROOM, name, amount, window?.[0] ?? null, window?.[1] ?? null],
    );
  }

  async function rules(): Promise<readonly RuleRow[]> {
    const result = await pool.query<RuleRow>(
      "SELECT id, name, amount, space_id, is_active, applies_from::text, applies_until::text FROM pricing_rules WHERE venue_id = $1 ORDER BY name",
      [VENUE],
    );
    return result.rows;
  }

  async function replayDataStep(): Promise<void> {
    for (const statement of dataStatements) await pool.query(statement);
  }

  beforeEach(async () => {
    await pool.query("DELETE FROM pricing_rules WHERE venue_id = $1", [VENUE]);
    await pool.query("INSERT INTO venues (id, name, slug, address) VALUES ($1, 'Windows Hall', $2, '1 Test Street') ON CONFLICT (id) DO NOTHING", [VENUE, `windows-hall-${VENUE.slice(-4)}`]);
    await pool.query("INSERT INTO spaces (id, venue_id, name, slug, width_m, length_m, height_m, floor_plan_outline) VALUES ($1, $2, 'Grand Hall', 'grand-hall-w', 21, 10.5, 7, '[]'::jsonb) ON CONFLICT (id) DO NOTHING", [ROOM, VENUE]);
    await insertRule(HALF, "Grand Hall — Half Day (09:00–13:00 or 14:00–18:00)", 550);
    await insertRule(SALOON_HALF, "Saloon — Half Day (09:00–13:00 or 14:00–18:00) (Free with Grand Hall booking)", 350);
    await insertRule(FULL, "Grand Hall — Full Day (09:00–17:30)", 900);
    await insertRule(EVENING, "Grand Hall — Evening Event (19:00–00:30) (Includes Saloon)", 1500);
    await insertRule(EXCLUSIVE, "Exclusive Use of Full Venue", 2500);
    await insertRule(TWO_APART, "Two rooms (09:00–13:00) and (14:00–18:00)", 10);
    await insertRule(HYPHEN, "Hyphen slot (09:00-13:00)", 20);
    await insertRule(ALREADY, "Already windowed (10:00–11:00)", 30, ["08:00", "09:00"]);
  });

  it("splits a name stating two windows into two rules, one per window, the original keeping its id", async () => {
    await replayDataStep();
    const rows = await rules();
    const original = rows.find((row) => row.id === HALF);
    expect(original).toMatchObject({ name: "Grand Hall — Half Day (09:00–13:00)", applies_from: "09:00:00", applies_until: "13:00:00" });
    const sibling = rows.find((row) => row.name === "Grand Hall — Half Day (14:00–18:00)");
    expect(sibling).toMatchObject({ amount: "550.00", space_id: ROOM, applies_from: "14:00:00", applies_until: "18:00:00" });
    expect(sibling?.id).not.toBe(HALF);
    // A note after the windows survives on both halves.
    expect(rows.map((row) => row.name)).toEqual(expect.arrayContaining([
      "Saloon — Half Day (09:00–13:00) (Free with Grand Hall booking)",
      "Saloon — Half Day (14:00–18:00) (Free with Grand Hall booking)",
    ]));
    expect(rows).toHaveLength(10);
  });

  it("fills a single stated window, one past midnight included, with a hyphen or an en dash", async () => {
    await replayDataStep();
    const rows = await rules();
    expect(rows.find((row) => row.id === FULL)).toMatchObject({ applies_from: "09:00:00", applies_until: "17:30:00" });
    expect(rows.find((row) => row.id === EVENING)).toMatchObject({ name: "Grand Hall — Evening Event (19:00–00:30) (Includes Saloon)", applies_from: "19:00:00", applies_until: "00:30:00" });
    expect(rows.find((row) => row.id === HYPHEN)).toMatchObject({ applies_from: "09:00:00", applies_until: "13:00:00" });
  });

  it("leaves a name stating no window, or two not joined by 'or', null, and never rewrites a window already set", async () => {
    await replayDataStep();
    const rows = await rules();
    expect(rows.find((row) => row.id === EXCLUSIVE)).toMatchObject({ name: "Exclusive Use of Full Venue", applies_from: null, applies_until: null });
    // ...and only that one rule is switched off, its row kept (Blake, 16 October 2026).
    expect(rows.find((row) => row.id === EXCLUSIVE)?.is_active).toBe(false);
    expect(rows.filter((row) => row.id !== EXCLUSIVE).every((row) => row.is_active)).toBe(true);
    expect(rows.find((row) => row.id === TWO_APART)).toMatchObject({ name: "Two rooms (09:00–13:00) and (14:00–18:00)", applies_from: null, applies_until: null });
    expect(rows.find((row) => row.id === ALREADY)).toMatchObject({ applies_from: "08:00:00", applies_until: "09:00:00" });
  });

  it("replaying the data step changes nothing more", async () => {
    await replayDataStep();
    const once = await rules();
    await replayDataStep();
    expect(await rules()).toEqual(once);
  });

  it("the pair check refuses a window with one side", async () => {
    await expect(pool.query(
      "UPDATE pricing_rules SET applies_from = '09:00', applies_until = NULL WHERE id = $1", [FULL],
    )).rejects.toThrow(/pricing_rules_window_pair_check/u);
  });
});
