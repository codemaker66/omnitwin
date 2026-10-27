import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DecisionSchema, DecisionWithHistorySchema, type Decision } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { decisionRoutes } from "../routes/decisions.js";
import { updateBookingCore, transitionBookingCore, type MutationActor } from "../services/booking-mutations.js";
import { decideDecision, prepareBookingTimeMove, readDecision, withdrawDecision } from "../services/decisions.js";
import { insertBoundBookings } from "../services/event-binding.js";

// ---------------------------------------------------------------------------
// Goal 09 M1 (with M2's booking time move) on migrated PostgreSQL: the hard
// cases the goal names. Scope (one approval never implies another class's, and
// never another venue's), a stale approval returns the revised decision and
// executes nothing, duplicate execution moves the booking once, a partial
// failure changes nothing and is kept in the history, a withdrawn decision
// cannot be decided, a booking gone from the Diary fails cleanly, and the
// database keeps decided decisions final and the history append-only.
//
// Never loads .env or DATABASE_URL: the explicit disposable platform database only.
// ---------------------------------------------------------------------------

process.env["NODE_ENV"] = "test";
const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Decision tests require the explicit disposable platform database");
  }
}

const NOW = new Date("2030-03-01T09:00:00.000Z");
const at = (hours: number, day = 10): Date => new Date(Date.UTC(2030, 2, day, hours));

