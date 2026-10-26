import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import Fastify from "fastify";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STAFF_AUDIENCE_ROLES } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { EMAIL_RETRY_MS, planNextWake } from "../services/escalation-scheduler.js";
import { notificationRoutes } from "../routes/event-plan-lifecycle.js";
import { insertBoundBookings } from "../services/event-binding.js";
import {
  createRequestCore,
  listRequestsForVenue,
  handoverShiftCore,
  readRequest,
  runEscalationEmailPass,
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
// The notification routes below authenticate with the test-mode bearer.
process.env["NODE_ENV"] = "test";
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
    // The journal, applied to the confirmed disposable target: a fresh
    // database (CI's) gets every migration, a migrated one gets nothing.
    await migrate(drizzle(pool), { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
    db = drizzle(pool, { schema });
  }, 120_000);

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

    // A confirmed booking is written with its event (the bind).
    await insertBoundBookings(db, [{
      id: bookingId, venueId, spaceId: roomId, kind: "ink", title: "Fixture booking",
      createdBy: people.admin.id,
      startsAt: new Date("2030-01-10T10:00:00.000Z"),
      endsAt: new Date("2030-01-10T12:00:00.000Z"),
    }]);

    if (escalationSeconds !== null) {
      // The "now" window; the other windows and quiet hours keep the
      // decided defaults (soon 300 s, routine 900 s, quiet 22:00 to 07:00).
      await db.insert(schema.venueSettings).values({
        venueId, requestEscalationSeconds: escalationSeconds, escalationNowSeconds: escalationSeconds,
      });
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

    // The inbox copy: one row per floor role, and none for a role that works
    // the pipeline or reaches the venue only through an event share.
    const inbox = await db.select({ role: schema.eventPlanNotifications.audienceRole })
      .from(schema.eventPlanNotifications)
      .where(eq(schema.eventPlanNotifications.venueId, f.venueId));
    expect(inbox.map((row) => row.role).sort()).toEqual(["admin", "hallkeeper", "manager", "staff"]);
  });

  it("counts exactly the unread the inbox lists, and nothing from another venue", async () => {
    // The dashboard's one unread number comes from /notifications/unread-count
    // and the panel lists /notifications. The two queries repeat one
    // visibility rule, so they are held to the same answer on real rows.
    const f = await fixture();
    await createRequestCore(db, f.hallkeeper, f.venueId, press(f));
    await createRequestCore(db, f.staff, f.venueId, press(f, { urgency: "routine" }));

    const server = Fastify();
    await server.register(notificationRoutes, { db, prefix: "/notifications" });
    await server.ready();
    const as = (actor: RequestActor): { authorization: string } => ({
      authorization: `Bearer ${JSON.stringify({
        id: actor.id, email: `${actor.id}@lane9.invalid`, name: actor.name, role: actor.role, venueId: actor.venueId,
      })}`,
    });
    const count = async (actor: RequestActor): Promise<number> => {
      const res = await server.inject({ method: "GET", url: "/notifications/unread-count", headers: as(actor) });
      expect(res.statusCode).toBe(200);
      return (JSON.parse(res.body) as { data: { unread: number } }).data.unread;
    };
    const unreadList = async (actor: RequestActor): Promise<readonly string[]> => {
      const res = await server.inject({ method: "GET", url: "/notifications?status=unread&limit=100", headers: as(actor) });
      expect(res.statusCode).toBe(200);
      return (JSON.parse(res.body) as { data: { id: string }[] }).data.map((row) => row.id);
    };

    try {
      const listed = await unreadList(f.hallkeeper);
      expect(listed.length).toBe(2);
      expect(await count(f.hallkeeper)).toBe(listed.length);

      const first = listed[0];
      if (first === undefined) throw new Error("expected an unread notification");
      const read = await server.inject({ method: "PATCH", url: `/notifications/${first}/read`, headers: as(f.hallkeeper) });
      expect(read.statusCode).toBe(200);
      expect(await count(f.hallkeeper)).toBe(1);
      expect(await unreadList(f.hallkeeper)).toHaveLength(1);

      const elsewhere = await unreadList(f.outsider);
      expect(await count(f.outsider)).toBe(elsewhere.length);
      expect(elsewhere).not.toContain(first);
    } finally {
      await server.close();
    }
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
    expect(audienceAtCreation).toEqual([...STAFF_AUDIENCE_ROLES].sort());
    for (const offFloor of ["client", "planner", "sales", "caterer"]) {
      expect(audienceAtCreation).not.toContain(offFloor);
    }

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

  it("refuses an event that belongs to a different venue, and names one of its own", async () => {
    const f = await fixture();
    const theirs = randomUUID(), ours = randomUUID();
    await db.insert(schema.events).values([
      { id: theirs, venueId: f.otherVenueId, createdBy: f.outsider.id, name: "Someone else's dinner" },
      { id: ours, venueId: f.venueId, createdBy: f.admin.id, name: "The Smith wedding" },
    ]);
    const refused = await createRequestCore(db, f.hallkeeper, f.venueId, press(f, { bookingId: null, eventId: theirs }));
    expect("status" in refused && refused.status).toBe(400);
    expect("code" in refused && refused.code).toBe("EVENT_NOT_IN_VENUE");
    expect(await db.select({ id: schema.requests.id }).from(schema.requests).where(eq(schema.requests.eventId, theirs))).toEqual([]);
    const made = await createRequestCore(db, f.hallkeeper, f.venueId, press(f, { bookingId: null, eventId: ours }));
    if (!("request" in made)) throw new Error("expected a request");
    expect(made.request.eventId).toBe(ours);
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

  it("gives soon and routine requests their own windows from the venue's row (goal 19 S7)", async () => {
    const f = await fixture(180);
    const soon = await createRequestCore(db, f.hallkeeper, f.venueId, press(f, { urgency: "soon" }));
    const calm = await createRequestCore(db, f.hallkeeper, f.venueId, press(f, { urgency: "routine" }));
    if (!("request" in soon) || !("request" in calm)) throw new Error("expected requests");
    const window = (made: { readonly escalationDueAt: string | null; readonly createdAt: string }): number =>
      Math.round((Date.parse(made.escalationDueAt ?? "") - Date.parse(made.createdAt)) / 1000);
    expect(window(soon.request)).toBe(300);
    expect(window(calm.request)).toBe(900);
  });

  it("escalates to the duty admin alone when one is named, and to every administrator when the named one has left", async () => {
    const f = await fixture(180);
    const secondAdminId = randomUUID();
    await db.insert(schema.users).values({ id: secondAdminId, venueId: f.venueId, name: "Second admin", email: `${secondAdminId}@lane9.invalid`, role: "admin" });
    await db.update(schema.venueSettings).set({ dutyAdminUserId: f.admin.id }).where(eq(schema.venueSettings.venueId, f.venueId));

    const sentTo: string[] = [];
    const send = (payload: { readonly to: string }): Promise<boolean> => { sentTo.push(payload.to); return Promise.resolve(true); };
    // 13:00 UTC on a weekday in June: outside quiet hours on the venue's clock.
    const daytime = new Date("2026-06-10T13:00:00.000Z");
    const made = await createRequestCore(db, f.hallkeeper, f.venueId, press(f));
    if (!("request" in made)) throw new Error("expected a request");
    await db.update(schema.requests).set({ escalationDueAt: new Date(daytime.getTime() - 1000) }).where(eq(schema.requests.id, made.request.id));
    const first = await runRequestEscalationPass(db, { now: daytime, send });
    const mine = first.find((item) => item.request.id === made.request.id);
    expect(mine?.recipientUserIds).toEqual([f.admin.id]);
    expect(mine?.reason).toBe("unowned");
    expect(mine?.emailDeferred).toBe(false);
    expect(sentTo).toEqual([f.adminEmail]);

    // The named duty admin moves on: the next escalation reaches every administrator.
    await db.update(schema.users).set({ venueId: f.otherVenueId }).where(eq(schema.users.id, f.admin.id));
    const again = await createRequestCore(db, f.hallkeeper, f.venueId, press(f));
    if (!("request" in again)) throw new Error("expected a request");
    await db.update(schema.requests).set({ escalationDueAt: new Date(daytime.getTime() - 1000) }).where(eq(schema.requests.id, again.request.id));
    const second = await runRequestEscalationPass(db, { now: daytime, send });
    expect(second.find((item) => item.request.id === again.request.id)?.recipientUserIds).toEqual([secondAdminId]);
  });

  it("inside quiet hours the inbox copy lands and the email waits; the email pass sends at 07:00 if still unowned, never if owned by then", async () => {
    const f = await fixture(180);
    const sentTo: string[] = [];
    const send = (payload: { readonly to: string }): Promise<boolean> => { sentTo.push(payload.to); return Promise.resolve(true); };
    // 22:30 UTC in January is 22:30 on the venue's clock: quiet.
    const night = new Date("2026-01-20T22:30:00.000Z");
    const morning = new Date("2026-01-21T07:00:00.000Z");

    const waiting = await createRequestCore(db, f.hallkeeper, f.venueId, press(f));
    const taken = await createRequestCore(db, f.hallkeeper, f.venueId, press(f, { kind: "cleaning" }));
    if (!("request" in waiting) || !("request" in taken)) throw new Error("expected requests");
    for (const id of [waiting.request.id, taken.request.id]) {
      await db.update(schema.requests).set({ escalationDueAt: new Date(night.getTime() - 1000) }).where(eq(schema.requests.id, id));
    }

    const escalated = await runRequestEscalationPass(db, { now: night, send });
    const ids = new Set([waiting.request.id, taken.request.id]);
    const mine = escalated.filter((item) => ids.has(item.request.id));
    expect(mine).toHaveLength(2);
    expect(mine.every((item) => item.emailDeferred && item.notificationIds.length > 0)).toBe(true);
    expect(sentTo).toEqual([]);

    // Still quiet at 06:59: nothing leaves.
    expect(await runEscalationEmailPass(db, { now: new Date(morning.getTime() - 60_000), send })).toEqual([]);
    expect(sentTo).toEqual([]);

    // By 07:00 one has been taken: only the other's email goes, once.
    await transitionRequestCore(db, f.staff, taken.request.id, { to: "accepted" });
    // The pass is house-wide; another test's venue may have an email waiting too.
    const sent = (await runEscalationEmailPass(db, { now: morning, send })).filter((item) => item.venueId === f.venueId);
    expect(sent.map((item) => item.requestId)).toEqual([waiting.request.id]);
    expect(sentTo).toEqual([f.adminEmail]);
    expect((await runEscalationEmailPass(db, { now: morning, send })).filter((item) => item.venueId === f.venueId)).toEqual([]);
    expect(sentTo.filter((to) => to === f.adminEmail)).toHaveLength(1);
    const [row] = await db.select({ emailedAt: schema.requests.escalationEmailedAt }).from(schema.requests).where(eq(schema.requests.id, waiting.request.id));
    expect(row?.emailedAt).not.toBeNull();
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
    // 13:00 UTC on a weekday in June: outside quiet hours on the venue's clock,
    // so the email goes at once whatever time of day the suite runs. A real
    // clock made this fail every night from 22:00 to 07:00.
    const later = new Date("2026-06-10T13:00:00.000Z");
    await db.update(schema.requests).set({ escalationDueAt: new Date(later.getTime() - 1000) }).where(eq(schema.requests.id, made.request.id));

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

  it("hands every open request the person holds to one relief, who must take each; an absent relief escalates, and the owner of record stays and may hand on again (goal 19 S7)", async () => {
    const f = await fixture(180);
    const reliefId = randomUUID();
    await db.insert(schema.users).values({ id: reliefId, venueId: f.venueId, name: "Callum", email: `${reliefId}@lane9.invalid`, role: "hallkeeper" });
    const relief: RequestActor = { id: reliefId, name: "Callum", role: "hallkeeper", venueId: f.venueId, platformRole: "none" };

    const made = await Promise.all([
      createRequestCore(db, f.staff, f.venueId, press(f)),
      createRequestCore(db, f.staff, f.venueId, press(f, { kind: "cleaning" })),
      createRequestCore(db, f.staff, f.venueId, press(f, { kind: "av", quantity: null })),
    ]);
    const [staffs, b, c] = made;
    if (!("request" in staffs) || !("request" in b) || !("request" in c)) throw new Error("expected requests");
    await transitionRequestCore(db, f.staff, staffs.request.id, { to: "accepted" });
    await transitionRequestCore(db, f.hallkeeper, b.request.id, { to: "accepted" });
    await transitionRequestCore(db, f.hallkeeper, c.request.id, { to: "accepted" });
    await transitionRequestCore(db, f.hallkeeper, c.request.id, { to: "underway" });

    const handed = await handoverShiftCore(db, f.hallkeeper, f.venueId, reliefId);
    if (!handed.ok) throw new Error(`expected a handover, not ${handed.code}`);
    expect(handed.toName).toBe("Callum");
    expect(handed.handedOver.map((row) => row.id).sort()).toEqual([b.request.id, c.request.id].sort());
    for (const row of handed.handedOver) {
      expect(row.state).toBe("handed-over");
      expect(row.ownerUserId).toBe(f.hallkeeper.id);
      expect(row.handoverToUserId).toBe(reliefId);
      expect(Math.round((Date.parse(row.handoverDueAt ?? "") - Date.parse(row.handedOverAt ?? "")) / 1000)).toBe(300);
    }
    const untouched = await readRequest(db, f.staff, staffs.request.id);
    expect("state" in untouched && untouched.state).toBe("accepted");

    // The relief takes one: the deadline clears and it is theirs.
    const taken = await transitionRequestCore(db, relief, b.request.id, { to: "accepted" });
    expect(taken.ok && taken.request.handoverDueAt).toBeNull();
    expect(taken.ok && taken.request.ownerUserId).toBe(reliefId);

    // The other waits past the relief window: escalated once, with the
    // reason, and still the outgoing person's.
    const late = new Date(Date.parse(handed.handedOver[0]?.handedOverAt ?? "") + 301_000);
    const sentTo: string[] = [];
    const escalated = await runRequestEscalationPass(db, { now: late, send: (payload) => { sentTo.push(payload.to); return Promise.resolve(true); } });
    const mine = escalated.filter((item) => item.request.id === c.request.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.reason).toBe("handover");
    expect(mine[0]?.request.ownerUserId).toBe(f.hallkeeper.id);
    expect(escalated.some((item) => item.request.id === b.request.id)).toBe(false);
    expect(await runRequestEscalationPass(db, { now: late, send: () => Promise.resolve(true) })).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ request: expect.objectContaining({ id: c.request.id }) })]),
    );

    // The relief never came: the owner of record hands it on to somebody else
    // (the earlier escalation is spent), or takes it back.
    const rehanded = await transitionRequestCore(db, f.hallkeeper, c.request.id, { to: "handed-over", toUserId: f.staff.id });
    if (!rehanded.ok) throw new Error(`expected a second handover, not ${rehanded.code}`);
    expect(rehanded.request.handoverToUserId).toBe(f.staff.id);
    expect(rehanded.request.escalatedAt).toBeNull();
    const notTheirs = await transitionRequestCore(db, relief, c.request.id, { to: "accepted" });
    expect(!notTheirs.ok && notTheirs.code).toBe("HANDOVER_NAMED_SOMEONE_ELSE");
    const retaken = await transitionRequestCore(db, f.hallkeeper, c.request.id, { to: "accepted" });
    if (!retaken.ok) throw new Error(`expected the owner to take it back, not ${retaken.code}`);
    expect(retaken.request.ownerUserId).toBe(f.hallkeeper.id);
    expect(retaken.request.handoverDueAt).toBeNull();

    // Handed over again and left again: it escalates again, as a handover.
    const second = await handoverShiftCore(db, f.hallkeeper, f.venueId, reliefId);
    if (!second.ok) throw new Error(`expected a handover, not ${second.code}`);
    expect(second.handedOver.map((row) => row.id)).toEqual([c.request.id]);
    expect(second.refused).toBe(0);
    const later = new Date(Date.parse(second.handedOver[0]?.handedOverAt ?? "") + 301_000);
    const twice = await runRequestEscalationPass(db, { now: later, send: () => Promise.resolve(true) });
    expect(twice.filter((item) => item.request.id === c.request.id).map((item) => item.reason)).toEqual(["handover"]);
    // This test escalates on the real clock, so from 22:00 to 07:00 on the
    // venue's clock both emails wait for the morning. The planner is
    // house-wide and the planner test expects nothing of ours to be due within
    // the day, so mark the venue's emails sent before leaving.
    await db.update(schema.requests)
      .set({ escalationEmailedAt: later })
      .where(and(eq(schema.requests.venueId, f.venueId), isNull(schema.requests.escalationEmailedAt)));

    // Nothing left to hand over: said plainly. A relief from elsewhere: refused, nothing moved.
    const empty = await handoverShiftCore(db, f.hallkeeper, f.venueId, reliefId);
    expect(!empty.ok && empty.code).toBe("NOTHING_TO_HAND_OVER");
    await transitionRequestCore(db, f.staff, staffs.request.id, { to: "underway" });
    const refused = await handoverShiftCore(db, f.staff, f.venueId, f.outsider.id);
    expect(!refused.ok && refused.code).toBe("HANDOVER_TARGET");
    const still = await readRequest(db, f.staff, staffs.request.id);
    expect("state" in still && still.state).toBe("underway");
  });

  it("an escalation email that failed to send is not marked sent; the email pass tries again later and marks it once it went (goal 19 S7)", async () => {
    const f = await fixture(180);
    const made = await createRequestCore(db, f.hallkeeper, f.venueId, press(f));
    if (!("request" in made)) throw new Error("expected a request");
    // Midday in January: outside quiet hours, and earlier than any other test's window.
    const noon = new Date("2026-01-21T12:00:00.000Z");
    await db.update(schema.requests).set({ escalationDueAt: new Date(noon.getTime() - 1000) }).where(eq(schema.requests.id, made.request.id));

    const escalated = await runRequestEscalationPass(db, { now: noon, send: () => Promise.resolve(false) });
    expect(escalated.map((item) => item.request.id)).toContain(made.request.id);
    const [afterFailure] = await db.select().from(schema.requests).where(eq(schema.requests.id, made.request.id));
    expect(afterFailure?.escalatedAt).not.toBeNull();
    expect(afterFailure?.escalationEmailedAt).toBeNull();

    // The sweep does not spin on it: the retry is a while off, not now.
    const retry = await planNextWake(db, noon.getTime());
    expect(retry).toBe(noon.getTime() + EMAIL_RETRY_MS);

    const stillDown = await runEscalationEmailPass(db, { now: new Date(noon.getTime() + EMAIL_RETRY_MS), send: () => Promise.resolve(false) });
    expect(stillDown.filter((item) => item.requestId === made.request.id).map((item) => item.emailedAdmins)).toEqual([0]);
    const [stillWaiting] = await db.select().from(schema.requests).where(eq(schema.requests.id, made.request.id));
    expect(stillWaiting?.escalationEmailedAt).toBeNull();

    const sentTo: string[] = [];
    const sent = await runEscalationEmailPass(db, { now: new Date(noon.getTime() + 2 * EMAIL_RETRY_MS), send: (payload) => { sentTo.push(payload.to); return Promise.resolve(true); } });
    expect(sent.filter((item) => item.requestId === made.request.id).map((item) => item.emailedAdmins)).toEqual([1]);
    expect(sentTo).toContain(f.adminEmail);
    const [emailed] = await db.select().from(schema.requests).where(eq(schema.requests.id, made.request.id));
    expect(emailed?.escalationEmailedAt).not.toBeNull();
  });

  it("plans the next wake from the database: the soonest window, then the end of quiet hours for an email waiting, then nothing (goal 19 S7)", async () => {
    const f = await fixture(180);
    await db.update(schema.requests).set({ state: "resolved", escalationDueAt: null, escalatedAt: new Date(), escalationEmailedAt: new Date() }).where(eq(schema.requests.venueId, f.venueId));
    const idle = await planNextWake(db, Date.now());
    const mineOnly = (wake: number | null): boolean => wake === null || wake > Date.now() + 86_400_000 || wake <= Date.now() + 1_000_000;
    expect(mineOnly(idle)).toBe(true);

    const made = await createRequestCore(db, f.hallkeeper, f.venueId, press(f));
    if (!("request" in made)) throw new Error("expected a request");
    const planned = await planNextWake(db, Date.now());
    expect(planned).not.toBeNull();
    expect(Math.abs((planned ?? 0) - Date.parse(made.request.escalationDueAt ?? ""))).toBeLessThanOrEqual(1_000);

    // Escalated inside quiet hours: the email waits, and the wake is 07:00 on the venue's clock.
    const night = new Date("2026-01-20T22:30:00.000Z");
    await db.update(schema.requests).set({ escalationDueAt: new Date(night.getTime() - 1000) }).where(eq(schema.requests.id, made.request.id));
    await runRequestEscalationPass(db, { now: night, send: () => Promise.resolve(true) });
    const morning = await planNextWake(db, night.getTime());
    expect(morning).toBe(Date.parse("2026-01-21T07:00:00.000Z"));
    // Leave nothing waiting for the next run's quiet-hours test to find.
    await db.update(schema.requests).set({ escalationEmailedAt: night }).where(eq(schema.requests.id, made.request.id));
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
