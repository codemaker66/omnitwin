import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { Pool as PgPool } from "pg";
import { drizzle as nodeDrizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { ConfigurationMetadataSchema, HallkeeperSheetV2Schema, type ProtectedPremises } from "@omnitwin/types";
import { createDbConnection, type Database, type DatabaseConnection } from "../db/client.js";
import * as schema from "../db/schema.js";
import { configurationRoutes } from "../routes/configurations.js";
import { hallkeeperSheetRoutes } from "../routes/hallkeeper-sheet.js";

// ---------------------------------------------------------------------------
// T-648 Martyn's Law readiness through the real routes and PostgreSQL.
//
// What a mock cannot prove: that the PATCH stores the block in the JSONB
// column, that the live sheet hands it back from that column (which is read
// without parsing), and that the venue boundary holds on both the write and
// the read. Permissions are the existing configuration gates; these tests
// prove they cover the new field.
//
// Never reads DATABASE_URL/.env. Opt in with a separately provisioned,
// disposable local database:
//   VENVIEWER_SHEET_ACCESS_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<port>/venviewer_sheet_access_test
// ---------------------------------------------------------------------------

process.env["NODE_ENV"] = "test";
const explicitUrl = process.env["VENVIEWER_SHEET_ACCESS_TEST_DATABASE_URL"];

function assertTestTarget(raw: string): void {
  const url = new URL(raw);
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1"
    || url.pathname !== "/venviewer_sheet_access_test" || url.search !== "" || url.hash !== "") {
    throw new Error("Sheet access regressions require the explicit loopback venviewer_sheet_access_test database");
  }
}

describe("Sheet access PostgreSQL target guard", () => {
  it.each([
    "postgresql://user@production.example/venviewer_sheet_access_test",
    "postgresql://postgres@127.0.0.1/production",
    "postgresql://postgres@127.0.0.1/venviewer_sheet_access_test?host=production.example",
  ])("rejects an unsafe target: %s", (url) => {
    expect(() => { assertTestTarget(url); }).toThrow();
  });
});

const RECORD: ProtectedPremises = {
  responsiblePerson: "DEMO ONLY venue operator",
  dutyLead: { name: "DEMO ONLY lead", role: "Duty manager" },
  procedures: { evacuation: { briefed: true, note: "DEMO ONLY plan v3" }, lockdown: { briefed: false } },
  briefingAt: "2026-06-15T16:30:00.000Z",
  doorSupervision: { arranged: true },
};

interface Actor { readonly id: string; readonly venueId: string; readonly role: string }

function bearer(actor: Actor): Record<string, string> {
  return { authorization: `Bearer ${JSON.stringify({ id: actor.id, email: `${actor.id}@demo.invalid`, name: "DEMO ONLY", role: actor.role, venueId: actor.venueId })}` };
}

