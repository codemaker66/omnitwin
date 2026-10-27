import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, isNull, lt, notInArray, sql } from "drizzle-orm";
import {
  DECISION_APPROVER_ROLES,
  DECISION_SCHEMA_VERSION,
  DecisionSchema,
  EVENT_ENDED_STATUSES,
  canApproveDecision,
  sha256Hex,
  stableCanonicalJson,
  type CanonicalJsonValue,
  type Decision,
  type DecisionBody,
  type DecisionConsequence,
  type DecisionEvent,
  type DecisionEventKind,
  type DecisionOption,
  type DecisionReceipt,
  type DecisionStatus,
  type PrepareBookingTimeMove,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { bookings, decisionEvents, decisions, eventPhases, events, turnaroundRules } from "../db/schema.js";
import { canReadDiary } from "../utils/query.js";
import {
  bookingMutationStateDigest,
  updateBookingCore,
  type BookingDbConn,
  type BookingMutationResult,
  type BookingRow,
  type MutationActor,
} from "./booking-mutations.js";
import {
  detectCalendarConflicts,
  type ConflictBookingInput,
  type ConflictPhaseInput,
  type ConflictTurnaroundRuleInput,
} from "./calendar-conflicts.js";
import { realDiaryCommandDeps } from "./diary-commands.js";

// ---------------------------------------------------------------------------
// Prepared decisions (goal 09 M1, with M2's first: a booking time move).
//
// Prepare: from what the Diary holds, never from what a screen sends, work out
// the move's consequences with the Diary's own conflict engine (a confirmed
// booking in the way, a hold it would overlap, too little turnaround either
// side, a pair no turnaround rule covers), offer "move" and "keep" with a
// recommendation and its reasons, say what is not worked out, and record it.
//
// Decide: only someone holding the approval for this class at this venue
// (DECISION_APPROVER_ROLES; never canManageVenue). In one transaction, under
// a lock on the decision: a decided decision replays its receipt to the same
// choice and refuses another; the booking and its neighbours are read again,
// and if the booking or the move's consequences changed since it was
// prepared, nothing executes: the decision is superseded by a revised one,
// which is returned. Otherwise the move runs as the Diary's own update
// command (updateBookingCore, with the booking's prepared state as its
// precondition, recorded in the diary_commands ledger under the decision's
// command id), and the receipt and history are written with it. The venue's
// own rules can still refuse it (another booking took the slot in the
// meantime): then nothing changes and the decision is recorded as failed. An
// unexpected error rolls the whole step back, the decision stays prepared,
// and the error is recorded in its history.
// ---------------------------------------------------------------------------

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** How long a prepared decision stands before it must be prepared again. */
const DECISION_LIFETIME_MS = DAY_MS;
/** How far either side of a move the Diary is read for its consequences. */
const NEIGHBOUR_WINDOW_MS = DAY_MS;

/** Not yet worked out for a time move: said on every one until it is (goal 09 M2). */
const NOT_WORKED_OUT = "What the move means for the staff rota, catering and equipment is not worked out yet; check them before approving.";

export type DecisionResult<T> =
  | { readonly ok: true; readonly status: 200 | 201; readonly value: T; readonly replay?: boolean }
  | { readonly ok: false; readonly status: 400 | 403 | 404 | 409; readonly code: string; readonly error: string; readonly details?: unknown };

/** Seams for tests: a fault after the move and before its receipt, to prove the step is one. */
export interface DecideFaults {
  readonly afterMutation?: () => Promise<void>;
}

type DecisionRow = typeof decisions.$inferSelect;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

function deny(status: 400 | 403 | 404 | 409, code: string, error: string, details?: unknown): DecisionResult<never> {
  return { ok: false, status, code, error, ...(details === undefined ? {} : { details }) };
}

const VENUE_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});

function venueTime(at: Date): string {
  return VENUE_TIME.format(at);
}

