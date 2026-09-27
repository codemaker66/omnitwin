import {
  resolveTurnaroundGuideline,
} from "../../../lib/turnaround-guidelines.js";
import type {
  CalendarTurnaroundRule, CalendarBookingEntry, CalendarEntry, CalendarPhaseEntry } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Board lane layout (T-493; Canon §8/§18). Pure functions:
//
// - layoutLane: greedy first-fit interval packing of one room's entries into
//   sub-rows (overlapping holds stack; touching edges share a row — half-open
//   semantics, same as the conflict engine). Phases whose event has a booking
//   in the lane become footprint SEGMENTS inside that booking's block
//   (concept A: SETUP/LIVE/TEARDOWN rendered in-block); phases without one
//   stand alone as slim strips and take part in packing.
// - filterBoardEntries: exited bookings hide by default — a VIEW choice; the
//   read model stays complete truth.
// - needsAction: the holding tray's selection — live pencils with overdue
//   next actions, overdue decisions, or no ladder position.
// ---------------------------------------------------------------------------

export interface FootprintSegment {
  readonly id: string;
  readonly name: string;
  readonly startMs: number;
  readonly endMs: number;
}

export interface PositionedBlock {
  readonly entry: CalendarBookingEntry;
  readonly startMs: number;
  readonly endMs: number;
  readonly subRow: number;
  readonly segments: readonly FootprintSegment[];
}

export interface PositionedPhase {
  readonly phase: CalendarPhaseEntry;
  readonly startMs: number;
  readonly endMs: number;
  readonly subRow: number;
}

export interface LaneLayout {
  readonly spaceId: string;
  readonly subRowCount: number;
  readonly blocks: readonly PositionedBlock[];
  readonly orphanPhases: readonly PositionedPhase[];
}

interface Packable {
  readonly id: string;
  readonly startMs: number;
  readonly endMs: number;
}

/** Greedy first-fit packing: returns subRow per packable id. Deterministic
 *  for any input order (sorted by start, then id). */
function pack(items: readonly Packable[]): Map<string, number> {
  const sorted = [...items].sort((a, b) =>
    a.startMs !== b.startMs ? a.startMs - b.startMs : a.id < b.id ? -1 : 1,
  );
  const rowEnds: number[] = [];
  const assignment = new Map<string, number>();
  for (const item of sorted) {
    let row = rowEnds.findIndex((endMs) => endMs <= item.startMs);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(item.endMs);
    } else {
      rowEnds[row] = item.endMs;
    }
    assignment.set(item.id, row);
  }
  return assignment;
}

export function layoutLane(entries: readonly CalendarEntry[], spaceId: string): LaneLayout {
  const bookings: CalendarBookingEntry[] = [];
  const phases: CalendarPhaseEntry[] = [];
  for (const entry of entries) {
    if (entry.spaceId !== spaceId) continue;
    if (entry.entryType === "booking") bookings.push(entry);
    else phases.push(entry);
  }

  const laneEventIds = new Set(
    bookings.map((booking) => booking.eventId).filter((id): id is string => id !== null),
  );
  const attached = new Map<string, FootprintSegment[]>();
  const orphans: CalendarPhaseEntry[] = [];
  for (const phase of phases) {
    if (laneEventIds.has(phase.eventId)) {
      const segments = attached.get(phase.eventId) ?? [];
      segments.push({
        id: phase.id,
        name: phase.name,
        startMs: Date.parse(phase.startsAt),
        endMs: Date.parse(phase.endsAt),
      });
      attached.set(phase.eventId, segments);
    } else {
      orphans.push(phase);
    }
  }
  for (const segments of attached.values()) {
    segments.sort((a, b) => (a.startMs !== b.startMs ? a.startMs - b.startMs : a.id < b.id ? -1 : 1));
  }

  const packables: Packable[] = [
    ...bookings.map((booking) => ({
      id: booking.id,
      startMs: Date.parse(booking.startsAt),
      endMs: Date.parse(booking.endsAt),
    })),
    ...orphans.map((phase) => ({
      id: phase.id,
      startMs: Date.parse(phase.startsAt),
      endMs: Date.parse(phase.endsAt),
    })),
  ];
  const rows = pack(packables);

  const blocks: PositionedBlock[] = bookings
    .map((booking) => ({
      entry: booking,
      startMs: Date.parse(booking.startsAt),
      endMs: Date.parse(booking.endsAt),
      subRow: rows.get(booking.id) ?? 0,
      segments: booking.eventId === null ? [] : (attached.get(booking.eventId) ?? []),
    }))
    .sort((a, b) => (a.startMs !== b.startMs ? a.startMs - b.startMs : a.entry.id < b.entry.id ? -1 : 1));

  const orphanPhases: PositionedPhase[] = orphans
    .map((phase) => ({
      phase,
      startMs: Date.parse(phase.startsAt),
      endMs: Date.parse(phase.endsAt),
      subRow: rows.get(phase.id) ?? 0,
    }))
    .sort((a, b) => (a.startMs !== b.startMs ? a.startMs - b.startMs : a.phase.id < b.phase.id ? -1 : 1));

  const maxRow = [...rows.values()].reduce((max, row) => Math.max(max, row), 0);
  return {
    spaceId,
    subRowCount: rows.size === 0 ? 1 : maxRow + 1,
    blocks,
    orphanPhases,
  };
}


