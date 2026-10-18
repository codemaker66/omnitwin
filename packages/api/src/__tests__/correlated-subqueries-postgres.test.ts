import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { clientRoutes } from "../routes/clients.js";
import { crmRoutes } from "../routes/crm.js";
import { referenceLoadoutRoutes } from "../routes/reference-loadouts.js";

// ---------------------------------------------------------------------------
// Counts and names read by a subquery for each row, on real PostgreSQL.
//
// In a select from one table, Drizzle writes `${table.column}` interpolated
// straight into the select list's own SQL as the bare column name.
// PostgreSQL resolves a bare name against the subquery's own table first, so
// `configuration_id = "id"` compared each placed object with itself (every
// layout read "0 pieces") and `rp.loadout_id = "id"` was ambiguous between
// the photo and its file, so every room's reference loadouts answered 500
// (found on 18 October 2026). Only real rows show it: the mocked route tests
// never run the SQL. Each case below builds its own people and rows.
//
// Opt-in, disposable PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Correlated subquery tests require the explicit disposable platform database");
  }
}

// The canonical chair, seeded by the migrations.
const CHAIR = "7f1fb7a2-5210-57b1-9108-11255c059520";

describe.skipIf(target === undefined)("per-row subqueries on the migrated disposable database", () => {
  let pool: Pool;
  let server: FastifyInstance;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const venueId = randomUUID();
  const otherVenueId = randomUUID();
  const spaceId = randomUUID();
  const otherSpaceId = randomUUID();
  const staffId = randomUUID();

  type Who = { readonly id: string; readonly role: string; readonly venueId: string | null; readonly platformRole?: "admin" };
  const staff: Who = { id: staffId, role: "admin", venueId };
  const platformAdmin: Who = { id: randomUUID(), role: "admin", venueId: null, platformRole: "admin" };

  function bearer(who: Who): { authorization: string } {
    return { authorization: `Bearer ${JSON.stringify({ id: who.id, email: `${who.id}@subqueries.invalid`, role: who.role, platformRole: who.platformRole ?? "none", venueId: who.venueId })}` };
  }

  async function get<T>(url: string, who: Who = staff): Promise<T> {
    const response = await server.inject({ method: "GET", url, headers: bearer(who) });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<{ data: T }>().data;
  }

  /** A client of the venues: a person with no venue of their own. */
  async function client(): Promise<{ readonly id: string; readonly name: string; readonly email: string }> {
    const id = randomUUID();
    const name = `Ishbel Kerr ${id.slice(0, 8)}`;
    const email = `${id}@subqueries.invalid`;
    await db.insert(schema.users).values({ id, venueId: null, name, email, role: "client" });
    return { id, name, email };
  }

  async function layout(owner: string, venue: string, space: string, pieces: number, name = `Layout with ${String(pieces)}`): Promise<string> {
    const [row] = await db.insert(schema.configurations).values({
      venueId: venue, spaceId: space, userId: owner, name, layoutStyle: "custom",
    }).returning({ id: schema.configurations.id });
    if (row === undefined) throw new Error("Configuration fixture missing");
    if (pieces > 0) {
      await db.insert(schema.placedObjects).values(Array.from({ length: pieces }, (_, index) => ({
        configurationId: row.id, assetDefinitionId: CHAIR, positionX: String(index), positionY: "0", positionZ: "1",
        sortOrder: index, coordinateWriteToken: randomUUID(),
      })));
    }
    return row.id;
  }

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `correlated_subqueries_${randomUUID()}` });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(clientRoutes, { db, prefix: "/clients" });
    await server.register(crmRoutes, { db, prefix: "/crm" });
    await server.register(referenceLoadoutRoutes, { db, prefix: "/venues/:venueId/spaces/:spaceId/loadouts" });
    await server.ready();

    const outline = [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }];
    await db.insert(schema.venues).values([
      { id: venueId, name: "TEST ONLY subqueries", slug: venueId, address: "Disposable fixture" },
      { id: otherVenueId, name: "TEST ONLY subqueries elsewhere", slug: otherVenueId, address: "Disposable fixture" },
    ]);
    await db.insert(schema.spaces).values([
      { id: spaceId, venueId, name: "Grand Hall", slug: `grand-${spaceId}`, widthM: "10", lengthM: "10", heightM: "6", floorPlanOutline: outline },
      { id: otherSpaceId, venueId: otherVenueId, name: "Elsewhere", slug: `else-${otherSpaceId}`, widthM: "10", lengthM: "10", heightM: "6", floorPlanOutline: outline },
    ]);
    await db.insert(schema.users).values({ id: staffId, venueId, name: "Fiona", email: `${staffId}@subqueries.invalid`, role: "admin" });
  }, 60_000);

  afterAll(async () => { await server?.close(); await pool?.end(); });

  it("lists a room's reference loadouts with each one's own photo count and cover", async () => {
    const [full] = await db.insert(schema.referenceLoadouts).values({ venueId, spaceId, name: "Banquet", createdBy: staffId }).returning();
    await db.insert(schema.referenceLoadouts).values({ venueId, spaceId, name: "Empty", createdBy: staffId });
    if (full === undefined) throw new Error("Loadout fixture missing");
    const keys = [`loadouts/${randomUUID()}/second.jpg`, `loadouts/${randomUUID()}/cover.jpg`];
    const stored = await db.insert(schema.files).values(keys.map((fileKey) => ({
      fileKey, filename: "photo.jpg", contentType: "image/jpeg", context: "loadout", contextId: full.id, uploadedBy: staffId,
    }))).returning({ id: schema.files.id, fileKey: schema.files.fileKey });
    // The cover is the photo shown first, whichever was uploaded first.
    await db.insert(schema.referencePhotos).values(stored.map((file) => ({
      loadoutId: full.id, fileId: file.id, sortOrder: file.fileKey.endsWith("cover.jpg") ? 0 : 1,
    })));

    const response = await server.inject({ method: "GET", url: `/venues/${venueId}/spaces/${spaceId}/loadouts` });
    expect(response.statusCode, response.body).toBe(200);
    const rows = response.json<{ data: { name: string; photoCount: number; coverFileKey: string | null }[] }>().data;
    expect(rows.map(({ name, photoCount, coverFileKey }) => ({ name, photoCount, coverFileKey }))).toEqual([
      { name: "Banquet", photoCount: 2, coverFileKey: keys[1] },
      { name: "Empty", photoCount: 0, coverFileKey: null },
    ]);
  });

  it("counts each person's own layouts and enquiries in the client search: this venue's for its staff, every venue's for a platform admin", async () => {
    const person = await client();
    await layout(person.id, venueId, spaceId, 0);
    await layout(person.id, venueId, spaceId, 0);
    await layout(person.id, otherVenueId, otherSpaceId, 0);
    await db.insert(schema.enquiries).values([
      { venueId, spaceId, userId: person.id, name: person.name, email: person.email },
      { venueId: otherVenueId, spaceId: otherSpaceId, userId: person.id, name: person.name, email: person.email },
    ]);

    type Found = { users: { id: string; configurationCount: number; enquiryCount: number }[] };
    const here = await get<Found>(`/clients/search?q=${encodeURIComponent(person.name)}`);
    expect(here.users.find((row) => row.id === person.id)).toMatchObject({ configurationCount: 2, enquiryCount: 1 });
    const everywhere = await get<Found>(`/clients/search?q=${encodeURIComponent(person.name)}`, platformAdmin);
    expect(everywhere.users.find((row) => row.id === person.id)).toMatchObject({ configurationCount: 3, enquiryCount: 2 });
  });

  it("counts each guest lead's own enquiries, not enquiries whose two emails agree", async () => {
    const leadEmail = `rhona-${randomUUID()}@subqueries.invalid`;
    await db.insert(schema.guestLeads).values({ email: leadEmail, name: "Rhona Muir" });
    const planner = `planner-${randomUUID()}@subqueries.invalid`;
    const same = `same-${randomUUID()}@subqueries.invalid`;
    await db.insert(schema.enquiries).values([
      { venueId, spaceId, name: "Rhona Muir", email: planner, guestEmail: leadEmail },
      { venueId, spaceId, name: "Rhona Muir", email: planner, guestEmail: leadEmail },
      // Someone else's, whose own two addresses are the same: never this lead's.
      { venueId, spaceId, name: "Same both", email: same, guestEmail: same },
      { venueId: otherVenueId, spaceId: otherSpaceId, name: "Rhona Muir", email: leadEmail, guestEmail: leadEmail },
    ]);

    type Found = { guestLeads: { email: string; enquiryCount: number }[] };
    const here = await get<Found>(`/clients/search?q=${encodeURIComponent(leadEmail)}`);
    expect(here.guestLeads.find((row) => row.email === leadEmail)?.enquiryCount).toBe(2);
    const everywhere = await get<Found>(`/clients/search?q=${encodeURIComponent(leadEmail)}`, platformAdmin);
    expect(everywhere.guestLeads.find((row) => row.email === leadEmail)?.enquiryCount).toBe(3);
  });

  it("names each found layout's room and the person it belongs to", async () => {
    const person = await client();
    const name = `Winter ball ${randomUUID().slice(0, 8)}`;
    const id = await layout(person.id, venueId, spaceId, 0, name);
    const found = await get<{ configurations: { id: string; spaceName: string | null; userName: string | null }[] }>(
      `/clients/search?q=${encodeURIComponent(name)}`);
    expect(found.configurations.find((row) => row.id === id)).toMatchObject({ spaceName: "Grand Hall", userName: person.name });
  });

  it("shows each of a client's layouts on their profile with its own number of pieces, and each enquiry's room", async () => {
    const person = await client();
    const three = await layout(person.id, venueId, spaceId, 3);
    const none = await layout(person.id, venueId, spaceId, 0);
    await db.insert(schema.enquiries).values({ venueId, spaceId, userId: person.id, name: person.name, email: person.email });

    const profile = await get<{
      configurations: { id: string; spaceName: string; objectCount: number }[];
      enquiries: { spaceName: string }[];
    }>(`/clients/${person.id}/profile`);
    expect(profile.configurations.map(({ id, spaceName, objectCount }) => ({ id, spaceName, objectCount })).sort((a, b) => b.objectCount - a.objectCount))
      .toEqual([{ id: three, spaceName: "Grand Hall", objectCount: 3 }, { id: none, spaceName: "Grand Hall", objectCount: 0 }]);
    expect(profile.enquiries.map((row) => row.spaceName)).toEqual(["Grand Hall"]);
  });

  it("opens a guest lead's profile only at a venue it enquired of, naming each enquiry's room", async () => {
    const leadEmail = `morag-${randomUUID()}@subqueries.invalid`;
    const [lead] = await db.insert(schema.guestLeads).values({ email: leadEmail, name: "Morag Bell" }).returning();
    const elsewhereEmail = `iain-${randomUUID()}@subqueries.invalid`;
    const [elsewhere] = await db.insert(schema.guestLeads).values({ email: elsewhereEmail, name: "Iain Ross" }).returning();
    if (lead === undefined || elsewhere === undefined) throw new Error("Lead fixtures missing");
    await db.insert(schema.enquiries).values([
      { venueId, spaceId, name: "Morag Bell", email: leadEmail, guestEmail: leadEmail },
      { venueId: otherVenueId, spaceId: otherSpaceId, name: "Iain Ross", email: elsewhereEmail, guestEmail: elsewhereEmail },
    ]);

    const profile = await get<{ lead: { id: string }; enquiries: { spaceName: string }[] }>(`/clients/leads/${lead.id}/profile`);
    expect(profile.lead.id).toBe(lead.id);
    expect(profile.enquiries.map((row) => row.spaceName)).toEqual(["Grand Hall"]);
    const refused = await server.inject({ method: "GET", url: `/clients/leads/${elsewhere.id}/profile`, headers: bearer(staff) });
    expect(refused.statusCode).toBe(404);
  });

  it("names the deal each of today's follow-ups is for", async () => {
    const [deal] = await db.insert(schema.opportunities).values({ venueId, title: "Kerr wedding, 12 June" }).returning();
    if (deal === undefined) throw new Error("Opportunity fixture missing");
    const title = `Send the revised menu ${randomUUID().slice(0, 8)}`;
    await db.insert(schema.followUpTasks).values({ opportunityId: deal.id, title, dueAt: new Date() });

    const pipeline = await get<{ todayTasks: { title: string; opportunityTitle: string | null }[] }>("/crm/pipeline");
    expect(pipeline.todayTasks.find((row) => row.title === title)?.opportunityTitle).toBe("Kerr wedding, 12 June");
  });
});
