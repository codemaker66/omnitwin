import Fastify, { type FastifyInstance } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { supplierCoordinationRoutes, supplierShareRoutes } from "../routes/supplier-coordination.js";

// ---------------------------------------------------------------------------
// Supplier passes: the cross-scope gate (A Door for Everyone Outside, stage 1).
//
// A pass for one supplier or one event can never read another's data. The
// release is gated on this file: every pass here is issued through the real
// routes, and every read is checked for strings that belong to another
// supplier, another event or another venue. It also holds the rest of the
// stage-1 contract: staff issue and withdraw, hallkeepers only read, every
// pass stops working on a date (older passes without one are read as seven
// days after their event), one live link per pass, a fresh pass replaces only
// the same supplier's pass on the same event, and what a supplier
// acknowledged survives withdrawal and replacement.
//
// Opt-in, isolated PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

const testUrl = process.env["VENVIEWER_ROUTE_TEST_DATABASE_URL"];
if (testUrl !== undefined) {
  const parsed = new URL(testUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || parsed.hostname !== "127.0.0.1" || parsed.port !== "55476"
    || parsed.pathname !== "/venviewer_route_atomicity_test"
    || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Supplier pass scope tests require their explicit isolated loopback database");
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

const VENUE_A = "a1111111-1111-4111-8111-111111111111";
const VENUE_B = "b2222222-2222-4222-8222-222222222222";
const STAFF_A = "a1111111-1111-4111-8111-1111111111a1";
const HALLKEEPER_A = "a1111111-1111-4111-8111-1111111111a2";
const STAFF_B = "b2222222-2222-4222-8222-2222222222b1";

const EVENT_A1 = "a1111111-1111-4111-8111-1111111111e1";
const EVENT_A2 = "a1111111-1111-4111-8111-1111111111e2";
const EVENT_A_UNDATED = "a1111111-1111-4111-8111-1111111111e3";
const EVENT_A_PAST = "a1111111-1111-4111-8111-1111111111e4";
const EVENT_B1 = "b2222222-2222-4222-8222-2222222222e1";

const SPACE_A = "a1111111-1111-4111-8111-1111111111f1";
const SPACE_B = "b2222222-2222-4222-8222-2222222222f1";
const CONFIG_A = "a1111111-1111-4111-8111-1111111111c1";
const CONFIG_B = "b2222222-2222-4222-8222-2222222222c1";

const HANDOFF_A1 = "a1111111-1111-4111-8111-111111111d01";
const HANDOFF_A2 = "a1111111-1111-4111-8111-111111111d02";
const HANDOFF_A_UNDATED = "a1111111-1111-4111-8111-111111111d03";
const HANDOFF_A_PAST = "a1111111-1111-4111-8111-111111111d04";
const HANDOFF_B1 = "b2222222-2222-4222-8222-222222222d01";

const FLORIST = "a1111111-1111-4111-8111-111111111501";
const BAND = "a1111111-1111-4111-8111-111111111502";
const SUPPLIER_B = "b2222222-2222-4222-8222-222222222501";

const INS_A1_FLORIST = "a1111111-1111-4111-8111-111111111601";
const INS_A1_BAND = "a1111111-1111-4111-8111-111111111602";
const INS_A1_NOTE = "a1111111-1111-4111-8111-111111111603";
const INS_A2_FLORIST = "a1111111-1111-4111-8111-111111111604";
const INS_A_UNDATED = "a1111111-1111-4111-8111-111111111605";
const INS_B1 = "b2222222-2222-4222-8222-222222222601";

// Words that belong to exactly one supplier, event or venue. A read through
// any other pass must never contain them.
const WORDS = {
  floristA1: "Table centrepieces in Grand Hall",
  noteA1: "Load-in access notes for Glassford Street",
  bandA1: "Band load-in by the Saloon stair",
  floristA2: "Ceremony arch for the second wedding",
  venueB: "Riverside rooftop private brief",
  bandName: "The Ceilidh Collective",
  supplierBName: "Harbour Lights Ltd",
  venueBName: "Riverside Assembly Rooms",
} as const;

function headers(userId: string, venueId: string, role: string): { authorization: string } {
  return { authorization: `Bearer ${JSON.stringify({ id: userId, email: `${role}@example.test`, name: "Fixture User", role, platformRole: "none", venueId })}` };
}
const staffA = headers(STAFF_A, VENUE_A, "staff");
const hallkeeperA = headers(HALLKEEPER_A, VENUE_A, "hallkeeper");
const staffB = headers(STAFF_B, VENUE_B, "staff");

/** A column's literal Drizzle default as SQL, so route inserts that rely on
 *  one (status, kind, safe status) read as production stores them. */
function literalDefault(value: unknown, sqlType: string): string | null {
  if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value) || (typeof value === "object" && value !== null && !("queryChunks" in value))) {
    return `'${JSON.stringify(value).replaceAll("'", "''")}'::${sqlType}`;
  }
  return null;
}

