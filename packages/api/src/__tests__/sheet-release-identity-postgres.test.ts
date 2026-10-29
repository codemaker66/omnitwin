import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { Pool as PgPool } from "pg";
import { drizzle as nodeDrizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { HallkeeperSheetV2Schema, paperFingerprint, type HallkeeperSheetV2 } from "@omnitwin/types";
import { createDbConnection, type Database, type DatabaseConnection } from "../db/client.js";
import * as schema from "../db/schema.js";
import { hallkeeperSheetRoutes } from "../routes/hallkeeper-sheet.js";
import { publicSheetCheckRoutes } from "../routes/public-sheet-check.js";
import { resolveSheetPaperCheck } from "../services/sheet-paper-check.js";
import { weddingSheet } from "./fixtures/hallkeeper-sheet-fixtures.js";
import { bodyText, encodes, printedLink, printedQr, queryOf, releaseLine, roomDisagreements } from "./helpers/sheet-paper-reading.js";

// ---------------------------------------------------------------------------
// Goal 05 through PostgreSQL: the demo wedding, frozen as an approved
// snapshot row, served to the phone (GET /v2) and printed (GET /sheet), then
// scanned without sign-in (GET /public/sheet-check).
//
//   one release   the phone and the PDF name the same version and approver,
//                 the PDF's own QR code carries the phone's release link, and
//                 both list the same room, all read back from the stored row
//   the old print a v1 PDF's code, once v2 is approved, scans "superseded:
//                 v2"; the v2 PDF names v2 and its code scans "current"
//
// What a mock cannot prove: that the jsonb round trip, the approval row and
// the version-in-force rule give the phone, the paper and the scan one answer.
// The pure version is sheet-release-identity.test.ts.
//
// Never reads DATABASE_URL/.env. Opt in with the disposable local database
// CI creates for the sheet's access tests (API test files run one at a time):
//   VENVIEWER_SHEET_ACCESS_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<port>/venviewer_sheet_access_test
// ---------------------------------------------------------------------------

const explicitUrl = process.env["VENVIEWER_SHEET_ACCESS_TEST_DATABASE_URL"];

function assertTestTarget(raw: string): void {
  const url = new URL(raw);
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1"
    || url.pathname !== "/venviewer_sheet_access_test" || url.search !== "" || url.hash !== "") {
    throw new Error("Sheet release tests require the explicit loopback venviewer_sheet_access_test database");
  }
}

describe("Sheet release PostgreSQL target guard", () => {
  it.each([
    "postgresql://user@production.example/venviewer_sheet_access_test",
    "postgresql://postgres@127.0.0.1/production",
    "postgresql://postgres@127.0.0.1/venviewer_sheet_access_test?host=production.example",
  ])("rejects an unsafe target: %s", (url) => {
    expect(() => { assertTestTarget(url); }).toThrow();
  });
});

const APPROVER = "DEMO ONLY approver";

