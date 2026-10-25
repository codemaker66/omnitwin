import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool as PgPool } from "pg";
import { drizzle as nodeDrizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDbConnection, type Database, type DatabaseConnection } from "../db/client.js";
import * as schema from "../db/schema.js";
import { referenceLoadoutRoutes } from "../routes/reference-loadouts.js";
import { clientRoutes } from "../routes/clients.js";

// ---------------------------------------------------------------------------
// Counts and covers read by a subquery inside a single-table select
// (Sentry VENVIEWER-API-1).
//
// drizzle drops the table name from every column inside a `sql` field when
// the select has no joins (pg-core dialect, buildSelection's isSingleTable).
// So `${referenceLoadouts.id}` inside `(SELECT … FROM reference_photos …)`
// reached PostgreSQL as a bare "id", and PostgreSQL binds a bare name to the
// innermost table that has it: an error where two inner tables do (the
// loadout list's 500), a silently wrong number where one does (every count
// below read 0, or counted the wrong rows). Only real PostgreSQL resolves
// names, so these run on a migrated disposable database.
//
// Never reads DATABASE_URL/.env. Opt in with a separately provisioned,
// disposable local database:
//   VENVIEWER_SUBQUERY_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55476/venviewer_subquery_test
// ---------------------------------------------------------------------------

// The client routes authenticate with the test-mode bearer.
process.env["NODE_ENV"] = "test";
const explicitUrl = process.env["VENVIEWER_SUBQUERY_TEST_DATABASE_URL"];

function assertTestTarget(raw: string): void {
  const url = new URL(raw);
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1"
    || url.pathname !== "/venviewer_subquery_test" || url.search !== "" || url.hash !== "") {
    throw new Error("Subquery regressions require the explicit loopback venviewer_subquery_test database");
  }
}

describe("Subquery PostgreSQL target guard", () => {
  it.each([
    "postgresql://user@production.example/venviewer_subquery_test",
    "postgresql://postgres@127.0.0.1/production",
    "postgresql://postgres@127.0.0.1/venviewer_subquery_test?host=production.example",
  ])("rejects an unsafe target: %s", (url) => {
    expect(() => { assertTestTarget(url); }).toThrow();
  });
});

interface LoadoutRow { readonly id: string; readonly photoCount: number; readonly coverFileKey: string | null }
interface FoundUser { readonly id: string; readonly configurationCount: number; readonly enquiryCount: number }
interface FoundLead { readonly id: string; readonly enquiryCount: number }

