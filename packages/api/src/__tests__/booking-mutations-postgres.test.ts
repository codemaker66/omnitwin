import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { bookingMutationStateDigest, transitionBookingCore, updateBookingCore, type MutationActor } from "../services/booking-mutations.js";

// Never load .env or fall back to DATABASE_URL. This is Goal 12's migrated,
// disposable local cluster; each test owns a separate venue and its rows.
const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Booking mutation tests require the explicit disposable platform database");
  }
}

describe.skipIf(target === undefined)("booking mutation concurrency on migrated PostgreSQL", () => {
  const applicationName = `booking_mutations_${randomUUID()}`;
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: applicationName, max: 8,
      options: "-c statement_timeout=10000 -c lock_timeout=8000" });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name)
      .toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
  });
  afterAll(async () => { await pool?.end(); });

  async function fixture(kind: "internal_block" | "hold" | "ink" = "internal_block", count = 1) {
    const venueId = randomUUID(), spaceId = randomUUID(), userId = randomUUID();
    await db.insert(schema.venues).values({ id: venueId, name: "TEST ONLY booking concurrency", slug: venueId, address: "Disposable fixture" });
    await db.insert(schema.spaces).values({ id: spaceId, venueId, name: "Room", slug: "room", widthM: "10", lengthM: "10", heightM: "3",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] });
    await db.insert(schema.users).values({ id: userId, venueId, name: "Fixture admin", email: `${userId}@booking.invalid`, role: "admin" });
    const actor: MutationActor = { id: userId, venueId, role: "admin", platformRole: "none" };
    const ids = Array.from({ length: count }, () => randomUUID()).sort();
    const rows = await db.insert(schema.bookings).values(ids.map((id, index) => ({
      id, venueId, spaceId, kind, title: `Fixture booking ${String(index)}`, createdBy: userId,
      startsAt: new Date("2030-01-10T10:00:00.000Z"), endsAt: new Date("2030-01-10T12:00:00.000Z"),
      ...(kind === "hold" ? { rank: index + 1, ownerUserId: userId, nextAction: "Confirm the fixture",
        decisionAt: new Date("2030-01-01T10:00:00.000Z"), nextActionDueAt: new Date("2030-01-01T09:00:00.000Z") } : {}),
    }))).returning();
    return { actor, venueId, spaceId, rows: rows.sort((left, right) => left.id.localeCompare(right.id)) };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  function first(f: Fixture) {
    const row = f.rows[0];
    if (row === undefined) throw new Error("Missing fixture booking");
    return row;
  }
  async function blocked(count: number) {
    await expect.poll(async () => Number((await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
      [applicationName],
    )).rows[0]?.count), { timeout: 5000 }).toBe(count);
  }
  async function withLockedBooking(id: string, run: (client: PoolClient) => Promise<void>) {
    const client = await pool.connect();
    await client.query("BEGIN");
    try {
      await client.query("SELECT id FROM bookings WHERE id = $1 FOR UPDATE", [id]);
      await run(client);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }
  async function stored(id: string) {
    const [row] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, id));
    if (row === undefined) throw new Error("Missing stored fixture booking");
    return row;
  }

  it("preserves both concurrent partial updates instead of restoring stale fields", async () => {
    const f = await fixture(), row = first(f);
    await withLockedBooking(row.id, async (client) => {
      const updates = Promise.all([
        updateBookingCore(db, f.actor, row.id, { title: "Renamed booking" }),
        updateBookingCore(db, f.actor, row.id, { notes: "New operational note" }),
      ]);
      await blocked(2);
      await client.query("COMMIT");
      expect((await updates).map(result => result.ok)).toEqual([true, true]);
      expect(await stored(row.id)).toMatchObject({ title: "Renamed booking", notes: "New operational note" });
    });
  });

  it.each(["released", "deleted"] as const)("does not edit a booking that became %s while waiting", async (state) => {
    const f = await fixture(), row = first(f);
    await withLockedBooking(row.id, async (client) => {
      const update = updateBookingCore(db, f.actor, row.id, { notes: "Must not be written" });
      await blocked(1);
      if (state === "released") await client.query("UPDATE bookings SET status = 'released' WHERE id = $1", [row.id]);
      else await client.query("UPDATE bookings SET deleted_at = now() WHERE id = $1", [row.id]);
      await client.query("COMMIT");
      expect(await update).toMatchObject({ ok: false, status: state === "released" ? 409 : 404 });
      expect((await stored(row.id)).notes).toBeNull();
    });
  });

  it("rejects a transition whose room/time basis changed before its ladder lock", async () => {
    const f = await fixture("hold"), row = first(f);
    await withLockedBooking(row.id, async (client) => {
      const transition = transitionBookingCore(db, f.actor, row.id, { toState: "released" });
      await blocked(1);
      await client.query("UPDATE bookings SET starts_at = starts_at + interval '30 minutes', ends_at = ends_at + interval '30 minutes' WHERE id = $1", [row.id]);
      await client.query("COMMIT");
      expect(await transition).toMatchObject({ ok: false, status: 409, code: "BOOKING_STATE_CHANGED" });
      expect((await stored(row.id)).status).toBe("active");
      expect(await db.select().from(schema.bookingStatusHistory).where(eq(schema.bookingStatusHistory.bookingId, row.id))).toEqual([]);
    });
  });

  it("keeps concurrent hold exits and partial edits deadlock-free with a correct surviving ladder", async () => {
    const f = await fixture("hold", 3);
    const [a, b, c] = f.rows;
    if (a === undefined || b === undefined || c === undefined) throw new Error("Missing ladder");
    await withLockedBooking(a.id, async (client) => {
      const changes = Promise.all([
        transitionBookingCore(db, f.actor, a.id, { toState: "released" }),
        transitionBookingCore(db, f.actor, b.id, { toState: "released" }),
        updateBookingCore(db, f.actor, c.id, { notes: "Keep this note" }),
      ]);
      await blocked(2);
      await client.query("COMMIT");
      expect((await changes).map(result => result.ok)).toEqual([true, true, true]);
      expect(await stored(c.id)).toMatchObject({ status: "active", rank: 1, notes: "Keep this note" });
    });
  });

  it("leaves the old ladder untouched if its target moved to another room while waiting", async () => {
    const f = await fixture("hold", 2), row = first(f);
    const otherSpaceId = randomUUID();
    await db.insert(schema.spaces).values({ id: otherSpaceId, venueId: f.venueId, name: "Other room", slug: "other",
      widthM: "10", lengthM: "10", heightM: "3", floorPlanOutline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] });
    await withLockedBooking(row.id, async (client) => {
      const transition = transitionBookingCore(db, f.actor, row.id, { toState: "released" });
      await blocked(1);
      await client.query("UPDATE bookings SET space_id = $1 WHERE id = $2", [otherSpaceId, row.id]);
      await client.query("COMMIT");
      expect(await transition).toMatchObject({ ok: false, status: 409, code: "BOOKING_STATE_CHANGED" });
      expect(await stored(row.id)).toMatchObject({ status: "active", spaceId: otherSpaceId });
      const survivor = f.rows[1];
      if (survivor === undefined) throw new Error("Missing survivor");
      expect((await stored(survivor.id)).rank).toBe(2);
      expect(await db.select().from(schema.bookingStatusHistory).where(eq(schema.bookingStatusHistory.bookingId, row.id))).toEqual([]);
    });
  });

  it("keeps ink exclusion failures recoverable inside an owning transaction", async () => {
    const f = await fixture("ink"), row = first(f);
    const [other] = await db.insert(schema.bookings).values({ venueId: f.venueId, spaceId: f.spaceId,
      kind: "ink", title: "Other ink", startsAt: new Date("2030-01-10T13:00:00.000Z"), endsAt: new Date("2030-01-10T15:00:00.000Z") }).returning();
    if (other === undefined) throw new Error("Missing other booking");
    await db.transaction(async tx => {
      expect(await updateBookingCore(tx, f.actor, row.id, { startsAt: other.startsAt.toISOString(), endsAt: other.endsAt.toISOString() }))
        .toMatchObject({ ok: false, status: 409, code: "INK_SLOT_TAKEN" });
      expect(await updateBookingCore(tx, f.actor, row.id, { notes: "Transaction remains usable" })).toMatchObject({ ok: true });
    });
    expect(await stored(row.id)).toMatchObject({ startsAt: row.startsAt, endsAt: row.endsAt, notes: "Transaction remains usable" });
  });

  it("checks the prepared semantic digest after a blocked read, including changes without a timestamp bump", async () => {
    const f = await fixture(), row = first(f);
    const precondition = { expectedStateDigest: bookingMutationStateDigest(row) };
    await withLockedBooking(row.id, async (client) => {
      const update = updateBookingCore(db, f.actor, row.id, { title: "Unapproved title" }, precondition);
      await blocked(1);
      await client.query("UPDATE bookings SET notes = 'New evidence' WHERE id = $1", [row.id]);
      await client.query("COMMIT");
      expect(await update).toMatchObject({ ok: false, status: 409, code: "BOOKING_STATE_CHANGED" });
      expect(await stored(row.id)).toMatchObject({ title: row.title, notes: "New evidence" });
    });
  });

  it("applies a current prepared state and rejects its reuse after the resulting change", async () => {
    const f = await fixture(), row = first(f);
    const precondition = { expectedStateDigest: bookingMutationStateDigest(row) };
    expect(await updateBookingCore(db, f.actor, row.id, { notes: "Approved note" }, precondition)).toMatchObject({ ok: true });
    expect(await updateBookingCore(db, f.actor, row.id, { title: "A different action" }, precondition))
      .toMatchObject({ ok: false, status: 409, code: "BOOKING_STATE_CHANGED" });
    expect(await stored(row.id)).toMatchObject({ title: row.title, notes: "Approved note" });
  });

  it("rolls a successful update back with the enclosing decision transaction", async () => {
    const f = await fixture(), row = first(f);
    await expect(db.transaction(async tx => {
      expect(await updateBookingCore(tx, f.actor, row.id, { notes: "Must roll back" })).toMatchObject({ ok: true });
      throw new Error("Dependent release failed");
    })).rejects.toThrow("Dependent release failed");
    expect((await stored(row.id)).notes).toBeNull();
  });

  it.each(["hallkeeper", "foreign_admin"])("retains the %s access boundary with a valid prepared digest", async (role) => {
    const f = await fixture(), row = first(f);
    const actor = role === "hallkeeper" ? { ...f.actor, role } : { ...f.actor, venueId: randomUUID() };
    expect(await updateBookingCore(db, actor, row.id, { notes: "Forbidden" }, { expectedStateDigest: bookingMutationStateDigest(row) }))
      .toMatchObject({ ok: false, status: 403 });
    expect((await stored(row.id)).notes).toBeNull();
  });

  it("clears a hold rank on promotion to ink and records the transition", async () => {
    const f = await fixture("hold"), row = first(f);
    expect(await transitionBookingCore(db, f.actor, row.id, { toState: "ink" })).toMatchObject({ ok: true });
    expect(await stored(row.id)).toMatchObject({ kind: "ink", status: "active", rank: null });
    expect(await db.select().from(schema.bookingStatusHistory).where(eq(schema.bookingStatusHistory.bookingId, row.id)))
      .toEqual([expect.objectContaining({ fromState: "hold", toState: "ink" })]);
  });
});
