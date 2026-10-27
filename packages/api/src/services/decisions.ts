import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import {
  DECISION_APPROVER_ROLES,
  DECISION_SCHEMA_VERSION,
  DecisionBodySchema,
  DecisionSchema,
  EVENT_ENDED_STATUSES,
  PREPARABLE_DECISION_CLASSES,
  canApproveDecision,
  sha256Hex,
  stableCanonicalJson,
  type CalendarConflict,
  type CanonicalJsonValue,
  type ConflictSeverity,
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
  holdHygieneIssues,
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
import { phaseMovesWithBooking } from "./event-binding.js";

// ---------------------------------------------------------------------------
// Prepared decisions (goal 09 M1, with M2's first: a booking time move).
//
// Prepare: from what the Diary holds, never from what a screen sends, work out
// the move's consequences with the Diary's own conflict engine (a confirmed
// booking in the way, a hold it would overlap, too little turnaround either
// side, a pair no turnaround rule covers), a hold the Diary's update would
// refuse to move, and a room closed then (the Diary allows that move, so it is
// a warning); offer "move" and "keep" with a recommendation and its reasons,
// say what is not worked out, and record it. The event's phases that the Diary's move carries with the
// booking are carried here by the same rule, and are part of what the
// decision was prepared on.
//
// Decide: only someone holding the approval for this class at this venue
// (DECISION_APPROVER_ROLES; never canManageVenue), naming the decision as they
// read it. "Keep" is the decline, whenever it is chosen. In one transaction,
// under a lock on the decision: a decided decision replays its answer to the
// same choice and refuses another; the booking and its neighbours are read
// again, and if the booking, the phases moving with it or the move's
// consequences changed since it was prepared, nothing executes: the decision
// is superseded by a revised one, which is returned. Otherwise the move runs
// as the Diary's own update command (updateBookingCore, with the booking's
// prepared state as its precondition, recorded in the diary_commands ledger
// under the decision's command id), and the receipt and history are written
// with it. The venue's own rules can still refuse it: then nothing changes and
// the decision is recorded as failed. An unexpected error while carrying it
// out rolls the whole step back, the decision stays prepared, and the error
// is recorded in its history.
//
// Kept for good, so nothing kept names a person: consequences are written from
// times, the booking's title is read from the Diary when a decision is read,
// and the asker's reason sits in its own erasable column.
//
// Not covered: what another person writes to the room in the instant between
// the last read and the move is not seen (a hold pencilled into the new time,
// a booking next to it, a phase added to the event); a confirmed booking there
// is refused by the database's own no-overlap rule.
// ---------------------------------------------------------------------------

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** How long a prepared decision stands before it must be prepared again. */
const DECISION_LIFETIME_MS = DAY_MS;
/** How far either side of a move the Diary is read for its consequences. */
const NEIGHBOUR_WINDOW_MS = DAY_MS;
/** The most consequences a decision lists; the rest are counted. */
const MAX_CONSEQUENCES = 30;
/** The longest a decision's sentence is kept. */
const MAX_WORDS = 500;

/** Not yet worked out for a time move: said on every one until it is (goal 09 M2). */
const NOT_WORKED_OUT = "What the move means for the staff rota, catering and equipment is not worked out yet; check them before approving.";

export type DecisionResult<T> =
  | { readonly ok: true; readonly status: 200 | 201; readonly value: T; readonly replay?: boolean }
  | {
    readonly ok: false;
    readonly status: 400 | 403 | 404 | 409;
    readonly code: string;
    readonly error: string;
    readonly details?: unknown;
    readonly replay?: boolean;
  };

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

function span(startsAt: Date, endsAt: Date): string {
  return `${venueTime(startsAt)} \u2013 ${venueTime(endsAt)}`;
}

/** At most `max` characters, never half of one: a character outside the
 *  basic plane is two code units, and half of it is not text. */
export function clip(text: string, max: number = MAX_WORDS): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max - 1);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return `${cut}\u2026`;
}

