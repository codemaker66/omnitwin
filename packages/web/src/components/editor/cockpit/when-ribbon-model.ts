import type {
  CalendarBookingEntry,
  CalendarPhaseEntry,
  CalendarResponse,
} from "@omnitwin/types";
import { boardRange, snapMs, type BoardRange } from "../../../pages/diary/lib/board-time.js";
import { RIBBON_COPY } from "./when-ribbon-copy.js";
import {
  resolveTurnaroundGuideline,
  type TurnaroundGuideline,
} from "../../../lib/turnaround-guidelines.js";

// The resolver moved to lib/turnaround-guidelines.ts when the Command
// Centre became its second consumer; re-exported so the model's tests (and
// any earlier importer) keep their pin.
export { resolveTurnaroundGuideline, type TurnaroundGuideline };

// ---------------------------------------------------------------------------
// The When ribbon's pure model (Day Board S2) — everything the ribbon
// believes, decided deterministically from one GET /calendar response.
// The DOM shell converts pixels to milliseconds and renders; nothing here
// touches the DOM, so every boundary is unit-testable.
//
// Doctrine (mirrors the Diary board and the server conflict engine):
//  - Ink-vs-ink is DB truth → HARD clamp; the ingot bounces.
//  - Turnaround is guidance → a soft flag and copy, never a clamp.
//  - A pencil under an ink is a warning, never a block.
//  - Buffers exist only where the server engine would measure them: around
//    INK occupancies (booking ∪ its event's room phases), sized by the rule
//    for the INCOMING side's eventType (most-specific wins, ties toward the
//    largest minutes — resolveTurnaroundGuideline mirrors the engine's
//    resolveTurnaroundRule exactly and is pinned by tests).
//
// Known model honesty note: event phases carry absolute times owned by the
// event, so moving a BOOKING does not move its phases — the same is true on
// the Diary board. Ghost occupancies therefore include phases; the dragged
// ingot is the booking span itself.
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000;

export const RIBBON_SNAP_MINUTES = 15;
export const RIBBON_FINE_SNAP_MINUTES = 1;
export const MIN_INGOT_DURATION_MS = 15 * MINUTE_MS;

export interface RibbonSlot {
  readonly id: string;
  readonly title: string;
  readonly kind: CalendarBookingEntry["kind"];
  readonly eventType: string | null;
  readonly startMs: number;
  readonly endMs: number;
  /** Occupancy edges: booking span stretched over its event's phases here. */
  readonly occStartMs: number;
  readonly occEndMs: number;
}

export type GhostExclusion = "hard" | "warning" | "none";

export interface RibbonGhost extends RibbonSlot {
  readonly exclusion: GhostExclusion;
}

export interface RibbonBuffer {
  readonly ghostId: string;
  readonly side: "before" | "after";
  readonly startMs: number;
  readonly endMs: number;
  readonly minutes: number;
  readonly ruleName: string;
}

export interface RibbonDay {
  readonly range: BoardRange;
  readonly spaceId: string;
  readonly self: RibbonSlot;
  readonly ghosts: readonly RibbonGhost[];
  readonly buffers: readonly RibbonBuffer[];
  /** False when the server did not send turnaround rules (older API) — the
   *  ribbon then draws no buffers rather than guessing. */
  readonly guidelinesAvailable: boolean;
}

function isBookingEntry(entry: CalendarResponse["entries"][number]): entry is CalendarBookingEntry {
  return entry.entryType === "booking";
}

function isPhaseEntry(entry: CalendarResponse["entries"][number]): entry is CalendarPhaseEntry {
  return entry.entryType === "phase";
}

