import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { proposalRoutes } from "../routes/proposals.js";
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
    await server.register(proposalRoutes, { db, prefix: "/proposals" });
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
    return { venueId, otherVenueId, actorId, quote, headers: { authorization: `Bearer ${JSON.stringify(actor)}` } };
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

  // Opening one quote, and moving it where its state allows, takes the people
  // its list and every change to it take. A quote carries money, and
  // hallkeepers never see prices (goal 18 6b).
  function open(f: Fixture) {
    return server.inject({ method: "GET", url: `/quotes/${f.quote.id}`, headers: f.headers });
  }
  function list(f: Fixture) {
    return server.inject({ method: "GET", url: "/quotes", headers: f.headers });
  }
  function issue(f: Fixture) {
    return server.inject({ method: "POST", url: `/quotes/${f.quote.id}/transition`, headers: f.headers, payload: { status: "issued" } });
  }

  it.each(["sales", "manager", "staff", "admin"])("lets %s open and issue a colleague's quote", async role => {
    const f = await fixture(role);
    const opened = await open(f);
    expect(opened.statusCode, opened.body).toBe(200);
    expect(opened.json()).toMatchObject({ data: { id: f.quote.id, totalMinor: 1000 } });
    const issued = await issue(f);
    expect(issued.statusCode, issued.body).toBe(200);
  });

  it.each(["hallkeeper", "client", "foreign_staff", "foreign_sales"])("keeps a colleague's quote and its prices from %s", async role => {
    const f = await fixture(role.replace("foreign_", ""), role.startsWith("foreign_"));
    expect((await open(f)).statusCode).toBe(403);
    expect((await issue(f)).statusCode).toBe(403);
    expect((await stored(f)).quote?.status).toBe("draft");
  });

  it("gives the maker nothing once they are not one of the venue's commercial roles", async () => {
    const f = await fixture("hallkeeper");
    await db.update(schema.quotes).set({ createdBy: f.actorId }).where(eq(schema.quotes.id, f.quote.id));
    expect((await open(f)).statusCode).toBe(403);
    const listed = await list(f);
    expect(listed.statusCode).toBe(403);
    expect(listed.body).not.toContain(f.quote.id);
    expect((await issue(f)).statusCode).toBe(403);
    expect((await stored(f)).quote?.status).toBe("draft");
  });

  it("lets a platform admin open another venue's quote", async () => {
    const f = await fixture("admin", true, "admin");
    expect((await open(f)).statusCode).toBe(200);
  });

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


  // The venue-scoped list must admit exactly who the create/mutate gate
  // admits (routes/quotes.ts canManageCommercial). A role that may manage a
  // quote but cannot find it in its own list has been granted nothing.
  it.each(["manager", "sales", "staff"])("lets %s discover a colleague's venue quote", async role => {
    const f = await fixture(role);
    const response = await server.inject({ method: "GET", url: "/quotes", headers: f.headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: [expect.objectContaining({ id: f.quote.id, venueId: f.venueId })] });
  });

  // Every venue's quotes come oldest first, so the quote is found by its proposal.
  it("lets a platform admin discover another venue's quote", async () => {
    const f = await fixture("admin", true, "admin");
    const [proposal] = await db.insert(schema.proposals).values({ venueId: f.venueId, title: "Linked proposal" }).returning();
    if (proposal === undefined) throw new Error("Missing proposal fixture");
    await db.update(schema.quotes).set({ proposalId: proposal.id }).where(eq(schema.quotes.id, f.quote.id));
    const response = await server.inject({ method: "GET", url: `/quotes?proposalId=${proposal.id}`, headers: f.headers });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ data: [expect.objectContaining({ id: f.quote.id, venueId: f.venueId })] });
  });

  // A quote is money on a page, and hallkeepers never see prices (goal 18 6b).
  // The list refuses anyone outside the commercial roles, as the pipeline does,
  // and a commercial role with no venue yet (an invitation or approved domain).
  it.each(["hallkeeper", "client", "caterer", "planner", "sales_without_venue"])("keeps the venue's quotes out of %s's list", async role => {
    const f = await fixture(role === "sales_without_venue" ? "sales" : role);
    const headers = role === "sales_without_venue"
      ? { authorization: `Bearer ${JSON.stringify({ id: f.actorId, email: `${f.actorId}@quote.invalid`, role: "sales", venueId: null, platformRole: "none" })}` }
      : f.headers;
    const response = await server.inject({ method: "GET", url: "/quotes", headers });
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain(f.quote.id);
  });
  it.each(["foreign_staff", "foreign_sales"])("keeps a colleague's quote off %s's list", async role => {
    const f = await fixture(role.replace("foreign_", ""), true);
    const response = await list(f);
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(f.quote.id);
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

  // A deal's value is filled from its first quote (roadmap X1): a quote made
  // for the deal at once, a proposal's quote once a version carrying it is
  // saved, so a version that did not save leaves the deal as it was. A value
  // already set is the booker's and stays; the deal panel offers the newer
  // total instead.
  it("fills a deal with no value from its first quote, and leaves a value already set", async () => {
    const f = await fixture("sales");
    const [empty, valued] = await db.insert(schema.opportunities).values([
      { venueId: f.venueId, title: "Henderson wedding", stage: "qualified", estimatedValueMinor: 0, currency: "GBP", nextAction: "Draft" },
      { venueId: f.venueId, title: "Merchants' dinner", stage: "qualified", estimatedValueMinor: 900_000, currency: "GBP", nextAction: "Draft" },
    ]).returning();
    if (empty === undefined || valued === undefined) throw new Error("Missing deal fixtures");
    const [proposal] = await db.insert(schema.proposals).values({ venueId: f.venueId, opportunityId: empty.id, title: "Henderson wedding" }).returning();
    if (proposal === undefined) throw new Error("Missing proposal fixture");
    const quote = (link: Record<string, string>, unitAmountMinor: number) => server.inject({
      method: "POST", url: "/quotes", headers: f.headers,
      payload: { venueId: f.venueId, name: "Wedding quote", currency: "GBP", ...link,
        lineItems: [{ description: "Dinner", quantity: 120, unitAmountMinor }, { description: "Room hire", quantity: 1, unitAmountMinor: 440_000 }] },
    });
    const value = async (id: string) => (await db.select({ minor: schema.opportunities.estimatedValueMinor })
      .from(schema.opportunities).where(eq(schema.opportunities.id, id)))[0]?.minor;

    const made = await quote({ proposalId: proposal.id }, 9_500);
    expect(made.statusCode).toBe(201);
    expect(await value(empty.id)).toBe(0);
    const stored = made.json<{ data: { id: string; subtotalMinor: number; totalMinor: number;
      lineItems: { description: string; quantity: number; unitAmountMinor: number; lineTotalMinor: number }[] } }>().data;
    const version = (query: string) => server.inject({ method: "POST", url: `/proposals/${proposal.id}/versions${query}`, headers: f.headers,
      payload: { schemaVersion: "venviewer.proposal-version.v1", title: "Henderson wedding", clientMessage: null, configurationId: null,
        layoutRevision: null, capacityNote: null, quote: { quoteId: stored.id, currency: "GBP",
          lineItems: stored.lineItems.map(({ description, quantity, unitAmountMinor, lineTotalMinor }) => ({ description, quantity, unitAmountMinor, lineTotalMinor })),
          subtotalMinor: stored.subtotalMinor, totalMinor: stored.totalMinor } } });
    // A version refused (written from a version that is not the latest) gives nothing.
    expect((await version("?basedOn=3")).statusCode).toBe(409);
    expect(await value(empty.id)).toBe(0);
    expect((await version("?basedOn=0")).statusCode).toBe(201);
    expect(await value(empty.id)).toBe(1_580_000);
    // A second quote does not overwrite the figure the first one filled.
    expect((await quote({ opportunityId: empty.id }, 10_000)).statusCode).toBe(201);
    expect(await value(empty.id)).toBe(1_580_000);
    expect((await quote({ opportunityId: valued.id }, 9_500)).statusCode).toBe(201);
    expect(await value(valued.id)).toBe(900_000);
    // A quote made for a deal on its own fills it at once.
    const [fresh] = await db.insert(schema.opportunities).values({ venueId: f.venueId, title: "Robertson lunch", stage: "qualified",
      estimatedValueMinor: 0, currency: "GBP", nextAction: "Draft" }).returning();
    if (fresh === undefined) throw new Error("Missing deal fixture");
    expect((await quote({ opportunityId: fresh.id }, 9_500)).statusCode).toBe(201);
    expect(await value(fresh.id)).toBe(1_580_000);
  });

  // The version's quote gives its deal a figure only when it is this
  // proposal's own live quote and the deal has none. (A deal and a quote are
  // both kept in pounds, so the currency guard cannot be reached here.)
  it("fills a deal only from its own proposal's live quote, when it has no value", async () => {
    const f = await fixture("sales");
    const deal = async (currency: string, estimatedValueMinor = 0) => {
      const [row] = await db.insert(schema.opportunities).values({ venueId: f.venueId, title: "Fixture deal", stage: "qualified",
        estimatedValueMinor, currency, nextAction: "Draft" }).returning();
      if (row === undefined) throw new Error("Missing deal fixture");
      const [made] = await db.insert(schema.proposals).values({ venueId: f.venueId, opportunityId: row.id, title: "Fixture proposal" }).returning();
      if (made === undefined) throw new Error("Missing proposal fixture");
      return { dealId: row.id, proposalId: made.id };
    };
    const quoteFor = async (proposalId: string, currency = "GBP") => {
      const made = await server.inject({ method: "POST", url: "/quotes", headers: f.headers,
        payload: { venueId: f.venueId, proposalId, name: "Quote", currency, lineItems: [{ description: "Room hire", quantity: 1, unitAmountMinor: 440_000 }] } });
      expect(made.statusCode, made.body).toBe(201);
      return made.json<{ data: { id: string; totalMinor: number; currency: string } }>().data;
    };
    const saveWith = (proposalId: string, quote: { id: string; totalMinor: number; currency: string }) => server.inject({
      method: "POST", url: `/proposals/${proposalId}/versions`, headers: f.headers,
      payload: { schemaVersion: "venviewer.proposal-version.v1", title: "Fixture proposal", clientMessage: null, configurationId: null,
        layoutRevision: null, capacityNote: null, quote: { quoteId: quote.id, currency: quote.currency,
          lineItems: [{ description: "Room hire", quantity: 1, unitAmountMinor: 440_000, lineTotalMinor: 440_000 }],
          subtotalMinor: quote.totalMinor, totalMinor: quote.totalMinor } } });
    const value = async (id: string) => (await db.select({ minor: schema.opportunities.estimatedValueMinor })
      .from(schema.opportunities).where(eq(schema.opportunities.id, id)))[0]?.minor;

    // Another proposal's quote.
    const own = await deal("GBP");
    const other = await deal("GBP");
    const othersQuote = await quoteFor(other.proposalId);
    expect((await saveWith(own.proposalId, othersQuote)).statusCode).toBe(201);
    expect(await value(own.dealId)).toBe(0);
    // A quote since deleted.
    const deleted = await quoteFor(own.proposalId);
    expect((await server.inject({ method: "DELETE", url: `/quotes/${deleted.id}`, headers: f.headers })).statusCode).toBe(204);
    expect((await saveWith(own.proposalId, deleted)).statusCode).toBe(201);
    expect(await value(own.dealId)).toBe(0);
    // A value already set is the booker's.
    const valued = await deal("GBP", 900_000);
    expect((await saveWith(valued.proposalId, await quoteFor(valued.proposalId))).statusCode).toBe(201);
    expect(await value(valued.dealId)).toBe(900_000);
    // And the proposal's own live quote fills an empty deal.
    expect((await saveWith(own.proposalId, await quoteFor(own.proposalId))).statusCode).toBe(201);
    expect(await value(own.dealId)).toBe(440_000);
  });

  it("refuses a quote that names a deal other than its proposal's", async () => {
    const f = await fixture("sales");
    const [ours, theirs] = await db.insert(schema.opportunities).values([
      { venueId: f.venueId, title: "Ours", stage: "qualified", estimatedValueMinor: 0, currency: "GBP", nextAction: "Draft" },
      { venueId: f.venueId, title: "Theirs", stage: "qualified", estimatedValueMinor: 0, currency: "GBP", nextAction: "Draft" },
    ]).returning();
    if (ours === undefined || theirs === undefined) throw new Error("Missing deal fixtures");
    const [proposal] = await db.insert(schema.proposals).values({ venueId: f.venueId, opportunityId: ours.id, title: "Ours" }).returning();
    if (proposal === undefined) throw new Error("Missing proposal fixture");
    const make = (opportunityId: string) => server.inject({ method: "POST", url: "/quotes", headers: f.headers,
      payload: { venueId: f.venueId, proposalId: proposal.id, opportunityId, name: "Quote", currency: "GBP",
        lineItems: [{ description: "Room hire", quantity: 1, unitAmountMinor: 440_000 }] } });
    const refused = await make(theirs.id);
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.json<{ code: string }>().code).toBe("LINK_MISMATCH");
    expect((await make(ours.id)).statusCode).toBe(201);
    expect(await db.select().from(schema.quotes).where(eq(schema.quotes.proposalId, proposal.id))).toHaveLength(1);
  });

  // A line priced from the price list names its entry, which must be one of
  // the quote's own venue's: a removed entry is gone, and another venue's is
  // refused like any other link across venues. That is the record's
  // integrity, not who may act, so a platform admin is held to it too.
  it.each(["sales", "platform_admin"])("keeps a quote's price-list entries at its venue for %s", async role => {
    const platform = role === "platform_admin";
    const f = await fixture(platform ? "admin" : role, platform, platform ? "admin" : "none");
    const [own, foreign, removed] = await db.insert(schema.pricingRules).values([
      { venueId: f.venueId, name: "Grand Hall hire", type: "flat_rate", amount: "2400.00" },
      { venueId: f.otherVenueId, name: "Another venue's hire", type: "flat_rate", amount: "1800.00" },
      { venueId: f.venueId, name: "Removed hire", type: "flat_rate", amount: "900.00", deletedAt: new Date() },
    ]).returning();
    if (own === undefined || foreign === undefined || removed === undefined) throw new Error("Missing price list fixtures");
    const make = (...ruleIds: string[]) => server.inject({ method: "POST", url: "/quotes", headers: f.headers,
      payload: { venueId: f.venueId, name: "Priced quote", currency: "GBP",
        lineItems: ruleIds.map((pricingRuleId) => ({ description: "Room hire", quantity: 1, unitAmountMinor: 240_000, pricingRuleId })) } });
    const add = (pricingRuleId: string) => server.inject({ method: "POST", url: `/quotes/${f.quote.id}/line-items`, headers: f.headers,
      payload: { description: "Room hire", quantity: 1, unitAmountMinor: 240_000, pricingRuleId } });
    const quotesAtVenue = async () => (await db.select().from(schema.quotes).where(eq(schema.quotes.venueId, f.venueId))).length;
    const before = await quotesAtVenue();

    const refusals: readonly (readonly [readonly string[], number, string])[] = [
      [[foreign.id], 422, "VENUE_MISMATCH"],
      [[own.id, foreign.id], 422, "VENUE_MISMATCH"],
      [[removed.id], 404, "NOT_FOUND"],
      [[randomUUID()], 404, "NOT_FOUND"],
    ];
    for (const [ruleIds, status, code] of refusals) {
      const made = await make(...ruleIds);
      expect(made.statusCode, made.body).toBe(status);
      expect(made.json<{ code: string }>().code).toBe(code);
      if (ruleIds.length !== 1 || ruleIds[0] === undefined) continue;
      const added = await add(ruleIds[0]);
      expect(added.statusCode, added.body).toBe(status);
      expect(added.json<{ code: string }>().code).toBe(code);
    }
    // Nothing was kept: no quote was made, and the draft's lines are as they were.
    expect(await quotesAtVenue()).toBe(before);
    expect((await stored(f)).lines).toHaveLength(1);

    // The venue's own entry is kept with each line it priced, named twice,
    // once in capitals: the same entry either way.
    const made = await make(own.id, own.id.toUpperCase());
    expect(made.statusCode, made.body).toBe(201);
    expect(made.json<{ data: { lineItems: { pricingRuleId: string | null }[] } }>().data.lineItems.map((line) => line.pricingRuleId))
      .toEqual([own.id, own.id]);
    expect((await add(own.id)).statusCode).toBe(201);
    expect((await stored(f)).lines.map((line) => line.pricingRuleId)).toEqual(expect.arrayContaining([null, own.id]));
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
