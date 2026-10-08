import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
  type FetchLike,
} from "@modelcontextprotocol/client";
import { TRADES_HALL_PUBLIC_PROFILE, type PublicVenueProfile } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { publicMcpRoutes } from "../routes/public-mcp.js";

// ---------------------------------------------------------------------------
// The public MCP endpoint against migrated PostgreSQL (T-649): Blake's
// boundary — venue facts, published capacities and free/held/busy only, no
// client names — proven with real rows.
//
// The fixture seeds a venue's private life with distinctive strings (client,
// event, booking title, notes, next action, owner, enquiry guest, decision
// dates) and a second tenant that is not opted in. Every response body the
// official MCP client receives, in both protocol eras, must carry none of
// them, nor any option rank; each date must follow the Diary's rule exactly:
// confirmed bookings and venue blocks busy, live provisional holds held (an
// overdue decision date does not lapse one), and cancelled, released,
// expired, deleted and prospect rows free — on the same and neighbouring days
// and across both 2026/27 clock changes.
//
// Never loads .env or DATABASE_URL: only the explicit disposable platform
// cluster (127.0.0.1:55477/venviewer_platform_test), migrated by the platform
// gate. Each run owns fresh venues under random slugs.
// ---------------------------------------------------------------------------

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Public MCP PostgreSQL tests require the explicit disposable platform database");
  }
}

const NOW = Date.parse("2026-10-01T11:00:00.000Z");
const MODERN = "2026-07-28";
const OUTLINE = [{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 10.5 }, { x: 0, y: 10.5 }];

