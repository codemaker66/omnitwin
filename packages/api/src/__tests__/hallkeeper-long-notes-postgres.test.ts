import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { Pool as PgPool } from "pg";
import { drizzle as nodeDrizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { HallkeeperSheetV2Schema, type HallkeeperSheetV2 } from "@omnitwin/types";
import { createDbConnection, type Database, type DatabaseConnection } from "../db/client.js";
import * as schema from "../db/schema.js";
import { configurationReviewRoutes } from "../routes/configuration-reviews.js";
import { configurationRoutes } from "../routes/configurations.js";
import { hallkeeperSheetRoutes } from "../routes/hallkeeper-sheet.js";
import { bodyText } from "./helpers/sheet-paper-reading.js";

// ---------------------------------------------------------------------------
// Audit hallkeeper-ops-5 / types-contracts-1: a setup row carries every
// distinct note of the pieces it gathers ("6ft Round Table" x 8, and the
// linen each of them takes). Each planner note may run to 500 characters, so
// a detailed wedding's row runs well past 2,000. The sheet must still load,
// the layout must still go to the venue, and every note must arrive whole.
//
// What a mock cannot prove: the jsonb round trip of the frozen sheet and the
// strict re-read createSnapshot makes of the row it has just inserted.
//
// Never reads DATABASE_URL/.env. Opt in with the disposable local database
// CI creates for the sheet's access tests (API test files run one at a time):
//   VENVIEWER_SHEET_ACCESS_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<port>/venviewer_sheet_access_test
// ---------------------------------------------------------------------------

const email = vi.hoisted(() => vi.fn());
vi.mock("../services/email.js", () => ({ sendEmailAsync: email }));

process.env["NODE_ENV"] = "test";
const explicitUrl = process.env["VENVIEWER_SHEET_ACCESS_TEST_DATABASE_URL"];

function assertTestTarget(raw: string): void {
  const url = new URL(raw);
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1"
    || url.pathname !== "/venviewer_sheet_access_test" || url.search !== "" || url.hash !== "") {
    throw new Error("Long-note sheet tests require the explicit loopback venviewer_sheet_access_test database");
  }
}

describe("Long-note sheet PostgreSQL target guard", () => {
  it.each([
    "postgresql://user@production.example/venviewer_sheet_access_test",
    "postgresql://postgres@127.0.0.1/production",
    "postgresql://postgres@127.0.0.1/venviewer_sheet_access_test?host=production.example",
  ])("rejects an unsafe target: %s", (url) => {
    expect(() => { assertTestTarget(url); }).toThrow();
  });
});

/** Eight tables' notes, each just under the planner's 500-character limit. */
const TABLE_NOTES: readonly string[] = Array.from({ length: 8 }, (_, index) => {
  const opening = `Table ${String(index + 1)}: the bride's family; one high chair; two nut-free and one gluten-free meal. `;
  const body = (opening + "Seat the elderly guests nearest the aisle, with clear passage to the doors. ".repeat(8)).slice(0, 460).trim();
  return `${body} Last words for table ${String(index + 1)}.`;
});

/** The row's notes as the sheet's readers take them apart (sheet-brief NOTE_SEPARATOR). */
function notesOf(rows: readonly HallkeeperSheetV2["phases"][number]["zones"][number]["rows"][number][]): string[] {
  return rows.flatMap((row) => row.notes.split(" · ").map((part) => part.trim()).filter((part) => part.length > 0));
}

function rowsNamed(sheet: HallkeeperSheetV2, name: string) {
  return sheet.phases.flatMap((phase) => phase.zones.flatMap((zone) => zone.rows)).filter((row) => row.name === name);
}

