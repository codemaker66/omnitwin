import type {
  BookingKind,
  BookingLiveness,
  CalendarConflict,
  ConflictReport,
  ConflictSeverity,
} from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Conflict engine v0 (T-490; Canon §4).
//
// A pure, deterministic, side-effect-free function: no database, no clock
// reads, no configuration lookups — callers pass everything. Types this
// slice: ink double-book (blocking; the DB constraint normally prevents it,
// the engine still reports it if present in data), hold overlap (advisory —
// the option ladder is overlap BY DESIGN, so hold-over-hold is info and
// hold-under-ink is a warning), and insufficient turnaround gap (warning).
//
// Honesty pattern (Canon §4, house `not_checked` convention): occupancy pairs
// with no applicable turnaround rule are counted and reported not_checked /
// partial — never silently OK. All copy is planning-support language; nothing
// here asserts compliance of any kind.
//
// Time doctrine: all gap math runs on INSTANTS (epoch milliseconds), never on
// wall-clock fields, so Europe/London DST transitions cannot corrupt results.
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
}

/** One contiguous claim on a space's time, after same-event merging. */
interface Occupancy {
  id: string;
  title: string;
  eventType: string | null;
  startMs: number;
  endMs: number;
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

function rankLabel(hold: { rank: number | null; jointFlag: boolean }): string {
  if (hold.rank === null) return "unranked pencil";
  const base = `${ordinal(hold.rank)} option`;
  return hold.jointFlag ? `joint ${base}` : base;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  // Half-open [) semantics: touching edges are not an overlap.
  return aStart < bEnd && bStart < aEnd;
}

function isLive(row: ConflictBookingInput): boolean {
  return row.deletedAt === null && row.status === "active";
}

function chronological(
  a: { readonly startMs: number; readonly id: string },
  b: { readonly startMs: number; readonly id: string },
): number {
  if (a.startMs !== b.startMs) return a.startMs - b.startMs;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Most specific active rule for (spaceId, incoming eventType); ties resolve
 *  toward the LARGEST minutes (fail-safe direction). Null = nothing applies. */
function resolveTurnaroundRule(
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

/** Merge each event's booking + phases into one occupancy interval per space;
 *  bookings without an event (and orphan phases) stand alone. */
function buildOccupancies(
  inks: ReadonlyArray<ConflictBookingInput & { readonly startMs: number; readonly endMs: number }>,
  phases: readonly ConflictPhaseInput[],
): Occupancy[] {
  const byKey = new Map<string, Occupancy>();
  const merge = (
    key: string,
    candidate: Occupancy,
    preferIdentity: boolean,
  ): void => {
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, { ...candidate });
      return;
    }
    existing.startMs = Math.min(existing.startMs, candidate.startMs);
    existing.endMs = Math.max(existing.endMs, candidate.endMs);
    if (preferIdentity) {
      existing.id = candidate.id;
      existing.title = candidate.title;
    }
    existing.eventType ??= candidate.eventType;
  };
  for (const ink of inks) {
    const key = ink.eventId === null ? `booking:${ink.id}` : `event:${ink.eventId}`;
    merge(
      key,
      {
        id: ink.id,
        title: ink.title,
        eventType: ink.eventType,
        startMs: ink.startMs,
        endMs: ink.endMs,
      },
      true,
    );
  }
  for (const row of phases) {
    merge(
      `event:${row.eventId}`,
      {
        id: row.id,
        title: row.eventName,
        eventType: row.eventType,
        startMs: row.startsAt.getTime(),
        endMs: row.endsAt.getTime(),
      },
      false,
    );
  }
  return [...byKey.values()];
}

/**
 * Detect calendar conflicts for one venue's data. Deterministic: the same
 * input (in any order) yields the same report, conflicts sorted by id.
 */
export function detectCalendarConflicts(input: DetectCalendarConflictsInput): ConflictReport {
  const conflicts: CalendarConflict[] = [];

  const liveBookings = input.bookings.filter(isLive);
  const inks = liveBookings.filter((row) => row.kind === "ink");
  const holds = liveBookings.filter((row) => row.kind === "hold");

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
          explanation: `Two inked bookings overlap in this space: "${a.title}" and "${b.title}". The database exclusion constraint normally prevents this — treat it as data needing human review.`,
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
          explanation: `"${a.title}" (${rankLabel(a)}) and "${b.title}" (${rankLabel(b)}) pencil overlapping times in this space — the option ladder at work.`,
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
          explanation: `"${hold.title}" (${rankLabel(hold)}) pencils a slot already inked by "${ink.title}" — the pencil cannot convert while the ink stands; release it or offer another date.`,
        });
      }
    }

    // --- insufficient turnaround (warning) ----------------------------------
    const spacePhases = input.phases.filter((row) => row.spaceId === spaceId);
    const occupancies = buildOccupancies(spaceInks, spacePhases).sort((a, b) =>
      a.startMs !== b.startMs ? a.startMs - b.startMs : a.id < b.id ? -1 : 1,
    );

    for (let i = 0; i + 1 < occupancies.length; i += 1) {
      const current = occupancies[i];
      const next = occupancies[i + 1];
      if (current === undefined || next === undefined) continue;
      const gapMs = next.startMs - current.endMs;
      if (gapMs < 0) continue; // overlapping occupancies are the overlap checks' domain
      turnaroundPairCount += 1;
      const applicable = resolveTurnaroundRule(input.turnaroundRules, spaceId, next.eventType);
      if (applicable === null) {
        turnaroundUncoveredCount += 1;
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

  return {
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
}

export type { ConflictReport, CalendarConflict, ConflictSeverity };