function digestOf(value: CanonicalJsonValue): string {
  return sha256Hex(`venviewer.decision.v1\n${stableCanonicalJson(value)}`);
}

export function toDecision(row: DecisionRow): Decision {
  return DecisionSchema.parse({
    schemaVersion: DECISION_SCHEMA_VERSION,
    id: row.id,
    venueId: row.venueId,
    actionClass: row.actionClass,
    status: row.status,
    subject: { kind: row.subjectKind, id: row.subjectId },
    ...row.body,
    preparedBy: row.preparedBy,
    preparedAt: row.preparedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    supersedes: row.supersedes,
    supersededBy: row.supersededBy,
    receipt: row.receipt,
  });
}

// ---------------------------------------------------------------------------
// Consequences, from the Diary's own conflict engine
// ---------------------------------------------------------------------------

interface Neighbourhood {
  readonly bookings: readonly ConflictBookingInput[];
  readonly phases: readonly ConflictPhaseInput[];
  readonly rules: readonly ConflictTurnaroundRuleInput[];
}

async function neighbourhood(conn: BookingDbConn, booking: BookingRow, to: { readonly startsAt: Date; readonly endsAt: Date }): Promise<Neighbourhood> {
  const from = new Date(Math.min(booking.startsAt.getTime(), to.startsAt.getTime()) - NEIGHBOUR_WINDOW_MS);
  const until = new Date(Math.max(booking.endsAt.getTime(), to.endsAt.getTime()) + NEIGHBOUR_WINDOW_MS);
  const [bookingRows, phaseRows, ruleRows] = await Promise.all([
    conn.select().from(bookings).where(and(
      eq(bookings.venueId, booking.venueId),
      eq(bookings.spaceId, booking.spaceId),
      isNull(bookings.deletedAt),
      lt(bookings.startsAt, until),
      gt(bookings.endsAt, from),
    )).orderBy(asc(bookings.startsAt), asc(bookings.id)),
    conn.select({
      id: eventPhases.id,
      spaceId: eventPhases.spaceId,
      name: eventPhases.name,
      startsAt: eventPhases.startsAt,
      durationMinutes: eventPhases.durationMinutes,
      eventId: events.id,
      eventName: events.name,
      eventType: events.eventType,
    }).from(eventPhases).innerJoin(events, eq(eventPhases.eventId, events.id)).where(and(
      eq(events.venueId, booking.venueId),
      isNull(events.deletedAt),
      notInArray(events.status, [...EVENT_ENDED_STATUSES]),
      eq(eventPhases.spaceId, booking.spaceId),
      lt(eventPhases.startsAt, until),
      gt(sql`${eventPhases.startsAt} + make_interval(mins => ${eventPhases.durationMinutes})`, from),
    )).orderBy(asc(eventPhases.startsAt), asc(eventPhases.id)),
    conn.select({
      spaceId: turnaroundRules.spaceId,
      eventType: turnaroundRules.eventType,
      name: turnaroundRules.name,
      minutes: turnaroundRules.minutes,
      isActive: turnaroundRules.isActive,
    }).from(turnaroundRules).where(and(eq(turnaroundRules.venueId, booking.venueId), isNull(turnaroundRules.deletedAt))),
  ]);
  return {
    bookings: bookingRows.map((row) => ({
      id: row.id, spaceId: row.spaceId, kind: row.kind, status: row.status, title: row.title, eventType: row.eventType,
      startsAt: row.startsAt, endsAt: row.endsAt, rank: row.rank, jointFlag: row.jointFlag, eventId: row.eventId, deletedAt: row.deletedAt,
    })),
    phases: phaseRows.flatMap((row) => row.spaceId === null || row.startsAt === null ? [] : [{
      id: row.id, spaceId: row.spaceId, eventId: row.eventId, eventName: row.eventName, name: row.name, eventType: row.eventType,
      startsAt: row.startsAt, endsAt: new Date(row.startsAt.getTime() + row.durationMinutes * 60_000),
    }]),
    rules: ruleRows,
  };
}