function overlapsHalfOpen(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Booking span stretched over its event's phases IN THE SAME ROOM — the
 *  same merge the server's occupancy builder performs. */
function occupancySpan(
  bookingEntry: CalendarBookingEntry,
  phases: readonly CalendarPhaseEntry[],
): { readonly occStartMs: number; readonly occEndMs: number } {
  let occStartMs = Date.parse(bookingEntry.startsAt);
  let occEndMs = Date.parse(bookingEntry.endsAt);
  if (bookingEntry.eventId !== null) {
    for (const phase of phases) {
      if (phase.eventId !== bookingEntry.eventId) continue;
      if (phase.spaceId !== bookingEntry.spaceId) continue;
      occStartMs = Math.min(occStartMs, Date.parse(phase.startsAt));
      occEndMs = Math.max(occEndMs, Date.parse(phase.endsAt));
    }
  }
  return { occStartMs, occEndMs };
}

function toSlot(
  entry: CalendarBookingEntry,
  phases: readonly CalendarPhaseEntry[],
): RibbonSlot {
  return {
    id: entry.id,
    title: entry.title,
    kind: entry.kind,
    eventType: entry.eventType,
    startMs: Date.parse(entry.startsAt),
    endMs: Date.parse(entry.endsAt),
    ...occupancySpan(entry, phases),
  };
}

/** One calendar response + the plan's eventId → the ribbon's whole world,
 *  or null when no active booking carries that eventId (the honest
 *  "not in the Diary yet" state). */
export function buildRibbonDay(response: CalendarResponse, eventId: string): RibbonDay | null {
  const bookingsInResponse = response.entries.filter(isBookingEntry);
  const phases = response.entries.filter(isPhaseEntry);

  const selfEntry = bookingsInResponse.find(
    (entry) => entry.eventId === eventId && entry.status === "active",
  );
  if (selfEntry === undefined) return null;

  const self = toSlot(selfEntry, phases);
  const range = boardRange(self.startMs, "day");
  const selfIsInk = selfEntry.kind === "ink";

  const ghosts: RibbonGhost[] = bookingsInResponse
    .filter(
      (entry) =>
        entry.id !== selfEntry.id &&
        entry.spaceId === selfEntry.spaceId &&
        entry.status === "active",
    )
    .map((entry) => {
      const slot = toSlot(entry, phases);
      const exclusion: GhostExclusion =
        entry.kind === "ink" ? (selfIsInk ? "hard" : "warning") : "none";
      return { ...slot, exclusion };
    })
    .filter((ghost) => overlapsHalfOpen(ghost.occStartMs, ghost.occEndMs, range.fromMs, range.toMs))
    .sort((a, b) => a.occStartMs - b.occStartMs || (a.id < b.id ? -1 : 1));

  // Buffers only where the engine would measure a changeover: ink self,
  // ink ghosts. Before a ghost the incoming side is the GHOST; after it,
  // the incoming side is the (dragged) self.
  const rules = response.turnaroundRules;
  const guidelinesAvailable = rules !== undefined && rules.length > 0;
  const buffers: RibbonBuffer[] = [];
  if (selfIsInk && guidelinesAvailable) {
    for (const ghost of ghosts) {
      if (ghost.exclusion !== "hard") continue;
      const before = resolveTurnaroundGuideline(rules, selfEntry.spaceId, ghost.eventType);
      if (before !== null && before.minutes > 0) {
        buffers.push({
          ghostId: ghost.id,
          side: "before",
          startMs: ghost.occStartMs - before.minutes * MINUTE_MS,
          endMs: ghost.occStartMs,
          minutes: before.minutes,
          ruleName: before.name,
        });
      }
      const after = resolveTurnaroundGuideline(rules, selfEntry.spaceId, self.eventType);
      if (after !== null && after.minutes > 0) {
        buffers.push({
          ghostId: ghost.id,
          side: "after",
          startMs: ghost.occEndMs,
          endMs: ghost.occEndMs + after.minutes * MINUTE_MS,
          minutes: after.minutes,
          ruleName: after.name,
        });
      }
    }
  }

  return {
    range,
    spaceId: selfEntry.spaceId,
    self,
    ghosts,
    buffers,
    guidelinesAvailable,
  };
}

// --- the drag reducer ------------------------------------------------------

export type RibbonDragMode = "move" | "resize-start" | "resize-end";

export interface RibbonDrag {
  readonly mode: RibbonDragMode;
  readonly originStartMs: number;
  readonly originEndMs: number;
  readonly proposedStartMs: number;
  readonly proposedEndMs: number;
  /** Signed ms the pointer pushed past a hard clamp — the rubber-band's
   *  input. Zero when nothing clamped. */
  readonly overshootMs: number;
  /** The first guideline buffer the proposal sits inside, if any. */
  readonly bufferHit: RibbonBuffer | null;
  /** For a pencil self: the title of the ink it would land under. */
  readonly coveredInkTitle: string | null;
}

export function beginRibbonDrag(mode: RibbonDragMode, self: RibbonSlot): RibbonDrag {
  return {
    mode,
    originStartMs: self.startMs,
    originEndMs: self.endMs,
    proposedStartMs: self.startMs,
    proposedEndMs: self.endMs,
    overshootMs: 0,
    bufferHit: null,
    coveredInkTitle: null,
  };
}

function hardSpans(day: RibbonDay): readonly { startMs: number; endMs: number }[] {
  return day.ghosts
    .filter((ghost) => ghost.exclusion === "hard")
    .map((ghost) => ({ startMs: ghost.occStartMs, endMs: ghost.occEndMs }));
}

/** Slide a proposed span back toward its origin until it clears every hard
 *  span (touching edges are legal — half-open). Few ghosts, so a small
 *  fixed-point loop is plenty; if the origin itself is somehow inside a
 *  hard span (data raced under us), fall back to the origin unchanged. */
function clampMove(
  originStartMs: number,
  durationMs: number,
  proposedStartMs: number,
  blocks: readonly { startMs: number; endMs: number }[],
): number {
  const movingRight = proposedStartMs > originStartMs;
  let start = proposedStartMs;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const violating = blocks.find((block) =>
      overlapsHalfOpen(start, start + durationMs, block.startMs, block.endMs),
    );
    if (violating === undefined) return start;
    start = movingRight ? violating.startMs - durationMs : violating.endMs;
    // A clamp can never push past the origin — the origin position was legal.
    if (movingRight ? start < originStartMs : start > originStartMs) return originStartMs;
  }
  return originStartMs;
}