function digestOf(value: CanonicalJsonValue): string {
  return sha256Hex(`venviewer.decision.v1\n${stableCanonicalJson(value)}`);
}

/** What an approver's answer names: this decision, as it was prepared. */
export function decisionDigest(row: Pick<DecisionRow, "id" | "body">): string {
  return digestOf({ id: row.id, body: row.body });
}

/** The decision as it is shown, or null when the row cannot be read as one. */
function readable(row: DecisionRow, subjectTitle: string | null): Decision | null {
  const parsed = DecisionSchema.safeParse({
    schemaVersion: DECISION_SCHEMA_VERSION,
    id: row.id,
    venueId: row.venueId,
    actionClass: row.actionClass,
    status: row.status,
    subject: { kind: row.subjectKind, id: row.subjectId },
    subjectTitle: subjectTitle === null ? null : clip(subjectTitle),
    digest: decisionDigest(row),
    reason: row.reason,
    ...row.body,
    preparedBy: row.preparedBy,
    preparedAt: row.preparedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    supersedes: row.supersedes,
    supersededBy: row.supersededBy,
    receipt: row.receipt,
  });
  return parsed.success ? parsed.data : null;
}

/** The titles of the bookings these decisions are about, as the Diary holds them now. */
async function titlesOf(conn: BookingDbConn, rows: readonly DecisionRow[]): Promise<ReadonlyMap<string, string>> {
  const ids = [...new Set(rows.map((row) => row.subjectId))];
  if (ids.length === 0) return new Map();
  const found = await conn.select({ id: bookings.id, title: bookings.title }).from(bookings)
    .where(and(inArray(bookings.id, ids), isNull(bookings.deletedAt)));
  return new Map(found.map((row) => [row.id, row.title]));
}

async function shown(conn: BookingDbConn, row: DecisionRow): Promise<Decision | null> {
  return readable(row, (await titlesOf(conn, [row])).get(row.subjectId) ?? null);
}

const UNREADABLE = deny(409, "DECISION_UNREADABLE", "This decision was kept in a form this version cannot show, so it cannot be acted on here.");

// ---------------------------------------------------------------------------
// Consequences, from the Diary's own conflict engine and rules
// ---------------------------------------------------------------------------

export interface Neighbourhood {
  readonly bookings: readonly ConflictBookingInput[];
  readonly phases: readonly ConflictPhaseInput[];
  readonly rules: readonly ConflictTurnaroundRuleInput[];
}

