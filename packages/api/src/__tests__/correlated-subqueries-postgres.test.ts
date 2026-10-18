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
// In a select from one table, Drizzle writes `${table.column}` inside the
// select list's own SQL as the bare column name. PostgreSQL resolves a bare
// name against the subquery's own table first, so `configuration_id = "id"`
// compared each placed object with itself (every layout read "0 pieces") and
// `rp.loadout_id = "id"` was ambiguous between the photo and its file, so
// every room's reference loadouts answered 500 (live on 18 October 2026).
// Only real rows show it: the mocked route tests never run the SQL.
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
  const clientId = randomUUID();
  const clientName = `Ishbel Kerr ${venueId.slice(0, 8)}`;
  const leadEmail = `rhona-${venueId}@subqueries.invalid`;

  function bearer(id: string, role: string, venue: string | null = venueId): { authorization: string } {
    return { authorization: `Bearer ${JSON.stringify({ id, email: `${id}@subqueries.invalid`, role, platformRole: "none", venueId: venue })}` };
  }

  async function layout(venue: string, space: string, pieces: number): Promise<string> {
    const [row] = await db.insert(schema.configurations).values({
      venueId: venue, spaceId: space, userId: clientId, name: `Layout with ${String(pieces)}`, layoutStyle: "custom",
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
    await db.insert(schema.users).values([
      { id: staffId, venueId, name: "Fiona", email: `${staffId}@subqueries.invalid`, role: "admin" },
      { id: clientId, venueId: null, name: clientName, email: `${clientId}@subqueries.invalid`, role: "client" },
    ]);
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

  it("counts each person's own layouts and enquiries at this venue in the client search", async () => {
    await layout(venueId, spaceId, 0);
    await layout(venueId, spaceId, 0);
    await layout(otherVenueId, otherSpaceId, 0);
    await db.insert(schema.enquiries).values({ venueId, spaceId, userId: clientId, name: clientName, email: `${clientId}@subqueries.invalid` });

    const response = await server.inject({ method: "GET", url: `/clients/search?q=${encodeURIComponent(clientName)}`, headers: bearer(staffId, "admin") });
    expect(response.statusCode, response.body).toBe(200);
    const found = response.json<{ data: { users: { id: string; configurationCount: number; enquiryCount: number }[] } }>().data.users;
    expect(found.find((row) => row.id === clientId)).toMatchObject({ configurationCount: 2, enquiryCount: 1 });
  });

  it("counts each guest lead's own enquiries at this venue, not enquiries whose two emails agree", async () => {
    await db.insert(schema.guestLeads).values({ email: leadEmail, name: `Rhona Muir ${venueId.slice(0, 8)}` });
    await db.insert(schema.enquiries).values([
      { venueId, spaceId, name: "Rhona Muir", email: `planner-${venueId}@subqueries.invalid`, guestEmail: leadEmail },
      { venueId, spaceId, name: "Rhona Muir", email: `planner-${venueId}@subqueries.invalid`, guestEmail: leadEmail },
      // Someone else's, whose own two addresses are the same: never this lead's.
      { venueId, spaceId, name: "Same both", email: `same-${venueId}@subqueries.invalid`, guestEmail: `same-${venueId}@subqueries.invalid` },
    ]);
    await db.insert(schema.enquiries).values({ venueId: otherVenueId, spaceId: otherSpaceId, name: "Rhona Muir", email: leadEmail, guestEmail: leadEmail });

    const response = await server.inject({ method: "GET", url: `/clients/search?q=${encodeURIComponent(leadEmail)}`, headers: bearer(staffId, "admin") });
    expect(response.statusCode, response.body).toBe(200);
    const leads = response.json<{ data: { guestLeads: { email: string; enquiryCount: number }[] } }>().data.guestLeads;
    expect(leads.find((row) => row.email === leadEmail)?.enquiryCount).toBe(2);
  });

  it("shows each of a client's layouts on their profile with its own number of pieces", async () => {
    const three = await layout(venueId, spaceId, 3);
    const response = await server.inject({ method: "GET", url: `/clients/${clientId}/profile`, headers: bearer(staffId, "admin") });
    expect(response.statusCode, response.body).toBe(200);
    const layouts = response.json<{ data: { configurations: { id: string; spaceName: string; objectCount: number }[] } }>().data.configurations;
    expect(layouts.find((row) => row.id === three)).toMatchObject({ spaceName: "Grand Hall", objectCount: 3 });
    expect(layouts.filter((row) => row.id !== three).map((row) => row.objectCount)).toEqual([0, 0]);
  });

  it("names the deal each of today's follow-ups is for", async () => {
    const [deal] = await db.insert(schema.opportunities).values({ venueId, title: "Kerr wedding, 12 June" }).returning();
    if (deal === undefined) throw new Error("Opportunity fixture missing");
    await db.insert(schema.followUpTasks).values({ opportunityId: deal.id, title: "Send the revised menu", dueAt: new Date() });

    const response = await server.inject({ method: "GET", url: "/crm/pipeline", headers: bearer(staffId, "admin") });
    expect(response.statusCode, response.body).toBe(200);
    const tasks = response.json<{ data: { todayTasks: { title: string; opportunityTitle: string | null }[] } }>().data.todayTasks;
    expect(tasks.find((row) => row.title === "Send the revised menu")?.opportunityTitle).toBe("Kerr wedding, 12 June");
  });
});