describe.skipIf(explicitUrl === undefined)("subqueries in single-table selects on PostgreSQL", () => {
  let connection: DatabaseConnection | undefined;
  let migrationPool: PgPool | undefined;
  let db: Database;
  let server: FastifyInstance;

  // A fresh venue per run: the database is kept between runs, so every
  // assertion reads only this run's rows.
  const run = randomUUID().slice(0, 8);
  const venueId = randomUUID();
  const otherVenueId = randomUUID();
  const spaceId = randomUUID();
  const otherSpaceId = randomUUID();
  const staffId = randomUUID();
  const clientId = randomUUID();
  const clientEmail = `ishbel-${run}@subquery.invalid`;
  const leadEmail = `morven-${run}@subquery.invalid`;
  const litLoadoutId = randomUUID();
  const bareLoadoutId = randomUUID();
  const coverKey = `loadouts/${run}/cover.jpg`;
  let leadId = "";
  let configurationId = "";

  function bearer(role: string, venue: string | null, platformRole: "none" | "admin" = "none"): { authorization: string } {
    return { authorization: `Bearer ${JSON.stringify({ id: staffId, email: "staff@subquery.invalid", role, platformRole, venueId: venue })}` };
  }

  async function search(q: string, headers: { authorization: string }): Promise<{ users: FoundUser[]; guestLeads: FoundLead[] }> {
    const response = await server.inject({ method: "GET", url: `/clients/search?q=${encodeURIComponent(q)}`, headers });
    expect(response.statusCode).toBe(200);
    return response.json<{ data: { users: FoundUser[]; guestLeads: FoundLead[] } }>().data;
  }

  beforeAll(async () => {
    if (explicitUrl === undefined) throw new Error("Explicit test URL required");
    assertTestTarget(explicitUrl);
    migrationPool = new PgPool({ connectionString: explicitUrl });
    const target = await migrationPool.query<{ database: string }>("SELECT current_database() AS database");
    expect(target.rows[0]?.database).toBe("venviewer_subquery_test");
    await migrate(nodeDrizzle(migrationPool), { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
    // The production client, on its loopback branch: the same drizzle
    // queries the API sends.
    connection = createDbConnection(explicitUrl);
    db = connection.db;

    await db.insert(schema.venues).values([
      { id: venueId, name: "Subquery venue", slug: `subquery-${run}`, address: "Test only" },
      { id: otherVenueId, name: "Another venue", slug: `subquery-other-${run}`, address: "Test only" },
    ]);
    const room = { widthM: "10", lengthM: "20", heightM: "6", floorPlanOutline: [] };
    await db.insert(schema.spaces).values([
      { id: spaceId, venueId, name: "Hall", slug: "hall", ...room },
      { id: otherSpaceId, venueId: otherVenueId, name: "Elsewhere", slug: "elsewhere", ...room },
    ]);
    await db.insert(schema.users).values([
      { id: staffId, email: `staff-${run}@subquery.invalid`, name: "Staff", role: "staff", venueId },
      { id: clientId, email: clientEmail, name: `Ishbel Fraser ${run}`, role: "client", venueId: null },
    ]);

    // Two loadouts: one with photos out of order, one with none.
    await db.insert(schema.referenceLoadouts).values([
      { id: litLoadoutId, venueId, spaceId, name: "Dinner, 180", createdBy: staffId },
      { id: bareLoadoutId, venueId, spaceId, name: "Theatre, 300", createdBy: staffId },
    ]);
    const photoFile = (fileKey: string): typeof schema.files.$inferInsert => ({
      fileKey, filename: "photo.jpg", contentType: "image/jpeg", contentLengthBytes: 1,
      context: "reference_loadout", contextId: litLoadoutId, uploadedBy: staffId,
    });
    const [later, cover] = await db.insert(schema.files).values([
      photoFile(`loadouts/${run}/later.jpg`), photoFile(coverKey),
    ]).returning();
    if (later === undefined || cover === undefined) throw new Error("File insert returned no row");
    await db.insert(schema.referencePhotos).values([
      { loadoutId: litLoadoutId, fileId: later.id, sortOrder: 2 },
      { loadoutId: litLoadoutId, fileId: cover.id, sortOrder: 1 },
    ]);

    // The client: one live layout here with three pieces, a deleted one
    // here, one at another venue; two enquiries here, one elsewhere.
    const layout = { userId: clientId, layoutStyle: "dinner-rounds" };
    const [kept] = await db.insert(schema.configurations).values([
      { venueId, spaceId, name: "Kept", ...layout },
      { venueId, spaceId, name: "Deleted", deletedAt: new Date(), ...layout },
      { venueId: otherVenueId, spaceId: otherSpaceId, name: "Elsewhere", ...layout },
    ]).returning();
    if (kept === undefined) throw new Error("Configuration insert returned no row");
    configurationId = kept.id;
    const assetId = randomUUID();
    await db.insert(schema.assetDefinitions).values({
      id: assetId, name: `TEST ONLY chair ${run}`, category: "chair", widthM: "0.5", depthM: "0.5", heightM: "0.9",
    });
    await db.insert(schema.placedObjects).values([0, 1, 2].map((sortOrder) => ({
      configurationId, assetDefinitionId: assetId, positionX: String(sortOrder), positionY: "0", positionZ: "0",
      sortOrder, coordinateWriteToken: randomUUID(),
    })));
    const enquiry = { spaceId, name: "Ishbel Fraser", email: clientEmail };
    await db.insert(schema.enquiries).values([
      { venueId, userId: clientId, ...enquiry },
      { venueId, userId: clientId, ...enquiry },
      { venueId: otherVenueId, userId: clientId, ...enquiry, spaceId: otherSpaceId },
    ]);

    // A guest lead: two enquiries here under its guest email, one elsewhere.
    // Each enquiry's own email differs from the guest email, as when someone
    // enquires for another person.
    const [lead] = await db.insert(schema.guestLeads).values({ email: leadEmail, name: `Morven Guest ${run}` }).returning();
    if (lead === undefined) throw new Error("Lead insert returned no row");
    leadId = lead.id;
    const forLead = { spaceId, name: "Morven Guest", email: `assistant-${run}@subquery.invalid`, guestEmail: leadEmail };
    await db.insert(schema.enquiries).values([
      { venueId, ...forLead },
      { venueId, ...forLead },
      { venueId: otherVenueId, ...forLead, spaceId: otherSpaceId },
    ]);

    server = Fastify();
    await server.register(referenceLoadoutRoutes, { db, prefix: "/venues/:venueId/spaces/:spaceId/loadouts" });
    await server.register(clientRoutes, { db, prefix: "/clients" });
    await server.ready();
  }, 120000);

  afterAll(async () => {
    await server.close();
    await connection?.close();
    await migrationPool?.end();
  });

  it("lists a space's loadouts with each one's photo count and first photo (VENVIEWER-API-1)", async () => {
    const response = await server.inject({ method: "GET", url: `/venues/${venueId}/spaces/${spaceId}/loadouts` });
    expect(response.statusCode).toBe(200);
    const rows = response.json<{ data: LoadoutRow[] }>().data;
    expect(rows.map((row) => [row.id, row.photoCount, row.coverFileKey])).toEqual([
      [litLoadoutId, 2, coverKey],
      [bareLoadoutId, 0, null],
    ]);
  });

  it("counts the pieces in each layout on a client's profile", async () => {
    const response = await server.inject({ method: "GET", url: `/clients/${clientId}/profile`, headers: bearer("staff", venueId) });
    expect(response.statusCode).toBe(200);
    const { configurations } = response.json<{ data: { configurations: { id: string; objectCount: number }[] } }>().data;
    expect(configurations.map((layout) => [layout.id, layout.objectCount])).toEqual([[configurationId, 3]]);
  });

  it("counts a client's layouts and enquiries at the searcher's venue", async () => {
    const found = (await search(clientEmail, bearer("staff", venueId))).users.find((user) => user.id === clientId);
    expect(found).toMatchObject({ configurationCount: 1, enquiryCount: 2 });
  });

  it("counts a client's layouts and enquiries everywhere for a platform admin", async () => {
    const found = (await search(clientEmail, bearer("admin", null, "admin"))).users.find((user) => user.id === clientId);
    expect(found).toMatchObject({ configurationCount: 2, enquiryCount: 3 });
  });

  it("counts a guest lead's enquiries by its guest email, here and everywhere", async () => {
    const here = (await search(leadEmail, bearer("staff", venueId))).guestLeads.find((lead) => lead.id === leadId);
    expect(here?.enquiryCount).toBe(2);
    const everywhere = (await search(leadEmail, bearer("admin", null, "admin"))).guestLeads.find((lead) => lead.id === leadId);
    expect(everywhere?.enquiryCount).toBe(3);
  });
});