interface Move {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** The instants PostgreSQL holds: a window a day either side of a booking in
 *  the year 9999 stays inside them. */
const EARLIEST = Date.parse("0001-01-02T00:00:00.000Z");
const LATEST = Date.parse("9999-12-30T23:59:59.999Z");

async function neighbourhood(conn: BookingDbConn, booking: BookingRow, to: Move): Promise<Neighbourhood> {
  const from = new Date(Math.max(EARLIEST, Math.min(booking.startsAt.getTime(), to.startsAt.getTime()) - NEIGHBOUR_WINDOW_MS));
  const until = new Date(Math.min(LATEST, Math.max(booking.endsAt.getTime(), to.endsAt.getTime()) + NEIGHBOUR_WINDOW_MS));
  // One statement at a time: a transaction's connection runs one query at once.
  const bookingRows = await conn.select().from(bookings).where(and(
    eq(bookings.venueId, booking.venueId),
    eq(bookings.spaceId, booking.spaceId),
    isNull(bookings.deletedAt),
    lt(bookings.startsAt, until),
    gt(bookings.endsAt, from),
  )).orderBy(asc(bookings.startsAt), asc(bookings.id));
  const phaseRows = await conn.select({
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
    // An ended event's phases are not the room's use, except the booking's
    // own event's, which the Diary's move carries whatever its status.
    booking.eventId === null
      ? notInArray(events.status, [...EVENT_ENDED_STATUSES])
      : or(notInArray(events.status, [...EVENT_ENDED_STATUSES]), eq(events.id, booking.eventId)),
    eq(eventPhases.spaceId, booking.spaceId),
    lt(eventPhases.startsAt, until),
    // A phase of no length counts: the Diary moves it as well.
    gte(sql`${eventPhases.startsAt} + make_interval(mins => ${eventPhases.durationMinutes})`, from),
  )).orderBy(asc(eventPhases.startsAt), asc(eventPhases.id));
  const ruleRows = await conn.select({
    spaceId: turnaroundRules.spaceId,
    eventType: turnaroundRules.eventType,
    name: turnaroundRules.name,
    minutes: turnaroundRules.minutes,
    isActive: turnaroundRules.isActive,
  }).from(turnaroundRules).where(and(eq(turnaroundRules.venueId, booking.venueId), isNull(turnaroundRules.deletedAt)));
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

/** The event phases the Diary's move would carry with the booking, by its own rule. */
export function carriedPhases(world: Neighbourhood, booking: BookingRow): readonly ConflictPhaseInput[] {
  const eventId = booking.eventId;
  if (eventId === null) return [];
  const live = world.bookings.filter((entry) => entry.status === "active" && entry.deletedAt === null);
  const move = { bookingId: booking.id, eventId, from: { spaceId: booking.spaceId, startsAt: booking.startsAt, endsAt: booking.endsAt } };
  return world.phases.filter((phase) => phaseMovesWithBooking(phase, move, live));
}

/** The Diary as it would be with the booking moved, and the phases it carries with it. */
function moved(world: Neighbourhood, booking: BookingRow, to: Move, carried: readonly ConflictPhaseInput[]): Neighbourhood {
  const delta = to.startsAt.getTime() - booking.startsAt.getTime();
  const carriedIds = new Set(carried.map((phase) => phase.id));
  return {
    ...world,
    bookings: world.bookings.map((entry) => entry.id === booking.id ? { ...entry, startsAt: to.startsAt, endsAt: to.endsAt } : entry),
    phases: world.phases.map((phase) => carriedIds.has(phase.id)
      ? { ...phase, startsAt: new Date(phase.startsAt.getTime() + delta), endsAt: new Date(phase.endsAt.getTime() + delta) }
      : phase),
  };
}

/** What the decision is prepared on: the booking's state, and the phases moving with it. */
function subjectDigestOf(booking: BookingRow, carried: readonly ConflictPhaseInput[]): string {
  return digestOf({
    booking: bookingMutationStateDigest(booking),
    phases: [...carried]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((phase) => ({ id: phase.id, startsAt: phase.startsAt.toISOString(), endsAt: phase.endsAt.toISOString() })),
  });
}

const SEVERITY_RANK: Readonly<Record<ConflictSeverity, number>> = { blocking: 0, warning: 1, info: 2 };
const TURNAROUND = /^Only (\d+) minutes between .* the applicable turnaround guideline is (\d+) minutes/su;

function gapMinutes(conflict: CalendarConflict): number | null {
  const figures = TURNAROUND.exec(conflict.explanation);
  return figures?.[1] === undefined ? null : Number(figures[1]);
}

/** A consequence in the decision's own words: what and when, never whose. */
function consequenceSummary(conflict: CalendarConflict, next: Neighbourhood, ours: ReadonlySet<string>, wasMinutes: number | null): string {
  const otherId = conflict.entryIds.find((id) => !ours.has(id)) ?? conflict.entryIds[1];
  const other = next.bookings.find((entry) => entry.id === otherId) ?? next.phases.find((phase) => phase.id === otherId);
  const when = other === undefined ? "" : ` (${span(other.startsAt, other.endsAt)})`;
  switch (conflict.type) {
    case "ink_double_book":
      return `Another confirmed booking has the room then${when}.`;
    case "hold_overlap":
      return conflict.severity === "info"
        ? `Two provisional holds would overlap${when}; the earlier option decides first.`
        : `A hold and a confirmed booking would overlap${when}; the hold could not be confirmed while the booking stands.`;
    case "insufficient_turnaround": {
      const figures = TURNAROUND.exec(conflict.explanation);
      const was = wasMinutes === null ? "" : `, down from ${String(wasMinutes)}`;
      return figures === null
        ? `Less than the turnaround guideline next to the room's use${when}.`
        : `Only ${figures[1] ?? "?"} minutes next to the room's use${when}${was}; the turnaround guideline is ${figures[2] ?? "?"} minutes.`;
    }
    case "viewing_overlap":
      return `A viewing would overlap the room's use${when}.`;
  }
}

/** Blocking first, then warnings, then the rest; past `limit`, counted. */
function listed(found: readonly DecisionConsequence[], limit: number): DecisionConsequence[] {
  const ordered = [...found].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  if (ordered.length <= limit) return ordered;
  const kept = ordered.slice(0, limit - 1);
  const rest = ordered.slice(limit - 1);
  const worst = rest.reduce<ConflictSeverity>((severity, entry) => SEVERITY_RANK[entry.severity] < SEVERITY_RANK[severity] ? entry.severity : severity, "info");
  return [...kept, { kind: "more", severity: worst, summary: `And ${String(rest.length)} more like those above.`, concerns: [] }];
}

/**
 * What the move brings about that the booking does not have now, or has
 * worse: every conflict the engine finds after the move between a pair it
 * did not find before, or a turnaround that gets shorter (one that gets
 * longer is the move doing its job); a room closure at the new time; and a
 * hold the Diary's update would refuse to move.
 */
export function moveConsequences(world: Neighbourhood, booking: BookingRow, to: Move): readonly DecisionConsequence[] {
  const carried = carriedPhases(world, booking);
  const next = moved(world, booking, to, carried);
  const pairKey = (conflict: CalendarConflict): string => `${conflict.type}|${[...conflict.entryIds].sort().join(",")}`;
  const before = detectCalendarConflicts({ bookings: world.bookings, phases: world.phases, turnaroundRules: world.rules });
  const after = detectCalendarConflicts({ bookings: next.bookings, phases: next.phases, turnaroundRules: next.rules });
  const had = new Map(before.conflicts.map((conflict) => [pairKey(conflict), conflict]));
  const ours = new Set([booking.id, ...carried.map((phase) => phase.id)]);
  const found: DecisionConsequence[] = [];
  for (const conflict of after.conflicts) {
    const prior = had.get(pairKey(conflict));
    let wasMinutes: number | null = null;
    if (prior !== undefined) {
      const was = gapMinutes(prior);
      const now = gapMinutes(conflict);
      if (conflict.type !== "insufficient_turnaround" || was === null || now === null || now >= was) continue;
      wasMinutes = was;
    }
    found.push({
      kind: conflict.type,
      severity: conflict.severity,
      summary: clip(consequenceSummary(conflict, next, ours, wasMinutes)),
      concerns: conflict.entryIds.filter((id) => id !== booking.id).slice(0, 20),
    });
  }
  // A room closed then. The conflict engine does not weigh a closure against a
  // booking, and the Diary lets a booking move into one, so the approver
  // decides (a viewing's overlap with a closure the engine already lists).
  if (booking.kind !== "internal_block" && booking.kind !== "viewing") {
    for (const block of next.bookings) {
      if (block.kind !== "internal_block" || block.status !== "active" || block.deletedAt !== null || block.id === booking.id) continue;
      if (block.startsAt.getTime() < to.endsAt.getTime() && block.endsAt.getTime() > to.startsAt.getTime()) {
        found.push({ kind: "room_closed", severity: "warning", summary: `The room is closed then (${span(block.startsAt, block.endsAt)}).`, concerns: [block.id] });
      }
    }
  }
  // The Diary's update refuses to move a live hold without its follow-up details.
  if (holdHygieneIssues(booking).length > 0) {
    found.push({
      kind: "hold_not_ready",
      severity: "blocking",
      summary: "The hold needs its decision date, owner and a dated next action before the Diary will move it.",
      concerns: [],
    });
  }
  // Said without the engine's count of gaps, which any booking in the window
  // changes: only whether every gap is checked is part of the decision.
  const notChecked: DecisionConsequence[] = after.checks.turnaround.status === "checked" ? [] : [{
    kind: "not_checked",
    severity: "info",
    summary: "Turnaround is not fully checked: no rule covers some of the bookings next to it.",
    concerns: [],
  }];
  // The note is never counted away with the rest.
  return [...listed(found, MAX_CONSEQUENCES - notChecked.length), ...notChecked];
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
  requested: { readonly startsAt: string; readonly endsAt: string },
  now: Date,
): Promise<DecisionBody> {
  const to = { startsAt: new Date(requested.startsAt), endsAt: new Date(requested.endsAt) };
  const world = await neighbourhood(conn, booking, to);
  const consequences = moveConsequences(world, booking, to);
  const blocking = consequences.filter((consequence) => consequence.severity === "blocking");
  const warnings = consequences.filter((consequence) => consequence.severity === "warning");
  const notes = consequences.filter((consequence) => consequence.severity === "info" && consequence.kind !== "not_checked");
  const executable = blocking.length === 0;
  const recommendMove = executable && warnings.length === 0;
  const turnaroundShort = warnings.some((consequence) => consequence.kind === "insufficient_turnaround");
  const move: DecisionOption = {
    id: "move",
    label: clip(`Move it to ${span(to.startsAt, to.endsAt)}`),
    executable,
    recommended: recommendMove,
    reasons: !executable
      ? blocking.slice(0, 10).map((consequence) => clip(`It cannot move there: ${consequence.summary}`))
      : warnings.length > 0
        ? warnings.slice(0, 10).map((consequence) => consequence.summary)
        : notes.length > 0
          ? notes.slice(0, 10).map((consequence) => consequence.summary)
          : ["The Diary finds nothing in the way at the new time."],
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
    label: clip(`Keep it at ${span(booking.startsAt, booking.endsAt)}`),
    executable: true,
    recommended: !recommendMove,
    reasons: recommendMove
      ? ["Nothing changes; the request is answered no."]
      : executable
        ? ["Nothing changes, and what is listed above does not arise."]
        : ["Nothing changes. Moving it would need what is in the way to change first."],
    consequences: [],
    mutations: [],
  };
  const notChecked = consequences.some((consequence) => consequence.kind === "not_checked");
  const carried = carriedPhases(world, booking);
  const body = {
    intendedOutcome: clip(`Move the booking to ${span(to.startsAt, to.endsAt)}`),
    requested,
    basis: {
      bookingDigest: bookingMutationStateDigest(booking),
      subjectDigest: subjectDigestOf(booking, carried),
      consequenceDigest: digestOf(consequences),
      spaceId: booking.spaceId,
      startsAt: booking.startsAt.toISOString(),
      endsAt: booking.endsAt.toISOString(),
    },
    options: [move, keep],
    recommendedOptionId: recommendMove ? "move" : "keep",
    missingFacts: [NOT_WORKED_OUT, ...(notChecked ? ["No turnaround rule covers every booking next to it, so some gaps are not checked."] : [])],
    assumptions: [
      "The booking keeps its room; only its times change.",
      ...(carried.length > 0 ? [`${String(carried.length)} of its event's timed phases move with it, as the Diary moves them.`] : []),
    ],
    question: turnaroundShort
      ? "Is the shorter turnaround workable for the team?"
      : warnings.length > 0 && executable ? "Is what is listed above workable for the team?" : null,
    urgency: urgencyOf(booking.startsAt, now),
    approverRoles: [...DECISION_APPROVER_ROLES.booking_time_move],
  };
  // Checked before it is kept, never after: a decision that cannot be read
  // back would be kept for good and break the venue's list.
  const parsed = DecisionBodySchema.safeParse(body);
  if (!parsed.success) throw new Error(`A prepared decision did not hold its shape: ${parsed.error.message}`);
  return parsed.data;
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
  reason: string | null,
  preparedBy: string,
  now: Date,
  supersedes: string | null,
  revisedBy: string | null = null,
): Promise<DecisionRow> {
  const lifetime = Math.min(DECISION_LIFETIME_MS, Math.max(15 * 60_000, booking.startsAt.getTime() - now.getTime()));
  const [row] = await conn.insert(decisions).values({
    venueId: booking.venueId,
    actionClass: "booking_time_move",
    subjectKind: "booking",
    subjectId: booking.id,
    body,
    reason,
    preparedBy,
    preparedAt: now,
    expiresAt: new Date(now.getTime() + lifetime),
    supersedes,
  }).returning();
  if (row === undefined) throw new Error("decision insert returned no row");
  await appendEvent(conn, row, "prepared", preparedBy, {
    recommendedOptionId: body.recommendedOptionId, supersedes, ...(revisedBy === null ? {} : { revisedBy }),
  });
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
  const requested = { startsAt: new Date(input.startsAt).toISOString(), endsAt: new Date(input.endsAt).toISOString() };
  const reason = input.reason ?? null;
  return db.transaction(async (tx) => {
    const body = await prepareTimeMoveBody(tx, booking, requested, now);
    // The same person asking for the same move again, for the same reason,
    // while the Diary is as it was (a double press, a retry) is answered
    // with the decision that stands. Anyone else's request is their own.
    const standing = await tx.select().from(decisions).where(and(
      eq(decisions.actionClass, "booking_time_move"),
      eq(decisions.subjectKind, "booking"),
      eq(decisions.subjectId, booking.id),
      eq(decisions.status, "prepared"),
      eq(decisions.preparedBy, actor.id),
      gt(decisions.expiresAt, now),
      sql`${decisions.body}->'requested'->>'startsAt' = ${requested.startsAt}`,
      sql`${decisions.body}->'requested'->>'endsAt' = ${requested.endsAt}`,
    )).orderBy(desc(decisions.preparedAt)).limit(1);
    const existing = standing[0];
    if (existing !== undefined && existing.reason === reason
      && existing.body.basis.subjectDigest === body.basis.subjectDigest
      && existing.body.basis.consequenceDigest === body.basis.consequenceDigest) {
      const decision = await shown(tx, existing);
      if (decision !== null) return { ok: true, status: 200, value: decision, replay: true } as const;
    }
    const row = await insertDecision(tx, booking, body, reason, actor.id, now, null);
    // Read back inside the step: a decision that cannot be shown is never kept.
    const decision = readable(row, booking.title);
    if (decision === null) throw new Error("A prepared decision could not be read back");
    return { ok: true, status: 201, value: decision } as const;
  });
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
  const decision = await shown(db, row);
  if (decision === null) return UNREADABLE;
  const history = await db.select().from(decisionEvents)
    .where(eq(decisionEvents.decisionId, row.id))
    .orderBy(asc(decisionEvents.createdAt), asc(decisionEvents.id));
  return { ok: true, status: 200, value: { decision, history: history.map(toEvent) } };
}

/** The venue's decisions, newest first. One that cannot be read as a decision
 *  is left out of the list rather than failing it. */
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
  const titles = await titlesOf(db, rows);
  return { ok: true, status: 200, value: rows.flatMap((row) => readable(row, titles.get(row.subjectId) ?? null) ?? []) };
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
  return { code: result.code.slice(0, 80), message: clip(result.error) };
}

/** A decision as shown after a step, which must read back; a row that will
 *  not is rolled back rather than answered. */
async function after(tx: Tx, row: DecisionRow): Promise<Decision> {
  const decision = await shown(tx, row);
  if (decision === null) throw new Error("A decided decision could not be read back");
  return decision;
}

/**
 * Decide a prepared decision: the option chosen, by someone who holds the
 * approval for its class at its venue, naming the decision as they read it.
 * Returns the decided decision; the same choice made again is answered as it
 * was the first time (`replay`); a stale one returns the revised decision
 * (409 DECISION_STALE, details.revised).
 */
export async function decideDecision(
  db: Database,
  actor: MutationActor,
  decisionId: string,
  input: { readonly optionId: string; readonly decisionDigest: string },
  now: Date = new Date(),
  faults: DecideFaults = {},
): Promise<DecisionResult<Decision>> {
  // Only an error while the change is being carried out is kept in the history.
  const step = { carryingOut: false };
  try {
    return await db.transaction(async (tx) => {
      // Who may see it is settled before anything is locked.
      const [seen] = await tx.select({ venueId: decisions.venueId }).from(decisions).where(eq(decisions.id, decisionId)).limit(1);
      if (seen === undefined || !worksAt(actor, seen.venueId)) return deny(404, "DECISION_NOT_FOUND", "Decision not found");
      const [row] = await tx.select().from(decisions).where(eq(decisions.id, decisionId)).limit(1).for("update");
      if (row === undefined) return deny(404, "DECISION_NOT_FOUND", "Decision not found");
      if (!canApproveDecision(actor, row.venueId, row.actionClass)) {
        return deny(403, "NOT_AN_APPROVER", `Approving this decision needs the venue's ${DECISION_APPROVER_ROLES[row.actionClass].join(" or ")}.`);
      }
      if (!PREPARABLE_DECISION_CLASSES.includes(row.actionClass)) {
        return deny(409, "NOT_CARRIED_OUT_YET", "Decisions of this kind cannot be carried out here yet.");
      }
      const current = await shown(tx, row);
      if (current === null) return UNREADABLE;
      if (row.status !== "prepared") {
        // The same choice made again (a double press, a retry) is answered as it was the first time.
        if (row.status === "superseded" && row.supersededBy !== null) {
          const [revisedRow] = await tx.select().from(decisions).where(eq(decisions.id, row.supersededBy)).limit(1);
          const revised = revisedRow === undefined ? null : await shown(tx, revisedRow);
          if (revised !== null) {
            return { ...deny(409, "DECISION_STALE", "The Diary changed since this was prepared. Here is the decision that replaced it; nothing was changed.", { revised }), replay: true };
          }
        }
        const receipt = row.receipt;
        if (receipt !== null && receipt.optionId === input.optionId) {
          if (receipt.outcome === "failed") {
            return { ...deny(409, receipt.refusal?.code ?? "DECISION_FAILED", receipt.refusal?.message ?? "This decision failed.", { decision: current }), replay: true };
          }
          return { ok: true, status: 200, value: current, replay: true };
        }
        return deny(409, "DECISION_CLOSED", `This decision is already ${row.status}.`, { decision: current });
      }
      if (input.decisionDigest !== current.digest) {
        return deny(409, "DECISION_MISMATCH", "This is not the decision that was shown. Read it again before deciding.", { decision: current });
      }
      const option = row.body.options.find((candidate) => candidate.id === input.optionId);
      if (option === undefined) return deny(400, "UNKNOWN_OPTION", "That is not one of this decision's options.");

      // Keeping it is the decline, whatever has changed since: nothing to check.
      // (A move the Diary would refuse has no change to make either, and is not a decline.)
      if (option.executable && option.mutations.length === 0) {
        const receipt: DecisionReceipt = { optionId: option.id, decidedBy: actor.id, decidedAt: now.toISOString(), outcome: "declined", commandIds: [], refusal: null };
        const closed = await close(tx, row, "declined", now, { receipt });
        await appendEvent(tx, row, "declined", actor.id, { optionId: option.id });
        return { ok: true, status: 200, value: await after(tx, closed) };
      }

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
        return deny(409, "BOOKING_NOT_ACTIVE", receipt.refusal?.message ?? "", { decision: await after(tx, closed) });
      }
      const revisedBody = await prepareTimeMoveBody(tx, booking, row.body.requested, now);
      const stale = expired
        || revisedBody.basis.subjectDigest !== row.body.basis.subjectDigest
        || revisedBody.basis.consequenceDigest !== row.body.basis.consequenceDigest;
      if (stale) {
        // Already where it was asked to go (moved in the Diary meanwhile): nothing is left to decide.
        if (booking.startsAt.toISOString() === row.body.requested.startsAt && booking.endsAt.toISOString() === row.body.requested.endsAt) {
          const receipt: DecisionReceipt = {
            optionId: option.id, decidedBy: actor.id, decidedAt: now.toISOString(), outcome: "failed", commandIds: [],
            refusal: { code: "NO_CHANGE", message: "The booking is already at these times, so nothing was changed." },
          };
          const closed = await close(tx, row, "failed", now, { receipt });
          await appendEvent(tx, row, "failed", actor.id, { optionId: option.id, code: "NO_CHANGE" });
          return deny(409, "NO_CHANGE", receipt.refusal?.message ?? "", { decision: await after(tx, closed) });
        }
        // Never executes: the revised choice goes back to the approver. It is
        // still the asker's request, in their words; the approver who found
        // it stale is named in its history.
        const revised = await insertDecision(tx, booking, revisedBody, row.reason, row.preparedBy, now, row.id, actor.id);
        await close(tx, row, "superseded", now, { supersededBy: revised.id });
        await appendEvent(tx, row, "stale", actor.id, { optionId: option.id, expired, revisedDecisionId: revised.id });
        return deny(409, "DECISION_STALE", "The Diary changed since this was prepared. Here is the decision as it stands now; nothing was changed.", {
          revised: await after(tx, revised),
        });
      }
      if (!option.executable) {
        return deny(409, "OPTION_NOT_EXECUTABLE", option.reasons[0] ?? "This option cannot be carried out as things stand.");
      }

      step.carryingOut = true;
      const ledger = realDiaryCommandDeps(db);
      const commandIds: string[] = [];
      for (const mutation of option.mutations) {
        const result = await updateBookingCore(tx, actor, mutation.bookingId, { startsAt: mutation.startsAt, endsAt: mutation.endsAt }, {
          expectedStateDigest: row.body.basis.bookingDigest,
        });
        if (!result.ok) {
          // The venue's own rules refused it: nothing changed, and that is the answer.
          const receipt: DecisionReceipt = {
            optionId: option.id, decidedBy: actor.id, decidedAt: now.toISOString(), outcome: "failed", commandIds: [], refusal: refusalOf(result),
          };
          const closed = await close(tx, row, "failed", now, { receipt });
          await appendEvent(tx, row, "failed", actor.id, { optionId: option.id, code: result.code });
          return deny(409, result.code, result.error, { decision: await after(tx, closed) });
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
      return { ok: true, status: 200, value: await after(tx, closed) };
    });
  } catch (error) {
    if (error instanceof RollbackWith) return error.result;
    if (step.carryingOut) {
      // Everything in the step rolled back: the decision is still prepared, and
      // the error is kept in its history so the next person sees it happened.
      const [row] = await db.select({ id: decisions.id, venueId: decisions.venueId }).from(decisions).where(eq(decisions.id, decisionId)).limit(1);
      if (row !== undefined) {
        await appendEvent(db, row, "execution_error", actor.id, { optionId: input.optionId, message: "The change could not be completed; nothing was changed." });
      }
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
    const [seen] = await tx.select({ venueId: decisions.venueId }).from(decisions).where(eq(decisions.id, decisionId)).limit(1);
    if (seen === undefined || !worksAt(actor, seen.venueId)) return deny(404, "DECISION_NOT_FOUND", "Decision not found");
    const [row] = await tx.select().from(decisions).where(eq(decisions.id, decisionId)).limit(1).for("update");
    if (row === undefined) return deny(404, "DECISION_NOT_FOUND", "Decision not found");
    if (row.preparedBy !== actor.id && !canApproveDecision(actor, row.venueId, row.actionClass)) {
      return deny(403, "FORBIDDEN", "Only whoever asked for it, or someone who may approve it, can take it back.");
    }
    const current = await shown(tx, row);
    if (current === null) return UNREADABLE;
    if (row.status !== "prepared") return deny(409, "DECISION_CLOSED", `This decision is already ${row.status}.`, { decision: current });
    const closed = await close(tx, row, "withdrawn", now);
    await appendEvent(tx, row, "withdrawn", actor.id);
    return { ok: true, status: 200, value: await after(tx, closed) };
  });
}