describe.skipIf(explicitUrl === undefined)("the hallkeeper sheet's release, phone, paper and scan, on PostgreSQL", () => {
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
    vi.stubEnv("FRONTEND_URL", "https://venviewer.com");
    server = Fastify();
    await server.register(rateLimit, { max: 1000, timeWindow: "1 minute" });
    await server.register(hallkeeperSheetRoutes, { db, prefix: "/hallkeeper" });
    await server.register(publicSheetCheckRoutes, { check: (query) => resolveSheetPaperCheck(db, query), prefix: "/public" });
    await server.ready();
  }, 120000);

  afterAll(async () => {
    await server.close();
    await connection?.close();
    await migrationPool?.end();
    vi.unstubAllEnvs();
  });

  /** A venue, its room, an approver, a hallkeeper and a layout under review. */
  async function seed() {
    const venueId = randomUUID(); const roomId = randomUUID(); const configId = randomUUID();
    const approverId = randomUUID(); const keeperId = randomUUID();
    await db.insert(schema.venues).values({ id: venueId, name: "DEMO ONLY venue", slug: venueId, address: "Local test" });
    await db.insert(schema.spaces).values({
      id: roomId, venueId, name: "DEMO ONLY hall", slug: `room-${roomId}`, widthM: "21", lengthM: "10.5", heightM: "7",
      floorPlanOutline: [{ x: -10.5, y: -5.25 }, { x: 10.5, y: -5.25 }, { x: 10.5, y: 5.25 }, { x: -10.5, y: 5.25 }],
    });
    await db.insert(schema.users).values([
      { id: approverId, venueId, email: `${approverId}@demo.invalid`, name: APPROVER, role: "admin" },
      { id: keeperId, venueId, email: `${keeperId}@demo.invalid`, name: "DEMO ONLY hallkeeper", role: "hallkeeper" },
    ]);
    await db.insert(schema.configurations).values({
      id: configId, venueId, spaceId: roomId, userId: approverId, name: "DEMO ONLY wedding", slug: `plan-${configId}`,
      layoutStyle: "dinner-rounds", guestCount: 120, reviewStatus: "under_review",
    });
    const headers = { authorization: `Bearer ${JSON.stringify({ id: keeperId, email: `${keeperId}@demo.invalid`, role: "hallkeeper", venueId })}` };
    return { configId, approverId, headers };
  }
  type Layout = Awaited<ReturnType<typeof seed>>;

  /** The demo wedding as this layout's frozen sheet, stamped by the approval row. */
  function frozenWedding(layout: Layout, change: Partial<HallkeeperSheetV2["config"]> = {}): HallkeeperSheetV2 {
    const wedding = weddingSheet();
    return { ...wedding, config: { ...wedding.config, id: layout.configId, ...change }, approval: null };
  }

  /** Approve a version the way the approval route leaves the rows. */
  async function approve(layout: Layout, version: number, approvedAt: Date, payload: HallkeeperSheetV2): Promise<{ id: string; sourceHash: string }> {
    const id = randomUUID();
    const sourceHash = randomBytes(32).toString("hex");
    await db.insert(schema.configurationSheetSnapshots).values({
      id, configurationId: layout.configId, version, payload, coordinateSpace: "real_m_v1", sourceHash,
      createdBy: layout.approverId, approvedAt, approvedBy: layout.approverId,
    });
    await db.update(schema.configurations).set({ reviewStatus: "approved", approvedAt, approvedBy: layout.approverId })
      .where(eq(schema.configurations.id, layout.configId));
    return { id, sourceHash };
  }

  /** What the phone is served. */
  async function phone(layout: Layout): Promise<HallkeeperSheetV2> {
    const response = await server.inject({ method: "GET", url: `/hallkeeper/${layout.configId}/v2`, headers: layout.headers });
    expect(response.statusCode).toBe(200);
    return HallkeeperSheetV2Schema.parse(response.json<{ data: unknown }>().data);
  }

  /** A printed copy, and the minutes it can have been printed in (it stamps its own time). */
  async function print(layout: Layout): Promise<{ pdf: Buffer; minutes: readonly string[] }> {
    const from = new Date().toISOString();
    const response = await server.inject({ method: "GET", url: `/hallkeeper/${layout.configId}/sheet`, headers: layout.headers });
    const to = new Date().toISOString();
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/pdf");
    return { pdf: response.rawPayload, minutes: [from, to] };
  }

  /** The link the paper's own code carries, read from its modules: the phone's
   *  release link with the copy's printed minute. Null when it carries neither. */
  async function linkOnPaper(paper: { pdf: Buffer; minutes: readonly string[] }, served: HallkeeperSheetV2): Promise<string | null> {
    const qr = printedQr(paper.pdf);
    for (const minute of paper.minutes) {
      const link = printedLink(served, minute);
      if (await encodes(qr, link)) return link;
    }
    return null;
  }

  /** Whoever holds the paper scans it: no sign-in. */
  async function scan(link: string): Promise<unknown> {
    const response = await server.inject({ method: "GET", url: `/public/sheet-check${new URL(link).search}` });
    expect(response.statusCode).toBe(200);
    return response.json<{ data: unknown }>().data;
  }

  it("names one release on the phone and the paper, and lists the same room, from the stored row", async () => {
    const layout = await seed();
    const v1 = await approve(layout, 1, new Date("2026-10-22T15:12:00.000Z"), frozenWedding(layout));
    const served = await phone(layout);
    expect(served.approval).toEqual({ version: 1, approvedAt: "2026-10-22T15:12:00.000Z", approverName: APPROVER });
    expect(queryOf(served.paperCheck?.url ?? "")).toEqual({ s: v1.id, v: 1, h: paperFingerprint(v1.sourceHash) });

    const paper = await print(layout);
    const text = bodyText(paper.pdf);
    expect(paper.minutes.some((minute) => text.includes(`Approved by ${APPROVER} · ${releaseLine(served, minute)}`))).toBe(true);
    expect(text).toContain("v1, issued 22 Oct 16:12, printed");
    const link = await linkOnPaper(paper, served);
    expect(link).not.toBeNull();
    expect(roomDisagreements(served, paper.pdf)).toEqual([]);
    expect(await scan(link ?? "")).toEqual({ state: "current", version: 1 });
  });

  it("tells a v1 print it is superseded once v2 is approved, and prints v2 with a code that scans current", async () => {
    const layout = await seed();
    await approve(layout, 1, new Date("2026-10-22T15:12:00.000Z"), frozenWedding(layout));
    const v1Phone = await phone(layout);
    const v1Link = await linkOnPaper(await print(layout), v1Phone);
    if (v1Link === null) throw new Error("The v1 print carries no check link");
    expect(await scan(v1Link)).toEqual({ state: "current", version: 1 });

    const v2 = await approve(layout, 2, new Date("2026-10-24T08:15:00.000Z"), frozenWedding(layout, { guestCount: 126 }));
    expect(await scan(v1Link)).toEqual({ state: "superseded", currentVersion: 2 });

    const v2Phone = await phone(layout);
    expect(v2Phone.approval?.version).toBe(2);
    expect(v2Phone.config.guestCount).toBe(126);
    expect(queryOf(v2Phone.paperCheck?.url ?? "")).toEqual({ s: v2.id, v: 2, h: paperFingerprint(v2.sourceHash) });
    const v2Paper = await print(layout);
    const text = bodyText(v2Paper.pdf);
    expect(text).toContain("v2, issued 24 Oct 09:15, printed");
    expect(text).not.toContain("v1, issued");
    expect(text).toMatch(/GUESTS 126\b/u);
    expect(roomDisagreements(v2Phone, v2Paper.pdf)).toEqual([]);
    const v2Link = await linkOnPaper(v2Paper, v2Phone);
    if (v2Link === null) throw new Error("The v2 print carries no check link");
    expect(queryOf(v2Link)).not.toEqual(queryOf(v1Link));
    expect(await scan(v2Link)).toEqual({ state: "current", version: 2 });
    // The old paper keeps saying so.
    expect(await scan(v1Link)).toEqual({ state: "superseded", currentVersion: 2 });
  });
});