describe.skipIf(explicitUrl === undefined)("Martyn's Law readiness through the configuration and sheet routes", () => {
  let connection: DatabaseConnection | undefined;
  let migrationPool: PgPool | undefined;
  let db: Database;
  let server: FastifyInstance;

  beforeAll(async () => {
    if (explicitUrl === undefined) throw new Error("Explicit test URL required");
    assertTestTarget(explicitUrl);
    migrationPool = new PgPool({ connectionString: explicitUrl });
    const target = await migrationPool.query<{ database: string }>("SELECT current_database() AS database");
    expect(target.rows[0]?.database).toBe("venviewer_sheet_access_test");
    await migrate(nodeDrizzle(migrationPool), { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
    connection = createDbConnection(explicitUrl);
    db = connection.db;
    server = Fastify();
    await server.register(configurationRoutes, { db, prefix: "/configurations" });
    await server.register(hallkeeperSheetRoutes, { db, prefix: "/hallkeeper" });
    await server.ready();
  }, 120000);

  afterAll(async () => { await server.close(); await connection?.close(); await migrationPool?.end(); });

  /** Two venues; a layout in the first, owned by its admin. */
  async function seed(metadata: unknown = null): Promise<{ configId: string; home: Actor; homeKeeper: Actor; foreign: Actor }> {
    const venueId = randomUUID(); const otherVenueId = randomUUID();
    const roomId = randomUUID(); const configId = randomUUID();
    const home: Actor = { id: randomUUID(), venueId, role: "admin" };
    const homeKeeper: Actor = { id: randomUUID(), venueId, role: "hallkeeper" };
    const foreign: Actor = { id: randomUUID(), venueId: otherVenueId, role: "admin" };
    await db.insert(schema.venues).values([
      { id: venueId, name: "DEMO ONLY venue", slug: venueId, address: "Local test" },
      { id: otherVenueId, name: "DEMO ONLY other venue", slug: otherVenueId, address: "Local test" },
    ]);
    await db.insert(schema.spaces).values({
      id: roomId, venueId, name: "Test room", slug: `room-${roomId}`,
      widthM: "10", lengthM: "10", heightM: "3",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
    });
    await db.insert(schema.users).values([home, homeKeeper, foreign].map((actor) => ({
      id: actor.id, venueId: actor.venueId, email: `${actor.id}@demo.invalid`, name: "DEMO ONLY", role: actor.role,
    })));
    await db.insert(schema.configurations).values({
      id: configId, venueId, spaceId: roomId, userId: home.id,
      name: "DEMO ONLY plan", layoutStyle: "custom", slug: `plan-${configId}`, guestCount: 240,
      metadata,
    });
    return { configId, home, homeKeeper, foreign };
  }

  async function storedMetadata(configId: string): Promise<unknown> {
    const [row] = await db.select({ metadata: schema.configurations.metadata })
      .from(schema.configurations).where(eq(schema.configurations.id, configId));
    return row?.metadata ?? null;
  }

  it("stores the venue's entries and hands them back on the live sheet", async () => {
    const { configId, home, homeKeeper } = await seed();
    const saved = await server.inject({
      method: "PATCH", url: `/configurations/${configId}`, headers: bearer(home),
      payload: { metadata: { instructions: { specialInstructions: "DEMO ONLY note", protectedPremises: RECORD } } },
    });
    expect(saved.statusCode).toBe(200);
    expect(await storedMetadata(configId)).toMatchObject({ instructions: { protectedPremises: RECORD } });

    const sheet = await server.inject({ method: "GET", url: `/hallkeeper/${configId}/v2`, headers: bearer(homeKeeper) });
    expect(sheet.statusCode).toBe(200);
    const payload = HallkeeperSheetV2Schema.parse((JSON.parse(sheet.body) as { data: unknown }).data);
    expect(payload.instructions?.protectedPremises).toEqual(RECORD);
    expect(payload.config.guestCount).toBe(240);
  });

  it("keeps a block holding only Martyn's Law entries on the live sheet", async () => {
    // Stored exactly as the PATCH stores it: parsed, every other block empty.
    // hasInstructionContent must count the entries, or the live sheet drops them.
    const stored = ConfigurationMetadataSchema.parse({ instructions: { protectedPremises: { dutyLead: { name: "DEMO ONLY lead" } } } });
    const { configId, homeKeeper } = await seed(stored);
    const sheet = await server.inject({ method: "GET", url: `/hallkeeper/${configId}/v2`, headers: bearer(homeKeeper) });
    expect(sheet.statusCode).toBe(200);
    const payload = HallkeeperSheetV2Schema.parse((JSON.parse(sheet.body) as { data: unknown }).data);
    expect(payload.instructions?.protectedPremises).toEqual({ dutyLead: { name: "DEMO ONLY lead" } });
  });

  it("serves a layout saved before the field existed with no key, and prints the section", async () => {
    const legacy = { instructions: { specialInstructions: "DEMO ONLY note", dayOfContact: null, phaseDeadlines: [], accessNotes: "", accessibility: null, dietary: null, doorSchedule: null } };
    const { configId, homeKeeper } = await seed(legacy);
    const sheet = await server.inject({ method: "GET", url: `/hallkeeper/${configId}/v2`, headers: bearer(homeKeeper) });
    expect(sheet.statusCode).toBe(200);
    const payload = HallkeeperSheetV2Schema.parse((JSON.parse(sheet.body) as { data: unknown }).data);
    expect(payload.instructions?.specialInstructions).toBe("DEMO ONLY note");
    expect(payload.instructions !== null && "protectedPremises" in payload.instructions).toBe(false);

    const pdf = await server.inject({ method: "GET", url: `/hallkeeper/${configId}/sheet?download=true`, headers: bearer(homeKeeper) });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    // The first PDF in a process loads pdfkit and its fonts lazily; on a
    // loaded Windows workstation that alone measured 25–60 s.
  }, 120000);

  it("rejects a malformed block and leaves the stored record untouched", async () => {
    const { configId, home } = await seed({ instructions: { protectedPremises: RECORD } });
    const rejected = await server.inject({
      method: "PATCH", url: `/configurations/${configId}`, headers: bearer(home),
      payload: { metadata: { instructions: { protectedPremises: { briefingAt: "tonight", procedures: { evacuation: { briefed: "yes" } } } } } },
    });
    expect(rejected.statusCode).toBe(400);
    expect(await storedMetadata(configId)).toMatchObject({ instructions: { protectedPremises: RECORD } });
  });

  it("refuses another venue's admin both the write and the read", async () => {
    const { configId, foreign } = await seed({ instructions: { protectedPremises: RECORD } });

    const write = await server.inject({
      method: "PATCH", url: `/configurations/${configId}`, headers: bearer(foreign),
      payload: { metadata: { instructions: { protectedPremises: { responsiblePerson: "DEMO ONLY intruder" } } } },
    });
    expect(write.statusCode).toBe(403);
    expect(await storedMetadata(configId)).toMatchObject({ instructions: { protectedPremises: RECORD } });

    for (const url of [`/hallkeeper/${configId}/v2`, `/hallkeeper/${configId}/sheet?download=true`, `/configurations/${configId}`]) {
      const read = await server.inject({ method: "GET", url, headers: bearer(foreign) });
      expect(read.statusCode, url).toBe(403);
      expect(read.body, url).not.toContain("DEMO ONLY lead");
      expect(read.body, url).not.toContain("DEMO ONLY plan v3");
    }
  });

  it("refuses a hallkeeper from another venue the sheet", async () => {
    const { configId, foreign } = await seed({ instructions: { protectedPremises: RECORD } });
    const keeper: Actor = { ...foreign, id: randomUUID(), role: "hallkeeper" };
    const read = await server.inject({ method: "GET", url: `/hallkeeper/${configId}/v2`, headers: bearer(keeper) });
    expect(read.statusCode).toBe(403);
    expect(read.body).not.toContain("DEMO ONLY lead");
  });
});
