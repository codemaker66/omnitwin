import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { quoteRoutes } from "../routes/quotes.js";

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Quote permission tests require the explicit disposable platform database");
  }
}

describe.skipIf(target === undefined)("quote permissions through real routes and PostgreSQL", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let server: FastifyInstance;
  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `quote_permissions_${randomUUID()}` });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(quoteRoutes, { db, prefix: "/quotes" });
    await server.ready();
  });
  afterAll(async () => { await server?.close(); await pool?.end(); });

  async function fixture(role: string, foreign = false, platformRole: "none" | "admin" = "none") {
    const venueId = randomUUID(), otherVenueId = randomUUID(), actorId = randomUUID(), colleagueId = randomUUID();
    await db.insert(schema.venues).values([
      { id: venueId, name: "TEST ONLY quote venue", slug: venueId, address: "Disposable fixture" },
      { id: otherVenueId, name: "TEST ONLY other venue", slug: otherVenueId, address: "Disposable fixture" },
    ]);
    const actor = { id: actorId, email: `${actorId}@quote.invalid`, role, venueId: foreign ? otherVenueId : venueId, platformRole };
    await db.insert(schema.users).values([
      { ...actor, name: "Fixture actor" },
      { id: colleagueId, email: `${colleagueId}@quote.invalid`, role: "staff", venueId, name: "Fixture colleague" },
    ]);
    const [quote] = await db.insert(schema.quotes).values({ venueId, name: "Colleague's draft", createdBy: colleagueId,
      status: "draft", currency: "GBP", subtotalMinor: 1000, totalMinor: 1000 }).returning();
    if (quote === undefined) throw new Error("Missing quote fixture");
    await db.insert(schema.quoteLineItems).values({ quoteId: quote.id, description: "Base", quantity: 1,
      unitAmountMinor: 1000, lineTotalMinor: 1000, sortOrder: 0 });
    return { venueId, quote, headers: { authorization: `Bearer ${JSON.stringify(actor)}` } };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  function create(f: Fixture) {
    return server.inject({ method: "POST", url: "/quotes", headers: f.headers,
      payload: { venueId: f.venueId, name: "Exact draft quote", currency: "GBP",
        lineItems: [{ description: "Room hire", quantity: 2, unitAmountMinor: 1250 }] } });
  }
  function edit(f: Fixture) {
    return server.inject({ method: "PATCH", url: `/quotes/${f.quote.id}`, headers: f.headers, payload: { notes: "Reviewed note" } });
  }
  function append(f: Fixture) {
    return server.inject({ method: "POST", url: `/quotes/${f.quote.id}/line-items`, headers: f.headers,
      payload: { description: "Additional equipment", quantity: 2, unitAmountMinor: 150 } });
  }
  function remove(f: Fixture) {
    return server.inject({ method: "DELETE", url: `/quotes/${f.quote.id}`, headers: f.headers });
  }
  async function stored(f: Fixture) {
    const [quote] = await db.select().from(schema.quotes).where(eq(schema.quotes.id, f.quote.id));
    return { quote, lines: await db.select().from(schema.quoteLineItems).where(eq(schema.quoteLineItems.quoteId, f.quote.id)) };
  }

  it.each(["admin", "staff", "platform_admin"])("allows %s to create and manage the scoped draft with exact persisted totals", async role => {
    const f = await fixture(role === "platform_admin" ? "admin" : role, role === "platform_admin", role === "platform_admin" ? "admin" : "none");
    const created = await create(f);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ data: { venueId: f.venueId, currency: "GBP", subtotalMinor: 2500, totalMinor: 2500,
      lineItems: [expect.objectContaining({ quantity: 2, unitAmountMinor: 1250, lineTotalMinor: 2500 })] } });
    expect((await edit(f)).statusCode).toBe(200);
    expect((await append(f)).statusCode).toBe(201);
    expect(await stored(f)).toMatchObject({ quote: { notes: "Reviewed note", subtotalMinor: 1300, totalMinor: 1300 }, lines: expect.any(Array) });
    expect((await stored(f)).lines.map(line => line.lineTotalMinor).sort((left, right) => left - right)).toEqual([300, 1000]);
    expect((await remove(f)).statusCode).toBe(204);
    expect((await stored(f)).quote?.deletedAt).toBeInstanceOf(Date);
  });

  it("lets a venue admin discover a colleague's venue quote", async () => {
    const f = await fixture("admin");
    const response = await server.inject({ method: "GET", url: "/quotes", headers: f.headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: [expect.objectContaining({ id: f.quote.id, venueId: f.venueId })] });
  });

  it.each(["foreign_admin", "foreign_staff", "hallkeeper", "client"])("denies %s writes and preserves the existing quote", async role => {
    const f = await fixture(role === "foreign_admin" ? "admin" : role === "foreign_staff" ? "staff" : role, role.startsWith("foreign_"));
    expect((await create(f)).statusCode).toBe(403);
    expect((await edit(f)).statusCode).toBe(403);
    expect((await append(f)).statusCode).toBe(403);
    expect((await remove(f)).statusCode).toBe(403);
    expect(await stored(f)).toMatchObject({ quote: { notes: null, deletedAt: null, totalMinor: 1000 }, lines: [expect.objectContaining({ lineTotalMinor: 1000 })] });
    expect(await db.select().from(schema.quotes).where(eq(schema.quotes.venueId, f.venueId))).toHaveLength(1);
  });

  it("retains issued-record protection for venue admins and the existing platform override", async () => {
    for (const platformRole of ["none", "admin"] as const) {
      const f = await fixture("admin", platformRole === "admin", platformRole);
      await db.update(schema.quotes).set({ status: "issued" }).where(eq(schema.quotes.id, f.quote.id));
      expect((await edit(f)).statusCode).toBe(platformRole === "admin" ? 200 : 422);
      expect((await append(f)).statusCode).toBe(platformRole === "admin" ? 201 : 422);
      expect((await remove(f)).statusCode).toBe(platformRole === "admin" ? 204 : 422);
      if (platformRole === "none") expect(await stored(f)).toMatchObject({ quote: { status: "issued", notes: null, deletedAt: null, totalMinor: 1000 } });
    }
  });
});