// ---------------------------------------------------------------------------
// Changeover gaps (C1) — the dimensioned spans between neighbouring
// occupancies on a lane, drawn like an architect's dimension line. A gap is
// TIGHT only where the server engine would measure it (ink into ink, the
// guideline resolved for the INCOMING side's eventType) and the gap falls
// short of the guideline. Guidance, never a ruling.
// ---------------------------------------------------------------------------

/** A function either side of a gap, as the changeover sheet names it. */
export interface GapNeighbour {
  readonly id: string;
  readonly title: string;
  readonly eventType: string | null;
}

export interface LaneGap {
  readonly id: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly minutes: number;
  /** Set only when both neighbours are ink and a guideline resolves. */
  readonly guidelineMinutes: number | null;
  readonly guidelineName: string | null;
  readonly tight: boolean;
  /** Both neighbours confirmed: the only gaps the Diary checks against a
   *  changeover time, as the server engine does. */
  readonly checked: boolean;
  /** The function that ends, and the one that follows; the incoming side's
   *  event type chooses the rule. */
  readonly before: GapNeighbour;
  readonly after: GapNeighbour;
}

function gapNeighbour(block: PositionedBlock): GapNeighbour {
  return { id: block.entry.id, title: block.entry.title, eventType: block.entry.eventType };
}

/** A block's occupancy extent: booking window stretched over its attached
 *  phase segments (the same merge the engine and the ribbon use). */
function blockExtent(block: PositionedBlock): { startMs: number; endMs: number } {
  let startMs = block.startMs;
  let endMs = block.endMs;
  for (const segment of block.segments) {
    if (segment.startMs < startMs) startMs = segment.startMs;
    if (segment.endMs > endMs) endMs = segment.endMs;
  }
  return { startMs, endMs };
}

export function laneGaps(
  blocks: readonly PositionedBlock[],
  rules: readonly CalendarTurnaroundRule[] | undefined,
  spaceId: string,
): readonly LaneGap[] {
  // Prospects never block, exits are history — neither takes part in a
  // changeover. Everything else occupies the room.
  const occupants = blocks
    .filter((block) => block.entry.status === "active" && block.entry.kind !== "prospect")
    .map((block) => ({ block, extent: blockExtent(block) }))
    .sort((a, b) => a.extent.startMs - b.extent.startMs || (a.block.entry.id < b.block.entry.id ? -1 : 1));

  const result: LaneGap[] = [];
  for (let index = 0; index + 1 < occupants.length; index += 1) {
    const previous = occupants[index];
    const next = occupants[index + 1];
    if (previous === undefined || next === undefined) continue;
    const startMs = previous.extent.endMs;
    const endMs = next.extent.startMs;
    if (endMs <= startMs) continue; // overlap — the conflict checks' domain
    const inkPair = previous.block.entry.kind === "ink" && next.block.entry.kind === "ink";
    const guideline = inkPair
      ? resolveTurnaroundGuideline(rules, spaceId, next.block.entry.eventType)
      : null;
    const minutes = Math.round((endMs - startMs) / 60_000);
    result.push({
      id: `${previous.block.entry.id}:${next.block.entry.id}`,
      startMs,
      endMs,
      minutes,
      guidelineMinutes: guideline?.minutes ?? null,
      guidelineName: guideline?.name ?? null,
      tight: guideline !== null && minutes < guideline.minutes,
      checked: inkPair,
      before: gapNeighbour(previous.block),
      after: gapNeighbour(next.block),
    });
  }
  return result;
}


/** How a gap measures against the changeover time that applies to it: the
 *  changeover sheet's one line of judgement (T-637). Only a gap between two
 *  confirmed functions is checked, as the lane's copper note is. */
export type GapFit =
  | { readonly kind: "enough" }
  | { readonly kind: "short"; readonly byMinutes: number }
  | { readonly kind: "unchecked" }
  | { readonly kind: "none" };