describe.skipIf(testUrl === undefined)("supplier passes never read across scope, on isolated PostgreSQL", () => {
  let pool: Pool;
  let server: FastifyInstance;
  const fixtureSchema = `supplier_pass_scope_${randomUUID().replaceAll("-", "")}`;
  const tables: PgTable[] = [
    schema.venues, schema.users, schema.events, schema.spaces, schema.bookings, schema.configurations,
    schema.handoffPacks, schema.snapshotDiffs, schema.suppliers, schema.supplierInstructions,
    schema.supplierCoordinationPacks, schema.supplierCoordinationPackItems, schema.supplierCoordinationShareTokens,
    schema.supplierAcknowledgements, schema.eventPlanNotifications, schema.generalAuditLog,
  ];

  let eventA1Ends: Date;

  beforeAll(async () => {
    pool = new Pool({ connectionString: testUrl, application_name: fixtureSchema, max: 4, options: `-c search_path=${fixtureSchema}` });
    await pool.query(`CREATE SCHEMA "${fixtureSchema}"`);
    for (const table of tables) {
      const config = getTableConfig(table);
      const columns = config.columns.map((column) => {
        const sqlType = column.getSQLType();
        let defaultSql = "";
        if (column.name === "id") defaultSql = " primary key default gen_random_uuid()";
        else if (column.name === "created_at" || column.name === "updated_at" || column.name === "compiled_at") defaultSql = " default now()";
        else if (column.hasDefault) {
          const literal = literalDefault(column.default, sqlType);
          if (literal !== null) defaultSql = ` default ${literal}`;
        }
        return `"${column.name}" ${sqlType}${defaultSql}`;
      });
      await pool.query(`CREATE TABLE "${config.name}" (${columns.join(", ")})`);
    }
    const db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(supplierCoordinationRoutes, { db, prefix: "/supplier-coordination" });
    await server.register(supplierShareRoutes, { db, prefix: "/supplier-share" });
    await server.ready();
  }, 120_000);

  beforeEach(async () => {
    await pool.query(`TRUNCATE ${tables.map((table) => `"${getTableConfig(table).name}"`).join(", ")}`);
    const now = Date.now();
    const a1Starts = new Date(now + 10 * DAY_MS);
    eventA1Ends = new Date(a1Starts.getTime() + 6 * 60 * 60 * 1000);

    await pool.query(`INSERT INTO venues (id, name, slug, address, timezone) VALUES
      ($1, 'Trades Hall Glasgow', 'trades-hall-glasgow', '85 Glassford Street, Glasgow G1 1UH', 'Europe/London'),
      ($2, $3, 'riverside', '1 Quay Road', 'Europe/London')`, [VENUE_A, VENUE_B, WORDS.venueBName]);
    await pool.query(`INSERT INTO users (id, email, name, display_name, phone) VALUES
      ($1, 'kerry@example.test', 'Kerry Mackay', NULL, '0141 496 0100'),
      ($2, 'hamish@example.test', 'Hamish Reid', NULL, NULL),
      ($3, 'rory@example.test', 'Rory Bell', NULL, '0131 496 0199')`, [STAFF_A, HALLKEEPER_A, STAFF_B]);
    await pool.query(`INSERT INTO spaces (id, venue_id, name, slug) VALUES
      ($1, $2, 'Grand Hall', 'grand-hall'), ($3, $4, 'Rooftop', 'rooftop')`, [SPACE_A, VENUE_A, SPACE_B, VENUE_B]);
    await pool.query(`INSERT INTO events (id, venue_id, name, starts_at, ends_at) VALUES
      ($1, $6, 'Crawford wedding', $7, $8),
      ($2, $6, 'Second wedding', $9, NULL),
      ($3, $6, 'Undated dinner', NULL, NULL),
      ($4, $6, 'Last month''s dinner', NULL, NULL),
      ($5, $10, 'Rooftop launch', $7, $8)`,
    [EVENT_A1, EVENT_A2, EVENT_A_UNDATED, EVENT_A_PAST, EVENT_B1, VENUE_A,
      // The event row's own times drift from the Diary; the booking wins.
      new Date(now + 9 * DAY_MS), new Date(now + 9 * DAY_MS + 3600_000), new Date(now + 12 * DAY_MS), VENUE_B]);
    await pool.query(`INSERT INTO bookings (venue_id, space_id, event_id, kind, status, title, starts_at, ends_at) VALUES
      ($1, $2, $3, 'ink', 'active', 'Crawford wedding', $4, $5),
      ($1, $2, $6, 'ink', 'active', 'Last month''s dinner', $7, $8),
      ($1, $2, $3, 'hold', 'released', 'Released hold', $9, $10)`,
    [VENUE_A, SPACE_A, EVENT_A1, a1Starts, eventA1Ends, EVENT_A_PAST,
      new Date(now - 11 * DAY_MS), new Date(now - 10 * DAY_MS),
      new Date(now + 40 * DAY_MS), new Date(now + 41 * DAY_MS)]);
    await pool.query(`INSERT INTO configurations (id, venue_id, deleted_at) VALUES ($1, $2, NULL), ($3, $4, NULL)`,
      [CONFIG_A, VENUE_A, CONFIG_B, VENUE_B]);
    const compiled = new Date(now - 3600_000);
    await pool.query(`INSERT INTO handoff_packs (id, event_id, config_id, snapshot_hash, version, status, source_label, summary, compiled_at) VALUES
      ($1, $2, $6, $8, 1, 'compiled', 'Approved snapshot v1', 'Handoff', $9),
      ($3, $4, $6, $8, 1, 'compiled', 'Approved snapshot v1', 'Handoff', $9),
      ($5, $10, $6, $8, 1, 'compiled', 'Approved snapshot v1', 'Handoff', $9),
      ($11, $12, $6, $8, 1, 'compiled', 'Approved snapshot v1', 'Handoff', $9),
      ($13, $14, $7, $8, 1, 'compiled', 'Approved snapshot v1', 'Handoff', $9)`,
    [HANDOFF_A1, EVENT_A1, HANDOFF_A2, EVENT_A2, HANDOFF_A_UNDATED, CONFIG_A, CONFIG_B, "a".repeat(64), compiled,
      EVENT_A_UNDATED, HANDOFF_A_PAST, EVENT_A_PAST, HANDOFF_B1, EVENT_B1]);
    await pool.query(`INSERT INTO suppliers (id, venue_id, name, category, contact_name, email, phone) VALUES
      ($1, $4, 'Bloom & Co', 'florist', 'Sam', 'sam@bloom.example', '07700 900001'),
      ($2, $4, $5, 'music', 'Ali', 'ali@ceilidh.example', NULL),
      ($3, $6, $7, 'lighting', 'Jo', 'jo@harbour.example', NULL)`,
    [FLORIST, BAND, SUPPLIER_B, VENUE_A, WORDS.bandName, VENUE_B, WORDS.supplierBName]);
    await pool.query(`INSERT INTO supplier_instructions (id, handoff_pack_id, supplier_id, category, title, detail, arrival_window, sort_order) VALUES
      ($1, $7, $10, 'florist', $13, 'Twelve low arrangements, LED candles only.', '07:00-08:00', 0),
      ($2, $7, $11, 'music', $14, 'Use the service lift; no load-in through the front door.', '15:00-15:30', 1),
      ($3, $7, NULL, 'logistics', $15, 'Unload at the side door and clear the pavement by 08:30.', NULL, 2),
      ($4, $8, $10, 'florist', $16, 'Arch at the head of the aisle.', '10:00-11:00', 0),
      ($5, $9, NULL, 'operations', 'Undated note', 'Confirm the date with the venue.', NULL, 0),
      ($6, $12, $17, 'lighting', $18, 'Rooftop uplighters.', '12:00-13:00', 0)`,
    [INS_A1_FLORIST, INS_A1_BAND, INS_A1_NOTE, INS_A2_FLORIST, INS_A_UNDATED, INS_B1,
      HANDOFF_A1, HANDOFF_A2, HANDOFF_A_UNDATED, FLORIST, BAND, HANDOFF_B1,
      WORDS.floristA1, WORDS.bandA1, WORDS.noteA1, WORDS.floristA2, SUPPLIER_B, WORDS.venueB]);
  }, 60_000);

  afterAll(async () => {
    if (server !== undefined) await server.close();
    if (pool !== undefined) {
      await pool.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
      await pool.end();
    }
  });

  interface IssuedPass { readonly packId: string; readonly token: string }

  async function issuePass(
    who: { authorization: string },
    handoffPackId: string,
    instructionIds: readonly string[],
    title: string,
    link: Record<string, unknown> = {},
  ): Promise<IssuedPass> {
    const created = await server.inject({
      method: "POST", url: "/supplier-coordination/packs", headers: who,
      payload: { handoffPackId, supplierInstructionIds: instructionIds, title },
    });
    expect(created.statusCode, created.body).toBe(201);
    const packId = created.json<{ data: { pack: { id: string } } }>().data.pack.id;
    const issued = await server.inject({
      method: "POST", url: `/supplier-coordination/packs/${packId}/share-token`, headers: who, payload: link,
    });
    expect(issued.statusCode, issued.body).toBe(201);
    return { packId, token: issued.json<{ data: { token: string } }>().data.token };
  }

  async function openPass(token: string): Promise<{ status: number; text: string; json: unknown }> {
    const res = await server.inject({ method: "GET", url: `/supplier-share/${token}` });
    return { status: res.statusCode, text: res.body, json: res.statusCode === 200 ? res.json() : null };
  }

  async function ackCount(packId: string): Promise<number> {
    const result = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM supplier_acknowledgements WHERE pack_id = $1", [packId]);
    return result.rows[0]?.n ?? 0;
  }

  it("shows each pass its own supplier's part of its own event, and nothing of anyone else's", async () => {
    const florist = await issuePass(staffA, HANDOFF_A1, [INS_A1_FLORIST, INS_A1_NOTE], "Bloom & Co");
    const band = await issuePass(staffA, HANDOFF_A1, [INS_A1_BAND], WORDS.bandName);
    const floristA2 = await issuePass(staffA, HANDOFF_A2, [INS_A2_FLORIST], "Bloom & Co");
    const venueB = await issuePass(staffB, HANDOFF_B1, [INS_B1], WORDS.supplierBName);

    const cases: readonly { pass: IssuedPass; own: readonly string[]; foreign: readonly string[] }[] = [
      { pass: florist, own: [WORDS.floristA1, WORDS.noteA1], foreign: [WORDS.bandA1, WORDS.bandName, WORDS.floristA2, WORDS.venueB, WORDS.supplierBName, WORDS.venueBName] },
      { pass: band, own: [WORDS.bandA1], foreign: [WORDS.floristA1, WORDS.noteA1, WORDS.floristA2, WORDS.venueB, WORDS.supplierBName, WORDS.venueBName, "Bloom & Co"] },
      { pass: floristA2, own: [WORDS.floristA2], foreign: [WORDS.floristA1, WORDS.noteA1, WORDS.bandA1, WORDS.bandName, WORDS.venueB, WORDS.supplierBName] },
      { pass: venueB, own: [WORDS.venueB], foreign: [WORDS.floristA1, WORDS.noteA1, WORDS.bandA1, WORDS.floristA2, WORDS.bandName, "Bloom & Co", "Trades Hall", "Kerry Mackay"] },
    ];
    const allTokens = [florist, band, floristA2, venueB].map((pass) => pass.token);
    for (const { pass, own, foreign } of cases) {
      const page = await openPass(pass.token);
      expect(page.status).toBe(200);
      for (const word of own) expect(page.text).toContain(word);
      for (const word of foreign) expect(page.text, `${pass.packId} leaked "${word}"`).not.toContain(word);
      // No link, nor its hash, ever travels in a page.
      for (const token of allTokens) {
        expect(page.text).not.toContain(token);
        expect(page.text).not.toContain(createHash("sha256").update(token, "utf8").digest("hex"));
      }
    }
  });

  it("files an acknowledgement on the pass it came through, and on no other", async () => {
    const florist = await issuePass(staffA, HANDOFF_A1, [INS_A1_FLORIST], "Bloom & Co");
    const band = await issuePass(staffA, HANDOFF_A1, [INS_A1_BAND], WORDS.bandName);
    const venueB = await issuePass(staffB, HANDOFF_B1, [INS_B1], WORDS.supplierBName);

    const ack = await server.inject({
      method: "POST", url: `/supplier-share/${florist.token}/acknowledge`,
      payload: { status: "acknowledged", acknowledgedByName: "Sam" },
    });
    expect(ack.statusCode).toBe(201);
    expect(await ackCount(florist.packId)).toBe(1);
    expect(await ackCount(band.packId)).toBe(0);
    expect(await ackCount(venueB.packId)).toBe(0);

    const bandPage = await openPass(band.token);
    expect(bandPage.text).not.toContain("\"acknowledgedByName\":\"Sam\"");
    // The venue hears it, and only the venue the pass belongs to.
    const notified = await pool.query<{ venue_id: string }>("SELECT DISTINCT venue_id FROM event_plan_notifications");
    expect(notified.rows.map((row) => row.venue_id)).toEqual([VENUE_A]);
  });

  it("refuses another venue's staff every read and every action on a pass", async () => {
    const florist = await issuePass(staffA, HANDOFF_A1, [INS_A1_FLORIST], "Bloom & Co");

    const attempts = [
      await server.inject({ method: "GET", url: `/supplier-coordination/events/${EVENT_A1}/passes`, headers: staffB }),
      await server.inject({ method: "GET", url: `/supplier-coordination/packs/${florist.packId}`, headers: staffB }),
      await server.inject({ method: "POST", url: `/supplier-coordination/packs/${florist.packId}/share-token`, headers: staffB, payload: {} }),
      await server.inject({ method: "POST", url: `/supplier-coordination/packs/${florist.packId}/revoke`, headers: staffB, payload: {} }),
      await server.inject({
        method: "POST", url: "/supplier-coordination/packs", headers: staffB,
        payload: { handoffPackId: HANDOFF_A1, supplierInstructionIds: [INS_A1_FLORIST], title: "Bloom & Co" },
      }),
    ];
    expect(attempts.map((res) => res.statusCode)).toEqual([403, 403, 403, 403, 403]);
    for (const res of attempts) expect(res.body).not.toContain(WORDS.floristA1);

    // A fresh pass in venue B cannot name venue A's pass as the one it replaces.
    const venueBPass = await server.inject({
      method: "POST", url: "/supplier-coordination/packs", headers: staffB,
      payload: { handoffPackId: HANDOFF_B1, supplierInstructionIds: [INS_B1], title: "Bloom & Co" },
    });
    const venueBPackId = venueBPass.json<{ data: { pack: { id: string } } }>().data.pack.id;
    const replace = await server.inject({
      method: "POST", url: `/supplier-coordination/packs/${venueBPackId}/share-token`, headers: staffB,
      payload: { supersedesPackId: florist.packId },
    });
    expect(replace.statusCode).toBe(422);

    expect((await openPass(florist.token)).status).toBe(200);
    const audit = await pool.query("SELECT 1 FROM general_audit_log WHERE action = 'supplier_pass.withdrawn'");
    expect(audit.rowCount).toBe(0);
  });

  it("lets a hallkeeper read the event's passes but issue and withdraw none", async () => {
    const florist = await issuePass(staffA, HANDOFF_A1, [INS_A1_FLORIST], "Bloom & Co");
    const board = await server.inject({ method: "GET", url: `/supplier-coordination/events/${EVENT_A1}/passes`, headers: hallkeeperA });
    expect(board.statusCode).toBe(200);
    const data = board.json<{ data: { canIssue: boolean; issuer: unknown; passes: { id: string }[] } }>().data;
    expect(data.canIssue).toBe(false);
    expect(data.issuer).toBeNull();
    expect(data.passes.map((pass) => pass.id)).toEqual([florist.packId]);

    const revoke = await server.inject({ method: "POST", url: `/supplier-coordination/packs/${florist.packId}/revoke`, headers: hallkeeperA, payload: {} });
    const create = await server.inject({
      method: "POST", url: "/supplier-coordination/packs", headers: hallkeeperA,
      payload: { handoffPackId: HANDOFF_A1, supplierInstructionIds: [INS_A1_BAND], title: WORDS.bandName },
    });
    expect([revoke.statusCode, create.statusCode]).toEqual([403, 403]);
    expect((await openPass(florist.token)).status).toBe(200);
  });

  it("builds the staff board from this event and this venue only", async () => {
    await issuePass(staffA, HANDOFF_A1, [INS_A1_FLORIST], "Bloom & Co");
    await issuePass(staffA, HANDOFF_A2, [INS_A2_FLORIST], "Bloom & Co");
    await issuePass(staffB, HANDOFF_B1, [INS_B1], WORDS.supplierBName);

    const res = await server.inject({ method: "GET", url: `/supplier-coordination/events/${EVENT_A1}/passes`, headers: staffA });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(WORDS.floristA2);
    expect(res.body).not.toContain(WORDS.venueB);
    expect(res.body).not.toContain(WORDS.supplierBName);
    const board = res.json<{ data: {
      canIssue: boolean;
      issuer: { name: string; phone: string | null } | null;
      rooms: string[];
      eventLastMomentAt: string | null;
      defaultExpiresAt: string | null;
      handoff: { id: string } | null;
      scope: { instructionId: string }[];
      suppliers: { name: string }[];
      passes: { title: string; live: boolean; expiresAt: string; madeBy: { name: string; phone: string | null } | null }[];
    } }>().data;
    expect(board.canIssue).toBe(true);
    expect(board.issuer).toEqual({ name: "Kerry Mackay", phone: "0141 496 0100" });
    // The Diary's live booking decides the day; the released hold does not.
    expect(board.rooms).toEqual(["Grand Hall"]);
    expect(board.eventLastMomentAt).toBe(eventA1Ends.toISOString());
    expect(board.defaultExpiresAt).toBe(new Date(eventA1Ends.getTime() + 7 * DAY_MS).toISOString());
    expect(board.handoff?.id).toBe(HANDOFF_A1);
    expect(board.scope.map((item) => item.instructionId).sort()).toEqual([INS_A1_BAND, INS_A1_FLORIST, INS_A1_NOTE].sort());
    expect(board.suppliers.map((supplier) => supplier.name)).toEqual(["Bloom & Co", WORDS.bandName]);
    expect(board.passes).toHaveLength(1);
    expect(board.passes[0]).toMatchObject({ title: "Bloom & Co", live: true, expiresAt: board.defaultExpiresAt });
    // The board names who made each pass, as the supplier's page does.
    expect(board.passes[0]?.madeBy).toEqual({ name: "Kerry Mackay", phone: "0141 496 0100" });
  });

  it("stops every new pass on a date: seven days after the event unless chosen, never open-ended", async () => {
    const created = await server.inject({
      method: "POST", url: "/supplier-coordination/packs", headers: staffA,
      payload: { handoffPackId: HANDOFF_A1, supplierInstructionIds: [INS_A1_FLORIST], title: "Bloom & Co" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json<{ data: { pack: { expiresAt: string } } }>().data.pack.expiresAt)
      .toBe(new Date(eventA1Ends.getTime() + 7 * DAY_MS).toISOString());

    const refusals = await Promise.all([
      server.inject({
        method: "POST", url: "/supplier-coordination/packs", headers: staffA,
        payload: { handoffPackId: HANDOFF_A1, supplierInstructionIds: [INS_A1_BAND], title: WORDS.bandName, expiresAt: new Date(Date.now() - DAY_MS).toISOString() },
      }),
      server.inject({
        method: "POST", url: "/supplier-coordination/packs", headers: staffA,
        payload: { handoffPackId: HANDOFF_A1, supplierInstructionIds: [INS_A1_BAND], title: WORDS.bandName, expiresAt: new Date(eventA1Ends.getTime() + 31 * DAY_MS).toISOString() },
      }),
      server.inject({
        method: "POST", url: "/supplier-coordination/packs", headers: staffA,
        payload: { handoffPackId: HANDOFF_A_UNDATED, supplierInstructionIds: [INS_A_UNDATED], title: "Undated supplier", expiresAt: null },
      }),
    ]);
    expect(refusals.map((res) => res.json<{ code: string }>().code))
      .toEqual(["PASS_EXPIRY_PAST", "PASS_EXPIRY_TOO_LATE", "PASS_EXPIRY_REQUIRED"]);
    expect(refusals.every((res) => res.statusCode === 422)).toBe(true);

    // An undated event's pass opens once someone chooses its stop date.
    const chosen = new Date(Date.now() + 5 * DAY_MS).toISOString();
    const undated = await server.inject({
      method: "POST", url: "/supplier-coordination/packs", headers: staffA,
      payload: { handoffPackId: HANDOFF_A_UNDATED, supplierInstructionIds: [INS_A_UNDATED], title: "Undated supplier", expiresAt: chosen },
    });
    expect(undated.statusCode).toBe(201);
  });

  it("reads an older pass with no stop date as seven days after its event, and never as open-ended", async () => {
    async function legacyPass(packId: string, eventId: string | null, handoffId: string, token: string): Promise<void> {
      await pool.query(`INSERT INTO supplier_coordination_packs (id, venue_id, handoff_pack_id, event_id, title, status,
          source_snapshot_hash, source_digest, source_label, safe_status, issued_at, expires_at)
        VALUES ($1, $2, $3, $4, 'Older pass', 'issued', $5, $5, 'Approved snapshot v1', 'supplier_safe_operations_handoff', now(), NULL)`,
      [packId, VENUE_A, handoffId, eventId, "c".repeat(64)]);
      await pool.query("INSERT INTO supplier_coordination_share_tokens (pack_id, token_hash, token_prefix, expires_at) VALUES ($1, $2, $3, NULL)",
        [packId, createHash("sha256").update(token, "utf8").digest("hex"), token.slice(0, 8)]);
    }
    const upcoming = "legacyUpcomingToken_0123456789abcdefghijklmnop";
    const finished = "legacyFinishedToken_0123456789abcdefghijklmnop";
    const unanchored = "legacyNoEventToken_0123456789abcdefghijklmnopq";
    await legacyPass(randomUUID(), EVENT_A1, HANDOFF_A1, upcoming);
    await legacyPass(randomUUID(), EVENT_A_PAST, HANDOFF_A_PAST, finished);
    await legacyPass(randomUUID(), null, HANDOFF_A1, unanchored);

    const open = await openPass(upcoming);
    expect(open.status).toBe(200);
    expect((open.json as { data: { expiresAt: string } }).data.expiresAt)
      .toBe(new Date(eventA1Ends.getTime() + 7 * DAY_MS).toISOString());
    // Ten days after its event, the older pass stopped three days ago.
    expect((await openPass(finished)).status).toBe(404);
    // No stored date and no event to count from: it does not open.
    expect((await openPass(unanchored)).status).toBe(404);

    const board = await server.inject({ method: "GET", url: `/supplier-coordination/events/${EVENT_A1}/passes`, headers: staffA });
    const legacy = board.json<{ data: { passes: { title: string; expiryAssumed: boolean; live: boolean }[] } }>().data.passes
      .find((pass) => pass.title === "Older pass");
    expect(legacy).toMatchObject({ expiryAssumed: true, live: true });
  });

  it("keeps one live link per pass: a new link closes the one before", async () => {
    const first = await issuePass(staffA, HANDOFF_A1, [INS_A1_FLORIST], "Bloom & Co");
    const again = await server.inject({ method: "POST", url: `/supplier-coordination/packs/${first.packId}/share-token`, headers: staffA, payload: {} });
    expect(again.statusCode).toBe(201);
    const second = again.json<{ data: { token: string } }>().data.token;
    expect((await openPass(first.token)).status).toBe(404);
    expect((await openPass(second)).status).toBe(200);
  });

  it("keeps a supplier's reply, what they were shown and the name given, even if the pass itself is deleted", async () => {
    const florist = await issuePass(staffA, HANDOFF_A1, [INS_A1_FLORIST, INS_A1_NOTE], "Bloom & Co");
    const ack = await server.inject({
      method: "POST", url: `/supplier-share/${florist.token}/acknowledge`,
      payload: { status: "acknowledged", acknowledgedByName: "Sam", acknowledgedByEmail: "sam@bloom.example" },
    });
    expect(ack.statusCode).toBe(201);
    const ackId = ack.json<{ data: { id: string } }>().data.id;

    // What the foreign keys would do if anything deleted the pass.
    await pool.query("DELETE FROM supplier_acknowledgements WHERE pack_id = $1", [florist.packId]);
    await pool.query("DELETE FROM supplier_coordination_packs WHERE id = $1", [florist.packId]);

    const kept = await pool.query<{ actor_user_id: string | null; metadata: Record<string, unknown> }>(
      "SELECT actor_user_id, metadata FROM general_audit_log WHERE action = 'supplier_pass.replied' AND target_id = $1",
      [florist.packId],
    );
    expect(kept.rows).toHaveLength(1);
    expect(kept.rows[0]?.actor_user_id).toBeNull();
    expect(kept.rows[0]?.metadata).toMatchObject({
      venueId: VENUE_A,
      eventId: EVENT_A1,
      acknowledgementId: ackId,
      status: "acknowledged",
      nameGiven: "Sam",
      passTitle: "Bloom & Co",
      itemTitles: [WORDS.floristA1, WORDS.noteA1],
    });
    // The email given and any note stay with the pass; they are not copied.
    expect(JSON.stringify(kept.rows[0]?.metadata)).not.toContain("sam@bloom.example");
    expect(JSON.stringify(kept.rows[0]?.metadata)).not.toContain(florist.token);
  });

  it("withdraws a pass in one step, leaves the others open and keeps what was acknowledged", async () => {
    const florist = await issuePass(staffA, HANDOFF_A1, [INS_A1_FLORIST], "Bloom & Co");
    const band = await issuePass(staffA, HANDOFF_A1, [INS_A1_BAND], WORDS.bandName);
    await server.inject({
      method: "POST", url: `/supplier-share/${florist.token}/acknowledge`,
      payload: { status: "acknowledged", acknowledgedByName: "Sam" },
    });

    const withdraw = await server.inject({ method: "POST", url: `/supplier-coordination/packs/${florist.packId}/revoke`, headers: staffA, payload: {} });
    expect(withdraw.statusCode).toBe(200);
    expect(withdraw.json<{ data: { status: string; revokedAt: string | null } }>().data).toMatchObject({ status: "revoked" });
    // Withdrawing again changes nothing and still answers.
    const repeat = await server.inject({ method: "POST", url: `/supplier-coordination/packs/${florist.packId}/revoke`, headers: staffA, payload: {} });
    expect(repeat.statusCode).toBe(200);

    expect((await openPass(florist.token)).status).toBe(404);
    expect((await openPass(band.token)).status).toBe(200);
    expect(await ackCount(florist.packId)).toBe(1);
    const relink = await server.inject({ method: "POST", url: `/supplier-coordination/packs/${florist.packId}/share-token`, headers: staffA, payload: {} });
    expect(relink.statusCode).toBe(409);

    const board = await server.inject({ method: "GET", url: `/supplier-coordination/events/${EVENT_A1}/passes`, headers: staffA });
    const withdrawn = board.json<{ data: { passes: { id: string; live: boolean; revokedAt: string | null; acknowledgements: unknown[] }[] } }>().data.passes
      .find((pass) => pass.id === florist.packId);
    expect(withdrawn?.live).toBe(false);
    expect(withdrawn?.revokedAt).not.toBeNull();
    expect(withdrawn?.acknowledgements).toHaveLength(1);
    const audit = await pool.query("SELECT 1 FROM general_audit_log WHERE action = 'supplier_pass.withdrawn' AND target_id = $1", [florist.packId]);
    expect(audit.rowCount).toBe(1);
  });

  it("replaces a pass only with a fresh one for the same supplier on the same event, and says what changed for them", async () => {
    const original = await issuePass(staffA, HANDOFF_A1, [INS_A1_FLORIST, INS_A1_NOTE], "Bloom & Co");
    await server.inject({
      method: "POST", url: `/supplier-share/${original.token}/acknowledge`,
      payload: { status: "acknowledged", acknowledgedByName: "Sam" },
    });

    async function freshPack(handoffPackId: string, instructionIds: readonly string[], title: string): Promise<string> {
      const res = await server.inject({
        method: "POST", url: "/supplier-coordination/packs", headers: staffA,
        payload: { handoffPackId, supplierInstructionIds: instructionIds, title },
      });
      return res.json<{ data: { pack: { id: string } } }>().data.pack.id;
    }

    // Another supplier's pass, and the same supplier on another event, are refused.
    const otherHolder = await freshPack(HANDOFF_A1, [INS_A1_BAND], WORDS.bandName);
    const otherEvent = await freshPack(HANDOFF_A2, [INS_A2_FLORIST], "Bloom & Co");
    for (const packId of [otherHolder, otherEvent]) {
      const refused = await server.inject({
        method: "POST", url: `/supplier-coordination/packs/${packId}/share-token`, headers: staffA,
        payload: { supersedesPackId: original.packId },
      });
      expect(refused.statusCode).toBe(422);
    }
    expect((await openPass(original.token)).status).toBe(200);

    // The plan is compiled again; the old pass now says so on the board.
    await pool.query(`INSERT INTO handoff_packs (id, event_id, config_id, snapshot_hash, version, status, source_label, summary, compiled_at)
      VALUES ($1, $2, $3, $4, 2, 'compiled', 'Approved snapshot v2', 'Handoff', now())`, [randomUUID(), EVENT_A1, CONFIG_A, "d".repeat(64)]);
    const before = await server.inject({ method: "GET", url: `/supplier-coordination/events/${EVENT_A1}/passes`, headers: staffA });
    const stale = before.json<{ data: { passes: { id: string; planChangedAt: string | null }[] } }>().data.passes
      .find((pass) => pass.id === original.packId);
    expect(stale?.planChangedAt).not.toBeNull();
    const stalePage = await openPass(original.token);
    expect((stalePage.json as { data: { passDetails?: { planChangedAt: string | null } } }).data.passDetails?.planChangedAt).not.toBeNull();

    // The same supplier's fresh pass on the same event replaces the old one.
    const fresh = await freshPack(HANDOFF_A1, [INS_A1_FLORIST], "Bloom & Co");
    const replaced = await server.inject({
      method: "POST", url: `/supplier-coordination/packs/${fresh}/share-token`, headers: staffA,
      payload: { supersedesPackId: original.packId },
    });
    expect(replaced.statusCode).toBe(201);
    const freshToken = replaced.json<{ data: { token: string } }>().data.token;

    expect((await openPass(original.token)).status).toBe(404);
    expect(await ackCount(original.packId)).toBe(1);
    const page = await openPass(freshToken);
    expect(page.status).toBe(200);
    const details = (page.json as { data: { passDetails?: {
      changesForYou: { added: string[]; removed: string[]; changed: string[] } | null;
      venueContact: { name: string; phone: string | null } | null;
      rooms: string[];
      venueAddress: string | null;
    } } }).data.passDetails;
    expect(details?.changesForYou).toMatchObject({ added: [], removed: [WORDS.noteA1], changed: [] });
    expect(details?.venueContact).toEqual({ name: "Kerry Mackay", phone: "0141 496 0100" });
    expect(details?.rooms).toEqual(["Grand Hall"]);
    expect(details?.venueAddress).toBe("85 Glassford Street, Glasgow G1 1UH");
    // What changed is read from the same holder only: the band's pass never
    // shows the florist's earlier part.
    const bandLink = await server.inject({ method: "POST", url: `/supplier-coordination/packs/${otherHolder}/share-token`, headers: staffA, payload: {} });
    const bandPage = await openPass(bandLink.json<{ data: { token: string } }>().data.token);
    expect(bandPage.text).not.toContain(WORDS.noteA1);
    expect((bandPage.json as { data: { passDetails?: { changesForYou: unknown } } }).data.passDetails?.changesForYou).toBeNull();
  });
});
