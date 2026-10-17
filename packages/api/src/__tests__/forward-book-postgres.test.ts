import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ForwardBookCheckSchema,
  ForwardBookResponseSchema,
  PUBLIC_ROOM_ASK_THE_TEAM,
  TRADES_HALL_PUBLIC_PROFILE,
  addRotaDays,
  rotaLocalDate,
  type ForwardBookCheck,
  type ForwardBookResponse,
} from "@omnitwin/types";
import * as schema from "../db/schema.js";
import type { Database } from "../db/client.js";
import { forwardBookRoutes } from "../routes/forward-book.js";
import { PublicDiscovery, drizzlePublicDiscoveryStore } from "../services/public-discovery.js";

// ---------------------------------------------------------------------------
// The forward book on the Diary, room by room (Blake, 17 October 2026: "hide
// date status until checked"), on isolated PostgreSQL:
//
//   - migration 0091 applies with the whole migration set, and the database
//     itself keeps one standing record per room, a record to its venue's own
//     rooms, and a note and a clearing in shape;
//   - only the venue's own admin or manager records or clears; staff,
//     hallkeepers, sales, a Venviewer platform admin and another venue's
//     manager are refused, and another venue's room or record is not found;
//   - a colleague's record is never overwritten, and a cleared record keeps
//     who cleared it and when;
//   - the public read describes a room's dates only while its record stands,
//     and never carries the recorder's name or note.
//
// Opt-in, isolated PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

process.env["NODE_ENV"] = "test";
const testUrl = process.env["VENVIEWER_FORWARD_BOOK_TEST_DATABASE_URL"];
if (testUrl !== undefined) {
  const parsed = new URL(testUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || parsed.hostname !== "127.0.0.1"
    || parsed.pathname !== "/venviewer_forward_book_test"
    || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Forward book tests require their explicit isolated loopback database");
  }
}

