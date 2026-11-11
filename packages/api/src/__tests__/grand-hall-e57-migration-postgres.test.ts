import { randomUUID } from "node:crypto";
import type { FloorPlanPoint } from "@omnitwin/types";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import { GRAND_HALL_E57_INTERIOR } from "../db/grand-hall-e57.js";
import * as schema from "../db/schema.js";
import { loadSpacePolygon, validatePlacementsInPolygon } from "../lib/placement-validation.js";
import { migrationText } from "./migration-text.js";

// Migration *_grand_hall_e57_interior gives production's Grand Hall the
// panelled interior the E57 scan measures (db/grand-hall-e57.ts), so a layout
// save stops refusing a chair the planner draws against a long wall. On a
// throwaway schema per case, holding the rows production holds today (the
// public GET /venues/:venueId/spaces of 11 November 2026), it must rewrite that
// one row, replay inertly, skip a database without it, stop on a shape it does
// not know, and never hold up a layout save. On the migrated platform database
// it must apply under the real triggers and keys, inside a transaction that is
// rolled back.
//
// Platform gate only: the explicitly owned disposable database. Never .env,
// never DATABASE_URL. The migration cases build their own throwaway schemas.
const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const url = new URL(target);
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "55477"
    || url.pathname !== "/venviewer_platform_test" || url.search || url.hash) {
    throw new Error("Grand Hall migration tests require the explicitly owned disposable platform database");
  }
}

const GRAND_HALL_E57 = "_grand_hall_e57_interior";

/** Trades Hall Glasgow in production. */
const TRADES_HALL = "100c31e6-e146-4df8-92bc-f3633b316bbb";

function rectangle(widthM: number, lengthM: number): FloorPlanPoint[] {
  return [
    { x: -widthM / 2, y: -lengthM / 2 },
    { x: widthM / 2, y: -lengthM / 2 },
    { x: widthM / 2, y: lengthM / 2 },
    { x: -widthM / 2, y: lengthM / 2 },
  ];
}

interface StoredSpace {
  readonly id: string;
  readonly venueId: string;
  readonly name: string;
  readonly slug: string;
  readonly widthM: string;
  readonly lengthM: string;
  readonly heightM: string;
  readonly outline: readonly FloorPlanPoint[];
}

/** The Grand Hall as production stores it before the migration. */
const GRAND_HALL: StoredSpace = {
  id: "5d903b89-acb0-4c68-8b6a-819880d8289a", venueId: TRADES_HALL, name: "Grand Hall", slug: "grand-hall",
  widthM: "21.00", lengthM: "10.00", heightM: "7.00", outline: rectangle(21, 10),
};

/** The E57 interior, as the migration must leave the Grand Hall. */
const E57_OUTLINE = rectangle(GRAND_HALL_E57_INTERIOR.widthM, GRAND_HALL_E57_INTERIOR.lengthM);

/** Rows the migration has no business with: a room of the same venue, and another venue's grand-hall in the same shape. */
const BYSTANDERS: readonly StoredSpace[] = [
  { id: "79397410-2db9-47bf-a710-b790c64591e5", venueId: TRADES_HALL, name: "Saloon", slug: "saloon",
    widthM: "12.00", lengthM: "7.00", heightM: "5.40", outline: rectangle(12, 7) },
  { id: randomUUID(), venueId: randomUUID(), name: "Grand Hall", slug: "grand-hall",
    widthM: "21.00", lengthM: "10.00", heightM: "7.00", outline: rectangle(21, 10) },
];

const INSERT_SPACE = `INSERT INTO spaces (id, venue_id, name, slug, width_m, length_m, height_m, floor_plan_outline, updated_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '2026-01-01T00:00:00Z')`;

function insertValues(space: StoredSpace): unknown[] {
  return [space.id, space.venueId, space.name, space.slug, space.widthM, space.lengthM, space.heightM, JSON.stringify(space.outline)];
}

interface SpaceRow {
  readonly id: string;
  readonly width_m: string;
  readonly length_m: string;
  readonly height_m: string;
  readonly floor_plan_outline: FloorPlanPoint[];
  readonly updated_at: Date;
}

interface MigrationFailure {
  readonly code: string | undefined;
  readonly message: string;
}

/** A chair centred `z` metres across the hall's centre line, and one `x` metres along it. */
function across(z: number) {
  return { positionX: 0, positionZ: z };
}
function along(x: number) {
  return { positionX: x, positionZ: 0 };
}

