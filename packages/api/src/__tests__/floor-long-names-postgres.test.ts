import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Message, MessageReceipt, RequestStatusHistoryEntry, SlotObservation, VenueHandler, VenueRequest } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { messageRoutes, threadRoutes } from "../routes/conversations.js";
import { venueObservationRoutes } from "../routes/observations.js";
import { requestRoutes, venueRequestRoutes } from "../routes/requests.js";
import { insertBoundBookings } from "../services/event-binding.js";

// ---------------------------------------------------------------------------
// A long name on the floor, on the migrated disposable platform database.
//
// An account's name may run to 200 characters (users.name), but the floor's
// records keep 160: an observation, a request and its history, a message and
// its receipts, each in varchar(160) with a wire schema of max(160). A longer
// name is kept to 160, never refused, so a tap, a request, every step of it,
// the handover picker and the request's thread all work for that person and
// for everyone who reads what they did:
//   - a tap on the Day Board is recorded under the name, kept to 160;
//   - a request is raised, acknowledged, accepted and resolved, by the keyed
//     steps the slab sends and by the keyless door, with every history row;
//   - a relief with a long name is listed, handed requests and takes them;
//   - the request's thread is written, read and marked by a long name, and
//     its author still reads their own messages with that receipt on them;
//   - where the 160th character lies outside the Basic Multilingual Plane,
//     it is kept whole: both limits count characters, not UTF-16 units.
// Never reads DATABASE_URL or an env file.
// ---------------------------------------------------------------------------

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Long-name floor tests require the explicit disposable platform database");
  }
}

const HOUR = 60 * 60_000;
/** Two hundred characters: the longest name an account holds. */
const LONG = "J".repeat(200);
/** What a 160-wide record keeps of it. */
const KEPT = "J".repeat(160);
const RELIEF_LONG = "K".repeat(200);
const RELIEF_KEPT = "K".repeat(160);
/** 200 characters whose 160th lies beyond the Basic Multilingual Plane: one
 *  character, two UTF-16 code units. PostgreSQL and the wire schemas both
 *  count characters (code points), so what is kept ends on that whole
 *  character, never on half of it. */
const ASTRAL = `${"J".repeat(159)}${"\u{1D4D9}".repeat(41)}`;
const ASTRAL_KEPT = `${"J".repeat(159)}\u{1D4D9}`;