describe.skipIf(testUrl === undefined)("the forward book on the Diary, on isolated PostgreSQL", () => {
  const run = randomUUID().slice(0, 8);
  const venue = randomUUID();
  const otherVenue = randomUUID();
  const hall = randomUUID();
  const saloon = randomUUID();
  const theirHall = randomUUID();
  const manager = randomUUID();
  const admin = randomUUID();
  const otherManager = randomUUID();
  const slug = `forward-book-${run}`;
  const otherSlug = `forward-book-other-${run}`;
  const NOTE = `Compared with the paper diary and the sales spreadsheet to Dec 2027 (${run})`;

  let pool: Pool;
  let db: Database;
  let server: FastifyInstance;
  let discovery: PublicDiscovery;

  function as(role: string, venueId: string | null = venue, id: string = randomUUID(), platformRole = "none"): { authorization: string } {
    return { authorization: `Bearer ${JSON.stringify({ id, email: `${role}-${run}@example.test`, name: `${role} signed in`, role, platformRole, venueId })}` };
  }
  const asManager = (): { authorization: string } => as("manager", venue, manager);
  const asAdmin = (): { authorization: string } => as("admin", venue, admin);
  const asOtherManager = (): { authorization: string } => as("manager", otherVenue, otherManager);

  async function list(headers: { authorization: string }, venueId = venue): Promise<{ statusCode: number; body: ForwardBookResponse | null }> {
    const res = await server.inject({ method: "GET", url: `/venues/${venueId}/forward-book`, headers });
    return {
      statusCode: res.statusCode,
      body: res.statusCode === 200 ? ForwardBookResponseSchema.parse((JSON.parse(res.body) as { data: unknown }).data) : null,
    };
  }

  async function record(headers: { authorization: string }, payload: Record<string, unknown>, venueId = venue): Promise<{ statusCode: number; code?: string; check?: ForwardBookCheck }> {
    const res = await server.inject({ method: "POST", url: `/venues/${venueId}/forward-book`, headers, payload });
    const body = JSON.parse(res.body) as { code?: string; data?: unknown; details?: unknown };
    const check = res.statusCode === 409 ? body.details : body.data;
    return { statusCode: res.statusCode, code: body.code, check: check === undefined ? undefined : ForwardBookCheckSchema.parse(check) };
  }

  async function clear(headers: { authorization: string }, id: string, venueId = venue): Promise<{ statusCode: number; code?: string; check?: ForwardBookCheck }> {
    const res = await server.inject({ method: "POST", url: `/venues/${venueId}/forward-book/${id}/clear`, headers });
    const body = JSON.parse(res.body) as { code?: string; data?: unknown; details?: unknown };
    const check = res.statusCode === 409 ? body.details : body.data;
    return { statusCode: res.statusCode, code: body.code, check: check === undefined ? undefined : ForwardBookCheckSchema.parse(check) };
  }

  /** The public answer for each of the venue's rooms, two days from now. */
  async function publicAnswers(): Promise<Record<string, string>> {
    const date = addRotaDays(rotaLocalDate(Date.now(), "Europe/London"), 2);
    const outcome = await discovery.availability({ venue: slug, from: date, to: date });
    if (!outcome.ok) throw new Error(outcome.message);
    const text = JSON.stringify(outcome.value);
    // The recorder's name and note are staff facts.
    expect(text).not.toContain("Moira");
    expect(text).not.toContain(NOTE);
    return Object.fromEntries(outcome.value.rooms.map((entry) => [entry.room, entry.answer]));
  }

  async function sqlState(statement: string, values: readonly unknown[]): Promise<string | undefined> {
    try {
      await pool.query(statement, [...values]);
      return undefined;
    } catch (error) {
      return (error as { code?: string }).code;
    }
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: testUrl, application_name: `forward_book_${run}`, max: 6 });
    await migrate(drizzle(pool), { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
    db = drizzle(pool, { schema });
    await db.insert(schema.venues).values([
      { id: venue, name: "TEST ONLY Trades Hall", slug, address: "Disposable fixture", timezone: "Europe/London" },
      { id: otherVenue, name: "TEST ONLY elsewhere", slug: otherSlug, address: "Disposable fixture", timezone: "Europe/London" },
    ]);
    const room = (id: string, venueId: string, name: string, roomSlug: string, sortOrder: number) => ({
      id, venueId, name, slug: roomSlug, sortOrder, widthM: "21.00", lengthM: "10.50", heightM: "7.00",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 10.5 }, { x: 0, y: 10.5 }],
    });
    await db.insert(schema.spaces).values([
      room(hall, venue, "Grand Hall", "grand-hall", 0),
      room(saloon, venue, "Saloon", "saloon", 1),
      room(theirHall, otherVenue, "Their Hall", "grand-hall", 0),
    ]);
    await db.insert(schema.users).values([
      { id: manager, venueId: venue, name: "M. Brown", displayName: "Moira Brown", email: `moira-${run}@example.test`, role: "manager" },
      { id: admin, venueId: venue, name: "Elspeth Grant", email: `elspeth-${run}@example.test`, role: "admin" },
      { id: otherManager, venueId: otherVenue, name: "Their Manager", email: `theirs-${run}@example.test`, role: "manager" },
    ]);

    server = Fastify();
    await server.register(forwardBookRoutes, { db, prefix: "/venues/:venueId/forward-book" });
    await server.ready();
    discovery = new PublicDiscovery({
      store: drizzlePublicDiscoveryStore(db),
      venues: [{ ...TRADES_HALL_PUBLIC_PROFILE, dbSlug: slug }],
      cacheTtlMs: 0,
      forwardBookCacheTtlMs: 0,
    });
  }, 300_000);

  afterAll(async () => {
    await server?.close();
    if (pool !== undefined) {
      await pool.query("DELETE FROM forward_book_checks WHERE venue_id = ANY($1::uuid[])", [[venue, otherVenue]]);
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[manager, admin, otherManager]]);
      await pool.query("DELETE FROM spaces WHERE venue_id = ANY($1::uuid[])", [[venue, otherVenue]]);
      await pool.query("DELETE FROM venues WHERE id = ANY($1::uuid[])", [[venue, otherVenue]]);
      await pool.end();
    }
  }, 60_000);

  it("starts with every room hidden from the public, nothing recorded", async () => {
    const { statusCode, body } = await list(as("staff"));
    expect(statusCode).toBe(200);
    expect(body?.rooms).toEqual([
      { spaceId: hall, name: "Grand Hall", current: null, previous: null },
      { spaceId: saloon, name: "Saloon", current: null, previous: null },
    ]);
    expect(await publicAnswers()).toEqual({ "grand-hall": PUBLIC_ROOM_ASK_THE_TEAM, saloon: PUBLIC_ROOM_ASK_THE_TEAM });
  });

  it("lets everyone who reads the Diary see where each room stands, and nobody else", async () => {
    for (const role of ["admin", "manager", "staff", "hallkeeper", "sales"]) {
      expect((await list(as(role))).statusCode, role).toBe(200);
    }
    for (const role of ["planner", "client", "caterer"]) {
      expect((await list(as(role))).statusCode, role).toBe(403);
    }
    // Another venue's manager cannot read this venue's records.
    expect((await list(asOtherManager())).statusCode).toBe(403);
  });

  it("refuses staff, the floor, sales and a Venviewer platform admin, and records nothing", async () => {
    for (const headers of [as("staff"), as("hallkeeper"), as("sales"), as("planner"), as("admin", null, randomUUID(), "admin")]) {
      const refused = await record(headers, { spaceId: hall });
      expect(refused.statusCode).toBe(403);
    }
    const { body } = await list(asManager());
    expect(body?.rooms.every((room) => room.current === null)).toBe(true);
  });

  it("refuses another venue's manager, and does not find another venue's room", async () => {
    // Their manager, at our venue's address.
    expect((await record(asOtherManager(), { spaceId: hall })).statusCode).toBe(403);
    // Our manager, at their venue's address.
    expect((await record(asManager(), { spaceId: theirHall }, otherVenue)).statusCode).toBe(403);
    // Our manager, naming their room at our address.
    const foreign = await record(asManager(), { spaceId: theirHall });
    expect(foreign).toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
    expect((await pool.query("SELECT count(*)::int AS n FROM forward_book_checks WHERE space_id = $1", [theirHall])).rows[0]).toEqual({ n: 0 });
  });

  it("refuses a malformed request", async () => {
    expect((await record(asManager(), { spaceId: "grand-hall" })).statusCode).toBe(400);
    expect((await record(asManager(), { spaceId: hall, note: "x".repeat(501) })).statusCode).toBe(400);
    expect((await record(asManager(), { spaceId: hall, recordedByName: "Someone else" })).statusCode).toBe(400);
    const res = await server.inject({ method: "GET", url: "/venues/not-a-venue/forward-book", headers: asManager() });
    expect(res.statusCode).toBe(400);
  });

  let hallCheck: ForwardBookCheck;

  it("records the Grand Hall with who, when and the note, and the public starts seeing its dates", async () => {
    const before = Date.now();
    const created = await record(asManager(), { spaceId: hall, note: `  ${NOTE}  ` });
    expect(created.statusCode).toBe(201);
    if (created.check === undefined) throw new Error("No record came back");
    hallCheck = created.check;
    // The name the product shows (the display name), not the account's.
    expect(hallCheck).toMatchObject({ spaceId: hall, recordedByName: "Moira Brown", note: NOTE, clearedAt: null, clearedByName: null });
    expect(Date.parse(hallCheck.recordedAt)).toBeGreaterThan(before - 60_000);

    const { body } = await list(as("staff"));
    expect(body?.rooms[0]).toEqual({ spaceId: hall, name: "Grand Hall", current: hallCheck, previous: null });
    expect(await publicAnswers()).toEqual({ "grand-hall": "dates", saloon: PUBLIC_ROOM_ASK_THE_TEAM });
  });

  it("never overwrites a colleague's record: a second one answers with the record that stands", async () => {
    const again = await record(asAdmin(), { spaceId: hall, note: "Checked again" });
    expect(again).toMatchObject({ statusCode: 409, code: "FORWARD_BOOK_ALREADY_RECORDED" });
    expect(again.check).toEqual(hallCheck);
  });

  it("lets exactly one of two simultaneous records for a room stand", async () => {
    const [left, right] = await Promise.all([
      record(asManager(), { spaceId: saloon }),
      record(asAdmin(), { spaceId: saloon }),
    ]);
    expect([left.statusCode, right.statusCode].sort()).toEqual([201, 409]);
    const standing = await pool.query("SELECT count(*)::int AS n FROM forward_book_checks WHERE space_id = $1 AND cleared_at IS NULL", [saloon]);
    expect(standing.rows[0]).toEqual({ n: 1 });
  });

  it("refuses to clear for staff, another venue's manager, or another venue's address", async () => {
    expect((await clear(as("staff"), hallCheck.id)).statusCode).toBe(403);
    expect((await clear(as("hallkeeper"), hallCheck.id)).statusCode).toBe(403);
    expect((await clear(asOtherManager(), hallCheck.id)).statusCode).toBe(403);
    // Their manager at their own address cannot reach our record.
    expect((await clear(asOtherManager(), hallCheck.id, otherVenue))).toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
    expect((await clear(asManager(), randomUUID())).statusCode).toBe(404);
    const { body } = await list(asManager());
    expect(body?.rooms[0]?.current).toEqual(hallCheck);
  });

  it("clears the Grand Hall, keeping who cleared it and when, and the public stops seeing its dates", async () => {
    const cleared = await clear(asAdmin(), hallCheck.id);
    expect(cleared.statusCode).toBe(200);
    expect(cleared.check).toMatchObject({ id: hallCheck.id, recordedByName: "Moira Brown", note: NOTE, clearedByName: "Elspeth Grant" });
    expect(Date.parse(cleared.check?.clearedAt ?? "")).toBeGreaterThanOrEqual(Date.parse(hallCheck.recordedAt));

    const { body } = await list(as("hallkeeper"));
    expect(body?.rooms[0]).toEqual({ spaceId: hall, name: "Grand Hall", current: null, previous: cleared.check });
    expect((await publicAnswers())["grand-hall"]).toBe(PUBLIC_ROOM_ASK_THE_TEAM);

    // A second clear finds it already cleared, and says so with the record.
    const again = await clear(asManager(), hallCheck.id);
    expect(again).toMatchObject({ statusCode: 409, code: "FORWARD_BOOK_ALREADY_CLEARED" });
    expect(again.check?.clearedByName).toBe("Elspeth Grant");
  });

  it("records the room afresh after a clearing, the old record kept", async () => {
    const fresh = await record(asManager(), { spaceId: hall });
    expect(fresh.statusCode).toBe(201);
    expect(fresh.check).toMatchObject({ note: null, recordedByName: "Moira Brown" });
    expect(fresh.check?.id).not.toBe(hallCheck.id);
    const { body } = await list(asManager());
    expect(body?.rooms[0]).toMatchObject({ current: fresh.check, previous: null });
    const history = await pool.query("SELECT count(*)::int AS n FROM forward_book_checks WHERE space_id = $1", [hall]);
    expect(history.rows[0]).toEqual({ n: 2 });
  });

  it("keeps the rules in the database itself, whatever writes to it", async () => {
    const insert = "INSERT INTO forward_book_checks (venue_id, space_id, recorded_by_name, note, cleared_at, cleared_by_name, recorded_at) VALUES ($1, $2, $3, $4, $5, $6, $7)";
    const at = new Date("2026-10-17T12:00:00.000Z");
    // A second standing record for a room.
    expect(await sqlState(insert, [venue, hall, "Someone", null, null, null, at])).toBe("23505");
    // A record for another venue's room.
    expect(await sqlState(insert, [venue, theirHall, "Someone", null, null, null, at])).toBe("23503");
    // An untrimmed or over-long note, a blank name, half a clearing, a clearing before the record.
    expect(await sqlState(insert, [otherVenue, theirHall, "Someone", " padded ", null, null, at])).toBe("23514");
    expect(await sqlState(insert, [otherVenue, theirHall, "Someone", "x".repeat(501), null, null, at])).toBe("23514");
    expect(await sqlState(insert, [otherVenue, theirHall, "  ", null, null, null, at])).toBe("23514");
    expect(await sqlState(insert, [otherVenue, theirHall, "Someone", null, at, null, at])).toBe("23514");
    expect(await sqlState(insert, [otherVenue, theirHall, "Someone", null, new Date(at.getTime() - 1000), "Someone", at])).toBe("23514");
  });
});