/** The Diary as it would be with the booking moved: the booking at its new
 *  times, and its event's phases inside it carried with it, as the move does. */
function moved(world: Neighbourhood, booking: BookingRow, to: { readonly startsAt: Date; readonly endsAt: Date }): Neighbourhood {
  const delta = to.startsAt.getTime() - booking.startsAt.getTime();
  const carried = (phase: ConflictPhaseInput): boolean => booking.eventId !== null && phase.eventId === booking.eventId
    && phase.startsAt.getTime() >= booking.startsAt.getTime() && phase.endsAt.getTime() <= booking.endsAt.getTime();
  return {
    ...world,
    bookings: world.bookings.map((entry) => entry.id === booking.id ? { ...entry, startsAt: to.startsAt, endsAt: to.endsAt } : entry),
    phases: world.phases.map((phase) => carried(phase)
      ? { ...phase, startsAt: new Date(phase.startsAt.getTime() + delta), endsAt: new Date(phase.endsAt.getTime() + delta) }
      : phase),
  };
}

function pairKey(type: string, ids: readonly [string, string]): string {
  return `${type}:${[...ids].sort().join("|")}`;
}

/** What the move brings about for this booking that it does not have now. */
export function moveConsequences(world: Neighbourhood, booking: BookingRow, to: { readonly startsAt: Date; readonly endsAt: Date }): readonly DecisionConsequence[] {
  const before = detectCalendarConflicts({ bookings: world.bookings, phases: world.phases, turnaroundRules: world.rules });
  const next = moved(world, booking, to);
  const after = detectCalendarConflicts({ bookings: next.bookings, phases: next.phases, turnaroundRules: next.rules });
  const had = new Set(before.conflicts.map((conflict) => pairKey(conflict.type, conflict.entryIds)));
  const mine = (ids: readonly [string, string]): boolean => ids.includes(booking.id)
    || (booking.eventId !== null && world.phases.some((phase) => phase.eventId === booking.eventId && ids.includes(phase.id)));
  const found: DecisionConsequence[] = after.conflicts
    .filter((conflict) => mine(conflict.entryIds) && !had.has(pairKey(conflict.type, conflict.entryIds)))
    .map((conflict) => ({
      kind: conflict.type,
      severity: conflict.severity,
      summary: conflict.explanation.slice(0, 500),
      concerns: conflict.entryIds.filter((id) => id !== booking.id),
    }));
  if (after.checks.turnaround.status !== "checked") {
    found.push({
      kind: "not_checked",
      severity: "info",
      summary: `Turnaround is not fully checked: ${after.checks.turnaround.detail}`.slice(0, 500),
      concerns: [],
    });
  }
  return found;
}

// ---------------------------------------------------------------------------
// Preparing a time move
// ---------------------------------------------------------------------------

function urgencyOf(startsAt: Date, now: Date): Decision["urgency"] {
  const until = startsAt.getTime() - now.getTime();
  if (until <= 2 * DAY_MS) return "now";
  if (until <= 14 * DAY_MS) return "soon";
  return "routine";
}

