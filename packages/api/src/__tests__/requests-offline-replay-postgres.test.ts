import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RequestTransition, VenueRequest } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { requestRoutes } from "../routes/requests.js";
import { insertBoundBookings } from "../services/event-binding.js";
import { createRequestCore, type RequestActor } from "../services/requests.js";
import { subscribe } from "../observability/event-bus.js";

// L9 — a request step pressed with no connection, replayed later by the
// event-day offline queue through PATCH /requests/:id with the key it was
// pressed with. Real rows prove what mocks cannot: the replay is one
// transition however often it is sent, a step someone else's move overtook
// is refused with who has it (and refused the same way again), queued steps
// replay in order, and a press from someone whose access has since gone is
// refused rather than applied in their old name.
//
// Never loads .env and never falls back to DATABASE_URL. The target must be an
// explicitly named disposable cluster on this machine. The routes
// authenticate with the test-mode bearer, built from the users row as it
// stands, as production's Clerk resolution reads it on every request.
process.env["NODE_ENV"] = "test";
const target = process.env["VENVIEWER_REQUESTS_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:"
    || parsed.hostname !== "127.0.0.1"
    || parsed.pathname !== "/venviewer_lane9_test"
    || parsed.search !== ""
    || parsed.hash !== "") {
    throw new Error("Request replay tests require the explicit disposable database venviewer_lane9_test on 127.0.0.1");
  }
}

