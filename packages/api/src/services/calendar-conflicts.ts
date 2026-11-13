import {
  isLiveBooking,
  rotaLocalDate,
  type BookingKind,
  type BookingLiveness,
  type CalendarConflict,
  type ConflictReport,
  type ConflictSeverity,
} from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Conflict engine v0 (T-490; Canon §4).
//
// A pure, deterministic, side-effect-free function: no database, no clock
// reads, no configuration lookups — callers pass everything. Types this
// slice: ink double-book (blocking; the DB constraint normally prevents it,
// the engine still reports it if present in data), hold overlap (advisory —
// the option ladder is overlap BY DESIGN, so hold-over-hold is info and
// hold-under-ink is a warning), insufficient turnaround gap (warning), and
// viewing overlap (migration 0100: a show-round during a confirmed booking's
// occupancy or a venue block is a warning, two show-rounds at once are info).
//
// Honesty pattern (Canon §4, house `not_checked` convention): occupancy pairs
// with no applicable turnaround rule are counted and reported not_checked /
// partial — never silently OK. All copy is planning-support language; nothing
// here asserts compliance of any kind.
//
// Time doctrine: all gap math runs on INSTANTS (epoch milliseconds), never on
// wall-clock fields, so Europe/London DST transitions cannot corrupt results.
// The one calendar question, which of an event's pieces in a room are one
// occupancy, asks the venue's own day of an instant in its zone (passed in),
// never an offset.
// ---------------------------------------------------------------------------

export interface ConflictBookingInput {
  readonly id: string;
  readonly spaceId: string;
  readonly kind: BookingKind;
  readonly status: BookingLiveness;
  readonly title: string;
  readonly eventType: string | null;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly rank: number | null;
  readonly jointFlag: boolean;
  readonly eventId: string | null;
  readonly deletedAt: Date | null;
}