/** The prepared decision for moving this booking to these times, from the Diary as it stands. */
export async function prepareTimeMoveBody(
  conn: BookingDbConn,
  booking: BookingRow,
  requested: { readonly startsAt: string; readonly endsAt: string; readonly reason: string | null },
  now: Date,
): Promise<DecisionBody> {
  const to = { startsAt: new Date(requested.startsAt), endsAt: new Date(requested.endsAt) };
  const consequences = moveConsequences(await neighbourhood(conn, booking, to), booking, to);
  const blocking = consequences.filter((consequence) => consequence.severity === "blocking");
  const warnings = consequences.filter((consequence) => consequence.severity === "warning");
  const executable = blocking.length === 0;
  const recommendMove = executable && warnings.length === 0;
  const move: DecisionOption = {
    id: "move",
    label: `Move it to ${venueTime(to.startsAt)} – ${venueTime(to.endsAt)}`,
    executable,
    recommended: recommendMove,
    reasons: !executable
      ? blocking.map((consequence) => `It cannot move there: ${consequence.summary}`).slice(0, 10)
      : warnings.length > 0
        ? warnings.map((consequence) => consequence.summary).slice(0, 10)
        : ["The Diary finds no clash and no turnaround shortfall at the new time."],
    consequences: [...consequences],
    mutations: executable ? [{
      kind: "booking.update",
      commandId: randomUUID(),
      bookingId: booking.id,
      startsAt: to.startsAt.toISOString(),
      endsAt: to.endsAt.toISOString(),
    }] : [],
  };
  const keep: DecisionOption = {
    id: "keep",
    label: `Keep it at ${venueTime(booking.startsAt)} – ${venueTime(booking.endsAt)}`,
    executable: true,
    recommended: !recommendMove,
    reasons: recommendMove
      ? ["Nothing changes; the request is answered no."]
      : executable
        ? ["Nothing changes, and the shortfall above does not arise."]
        : ["Nothing changes. Moving it would need the booking in the way to move first."],
    consequences: [],
    mutations: [],
  };
  const options = [move, keep];
  const notChecked = consequences.some((consequence) => consequence.kind === "not_checked");
  return {
    intendedOutcome: `Move "${booking.title}" to ${venueTime(to.startsAt)}${requested.reason === null ? "" : `: ${requested.reason}`}`.slice(0, 500),
    requested,
    basis: {
      subjectDigest: bookingMutationStateDigest(booking),
      consequenceDigest: digestOf(consequences),
      title: booking.title.slice(0, 500),
      spaceId: booking.spaceId,
      startsAt: booking.startsAt.toISOString(),
      endsAt: booking.endsAt.toISOString(),
    },
    options,
    recommendedOptionId: recommendMove ? "move" : "keep",
    missingFacts: [NOT_WORKED_OUT, ...(notChecked ? ["No turnaround rule covers every booking next to it, so some gaps are not checked."] : [])],
    assumptions: ["The booking keeps its room; only its times change."],
    question: warnings.length > 0 && executable ? "Is the shorter turnaround workable for the team?" : null,
    urgency: urgencyOf(booking.startsAt, now),
    approverRoles: [...DECISION_APPROVER_ROLES.booking_time_move],
  };
}

async function appendEvent(
  conn: BookingDbConn,
  decision: Pick<DecisionRow, "id" | "venueId">,
  kind: DecisionEventKind,
  actorUserId: string,
  detail: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  await conn.insert(decisionEvents).values({ decisionId: decision.id, venueId: decision.venueId, kind, actorUserId, detail });
}

async function insertDecision(
  conn: BookingDbConn,
  booking: BookingRow,
  body: DecisionBody,
  preparedBy: string,
  now: Date,
  supersedes: string | null,
): Promise<DecisionRow> {
  const lifetime = Math.min(DECISION_LIFETIME_MS, Math.max(15 * 60_000, booking.startsAt.getTime() - now.getTime()));
  const [row] = await conn.insert(decisions).values({
    venueId: booking.venueId,
    actionClass: "booking_time_move",
    subjectKind: "booking",
    subjectId: booking.id,
    body,
    preparedBy,
    preparedAt: now,
    expiresAt: new Date(now.getTime() + lifetime),
    supersedes,
  }).returning();
  if (row === undefined) throw new Error("decision insert returned no row");
  await appendEvent(conn, row, "prepared", preparedBy, { recommendedOptionId: body.recommendedOptionId, supersedes });
  return row;
}

/** Who may ask for, read and follow a venue's decisions: the people who read its Diary, at that venue. */
function worksAt(actor: MutationActor, venueId: string): boolean {
  return actor.venueId === venueId && canReadDiary(actor, venueId);
}