describe.skipIf(target === undefined)("offline request steps replayed on migrated PostgreSQL", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let server: FastifyInstance;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({
      connectionString: target,
      application_name: `l9_offline_replay_${randomUUID()}`,
      max: 8,
      options: "-c statement_timeout=10000 -c lock_timeout=8000",
    });
    const name = (await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name;
    expect(name).toBe("venviewer_lane9_test");
    await migrate(drizzle(pool), { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(requestRoutes, { db, prefix: "/requests" });
    await server.ready();
  }, 300_000);

  afterAll(async () => {
    await server.close();
    await pool.end();
  });

  interface Fixture {
    readonly venueId: string;
    readonly otherVenueId: string;
    readonly requestId: string;
    readonly elaine: string;
    readonly graham: string;
    readonly outsider: string;
  }

  async function fixture(): Promise<Fixture> {
    const venueId = randomUUID();
    const otherVenueId = randomUUID();
    const roomId = randomUUID();
    const bookingId = randomUUID();
    const outline = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    for (const id of [venueId, otherVenueId]) {
      await db.insert(schema.venues).values({ id, name: "TEST ONLY L9 offline replay", slug: id, address: "Disposable fixture" });
    }
    await db.insert(schema.spaces).values({
      id: roomId, venueId, name: "Grand Hall", slug: "grand-hall", widthM: "21", lengthM: "10", heightM: "7", floorPlanOutline: outline,
    });
    const people = {
      elaine: { id: randomUUID(), role: "hallkeeper", venueId, name: "Elaine" },
      graham: { id: randomUUID(), role: "hallkeeper", venueId, name: "Graham" },
      fiona: { id: randomUUID(), role: "staff", venueId, name: "Fiona" },
      outsider: { id: randomUUID(), role: "hallkeeper", venueId: otherVenueId, name: "Someone from elsewhere" },
    } as const;
    for (const person of Object.values(people)) {
      await db.insert(schema.users).values({
        id: person.id, venueId: person.venueId, name: person.name, email: `${person.id}@l9.invalid`, role: person.role,
      });
    }
    await insertBoundBookings(db, [{
      id: bookingId, venueId, spaceId: roomId, kind: "ink", title: "Fixture booking", createdBy: people.fiona.id,
      startsAt: new Date("2030-01-10T10:00:00.000Z"), endsAt: new Date("2030-01-10T12:00:00.000Z"),
    }]);
    const fiona: RequestActor = { id: people.fiona.id, name: "Fiona", role: "staff", venueId, platformRole: "none" };
    const made = await createRequestCore(db, fiona, venueId, {
      roomId, bookingId, eventId: null, kind: "chairs", quantity: 10, urgency: "now",
      detail: "Ten more chairs at the back, please.", idempotencyKey: randomUUID(),
    });
    if (!("request" in made)) throw new Error("expected a request");
    return {
      venueId, otherVenueId, requestId: made.request.id,
      elaine: people.elaine.id, graham: people.graham.id, outsider: people.outsider.id,
    };
  }

  /** The bearer authenticate would resolve for this person now: their row as it stands. */
  async function as(userId: string): Promise<{ authorization: string }> {
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    if (row === undefined) throw new Error("no such fixture person");
    return {
      authorization: `Bearer ${JSON.stringify({
        id: row.id, email: row.email, name: row.name, role: row.role, venueId: row.venueId,
      })}`,
    };
  }

  async function step(userId: string, requestId: string, transition: RequestTransition, key: string | null) {
    const headers: Record<string, string> = await as(userId);
    if (key !== null) headers["idempotency-key"] = key;
    return server.inject({ method: "PATCH", url: `/requests/${requestId}`, headers, payload: transition });
  }

  async function history(requestId: string) {
    return db.select().from(schema.requestStatusHistory)
      .where(eq(schema.requestStatusHistory.requestId, requestId))
      .orderBy(schema.requestStatusHistory.at);
  }

  async function row(requestId: string) {
    const [found] = await db.select().from(schema.requests).where(eq(schema.requests.id, requestId)).limit(1);
    if (found === undefined) throw new Error("request gone");
    return found;
  }

  it("applies a queued acknowledge once; the same key sent again is a replay, not a second step", async () => {
    const f = await fixture();
    const key = randomUUID();
    const first = await step(f.elaine, f.requestId, { to: "acknowledged" }, key);
    expect(first.statusCode).toBe(200);
    expect(first.headers["idempotency-replay"]).toBe("false");
    expect(first.json<{ data: VenueRequest }>().data.state).toBe("acknowledged");

    // The answer was lost on the way back; the queue sends it again.
    const again = await step(f.elaine, f.requestId, { to: "acknowledged" }, key);
    expect(again.statusCode).toBe(200);
    expect(again.headers["idempotency-replay"]).toBe("true");
    expect(again.json<{ data: VenueRequest }>().data.state).toBe("acknowledged");

    const steps = await history(f.requestId);
    expect(steps.map((entry) => entry.toState)).toEqual(["sent", "acknowledged"]);
    const ledger = await db.select().from(schema.diaryCommands).where(eq(schema.diaryCommands.commandId, key));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.kind).toBe("request.acknowledge");
    expect(ledger[0]?.outcome).toBe("applied");
    expect(ledger[0]?.venueId).toBe(f.venueId);
  });

  it("replays an accept that already landed as that accept, even after the request moved on", async () => {
    const f = await fixture();
    const accept = randomUUID();
    expect((await step(f.elaine, f.requestId, { to: "accepted" }, accept)).statusCode).toBe(200);
    // Elaine finishes it from another screen before this phone's queue drains.
    expect((await step(f.elaine, f.requestId, { to: "resolved", outcome: "done" }, randomUUID())).statusCode).toBe(200);

    const replayed = await step(f.elaine, f.requestId, { to: "accepted" }, accept);
    expect(replayed.statusCode).toBe(200);
    expect(replayed.headers["idempotency-replay"]).toBe("true");
    // The fresh state is the row's, never the ledger's memory.
    expect(replayed.json<{ data: VenueRequest }>().data.state).toBe("resolved");

    const steps = await history(f.requestId);
    expect(steps.filter((entry) => entry.toState === "accepted")).toHaveLength(1);
    expect((await row(f.requestId)).ownerUserId).toBe(f.elaine);
  });

  it("refuses a queued accept when someone else took it first, names them, and refuses the resend the same way", async () => {
    const f = await fixture();
    // Graham takes it while Elaine's phone is in the cellar.
    expect((await step(f.graham, f.requestId, { to: "accepted" }, randomUUID())).statusCode).toBe(200);

    const key = randomUUID();
    const late = await step(f.elaine, f.requestId, { to: "accepted" }, key);
    expect(late.statusCode).toBe(409);
    expect(late.json<{ code: string; error: string; ownerName: string }>()).toMatchObject({
      code: "REQUEST_TAKEN", error: "Graham has this.", ownerName: "Graham",
    });

    const resent = await step(f.elaine, f.requestId, { to: "accepted" }, key);
    expect(resent.statusCode).toBe(409);
    expect(resent.headers["idempotency-replay"]).toBe("true");
    expect(resent.json<{ code: string; error: string; ownerName: string }>()).toMatchObject({
      code: "REQUEST_TAKEN", error: "Graham has this.", ownerName: "Graham",
    });

    const current = await row(f.requestId);
    expect(current.ownerUserId).toBe(f.graham);
    expect(current.ownerName).toBe("Graham");
    expect((await history(f.requestId)).filter((entry) => entry.toState === "accepted")).toHaveLength(1);
    const [recorded] = await db.select().from(schema.diaryCommands).where(eq(schema.diaryCommands.commandId, key));
    expect(recorded?.outcome).toBe("rejected");
    expect(recorded?.errorCode).toBe("REQUEST_TAKEN");
  });

  it("refuses a queued step the ladder no longer has, without moving the request", async () => {
    const f = await fixture();
    expect((await step(f.graham, f.requestId, { to: "resolved", outcome: "done" }, randomUUID())).statusCode).toBe(200);
    const late = await step(f.elaine, f.requestId, { to: "acknowledged" }, randomUUID());
    expect(late.statusCode).toBe(409);
    expect(late.json<{ code: string }>().code).toBe("REQUEST_STATE_CONFLICT");
    expect((await row(f.requestId)).state).toBe("resolved");
  });

  it("replays acknowledge, accept and resolve in the order they were pressed, and a second drain changes nothing", async () => {
    const f = await fixture();
    const queue: readonly { readonly key: string; readonly transition: RequestTransition }[] = [
      { key: randomUUID(), transition: { to: "acknowledged" } },
      { key: randomUUID(), transition: { to: "accepted" } },
      { key: randomUUID(), transition: { to: "resolved", outcome: "done", note: "Ten from the store" } },
    ];
    for (const queued of queue) {
      const res = await step(f.elaine, f.requestId, queued.transition, queued.key);
      expect(res.statusCode).toBe(200);
      expect(res.headers["idempotency-replay"]).toBe("false");
    }
    for (const queued of queue) {
      const res = await step(f.elaine, f.requestId, queued.transition, queued.key);
      expect(res.statusCode).toBe(200);
      expect(res.headers["idempotency-replay"]).toBe("true");
    }
    const steps = await history(f.requestId);
    expect(steps.map((entry) => entry.toState)).toEqual(["sent", "acknowledged", "accepted", "resolved"]);
    expect(steps.every((entry) => entry.toState === "sent" || entry.actorUserId === f.elaine)).toBe(true);
    const finished = await row(f.requestId);
    expect(finished.outcome).toBe("done");
    expect(finished.outcomeNote).toBe("Ten from the store");
  });

  it("refuses a queued step from someone whose floor access was withdrawn before it was ever sent", async () => {
    const f = await fixture();
    // Elaine pressed "I'll do it" offline; before the phone reconnects her
    // account stops being a hallkeeper here.
    await db.update(schema.users).set({ role: "planner" }).where(eq(schema.users.id, f.elaine));
    const key = randomUUID();
    const res = await step(f.elaine, f.requestId, { to: "accepted" }, key);
    expect(res.statusCode).toBe(403);
    expect(res.json<{ code: string }>().code).toBe("FORBIDDEN");
    const untouched = await row(f.requestId);
    expect(untouched.state).toBe("sent");
    expect(untouched.ownerUserId).toBeNull();
    // And resending it never changes the answer.
    expect((await step(f.elaine, f.requestId, { to: "accepted" }, key)).statusCode).toBe(403);
    expect((await row(f.requestId)).state).toBe("sent");
  });

  it("refuses to replay a step that landed to someone who has since left the venue, and shows them nothing", async () => {
    const f = await fixture();
    const key = randomUUID();
    expect((await step(f.elaine, f.requestId, { to: "acknowledged" }, key)).statusCode).toBe(200);
    await db.update(schema.users).set({ venueId: f.otherVenueId }).where(eq(schema.users.id, f.elaine));

    const res = await step(f.elaine, f.requestId, { to: "acknowledged" }, key);
    expect(res.statusCode).toBe(403);
    expect(res.headers["idempotency-replay"]).toBe("true");
    const body = res.json<Record<string, unknown>>();
    expect(body["code"]).toBe("FORBIDDEN");
    expect(body["data"]).toBeUndefined();
  });

  it("refuses another venue's hallkeeper, whose key cannot replay this venue's step either", async () => {
    const f = await fixture();
    const key = randomUUID();
    expect((await step(f.elaine, f.requestId, { to: "acknowledged" }, key)).statusCode).toBe(200);
    // The same key from a stranger: the ledger's venue is not theirs.
    const stolen = await step(f.outsider, f.requestId, { to: "acknowledged" }, key);
    expect(stolen.statusCode).toBe(403);
    expect(stolen.json<Record<string, unknown>>()["data"]).toBeUndefined();
    // A fresh key from the stranger is refused by the core.
    expect((await step(f.outsider, f.requestId, { to: "accepted" }, randomUUID())).statusCode).toBe(403);
    expect((await row(f.requestId)).state).toBe("acknowledged");
  });

  it("announces a keyed step once, when it commits, and never on its replay", async () => {
    const f = await fixture();
    const heard: string[] = [];
    const stop = subscribe("request.changed", {
      name: "l9-offline-replay-test",
      handle: (payload) => { if (payload.requestId === f.requestId) heard.push(payload.state); },
    });
    try {
      const key = randomUUID();
      await step(f.elaine, f.requestId, { to: "accepted" }, key);
      await step(f.elaine, f.requestId, { to: "accepted" }, key);
      // The bus runs its subscribers after the reply; let it.
      await new Promise((settle) => { setTimeout(settle, 50); });
      expect(heard).toEqual(["accepted"]);
    } finally {
      stop();
    }
  });

  it("refuses a queued step pressed against a state the request has left, and leaves a colleague's work alone", async () => {
    const f = await fixture();
    // Elaine presses "Could not" in the cellar while the request is still sent.
    const key = randomUUID();
    // Meanwhile Graham takes it and starts.
    expect((await step(f.graham, f.requestId, { to: "accepted" }, randomUUID())).statusCode).toBe(200);
    expect((await step(f.graham, f.requestId, { to: "underway" }, randomUUID())).statusCode).toBe(200);

    const late = await step(f.elaine, f.requestId, { to: "resolved", outcome: "not_possible", expectedState: "sent" }, key);
    expect(late.statusCode).toBe(409);
    expect(late.json<{ code: string; error: string; ownerName: string }>()).toMatchObject({
      code: "REQUEST_STATE_CONFLICT", error: "Graham has this now.", ownerName: "Graham",
    });
    const current = await row(f.requestId);
    expect(current.state).toBe("underway");
    expect(current.ownerUserId).toBe(f.graham);
    expect(current.outcome).toBeNull();
    // Refused for good: the resend is the same refusal.
    const resent = await step(f.elaine, f.requestId, { to: "resolved", outcome: "not_possible", expectedState: "sent" }, key);
    expect(resent.statusCode).toBe(409);
    expect(resent.headers["idempotency-replay"]).toBe("true");
    expect((await row(f.requestId)).state).toBe("underway");
  });

  it("applies a queued chain whose every step was pressed against the state the one before it left", async () => {
    const f = await fixture();
    const seen = await step(f.elaine, f.requestId, { to: "acknowledged", expectedState: "sent" }, randomUUID());
    const taken = await step(f.elaine, f.requestId, { to: "accepted", expectedState: "acknowledged" }, randomUUID());
    const done = await step(f.elaine, f.requestId, { to: "resolved", outcome: "done", expectedState: "accepted" }, randomUUID());
    expect([seen.statusCode, taken.statusCode, done.statusCode]).toEqual([200, 200, 200]);
    expect((await row(f.requestId)).state).toBe("resolved");
  });

  it("takes a key sent twice at once as one step: a handover is handed over once, an accept recorded as applied", async () => {
    for (let round = 0; round < 20; round += 1) {
      const f = await fixture();
      expect((await step(f.elaine, f.requestId, { to: "accepted" }, randomUUID())).statusCode).toBe(200);
      const key = randomUUID();
      // Two tabs replaying one queue on the same "online".
      const [first, second] = await Promise.all([
        step(f.elaine, f.requestId, { to: "handed-over", toUserId: f.graham }, key),
        step(f.elaine, f.requestId, { to: "handed-over", toUserId: f.graham }, key),
      ]);
      expect([first.statusCode, second.statusCode], `round ${String(round)}`).toEqual([200, 200]);
      expect([first.headers["idempotency-replay"], second.headers["idempotency-replay"]].sort()).toEqual(["false", "true"]);
      const handovers = (await history(f.requestId)).filter((entry) => entry.toState === "handed-over");
      expect(handovers, `round ${String(round)}`).toHaveLength(1);
      const ledger = await db.select().from(schema.diaryCommands).where(eq(schema.diaryCommands.commandId, key));
      expect(ledger).toHaveLength(1);
      expect(ledger[0]?.outcome).toBe("applied");
    }
    for (let round = 0; round < 20; round += 1) {
      const f = await fixture();
      const key = randomUUID();
      const [first, second] = await Promise.all([
        step(f.elaine, f.requestId, { to: "accepted" }, key),
        step(f.elaine, f.requestId, { to: "accepted" }, key),
      ]);
      expect([first.statusCode, second.statusCode], `round ${String(round)}`).toEqual([200, 200]);
      const [ledger] = await db.select().from(schema.diaryCommands).where(eq(schema.diaryCommands.commandId, key));
      expect(ledger?.outcome).toBe("applied");
      expect((await history(f.requestId)).filter((entry) => entry.toState === "accepted")).toHaveLength(1);
      expect((await row(f.requestId)).ownerUserId).toBe(f.elaine);
    }
  }, 120_000);

  it("refuses a key sent by anyone but the person who pressed it, or for another step", async () => {
    const f = await fixture();
    const key = randomUUID();
    expect((await step(f.elaine, f.requestId, { to: "acknowledged" }, key)).statusCode).toBe(200);
    // A colleague at the same venue with Elaine's key is not handed her outcome.
    const borrowed = await step(f.graham, f.requestId, { to: "acknowledged" }, key);
    expect(borrowed.statusCode).toBe(409);
    expect(borrowed.json<Record<string, unknown>>()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect(borrowed.json<Record<string, unknown>>()["data"]).toBeUndefined();
    // Nor is the same key a different step for Elaine.
    const otherStep = await step(f.elaine, f.requestId, { to: "accepted" }, key);
    expect(otherStep.statusCode).toBe(409);
    expect(otherStep.json<{ code: string }>().code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect((await row(f.requestId)).state).toBe("acknowledged");
  });

  it("keeps the keyless step exactly as it was: a second press meets the ladder", async () => {
    const f = await fixture();
    expect((await step(f.elaine, f.requestId, { to: "acknowledged" }, null)).statusCode).toBe(200);
    const twice = await step(f.elaine, f.requestId, { to: "acknowledged" }, null);
    expect(twice.statusCode).toBe(409);
    expect(twice.json<{ code: string }>().code).toBe("REQUEST_STATE_CONFLICT");
    const ledger = await db.select().from(schema.diaryCommands)
      .where(and(eq(schema.diaryCommands.venueId, f.venueId), eq(schema.diaryCommands.kind, "request.acknowledge")));
    expect(ledger).toHaveLength(0);
  });
});
