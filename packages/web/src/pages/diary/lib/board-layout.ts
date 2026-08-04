import type { CalendarBookingEntry, CalendarEntry, CalendarPhaseEntry } from "@omnitwin/types";

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

/** The holding tray (Canon §3 "Open Tentatives" aging): live pencils whose
 *  hygiene has gone stale — overdue next action, overdue decision date, or
 *  no ladder position. Most overdue first. */
export function needsAction(
  entries: readonly CalendarEntry[],
  nowMs: number,
): readonly NeedsActionItem[] {
  const items: NeedsActionItem[] = [];
  for (const entry of entries) {
    if (entry.entryType !== "booking") continue;
    if (entry.kind !== "hold" || entry.status !== "active") continue;

    const reasons: string[] = [];
    let earliestOverdue = Number.POSITIVE_INFINITY;

    if (entry.nextActionDueAt !== null) {
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
    if (entry.decisionAt !== null) {
      const decisionMs = Date.parse(entry.decisionAt);
      if (decisionMs < nowMs) {
        reasons.push("The decision date has passed — release, extend, or ink.");
        earliestOverdue = Math.min(earliestOverdue, decisionMs);
      }
    }
    if (entry.rank === null) {
      reasons.push("This pencil is unranked — give it a ladder position.");
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