export async function prepareBookingTimeMove(
  db: Database,
  actor: MutationActor,
  input: PrepareBookingTimeMove,
  now: Date = new Date(),
): Promise<DecisionResult<Decision>> {
  const [booking] = await db.select().from(bookings).where(and(eq(bookings.id, input.bookingId), isNull(bookings.deletedAt))).limit(1);
  if (booking === undefined || !worksAt(actor, booking.venueId)) return deny(404, "BOOKING_NOT_FOUND", "Booking not found");
  if (booking.status !== "active") {
    return deny(409, "BOOKING_NOT_ACTIVE", "This booking has left the Diary, so there is nothing to move.");
  }
  if (booking.startsAt.getTime() === Date.parse(input.startsAt) && booking.endsAt.getTime() === Date.parse(input.endsAt)) {
    return deny(400, "NO_CHANGE", "The booking is already at these times.");
  }
  const row = await db.transaction(async (tx) => {
    const body = await prepareTimeMoveBody(tx, booking, { startsAt: input.startsAt, endsAt: input.endsAt, reason: input.reason ?? null }, now);
    return insertDecision(tx, booking, body, actor.id, now, null);
  });
  return { ok: true, status: 201, value: toDecision(row) };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function toEvent(row: typeof decisionEvents.$inferSelect): DecisionEvent {
  return { id: row.id, decisionId: row.decisionId, kind: row.kind, actorUserId: row.actorUserId, at: row.createdAt.toISOString(), detail: row.detail };
}

export async function readDecision(
  db: Database,
  actor: MutationActor,
  decisionId: string,
): Promise<DecisionResult<{ readonly decision: Decision; readonly history: readonly DecisionEvent[] }>> {
  const [row] = await db.select().from(decisions).where(eq(decisions.id, decisionId)).limit(1);
  // Another venue's decision is not found: its existence is not told.
  if (row === undefined || !worksAt(actor, row.venueId)) return deny(404, "DECISION_NOT_FOUND", "Decision not found");
  const history = await db.select().from(decisionEvents)
    .where(eq(decisionEvents.decisionId, row.id))
    .orderBy(asc(decisionEvents.createdAt), asc(decisionEvents.id));
  return { ok: true, status: 200, value: { decision: toDecision(row), history: history.map(toEvent) } };
}

export async function listDecisions(
  db: Database,
  actor: MutationActor,
  filter: { readonly status?: DecisionStatus; readonly limit: number },
): Promise<DecisionResult<readonly Decision[]>> {
  const venueId = actor.venueId;
  if (venueId === null || !worksAt(actor, venueId)) return deny(403, "FORBIDDEN", "Decisions are read at the venue you work at");
  const rows = await db.select().from(decisions)
    .where(and(eq(decisions.venueId, venueId), filter.status === undefined ? undefined : eq(decisions.status, filter.status)))
    .orderBy(desc(decisions.preparedAt), desc(decisions.id))
    .limit(filter.limit);
  return { ok: true, status: 200, value: rows.map(toDecision) };
}

// ---------------------------------------------------------------------------
// Deciding
// ---------------------------------------------------------------------------

class RollbackWith extends Error {
  constructor(readonly result: DecisionResult<Decision>) {
    super("rollback");
  }
}

async function close(
  tx: Tx,
  row: DecisionRow,
  status: Exclude<DecisionStatus, "prepared">,
  now: Date,
  extra: { readonly receipt?: DecisionReceipt; readonly supersededBy?: string } = {},
): Promise<DecisionRow> {
  const [updated] = await tx.update(decisions).set({
    status,
    decidedAt: now,
    ...(extra.receipt === undefined ? {} : { receipt: extra.receipt }),
    ...(extra.supersededBy === undefined ? {} : { supersededBy: extra.supersededBy }),
  }).where(and(eq(decisions.id, row.id), eq(decisions.status, "prepared"))).returning();
  if (updated === undefined) throw new Error("decision changed under its lock");
  return updated;
}

function refusalOf(result: Extract<BookingMutationResult, { ok: false }>): DecisionReceipt["refusal"] {
  return { code: result.code.slice(0, 80), message: result.error.slice(0, 500) };
}

/**
 * Decide a prepared decision: the option chosen, by someone who holds the
 * approval for its class at its venue. Returns the decided decision, its
 * receipt replayed (`replay`) for the same choice made again, or the revised
 * decision when this one was stale (409 DECISION_STALE, details.revised).
 */
export async function decideDecision(
  db: Database,
  actor: MutationActor,
  decisionId: string,
  input: { readonly optionId: string; readonly subjectDigest: string },
  now: Date = new Date(),
  faults: DecideFaults = {},
): Promise<DecisionResult<Decision>> {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.select().from(decisions).where(eq(decisions.id, decisionId)).limit(1).for("update");
      if (row === undefined || !worksAt(actor, row.venueId)) return deny(404, "DECISION_NOT_FOUND", "Decision not found");
      if (!canApproveDecision(actor, row.venueId, row.actionClass)) {
        return deny(403, "NOT_AN_APPROVER", `Approving this decision needs the venue's ${row.body.approverRoles.join(" or ")}.`);
      }
      if (row.status !== "prepared") {
        // The same choice made again (a double press, a retry) is answered with what happened.
        if (row.receipt !== null && row.receipt.optionId === input.optionId) {
          return { ok: true, status: 200, value: toDecision(row), replay: true };
        }
        return deny(409, "DECISION_CLOSED", `This decision is already ${row.status}.`, { decision: toDecision(row) });
      }
      if (input.subjectDigest !== row.body.basis.subjectDigest) {
        return deny(409, "DECISION_MISMATCH", "This is not the decision that was shown. Read it again before deciding.", { decision: toDecision(row) });
      }
      const option = row.body.options.find((candidate) => candidate.id === input.optionId);
      if (option === undefined) return deny(400, "UNKNOWN_OPTION", "That is not one of this decision's options.");

      // The Diary as it is now: the booking, locked, and the move's consequences.
      const [booking] = await tx.select().from(bookings).where(eq(bookings.id, row.subjectId)).limit(1).for("update");
      const expired = now.getTime() >= row.expiresAt.getTime();
      const gone = booking === undefined || booking.deletedAt !== null || booking.status !== "active";
      if (gone) {
        const receipt: DecisionReceipt = {
          optionId: option.id, decidedBy: actor.id, decidedAt: now.toISOString(), outcome: "failed", commandIds: [],
          refusal: { code: "BOOKING_NOT_ACTIVE", message: "The booking has left the Diary since this was prepared, so nothing was changed." },
        };
        const closed = await close(tx, row, "failed", now, { receipt });
        await appendEvent(tx, row, "failed", actor.id, { optionId: option.id, code: "BOOKING_NOT_ACTIVE" });
        return deny(409, "BOOKING_NOT_ACTIVE", receipt.refusal?.message ?? "", { decision: toDecision(closed) });
      }
      const revisedBody = await prepareTimeMoveBody(tx, booking, row.body.requested, now);
      const stale = expired
        || bookingMutationStateDigest(booking) !== row.body.basis.subjectDigest
        || revisedBody.basis.consequenceDigest !== row.body.basis.consequenceDigest;
      if (stale) {
        // Never executes: the revised choice goes back to the approver.
        const revised = await insertDecision(tx, booking, revisedBody, actor.id, now, row.id);
        await close(tx, row, "superseded", now, { supersededBy: revised.id });
        await appendEvent(tx, row, "stale", actor.id, { optionId: option.id, expired, revisedDecisionId: revised.id });
        return deny(409, "DECISION_STALE", "The Diary changed since this was prepared. Here is the decision as it stands now; nothing was changed.", {
          revised: toDecision(revised),
        });
      }
      if (!option.executable) {
        return deny(409, "OPTION_NOT_EXECUTABLE", option.reasons[0] ?? "This option cannot be carried out as things stand.");
      }

      if (option.mutations.length === 0) {
        const receipt: DecisionReceipt = { optionId: option.id, decidedBy: actor.id, decidedAt: now.toISOString(), outcome: "declined", commandIds: [], refusal: null };
        const closed = await close(tx, row, "declined", now, { receipt });
        await appendEvent(tx, row, "declined", actor.id, { optionId: option.id });
        return { ok: true, status: 200, value: toDecision(closed) };
      }

      const ledger = realDiaryCommandDeps(db);
      const commandIds: string[] = [];
      for (const mutation of option.mutations) {
        const result = await updateBookingCore(tx, actor, mutation.bookingId, { startsAt: mutation.startsAt, endsAt: mutation.endsAt }, {
          expectedStateDigest: row.body.basis.subjectDigest,
        });
        if (!result.ok) {
          // The venue's own rules refused it: nothing changed, and that is the answer.
          const receipt: DecisionReceipt = {
            optionId: option.id, decidedBy: actor.id, decidedAt: now.toISOString(), outcome: "failed", commandIds: [], refusal: refusalOf(result),
          };
          const closed = await close(tx, row, "failed", now, { receipt });
          await appendEvent(tx, row, "failed", actor.id, { optionId: option.id, code: result.code });
          return deny(409, result.code, result.error, { decision: toDecision(closed) });
        }
        const recorded = await ledger.recordCommand(tx, {
          commandId: mutation.commandId, venueId: row.venueId, userId: actor.id, kind: "booking.update",
          bookingId: mutation.bookingId, outcome: "applied", statusCode: result.status, errorCode: null,
        });
        if (recorded === "duplicate") throw new RollbackWith(deny(409, "COMMAND_ALREADY_RECORDED", "This change was already recorded by the Diary."));
        commandIds.push(mutation.commandId);
      }
      await faults.afterMutation?.();
      const receipt: DecisionReceipt = { optionId: option.id, decidedBy: actor.id, decidedAt: now.toISOString(), outcome: "executed", commandIds, refusal: null };
      const closed = await close(tx, row, "executed", now, { receipt });
      await appendEvent(tx, row, "executed", actor.id, { optionId: option.id, commandIds: commandIds.join(",") });
      return { ok: true, status: 200, value: toDecision(closed) };
    });
  } catch (error) {
    if (error instanceof RollbackWith) return error.result;
    // Everything in the step rolled back: the decision is still prepared, and
    // the error is kept in its history so the next person sees it happened.
    const [row] = await db.select({ id: decisions.id, venueId: decisions.venueId }).from(decisions).where(eq(decisions.id, decisionId)).limit(1);
    if (row !== undefined) {
      await appendEvent(db, row, "execution_error", actor.id, { optionId: input.optionId, message: "The change could not be completed; nothing was changed." });
    }
    throw error;
  }
}

/** Taking back a prepared decision: by whoever prepared it, or an approver of its class. */
export async function withdrawDecision(
  db: Database,
  actor: MutationActor,
  decisionId: string,
  now: Date = new Date(),
): Promise<DecisionResult<Decision>> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(decisions).where(eq(decisions.id, decisionId)).limit(1).for("update");
    if (row === undefined || !worksAt(actor, row.venueId)) return deny(404, "DECISION_NOT_FOUND", "Decision not found");
    if (row.preparedBy !== actor.id && !canApproveDecision(actor, row.venueId, row.actionClass)) {
      return deny(403, "FORBIDDEN", "Only whoever asked for it, or someone who may approve it, can take it back.");
    }
    if (row.status !== "prepared") return deny(409, "DECISION_CLOSED", `This decision is already ${row.status}.`, { decision: toDecision(row) });
    const closed = await close(tx, row, "withdrawn", now);
    await appendEvent(tx, row, "withdrawn", actor.id);
    return { ok: true, status: 200, value: toDecision(closed) };
  });
}
