import { randomUUID } from "node:crypto";
import { CANONICAL_ASSETS, type CanonicalAsset } from "@omnitwin/types";
import { Pool, type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrationText } from "./migration-text.js";

// Migration 0103 gives three chairs their researched sizes, rewriting a row
// only from the size the catalogue reconcile (0074) registered. The parity
// test reads the file as text; this suite runs it on real constraints. The
// migrated platform database must carry the canonical catalogue field for
// field, as the seed checks it. On a throwaway schema per case, the migration
// must rewrite, replay, stop and skip as its header says. And it must never
// hold up a layout save that references a chair while the migrator's
// transaction is open.
//
// Platform gate only: the explicitly owned disposable database. Never .env,
// never DATABASE_URL. The migration cases build their own throwaway schemas.
const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const url = new URL(target);
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "55477"
    || url.pathname !== "/venviewer_platform_test" || url.search || url.hash) {
    throw new Error("Chair sizes migration tests require the explicitly owned disposable platform database");
  }
}

const CHAIR_SIZES = "_researched_chair_sizes";

function asset(slug: string): CanonicalAsset {
  const found = CANONICAL_ASSETS.find((candidate) => candidate.slug === slug);
  if (found === undefined) throw new Error(`${slug} is not a canonical asset`);
  return found;
}

/** The three chairs, each with the size 0074 registered and the size the catalogue now gives it. */
const CHAIRS = [
  { asset: asset("chiavari-chair"), registered: [0.41, 0.41, 0.92] },
  { asset: asset("pink-chair"), registered: [0.45, 0.45, 0.9] },
  { asset: asset("highchair-wooden"), registered: [0.5, 0.55, 0.95] },
] as const;

/** A table the migration has no business with. */
const BYSTANDER = asset("round-table-6ft");

function researched(chair: CanonicalAsset): readonly number[] {
  return [chair.widthM, chair.depthM, chair.heightM];
}

interface SizeRow {
  readonly id: string;
  readonly width_m: string;
  readonly depth_m: string;
  readonly height_m: string;
}