describe.skipIf(target === undefined)("the Grand Hall E57 migration against the rows production holds", () => {
  let pool: Pool;
  let client: PoolClient;
  let fixtureSchema: string;

  beforeEach(async () => {
    if (target === undefined) throw new Error("Explicit target required");
    fixtureSchema = `grand_hall_e57_${randomUUID().replaceAll("-", "")}`;
    // Two connections: the migrator's, and a layout save's beside it.
    pool = new Pool({ connectionString: target, max: 2, options: `-c search_path=${fixtureSchema}` });
    client = await pool.connect();
    await client.query(`CREATE SCHEMA "${fixtureSchema}"`);
    // The migrated table's own columns, types and keys, so the migration meets what production has.
    await client.query("CREATE TABLE spaces (LIKE public.spaces INCLUDING ALL)");
    await client.query("CREATE TABLE configurations (space_id uuid NOT NULL REFERENCES spaces (id))");
    for (const space of [GRAND_HALL, ...BYSTANDERS]) await client.query(INSERT_SPACE, insertValues(space));
  });

  afterEach(async () => {
    await client.query("ROLLBACK");
    await client.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
    client.release();
    await pool.end();
  });

  async function rows(): Promise<ReadonlyMap<string, SpaceRow>> {
    const { rows: found } = await client.query<SpaceRow>(
      "SELECT id, width_m, length_m, height_m, floor_plan_outline, updated_at FROM spaces",
    );
    return new Map(found.map((row) => [row.id, row]));
  }

  /** Every row, whole, as text: what a bystander must keep byte for byte. */
  async function wholeRows(): Promise<ReadonlyMap<string, string>> {
    const { rows: found } = await client.query<{ id: string; whole: string }>("SELECT id, to_jsonb(s)::text AS whole FROM spaces s");
    return new Map(found.map((row) => [row.id, row.whole]));
  }

  /** Each row's xmin: the transaction that last wrote it. */
  async function writers(): Promise<ReadonlyMap<string, string>> {
    const { rows: found } = await client.query<{ id: string; xmin: string }>("SELECT id, xmin::text AS xmin FROM spaces");
    return new Map(found.map((row) => [row.id, row.xmin]));
  }

  /** The migrator's shape: the pending file inside one transaction. */
  async function migrate(): Promise<void> {
    await client.query("BEGIN");
    await client.query(await migrationText(GRAND_HALL_E57));
    await client.query("COMMIT");
  }

  /** Runs the migration expecting it to fail, and rolls the transaction back as the migrator does. */
  async function migrationFailure(): Promise<MigrationFailure> {
    try {
      await migrate();
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
      return { code, message: error instanceof Error ? error.message : String(error) };
    }
    throw new Error("The migration rewrote a Grand Hall it should have refused");
  }

  /** The outline a layout save checks against: the save's own loader, on this schema. */
  async function savedOutline(): Promise<readonly FloorPlanPoint[]> {
    const db: Database = drizzle(client, { schema });
    const outline = await loadSpacePolygon(db, GRAND_HALL.id);
    if (outline === null) throw new Error("The Grand Hall is missing");
    return outline;
  }

  it("rewrites production's Grand Hall to the E57 interior, keeps its height and every other row, and is inert on replay", async () => {
    const bystandersBefore = await wholeRows();
    await migrate();

    const hall = (await rows()).get(GRAND_HALL.id);
    expect(hall).toMatchObject({ width_m: "21.14", length_m: "10.59", height_m: "7.00" });
    expect(hall?.floor_plan_outline).toEqual(E57_OUTLINE);
    expect(hall?.updated_at.getTime()).toBeGreaterThan(Date.parse("2026-01-01T00:00:00Z"));
    // The invariant db/schema.ts documents and migration 0007 established: the stored size is the outline's box.
    const { rows: [box] } = await client.query<{ width: string; length: string }>(`SELECT
      (MAX((p->>'x')::numeric) - MIN((p->>'x')::numeric))::text AS width,
      (MAX((p->>'y')::numeric) - MIN((p->>'y')::numeric))::text AS length
      FROM spaces, jsonb_array_elements(floor_plan_outline) AS p WHERE id = $1`, [GRAND_HALL.id]);
    expect([Number(box?.width), Number(box?.length)]).toEqual([21.14, 10.59]);

    const after = await wholeRows();
    for (const bystander of BYSTANDERS) expect(after.get(bystander.id), bystander.name).toBe(bystandersBefore.get(bystander.id));

    const written = await writers();
    await migrate();
    expect(await writers()).toEqual(written);
    expect(await wholeRows()).toEqual(after);
  });

  it("lets a layout save keep a chair 5.2 m across the centre line, which the stored room refused, and still refuses 5.4 m", async () => {
    // Production today: 10.00 m across, so a chair against a long wall is refused.
    expect(validatePlacementsInPolygon([across(5.2), across(-5.2)], await savedOutline())).toHaveLength(2);
    expect(validatePlacementsInPolygon([along(10.55)], await savedOutline())).toHaveLength(1);

    await migrate();
    const outline = await savedOutline();
    expect(validatePlacementsInPolygon([across(5.2), across(-5.2), along(10.55), along(-10.55)], outline)).toEqual([]);
    expect(validatePlacementsInPolygon([across(5.4), across(-5.4), along(10.6), along(-10.6)], outline)
      .map((refused) => refused.index)).toEqual([0, 1, 2, 3]);
    // Nothing the stored room admitted is refused now: its corners, just inside.
    expect(validatePlacementsInPolygon([
      { positionX: 10.49, positionZ: 4.99 }, { positionX: -10.49, positionZ: 4.99 },
      { positionX: 10.49, positionZ: -4.99 }, { positionX: -10.49, positionZ: -4.99 },
    ], outline)).toEqual([]);
  });

  it("does nothing where production's Grand Hall is not stored (a local or test database)", async () => {
    await client.query("DELETE FROM spaces WHERE id = $1", [GRAND_HALL.id]);
    const before = await wholeRows();
    const written = await writers();
    await migrate();
    expect(await wholeRows()).toEqual(before);
    expect(await writers()).toEqual(written);
  });

  it.each([
    { change: "an outline some other change redrew", sql: "UPDATE spaces SET width_m = 20, floor_plan_outline = $2 WHERE id = $1",
      values: [JSON.stringify(rectangle(20, 10))] },
    { change: "a size some other change rewrote", sql: "UPDATE spaces SET length_m = 10.5 WHERE id = $1", values: [] },
  ])("stops on $change, names the row, and writes nothing", async ({ sql, values }) => {
    await client.query(sql, [GRAND_HALL.id, ...values]);
    const before = await wholeRows();
    const failure = await migrationFailure();
    expect(failure.code).toBe("23514");
    expect(failure.message).toContain(`GRAND_HALL_SIZE_CONFLICT: space ${GRAND_HALL.id} is`);
    expect(await wholeRows()).toEqual(before);
  });

  it("never holds up a layout save that references the Grand Hall while the migrator's transaction is open", async () => {
    await client.query("BEGIN");
    await client.query(await migrationText(GRAND_HALL_E57));
    const save = await pool.connect();
    try {
      // A layout's foreign key takes FOR KEY SHARE on its room's row; it must not wait.
      await save.query("SET lock_timeout = '1s'");
      await save.query("INSERT INTO configurations (space_id) VALUES ($1)", [GRAND_HALL.id]);
    } finally {
      save.release();
    }
    await client.query("COMMIT");
    expect((await rows()).get(GRAND_HALL.id)).toMatchObject({ width_m: "21.14", length_m: "10.59" });
  });
});