describe.skipIf(target === undefined)("public MCP on migrated PostgreSQL", () => {
  const run = randomUUID().slice(0, 8);
  const allowedSlug = `mcp-allowed-${run}`;
  const privateSlug = `mcp-private-${run}`;
  const PRIVATE = {
    client: `ZEPHYRINE-CLIENT-${run}`,
    event: `QUILLWORT-EVENT-${run}`,
    eventNotes: `MARZIPAN-EVENT-NOTES-${run}`,
    title: `OCELOT-BOOKING-TITLE-${run}`,
    holdTitle: `PANGOLIN-HOLD-TITLE-${run}`,
    notes: `TAMARIND-BOOKING-NOTES-${run}`,
    nextAction: `NARWHAL-NEXT-ACTION-${run}`,
    eventType: `XYLOPHONE-TYPE-${run}`,
    owner: `Hieronymus Quist ${run}`,
    ownerEmail: `hieronymus.quist.${run}@private.invalid`,
    guest: `Clementine Vortigern ${run}`,
    guestEmail: `clementine.vortigern.${run}@private.invalid`,
    guestPhone: "+44 7700 900 417",
    enquiryMessage: `JUNIPER-ENQUIRY-MESSAGE-${run}`,
    otherVenue: `Bellweather Private Rooms ${run}`,
    otherRoom: `Bellweather Ballroom ${run}`,
    otherTitle: `ARMADILLO-OTHER-TITLE-${run}`,
  } as const;
  // Hold hygiene dates: never to be shown. One decision date is already past
  // at NOW, so its hold is overdue but still live in the Diary.
  const PRIVATE_INSTANTS = {
    decision: "2026-10-20T12:00:00.000Z",
    overdueDecision: "2026-09-20T12:00:00.000Z",
    nextActionDue: "2026-10-15T09:00:00.000Z",
  } as const;
  const venueId = randomUUID();
  const otherVenueId = randomUUID();
  const grandHall = randomUUID();
  const saloon = randomUUID();
  const storeRoom = randomUUID();
  const otherRoom = randomUUID();
  const ownerId = randomUUID();
  const eventId = randomUUID();
  const enquiryId = randomUUID();
  const bookingIds: string[] = [];

  const profile: PublicVenueProfile = { ...TRADES_HALL_PUBLIC_PROFILE, dbSlug: allowedSlug };
  let pool: Pool;
  let server: FastifyInstance;
  let url: URL;
  const bodies: string[] = [];
  const clients: Client[] = [];

  async function booking(values: Omit<typeof schema.bookings.$inferInsert, "id" | "venueId">, venue = venueId): Promise<void> {
    const id = randomUUID();
    bookingIds.push(id);
    const db = drizzle(pool, { schema });
    await db.insert(schema.bookings).values({ id, venueId: venue, ...values });
  }

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `public_mcp_${run}`, max: 4,
      options: "-c statement_timeout=10000" });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name)
      .toBe("venviewer_platform_test");
    const db = drizzle(pool, { schema });

    await db.insert(schema.venues).values([
      { id: venueId, name: "TEST ONLY public MCP venue", slug: allowedSlug, address: "Disposable fixture", timezone: "Europe/London" },
      { id: otherVenueId, name: PRIVATE.otherVenue, slug: privateSlug, address: "Disposable fixture", timezone: "Europe/London" },
    ]);
    const space = (id: string, venue: string, name: string, slug: string, sortOrder: number) => ({
      id, venueId: venue, name, slug, sortOrder, widthM: "21.00", lengthM: "10.50", heightM: "7.00", floorPlanOutline: OUTLINE,
    });
    await db.insert(schema.spaces).values([
      space(grandHall, venueId, "Grand Hall", "grand-hall", 0),
      space(saloon, venueId, "Saloon", "saloon", 1),
      space(storeRoom, venueId, "Store Room", "store-room", 2),
      space(otherRoom, otherVenueId, PRIVATE.otherRoom, "ballroom", 0),
    ]);
    await db.insert(schema.users).values({ id: ownerId, venueId, name: PRIVATE.owner, email: PRIVATE.ownerEmail, role: "sales" });
    await db.insert(schema.events).values({
      id: eventId, venueId, name: PRIVATE.event, clientName: PRIVATE.client, notes: PRIVATE.eventNotes, eventType: PRIVATE.eventType,
    });
    await db.insert(schema.enquiries).values({
      id: enquiryId, venueId, spaceId: grandHall, name: PRIVATE.guest, email: PRIVATE.guestEmail, guestName: PRIVATE.guest,
      guestEmail: PRIVATE.guestEmail, guestPhone: PRIVATE.guestPhone, message: PRIVATE.enquiryMessage, state: "submitted",
    });

    const owned = { ownerUserId: ownerId, createdBy: ownerId, eventType: PRIVATE.eventType, notes: PRIVATE.notes };
    // A provisional hold carries the hygiene fields the Diary requires.
    const hold = (rank: number, decisionAt: string) => ({
      ...owned, kind: "hold" as const, rank, nextAction: PRIVATE.nextAction,
      decisionAt: new Date(decisionAt), nextActionDueAt: new Date(PRIVATE_INSTANTS.nextActionDue),
    });

    // --- The autumn change night, 24/25 October 2026 ---------------------
    // Grand Hall, Sat 24: confirmed 18:00 to 01:30 BST, and a live 1st option
    // earlier the same day — busy wins.
    await booking({ ...owned, spaceId: grandHall, kind: "ink", title: PRIVATE.title, eventId, enquiryId,
      startsAt: new Date("2026-10-24T17:00:00.000Z"), endsAt: new Date("2026-10-25T00:30:00.000Z") });
    await booking({ ...hold(1, PRIVATE_INSTANTS.decision), spaceId: grandHall, title: `${PRIVATE.holdTitle} same day`,
      startsAt: new Date("2026-10-24T09:00:00.000Z"), endsAt: new Date("2026-10-24T13:00:00.000Z") });
    // Fri 23: a live hold whose decision date has already passed. The Diary
    // keeps it live (a decision due) until staff record an exit: held.
    await booking({ ...hold(1, PRIVATE_INSTANTS.overdueDecision), spaceId: grandHall, title: `${PRIVATE.holdTitle} overdue`,
      startsAt: new Date("2026-10-23T10:00:00.000Z"), endsAt: new Date("2026-10-23T16:00:00.000Z") });
    // Sun 25 and Mon 26: an expired and a released hold leave the room free.
    await booking({ ...hold(1, PRIVATE_INSTANTS.decision), spaceId: grandHall, status: "expired", title: `${PRIVATE.holdTitle} expired`,
      startsAt: new Date("2026-10-25T10:00:00.000Z"), endsAt: new Date("2026-10-25T16:00:00.000Z") });
    await booking({ ...hold(1, PRIVATE_INSTANTS.decision), spaceId: grandHall, status: "released", title: `${PRIVATE.holdTitle} released 26`,
      startsAt: new Date("2026-10-26T10:00:00.000Z"), endsAt: new Date("2026-10-26T16:00:00.000Z") });
    // Saloon: the venue's own block at 03:30 GMT after the clocks went back is
    // still the 24th; a live 2nd option from 04:30 GMT is the 25th's.
    await booking({ ...owned, spaceId: saloon, kind: "internal_block", title: `${PRIVATE.title} block`,
      startsAt: new Date("2026-10-25T03:30:00.000Z"), endsAt: new Date("2026-10-25T03:59:00.000Z") });
    await booking({ ...hold(2, PRIVATE_INSTANTS.decision), spaceId: saloon, title: `${PRIVATE.holdTitle} after the change`,
      startsAt: new Date("2026-10-25T04:30:00.000Z"), endsAt: new Date("2026-10-25T10:00:00.000Z") });
    // Saloon, Fri 23 and Mon 26: a lost hold and a deleted live hold, both free.
    await booking({ ...hold(1, PRIVATE_INSTANTS.decision), spaceId: saloon, status: "lost", title: `${PRIVATE.holdTitle} lost`,
      startsAt: new Date("2026-10-23T10:00:00.000Z"), endsAt: new Date("2026-10-23T16:00:00.000Z") });
    await booking({ ...hold(1, PRIVATE_INSTANTS.decision), spaceId: saloon, title: `${PRIVATE.holdTitle} deleted`,
      deletedAt: new Date("2026-09-30T09:00:00.000Z"),
      startsAt: new Date("2026-10-26T10:00:00.000Z"), endsAt: new Date("2026-10-26T16:00:00.000Z") });

    // --- November: one live hold; every other row leaves the rooms free ----
    await booking({ ...owned, spaceId: grandHall, kind: "ink", status: "cancelled", title: `${PRIVATE.title} cancelled`,
      startsAt: new Date("2026-11-07T10:00:00.000Z"), endsAt: new Date("2026-11-07T22:00:00.000Z") });
    await booking({ ...hold(1, PRIVATE_INSTANTS.decision), spaceId: grandHall, title: PRIVATE.holdTitle,
      startsAt: new Date("2026-11-14T10:00:00.000Z"), endsAt: new Date("2026-11-14T22:00:00.000Z") });
    await booking({ ...owned, spaceId: grandHall, kind: "prospect", title: `${PRIVATE.title} prospect`,
      startsAt: new Date("2026-11-21T10:00:00.000Z"), endsAt: new Date("2026-11-21T22:00:00.000Z") });
    await booking({ ...owned, spaceId: saloon, kind: "ink", title: `${PRIVATE.title} deleted`, deletedAt: new Date("2026-09-30T09:00:00.000Z"),
      startsAt: new Date("2026-11-07T10:00:00.000Z"), endsAt: new Date("2026-11-07T22:00:00.000Z") });
    await booking({ ...hold(1, PRIVATE_INSTANTS.decision), spaceId: saloon, status: "released", title: `${PRIVATE.holdTitle} released`,
      startsAt: new Date("2026-11-14T10:00:00.000Z"), endsAt: new Date("2026-11-14T22:00:00.000Z") });
    await booking({ ...owned, spaceId: grandHall, kind: "internal_block", status: "released", title: `${PRIVATE.title} lifted`,
      startsAt: new Date("2026-11-28T00:00:00.000Z"), endsAt: new Date("2026-11-29T00:00:00.000Z") });
    // A three-night closure: busy 24, 25 and 26 December, free on the 27th.
    await booking({ ...owned, spaceId: saloon, kind: "internal_block", title: `${PRIVATE.title} closure`,
      startsAt: new Date("2026-12-24T04:00:00.000Z"), endsAt: new Date("2026-12-27T04:00:00.000Z") });

    // --- The spring change, 28 March 2027 --------------------------------
    // Grand Hall: confirmed 03:30 to 04:30 BST crosses the 04:00 boundary just
    // after the clocks went forward (busy 27 and 28); a live hold later on the
    // 28th stays under the confirmed booking; a live hold on the 29th is held;
    // an expired hold on the 26th is free.
    await booking({ ...owned, spaceId: grandHall, kind: "ink", title: `${PRIVATE.title} spring`,
      startsAt: new Date("2027-03-28T02:30:00.000Z"), endsAt: new Date("2027-03-28T03:30:00.000Z") });
    await booking({ ...hold(1, PRIVATE_INSTANTS.decision), spaceId: grandHall, title: `${PRIVATE.holdTitle} spring same day`,
      startsAt: new Date("2027-03-28T10:00:00.000Z"), endsAt: new Date("2027-03-28T16:00:00.000Z") });
    await booking({ ...hold(1, PRIVATE_INSTANTS.decision), spaceId: grandHall, title: `${PRIVATE.holdTitle} spring next day`,
      startsAt: new Date("2027-03-29T10:00:00.000Z"), endsAt: new Date("2027-03-29T16:00:00.000Z") });
    await booking({ ...hold(1, PRIVATE_INSTANTS.decision), spaceId: grandHall, status: "expired", title: `${PRIVATE.holdTitle} spring expired`,
      startsAt: new Date("2027-03-26T10:00:00.000Z"), endsAt: new Date("2027-03-26T16:00:00.000Z") });
    // Saloon: a live hold 04:30 to 06:00 BST is the 28th's only; a released
    // hold on the 27th is free.
    await booking({ ...hold(1, PRIVATE_INSTANTS.decision), spaceId: saloon, title: `${PRIVATE.holdTitle} spring early`,
      startsAt: new Date("2027-03-28T03:30:00.000Z"), endsAt: new Date("2027-03-28T05:00:00.000Z") });
    await booking({ ...hold(1, PRIVATE_INSTANTS.decision), spaceId: saloon, status: "released", title: `${PRIVATE.holdTitle} spring released`,
      startsAt: new Date("2027-03-27T10:00:00.000Z"), endsAt: new Date("2027-03-27T16:00:00.000Z") });
    // The other tenant's confirmed booking on a date ours leave free.
    await booking({ spaceId: otherRoom, kind: "ink", title: PRIVATE.otherTitle, notes: PRIVATE.otherTitle,
      startsAt: new Date("2026-10-23T09:00:00.000Z"), endsAt: new Date("2026-10-23T17:00:00.000Z") }, otherVenueId);

    const database: Database = db;
    server = Fastify();
    await server.register(publicMcpRoutes, { db: database, venues: [profile], corsOrigins: [], now: () => NOW });
    await server.listen({ port: 0, host: "127.0.0.1" });
    const { port } = server.server.address() as AddressInfo;
    url = new URL(`http://127.0.0.1:${String(port)}/mcp`);
  }, 60000);

  afterAll(async () => {
    for (const client of clients) await client.close();
    await server?.close();
    await pool?.end();
  });

  const recordingFetch: FetchLike = async (input, init) => {
    const response = await fetch(input, init);
    bodies.push(await response.clone().text());
    return response;
  };

  async function client(era: "modern" | "legacy"): Promise<Client> {
    const connected = new Client(
      { name: "venviewer-public-mcp-postgres-test", version: "1.0.0" },
      era === "modern" ? { versionNegotiation: { mode: { pin: MODERN } } } : {},
    );
    await connected.connect(new StreamableHTTPClientTransport(url, { fetch: recordingFetch }));
    clients.push(connected);
    return connected;
  }

  type Days = Record<string, "free" | "held" | "busy">;
  async function availability(mcp: Client, from: string, to: string): Promise<Record<string, Days>> {
    const result = await mcp.callTool({ name: "check_availability", arguments: { venue: allowedSlug, from, to } });
    expect(result.isError).not.toBe(true);
    const report = result.structuredContent as {
      rooms: { room: string; name: string; days: Days }[];
      meaning: Record<string, string>;
      [key: string]: unknown;
    };
    expect(Object.keys(report).sort()).toEqual(["asOf", "dayRule", "enquire", "from", "meaning", "rooms", "timeZone", "to", "venue"]);
    expect(Object.keys(report.meaning).sort()).toEqual(["busy", "free", "held"]);
    for (const entry of report.rooms) {
      expect(Object.keys(entry).sort()).toEqual(["days", "name", "room"]);
      // One word per date: no rank, count, time or name rides along.
      for (const status of Object.values(entry.days)) expect(["free", "held", "busy"]).toContain(status);
    }
    return Object.fromEntries(report.rooms.map((entry) => [entry.room, entry.days]));
  }

  function allFree(from: string, count: number): Days {
    const days: Days = {};
    const start = Date.parse(`${from}T12:00:00.000Z`);
    for (let index = 0; index < count; index += 1) {
      days[new Date(start + index * 86_400_000).toISOString().slice(0, 10)] = "free";
    }
    return days;
  }

  describe.each(["modern", "legacy"] as const)("%s era", (era) => {
    it("follows the Diary's rule across the autumn clock change: busy over held, exits free", async () => {
      const rooms = await availability(await client(era), "2026-10-23", "2026-10-26");
      expect(rooms).toEqual({
        // 23: a live hold past its decision date; 24: confirmed plus a hold;
        // 25: an expired hold; 26: a released hold.
        "grand-hall": { "2026-10-23": "held", "2026-10-24": "busy", "2026-10-25": "free", "2026-10-26": "free" },
        // 23: a lost hold; 24: the block at 03:30 GMT; 25: a live 2nd option
        // from 04:30 GMT; 26: a deleted hold.
        saloon: { "2026-10-23": "free", "2026-10-24": "busy", "2026-10-25": "held", "2026-10-26": "free" },
        "store-room": allFree("2026-10-23", 4),
      });
    });

    it("holds a date for a live option only, leaving cancelled, deleted, released and prospect rows free", async () => {
      const rooms = await availability(await client(era), "2026-11-01", "2026-11-30");
      expect(rooms).toEqual({
        "grand-hall": { ...allFree("2026-11-01", 30), "2026-11-14": "held" },
        saloon: allFree("2026-11-01", 30),
        "store-room": allFree("2026-11-01", 30),
      });
    });

    it("marks a multi-day closure, and busy and held dates across the spring boundary", async () => {
      const mcp = await client(era);
      const december = await availability(mcp, "2026-12-23", "2026-12-27");
      expect(december["saloon"]).toEqual({
        "2026-12-23": "free", "2026-12-24": "busy", "2026-12-25": "busy", "2026-12-26": "busy", "2026-12-27": "free",
      });
      const spring = await availability(mcp, "2027-03-26", "2027-03-29");
      expect(spring).toEqual({
        // 26: an expired hold; 27 and 28: the confirmed booking across 04:00
        // BST (the 28th's live hold stays under it); 29: a live hold.
        "grand-hall": { "2027-03-26": "free", "2027-03-27": "busy", "2027-03-28": "busy", "2027-03-29": "held" },
        // 27: a released hold; 28: a live hold from 04:30 BST, the 28th's only.
        saloon: { "2027-03-26": "free", "2027-03-27": "free", "2027-03-28": "held", "2027-03-29": "free" },
        "store-room": allFree("2027-03-26", 4),
      });
    });

    it("describes the venue's rooms from its records, and its enquiry path", async () => {
      const mcp = await client(era);
      const venue = await mcp.callTool({ name: "get_venue", arguments: { venue: allowedSlug } });
      const described = venue.structuredContent as { rooms: { slug: string; dimensions: { floorAreaM2: number | null } }[] };
      expect(described.rooms.map((entry) => entry.slug)).toEqual(["grand-hall", "saloon", "store-room"]);
      expect(described.rooms[0]?.dimensions.floorAreaM2).toBe(220.5);
      const enquire = await mcp.callTool({ name: "how_to_enquire", arguments: { venue: allowedSlug } });
      expect(enquire.isError).not.toBe(true);
    });
  });

  it("keeps the other tenant undiscoverable by slug or id", async () => {
    const mcp = await client("modern");
    const answer = async (tool: string, venue: string): Promise<string> => {
      const result: CallToolResult = await mcp.callTool({ name: tool, arguments: { venue, from: "2026-10-23", to: "2026-10-23" } });
      expect(result.isError).toBe(true);
      const [first] = result.content;
      return first?.type === "text" ? first.text : "";
    };
    for (const tool of ["get_venue", "check_availability"]) {
      const nobody = await answer(tool, `nobody-${run}`);
      expect(await answer(tool, privateSlug)).toBe(nobody);
      expect(await answer(tool, otherVenueId)).toBe(nobody);
    }
  });

  it("never sends a client, event, booking, owner or enquiry detail, nor the other tenant", () => {
    expect(bodies.length).toBeGreaterThan(20);
    const forbidden = [
      ...Object.values(PRIVATE),
      privateSlug,
      otherVenueId,
      otherRoom,
      ownerId,
      eventId,
      enquiryId,
      ...bookingIds,
      // Booking and hold times never leave as instants: only dates and the
      // cache stamp do. Decision and next-action dates never leave at all.
      "2026-10-24T17:00", "2026-10-25T03:30", "2027-03-28T02:30",
      "2026-10-24T09:00", "2026-10-23T10:00", "2026-10-25T04:30", "2027-03-28T03:30", "2027-03-29T10:00",
      PRIVATE_INSTANTS.decision.slice(0, 16), PRIVATE_INSTANTS.overdueDecision.slice(0, 16),
      PRIVATE_INSTANTS.nextActionDue.slice(0, 16),
      // No option rank, in words or as a field.
      "1st option", "2nd option", "Joint 1st", "\"rank\"",
    ];
    for (const body of bodies) {
      for (const secret of forbidden) expect(body, `a response carried ${secret}`).not.toContain(secret);
    }
  });
});