describe.skipIf(target === undefined)("long names on the floor, on migrated PostgreSQL", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let server: FastifyInstance;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `floor_long_names_${randomUUID()}`, max: 6,
      options: "-c statement_timeout=10000 -c lock_timeout=8000" });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(venueRequestRoutes, { db, prefix: "/venues" });
    await server.register(requestRoutes, { db, prefix: "/requests" });
    await server.register(venueObservationRoutes, { db, prefix: "/venues" });
    await server.register(threadRoutes, { db, prefix: "/threads" });
    await server.register(messageRoutes, { db, prefix: "/messages" });
    await server.ready();
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    await pool?.end();
  });

  async function fixture() {
    const venueId = randomUUID(), hallId = randomUUID();
    const people = {
      long: { id: randomUUID(), name: LONG },
      colleague: { id: randomUUID(), name: "Elaine" },
      relief: { id: randomUUID(), name: RELIEF_LONG },
      astral: { id: randomUUID(), name: ASTRAL },
    };
    await db.insert(schema.venues).values({ id: venueId, name: "TEST ONLY long names", slug: venueId, address: "Disposable fixture", timezone: "Europe/London" });
    const outline = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }];
    await db.insert(schema.spaces).values({ id: hallId, venueId, name: "Grand Hall", slug: "grand-hall", widthM: "20", lengthM: "20", heightM: "6", floorPlanOutline: outline });
    await db.insert(schema.users).values(Object.values(people).map((person) => ({
      id: person.id, venueId, name: person.name, email: `${person.id}@long-names.invalid`, role: "hallkeeper",
    })));
    // Tonight's dinner, under way: a tap now belongs to it.
    const startsAt = new Date(Math.floor((Date.now() - HOUR) / 60_000) * 60_000);
    const [dinner] = await insertBoundBookings(db, [{
      venueId, spaceId: hallId, kind: "ink", title: "TEST ONLY dinner", eventType: "dinner", createdBy: people.colleague.id,
      startsAt, endsAt: new Date(startsAt.getTime() + 5 * HOUR),
    }]);
    if (dinner === undefined) throw new Error("booking not made");
    return { venueId, hallId, people, dinner };
  }

  type Fixture = Awaited<ReturnType<typeof fixture>>;
  type Who = keyof Fixture["people"];

  /** JSON a header can carry: every code unit outside ASCII escaped, so a
   *  name beyond Latin-1 arrives whole through JSON.parse. */
  function headerJson(value: unknown): string {
    return JSON.stringify(value).replace(/[\u0080-\uffff]/g, (unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`);
  }

  /** The test-mode bearer: the name travels in it exactly as the account holds it. */
  function as(f: Fixture, who: Who, extra: Record<string, string> = {}): Record<string, string> {
    const { id, name } = f.people[who];
    return { authorization: `Bearer ${headerJson({ id, email: `${id}@long-names.invalid`, name, role: "hallkeeper", platformRole: "none", venueId: f.venueId })}`, ...extra };
  }

  async function call(f: Fixture, who: Who, method: "GET" | "POST" | "PATCH", url: string, payload?: Record<string, unknown>, extra: Record<string, string> = {}) {
    const response = await server.inject({ method, url, headers: as(f, who, extra), ...(payload === undefined ? {} : { payload }) });
    const body = response.json<{ data?: unknown; code?: string; error?: string }>();
    return { status: response.statusCode, data: body.data, code: body.code, error: body.error };
  }

  /** A step as the slab sends it: keyed, through the command ledger. */
  async function step(f: Fixture, who: Who, requestId: string, transition: Record<string, unknown>) {
    return call(f, who, "PATCH", `/requests/${requestId}`, transition, { "idempotency-key": randomUUID() });
  }

  async function raise(f: Fixture, who: Who): Promise<VenueRequest> {
    const made = await call(f, who, "POST", `/venues/${f.venueId}/requests`, {
      roomId: f.hallId, bookingId: f.dinner.id, kind: "refreshments", urgency: "soon", detail: "Water for the top table.", idempotencyKey: randomUUID(),
    });
    expect(made.status).toBe(201);
    return made.data as VenueRequest;
  }

  async function history(requestId: string) {
    return db.select().from(schema.requestStatusHistory)
      .where(eq(schema.requestStatusHistory.requestId, requestId))
      .orderBy(asc(schema.requestStatusHistory.at));
  }

  it("records a long name's tap on the Day Board rather than refusing it", async () => {
    const f = await fixture();
    const tap = await call(f, "long", "POST", `/venues/${f.venueId}/observations`, {
      bookingId: f.dinner.id, kind: "set", observedAt: new Date().toISOString(), idempotencyKey: randomUUID(),
    });
    expect(tap.status).toBe(201);
    expect((tap.data as SlotObservation).actorName).toBe(KEPT);
    const rows = await db.select().from(schema.bookingObservations).where(eq(schema.bookingObservations.bookingId, f.dinner.id));
    expect(rows.map((row) => row.actorName)).toEqual([KEPT]);

    // The rest of the floor reads it.
    const window = `from=${encodeURIComponent(new Date(Date.now() - 12 * HOUR).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 12 * HOUR).toISOString())}`;
    const board = await call(f, "colleague", "GET", `/venues/${f.venueId}/observations?${window}`);
    expect(board.status).toBe(200);
    expect((board.data as SlotObservation[]).map((fact) => fact.actorName)).toEqual([KEPT]);
  });

  it("keeps 160 whole characters when the 160th lies beyond the Basic Multilingual Plane", async () => {
    const f = await fixture();
    const tap = await call(f, "astral", "POST", `/venues/${f.venueId}/observations`, {
      bookingId: f.dinner.id, kind: "doors-open", observedAt: new Date().toISOString(), idempotencyKey: randomUUID(),
    });
    expect(tap.status).toBe(201);
    const kept = (tap.data as SlotObservation).actorName;
    expect(kept).toBe(ASTRAL_KEPT);
    // 160 code points, as the column and the wire schema count them (161 UTF-16 units).
    expect(Array.from(kept)).toHaveLength(160);
    // No half of a surrogate pair is left at the cut (stored, it would read as U+FFFD).
    expect(/\p{Cs}/u.test(kept)).toBe(false);
    const [row] = await db.select().from(schema.bookingObservations).where(eq(schema.bookingObservations.bookingId, f.dinner.id));
    expect(row?.actorName).toBe(ASTRAL_KEPT);
  });

  it("raises a request under a long name, with its first history row and its thread's first message", async () => {
    const f = await fixture();
    const made = await raise(f, "long");
    expect(made.requestedByName).toBe(KEPT);
    expect((await history(made.id)).map((row) => [row.toState, row.actorName])).toEqual([["sent", KEPT]]);
    if (made.threadId === null) throw new Error("a request has a thread");
    const thread = await call(f, "long", "GET", `/threads/${made.threadId}/messages`);
    expect(thread.status).toBe(200);
    expect((thread.data as { messages: Message[] }).messages.map((message) => message.authorName)).toEqual([KEPT]);
  });

  it("moves a request through acknowledge, accept and resolve under a long name, as the slab sends them", async () => {
    const f = await fixture();
    const made = await raise(f, "colleague");

    const seen = await step(f, "long", made.id, { to: "acknowledged" });
    expect(seen.status).toBe(200);
    expect((seen.data as VenueRequest).state).toBe("acknowledged");
    const taken = await step(f, "long", made.id, { to: "accepted" });
    expect(taken.status).toBe(200);
    expect((taken.data as VenueRequest).ownerName).toBe(KEPT);
    const done = await step(f, "long", made.id, { to: "resolved", outcome: "done" });
    expect(done.status).toBe(200);
    expect((done.data as VenueRequest).state).toBe("resolved");

    expect((await history(made.id)).map((row) => [row.toState, row.actorName])).toEqual([
      ["sent", "Elaine"], ["acknowledged", KEPT], ["accepted", KEPT], ["resolved", KEPT],
    ]);
    const story = await call(f, "colleague", "GET", `/requests/${made.id}/history`);
    expect(story.status).toBe(200);
    expect((story.data as RequestStatusHistoryEntry[]).map((entry) => entry.actorName)).toEqual(["Elaine", KEPT, KEPT, KEPT]);
  });

  it("resolves a request nobody had taken under a long name, through the keyless door too", async () => {
    const f = await fixture();
    const made = await raise(f, "colleague");
    const done = await call(f, "long", "PATCH", `/requests/${made.id}`, { to: "resolved", outcome: "no_longer_needed" });
    expect(done.status).toBe(200);
    expect((done.data as VenueRequest).ownerName).toBe(KEPT);
    expect((await history(made.id)).map((row) => row.actorName)).toEqual(["Elaine", KEPT]);
  });

  it("lists a relief with a long name, hands them requests one at a time and at the end of a shift, and lets them take one", async () => {
    const f = await fixture();
    const first = await raise(f, "colleague");
    expect((await step(f, "colleague", first.id, { to: "accepted" })).status).toBe(200);

    const picker = await call(f, "colleague", "GET", `/venues/${f.venueId}/handlers`);
    expect(picker.status).toBe(200);
    expect((picker.data as VenueHandler[]).find((handler) => handler.id === f.people.relief.id)?.name).toBe(RELIEF_KEPT);

    const handed = await step(f, "colleague", first.id, { to: "handed-over", toUserId: f.people.relief.id });
    expect(handed.status).toBe(200);
    expect((handed.data as VenueRequest).handoverToName).toBe(RELIEF_KEPT);
    const relieved = await step(f, "relief", first.id, { to: "accepted" });
    expect(relieved.status).toBe(200);
    expect((relieved.data as VenueRequest).ownerName).toBe(RELIEF_KEPT);
    expect((await history(first.id)).map((row) => row.actorName)).toEqual(["Elaine", "Elaine", "Elaine", RELIEF_KEPT]);

    // The end of a shift: everything Elaine still holds, to the same relief.
    const second = await raise(f, "colleague");
    expect((await step(f, "colleague", second.id, { to: "accepted" })).status).toBe(200);
    const shift = await call(f, "colleague", "POST", `/venues/${f.venueId}/requests/handover`, { toUserId: f.people.relief.id });
    expect(shift.status).toBe(200);
    const result = shift.data as { handedOver: VenueRequest[]; refused: number; toName: string };
    expect(result.toName).toBe(RELIEF_KEPT);
    expect(result.handedOver.map((request) => [request.id, request.handoverToName])).toEqual([[second.id, RELIEF_KEPT]]);
  });

  it("lets a long name read, mark and write in a request's thread, and its author read the receipt", async () => {
    const f = await fixture();
    const made = await raise(f, "colleague");
    if (made.threadId === null) throw new Error("a request has a thread");

    // Opening the thread delivers Elaine's ask to them.
    const opened = await call(f, "long", "GET", `/threads/${made.threadId}/messages`);
    expect(opened.status).toBe(200);
    const ask = (opened.data as { messages: Message[] }).messages[0];
    if (ask === undefined) throw new Error("the ask is the thread's first message");
    const read = await call(f, "long", "POST", `/messages/${ask.id}/receipt`, { mark: "read" });
    expect(read.status).toBe(200);
    expect((read.data as MessageReceipt).recipientName).toBe(KEPT);

    // Elaine still reads her own thread, with the receipt on her message.
    const authorView = await call(f, "colleague", "GET", `/threads/${made.threadId}/messages`);
    expect(authorView.status).toBe(200);
    const mine = (authorView.data as { messages: Message[] }).messages.find((message) => message.id === ask.id);
    expect(mine?.receipts.map((receipt) => receipt.recipientName)).toEqual([KEPT]);

    const reply = await call(f, "long", "POST", `/threads/${made.threadId}/messages`, { body: "On my way with a jug.", idempotencyKey: randomUUID() });
    expect(reply.status).toBe(201);
    expect((reply.data as Message).authorName).toBe(KEPT);
    const [stored] = await db.select().from(schema.messages).where(eq(schema.messages.id, (reply.data as Message).id));
    expect(stored?.authorName).toBe(KEPT);
  });
});
