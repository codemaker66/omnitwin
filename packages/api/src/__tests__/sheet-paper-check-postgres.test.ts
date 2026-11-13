import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { hallkeeperSheetRoutes } from "../routes/hallkeeper-sheet.js";
import { publicSheetCheckRoutes } from "../routes/public-sheet-check.js";
import { resolveSheetPaperCheck } from "../services/sheet-paper-check.js";

// ---------------------------------------------------------------------------
// Paper that knows its version, against PostgreSQL: the sheet route hands a
// printout its check link, and the public route answers it from the real
// snapshot and approval rows.
//
//   the stale-paper test  print v1, approve v2, scan v1 → "superseded: v2"
//   the bin test          an unauthenticated scan returns version state only
//   the guessing test     every wrong link gets the same "unknown"
//
// Explicitly owned, fully migrated local database only; never loads .env.
// The platform runner (scripts/run-platform-postgres-tests.ts) pins the port.
// ---------------------------------------------------------------------------

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const url = new URL(target);
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1"
    || url.pathname !== "/venviewer_platform_test" || url.search || url.hash) {
    throw new Error("Sheet paper check tests require the disposable platform database");
  }
}

interface SheetJson { data: { paperCheck?: { url: string }; approval: { version: number } | null } }

describe.skipIf(target === undefined)("paper that knows its version, on PostgreSQL", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let server: FastifyInstance;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit target required");
    pool = new Pool({ connectionString: target, max: 3 });
    expect((await pool.query<{ database: string }>("SELECT current_database() AS database")).rows[0]?.database)
      .toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(rateLimit, { max: 1000, timeWindow: "1 minute" });
    await server.register(hallkeeperSheetRoutes, { db, prefix: "/hallkeeper" });
    await server.register(publicSheetCheckRoutes, { check: (query) => resolveSheetPaperCheck(db, query), prefix: "/public" });
    await server.ready();
  }, 120000);
  afterAll(async () => { await server?.close(); await pool?.end(); });

  async function fixture(reviewStatus: string) {
    const venueId = randomUUID(), roomId = randomUUID(), userId = randomUUID(), configId = randomUUID();
    await db.insert(schema.venues).values({ id: venueId, name: "Synthetic paper venue", slug: venueId, address: "Test only" });
    await db.insert(schema.users).values({ id: userId, venueId, name: "Synthetic duty manager", email: `${userId}@paper.test`, role: "admin" });
    await db.insert(schema.spaces).values({ id: roomId, venueId, name: "Synthetic room", slug: roomId,
      widthM: "10", lengthM: "10", heightM: "3",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] });
    await db.insert(schema.configurations).values({ id: configId, venueId, spaceId: roomId, userId,
      name: "Synthetic private plan", slug: configId, layoutStyle: "custom", visibility: "private", reviewStatus });
    const headers = { authorization: `Bearer ${JSON.stringify({ id: userId, email: `${userId}@paper.test`, role: "admin", venueId })}` };
    return { venueId, userId, configId, headers };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;

  /** A minimal frozen sheet: nothing here is read by the check except its row. */
  function frozen(configId: string, name: string) {
    return {
      config: { id: configId, name, guestCount: 140, layoutStyle: "custom" },
      venue: { name: "Synthetic paper venue", address: "Test only", timezone: "Europe/London" },
      space: { name: "Synthetic room", widthM: 10, lengthM: 10, heightM: 3 },
      timing: null, instructions: null, phases: [],
      totals: { entries: [], totalRows: 0, totalItems: 0 },
      diagramUrl: null, floorPlan: null, webViewUrl: "http://frozen.invalid", generatedAt: "2026-10-16T13:00:00.000Z",
      approval: null,
    };
  }

  /** Approve a new version the way the approval route leaves the rows. */
  async function approve(f: Fixture, version: number, approvedAt: Date): Promise<string> {
    const id = randomUUID();
    await db.insert(schema.configurationSheetSnapshots).values({ id, configurationId: f.configId, version,
      payload: frozen(f.configId, `Synthetic plan v${String(version)}`), coordinateSpace: "real_m_v1",
      sourceHash: String(version).repeat(64).slice(0, 64), createdBy: f.userId, approvedAt, approvedBy: f.userId });
    await db.update(schema.configurations).set({ reviewStatus: "approved", approvedAt, approvedBy: f.userId })
      .where(eq(schema.configurations.id, f.configId));
    return id;
  }

  async function printedLink(f: Fixture): Promise<string> {
    const response = await server.inject({ method: "GET", url: `/hallkeeper/${f.configId}/v2`, headers: f.headers });
    expect(response.statusCode).toBe(200);
    const url = response.json<SheetJson>().data.paperCheck?.url;
    if (url === undefined) throw new Error("The served sheet carries no paper check");
    return url;
  }

  async function scan(link: string) {
    const url = new URL(link);
    // No Authorization header: whoever holds the paper.
    const response = await server.inject({ method: "GET", url: `/public/sheet-check${url.search}&p=2026-10-17T06:02` });
    expect(response.statusCode).toBe(200);
    return response.json<{ data: Record<string, unknown> }>().data;
  }

  it("says a printed v1 is current, then superseded once v2 is approved", async () => {
    const f = await fixture("under_review");
    const v1 = await approve(f, 1, new Date("2026-10-16T13:02:00.000Z"));
    const v1Link = await printedLink(f);
    expect(v1Link).toContain(`s=${v1}&v=1&h=1111111111111111`);
    expect(await scan(v1Link)).toEqual({ state: "current", version: 1 });

    await approve(f, 2, new Date("2026-10-17T09:30:00.000Z"));
    expect(await scan(v1Link)).toEqual({ state: "superseded", currentVersion: 2 });
    const v2Link = await printedLink(f);
    expect(v2Link).not.toBe(v1Link);
    expect(await scan(v2Link)).toEqual({ state: "current", version: 2 });
  });

  it("returns version state only to an unauthenticated scan, and stores nothing in the frozen sheet", async () => {
    const f = await fixture("under_review");
    await approve(f, 1, new Date("2026-10-16T13:02:00.000Z"));
    const link = await printedLink(f);
    const response = await server.inject({ method: "GET", url: `/public/sheet-check${new URL(link).search}` });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(Object.keys(response.json<{ data: object }>().data).sort()).toEqual(["state", "version"]);
    for (const secret of ["Synthetic", "140", "paper.test", "Test only", f.configId, f.venueId]) {
      expect(response.body).not.toContain(secret);
    }
    const [row] = await db.select({ payload: schema.configurationSheetSnapshots.payload })
      .from(schema.configurationSheetSnapshots)
      .where(eq(schema.configurationSheetSnapshots.configurationId, f.configId));
    expect(JSON.stringify(row?.payload)).not.toContain("paperCheck");
  });

  it("gives every wrong or guessed link the same 'unknown'", async () => {
    const f = await fixture("under_review");
    const v1 = await approve(f, 1, new Date("2026-10-16T13:02:00.000Z"));
    const deleted = await fixture("approved");
    await db.update(schema.configurations).set({ deletedAt: new Date() }).where(eq(schema.configurations.id, deleted.configId));
    const links = [
      `?s=${randomUUID()}&v=1&h=1111111111111111`,
      `?s=${v1}&v=1&h=2222222222222222`,
      `?s=${v1}&v=2&h=1111111111111111`,
      `?c=${randomUUID()}`,
      `?c=${deleted.configId}`,
    ];
    const bodies = new Set<string>();
    for (const link of links) {
      const response = await server.inject({ method: "GET", url: `/public/sheet-check${link}` });
      expect(response.statusCode, link).toBe(200);
      bodies.add(response.body);
    }
    expect([...bodies]).toEqual([JSON.stringify({ data: { state: "unknown" } })]);
  });

  it("tells a draft printout it is not approved, then which version replaced it", async () => {
    const f = await fixture("draft");
    const draftLink = await printedLink(f);
    expect(draftLink).toMatch(new RegExp(`/sheet-check\\?c=${f.configId}$`, "u"));
    expect(await scan(draftLink)).toEqual({ state: "not_approved" });
    await approve(f, 1, new Date("2026-10-16T13:02:00.000Z"));
    expect(await scan(draftLink)).toEqual({ state: "superseded", currentVersion: 1 });
  });

  it("retires the final copy once the layout is archived after the event", async () => {
    const f = await fixture("under_review");
    await approve(f, 1, new Date("2026-10-16T13:02:00.000Z"));
    const link = await printedLink(f);
    await db.update(schema.configurations).set({ reviewStatus: "archived" }).where(eq(schema.configurations.id, f.configId));
    expect(await scan(link)).toEqual({ state: "retired" });
  });

  it("confirms nothing while the approval record is damaged", async () => {
    const f = await fixture("under_review");
    await approve(f, 1, new Date("2026-10-16T13:02:00.000Z"));
    const link = await printedLink(f);
    await db.update(schema.configurations).set({ approvedAt: new Date("2026-10-18T00:00:00.000Z") })
      .where(eq(schema.configurations.id, f.configId));
    expect(await scan(link)).toEqual({ state: "unknown" });
  });
});