export function moveRibbonDrag(
  drag: RibbonDrag,
  day: RibbonDay,
  rawDeltaMs: number,
  fine: boolean,
): RibbonDrag {
  const step = fine ? RIBBON_FINE_SNAP_MINUTES : RIBBON_SNAP_MINUTES;
  const blocks = hardSpans(day);
  const duration = drag.originEndMs - drag.originStartMs;

  let proposedStartMs = drag.originStartMs;
  let proposedEndMs = drag.originEndMs;
  let overshootMs = 0;

  if (drag.mode === "move") {
    const wanted = snapMs(drag.originStartMs + rawDeltaMs, step);
    proposedStartMs = clampMove(drag.originStartMs, duration, wanted, blocks);
    proposedEndMs = proposedStartMs + duration;
    overshootMs = wanted - proposedStartMs;
  } else if (drag.mode === "resize-end") {
    let wanted = snapMs(drag.originEndMs + rawDeltaMs, step);
    wanted = Math.max(wanted, drag.originStartMs + MIN_INGOT_DURATION_MS);
    let end = wanted;
    for (const block of blocks) {
      if (overlapsHalfOpen(drag.originStartMs, end, block.startMs, block.endMs)) {
        end = Math.max(block.startMs, drag.originStartMs + MIN_INGOT_DURATION_MS);
      }
    }
    proposedEndMs = end;
    overshootMs = wanted - end;
  } else {
    let wanted = snapMs(drag.originStartMs + rawDeltaMs, step);
    wanted = Math.min(wanted, drag.originEndMs - MIN_INGOT_DURATION_MS);
    let start = wanted;
    for (const block of blocks) {
      if (overlapsHalfOpen(start, drag.originEndMs, block.startMs, block.endMs)) {
        start = Math.min(block.endMs, drag.originEndMs - MIN_INGOT_DURATION_MS);
      }
    }
    proposedStartMs = start;
    proposedEndMs = drag.originEndMs;
    overshootMs = wanted - start;
  }

  const bufferHit =
    day.buffers.find((buffer) =>
      overlapsHalfOpen(proposedStartMs, proposedEndMs, buffer.startMs, buffer.endMs),
    ) ?? null;

  const coveredInk = day.ghosts.find(
    (ghost) =>
      ghost.exclusion === "warning" &&
      overlapsHalfOpen(proposedStartMs, proposedEndMs, ghost.occStartMs, ghost.occEndMs),
  );

  return {
    ...drag,
    proposedStartMs,
    proposedEndMs,
    overshootMs,
    bufferHit,
    coveredInkTitle: coveredInk?.title ?? null,
  };
}

export type RibbonDrop =
  | { readonly effect: "noop" }
  | {
      readonly effect: "commit";
      readonly startsAt: string;
      readonly endsAt: string;
      readonly needsInkConfirm: boolean;
      readonly warning: string | null;
    };

export function dropRibbonDrag(drag: RibbonDrag, day: RibbonDay): RibbonDrop {
  if (
    drag.proposedStartMs === drag.originStartMs &&
    drag.proposedEndMs === drag.originEndMs
  ) {
    return { effect: "noop" };
  }
  const warning =
    drag.coveredInkTitle !== null
      ? RIBBON_COPY.pencilUnderInk(drag.coveredInkTitle)
      : drag.bufferHit !== null
        ? RIBBON_COPY.bufferWarning(drag.bufferHit.minutes, drag.bufferHit.ruleName)
        : null;
  return {
    effect: "commit",
    startsAt: new Date(drag.proposedStartMs).toISOString(),
    endsAt: new Date(drag.proposedEndMs).toISOString(),
    needsInkConfirm: day.self.kind === "ink",
    warning,
  };
}
