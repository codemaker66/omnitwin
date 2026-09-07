import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { eventRoutes } from "../routes/events.js";
import { eventStateDigest, updateEventCore } from "../services/event-mutations.js";

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const url = new URL(target);
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "55477"
    || url.pathname !== "/venviewer_platform_test" || url.search || url.hash) {
    throw new Error("Event mutation tests require the explicitly owned disposable platform database");
  }
}

describe.skipIf(target === undefined)("event mutation atomicity on disposable PostgreSQL", () => {
  let pool: Pool;
  let observer: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let server: FastifyInstance;
  const applicationName = `event-mutations-${randomUUID()}`;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit target required");
    pool = new Pool({ connectionString: target, application_name: applicationName, max: 5 });
    observer = new Pool({ connectionString: target, application_name: `${applicationName}-observer`, max: 1 });
    expect((await observer.query<{ database: string }>("SELECT current_database() AS database")).rows[0]?.database)
      .toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(eventRoutes, { db, prefix: "/events" });
    await server.ready();
  });
  afterAll(async () => { await server?.close(); await pool?.end(); await observer?.end(); });

  async function fixture() {
    const venueId = randomUUID(), eventId = randomUUID(), actorId = randomUUID();
    await db.insert(schema.venues).values({ id: venueId, name: "Synthetic platform test venue", slug: venueId, address: "Test only" });
    await db.insert(schema.users).values({ id: actorId, venueId, name: "Test admin", email: `${actorId}@test.invalid`, role: "admin" });
    await db.insert(schema.events).values({ id: eventId, venueId, createdBy: actorId, name: "Test dinner", guestCount: 150,
      startsAt: new Date("2026-11-01T18:00:00Z"), endsAt: new Date("2026-11-01T23:00:00Z") });
    return { eventId, actor: { id: actorId, email: `${actorId}@test.invalid`, role: "admin" as const, platformRole: "none" as const, venueId } };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  function patch(f: Fixture, payload: Record<string, unknown>) {
    return server.inject({ method: "PATCH", url: `/events/${f.eventId}`,
      headers: { authorization: `Bearer ${JSON.stringify(f.actor)}` }, payload });
  }
  async function state(f: Fixture) {
    const [event] = await db.select().from(schema.events).where(eq(schema.events.id, f.eventId));
    const changes = await db.select().from(schema.eventPlanChanges).where(eq(schema.eventPlanChanges.eventId, f.eventId));
    const notifications = await db.select().from(schema.eventPlanNotifications).where(eq(schema.eventPlanNotifications.eventId, f.eventId));
    return { event, changes, notifications };
  }

  it("keeps both concurrent partial edits and records the actual committed before state", async () => {
    const f = await fixture();
    const blocker = await observer.connect();
    let requests: Promise<unknown>[] = [];
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM events WHERE id=$1 FOR UPDATE", [f.eventId]);
      requests = [patch(f, { guestCount: 180 }).then(response => response), patch(f, { notes: "Staff briefing changed" }).then(response => response)];
      // Both commands have actually reached the held row. This reproduces the
      // old read/merge/ID-only-write race without depending on scheduling sleeps.
      await expect.poll(async () => {
        await blocker.query("SELECT pg_stat_clear_snapshot()");
        const result = await blocker.query<{ waiting: number }>(
          "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
          [applicationName],
        );
        return result.rows[0]?.waiting;
      }, { timeout: 5000 }).toBe(2);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
    const responses = await Promise.all(requests);
    expect(responses).toEqual([expect.objectContaining({ statusCode: 200 }), expect.objectContaining({ statusCode: 200 })]);
    const saved = await state(f);
    expect(saved.event).toMatchObject({ guestCount: 180, notes: "Staff briefing changed" });
    expect(saved.changes).toHaveLength(2);
    expect(saved.notifications).toHaveLength(4);
    const headcount = saved.changes.find(change => change.affectedSurfaces.includes("guest_count"));
    expect(headcount).toMatchObject({ beforeSummary: "150 guests", afterSummary: "180 guests" });
  });

  it("rolls back the event if its mandatory change record cannot be persisted", async () => {
    const f = await fixture();
    // A stale actor identity passes this isolated test authentication boundary
    // but the real change-feed FK rejects it. The event must not commit alone.
    const response = await patch({ ...f, actor: { ...f.actor, id: randomUUID() } }, { guestCount: 180 });
    expect(response.statusCode).toBe(500);
    expect(await state(f)).toMatchObject({ event: { guestCount: 150 }, changes: [], notifications: [] });
  });

  it("rejects a stale prepared basis even when another writer preserved updatedAt", async () => {
    const f = await fixture();
    const initial = (await state(f)).event;
    if (initial === undefined) throw new Error("Missing fixture");
    const expectedStateDigest = eventStateDigest(initial);
    await db.update(schema.events).set({ headcountGuaranteed: 160 }).where(eq(schema.events.id, f.eventId));
    const result = await updateEventCore(db, f.actor, f.eventId, { guestCount: 180 }, { expectedStateDigest });
    expect(result).toMatchObject({ ok: false, status: 409, code: "EVENT_STATE_CHANGED" });
    expect(await state(f)).toMatchObject({ event: { guestCount: 150, headcountGuaranteed: 160, updatedAt: initial.updatedAt }, changes: [], notifications: [] });
  });

  it("executes a current prepared edit without treating working guest count as contractual or physical proof", async () => {
    const f = await fixture();
    await db.update(schema.events).set({ headcountGuaranteed: 140, headcountExpected: 150, headcountSetFor: 150 })
      .where(eq(schema.events.id, f.eventId));
    const initial = (await state(f)).event;
    if (initial === undefined) throw new Error("Missing fixture");
    const result = await updateEventCore(db, f.actor, f.eventId, { guestCount: 180 }, { expectedStateDigest: eventStateDigest(initial) });
    expect(result).toMatchObject({ ok: true, changed: true, event: { guestCount: 180, headcountGuaranteed: 140, headcountExpected: 150, headcountSetFor: 150 } });
    if (result.ok) expect(result.stateDigest).not.toBe(eventStateDigest(initial));
    expect((await state(f)).notifications).toHaveLength(2);
  });

  it("honours an enclosing command rollback including its change feed and notifications", async () => {
    const f = await fixture();
    await expect(db.transaction(async tx => {
      expect(await updateEventCore(tx, f.actor, f.eventId, { guestCount: 180 })).toMatchObject({ ok: true });
      throw new Error("Later command step failed");
    })).rejects.toThrow("Later command step failed");
    expect(await state(f)).toMatchObject({ event: { guestCount: 150 }, changes: [], notifications: [] });
  });

  it("denies foreign-venue and read-only actors without notifications", async () => {
    const f = await fixture();
    expect(await updateEventCore(db, { ...f.actor, venueId: randomUUID() }, f.eventId, { guestCount: 180 }))
      .toMatchObject({ ok: false, status: 403 });
    expect(await updateEventCore(db, { ...f.actor, role: "hallkeeper" }, f.eventId, { guestCount: 180 }))
      .toMatchObject({ ok: false, status: 403 });
    expect(await state(f)).toMatchObject({ event: { guestCount: 150 }, changes: [], notifications: [] });
  });

  it("validates a partial time edit against the persisted other endpoint", async () => {
    const f = await fixture();
    expect((await patch(f, { startsAt: "2026-11-02T01:00:00Z" })).statusCode).toBe(400);
    expect((await state(f)).changes).toHaveLength(0);
    const response = await patch(f, { startsAt: "2026-11-01T18:30:00Z", endsAt: "2026-11-01T23:30:00Z" });
    expect(response.statusCode).toBe(200);
    expect((await state(f)).event).toMatchObject({ startsAt: new Date("2026-11-01T18:30:00Z"), endsAt: new Date("2026-11-01T23:30:00Z") });
  });

  it("does not invent a change or acknowledgement request for a repeated identical edit", async () => {
    const f = await fixture();
    const initial = (await state(f)).event;
    expect((await patch(f, { guestCount: 150, notes: null })).statusCode).toBe(200);
    expect(await state(f)).toMatchObject({ event: initial, changes: [], notifications: [] });
  });

  it("cannot revive a deleted event through a prepared command", async () => {
    const f = await fixture();
    const initial = (await state(f)).event;
    if (initial === undefined) throw new Error("Missing fixture");
    await db.update(schema.events).set({ deletedAt: new Date() }).where(eq(schema.events.id, f.eventId));
    expect(await updateEventCore(db, f.actor, f.eventId, { guestCount: 180 }, { expectedStateDigest: eventStateDigest(initial) }))
      .toMatchObject({ ok: false, status: 404 });
    expect((await state(f)).changes).toHaveLength(0);
  });
});