describe.skipIf(target === undefined)("the Grand Hall E57 migration on the migrated platform database", () => {
  let pool: Pool;
  let client: PoolClient;

  beforeEach(async () => {
    if (target === undefined) throw new Error("Explicit target required");
    pool = new Pool({ connectionString: target, max: 1, application_name: `grand-hall-e57-${randomUUID()}` });
    client = await pool.connect();
  });

  afterEach(async () => {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  });

  it("applies under the real triggers and keys, in a transaction that is rolled back", async () => {
    await client.query("BEGIN");
    await client.query("INSERT INTO venues (id, name, slug, address) VALUES ($1, 'TEST ONLY Grand Hall venue', $2, 'Disposable fixture')",
      [TRADES_HALL, `grand-hall-e57-${randomUUID()}`]);
    await client.query(INSERT_SPACE, insertValues(GRAND_HALL));
    await client.query(await migrationText(GRAND_HALL_E57));
    const { rows: [hall] } = await client.query<SpaceRow>(
      "SELECT id, width_m, length_m, height_m, floor_plan_outline, updated_at FROM spaces WHERE id = $1", [GRAND_HALL.id],
    );
    expect(hall).toMatchObject({ width_m: "21.14", length_m: "10.59", height_m: "7.00" });
    expect(hall?.floor_plan_outline).toEqual(E57_OUTLINE);
    await client.query("ROLLBACK");
    const { rows: [left] } = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM spaces WHERE id = $1", [GRAND_HALL.id]);
    expect(left?.count).toBe(0);
  });
});