export function gapFit(
  gap: Pick<LaneGap, "minutes" | "checked">,
  rule: { readonly minutes: number } | null,
): GapFit {
  if (rule === null) return { kind: "none" };
  if (!gap.checked) return { kind: "unchecked" };
  return gap.minutes >= rule.minutes
    ? { kind: "enough" }
    : { kind: "short", byMinutes: rule.minutes - gap.minutes };
}

/** Booked share of a range on one lane: the union of active, non-prospect
 *  occupancy extents clipped to the range, over the range's length. Pure
 *  arithmetic from the diary — never advice. */
export function laneUtilisation(
  blocks: readonly PositionedBlock[],
  range: { readonly fromMs: number; readonly toMs: number },
): number {
  const spans = blocks
    .filter((block) => block.entry.status === "active" && block.entry.kind !== "prospect")
    .map((block) => blockExtent(block))
    .map((extent) => ({
      startMs: Math.max(extent.startMs, range.fromMs),
      endMs: Math.min(extent.endMs, range.toMs),
    }))
    .filter((extent) => extent.endMs > extent.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  let occupied = 0;
  let cursor = -Infinity;
  for (const span of spans) {
    const from = Math.max(span.startMs, cursor);
    if (span.endMs > from) {
      occupied += span.endMs - from;
      cursor = span.endMs;
    }
  }
  const total = range.toMs - range.fromMs;
  return total <= 0 ? 0 : occupied / total;
}

export interface BoardFilter {
  readonly showExited: boolean;
}

export function filterBoardEntries(
  entries: readonly CalendarEntry[],
  filter: BoardFilter,
): readonly CalendarEntry[] {
  return entries.filter((entry) => {
    if (entry.entryType === "phase") return true;
    return filter.showExited || entry.status === "active";
  });
}

export interface NeedsActionItem {
  readonly entry: CalendarBookingEntry;
  readonly reasons: readonly string[];
  /** Earliest overdue instant, for urgency ordering; null when only unranked. */
  readonly overdueSinceMs: number | null;
}

export interface NeedsActionOptions {
  /** Whether a passed decision date is a reason here. False when the
   *  venue-wide decisions list is on the board (T-619) — it already carries
   *  every overdue decision, whatever the booking's date, and saying it twice
   *  is noise. True for an older server that sends no such list. */
  readonly decisions: boolean;
  /** Whether an overdue next action is a reason here. False when the
   *  venue-wide next actions list is on the board (roadmap N3), which carries
   *  them whatever the booking's date. Absent means true. */
  readonly nextActions?: boolean;
}

/** The holding tray (Canon §3 "Open Tentatives" aging): live pencils whose
 *  hygiene has gone stale — overdue next action, overdue decision date, or
 *  no ladder position. Most overdue first. */
export function needsAction(
  entries: readonly CalendarEntry[],
  nowMs: number,
  options: NeedsActionOptions = { decisions: true },
): readonly NeedsActionItem[] {
  const items: NeedsActionItem[] = [];
  for (const entry of entries) {
    if (entry.entryType !== "booking") continue;
    if (entry.kind !== "hold" || entry.status !== "active") continue;

    const reasons: string[] = [];
    let earliestOverdue = Number.POSITIVE_INFINITY;

    if (options.nextActions !== false && entry.nextActionDueAt !== null) {
      const dueMs = Date.parse(entry.nextActionDueAt);
      if (dueMs < nowMs) {
        reasons.push(
          entry.nextAction === null
            ? "Overdue next action."
            : `Overdue next action: ${entry.nextAction}`,
        );
        earliestOverdue = Math.min(earliestOverdue, dueMs);
      }
    }
    if (options.decisions && entry.decisionAt !== null) {
      const decisionMs = Date.parse(entry.decisionAt);
      if (decisionMs < nowMs) {
        reasons.push("The decision date has passed — release it, extend it or confirm it.");
        earliestOverdue = Math.min(earliestOverdue, decisionMs);
      }
    }
    if (entry.rank === null) {
      reasons.push("This provisional hold has no option yet — give it one.");
    }

    if (reasons.length > 0) {
      items.push({
        entry,
        reasons,
        overdueSinceMs: Number.isFinite(earliestOverdue) ? earliestOverdue : null,
      });
    }
  }

  return items.sort((a, b) => {
    const aMs = a.overdueSinceMs ?? Number.POSITIVE_INFINITY;
    const bMs = b.overdueSinceMs ?? Number.POSITIVE_INFINITY;
    if (aMs !== bMs) return aMs - bMs;
    return a.entry.id < b.entry.id ? -1 : 1;
  });
}
