import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// T-653 — the readiness probe Railway reads before it switches traffic. The
// old container must keep serving until the Deploy workflow has applied every
// migration the new image carries, so /health/ready says "not yet" while the
// bundled journal is ahead of drizzle.__drizzle_migrations. Only real rows can
// prove that; the mock-database health tests cannot.
//
// Never loads .env and never falls back to DATABASE_URL. The target must be an
// explicitly named disposable cluster on this machine.
process.env["NODE_ENV"] = "test";
const target = process.env["VENVIEWER_READINESS_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:"
    || parsed.hostname !== "127.0.0.1"
    || parsed.pathname !== "/venviewer_readiness_test"
    || parsed.search !== ""
    || parsed.hash !== "") {
    throw new Error("Readiness tests require the explicit disposable database venviewer_readiness_test on 127.0.0.1");
  }
}

interface ReadyBody {
  readonly status: string;
  readonly code?: string;
  readonly migrations?: { readonly applied: number; readonly local: number };
  readonly pendingTags?: readonly string[];
}

interface AppliedRow { readonly id: number; readonly hash: string; readonly created_at: string }

describe.skipIf(target === undefined)("GET /health/ready on migrated PostgreSQL", () => {
  let pool: Pool;
  let server: FastifyInstance;
  let journalTags: string[];

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `t653_readiness_${randomUUID()}`, max: 4 });
    const name = (await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name;
    expect(name).toBe("venviewer_readiness_test");
    const migrationsFolder = resolve(import.meta.dirname, "../../drizzle");
    await migrate(drizzle(pool), { migrationsFolder });
    const journal = JSON.parse(await readFile(resolve(migrationsFolder, "meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
    journalTags = journal.entries.map((entry) => entry.tag);

    process.env["DATABASE_URL"] = target;
    process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";
    const { buildServer } = await import("../index.js");
    server = await buildServer();
  }, 180_000);

  afterAll(async () => {
    await server?.close();
    await pool?.end();
  });

  async function ready(): Promise<{ status: number; body: ReadyBody }> {
    const response = await server.inject({ method: "GET", url: "/health/ready" });
    return { status: response.statusCode, body: JSON.parse(response.body) as ReadyBody };
  }

  it("answers 200 with the applied and bundled counts once every migration is recorded", async () => {
    const { status, body } = await ready();
    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.migrations).toEqual({ applied: journalTags.length, local: journalTags.length });
  });

  it("answers 503 MIGRATIONS_PENDING naming the unapplied tag while the image is ahead of the database, then 200 again once it lands", async () => {
    const last = (await pool.query<AppliedRow>(
      "SELECT id, hash, created_at::text AS created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC, id DESC LIMIT 1",
    )).rows[0];
    if (last === undefined) throw new Error("the migrated database records no migrations");
    await pool.query("DELETE FROM drizzle.__drizzle_migrations WHERE id = $1", [last.id]);
    try {
      const { status, body } = await ready();
      expect(status).toBe(503);
      expect(body.status).toBe("degraded");
      expect(body.code).toBe("MIGRATIONS_PENDING");
      expect(body.pendingTags).toEqual([journalTags[journalTags.length - 1]]);
      expect(body.migrations).toEqual({ applied: journalTags.length - 1, local: journalTags.length });

      // Reachability is a different question and keeps its own answer.
      const db = await server.inject({ method: "GET", url: "/health/db" });
      expect(db.statusCode).toBe(200);
    } finally {
      await pool.query(
        "INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at) VALUES ($1, $2, $3)",
        [last.id, last.hash, last.created_at],
      );
    }
    const after = await ready();
    expect(after.status).toBe(200);
    expect(after.body.migrations?.applied).toBe(journalTags.length);
  });
});