/** Room-scoped, timed phases only — callers filter out unscoped rows. */
export interface ConflictPhaseInput {
  readonly id: string;
  readonly spaceId: string;
  readonly eventId: string;
  readonly eventName: string;
  readonly name: string;
  readonly eventType: string | null;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export interface ConflictTurnaroundRuleInput {
  readonly spaceId: string | null;
  readonly eventType: string | null;
  readonly name: string;
  readonly minutes: number;
  readonly isActive: boolean;
}

export interface DetectCalendarConflictsInput {
  readonly bookings: readonly ConflictBookingInput[];
  readonly phases: readonly ConflictPhaseInput[];
  readonly turnaroundRules: readonly ConflictTurnaroundRuleInput[];
  /** The venue's IANA zone: an event holds a room on each venue day it uses it. */
  readonly timeZone: string;
}

/** One claim on a space's time: an event's confirmed bookings and phases on
 *  one venue day, or running into one another, or one booking without an
 *  event. */
interface Occupancy {
  readonly id: string;
  readonly title: string;
  readonly eventType: string | null;
  /** The event it belongs to; null for a booking without one. */
  readonly eventId: string | null;
  readonly startMs: number;
  readonly endMs: number;
  /** The booking and phase ids merged into it. */
  readonly members: readonly string[];
}

/** A booking or phase that makes up an occupancy. */
interface OccupancyPiece {
  readonly id: string;
  readonly title: string;
  readonly eventType: string | null;
  readonly startMs: number;
  readonly endMs: number;
  /** A confirmed booking names its occupancy; a phase only where none does. */
  readonly booking: boolean;
}

/** A changeover in a room that no turnaround rule covers, with the booking
 *  and phase ids of the occupancy on either side of it. */
export interface UncoveredTurnaroundGap {
  readonly spaceId: string;
  readonly before: readonly string[];
  readonly after: readonly string[];
}

const MS_PER_MINUTE = 60_000;

function ordinal(rank: number): string {
  const mod100 = rank % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${String(rank)}th`;
  switch (rank % 10) {
    case 1:
      return `${String(rank)}st`;
    case 2:
      return `${String(rank)}nd`;
    case 3:
      return `${String(rank)}rd`;
    default:
      return `${String(rank)}th`;
  }
}

/** A hold's standing in Blake's words: "1st option", "Joint 1st", or
 *  "no option yet". Pencil, ink and ladder never reach the screen. */
function rankLabel(hold: { rank: number | null; jointFlag: boolean }): string {
  if (hold.rank === null) return "no option yet";
  return hold.jointFlag ? `Joint ${ordinal(hold.rank)}` : `${ordinal(hold.rank)} option`;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  // Half-open [) semantics: touching edges are not an overlap.
  return aStart < bEnd && bStart < aEnd;
}

/** The Diary's liveness rule, shared with the public availability read
 *  (isLiveBooking in @omnitwin/types), so the two can never disagree about
 *  which holds and bookings still stand. */
function isLive(row: ConflictBookingInput): boolean {
  return isLiveBooking(row);
}

function chronological(
  a: { readonly startMs: number; readonly id: string },
  b: { readonly startMs: number; readonly id: string },
): number {
  if (a.startMs !== b.startMs) return a.startMs - b.startMs;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Most specific active rule for (spaceId, incoming eventType); ties resolve
 *  toward the LARGEST minutes (fail-safe direction). Null = nothing applies.
 *
 *  Exported because the hallkeeper sheet derives its set-up deadline from the
 *  SAME rule the conflict engine enforces. Two implementations of "how long
 *  this room needs" would eventually disagree, and the sheet is the copy a
 *  hallkeeper acts on. */
export function resolveTurnaroundRule(
  rules: readonly ConflictTurnaroundRuleInput[],
  spaceId: string,
  incomingEventType: string | null,
): ConflictTurnaroundRuleInput | null {
  let best: ConflictTurnaroundRuleInput | null = null;
  let bestScore = -1;
  for (const candidate of rules) {
    if (!candidate.isActive) continue;
    if (candidate.spaceId !== null && candidate.spaceId !== spaceId) continue;
    if (
      candidate.eventType !== null &&
      (incomingEventType === null || candidate.eventType !== incomingEventType)
    ) {
      continue;
    }
    const score =
      (candidate.spaceId !== null ? 2 : 0) + (candidate.eventType !== null ? 1 : 0);
    if (
      score > bestScore ||
      (score === bestScore && best !== null && candidate.minutes > best.minutes)
    ) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/** One occupancy from its pieces: named by its last confirmed booking (or,
 *  with none, its first phase), typed by its first booking with a type, then
 *  its first phase with one. */
function occupancyOf(eventId: string | null, pieces: readonly OccupancyPiece[]): Occupancy | null {
  const bookingPieces = pieces.filter((piece) => piece.booking);
  const phasePieces = pieces.filter((piece) => !piece.booking);
  const named = bookingPieces[bookingPieces.length - 1] ?? phasePieces[0];
  if (named === undefined) return null;
  const typed = [...bookingPieces, ...phasePieces].find((piece) => piece.eventType !== null);
  return {
    id: named.id,
    title: named.title,
    eventType: typed?.eventType ?? null,
    eventId,
    startMs: Math.min(...pieces.map((piece) => piece.startMs)),
    endMs: Math.max(...pieces.map((piece) => piece.endMs)),
    members: pieces.map((piece) => piece.id),
  };
}

/**
 * Each event's confirmed bookings and phases in one space, as the room is
 * held: pieces that overlap or touch, or fall on the same venue day, are one
 * occupancy, so a set-up phase on the morning of an evening booking is that
 * booking's. An event's pieces on another day are another occupancy, so a
 * two-day event never swallows what sits between its days (T-695
 * api-diary-bookings-7). Pieces that do not touch join only while no other
 * booking or phase is in the room between them, so neither an evening
 * past midnight nor a morning set-up swallows another client's booking
 * (T-695 review D1, D2). Bookings without an event stand alone.
 */
function buildOccupancies(
  inks: ReadonlyArray<ConflictBookingInput & { readonly startMs: number; readonly endMs: number }>,
  phases: readonly ConflictPhaseInput[],
  timeZone: string,
): Occupancy[] {
  const occupancies: Occupancy[] = [];
  const byEvent = new Map<string, OccupancyPiece[]>();
  const add = (eventId: string, piece: OccupancyPiece): void => {
    const pieces = byEvent.get(eventId);
    if (pieces === undefined) byEvent.set(eventId, [piece]);
    else pieces.push(piece);
  };
  for (const ink of inks) {
    const piece: OccupancyPiece = {
      id: ink.id, title: ink.title, eventType: ink.eventType, startMs: ink.startMs, endMs: ink.endMs, booking: true,
    };
    if (ink.eventId === null) {
      const alone = occupancyOf(null, [piece]);
      if (alone !== null) occupancies.push(alone);
    } else {
      add(ink.eventId, piece);
    }
  }
  for (const row of phases) {
    add(row.eventId, {
      id: row.id, title: row.eventName, eventType: row.eventType,
      startMs: row.startsAt.getTime(), endMs: row.endsAt.getTime(), booking: false,
    });
  }
  // The venue's calendar day of an instant; a span's day is that of its last
  // occupied instant, as spans are half-open.
  const venueDay = (ms: number): string => rotaLocalDate(ms, timeZone);
  // Whose each piece in the room is, and when: an event's two pieces are one
  // occupancy only while nobody else's is in the room for any of the gap
  // between them, or the event would swallow that booking whatever the day
  // (review D1, D2). A piece that began before the gap and runs on into it
  // counts as much as one that starts there (review Y1).
  const spans = [
    ...inks.map((ink) => ({
      owner: ink.eventId === null ? `booking:${ink.id}` : `event:${ink.eventId}`, startMs: ink.startMs, endMs: ink.endMs,
    })),
    ...phases.map((row) => ({ owner: `event:${row.eventId}`, startMs: row.startsAt.getTime(), endMs: row.endsAt.getTime() })),
  ];
  const someoneElseBetween = (eventId: string, fromMs: number, toMs: number): boolean =>
    spans.some((span) => span.owner !== `event:${eventId}` && span.startMs < toMs && span.endMs > fromMs);
  for (const [eventId, pieces] of byEvent) {
    let run: OccupancyPiece[] = [];
    let runEndMs = Number.NEGATIVE_INFINITY;
    for (const piece of [...pieces].sort(chronological)) {
      const joins = run.length > 0
        && (piece.startMs <= runEndMs
          || (venueDay(piece.startMs) === venueDay(runEndMs - 1) && !someoneElseBetween(eventId, runEndMs, piece.startMs)));
      if (!joins && run.length > 0) {
        const held = occupancyOf(eventId, run);
        if (held !== null) occupancies.push(held);
        run = [];
      }
      runEndMs = run.length === 0 ? piece.endMs : Math.max(runEndMs, piece.endMs);
      run.push(piece);
    }
    const held = occupancyOf(eventId, run);
    if (held !== null) occupancies.push(held);
  }
  return occupancies;
}

/**
 * Detect calendar conflicts for one venue's data. Deterministic: the same
 * input (in any order) yields the same report, conflicts sorted by id.
 */
export function detectCalendarConflicts(input: DetectCalendarConflictsInput): ConflictReport {
  return detectCalendarConflictsInDetail(input).report;
}

/** The report, and which gaps its turnaround check counted as not covered,
 *  for a caller that needs to know whose gaps those are. */
export function detectCalendarConflictsInDetail(input: DetectCalendarConflictsInput): {
  readonly report: ConflictReport;
  readonly uncoveredGaps: readonly UncoveredTurnaroundGap[];
} {
  const conflicts: CalendarConflict[] = [];
  const uncoveredGaps: UncoveredTurnaroundGap[] = [];

  const liveBookings = input.bookings.filter(isLive);
  const inks = liveBookings.filter((row) => row.kind === "ink");
  const holds = liveBookings.filter((row) => row.kind === "hold");
  const viewings = liveBookings.filter((row) => row.kind === "viewing");
  const blocks = liveBookings.filter((row) => row.kind === "internal_block");

  const spaceIds = [
    ...new Set([
      ...liveBookings.map((row) => row.spaceId),
      ...input.phases.map((row) => row.spaceId),
    ]),
  ].sort();

  let turnaroundPairCount = 0;
  let turnaroundUncoveredCount = 0;

  for (const spaceId of spaceIds) {
    const spaceInks = inks
      .filter((row) => row.spaceId === spaceId)
      .map((row) => ({ ...row, startMs: row.startsAt.getTime(), endMs: row.endsAt.getTime() }))
      .sort(chronological);
    const spaceHolds = holds
      .filter((row) => row.spaceId === spaceId)
      .map((row) => ({ ...row, startMs: row.startsAt.getTime(), endMs: row.endsAt.getTime() }))
      .sort(chronological);

    // --- ink double-book (blocking) ----------------------------------------
    for (let i = 0; i < spaceInks.length; i += 1) {
      for (let j = i + 1; j < spaceInks.length; j += 1) {
        const a = spaceInks[i];
        const b = spaceInks[j];
        if (a === undefined || b === undefined) continue;
        if (!overlaps(a.startMs, a.endMs, b.startMs, b.endMs)) continue;
        conflicts.push({
          id: `ink_double_book:${a.id}:${b.id}`,
          type: "ink_double_book",
          severity: "blocking",
          spaceId,
          entryIds: [a.id, b.id],
          explanation: `Two confirmed bookings overlap in this room: "${a.title}" and "${b.title}". The database normally prevents this — treat it as data needing human review.`,
        });
      }
    }

    // --- hold overlap (advisory ladder) -------------------------------------
    for (let i = 0; i < spaceHolds.length; i += 1) {
      for (let j = i + 1; j < spaceHolds.length; j += 1) {
        const a = spaceHolds[i];
        const b = spaceHolds[j];
        if (a === undefined || b === undefined) continue;
        if (!overlaps(a.startMs, a.endMs, b.startMs, b.endMs)) continue;
        conflicts.push({
          id: `hold_overlap:${a.id}:${b.id}`,
          type: "hold_overlap",
          severity: "info",
          spaceId,
          entryIds: [a.id, b.id],
          explanation: `"${a.title}" (${rankLabel(a)}) and "${b.title}" (${rankLabel(b)}) are both provisional for overlapping times in this room — the earlier option decides first.`,
        });
      }
    }
    for (const hold of spaceHolds) {
      for (const ink of spaceInks) {
        if (!overlaps(hold.startMs, hold.endMs, ink.startMs, ink.endMs)) continue;
        const [first, second] = chronological(hold, ink) <= 0 ? [hold, ink] : [ink, hold];
        conflicts.push({
          id: `hold_overlap:${first.id}:${second.id}`,
          type: "hold_overlap",
          severity: "warning",
          spaceId,
          entryIds: [first.id, second.id],
          explanation: `"${hold.title}" (${rankLabel(hold)}) is provisional for a time "${ink.title}" has confirmed. It cannot be confirmed while that booking stands; release it or offer another date.`,
        });
      }
    }

    // --- insufficient turnaround (warning) ----------------------------------
    const spacePhases = input.phases.filter((row) => row.spaceId === spaceId);
    const occupancies = buildOccupancies(spaceInks, spacePhases, input.timeZone).sort((a, b) =>
      a.startMs !== b.startMs ? a.startMs - b.startMs : a.id < b.id ? -1 : 1,
    );

    // Each occupancy is measured against the room's last occupants before it:
    // of those that started before it, the ones with the furthest end. That
    // need not be its neighbour, as a booking or phase can outlast the
    // occupancies that start inside it (T-695 review Z2). An occupancy that
    // starts before that end overlaps it and has no changeover; two confirmed
    // bookings are reported as a double booking above. When every last
    // occupant is its own event, its set stays and there is no changeover
    // either; otherwise it is measured from the last of them that is not.
    let lastOccupants: Occupancy[] = [];
    for (const next of occupancies) {
      const lastEndMs = lastOccupants[0]?.endMs;
      let current: Occupancy | undefined;
      if (lastEndMs !== undefined && next.startMs >= lastEndMs) {
        for (let i = lastOccupants.length - 1; i >= 0 && current === undefined; i -= 1) {
          const held = lastOccupants[i];
          if (held !== undefined && (held.eventId === null || held.eventId !== next.eventId)) current = held;
        }
      }
      if (lastEndMs === undefined || next.endMs > lastEndMs) lastOccupants = [next];
      else if (next.endMs === lastEndMs) lastOccupants.push(next);
      if (current === undefined) continue;
      const gapMs = next.startMs - current.endMs;
      turnaroundPairCount += 1;
      const applicable = resolveTurnaroundRule(input.turnaroundRules, spaceId, next.eventType);
      if (applicable === null) {
        turnaroundUncoveredCount += 1;
        uncoveredGaps.push({ spaceId, before: current.members, after: next.members });
        continue;
      }
      const gapMinutes = Math.round(gapMs / MS_PER_MINUTE);
      if (gapMinutes >= applicable.minutes) continue;
      conflicts.push({
        id: `insufficient_turnaround:${current.id}:${next.id}`,
        type: "insufficient_turnaround",
        severity: "warning",
        spaceId,
        entryIds: [current.id, next.id],
        explanation: `Only ${String(gapMinutes)} minutes between "${current.title}" and "${next.title}" in this space — the applicable turnaround guideline is ${String(applicable.minutes)} minutes (${applicable.name}). Planning support only; the team judges what is workable.`,
      });
    }

    // --- viewing overlap (migration 0100) ------------------------------------
    // A show-round needs the room to be seen: one during an occupancy (a
    // confirmed booking or an event's timed phases in this room, set-up and
    // clearing included, as the occupancies merge them; the turnaround
    // check's entries, so a phase id where an event has no booking here) or a
    // venue closure is a warning; two at once in one room is worth knowing.
    const spaceViewings = viewings
      .filter((row) => row.spaceId === spaceId)
      .map((row) => ({ ...row, startMs: row.startsAt.getTime(), endMs: row.endsAt.getTime() }))
      .sort(chronological);
    const spaceBlocks = blocks
      .filter((row) => row.spaceId === spaceId)
      .map((row) => ({ ...row, startMs: row.startsAt.getTime(), endMs: row.endsAt.getTime() }));
    const pairId = (a: { readonly id: string; readonly startMs: number }, b: { readonly id: string; readonly startMs: number }): [string, string] =>
      chronological(a, b) <= 0 ? [a.id, b.id] : [b.id, a.id];
    for (const viewing of spaceViewings) {
      for (const occupied of occupancies) {
        if (!overlaps(viewing.startMs, viewing.endMs, occupied.startMs, occupied.endMs)) continue;
        const entryIds = pairId(viewing, occupied);
        conflicts.push({
          id: `viewing_overlap:${entryIds[0]}:${entryIds[1]}`,
          type: "viewing_overlap",
          severity: "warning",
          spaceId,
          entryIds,
          explanation: `The viewing "${viewing.title}" overlaps "${occupied.title}", which has this room at that time, set-up and clearing included. Move the viewing, or let the guest know the room will be in use.`,
        });
      }
      for (const block of spaceBlocks) {
        if (!overlaps(viewing.startMs, viewing.endMs, block.startMs, block.endMs)) continue;
        const entryIds = pairId(viewing, block);
        conflicts.push({
          id: `viewing_overlap:${entryIds[0]}:${entryIds[1]}`,
          type: "viewing_overlap",
          severity: "warning",
          spaceId,
          entryIds,
          explanation: `The viewing "${viewing.title}" falls during "${block.title}", when the venue has closed this room.`,
        });
      }
    }
    for (let i = 0; i < spaceViewings.length; i += 1) {
      for (let j = i + 1; j < spaceViewings.length; j += 1) {
        const a = spaceViewings[i];
        const b = spaceViewings[j];
        if (a === undefined || b === undefined) continue;
        if (!overlaps(a.startMs, a.endMs, b.startMs, b.endMs)) continue;
        conflicts.push({
          id: `viewing_overlap:${a.id}:${b.id}`,
          type: "viewing_overlap",
          severity: "info",
          spaceId,
          entryIds: [a.id, b.id],
          explanation: `Two viewings are booked in this room at overlapping times: "${a.title}" and "${b.title}".`,
        });
      }
    }
  }

  conflicts.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const turnaroundStatus: "checked" | "partial" | "not_checked" =
    turnaroundPairCount === 0 || turnaroundUncoveredCount === 0
      ? "checked"
      : turnaroundUncoveredCount < turnaroundPairCount
        ? "partial"
        : "not_checked";

  const turnaroundDetail =
    turnaroundPairCount === 0
      ? "No consecutive occupancy pairs in range needed a turnaround check."
      : turnaroundUncoveredCount === 0
        ? `All ${String(turnaroundPairCount)} consecutive occupancy pairs have an applicable turnaround rule.`
        : turnaroundUncoveredCount < turnaroundPairCount
          ? `${String(turnaroundUncoveredCount)} of ${String(turnaroundPairCount)} consecutive occupancy pairs have no applicable turnaround rule — those gaps are not checked.`
          : `No active turnaround rule covers these spaces yet — ${String(turnaroundPairCount)} occupancy gaps are not checked.`;

  const report: ConflictReport = {
    conflicts,
    checks: {
      inkDoubleBook: { status: "checked" },
      holdOverlap: { status: "checked" },
      turnaround: {
        status: turnaroundStatus,
        uncoveredPairCount: turnaroundUncoveredCount,
        detail: turnaroundDetail,
      },
    },
  };
  return { report, uncoveredGaps };
}

export type { ConflictReport, CalendarConflict, ConflictSeverity };