describe.skipIf(target === undefined)("prepared decisions on migrated PostgreSQL (goal 09 M1)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let app: FastifyInstance;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `decisions_${randomUUID()}`, max: 8,
      options: "-c statement_timeout=20000 -c lock_timeout=15000" });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    await migrate(drizzle(pool), { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
    db = drizzle(pool, { schema });
    app = Fastify();
    await app.register(decisionRoutes, { db, prefix: "/decisions" });
    await app.ready();
  }, 300_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  interface Venue {
    readonly venueId: string;
    readonly spaceId: string;
    readonly staff: MutationActor;
    readonly admin: MutationActor;
    readonly sales: MutationActor;
    readonly hallkeeper: MutationActor;
  }

  async function venue(): Promise<Venue> {
    const venueId = randomUUID();
    const spaceId = randomUUID();
    await db.insert(schema.venues).values({ id: venueId, name: "TEST ONLY decisions", slug: `decisions-${venueId}`, address: "Disposable fixture" });
    await db.insert(schema.spaces).values({ id: spaceId, venueId, name: "Grand Hall", slug: "grand-hall", widthM: "21", lengthM: "10.5", heightM: "7",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 10.5 }, { x: 0, y: 10.5 }] });
    const person = async (role: string): Promise<MutationActor> => {
      const id = randomUUID();
      await db.insert(schema.users).values({ id, venueId, name: `Fixture ${role}`, email: `${id}@decisions.invalid`, role });
      return { id, venueId, role, platformRole: "none" };
    };
    return { venueId, spaceId, staff: await person("staff"), admin: await person("admin"), sales: await person("sales"), hallkeeper: await person("hallkeeper") };
  }

  async function ink(v: Venue, title: string, startsAt: Date, endsAt: Date): Promise<string> {
    const [row] = await insertBoundBookings(db, [{
      id: randomUUID(), venueId: v.venueId, spaceId: v.spaceId, kind: "ink", title, createdBy: v.admin.id, startsAt, endsAt,
    }]);
    if (row === undefined) throw new Error("fixture booking not written");
    return row.id;
  }

  async function booking(id: string) {
    const [row] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, id));
    if (row === undefined) throw new Error("missing booking");
    return row;
  }

  async function prepared(v: Venue, bookingId: string, startsAt: Date, endsAt: Date, by: MutationActor = v.staff): Promise<Decision> {
    const result = await prepareBookingTimeMove(db, by, { bookingId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), reason: "The client asked for a later start" }, NOW);
    if (!result.ok) throw new Error(`not prepared: ${result.code}`);
    return result.value;
  }

  async function history(v: Venue, decisionId: string): Promise<readonly string[]> {
    const read = await readDecision(db, v.staff, decisionId);
    if (!read.ok) throw new Error(read.code);
    return read.value.history.map((event) => event.kind);
  }

  async function commands(bookingId: string): Promise<number> {
    return Number((await pool.query<{ n: string }>("SELECT count(*)::text AS n FROM diary_commands WHERE booking_id = $1", [bookingId])).rows[0]?.n);
  }

  it("prepares a move from what the Diary holds: options, a recommendation with reasons, and what is not worked out", async () => {
    const v = await venue();
    const id = await ink(v, "Crawford wedding", at(14), at(18));
    const decision = await prepared(v, id, at(15), at(19));
    expect(DecisionSchema.parse(decision)).toMatchObject({
      actionClass: "booking_time_move", status: "prepared", subject: { kind: "booking", id },
      recommendedOptionId: "move", approverRoles: ["staff", "admin"], receipt: null, supersedes: null,
      requested: { startsAt: at(15).toISOString(), endsAt: at(19).toISOString(), reason: "The client asked for a later start" },
    });
    expect(decision.intendedOutcome).toContain('Move "Crawford wedding" to');
    const move = decision.options.find((option) => option.id === "move");
    expect(move).toMatchObject({ executable: true, recommended: true, consequences: [] });
    expect(move?.mutations).toEqual([expect.objectContaining({ kind: "booking.update", bookingId: id, startsAt: at(15).toISOString(), endsAt: at(19).toISOString() })]);
    expect(decision.options.find((option) => option.id === "keep")).toMatchObject({ executable: true, recommended: false, mutations: [] });
    expect(decision.missingFacts[0]).toContain("staff rota, catering and equipment is not worked out yet");
    expect(await history(v, decision.id)).toEqual(["prepared"]);
    // Preparing changes nothing.
    expect((await booking(id)).startsAt.toISOString()).toBe(at(14).toISOString());
  });

  it("explains the no-fit: a confirmed booking in the way makes the move not executable, and keeping it is recommended", async () => {
    const v = await venue();
    const id = await ink(v, "Merchants' dinner", at(10), at(12));
    await ink(v, "Spring gala", at(14), at(18));
    const decision = await prepared(v, id, at(15), at(17));
    const move = decision.options.find((option) => option.id === "move");
    expect(move).toMatchObject({ executable: false, recommended: false, mutations: [] });
    expect(move?.consequences).toEqual([expect.objectContaining({ kind: "ink_double_book", severity: "blocking" })]);
    expect(move?.reasons[0]).toMatch(/^It cannot move there: /u);
    expect(decision.recommendedOptionId).toBe("keep");
    const refused = await decideDecision(db, v.staff, decision.id, { optionId: "move", subjectDigest: decision.basis.subjectDigest }, NOW);
    expect(refused).toMatchObject({ ok: false, status: 409, code: "OPTION_NOT_EXECUTABLE" });
    expect((await booking(id)).startsAt.toISOString()).toBe(at(10).toISOString());
  });

  it("executes on approval through the Diary's own command, with its receipt and history, and moves the booking once", async () => {
    const v = await venue();
    const id = await ink(v, "Crawford wedding", at(14), at(18));
    const decision = await prepared(v, id, at(15), at(19));
    const choice = { optionId: "move", subjectDigest: decision.basis.subjectDigest };
    // Two approvals at once: one executes, the other is answered with its receipt.
    const [first, second] = await Promise.all([
      decideDecision(db, v.staff, decision.id, choice, NOW),
      decideDecision(db, v.admin, decision.id, choice, NOW),
    ]);
    const results = [first, second];
    expect(results.filter((result) => result.ok && result.replay !== true)).toHaveLength(1);
    expect(results.filter((result) => result.ok && result.replay === true)).toHaveLength(1);
    const executed = results.find((result) => result.ok && result.replay !== true);
    if (executed === undefined || !executed.ok) throw new Error("no execution");
    expect(executed.value).toMatchObject({ status: "executed", receipt: { optionId: "move", outcome: "executed", refusal: null } });
    expect(executed.value.receipt?.commandIds).toEqual([decision.options[0]?.mutations[0]?.commandId]);
    const moved = await booking(id);
    expect([moved.startsAt.toISOString(), moved.endsAt.toISOString()]).toEqual([at(15).toISOString(), at(19).toISOString()]);
    // One Diary command, in the Diary's own ledger.
    expect(await commands(id)).toBe(1);
    expect(await history(v, decision.id)).toEqual(["prepared", "executed"]);
    // Another choice after it was decided is refused, and changes nothing.
    expect(await decideDecision(db, v.staff, decision.id, { optionId: "keep", subjectDigest: decision.basis.subjectDigest }, NOW))
      .toMatchObject({ ok: false, status: 409, code: "DECISION_CLOSED" });
  });

  it("never executes a stale approval: it returns the revised decision, which can then be decided", async () => {
    const v = await venue();
    const id = await ink(v, "Crawford wedding", at(14), at(18));
    const decision = await prepared(v, id, at(15), at(19));
    // A colleague edits the booking after the decision was prepared.
    const edited = await updateBookingCore(db, v.staff, id, { notes: "Florist arrives at noon" });
    expect(edited.ok).toBe(true);
    const stale = await decideDecision(db, v.admin, decision.id, { optionId: "move", subjectDigest: decision.basis.subjectDigest }, NOW);
    expect(stale).toMatchObject({ ok: false, status: 409, code: "DECISION_STALE" });
    if (stale.ok) throw new Error("expected stale");
    const revised = DecisionSchema.parse((stale.details as { revised: unknown }).revised);
    expect(revised).toMatchObject({ status: "prepared", supersedes: decision.id, requested: decision.requested });
    expect((await booking(id)).startsAt.toISOString()).toBe(at(14).toISOString());
    expect(await commands(id)).toBe(0);
    const old = await readDecision(db, v.staff, decision.id);
    if (!old.ok) throw new Error(old.code);
    expect(old.value.decision).toMatchObject({ status: "superseded", supersededBy: revised.id, receipt: null });
    expect(old.value.history.map((event) => event.kind)).toEqual(["prepared", "stale"]);
    // The revised decision executes.
    const done = await decideDecision(db, v.admin, revised.id, { optionId: "move", subjectDigest: revised.basis.subjectDigest }, NOW);
    expect(done).toMatchObject({ ok: true, value: { status: "executed" } });
    expect((await booking(id)).startsAt.toISOString()).toBe(at(15).toISOString());
  });

  it("finds a decision stale when a neighbour changed its consequences, and when it has expired", async () => {
    const v = await venue();
    const id = await ink(v, "Crawford wedding", at(10), at(12));
    const decision = await prepared(v, id, at(15), at(17));
    // A confirmed booking now holds the new time: the move's consequences changed.
    await ink(v, "Spring gala", at(16), at(20));
    const stale = await decideDecision(db, v.admin, decision.id, { optionId: "move", subjectDigest: decision.basis.subjectDigest }, NOW);
    expect(stale).toMatchObject({ ok: false, code: "DECISION_STALE" });
    if (stale.ok) throw new Error("expected stale");
    const revised = DecisionSchema.parse((stale.details as { revised: unknown }).revised);
    expect(revised.options.find((option) => option.id === "move")).toMatchObject({ executable: false });
    expect(revised.recommendedOptionId).toBe("keep");

    const later = await prepared(v, id, at(8), at(9));
    const expired = await decideDecision(db, v.admin, later.id, { optionId: "move", subjectDigest: later.basis.subjectDigest },
      new Date(Date.parse(later.expiresAt) + 1));
    expect(expired).toMatchObject({ ok: false, code: "DECISION_STALE" });
    expect((await booking(id)).startsAt.toISOString()).toBe(at(10).toISOString());
  });

  it("holds approval to its class and its venue: one approval never implies another", async () => {
    const v = await venue();
    const other = await venue();
    const id = await ink(v, "Crawford wedding", at(14), at(18));
    const decision = await prepared(v, id, at(15), at(19), v.sales);
    const choice = { optionId: "move", subjectDigest: decision.basis.subjectDigest };
    // Sales may ask and read, not approve a time; nor may the hallkeeper.
    expect(await decideDecision(db, v.sales, decision.id, choice, NOW)).toMatchObject({ ok: false, status: 403, code: "NOT_AN_APPROVER" });
    expect(await decideDecision(db, v.hallkeeper, decision.id, choice, NOW)).toMatchObject({ ok: false, status: 403, code: "NOT_AN_APPROVER" });
    // Another venue's staff and admin do not find it.
    expect(await decideDecision(db, other.admin, decision.id, choice, NOW)).toMatchObject({ ok: false, status: 404 });
    expect(await readDecision(db, other.staff, decision.id)).toMatchObject({ ok: false, status: 404 });
    // A staff member approves a time, never a guest-count change at the same venue.
    const { intendedOutcome, requested, basis, options, recommendedOptionId, missingFacts, assumptions, question, urgency } = decision;
    const [guestCount] = await db.insert(schema.decisions).values({
      venueId: v.venueId, actionClass: "guest_count_change", subjectKind: "booking", subjectId: id,
      body: { intendedOutcome, requested, basis, options, recommendedOptionId, missingFacts, assumptions, question, urgency, approverRoles: ["admin"] },
      preparedBy: v.staff.id, preparedAt: NOW, expiresAt: new Date(NOW.getTime() + 3_600_000),
    }).returning();
    if (guestCount === undefined) throw new Error("fixture decision not written");
    expect(await decideDecision(db, v.staff, guestCount.id, choice, NOW)).toMatchObject({ ok: false, status: 403, code: "NOT_AN_APPROVER" });
    expect((await booking(id)).startsAt.toISOString()).toBe(at(14).toISOString());
  });

  it("changes nothing when the step fails part-way, keeps the failure in the history, and executes when tried again", async () => {
    const v = await venue();
    const id = await ink(v, "Crawford wedding", at(14), at(18));
    const decision = await prepared(v, id, at(15), at(19));
    const choice = { optionId: "move", subjectDigest: decision.basis.subjectDigest };
    await expect(decideDecision(db, v.admin, decision.id, choice, NOW, {
      afterMutation: () => Promise.reject(new Error("the receipt write is lost")),
    })).rejects.toThrow("the receipt write is lost");
    expect((await booking(id)).startsAt.toISOString()).toBe(at(14).toISOString());
    expect(await commands(id)).toBe(0);
    expect(await history(v, decision.id)).toEqual(["prepared", "execution_error"]);
    const read = await readDecision(db, v.staff, decision.id);
    expect(read).toMatchObject({ ok: true, value: { decision: { status: "prepared" } } });
    // Recovery: the same decision, decided again, executes once.
    expect(await decideDecision(db, v.admin, decision.id, choice, NOW)).toMatchObject({ ok: true, value: { status: "executed" } });
    expect(await commands(id)).toBe(1);
  });

  it("records a decline, a withdrawal, and a booking that left the Diary, each changing nothing", async () => {
    const v = await venue();
    const id = await ink(v, "Crawford wedding", at(14), at(18));
    const keep = await prepared(v, id, at(15), at(19));
    expect(await decideDecision(db, v.staff, keep.id, { optionId: "keep", subjectDigest: keep.basis.subjectDigest }, NOW))
      .toMatchObject({ ok: true, value: { status: "declined", receipt: { optionId: "keep", outcome: "declined", commandIds: [] } } });

    const withdrawn = await prepared(v, id, at(16), at(20), v.sales);
    expect(await withdrawDecision(db, v.hallkeeper, withdrawn.id, NOW)).toMatchObject({ ok: false, status: 403 });
    expect(await withdrawDecision(db, v.sales, withdrawn.id, NOW)).toMatchObject({ ok: true, value: { status: "withdrawn" } });
    expect(await decideDecision(db, v.admin, withdrawn.id, { optionId: "move", subjectDigest: withdrawn.basis.subjectDigest }, NOW))
      .toMatchObject({ ok: false, status: 409, code: "DECISION_CLOSED" });

    const gone = await prepared(v, id, at(9), at(13));
    const cancelled = await transitionBookingCore(db, v.admin, id, { toState: "cancelled" });
    expect(cancelled.ok).toBe(true);
    const failed = await decideDecision(db, v.admin, gone.id, { optionId: "move", subjectDigest: gone.basis.subjectDigest }, NOW);
    expect(failed).toMatchObject({ ok: false, status: 409, code: "BOOKING_NOT_ACTIVE" });
    const read = await readDecision(db, v.staff, gone.id);
    expect(read).toMatchObject({ ok: true, value: { decision: { status: "failed", receipt: { outcome: "failed", refusal: { code: "BOOKING_NOT_ACTIVE" } } } } });
    expect((await booking(id)).startsAt.toISOString()).toBe(at(14).toISOString());
  });

  it("keeps a decided decision final and its history append-only at the database", async () => {
    const v = await venue();
    const id = await ink(v, "Crawford wedding", at(14), at(18));
    const decision = await prepared(v, id, at(15), at(19));
    await expect(pool.query("UPDATE decisions SET body = '{}'::jsonb WHERE id = $1", [decision.id])).rejects.toThrow(/never changes/u);
    expect(await decideDecision(db, v.staff, decision.id, { optionId: "keep", subjectDigest: decision.basis.subjectDigest }, NOW)).toMatchObject({ ok: true });
    await expect(pool.query("UPDATE decisions SET status = 'prepared', receipt = NULL, decided_at = NULL WHERE id = $1", [decision.id]))
      .rejects.toThrow(/final/u);
    await expect(pool.query("DELETE FROM decisions WHERE id = $1", [decision.id])).rejects.toThrow(/kept/u);
    await expect(pool.query("UPDATE decision_events SET kind = 'executed' WHERE decision_id = $1", [decision.id])).rejects.toThrow(/append-only/u);
    await expect(pool.query("DELETE FROM decision_events WHERE decision_id = $1", [decision.id])).rejects.toThrow(/append-only/u);
  });

  describe("the routes", () => {
    const as = (person: MutationActor): { authorization: string } => ({
      authorization: `Bearer ${JSON.stringify({ id: person.id, email: `${person.id}@decisions.invalid`, role: person.role, platformRole: "none", venueId: person.venueId })}`,
    });

    it("prepare, read with history, decide, and answer the same choice again with its receipt", async () => {
      const v = await venue();
      const id = await ink(v, "Crawford wedding", at(14), at(18));
      const made = await app.inject({ method: "POST", url: "/decisions/booking-time-moves", headers: as(v.staff),
        payload: { bookingId: id, startsAt: at(15).toISOString(), endsAt: at(19).toISOString() } });
      expect(made.statusCode).toBe(201);
      const decision = DecisionSchema.parse(made.json<{ data: unknown }>().data);
      const read = await app.inject({ method: "GET", url: `/decisions/${decision.id}`, headers: as(v.sales) });
      expect(DecisionWithHistorySchema.parse(read.json<{ data: unknown }>().data).history.map((event) => event.kind)).toEqual(["prepared"]);
      const listed = await app.inject({ method: "GET", url: "/decisions?status=prepared", headers: as(v.hallkeeper) });
      expect(listed.json<{ data: { id: string }[] }>().data.map((row) => row.id)).toContain(decision.id);

      const choice = { optionId: "move", subjectDigest: decision.basis.subjectDigest };
      const done = await app.inject({ method: "POST", url: `/decisions/${decision.id}/decide`, headers: as(v.admin), payload: choice });
      expect(done.statusCode).toBe(200);
      expect(done.headers["idempotency-replay"]).toBeUndefined();
      const again = await app.inject({ method: "POST", url: `/decisions/${decision.id}/decide`, headers: as(v.staff), payload: choice });
      expect(again.statusCode).toBe(200);
      expect(again.headers["idempotency-replay"]).toBe("true");
      expect(await commands(id)).toBe(1);
    });

    it("does not find another venue's decision, refuses a malformed request, and refuses a decision read before it changed", async () => {
      const v = await venue();
      const other = await venue();
      const id = await ink(v, "Crawford wedding", at(14), at(18));
      const decision = await prepared(v, id, at(15), at(19));
      expect((await app.inject({ method: "GET", url: `/decisions/${decision.id}`, headers: as(other.admin) })).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: "/decisions/booking-time-moves", headers: as(other.staff),
        payload: { bookingId: id, startsAt: at(15).toISOString(), endsAt: at(19).toISOString() } })).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: "/decisions/booking-time-moves", headers: as(v.staff),
        payload: { bookingId: id, startsAt: at(19).toISOString(), endsAt: at(15).toISOString() } })).statusCode).toBe(400);
      const wrong = await app.inject({ method: "POST", url: `/decisions/${decision.id}/decide`, headers: as(v.admin),
        payload: { optionId: "move", subjectDigest: "0".repeat(64) } });
      expect(wrong.statusCode).toBe(409);
      expect(wrong.json()).toMatchObject({ code: "DECISION_MISMATCH" });
      expect((await app.inject({ method: "GET", url: "/decisions", headers: { authorization: `Bearer ${JSON.stringify({ id: randomUUID(), email: "c@x.invalid", role: "client", platformRole: "none", venueId: v.venueId })}` } })).statusCode).toBe(403);
      expect((await booking(id)).startsAt.toISOString()).toBe(at(14).toISOString());
    });
  });
});
