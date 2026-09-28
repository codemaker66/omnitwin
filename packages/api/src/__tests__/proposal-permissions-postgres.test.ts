import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProposalVersionPayloadSchema, proposalVersionPayloadDigest } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { proposalRoutes } from "../routes/proposals.js";

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Proposal permission tests require the explicit disposable platform database");
  }
}
const versionPayload = ProposalVersionPayloadSchema.parse({ schemaVersion: "venviewer.proposal-version.v1", title: "Fixture proposal",
  clientMessage: null, configurationId: null, layoutRevision: null, capacityNote: null, quote: null });
// A version is saved with the event's facts as the venue holds them; this
// fixture's proposal has no deal, enquiry or layout, so all are unknown.
const savedPayload = { ...versionPayload, facts: { eventDate: null, guestCount: null, occasion: null, roomName: null, roomSlug: null } };

describe.skipIf(target === undefined)("proposal permissions through real routes and PostgreSQL", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let server: FastifyInstance;
  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `proposal_permissions_${randomUUID()}` });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(proposalRoutes, { db, prefix: "/proposals" });
    await server.ready();
  });
  afterAll(async () => { await server?.close(); await pool?.end(); });

  async function fixture(role: string, foreign = false, platformRole: "none" | "admin" = "none") {
    const venueId = randomUUID(), otherVenueId = randomUUID(), actorId = randomUUID(), colleagueId = randomUUID();
    await db.insert(schema.venues).values([
      { id: venueId, name: "TEST ONLY proposal venue", slug: venueId, address: "Disposable fixture" },
      { id: otherVenueId, name: "TEST ONLY other venue", slug: otherVenueId, address: "Disposable fixture" },
    ]);
    const actor = { id: actorId, email: `${actorId}@proposal.invalid`, role, venueId: foreign ? otherVenueId : venueId, platformRole };
    await db.insert(schema.users).values([
      { ...actor, name: "Fixture actor" },
      { id: colleagueId, email: `${colleagueId}@proposal.invalid`, role: "staff", venueId, name: "Fixture colleague" },
    ]);
    const [proposal] = await db.insert(schema.proposals).values({ venueId, title: "Colleague's draft", createdBy: colleagueId,
      status: "draft", currentVersion: 0 }).returning();
    if (proposal === undefined) throw new Error("Missing proposal fixture");
    return { venueId, otherVenueId, actorId, proposal, headers: { authorization: `Bearer ${JSON.stringify(actor)}` } };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  function create(f: Fixture, links: Record<string, string> = {}) {
    return server.inject({ method: "POST", url: "/proposals", headers: f.headers,
      payload: { venueId: f.venueId, title: "New draft proposal", ...links } });
  }
  function edit(f: Fixture, links: Record<string, string> = {}) {
    return server.inject({ method: "PATCH", url: `/proposals/${f.proposal.id}`, headers: f.headers, payload: { title: "Reviewed title", ...links } });
  }
  function append(f: Fixture) {
    return server.inject({ method: "POST", url: `/proposals/${f.proposal.id}/versions`, headers: f.headers, payload: versionPayload });
  }
  function remove(f: Fixture) {
    return server.inject({ method: "DELETE", url: `/proposals/${f.proposal.id}`, headers: f.headers });
  }
  async function stored(f: Fixture) {
    const [proposal] = await db.select().from(schema.proposals).where(eq(schema.proposals.id, f.proposal.id));
    return { proposal, versions: await db.select().from(schema.proposalVersions).where(eq(schema.proposalVersions.proposalId, f.proposal.id)) };
  }

  it.each(["admin", "staff", "platform_admin"])("allows %s to author drafts and persist a hashed version", async role => {
    const f = await fixture(role === "platform_admin" ? "admin" : role, role === "platform_admin", role === "platform_admin" ? "admin" : "none");
    const created = await create(f);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ data: { venueId: f.venueId, status: "draft", currentVersion: 0 } });
    expect((await edit(f)).statusCode).toBe(200);
    expect((await append(f)).statusCode).toBe(201);
    expect(await stored(f)).toMatchObject({ proposal: { title: "Reviewed title", currentVersion: 1 },
      versions: [expect.objectContaining({ version: 1, payload: savedPayload, sourceHash: proposalVersionPayloadDigest(savedPayload) })] });
    expect((await remove(f)).statusCode).toBe(204);
    expect((await stored(f)).proposal?.deletedAt).toBeInstanceOf(Date);
  });


  // The venue-scoped list must admit exactly who the create/mutate gate
  // admits (routes/proposals.ts canManageCommercial). A role that may manage
  // a proposal but cannot find it in its own list has been granted nothing.
  // Sending a proposal moves its deal to Proposal sent (roadmap X1), by the
  // transition and by the share link alike, with who sent it on the move.
  it.each(["transition", "share-token"])("moves the proposal's deal to Proposal sent when staff send it by its %s", async path => {
    const f = await fixture("staff");
    const [deal] = await db.insert(schema.opportunities).values({ venueId: f.venueId, title: "Henderson wedding", stage: "qualified",
      estimatedValueMinor: 0, currency: "GBP", nextAction: "Draft the proposal" }).returning();
    if (deal === undefined) throw new Error("Missing deal fixture");
    await db.update(schema.proposals).set({ opportunityId: deal.id }).where(eq(schema.proposals.id, f.proposal.id));
    expect((await append(f)).statusCode).toBe(201);
    const sent = await server.inject({ method: "POST", url: `/proposals/${f.proposal.id}/${path}`, headers: f.headers,
      ...(path === "transition" ? { payload: { status: "sent" } } : {}) });
    expect(sent.statusCode).toBe(path === "transition" ? 200 : 201);
    const [moved] = await db.select().from(schema.opportunities).where(eq(schema.opportunities.id, deal.id));
    expect(moved).toMatchObject({ stage: "proposal_sent", nextAction: "Wait for the client response and log any requested changes." });
    expect(await db.select({ fromStage: schema.opportunityStatusHistory.fromStage, toStage: schema.opportunityStatusHistory.toStage,
      changedBy: schema.opportunityStatusHistory.changedBy, note: schema.opportunityStatusHistory.note })
      .from(schema.opportunityStatusHistory).where(eq(schema.opportunityStatusHistory.opportunityId, deal.id)))
      .toEqual([{ fromStage: "qualified", toStage: "proposal_sent", changedBy: f.actorId, note: "The proposal (version 1) was sent." }]);
  });

  it.each(["manager", "sales"])("lets %s discover a colleague's venue proposal", async role => {
    const f = await fixture(role);
    const response = await server.inject({ method: "GET", url: "/proposals", headers: f.headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: [expect.objectContaining({ id: f.proposal.id, venueId: f.venueId })] });
  });

  // A proposal carries money, and hallkeepers never see prices (goal 18 6b) —
  // the same reading that closed the priced analytics routes to them. The list
  // and the desk take the commercial roles and refuse anyone else, as the
  // pipeline does. Both ask for drafts, the fixture's state, so a platform
  // admin's every-venue list finds the newest draft on its first page.
  const LISTS = ["/proposals?status=draft&limit=100", "/proposals/desk?group=drafts&limit=100"] as const;
  async function listed(f: Fixture): Promise<readonly { readonly status: number; readonly shown: boolean }[]> {
    const answers: { status: number; shown: boolean }[] = [];
    for (const url of LISTS) {
      const response = await server.inject({ method: "GET", url, headers: f.headers });
      answers.push({ status: response.statusCode, shown: response.body.includes(f.proposal.id) });
    }
    return answers;
  }
  // An invitation or an approved domain can give a commercial role no venue yet.
  function withoutVenue(f: Fixture, role: string): Fixture {
    const actor = { id: f.actorId, email: `${f.actorId}@proposal.invalid`, role, venueId: null, platformRole: "none" };
    return { ...f, headers: { authorization: `Bearer ${JSON.stringify(actor)}` } };
  }
  it.each(["sales", "manager", "staff", "admin", "platform_admin"])("lets %s find a colleague's proposal in the list and on the desk", async role => {
    const f = role === "platform_admin" ? await fixture("admin", true, "admin") : await fixture(role);
    expect(await listed(f)).toEqual(LISTS.map(() => ({ status: 200, shown: true })));
  });
  it.each(["hallkeeper", "client", "caterer", "planner", "sales_without_venue"])("refuses %s the list and the desk", async role => {
    const f = role === "sales_without_venue" ? withoutVenue(await fixture("sales"), "sales") : await fixture(role);
    expect(await listed(f)).toEqual(LISTS.map(() => ({ status: 403, shown: false })));
  });
  it.each(["foreign_staff", "foreign_sales"])("keeps a colleague's proposal off %s's list and desk", async role => {
    const f = await fixture(role.replace("foreign_", ""), true);
    expect(await listed(f)).toEqual(LISTS.map(() => ({ status: 200, shown: false })));
  });
  // A share link opens the priced proposal to whoever holds it, and a comment
  // joins its record: both take the people opening one takes.
  async function refusedLinkAndComment(f: Fixture): Promise<void> {
    const shared = await server.inject({ method: "POST", url: `/proposals/${f.proposal.id}/share-token`, headers: f.headers });
    expect(shared.statusCode, shared.body).toBe(403);
    const commented = await server.inject({ method: "POST", url: `/proposals/${f.proposal.id}/comments`, headers: f.headers,
      payload: { body: "A note for the team" } });
    expect(commented.statusCode, commented.body).toBe(403);
    expect(await db.select().from(schema.proposalShareTokens).where(eq(schema.proposalShareTokens.proposalId, f.proposal.id))).toEqual([]);
    expect(await db.select().from(schema.proposalComments).where(eq(schema.proposalComments.proposalId, f.proposal.id))).toEqual([]);
  }
  // Opening one proposal takes the people its list and every change to it
  // take. A proposal carries money, and hallkeepers never see prices (goal 18
  // 6b); a salesperson opens a colleague's proposal when told a client has
  // answered it.
  async function withVersion(f: Fixture): Promise<void> {
    await db.insert(schema.proposalVersions).values({ proposalId: f.proposal.id, version: 1,
      payload: savedPayload, sourceHash: proposalVersionPayloadDigest(savedPayload) });
    await db.update(schema.proposals).set({ currentVersion: 1 }).where(eq(schema.proposals.id, f.proposal.id));
  }
  const OPENINGS = ["", "/history", "/comments", "/versions/latest", "/versions/next", "/versions/1", "/available-transitions"] as const;
  async function opened(f: Fixture): Promise<readonly number[]> {
    const codes: number[] = [];
    for (const path of OPENINGS) {
      codes.push((await server.inject({ method: "GET", url: `/proposals/${f.proposal.id}${path}`, headers: f.headers })).statusCode);
    }
    return codes;
  }

  it.each(["sales", "manager", "staff", "admin"])("lets %s open a colleague's proposal, its versions and its history", async role => {
    const f = await fixture(role);
    await withVersion(f);
    expect(await opened(f)).toEqual(OPENINGS.map(() => 200));
  });

  it.each(["hallkeeper", "client", "foreign_staff", "foreign_sales"])("keeps a colleague's proposal and its prices from %s", async role => {
    const f = await fixture(role.replace("foreign_", ""), role.startsWith("foreign_"));
    await withVersion(f);
    expect(await opened(f)).toEqual(OPENINGS.map(() => 403));
    const moved = await server.inject({ method: "POST", url: `/proposals/${f.proposal.id}/transition`, headers: f.headers,
      payload: { status: "sent" } });
    expect(moved.statusCode).toBe(403);
    await refusedLinkAndComment(f);
    expect((await stored(f)).proposal?.status).toBe("draft");
  });

  it("gives the maker nothing once they are not one of the venue's commercial roles", async () => {
    // Made while they sold, now on the floor: who made it grants nothing.
    const f = await fixture("hallkeeper");
    await withVersion(f);
    await db.update(schema.proposals).set({ createdBy: f.actorId }).where(eq(schema.proposals.id, f.proposal.id));
    expect(await opened(f)).toEqual(OPENINGS.map(() => 403));
    expect(await listed(f)).toEqual(LISTS.map(() => ({ status: 403, shown: false })));
    const moved = await server.inject({ method: "POST", url: `/proposals/${f.proposal.id}/transition`, headers: f.headers,
      payload: { status: "sent" } });
    expect(moved.statusCode).toBe(403);
    await refusedLinkAndComment(f);
  });

  it("lets a platform admin open another venue's proposal", async () => {
    const f = await fixture("admin", true, "admin");
    await withVersion(f);
    expect(await opened(f)).toEqual(OPENINGS.map(() => 200));
  });

  it("lets sales send a colleague's proposal, and not a hallkeeper", async () => {
    const sales = await fixture("sales");
    await withVersion(sales);
    const sent = await server.inject({ method: "POST", url: `/proposals/${sales.proposal.id}/transition`, headers: sales.headers,
      payload: { status: "sent" } });
    expect(sent.statusCode, sent.body).toBe(200);

    const hallkeeper = await fixture("hallkeeper");
    await withVersion(hallkeeper);
    const refused = await server.inject({ method: "POST", url: `/proposals/${hallkeeper.proposal.id}/transition`, headers: hallkeeper.headers,
      payload: { status: "sent" } });
    expect(refused.statusCode).toBe(403);
    expect((await stored(hallkeeper)).proposal?.status).toBe("draft");
  });

  it("lets a venue admin discover a colleague's proposal", async () => {
    const f = await fixture("admin");
    const response = await server.inject({ method: "GET", url: "/proposals", headers: f.headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: [expect.objectContaining({ id: f.proposal.id, venueId: f.venueId })] });
  });

  it.each(["foreign_admin", "foreign_staff", "hallkeeper", "client"])("denies %s writes without changing the proposal or its versions", async role => {
    const f = await fixture(role === "foreign_admin" ? "admin" : role === "foreign_staff" ? "staff" : role, role.startsWith("foreign_"));
    expect((await create(f)).statusCode).toBe(403);
    expect((await edit(f)).statusCode).toBe(403);
    expect((await append(f)).statusCode).toBe(403);
    expect((await remove(f)).statusCode).toBe(403);
    expect(await stored(f)).toMatchObject({ proposal: { title: f.proposal.title, deletedAt: null, currentVersion: 0 }, versions: [] });
    expect(await db.select().from(schema.proposals).where(eq(schema.proposals.venueId, f.venueId))).toHaveLength(1);
  });

  it.each(["sent", "accepted"])("keeps %s content frozen for a venue admin", async status => {
    const f = await fixture("admin");
    await db.insert(schema.proposalVersions).values({ proposalId: f.proposal.id, version: 1,
      payload: versionPayload, sourceHash: proposalVersionPayloadDigest(versionPayload) });
    await db.update(schema.proposals).set({ status, sentAt: new Date(), currentVersion: 1 }).where(eq(schema.proposals.id, f.proposal.id));
    expect((await edit(f)).statusCode).toBe(422);
    expect((await append(f)).statusCode).toBe(422);
    if (status === "accepted") expect((await remove(f)).statusCode).toBe(422);
    expect(await stored(f)).toMatchObject({ proposal: { status, title: f.proposal.title, currentVersion: 1, deletedAt: null },
      versions: [expect.objectContaining({ version: 1, payload: versionPayload, sourceHash: proposalVersionPayloadDigest(versionPayload) })] });
  });

  it("preserves the existing platform-admin override for accepted proposals", async () => {
    const f = await fixture("admin", true, "admin");
    await db.update(schema.proposals).set({ status: "accepted", sentAt: new Date() }).where(eq(schema.proposals.id, f.proposal.id));
    expect((await edit(f)).statusCode).toBe(200);
    expect((await append(f)).statusCode).toBe(201);
    expect((await remove(f)).statusCode).toBe(204);
  });

  it("rejects foreign commercial, enquiry and configuration links for venue-admin writes", async () => {
    const f = await fixture("admin"), roomId = randomUUID(), configId = randomUUID(), enquiryId = randomUUID(), opportunityId = randomUUID();
    await db.insert(schema.spaces).values({ id: roomId, venueId: f.otherVenueId, name: "Other room", slug: "room", widthM: "10", lengthM: "10", heightM: "3",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] });
    await db.insert(schema.configurations).values({ id: configId, venueId: f.otherVenueId, spaceId: roomId, name: "Other plan", slug: "other", layoutStyle: "custom" });
    await db.insert(schema.enquiries).values({ id: enquiryId, venueId: f.otherVenueId, spaceId: roomId, configurationId: configId,
      name: "Other enquiry", email: `${enquiryId}@fixture.invalid` });
    await db.insert(schema.opportunities).values({ id: opportunityId, venueId: f.otherVenueId, title: "Other opportunity", sourceEnquiryId: enquiryId });
    const foreignLinks: Record<string, string>[] = [{ opportunityId }, { enquiryId }, { configurationId: configId }];
    for (const links of foreignLinks) {
      expect((await create(f, links)).statusCode).toBe(422);
      expect((await edit(f, links)).statusCode).toBe(422);
    }
    expect(await stored(f)).toMatchObject({ proposal: { opportunityId: null, enquiryId: null, configurationId: null, currentVersion: 0 }, versions: [] });
    expect(await db.select().from(schema.proposals).where(eq(schema.proposals.venueId, f.venueId))).toHaveLength(1);
  });
});
