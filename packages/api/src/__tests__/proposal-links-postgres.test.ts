import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProposalVersionPayloadSchema, proposalVersionPayloadDigest } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { proposalRoutes } from "../routes/proposals.js";

// A proposal's links (roadmap X1), through the real routes and PostgreSQL: the
// server works out the deal's enquiry and that enquiry's own layout, refuses
// links that contradict each other, and owns the layout a version carries.

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Proposal link tests require the explicit disposable platform database");
  }
}

const OUTLINE = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 12 }, { x: 0, y: 12 }];
const baseVersion = ProposalVersionPayloadSchema.parse({ schemaVersion: "venviewer.proposal-version.v1", title: "Fixture proposal",
  clientMessage: null, configurationId: null, layoutRevision: null, capacityNote: null, quote: null });
const forgedSnapshot = { roomWidthM: 50, roomLengthM: 50, items: [
  { shape: "rect", kind: "table", xM: 1, zM: 1, widthM: 2, depthM: 1, rotationDeg: 0 },
  { shape: "rect", kind: "table", xM: 5, zM: 5, widthM: 2, depthM: 1, rotationDeg: 0 },
] };

describe.skipIf(target === undefined)("proposal links through real routes and PostgreSQL", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let server: FastifyInstance;
  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `proposal_links_${randomUUID()}` });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(proposalRoutes, { db, prefix: "/proposals" });
    await server.ready();
  });
  afterAll(async () => { await server?.close(); await pool?.end(); });

  // One venue with a room, the client's layout (one table), a second layout
  // there, and another venue's layout. Enquiry E carries the client's layout
  // and deal D came from it; E0 has no layout and D1 came from it; D0 came
  // from no enquiry.
  async function fixture() {
    const venueId = randomUUID(), otherVenueId = randomUUID(), actorId = randomUUID();
    const spaceId = randomUUID(), otherSpaceId = randomUUID(), assetId = randomUUID();
    const layout = randomUUID(), secondLayout = randomUUID(), foreignLayout = randomUUID();
    await db.insert(schema.venues).values([
      { id: venueId, name: "TEST ONLY link venue", slug: venueId, address: "Disposable fixture" },
      { id: otherVenueId, name: "TEST ONLY other venue", slug: otherVenueId, address: "Disposable fixture" },
    ]);
    await db.insert(schema.spaces).values([
      { id: spaceId, venueId, name: "Grand Hall", slug: `grand-hall-${spaceId}`, widthM: "20", lengthM: "12", heightM: "6", floorPlanOutline: OUTLINE },
      { id: otherSpaceId, venueId: otherVenueId, name: "Elsewhere", slug: `elsewhere-${otherSpaceId}`, widthM: "10", lengthM: "10", heightM: "4", floorPlanOutline: OUTLINE },
    ]);
    await db.insert(schema.assetDefinitions).values({ id: assetId, name: "TEST ONLY table", category: "table", widthM: "1.8", depthM: "0.8", heightM: "0.75" });
    const actor = { id: actorId, email: `${actorId}@links.invalid`, role: "staff", venueId, platformRole: "none" };
    await db.insert(schema.users).values({ ...actor, name: "Fixture staff" });
    await db.insert(schema.configurations).values([
      { id: layout, venueId, spaceId, name: "Their layout", layoutStyle: "dinner-rounds" },
      { id: secondLayout, venueId, spaceId, name: "Venue layout", layoutStyle: "dinner-rounds" },
      { id: foreignLayout, venueId: otherVenueId, spaceId: otherSpaceId, name: "Elsewhere", layoutStyle: "dinner-rounds" },
    ]);
    await db.insert(schema.placedObjects).values({ configurationId: layout, assetDefinitionId: assetId,
      positionX: "5", positionY: "0", positionZ: "4", coordinateWriteToken: randomUUID() });
    const [enquiry, bare] = await db.insert(schema.enquiries).values([
      { venueId, spaceId, name: "Ailsa Henderson", email: "ailsa@example.invalid", configurationId: layout },
      { venueId, spaceId, name: "Iain Robertson", email: "iain@example.invalid" },
    ]).returning();
    if (enquiry === undefined || bare === undefined) throw new Error("Missing enquiry fixtures");
    const [deal, bareDeal, looseDeal] = await db.insert(schema.opportunities).values([
      { venueId, title: "Henderson wedding", sourceEnquiryId: enquiry.id },
      { venueId, title: "Robertson dinner", sourceEnquiryId: bare.id },
      { venueId, title: "Walk-in lunch" },
    ]).returning();
    if (deal === undefined || bareDeal === undefined || looseDeal === undefined) throw new Error("Missing deal fixtures");
    return { venueId, spaceId, layout, secondLayout, foreignLayout, enquiry: enquiry.id, bare: bare.id,
      deal: deal.id, bareDeal: bareDeal.id, looseDeal: looseDeal.id, headers: { authorization: `Bearer ${JSON.stringify(actor)}` } };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;

  function create(f: Fixture, links: Record<string, string | null>) {
    return server.inject({ method: "POST", url: "/proposals", headers: f.headers,
      payload: { venueId: f.venueId, title: "Wedding proposal", ...links } });
  }
  function patch(f: Fixture, id: string, body: Record<string, string | null>) {
    return server.inject({ method: "PATCH", url: `/proposals/${id}`, headers: f.headers, payload: body });
  }
  async function linksOf(id: string) {
    const [row] = await db.select({ opportunityId: schema.proposals.opportunityId, enquiryId: schema.proposals.enquiryId,
      configurationId: schema.proposals.configurationId }).from(schema.proposals).where(eq(schema.proposals.id, id));
    return row;
  }
  async function created(f: Fixture, links: Record<string, string | null>) {
    const response = await create(f, links);
    expect(response.statusCode, response.body).toBe(201);
    const id = response.json<{ data: { id: string } }>().data.id;
    return { id, response: response.json<{ data: Record<string, unknown> }>().data, stored: await linksOf(id) };
  }
  async function count(f: Fixture) {
    return (await db.select().from(schema.proposals).where(eq(schema.proposals.venueId, f.venueId))).length;
  }

  it("links a deal's enquiry and that enquiry's own layout from the deal alone", async () => {
    const f = await fixture();
    const made = await created(f, { opportunityId: f.deal });
    const expected = { opportunityId: f.deal, enquiryId: f.enquiry, configurationId: f.layout };
    expect(made.stored).toEqual(expected);
    expect(made.response).toMatchObject(expected);
  });

  it("links no layout for a deal whose enquiry has none, and no enquiry for a deal from none", async () => {
    const f = await fixture();
    expect((await created(f, { opportunityId: f.bareDeal })).stored)
      .toEqual({ opportunityId: f.bareDeal, enquiryId: f.bare, configurationId: null });
    expect((await created(f, { opportunityId: f.looseDeal })).stored)
      .toEqual({ opportunityId: f.looseDeal, enquiryId: null, configurationId: null });
  });

  it("still takes the pipeline's older request, with the deal's enquiry or null", async () => {
    const f = await fixture();
    for (const enquiryId of [f.enquiry, null]) {
      expect((await created(f, { opportunityId: f.deal, enquiryId })).stored)
        .toEqual({ opportunityId: f.deal, enquiryId: f.enquiry, configurationId: f.layout });
    }
  });

  it("refuses links that contradict each other, and keeps nothing", async () => {
    const f = await fixture();
    const cases: readonly [Record<string, string | null>, string][] = [
      [{ opportunityId: f.deal, enquiryId: f.bare }, "enquiryId"],
      [{ opportunityId: f.looseDeal, enquiryId: f.enquiry }, "enquiryId"],
      [{ opportunityId: f.deal, configurationId: f.secondLayout }, "configurationId"],
      [{ opportunityId: f.looseDeal, configurationId: f.secondLayout }, "configurationId"],
    ];
    for (const [links, field] of cases) {
      const response = await create(f, links);
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json()).toMatchObject({ code: "LINK_MISMATCH", details: { field } });
    }
    expect(await count(f)).toBe(0);
  });

  it("takes a layout of null as none, on a deal whose enquiry has one", async () => {
    const f = await fixture();
    expect((await created(f, { opportunityId: f.deal, configurationId: null })).stored)
      .toEqual({ opportunityId: f.deal, enquiryId: f.enquiry, configurationId: null });
  });

  it("never links a removed layout, or one at another venue, as the client's", async () => {
    const f = await fixture();
    await db.update(schema.configurations).set({ deletedAt: new Date() }).where(eq(schema.configurations.id, f.layout));
    expect((await created(f, { opportunityId: f.deal })).stored)
      .toEqual({ opportunityId: f.deal, enquiryId: f.enquiry, configurationId: null });

    // An enquiry here whose layout is another venue's, made directly: none.
    const [odd] = await db.insert(schema.enquiries).values({ venueId: f.venueId, spaceId: f.spaceId, name: "Odd", email: "odd@example.invalid",
      configurationId: f.foreignLayout }).returning();
    if (odd === undefined) throw new Error("Missing enquiry fixture");
    const [oddDeal] = await db.insert(schema.opportunities).values({ venueId: f.venueId, title: "Odd deal", sourceEnquiryId: odd.id }).returning();
    if (oddDeal === undefined) throw new Error("Missing deal fixture");
    expect((await created(f, { opportunityId: oddDeal.id })).stored)
      .toEqual({ opportunityId: oddDeal.id, enquiryId: odd.id, configurationId: null });
  });

  it("refuses a removed deal, and a layout not on the enquiry named with it, keeping nothing", async () => {
    const f = await fixture();
    await db.update(schema.opportunities).set({ deletedAt: new Date() }).where(eq(schema.opportunities.id, f.deal));
    const removed = await create(f, { opportunityId: f.deal });
    expect(removed.statusCode, removed.body).toBe(404);
    const mixed = await create(f, { enquiryId: f.enquiry, configurationId: f.secondLayout });
    expect(mixed.statusCode, mixed.body).toBe(422);
    expect(mixed.json()).toMatchObject({ code: "LINK_MISMATCH", details: { field: "configurationId" } });
    expect(await count(f)).toBe(0);
  });

  it("links an enquiry named alone with its layout, and the Share lens's layout alone", async () => {
    const f = await fixture();
    expect((await created(f, { enquiryId: f.enquiry })).stored)
      .toEqual({ opportunityId: null, enquiryId: f.enquiry, configurationId: f.layout });
    expect((await created(f, { configurationId: f.secondLayout })).stored)
      .toEqual({ opportunityId: null, enquiryId: null, configurationId: f.secondLayout });
  });

  it("works out links sent by PATCH, refuses a contradiction untouched, and leaves them alone for a title", async () => {
    const f = await fixture();
    const draft = await created(f, {});
    expect(draft.stored).toEqual({ opportunityId: null, enquiryId: null, configurationId: null });
    expect((await patch(f, draft.id, { opportunityId: f.deal })).statusCode).toBe(200);
    expect(await linksOf(draft.id)).toEqual({ opportunityId: f.deal, enquiryId: f.enquiry, configurationId: f.layout });

    const refused = await patch(f, draft.id, { configurationId: f.secondLayout });
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.json()).toMatchObject({ code: "LINK_MISMATCH", details: { field: "configurationId" } });
    expect(await linksOf(draft.id)).toEqual({ opportunityId: f.deal, enquiryId: f.enquiry, configurationId: f.layout });

    expect((await patch(f, draft.id, { configurationId: null })).statusCode).toBe(200);
    expect((await linksOf(draft.id))?.configurationId).toBeNull();
    expect((await patch(f, draft.id, { configurationId: f.layout })).statusCode).toBe(200);
    expect((await linksOf(draft.id))?.configurationId).toBe(f.layout);

    // Links stored before these rules, mixed: a title alone changes none.
    await db.update(schema.proposals).set({ enquiryId: f.bare }).where(eq(schema.proposals.id, draft.id));
    const retitled = await server.inject({ method: "PATCH", url: `/proposals/${draft.id}`, headers: f.headers, payload: { title: "Henderson wedding, v2" } });
    expect(retitled.statusCode, retitled.body).toBe(200);
    expect(await linksOf(draft.id)).toEqual({ opportunityId: f.deal, enquiryId: f.bare, configurationId: f.layout });
  });

  // A10 (Blake, 29 September 2026): staff may leave the client's own layout
  // out, and the desk puts it back by naming it.
  it("puts back only the client's own layout, and only while it is live", async () => {
    const f = await fixture();
    const made = await created(f, { opportunityId: f.deal });
    expect((await patch(f, made.id, { configurationId: null })).statusCode).toBe(200);
    expect(await linksOf(made.id)).toEqual({ opportunityId: f.deal, enquiryId: f.enquiry, configurationId: null });

    await db.update(schema.configurations).set({ deletedAt: new Date() }).where(eq(schema.configurations.id, f.layout));
    const gone = await patch(f, made.id, { configurationId: f.layout });
    expect(gone.statusCode, gone.body).toBe(404);
    expect(gone.json()).toMatchObject({ code: "NOT_FOUND" });
    expect(await linksOf(made.id)).toEqual({ opportunityId: f.deal, enquiryId: f.enquiry, configurationId: null });
  });

  async function saveVersion(f: Fixture, id: string, body: Record<string, unknown>) {
    const response = await server.inject({ method: "POST", url: `/proposals/${id}/versions`, headers: f.headers, payload: body });
    expect(response.statusCode, response.body).toBe(201);
    const [stored] = await db.select().from(schema.proposalVersions).where(eq(schema.proposalVersions.proposalId, id))
      .orderBy(schema.proposalVersions.version);
    if (stored === undefined) throw new Error("Missing version");
    return stored;
  }

  it("keeps the proposal's own layout in a version, drawn by the server, whatever the browser sends", async () => {
    const f = await fixture();
    const made = await created(f, { opportunityId: f.deal });
    const stored = await saveVersion(f, made.id, { ...baseVersion, configurationId: null, layoutRevision: 3, layoutSnapshot: forgedSnapshot });
    const { payload } = stored;
    expect(payload.configurationId).toBe(f.layout);
    expect(payload.layoutRevision).toBeNull();
    expect(payload.layoutSnapshot?.items).toHaveLength(1);
    expect(payload.layoutSnapshot?.roomWidthM).toBe(20);
    expect(payload.facts?.roomName).toBe("Grand Hall");
    expect(stored.sourceHash).toBe(proposalVersionPayloadDigest(payload));
  });

  it("keeps no drawing in a version of a proposal with no layout, whatever the browser sends", async () => {
    const f = await fixture();
    const made = await created(f, { opportunityId: f.looseDeal });
    const stored = await saveVersion(f, made.id, { ...baseVersion, layoutSnapshot: forgedSnapshot });
    const payload = stored.payload as Record<string, unknown>;
    expect("layoutSnapshot" in payload).toBe(false);
    expect(payload["configurationId"]).toBeNull();
    expect(stored.sourceHash).toBe(proposalVersionPayloadDigest(stored.payload));
  });

  it("draws nothing from a layout whose room is removed or is another venue's", async () => {
    const f = await fixture();
    const made = await created(f, { opportunityId: f.deal });
    await db.update(schema.spaces).set({ deletedAt: new Date() }).where(eq(schema.spaces.id, f.spaceId));
    expect((await saveVersion(f, made.id, baseVersion)).payload.layoutSnapshot).toBeNull();

    const other = await fixture();
    const moved = await created(other, { opportunityId: other.deal });
    const [elsewhere] = await db.select({ venueId: schema.configurations.venueId }).from(schema.configurations)
      .where(eq(schema.configurations.id, other.foreignLayout));
    await db.update(schema.spaces).set({ venueId: elsewhere?.venueId ?? "" }).where(eq(schema.spaces.id, other.spaceId));
    expect((await saveVersion(other, moved.id, baseVersion)).payload.layoutSnapshot).toBeNull();
  });

  it("draws nothing, and names no room, once the linked layout is removed", async () => {
    const f = await fixture();
    const made = await created(f, { opportunityId: f.deal });
    await db.update(schema.configurations).set({ deletedAt: new Date() }).where(eq(schema.configurations.id, f.layout));
    // The guest chose no room, so only the layout could name one.
    await db.update(schema.enquiries).set({ roomChosen: false }).where(eq(schema.enquiries.id, f.enquiry));
    const stored = await saveVersion(f, made.id, baseVersion);
    const { payload } = stored;
    expect(payload.configurationId).toBe(f.layout);
    expect(payload.layoutSnapshot).toBeNull();
    expect(payload.facts?.roomName).toBeNull();
  });
});
