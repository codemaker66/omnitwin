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
    return { venueId, otherVenueId, proposal, headers: { authorization: `Bearer ${JSON.stringify(actor)}` } };
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
      versions: [expect.objectContaining({ version: 1, payload: versionPayload, sourceHash: proposalVersionPayloadDigest(versionPayload) })] });
    expect((await remove(f)).statusCode).toBe(204);
    expect((await stored(f)).proposal?.deletedAt).toBeInstanceOf(Date);
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
