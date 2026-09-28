import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ProposalNextVersionSchema,
  ProposalVersionPayloadSchema,
  proposalVersionPayloadDigest,
  type ProposalNextVersion,
} from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { proposalRoutes } from "../routes/proposals.js";

// What a version saved now would take (roadmap X1, the composer's check),
// through the real routes and PostgreSQL: the drawing its layout gives now
// against the one the latest version shows its client, the event's facts now
// and as that version froze them, and a basis that holds a save to exactly
// what was checked.

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Next-version tests require the explicit disposable platform database");
  }
}

const OUTLINE = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 12 }, { x: 0, y: 12 }];
const WORDS = ProposalVersionPayloadSchema.parse({ schemaVersion: "venviewer.proposal-version.v1", title: "Henderson wedding",
  clientMessage: "We would love to host you.", configurationId: null, layoutRevision: null, capacityNote: null, quote: null });

describe.skipIf(target === undefined)("the next version's check through real routes and PostgreSQL", () => {
  const applicationName = `proposal_next_${randomUUID()}`;
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let server: FastifyInstance;
  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: applicationName });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(proposalRoutes, { db, prefix: "/proposals" });
    await server.ready();
  });
  afterAll(async () => { await server?.close(); await pool?.end(); });

  // A venue with the Grand Hall and the Saloon, the client's layout in the
  // Grand Hall with three round tables, their enquiry and the deal made from
  // it, and a proposal made from the deal, which links both and the layout.
  async function fixture(options: { readonly layout?: boolean } = {}) {
    const venueId = randomUUID(), actorId = randomUUID(), hallId = randomUUID(), saloonId = randomUUID();
    const assetId = randomUUID(), layout = randomUUID();
    await db.insert(schema.venues).values({ id: venueId, name: "TEST ONLY next-version venue", slug: venueId, address: "Disposable fixture" });
    await db.insert(schema.spaces).values([
      { id: hallId, venueId, name: "Grand Hall", slug: `grand-hall-${hallId}`, widthM: "20", lengthM: "12", heightM: "6", floorPlanOutline: OUTLINE },
      { id: saloonId, venueId, name: "Saloon", slug: `saloon-${saloonId}`, widthM: "20", lengthM: "12", heightM: "5", floorPlanOutline: OUTLINE },
    ]);
    await db.insert(schema.assetDefinitions).values({ id: assetId, name: "TEST ONLY 6ft Round Table", category: "table",
      widthM: "1.8", depthM: "1.8", heightM: "0.75" });
    const actor = { id: actorId, email: `${actorId}@next.invalid`, role: "staff", venueId, platformRole: "none" };
    await db.insert(schema.users).values({ ...actor, name: "Fixture staff" });
    await db.insert(schema.configurations).values({ id: layout, venueId, spaceId: hallId, name: "Their layout", layoutStyle: "dinner-rounds" });
    await db.insert(schema.placedObjects).values([4, 8, 12].map((x) => ({ configurationId: layout, assetDefinitionId: assetId,
      positionX: String(x), positionY: "0", positionZ: "3", coordinateWriteToken: randomUUID() })));
    const [enquiry] = await db.insert(schema.enquiries).values({ venueId, spaceId: hallId, name: "Ailsa Henderson", email: "ailsa@example.invalid",
      configurationId: options.layout === false ? null : layout, preferredDate: "2027-06-05", estimatedGuests: 150, eventType: "wedding" }).returning();
    if (enquiry === undefined) throw new Error("Missing enquiry fixture");
    const [deal] = await db.insert(schema.opportunities).values({ venueId, title: "Henderson wedding", sourceEnquiryId: enquiry.id,
      preferredDate: "2027-06-05", guestCount: 160, eventType: "wedding" }).returning();
    if (deal === undefined) throw new Error("Missing deal fixture");
    const headers = { authorization: `Bearer ${JSON.stringify(actor)}` };
    const made = await server.inject({ method: "POST", url: "/proposals", headers,
      payload: { venueId, title: "Henderson wedding", opportunityId: deal.id } });
    expect(made.statusCode, made.body).toBe(201);
    const proposal = made.json<{ data: { id: string } }>().data.id;
    return { venueId, hallId, saloonId, assetId, layout, deal: deal.id, proposal, headers };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;

  function save(f: Fixture, query = "") {
    return server.inject({ method: "POST", url: `/proposals/${f.proposal}/versions${query}`, headers: f.headers, payload: WORDS });
  }
  async function saved(f: Fixture, query = ""): Promise<number> {
    const response = await save(f, query);
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ data: { version: number } }>().data.version;
  }
  function asked(f: Fixture) {
    return server.inject({ method: "GET", url: `/proposals/${f.proposal}/versions/next`, headers: f.headers });
  }
  async function check(f: Fixture): Promise<ProposalNextVersion> {
    const response = await asked(f);
    expect(response.statusCode, response.body).toBe(200);
    return ProposalNextVersionSchema.parse(response.json<{ data: unknown }>().data);
  }
  async function versionCount(f: Fixture): Promise<number> {
    return (await db.select().from(schema.proposalVersions).where(eq(schema.proposalVersions.proposalId, f.proposal))).length;
  }
  /** Moves the table at `x` to `to`, as the planner writes a move. */
  async function moveTable(f: Fixture, x: number, to: number): Promise<void> {
    const moved = await db.update(schema.placedObjects)
      .set({ positionX: String(to), coordinateWriteToken: randomUUID() })
      .where(and(eq(schema.placedObjects.configurationId, f.layout), eq(schema.placedObjects.positionX, x.toFixed(3))))
      .returning();
    expect(moved).toHaveLength(1);
  }
  function facts(f: Fixture, change: Partial<ProposalNextVersion["facts"]["now"]> = {}) {
    return { eventDate: "2027-06-05", guestCount: 160, occasion: "wedding", roomName: "Grand Hall", roomSlug: `grand-hall-${f.hallId}`, ...change };
  }

  it("reports the same drawing and facts straight after a save, and the same basis each time", async () => {
    const f = await fixture();
    await saved(f);
    const first = await check(f);
    expect(first).toEqual({ basedOn: 1, layout: "same", facts: { saved: facts(f), now: facts(f) }, basis: expect.any(String) });
    expect((await check(f)).basis).toBe(first.basis);
  });

  it("reads the same pieces written again in another order as the same drawing", async () => {
    const f = await fixture();
    await saved(f);
    const before = await check(f);
    // A batch save deletes and writes the pieces again: new rows, in a new
    // order, all at the same step.
    const rows = await db.delete(schema.placedObjects).where(eq(schema.placedObjects.configurationId, f.layout)).returning();
    await db.insert(schema.placedObjects).values([...rows].reverse().map((row) => ({ configurationId: f.layout, assetDefinitionId: row.assetDefinitionId,
      positionX: row.positionX, positionY: row.positionY, positionZ: row.positionZ, coordinateWriteToken: randomUUID() })));
    const after = await check(f);
    expect(after.layout).toBe("same");
    expect(after.basis).toBe(before.basis);
  });

  it("sees a table moved, refuses a save held to the check before it, and takes one held to the check after", async () => {
    const f = await fixture();
    await saved(f);
    const before = await check(f);
    await moveTable(f, 4, 4.5);
    const after = await check(f);
    expect(after.layout).toBe("changed");
    expect(after.basis).not.toBe(before.basis);

    const refused = await save(f, `?basedOn=1&basis=${before.basis}`);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json<{ code: string }>().code).toBe("REVISION_CONFLICT");
    expect(await versionCount(f)).toBe(1);

    expect(await saved(f, `?basedOn=1&basis=${after.basis}`)).toBe(2);
    expect(await check(f)).toMatchObject({ basedOn: 2, layout: "same" });
  });

  it("says a drawing is added where there was none, and removed where the layout is emptied or unlinked", async () => {
    const added = await fixture();
    const pieces = await db.delete(schema.placedObjects).where(eq(schema.placedObjects.configurationId, added.layout)).returning();
    await saved(added);
    await db.insert(schema.placedObjects).values(pieces.map((row) => ({ configurationId: added.layout, assetDefinitionId: row.assetDefinitionId,
      positionX: row.positionX, positionY: row.positionY, positionZ: row.positionZ, coordinateWriteToken: randomUUID() })));
    expect((await check(added)).layout).toBe("added");

    const emptied = await fixture();
    await saved(emptied);
    await db.delete(schema.placedObjects).where(eq(schema.placedObjects.configurationId, emptied.layout));
    expect((await check(emptied)).layout).toBe("removed");

    const unlinked = await fixture();
    await saved(unlinked);
    await db.update(schema.proposals).set({ configurationId: null }).where(eq(schema.proposals.id, unlinked.proposal));
    const check_ = await check(unlinked);
    expect(check_.layout).toBe("removed");
    // The room was the layout's; the enquiry's own room now names it.
    expect(check_.facts.now).toEqual(facts(unlinked));
  });

  it("says there is no drawing on either side for a proposal without a layout", async () => {
    const f = await fixture({ layout: false });
    await saved(f);
    const next = await check(f);
    expect(next.layout).toBe("none");
    expect(next.facts).toEqual({ saved: facts(f), now: facts(f) });
  });

  it("takes a version drawn in the old coordinates for one the client sees without a drawing", async () => {
    const f = await fixture();
    await saved(f);
    await db.update(schema.proposalVersions).set({ coordinateSpace: "legacy_render_v0" })
      .where(eq(schema.proposalVersions.proposalId, f.proposal));
    expect((await check(f)).layout).toBe("added");
  });

  it("gives the event's facts as they are now beside those the latest version froze", async () => {
    const f = await fixture();
    await saved(f);
    const before = await check(f);
    await db.update(schema.opportunities).set({ guestCount: 180, preferredDate: "2027-06-12", eventType: "dinner" })
      .where(eq(schema.opportunities.id, f.deal));
    await db.update(schema.spaces).set({ name: "The Grand Hall" }).where(eq(schema.spaces.id, f.hallId));
    const after = await check(f);
    expect(after.facts).toEqual({
      saved: facts(f),
      now: facts(f, { guestCount: 180, eventDate: "2027-06-12", occasion: "dinner", roomName: "The Grand Hall" }),
    });
    expect(after.layout).toBe("same");
    expect(after.basis).not.toBe(before.basis);
    // A save held to the older check would take facts it never said.
    expect((await save(f, `?basedOn=1&basis=${before.basis}`)).statusCode).toBe(409);
    expect(await saved(f, `?basedOn=1&basis=${after.basis}`)).toBe(2);
  });

  it("gives no saved facts for a version from before they were kept, whose page reads them live", async () => {
    const f = await fixture();
    await saved(f);
    await db.update(schema.proposalVersions).set({ payload: sql`${schema.proposalVersions.payload} - 'facts'` })
      .where(eq(schema.proposalVersions.proposalId, f.proposal));
    expect((await check(f)).facts).toEqual({ saved: null, now: facts(f) });
  });

  it("refuses a save held to a check made before a colleague's version, and writes nothing", async () => {
    const f = await fixture();
    await saved(f);
    const checked = await check(f);
    expect(await saved(f)).toBe(2);
    // With the version it was written from, it is refused as written from an
    // older version; with only the basis, as taking something unchecked.
    for (const [query, code] of [[`?basedOn=1&basis=${checked.basis}`, "PROPOSAL_VERSION_CHANGED"], [`?basis=${checked.basis}`, "REVISION_CONFLICT"]] as const) {
      const refused = await save(f, query);
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json<{ code: string }>().code).toBe(code);
    }
    expect(await versionCount(f)).toBe(2);
  });

  it("refuses a checked save when a colleague's version lands while it waits", async () => {
    const f = await fixture();
    await saved(f);
    const checked = await check(f);
    const blocker = await pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM proposals WHERE id = $1 FOR UPDATE", [f.proposal]);
      const waiting = save(f, `?basis=${checked.basis}`);
      await expect.poll(async () => {
        const rows = await pool.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
          [applicationName],
        );
        return Number(rows.rows[0]?.count);
      }, { timeout: 5000 }).toBe(1);
      // A colleague's version 2 commits first.
      const theirs = { ...WORDS, facts: facts(f) };
      await blocker.query("UPDATE proposals SET current_version = 2 WHERE id = $1", [f.proposal]);
      await blocker.query("INSERT INTO proposal_versions (proposal_id, version, payload, source_hash) VALUES ($1, 2, $2::jsonb, $3)",
        [f.proposal, JSON.stringify(theirs), proposalVersionPayloadDigest(theirs)]);
      await blocker.query("COMMIT");
      const refused = await waiting;
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json<{ code: string }>().code).toBe("PROPOSAL_VERSION_CHANGED");
    } finally {
      blocker.release();
    }
    expect(await versionCount(f)).toBe(2);
  });

  it("still saves without a basis, as the editor's Share lens does", async () => {
    const f = await fixture();
    await saved(f);
    await moveTable(f, 8, 9);
    expect(await saved(f)).toBe(2);
  });

  it("refuses a basis that is not one", async () => {
    const f = await fixture();
    await saved(f);
    const refused = await save(f, "?basis=not-a-basis");
    expect(refused.statusCode).toBe(400);
    expect(await versionCount(f)).toBe(1);
  });

  it("draws the same pieces every time past the cap, however the tied rows lie", async () => {
    const f = await fixture();
    // 805 more tables, all at the same step: more than the 800 a drawing keeps.
    await db.insert(schema.placedObjects).values(Array.from({ length: 805 }, (_, index) => ({
      configurationId: f.layout, assetDefinitionId: f.assetId,
      positionX: (1 + (index % 35) * 0.5).toFixed(3), positionY: "0", positionZ: (4 + Math.floor(index / 35) * 0.3).toFixed(3),
      coordinateWriteToken: randomUUID(),
    })));
    await saved(f);
    const before = await check(f);
    expect(before.layout).toBe("same");
    // Rewriting rows moves them in the table; the drawing must not follow.
    await pool.query("UPDATE placed_objects SET metadata = '{}'::jsonb WHERE configuration_id = $1 AND position_z::numeric < 6", [f.layout]);
    const after = await check(f);
    expect(after.layout).toBe("same");
    expect(after.basis).toBe(before.basis);
  });

  it("answers only for a proposal whose content can change, and that has a version", async () => {
    const f = await fixture();
    const none = await asked(f);
    expect(none.statusCode).toBe(404);
    await saved(f);
    await db.update(schema.proposals).set({ status: "sent", sentAt: new Date(), sentVersion: 1 }).where(eq(schema.proposals.id, f.proposal));
    const sent = await asked(f);
    expect(sent.statusCode).toBe(422);
    expect(sent.json<{ code: string }>().code).toBe("NOT_EDITABLE");
  });
});
