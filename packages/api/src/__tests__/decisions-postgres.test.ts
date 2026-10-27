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
import { decideDecision, listDecisions, prepareBookingTimeMove, readDecision, withdrawDecision } from "../services/decisions.js";
import { defaultEventPhaseRows, insertBoundBookings } from "../services/event-binding.js";

// ---------------------------------------------------------------------------
// Goal 09 M1 (with M2's booking time move) on migrated PostgreSQL: the hard
// cases the goal names. Scope (one approval never implies another class's, and
// never another venue's), a stale approval returns the revised decision and
// executes nothing, duplicate execution moves the booking once, a partial
// failure changes nothing and is kept in the history, a withdrawn decision
// cannot be decided, a booking gone from the Diary fails cleanly, and the
// database keeps decided decisions final and the history append-only.
//
// And the release review's cases (27 October 2026): a decision with more in
// its way than it can list stays readable; the phases the Diary moves with a
// booking are the ones the decision moves, and a change to them makes it
// stale; a gap that shrinks and the same event's other day are consequences;
// a closure and an unready hold block the move; "keep" always declines; an
// answer names the decision it is for; nothing kept names a person.
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
const at = (hours: number, day = 10, minutes = 0): Date => new Date(Date.UTC(2030, 2, day, hours, minutes));

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

  async function entry(v: Venue, kind: "ink" | "hold" | "internal_block", title: string, startsAt: Date, endsAt: Date, eventId?: string): Promise<{ id: string; eventId: string | null }> {
    const [row] = await insertBoundBookings(db, [{
      id: randomUUID(), venueId: v.venueId, spaceId: v.spaceId, kind, title, createdBy: v.admin.id, startsAt, endsAt,
      ...(eventId === undefined ? {} : { eventId }),
    }]);
    if (row === undefined) throw new Error("fixture booking not written");
    return { id: row.id, eventId: row.eventId };
  }

  async function ink(v: Venue, title: string, startsAt: Date, endsAt: Date): Promise<string> {
    return (await entry(v, "ink", title, startsAt, endsAt)).id;
  }

  async function phase(eventId: string, spaceId: string, startsAt: Date, durationMinutes: number): Promise<string> {
    const [template] = defaultEventPhaseRows(eventId);
    if (template === undefined) throw new Error("No phase template");
    const [row] = await db.insert(schema.eventPhases).values({
      ...template, templateKey: null, name: "Set-up", spaceId, startsAt, durationMinutes, sortOrder: 100,
    }).returning({ id: schema.eventPhases.id });
    if (row === undefined) throw new Error("Phase not written");
    return row.id;
  }

  async function turnaround(v: Venue, minutes: number): Promise<void> {
    await db.insert(schema.turnaroundRules).values({ venueId: v.venueId, spaceId: v.spaceId, name: "Room turnaround", minutes });
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

  const choose = (decision: Decision, optionId: string): { optionId: string; decisionDigest: string } => ({ optionId, decisionDigest: decision.digest });

  async function history(v: Venue, decisionId: string): Promise<readonly string[]> {
    const read = await readDecision(db, v.staff, decisionId);
    if (!read.ok) throw new Error(read.code);
    return read.value.history.map((event) => event.kind);
  }

  async function commands(bookingId: string): Promise<number> {
    return Number((await pool.query<{ n: string }>("SELECT count(*)::text AS n FROM diary_commands WHERE booking_id = $1", [bookingId])).rows[0]?.n);
  }

  async function kept(decisionId: string): Promise<string> {
    const [row] = (await pool.query<{ kept: string }>("SELECT body::text || coalesce(receipt::text, '') AS kept FROM decisions WHERE id = $1", [decisionId])).rows;
    return row?.kept ?? "";
  }

  const move = (decision: Decision) => decision.options.find((option) => option.id === "move");

  it("prepares a move from what the Diary holds: options, a recommendation with reasons, and what is not worked out", async () => {
    const v = await venue();
    const id = await ink(v, "Crawford wedding", at(14), at(18));
    const decision = await prepared(v, id, at(15), at(19));
    expect(DecisionSchema.parse(decision)).toMatchObject({
      actionClass: "booking_time_move", status: "prepared", subject: { kind: "booking", id }, subjectTitle: "Crawford wedding",
      recommendedOptionId: "move", approverRoles: ["staff", "admin"], receipt: null, supersedes: null,
      requested: { startsAt: at(15).toISOString(), endsAt: at(19).toISOString() }, reason: "The client asked for a later start",
    });
    expect(decision.intendedOutcome).toMatch(/^Move the booking to /u);
    expect(move(decision)).toMatchObject({ executable: true, recommended: true, consequences: [] });
    expect(move(decision)?.mutations).toEqual([expect.objectContaining({ kind: "booking.update", bookingId: id, startsAt: at(15).toISOString(), endsAt: at(19).toISOString() })]);
    expect(decision.options.find((option) => option.id === "keep")).toMatchObject({ executable: true, recommended: false, mutations: [] });
    expect(decision.missingFacts[0]).toContain("staff rota, catering and equipment is not worked out yet");
    expect(await history(v, decision.id)).toEqual(["prepared"]);
    // Preparing changes nothing, and what is kept names no one.
    expect((await booking(id)).startsAt.toISOString()).toBe(at(14).toISOString());
    expect(await kept(decision.id)).not.toMatch(/Crawford|client asked/u);
  });

  it("explains the no-fit: a confirmed booking in the way makes the move not executable, and keeping it is recommended", async () => {
    const v = await venue();
    const id = await ink(v, "Merchants' dinner", at(10), at(12));
    await ink(v, "Spring gala", at(14), at(18));
    const decision = await prepared(v, id, at(15), at(17));
    expect(move(decision)).toMatchObject({ executable: false, recommended: false, mutations: [] });
    expect(move(decision)?.consequences).toEqual([expect.objectContaining({ kind: "ink_double_book", severity: "blocking" })]);
    expect(move(decision)?.reasons[0]).toMatch(/^It cannot move there: Another confirmed booking has the room then \(/u);
    expect(decision.recommendedOptionId).toBe("keep");
    expect(await kept(decision.id)).not.toMatch(/Spring gala|Merchants/u);
    const refused = await decideDecision(db, v.staff, decision.id, choose(decision, "move"), NOW);
    expect(refused).toMatchObject({ ok: false, status: 409, code: "OPTION_NOT_EXECUTABLE" });
    expect((await booking(id)).startsAt.toISOString()).toBe(at(10).toISOString());
  });

  it("executes on approval through the Diary's own command, with its receipt and history, and moves the booking once", async () => {
    const v = await venue();
    const id = await ink(v, "Crawford wedding", at(14), at(18));
    const decision = await prepared(v, id, at(15), at(19));
    // Two approvals at once: one executes, the other is answered with its receipt.
    const [first, second] = await Promise.all([
      decideDecision(db, v.staff, decision.id, choose(decision, "move"), NOW),
      decideDecision(db, v.admin, decision.id, choose(decision, "move"), NOW),
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
    expect(await decideDecision(db, v.staff, decision.id, choose(decision, "keep"), NOW))
      .toMatchObject({ ok: false, status: 409, code: "DECISION_CLOSED" });
  });

  it("never executes a stale approval: it returns the revised decision, which can then be decided", async () => {
    const v = await venue();
    const id = await ink(v, "Crawford wedding", at(14), at(18));
    const decision = await prepared(v, id, at(15), at(19));
    // A colleague edits the booking after the decision was prepared.
    const edited = await updateBookingCore(db, v.staff, id, { notes: "Florist arrives at noon" });
    expect(edited.ok).toBe(true);
    const stale = await decideDecision(db, v.admin, decision.id, choose(decision, "move"), NOW);
    expect(stale).toMatchObject({ ok: false, status: 409, code: "DECISION_STALE" });
    if (stale.ok) throw new Error("expected stale");
    const revised = DecisionSchema.parse((stale.details as { revised: unknown }).revised);
    expect(revised).toMatchObject({ status: "prepared", supersedes: decision.id, requested: decision.requested, reason: decision.reason });
    expect((await booking(id)).startsAt.toISOString()).toBe(at(14).toISOString());
    expect(await commands(id)).toBe(0);
    const old = await readDecision(db, v.staff, decision.id);
    if (!old.ok) throw new Error(old.code);
    expect(old.value.decision).toMatchObject({ status: "superseded", supersededBy: revised.id, receipt: null });
    expect(old.value.history.map((event) => event.kind)).toEqual(["prepared", "stale"]);
    // The revised decision executes.
    const done = await decideDecision(db, v.admin, revised.id, choose(revised, "move"), NOW);
    expect(done).toMatchObject({ ok: true, value: { status: "executed" } });
    expect((await booking(id)).startsAt.toISOString()).toBe(at(15).toISOString());
  });

  it("finds a decision stale when a neighbour changed its consequences, and when it has expired", async () => {
    const v = await venue();
    const id = await ink(v, "Crawford wedding", at(10), at(12));
    const decision = await prepared(v, id, at(15), at(17));
    // A confirmed booking now holds the new time: the move's consequences changed.
    await ink(v, "Spring gala", at(16), at(20));
    const stale = await decideDecision(db, v.admin, decision.id, choose(decision, "move"), NOW);
    expect(stale).toMatchObject({ ok: false, code: "DECISION_STALE" });
    if (stale.ok) throw new Error("expected stale");
    const revised = DecisionSchema.parse((stale.details as { revised: unknown }).revised);
    expect(move(revised)).toMatchObject({ executable: false });
    expect(revised.recommendedOptionId).toBe("keep");

    const later = await prepared(v, id, at(8), at(9));
    const expired = await decideDecision(db, v.admin, later.id, choose(later, "move"), new Date(Date.parse(later.expiresAt) + 1));
    expect(expired).toMatchObject({ ok: false, code: "DECISION_STALE" });
    expect((await booking(id)).startsAt.toISOString()).toBe(at(10).toISOString());
  });

  it("holds approval to its class and its venue: one approval never implies another", async () => {
    const v = await venue();
    const other = await venue();
    const id = await ink(v, "Crawford wedding", at(14), at(18));
    const decision = await prepared(v, id, at(15), at(19), v.sales);
    // Sales may ask and read, not approve a time; nor may the hallkeeper.
    expect(await decideDecision(db, v.sales, decision.id, choose(decision, "move"), NOW)).toMatchObject({ ok: false, status: 403, code: "NOT_AN_APPROVER" });
    expect(await decideDecision(db, v.hallkeeper, decision.id, choose(decision, "move"), NOW)).toMatchObject({ ok: false, status: 403, code: "NOT_AN_APPROVER" });
    // Another venue's staff and admin do not find it.
    expect(await decideDecision(db, other.admin, decision.id, choose(decision, "move"), NOW)).toMatchObject({ ok: false, status: 404 });
    expect(await readDecision(db, other.staff, decision.id)).toMatchObject({ ok: false, status: 404 });
    // A guest-count change: a staff member does not approve it, and its admin
    // cannot have it carried out as a booking move.
    const { intendedOutcome, requested, basis, options, recommendedOptionId, missingFacts, assumptions, question, urgency } = decision;
    const [guestCount] = await db.insert(schema.decisions).values({
      venueId: v.venueId, actionClass: "guest_count_change", subjectKind: "booking", subjectId: id,
      body: { intendedOutcome, requested, basis, options, recommendedOptionId, missingFacts, assumptions, question, urgency, approverRoles: ["admin"] },
      preparedBy: v.staff.id, preparedAt: NOW, expiresAt: new Date(NOW.getTime() + 3_600_000),
    }).returning();
    if (guestCount === undefined) throw new Error("fixture decision not written");
    const read = await readDecision(db, v.admin, guestCount.id);
    if (!read.ok) throw new Error(read.code);
    expect(await decideDecision(db, v.staff, guestCount.id, choose(read.value.decision, "move"), NOW)).toMatchObject({ ok: false, status: 403, code: "NOT_AN_APPROVER" });
    expect(await decideDecision(db, v.admin, guestCount.id, choose(read.value.decision, "move"), NOW)).toMatchObject({ ok: false, status: 409, code: "NOT_CARRIED_OUT_YET" });
    expect((await booking(id)).startsAt.toISOString()).toBe(at(14).toISOString());
  });

  it("changes nothing when the step fails part-way, keeps the failure in the history, and executes when tried again", async () => {
    const v = await venue();
    const id = await ink(v, "Crawford wedding", at(14), at(18));
    const decision = await prepared(v, id, at(15), at(19));
    await expect(decideDecision(db, v.admin, decision.id, choose(decision, "move"), NOW, {
      afterMutation: () => Promise.reject(new Error("the receipt write is lost")),
    })).rejects.toThrow("the receipt write is lost");
    expect((await booking(id)).startsAt.toISOString()).toBe(at(14).toISOString());
    expect(await commands(id)).toBe(0);
    expect(await history(v, decision.id)).toEqual(["prepared", "execution_error"]);
    const read = await readDecision(db, v.staff, decision.id);
    expect(read).toMatchObject({ ok: true, value: { decision: { status: "prepared" } } });
    // Recovery: the same decision, decided again, executes once.
    expect(await decideDecision(db, v.admin, decision.id, choose(decision, "move"), NOW)).toMatchObject({ ok: true, value: { status: "executed" } });
    expect(await commands(id)).toBe(1);
  });

  it("records a decline, a withdrawal, and a booking that left the Diary, each changing nothing, and answers a retry as the first time", async () => {
    const v = await venue();
    const id = await ink(v, "Crawford wedding", at(14), at(18));
    const keep = await prepared(v, id, at(15), at(19));
    expect(await decideDecision(db, v.staff, keep.id, choose(keep, "keep"), NOW))
      .toMatchObject({ ok: true, value: { status: "declined", receipt: { optionId: "keep", outcome: "declined", commandIds: [] } } });

    const withdrawn = await prepared(v, id, at(16), at(20), v.sales);
    expect(await withdrawDecision(db, v.hallkeeper, withdrawn.id, NOW)).toMatchObject({ ok: false, status: 403 });
    expect(await withdrawDecision(db, v.sales, withdrawn.id, NOW)).toMatchObject({ ok: true, value: { status: "withdrawn" } });
    expect(await decideDecision(db, v.admin, withdrawn.id, choose(withdrawn, "move"), NOW))
      .toMatchObject({ ok: false, status: 409, code: "DECISION_CLOSED" });

    const gone = await prepared(v, id, at(9), at(13));
    const cancelled = await transitionBookingCore(db, v.admin, id, { toState: "cancelled" });
    expect(cancelled.ok).toBe(true);
    const failed = await decideDecision(db, v.admin, gone.id, choose(gone, "move"), NOW);
    expect(failed).toMatchObject({ ok: false, status: 409, code: "BOOKING_NOT_ACTIVE" });
    expect(failed.replay).toBeUndefined();
    // The same choice made again is answered as the first time was, marked as a replay.
    expect(await decideDecision(db, v.admin, gone.id, choose(gone, "move"), NOW))
      .toMatchObject({ ok: false, status: 409, code: "BOOKING_NOT_ACTIVE", replay: true });
    const read = await readDecision(db, v.staff, gone.id);
    // A cancelled booking is still in the Diary's records: its title is still read.
    expect(read).toMatchObject({ ok: true, value: { decision: { status: "failed", subjectTitle: "Crawford wedding", receipt: { outcome: "failed", refusal: { code: "BOOKING_NOT_ACTIVE" } } } } });
    expect((await booking(id)).startsAt.toISOString()).toBe(at(14).toISOString());
  });

  it("keeps a decided decision final and its history append-only, and lets its reason be erased and nothing else", async () => {
    const v = await venue();
    const id = await ink(v, "Crawford wedding", at(14), at(18));
    const decision = await prepared(v, id, at(15), at(19));
    await expect(pool.query("UPDATE decisions SET body = '{}'::jsonb WHERE id = $1", [decision.id])).rejects.toThrow(/never changes/u);
    expect(await decideDecision(db, v.staff, decision.id, choose(decision, "keep"), NOW)).toMatchObject({ ok: true });
    await expect(pool.query("UPDATE decisions SET status = 'prepared', receipt = NULL, decided_at = NULL WHERE id = $1", [decision.id]))
      .rejects.toThrow(/final/u);
    await expect(pool.query("DELETE FROM decisions WHERE id = $1", [decision.id])).rejects.toThrow(/kept/u);
    await expect(pool.query("UPDATE decision_events SET kind = 'executed' WHERE decision_id = $1", [decision.id])).rejects.toThrow(/append-only/u);
    await expect(pool.query("DELETE FROM decision_events WHERE decision_id = $1", [decision.id])).rejects.toThrow(/append-only/u);
    // The reason, free text that can name a person, is erased on request, even once decided.
    await expect(pool.query("UPDATE decisions SET reason = 'Another reason' WHERE id = $1", [decision.id])).rejects.toThrow(/only ever erased/u);
    await expect(pool.query("UPDATE decisions SET reason = NULL, expires_at = expires_at + interval '1 day' WHERE id = $1", [decision.id]))
      .rejects.toThrow(/only ever erased/u);
    await pool.query("UPDATE decisions SET reason = NULL WHERE id = $1", [decision.id]);
    expect(await readDecision(db, v.staff, decision.id)).toMatchObject({ ok: true, value: { decision: { reason: null, status: "declined" } } });
    // Second review: a bulk erasure meets rows already erased, which change nothing and pass.
    await prepared(v, id, at(16), at(20));
    await pool.query("UPDATE decisions SET reason = NULL WHERE venue_id = $1", [v.venueId]);
    await pool.query("UPDATE decisions SET reason = NULL WHERE venue_id = $1", [v.venueId]);
  });

  it("keeps a decision with more in its way than it can list readable, with the rest counted", async () => {
    const v = await venue();
    // Thirty-one confirmed bookings, one a day, each with a long title.
    const longTitle = "Annual dinner of the Incorporation ".repeat(5).trim();
    const days = Array.from({ length: 31 }, (_, index) => index + 1);
    await insertBoundBookings(db, days.map((day) => ({
      id: randomUUID(), venueId: v.venueId, spaceId: v.spaceId, kind: "ink" as const, title: longTitle, createdBy: v.admin.id,
      startsAt: at(12, day), endsAt: at(13, day),
    })));
    const id = await ink(v, "Crawford wedding", new Date(Date.UTC(2030, 3, 5, 10)), new Date(Date.UTC(2030, 3, 5, 11)));
    // A move a month long, an honest slip of the date: everything is in its way.
    const decision = await prepared(v, id, at(0, 1), at(23, 31), v.hallkeeper);
    const consequences = move(decision)?.consequences ?? [];
    expect(consequences).toHaveLength(30);
    // The rest are counted, and what was not checked is still said.
    expect(consequences.at(-2)).toMatchObject({ kind: "more", severity: "blocking" });
    expect(consequences.at(-1)).toMatchObject({ kind: "not_checked" });
    expect(decision.missingFacts).toContain("No turnaround rule covers every booking next to it, so some gaps are not checked.");
    expect(move(decision)?.executable).toBe(false);
    expect(await kept(decision.id)).not.toContain("Incorporation");
    // The venue's list and the decision still read, and it can be taken back.
    const list = await listDecisions(db, v.staff, { limit: 50 });
    expect(list.ok && list.value.map((entry) => entry.id)).toContain(decision.id);
    expect(await withdrawDecision(db, v.hallkeeper, decision.id, NOW)).toMatchObject({ ok: true, value: { status: "withdrawn" } });
  });

  it("moves the event phases the Diary moves with the booking, finds what they meet, and the Diary agrees", async () => {
    const v = await venue();
    await turnaround(v, 60);
    await ink(v, "Breakfast meeting", at(8), at(10));
    const wedding = await entry(v, "ink", "Crawford wedding", at(14), at(18));
    if (wedding.eventId === null) throw new Error("the wedding has no event");
    // Its set-up runs before the booking itself, as set-up does.
    const setUp = await phase(wedding.eventId, v.spaceId, at(12), 120);
    const decision = await prepared(v, wedding.id, at(12), at(16));
    // Two hours earlier, the set-up starts at 10:00, as breakfast clears.
    expect(move(decision)?.consequences).toEqual([expect.objectContaining({ kind: "insufficient_turnaround", severity: "warning" })]);
    expect(move(decision)?.consequences[0]?.summary).toMatch(/^Only 0 minutes next to the room's use .*the turnaround guideline is 60 minutes\.$/u);
    expect(decision).toMatchObject({ recommendedOptionId: "keep", question: "Is the shorter turnaround workable for the team?" });
    expect(decision.assumptions).toContain("1 of its event's timed phases move with it, as the Diary moves them.");
    // The approver accepts the shortfall; the Diary moves the set-up where the decision said.
    expect(await decideDecision(db, v.staff, decision.id, choose(decision, "move"), NOW)).toMatchObject({ ok: true, value: { status: "executed" } });
    const [moved] = await db.select({ startsAt: schema.eventPhases.startsAt }).from(schema.eventPhases).where(eq(schema.eventPhases.id, setUp));
    expect(moved?.startsAt?.toISOString()).toBe(at(10).toISOString());
  });

  it("is stale when a phase that moves with the booking was added after it was prepared", async () => {
    const v = await venue();
    const wedding = await entry(v, "ink", "Crawford wedding", at(14), at(18));
    if (wedding.eventId === null) throw new Error("the wedding has no event");
    const decision = await prepared(v, wedding.id, at(15), at(19));
    await phase(wedding.eventId, v.spaceId, at(12), 120);
    expect(await decideDecision(db, v.admin, decision.id, choose(decision, "move"), NOW)).toMatchObject({ ok: false, code: "DECISION_STALE" });
    expect((await booking(wedding.id)).startsAt.toISOString()).toBe(at(14).toISOString());
  });

  it("lists a turnaround that gets worse, and one against the same event's other day", async () => {
    const v = await venue();
    await turnaround(v, 60);
    // Fifty minutes before the next booking today: short already.
    const lunch = await ink(v, "Lunch", at(10), at(12, 10, 10));
    await ink(v, "Afternoon tea", at(13), at(15));
    const worse = await prepared(v, lunch, at(10, 10, 30), at(12, 10, 55));
    expect(move(worse)?.consequences).toEqual([expect.objectContaining({ kind: "insufficient_turnaround", summary: expect.stringMatching(/^Only 5 minutes .*, down from 50; /u) })]);
    expect(worse.recommendedOptionId).toBe("keep");
    // Second review: a move that makes a short turnaround longer is what the move is for, not a shortfall.
    const better = await venue();
    await turnaround(better, 60);
    const late = await ink(better, "Lunch", at(10), at(12, 10, 55));
    await ink(better, "Afternoon tea", at(13), at(15));
    const longer = await prepared(better, late, at(10), at(12, 10, 10));
    expect(move(longer)?.consequences).toEqual([]);
    expect(longer).toMatchObject({ recommendedOptionId: "move", question: null });

    // A two-day conference, one event; day one moved half an hour after breakfast.
    const other = await venue();
    await turnaround(other, 60);
    await ink(other, "Breakfast meeting", at(7, 20), at(8, 20));
    const dayOne = await entry(other, "ink", "Conference day 1", at(9, 20), at(17, 20));
    if (dayOne.eventId === null) throw new Error("the conference has no event");
    await entry(other, "ink", "Conference day 2", at(9, 21), at(17, 21), dayOne.eventId);
    const sibling = await prepared(other, dayOne.id, at(8, 20, 30), at(16, 20, 30));
    expect(move(sibling)?.consequences).toEqual([expect.objectContaining({ kind: "insufficient_turnaround", summary: expect.stringMatching(/^Only 30 minutes /u) })]);
  });

  it("warns of a room closure, which the Diary allows and the approver decides, and blocks a hold the Diary would not move", async () => {
    const v = await venue();
    await entry(v, "internal_block", "Closed: ceiling repairs", at(15), at(17));
    const id = await ink(v, "Crawford wedding", at(10), at(12));
    const closed = await prepared(v, id, at(15), at(16));
    expect(move(closed)).toMatchObject({ executable: true, recommended: false, consequences: [expect.objectContaining({ kind: "room_closed", severity: "warning" })] });
    expect(await kept(closed.id)).not.toContain("ceiling");

    // A hold without its decision date, owner and next action.
    const hold = await entry(v, "hold", "Provisional wedding", at(9, 12), at(12, 12));
    const unready = await prepared(v, hold.id, at(10, 12), at(13, 12));
    expect(move(unready)).toMatchObject({ executable: false });
    expect(move(unready)?.consequences).toContainEqual(expect.objectContaining({ kind: "hold_not_ready", severity: "blocking" }));
  });

  it("declines on 'keep' whatever changed, refuses an answer naming another decision, and answers the same move asked twice with the one prepared", async () => {
    const v = await venue();
    const id = await ink(v, "Crawford wedding", at(14), at(18));
    const decision = await prepared(v, id, at(15), at(19));
    // The same person, the same reason, the Diary as it was: the one standing.
    const again = await prepareBookingTimeMove(db, v.staff, { bookingId: id, startsAt: at(15).toISOString(), endsAt: at(19).toISOString(), reason: "The client asked for a later start" }, NOW);
    expect(again).toMatchObject({ ok: true, status: 200, replay: true, value: { id: decision.id } });
    // Someone else asking is their own request, with their own reason.
    const theirs = await prepareBookingTimeMove(db, v.sales, { bookingId: id, startsAt: at(15).toISOString(), endsAt: at(19).toISOString(), reason: "The band asked" }, NOW);
    expect(theirs).toMatchObject({ ok: true, status: 201, value: { reason: "The band asked", preparedBy: v.sales.id } });
    expect(theirs.ok && theirs.value.id).not.toBe(decision.id);
    const other = await prepared(v, id, at(16), at(20));
    // The answer names the decision shown: the other decision's digest is refused.
    expect(await decideDecision(db, v.admin, other.id, choose(decision, "move"), NOW)).toMatchObject({ ok: false, status: 409, code: "DECISION_MISMATCH" });
    // The booking changes; keeping it still declines, with nothing to revise.
    expect((await updateBookingCore(db, v.staff, id, { notes: "Florist arrives at noon" })).ok).toBe(true);
    expect(await decideDecision(db, v.admin, decision.id, choose(decision, "keep"), NOW)).toMatchObject({ ok: true, value: { status: "declined" } });
    expect(await history(v, decision.id)).toEqual(["prepared", "declined"]);
  });

  it("prepares the same move afresh once the Diary has changed, rather than answering with the old one", async () => {
    const v = await venue();
    const id = await ink(v, "Crawford wedding", at(10), at(12));
    const first = await prepared(v, id, at(15), at(17));
    expect(move(first)?.consequences).toEqual([]);
    await ink(v, "Spring gala", at(16), at(20));
    const again = await prepared(v, id, at(15), at(17));
    expect(again.id).not.toBe(first.id);
    expect(move(again)).toMatchObject({ executable: false, consequences: [expect.objectContaining({ kind: "ink_double_book" })] });
  });

  it("keeps a revision the asker's, says nothing is left when the Diary already moved it, and answers a stale decision's retry as the first time", async () => {
    const v = await venue();
    const id = await ink(v, "Crawford wedding", at(14), at(18));
    const asked = await prepared(v, id, at(15), at(19), v.sales);
    expect((await updateBookingCore(db, v.staff, id, { notes: "Florist arrives at noon" })).ok).toBe(true);
    const stale = await decideDecision(db, v.admin, asked.id, choose(asked, "move"), NOW);
    if (stale.ok) throw new Error("expected stale");
    const revised = DecisionSchema.parse((stale.details as { revised: unknown }).revised);
    // The revision is still the asker's: theirs to withdraw, in their words, and the approver is in its history.
    expect(revised).toMatchObject({ preparedBy: v.sales.id, reason: asked.reason });
    const read = await readDecision(db, v.sales, revised.id);
    expect(read.ok && read.value.history[0]?.detail).toMatchObject({ revisedBy: v.admin.id, supersedes: asked.id });
    // Deciding the stale one again is answered as the first time, with the revision as it stands.
    const retry = await decideDecision(db, v.admin, asked.id, choose(asked, "move"), NOW);
    expect(retry).toMatchObject({ ok: false, status: 409, code: "DECISION_STALE", replay: true, details: { revised: { id: revised.id } } });
    // Someone moves it in the Diary to exactly the asked times: nothing is left to decide.
    expect((await updateBookingCore(db, v.staff, id, { startsAt: at(15).toISOString(), endsAt: at(19).toISOString() })).ok).toBe(true);
    const done = await decideDecision(db, v.admin, revised.id, choose(revised, "move"), NOW);
    expect(done).toMatchObject({ ok: false, status: 409, code: "NO_CHANGE" });
    expect(await commands(id)).toBe(0);
    expect(await withdrawDecision(db, v.sales, revised.id, NOW)).toMatchObject({ ok: false, code: "DECISION_CLOSED" });
  });

  it("carries a phase of no length a day before, and is not made stale by bookings the move does not meet", async () => {
    const v = await venue();
    const wedding = await entry(v, "ink", "Crawford wedding", at(14), at(18));
    if (wedding.eventId === null) throw new Error("the wedding has no event");
    // A delivery noted at a moment, exactly a day before.
    await phase(wedding.eventId, v.spaceId, at(14, 9), 0);
    const decision = await prepared(v, wedding.id, at(15), at(19));
    expect(decision.assumptions).toContain("1 of its event's timed phases move with it, as the Diary moves them.");
    // No turnaround rule: a pair of bookings elsewhere in the window changes nothing about the move.
    await ink(v, "Breakfast", at(7, 11), at(8, 11));
    await ink(v, "Brunch", at(10, 11), at(11, 11));
    expect(await decideDecision(db, v.staff, decision.id, choose(decision, "move"), NOW)).toMatchObject({ ok: true, value: { status: "executed" } });
  });

  it("prepares a move for a booking the Diary holds in the year 9999", async () => {
    const v = await venue();
    const far = await ink(v, "Far future", new Date("9999-12-31T10:00:00.000Z"), new Date("9999-12-31T12:00:00.000Z"));
    const decision = await prepared(v, far, at(15), at(19));
    expect(move(decision)?.executable).toBe(true);
  });

  it("reads the booking's title from the Diary when a decision is read", async () => {
    const v = await venue();
    const id = await ink(v, "Crawford wedding", at(14), at(18));
    const decision = await prepared(v, id, at(15), at(19));
    expect((await updateBookingCore(db, v.staff, id, { title: "Crawford and Lee wedding" })).ok).toBe(true);
    expect(await readDecision(db, v.staff, decision.id)).toMatchObject({ ok: true, value: { decision: { subjectTitle: "Crawford and Lee wedding" } } });
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

      const done = await app.inject({ method: "POST", url: `/decisions/${decision.id}/decide`, headers: as(v.admin), payload: choose(decision, "move") });
      expect(done.statusCode).toBe(200);
      expect(done.headers["idempotency-replay"]).toBeUndefined();
      const again = await app.inject({ method: "POST", url: `/decisions/${decision.id}/decide`, headers: as(v.staff), payload: choose(decision, "move") });
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
        payload: { optionId: "move", decisionDigest: "0".repeat(64) } });
      expect(wrong.statusCode).toBe(409);
      expect(wrong.json()).toMatchObject({ code: "DECISION_MISMATCH" });
      expect((await app.inject({ method: "GET", url: "/decisions", headers: { authorization: `Bearer ${JSON.stringify({ id: randomUUID(), email: "c@x.invalid", role: "client", platformRole: "none", venueId: v.venueId })}` } })).statusCode).toBe(403);
      expect((await booking(id)).startsAt.toISOString()).toBe(at(14).toISOString());
    });

    it("refuses times outside the years the Diary plans in and a reason too long, and keeps a reason whole", async () => {
      const v = await venue();
      const id = await ink(v, "Crawford wedding", at(14), at(18));
      const ask = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/decisions/booking-time-moves", headers: as(v.staff),
        payload: { bookingId: id, startsAt: at(15).toISOString(), endsAt: at(19).toISOString(), ...payload } });
      expect((await ask({ startsAt: "9999-12-30T10:00:00.000Z", endsAt: "9999-12-30T12:00:00.000Z" })).statusCode).toBe(400);
      expect((await ask({ startsAt: "0001-01-02T10:00:00.000Z", endsAt: "0001-01-02T12:00:00.000Z" })).statusCode).toBe(400);
      expect((await ask({ reason: "a".repeat(501) })).statusCode).toBe(400);
      expect((await ask({ reason: "A reason with a \u0000 in it" })).statusCode).toBe(400);
      // A character outside the basic plane is two code units, and one character: the reason keeps it whole.
      const whole = await ask({ reason: `${"a".repeat(499)}\u{1F37E}` });
      expect(whole.statusCode).toBe(201);
      expect(DecisionSchema.parse(whole.json<{ data: unknown }>().data).reason).toBe(`${"a".repeat(499)}\u{1F37E}`);
    });

    it("leaves a decision it cannot read out of the list, and says so when it is asked for", async () => {
      const v = await venue();
      const id = await ink(v, "Crawford wedding", at(14), at(18));
      const readableOne = await prepared(v, id, at(15), at(19));
      const [broken] = (await pool.query<{ id: string }>(
        `INSERT INTO decisions (venue_id, action_class, subject_kind, subject_id, body, prepared_by, expires_at)
         VALUES ($1, 'booking_time_move', 'booking', $2, '{"intendedOutcome": "From an older version"}'::jsonb, $3, now() + interval '1 day') RETURNING id`,
        [v.venueId, id, v.staff.id])).rows;
      if (broken === undefined) throw new Error("fixture row not written");
      const listed = await app.inject({ method: "GET", url: "/decisions", headers: as(v.staff) });
      expect(listed.statusCode).toBe(200);
      const ids = listed.json<{ data: { id: string }[] }>().data.map((row) => row.id);
      expect(ids).toContain(readableOne.id);
      expect(ids).not.toContain(broken.id);
      const asked = await app.inject({ method: "GET", url: `/decisions/${broken.id}`, headers: as(v.staff) });
      expect(asked.statusCode).toBe(409);
      expect(asked.json()).toMatchObject({ code: "DECISION_UNREADABLE" });
    });

    it("answers a failed decision's retry as the first time, refusal and all", async () => {
      const v = await venue();
      const id = await ink(v, "Crawford wedding", at(14), at(18));
      const decision = await prepared(v, id, at(15), at(19));
      expect((await transitionBookingCore(db, v.admin, id, { toState: "cancelled" })).ok).toBe(true);
      const first = await app.inject({ method: "POST", url: `/decisions/${decision.id}/decide`, headers: as(v.admin), payload: choose(decision, "move") });
      const retry = await app.inject({ method: "POST", url: `/decisions/${decision.id}/decide`, headers: as(v.admin), payload: choose(decision, "move") });
      expect([first.statusCode, retry.statusCode]).toEqual([409, 409]);
      expect([first.json<{ code: string }>().code, retry.json<{ code: string }>().code]).toEqual(["BOOKING_NOT_ACTIVE", "BOOKING_NOT_ACTIVE"]);
      expect([first.headers["idempotency-replay"], retry.headers["idempotency-replay"]]).toEqual([undefined, "true"]);
    });
  });
});