describe.skipIf(target === undefined)("the migrated platform database", () => {
  let pool: Pool;

  beforeAll(() => {
    if (target === undefined) throw new Error("Explicit target required");
    pool = new Pool({ connectionString: target, application_name: `chair-sizes-${randomUUID()}`, max: 1 });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("carries the canonical catalogue field for field, as the seed checks it, the three chairs at their researched sizes", async () => {
    const { rows } = await pool.query<SizeRow & {
      readonly name: string;
      readonly category: string;
      readonly seat_count: number | null;
      readonly collision_type: string;
      readonly mesh_url: string | null;
      readonly thumbnail_url: string | null;
    }>(`SELECT id, name, category, width_m, depth_m, height_m, seat_count, collision_type, mesh_url, thumbnail_url
      FROM asset_definitions WHERE id = ANY($1::uuid[])`, [CANONICAL_ASSETS.map((canonical) => canonical.id)]);
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const canonical of CANONICAL_ASSETS) {
      const row = byId.get(canonical.id);
      expect(row, `${canonical.slug} (${canonical.id}) is registered`).toBeDefined();
      expect({
        name: row?.name, category: row?.category,
        size: [Number(row?.width_m), Number(row?.depth_m), Number(row?.height_m)],
        seatCount: row?.seat_count, collisionType: row?.collision_type,
        meshUrl: row?.mesh_url, thumbnailUrl: row?.thumbnail_url,
      }, canonical.slug).toEqual({
        name: canonical.name, category: canonical.category,
        size: [canonical.widthM, canonical.depthM, canonical.heightM],
        seatCount: canonical.seatCount, collisionType: canonical.collisionType,
        meshUrl: canonical.meshUrl ?? null, thumbnailUrl: canonical.thumbnailUrl ?? null,
      });
    }
  });
});

interface MigrationFailure {
  readonly code: string | undefined;
  readonly message: string;
}

describe.skipIf(target === undefined)("the chair sizes migration against the rows production may hold", () => {
  let pool: Pool;
  let client: PoolClient;
  let fixtureSchema: string;

  beforeEach(async () => {
    if (target === undefined) throw new Error("Explicit target required");
    fixtureSchema = `chair_sizes_${randomUUID().replaceAll("-", "")}`;
    // Two connections: the migrator's, and a layout save's beside it.
    pool = new Pool({ connectionString: target, max: 2, options: `-c search_path=${fixtureSchema}` });
    client = await pool.connect();
    await client.query(`CREATE SCHEMA "${fixtureSchema}"`);
    // The migrated table's own columns, types and keys, so the migration meets what production has.
    await client.query("CREATE TABLE asset_definitions (LIKE public.asset_definitions INCLUDING ALL)");
    await client.query("CREATE TABLE placed (asset_definition_id uuid NOT NULL REFERENCES asset_definitions (id))");
    for (const { asset: chair, registered } of CHAIRS) {
      await client.query(`INSERT INTO asset_definitions (id, name, category, width_m, depth_m, height_m, seat_count)
        VALUES ($1, $2, $3, $4, $5, $6, $7)`, [chair.id, chair.name, chair.category, ...registered, chair.seatCount]);
    }
    await client.query(`INSERT INTO asset_definitions (id, name, category, width_m, depth_m, height_m, seat_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`, [BYSTANDER.id, BYSTANDER.name, BYSTANDER.category, ...researched(BYSTANDER), BYSTANDER.seatCount]);
  });

  afterEach(async () => {
    await client.query("ROLLBACK");
    await client.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
    client.release();
    await pool.end();
  });

  async function sizes(): Promise<ReadonlyMap<string, readonly number[]>> {
    const { rows } = await client.query<SizeRow>("SELECT id, width_m, depth_m, height_m FROM asset_definitions");
    return new Map(rows.map((row) => [row.id, [Number(row.width_m), Number(row.depth_m), Number(row.height_m)]]));
  }

  /** Each row's xmin: the transaction that last wrote it. */
  async function writers(): Promise<ReadonlyMap<string, string>> {
    const { rows } = await client.query<{ id: string; xmin: string }>("SELECT id, xmin::text AS xmin FROM asset_definitions");
    return new Map(rows.map((row) => [row.id, row.xmin]));
  }

  /** The migrator's shape: the pending file inside one transaction. */
  async function migrate(): Promise<void> {
    await client.query("BEGIN");
    await client.query(await migrationText(CHAIR_SIZES));
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
    throw new Error("The migration rewrote a size it should have refused");
  }

  it("rewrites the three chairs from the size 0074 registered, leaves every other row, and is inert on replay", async () => {
    await migrate();
    const applied = await sizes();
    for (const { asset: chair } of CHAIRS) expect(applied.get(chair.id), chair.slug).toEqual(researched(chair));
    expect(applied.get(BYSTANDER.id)).toEqual(researched(BYSTANDER));

    const written = await writers();
    await migrate();
    expect(await writers()).toEqual(written);
    expect(await sizes()).toEqual(applied);
  });

  it.each(CHAIRS.map(({ asset: chair }) => ({ slug: chair.slug, id: chair.id })))(
    "stops on a $slug some other change resized, names it, and rewrites none of the three",
    async ({ id }) => {
      await client.query("UPDATE asset_definitions SET width_m = 0.6 WHERE id = $1", [id]);
      const before = await sizes();
      const failure = await migrationFailure();
      expect(failure.code).toBe("23514");
      expect(failure.message).toContain(`CHAIR_SIZES_CONFLICT: asset ${id} is 0.600 x`);
      expect(await sizes()).toEqual(before);
    },
  );

  it("leaves a chair it cannot find for the seed, and rewrites the others", async () => {
    const [chiavari, pink, highchair] = CHAIRS;
    await client.query("DELETE FROM asset_definitions WHERE id = $1", [pink.asset.id]);
    await migrate();
    const applied = await sizes();
    expect(applied.has(pink.asset.id)).toBe(false);
    expect(applied.get(chiavari.asset.id)).toEqual(researched(chiavari.asset));
    expect(applied.get(highchair.asset.id)).toEqual(researched(highchair.asset));
  });

  it("never holds up a layout save that references a chair while the migrator's transaction is open", async () => {
    const [, pink] = CHAIRS;
    await client.query("BEGIN");
    await client.query(await migrationText(CHAIR_SIZES));
    const save = await pool.connect();
    try {
      // A placed chair's foreign key takes FOR KEY SHARE on the chair's row; it must not wait.
      await save.query("SET lock_timeout = '1s'");
      await save.query("INSERT INTO placed (asset_definition_id) VALUES ($1)", [pink.asset.id]);
    } finally {
      save.release();
    }
    await client.query("COMMIT");
    expect((await sizes()).get(pink.asset.id)).toEqual(researched(pink.asset));
  });
});
