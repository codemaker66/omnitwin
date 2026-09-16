import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import {
  createRequestCore,
  listRequestsForVenue,
  readRequest,
  runRequestEscalationPass,
  transitionRequestCore,
  type RequestActor,
  type RequestDeny,
} from "../services/requests.js";

// The gates that only real rows can prove: venue tenancy, the audience fixed
// at creation, the idempotency replay, two phones racing on the same request,
// and the escalation window read from venue_settings rather than from code.
//
// Never loads .env and never falls back to DATABASE_URL. The target must be an
// explicitly named disposable cluster on this machine.
const target = process.env["VENVIEWER_REQUESTS_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:"
    || parsed.hostname !== "127.0.0.1"
    || parsed.pathname !== "/venviewer_lane9_test"
    || parsed.search !== ""
    || parsed.hash !== "") {
    throw new Error("Request tests require the explicit disposable database venviewer_lane9_test on 127.0.0.1");
  }
}

describe.skipIf(target === undefined)("requests on migrated PostgreSQL", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  /** Narrow a list result by its deny shape: `Array.isArray` widens a
   *  readonly array to `any[]`, which is exactly the unsafety the house lint
   *  refuses. */
  function isDeny(result: readonly unknown[] | RequestDeny): result is RequestDeny {
    return "ok" in result;
  }

  function listed<T>(result: readonly T[] | RequestDeny): readonly T[] {
    if (isDeny(result)) throw new Error(`expected a list, not ${result.code}`);
    return result;
  }

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({
      connectionString: target,
      application_name: `lane9_requests_${randomUUID()}`,
      max: 8,
      options: "-c statement_timeout=10000 -c lock_timeout=8000",
    });
    const name = (await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name;
    expect(name).toBe("venviewer_lane9_test");
    db = drizzle(pool, { schema });
  });

  afterAll(async () => { await pool.end(); });

  interface Fixture {
    readonly venueId: string;
    readonly otherVenueId: string;
    readonly roomId: string;
    readonly foreignRoomId: string;
    readonly bookingId: string;
    readonly hallkeeper: RequestActor;
    readonly staff: RequestActor;
    readonly admin: RequestActor;
    readonly outsider: RequestActor;
    readonly adminEmail: string;
  }

  async function fixture(escalationSeconds: number | null = 180): Promise<Fixture> {
    const venueId = randomUUID();
    const otherVenueId = randomUUID();
    const roomId = randomUUID();
    const foreignRoomId = randomUUID();
    const bookingId = randomUUID();
    const outline = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

    for (const id of [venueId, otherVenueId]) {
      await db.insert(schema.venues).values({
        id, name: "TEST ONLY lane 9 requests", slug: id, address: "Disposable fixture",
      });
    }
    await db.insert(schema.spaces).values([
      { id: roomId, venueId, name: "Grand Hall", slug: "grand-hall", widthM: "21", lengthM: "10", heightM: "7", floorPlanOutline: outline },
      { id: foreignRoomId, venueId: otherVenueId, name: "Someone else's room", slug: "other", widthM: "5", lengthM: "5", heightM: "3", floorPlanOutline: outline },
    ]);

    const people = {
      hallkeeper: { id: randomUUID(), role: "hallkeeper", venueId },
      staff: { id: randomUUID(), role: "staff", venueId },
      admin: { id: randomUUID(), role: "admin", venueId },
      outsider: { id: randomUUID(), role: "hallkeeper", venueId: otherVenueId },
    } as const;
    for (const [label, person] of Object.entries(people)) {
      await db.insert(schema.users).values({
        id: person.id,
        venueId: person.venueId,
        name: `Fixture ${label}`,
        email: `${person.id}@lane9.invalid`,
        role: person.role,
      });
    }

    await db.insert(schema.bookings).values({
      id: bookingId, venueId, spaceId: roomId, kind: "ink", title: "Fixture booking",
      createdBy: people.admin.id,
      startsAt: new Date("2030-01-10T10:00:00.000Z"),
      endsAt: new Date("2030-01-10T12:00:00.000Z"),
    });

    if (escalationSeconds !== null) {
      await db.insert(schema.venueSettings).values({ venueId, requestEscalationSeconds: escalationSeconds });
    }

    const actor = (
      person: { readonly id: string; readonly role: string; readonly venueId: string },
      name: string,
    ): RequestActor => ({
      id: person.id, name, role: person.role, venueId: person.venueId, platformRole: "none",
    });

    return {
      venueId, otherVenueId, roomId, foreignRoomId, bookingId,
      hallkeeper: actor(people.hallkeeper, "Elaine"),
      staff: actor(people.staff, "Fiona"),
      admin: actor(people.admin, "The administrator"),
      outsider: actor(people.outsider, "Someone from elsewhere"),
      adminEmail: `${people.admin.id}@lane9.invalid`,
    };
  }

  function press(
    f: Fixture,
    over: Partial<Parameters<typeof createRequestCore>[3]> = {},
  ): Parameters<typeof createRequestCore>[3] {
    return {
      roomId: f.roomId,
      bookingId: f.bookingId,
      eventId: null,
      kind: "refreshments",
      quantity: 6,
      urgency: "now",
      detail: "Six more jugs of water on the top table, please.",
      idempotencyKey: randomUUID(),
      ...over,
    };
  }

  it("makes a request, stamps it sent, and writes its first step of history", async () => {
    const f = await fixture();
    const made = await createRequestCore(db, f.hallkeeper, f.venueId, press(f));
    if (!("request" in made)) throw new Error("expected a request");

    expect(made.request.state).toBe("sent");
    expect(made.request.roomName).toBe("Grand Hall");
    expect(made.request.requestedByName).toBe("Elaine");
    expect(made.replay).toBe(false);

    const history = await db.select().from(schema.requestStatusHistory)
      .where(eq(schema.requestStatusHistory.requestId, made.request.id));
    expect(history).toHaveLength(1);
    expect(history[0]?.fromState).toBeNull();
    expect(history[0]?.toState).toBe("sent");
  });

  it("returns the SAME request when the same press arrives twice", async () => {
    const f = await fixture();
    const body = press(f);
    const first = await createRequestCore(db, f.hallkeeper, f.venueId, body);
    const second = await createRequestCore(db, f.staff, f.venueId, body);
    if (!("request" in first) || !("request" in second)) throw new Error("expected requests");

    expect(second.request.id).toBe(first.request.id);
    expect(second.replay).toBe(true);
    // The replay wrote nothing: still one row, and the requester is still the
    // person who actually pressed the button.
    expect(second.request.requestedByName).toBe("Elaine");
    const rows = await db.select().from(schema.requests)
      .where(eq(schema.requests.idempotencyKey, body.idempotencyKey));
    expect(rows).toHaveLength(1);
  });

  it("returns one request when two phones press the same key at the same instant", async () => {
    const f = await fixture();
    const body = press(f);
    const [a, b] = await Promise.all([
      createRequestCore(db, f.hallkeeper, f.venueId, body),
      createRequestCore(db, f.staff, f.venueId, body),
    ]);
    if (!("request" in a) || !("request" in b)) throw new Error("expected requests");
    expect(a.request.id).toBe(b.request.id);
    const rows = await db.select().from(schema.requests)
      .where(eq(schema.requests.idempotencyKey, body.idempotencyKey));
    expect(rows).toHaveLength(1);
  });

  it("fixes the audience at creation and never widens it afterwards", async () => {
    const f = await fixture();
    const made = await createRequestCore(db, f.hallkeeper, f.venueId, press(f));
    if (!("request" in made)) throw new Error("expected a request");
    const audienceAtCreation = [...made.request.audienceRoles].sort();
    expect(audienceAtCreation).toContain("hallkeeper");
    expect(audienceAtCreation).not.toContain("client");

    await transitionRequestCore(db, f.staff, made.request.id, { to: "acknowledged" });
    const after = await transitionRequestCore(db, f.admin, made.request.id, { to: "accepted" });
    if (!("request" in after)) throw new Error("expected a request");
    expect([...after.request.audienceRoles].sort()).toEqual(audienceAtCreation);

    const [row] = await db.select().from(schema.requests).where(eq(schema.requests.id, made.request.id));
    expect([...(row?.audienceRoles ?? [])].sort()).toEqual(audienceAtCreation);
  });

  it("hides a request from a colleague who is not in its audience", async () => {
    const f = await fixture();
    const narrowId = randomUUID();
    await db.insert(schema.requests).values({
      id: narrowId, venueId: f.venueId, roomId: f.roomId, kind: "access", urgency: "routine",
      requestedByUserId: f.admin.id, requestedByName: "The administrator", requestedByRole: "admin",
      audienceRoles: ["admin"], idempotencyKey: randomUUID(),
    });

    const seenByHallkeeper = listed(await listRequestsForVenue(db, f.hallkeeper, f.venueId, { status: "open", limit: 50 }));
    expect(seenByHallkeeper.map((item) => item.id)).not.toContain(narrowId);

    const seenByAdmin = listed(await listRequestsForVenue(db, f.admin, f.venueId, { status: "open", limit: 50 }));
    expect(seenByAdmin.map((item) => item.id)).toContain(narrowId);

    const readDenied = await readRequest(db, f.hallkeeper, narrowId);
    expect("status" in readDenied && readDenied.status).toBe(403);
    const moveDenied = await transitionRequestCore(db, f.hallkeeper, narrowId, { to: "acknowledged" });
    expect("status" in moveDenied && moveDenied.status).toBe(403);
  });

  it("keeps another venue's floor out", async () => {
    const f = await fixture();
    const made = await createRequestCore(db, f.hallkeeper, f.venueId, press(f));
    if (!("request" in made)) throw new Error("expected a request");

    const create = await createRequestCore(db, f.outsider, f.venueId, press(f));
    expect("status" in create && create.status).toBe(403);
    const list = await listRequestsForVenue(db, f.outsider, f.venueId, { status: "open", limit: 50 });
    expect(isDeny(list) && list.status).toBe(403);
    const read = await readRequest(db, f.outsider, made.request.id);
    expect("status" in read && read.status).toBe(403);
    const move = await transitionRequestCore(db, f.outsider, made.request.id, { to: "acknowledged" });
    expect("status" in move && move.status).toBe(403);
  });

  it("refuses a room that belongs to a different venue", async () => {
    const f = await fixture();
    const made = await createRequestCore(db, f.hallkeeper, f.venueId, press(f, { roomId: f.foreignRoomId }));
    expect("status" in made && made.status).toBe(400);
    expect("code" in made && made.code).toBe("ROOM_NOT_IN_VENUE");
  });

  it("walks the ladder and stamps each step", async () => {
    const f = await fixture();
    const made = await createRequestCore(db, f.hallkeeper, f.venueId, press(f));
    if (!("request" in made)) throw new Error("expected a request");

    const seen = await transitionRequestCore(db, f.staff, made.request.id, { to: "acknowledged" });
    if (!("request" in seen)) throw new Error("expected a request");
    expect(seen.request.state).toBe("acknowledged");
    expect(seen.request.acknowledgedAt).not.toBeNull();

    const taken = await transitionRequestCore(db, f.staff, made.request.id, { to: "accepted" });
    if (!("request" in taken)) throw new Error("expected a request");
    expect(taken.request.ownerName).toBe("Fiona");

    const done = await transitionRequestCore(db, f.staff, made.request.id, {
      to: "resolved", outcome: "done", note: "Water is on the table.",
    });
    if (!("request" in done)) throw new Error("expected a request");
    expect(done.request.state).toBe("resolved");
    expect(done.request.outcome).toBe("done");
    expect(done.request.outcomeNote).toBe("Water is on the table.");

    const history = await db.select().from(schema.requestStatusHistory)
      .where(eq(schema.requestStatusHistory.requestId, made.request.id));
    expect(history).toHaveLength(4);
  });

  it("lets only one of two colleagues win the same step", async () => {
    const f = await fixture();
    const made = await createRequestCore(db, f.hallkeeper, f.venueId, press(f));
    if (!("request" in made)) throw new Error("expected a request");

    const [a, b] = await Promise.all([
      transitionRequestCore(db, f.staff, made.request.id, { to: "accepted" }),
      transitionRequestCore(db, f.admin, made.request.id, { to: "accepted" }),
    ]);
    const wins = [a, b].filter((result) => "request" in result);
    const losses = [a, b].filter((result) => "status" in result && result.status === 409);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
  });

  it("refuses to move a request that is already finished", async () => {
    const f = await fixture();
    const made = await createRequestCore(db, f.hallkeeper, f.venueId, press(f));
    if (!("request" in made)) throw new Error("expected a request");
    await transitionRequestCore(db, f.staff, made.request.id, { to: "resolved", outcome: "done" });
    const again = await transitionRequestCore(db, f.staff, made.request.id, { to: "accepted" });
    expect("status" in again && again.status).toBe(409);
  });

  it("reads the escalation window from the venue's row, not from code", async () => {
    const withWindow = await fixture(180);
    const urgent = await createRequestCore(db, withWindow.hallkeeper, withWindow.venueId, press(withWindow));
    if (!("request" in urgent)) throw new Error("expected a request");
    expect(urgent.request.escalationDueAt).not.toBeNull();
    const due = Date.parse(urgent.request.escalationDueAt ?? "");
    const made = Date.parse(urgent.request.createdAt);
    expect(Math.round((due - made) / 1000)).toBe(180);

    const noWindow = await fixture(null);
    const unwatched = await createRequestCore(db, noWindow.hallkeeper, noWindow.venueId, press(noWindow));
    if (!("request" in unwatched)) throw new Error("expected a request");
    expect(unwatched.request.escalationDueAt).toBeNull();
  });

  it("gives a routine request no escalation window at all", async () => {
    const f = await fixture(180);
    const calm = await createRequestCore(db, f.hallkeeper, f.venueId, press(f, { urgency: "routine" }));
    if (!("request" in calm)) throw new Error("expected a request");
    expect(calm.request.escalationDueAt).toBeNull();
  });

  it("escalates an unanswered urgent request to the venue administrator, once", async () => {
    const f = await fixture(180);
    const made = await createRequestCore(db, f.hallkeeper, f.venueId, press(f));
    if (!("request" in made)) throw new Error("expected a request");

    const sentTo: string[] = [];
    const send = (payload: { readonly to: string }): Promise<boolean> => {
      sentTo.push(payload.to);
      return Promise.resolve(true);
    };
    const later = new Date(Date.now() + 200_000);

    const first = await runRequestEscalationPass(db, { now: later, send });
    expect(first.filter((item) => item.request.id === made.request.id)).toHaveLength(1);
    expect(sentTo).toContain(f.adminEmail);
    const sentCount = sentTo.length;

    const notifications = await db.select().from(schema.eventPlanNotifications)
      .where(eq(schema.eventPlanNotifications.recipientUserId, f.admin.id));
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications[0]?.severity).toBe("urgent");

    // The escalation is addressed to people, not to a role, so the pass must
    // hand back WHO it reached — otherwise the live frame cannot be addressed
    // the same way and the number on their nav sits still until they navigate.
    const mine = first.find((item) => item.request.id === made.request.id);
    expect(mine?.recipientUserIds).toContain(f.admin.id);
    expect(mine?.notificationIds).toHaveLength(mine?.recipientUserIds.length ?? -1);

    // A second sweep finds nothing: the claim is the row, not the schedule.
    const second = await runRequestEscalationPass(db, { now: later, send });
    expect(second.filter((item) => item.request.id === made.request.id)).toHaveLength(0);
    expect(sentTo).toHaveLength(sentCount);
  });

  it("never escalates a request somebody has already answered", async () => {
    const f = await fixture(180);
    const made = await createRequestCore(db, f.hallkeeper, f.venueId, press(f));
    if (!("request" in made)) throw new Error("expected a request");
    await transitionRequestCore(db, f.staff, made.request.id, { to: "acknowledged" });

    const escalated = await runRequestEscalationPass(db, {
      now: new Date(Date.now() + 200_000),
      send: () => Promise.resolve(true),
    });
    expect(escalated.filter((item) => item.request.id === made.request.id)).toHaveLength(0);
  });

  it("shows the booking's own requests to the slab and drops finished ones", async () => {
    const f = await fixture();
    const open = await createRequestCore(db, f.hallkeeper, f.venueId, press(f));
    const closed = await createRequestCore(db, f.hallkeeper, f.venueId, press(f, { kind: "cleaning" }));
    if (!("request" in open) || !("request" in closed)) throw new Error("expected requests");
    await transitionRequestCore(db, f.staff, closed.request.id, { to: "resolved", outcome: "done" });

    const slab = listed(await listRequestsForVenue(db, f.hallkeeper, f.venueId, {
      status: "open", limit: 50, bookingId: f.bookingId,
    }));
    expect(slab.map((item) => item.id)).toContain(open.request.id);
    expect(slab.map((item) => item.id)).not.toContain(closed.request.id);

    const everything = listed(await listRequestsForVenue(db, f.hallkeeper, f.venueId, {
      status: "all", limit: 50, bookingId: f.bookingId,
    }));
    expect(everything.map((item) => item.id)).toContain(closed.request.id);
  });
});