describe.skipIf(explicitUrl === undefined)("a setup row whose pieces' notes run past 2,000 characters, on PostgreSQL", () => {
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
    await server.register(configurationReviewRoutes, { db, prefix: "/configurations" });
    await server.register(hallkeeperSheetRoutes, { db, prefix: "/hallkeeper" });
    await server.ready();
  }, 120000);

  afterAll(async () => {
    await server.close();
    await connection?.close();
    await migrationPool?.end();
  });

  /** A wedding of eight round tables in one part of the room, each with its own note, and the linen they take. */
  async function wedding() {
    const venueId = randomUUID(); const roomId = randomUUID(); const configId = randomUUID();
    const plannerId = randomUUID(); const tableId = randomUUID();
    const tableName = `TEST ONLY round table ${tableId}`;
    await db.insert(schema.venues).values({ id: venueId, name: "DEMO ONLY venue", slug: venueId, address: "Local test" });
    await db.insert(schema.spaces).values({
      id: roomId, venueId, name: "DEMO ONLY hall", slug: `room-${roomId}`, widthM: "21", lengthM: "10.5", heightM: "7",
      floorPlanOutline: [{ x: -10.5, y: -5.25 }, { x: 10.5, y: -5.25 }, { x: 10.5, y: 5.25 }, { x: -10.5, y: 5.25 }],
    });
    await db.insert(schema.users).values({ id: plannerId, venueId, email: `${plannerId}@demo.invalid`, name: "DEMO ONLY planner", role: "admin" });
    await db.insert(schema.configurations).values({
      id: configId, venueId, spaceId: roomId, userId: plannerId, name: "DEMO ONLY wedding", slug: `plan-${configId}`,
      layoutStyle: "dinner-rounds", guestCount: 80,
    });
    await db.insert(schema.assetDefinitions).values({ id: tableId, name: tableName, category: "table", widthM: "1.8", depthM: "1.8", heightM: "0.75", collisionType: "box" });
    await db.insert(schema.assetAccessories).values({ parentAssetId: tableId, name: `TEST ONLY linen ${tableId}`, category: "decor", quantityPerParent: 1, phase: "dress", afterDepth: 1 });
    await db.insert(schema.placedObjects).values(TABLE_NOTES.map((notes, index) => ({
      configurationId: configId, assetDefinitionId: tableId,
      positionX: (index * 0.1).toFixed(3), positionY: "0", positionZ: "0",
      metadata: { notes, displayLabel: `Table ${String(index + 1)}` }, coordinateWriteToken: randomUUID(),
    })));
    const headers = { authorization: `Bearer ${JSON.stringify({ id: plannerId, email: `${plannerId}@demo.invalid`, role: "admin", venueId })}` };
    return { configId, tableName, linenName: `TEST ONLY linen ${tableId}`, headers };
  }

  it("serves the live sheet whole, and the browser's own contract reads it", async () => {
    const layout = await wedding();
    const response = await server.inject({ method: "GET", url: `/hallkeeper/${layout.configId}/v2`, headers: layout.headers });
    expect(response.statusCode).toBe(200);
    // HallkeeperPage parses the response with this schema; a refusal here is the page's error screen.
    const parsed = HallkeeperSheetV2Schema.safeParse(response.json<{ data: unknown }>().data);
    expect(parsed.error?.issues ?? []).toEqual([]);
    if (!parsed.success) return;
    const tables = rowsNamed(parsed.data, layout.tableName);
    expect(tables.map((row) => row.notes.length).reduce((sum, length) => sum + length, 0)).toBeGreaterThan(2000);
    expect(notesOf(tables).sort()).toEqual([...TABLE_NOTES].sort());
    expect(notesOf(rowsNamed(parsed.data, layout.linenName)).sort()).toEqual([...TABLE_NOTES].sort());

    // The paper prints every note in full: each ends with words only its tail holds.
    const paper = await server.inject({ method: "GET", url: `/hallkeeper/${layout.configId}/sheet`, headers: layout.headers });
    expect(paper.statusCode).toBe(200);
    const text = bodyText(paper.rawPayload);
    for (const note of TABLE_NOTES) {
      expect(text).toContain(note.slice(0, 30));
      expect(text).toContain(note.slice(-24));
    }
  });

  it("goes to the venue for review, and the frozen sheet keeps every note whole", async () => {
    const layout = await wedding();
    const submitted = await server.inject({ method: "POST", url: `/configurations/${layout.configId}/review/submit`, headers: layout.headers, payload: {} });
    expect(submitted.statusCode).toBe(200);
    const [snapshot] = await db.select().from(schema.configurationSheetSnapshots)
      .where(eq(schema.configurationSheetSnapshots.configurationId, layout.configId));
    const frozen = HallkeeperSheetV2Schema.parse(snapshot?.payload);
    expect(notesOf(rowsNamed(frozen, layout.tableName)).sort()).toEqual([...TABLE_NOTES].sort());
    expect(notesOf(rowsNamed(frozen, layout.linenName)).sort()).toEqual([...TABLE_NOTES].sort());
    const [config] = await db.select({ reviewStatus: schema.configurations.reviewStatus }).from(schema.configurations)
      .where(eq(schema.configurations.id, layout.configId));
    expect(config?.reviewStatus).toBe("submitted");
  });
});
