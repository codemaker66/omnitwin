import type {
  BookingKind,
  CalendarBookingEntry,
  CalendarPhaseEntry,
  CalendarResponse,
  RoomDaySpan,
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

  return {
    ...drag,
    proposedStartMs,
    proposedEndMs,
    overshootMs,
    ...annotateProposal(day, proposedStartMs, proposedEndMs),
  };
}
/** What a proposed span sits on: the first guideline buffer it overlaps and,
 *  for a provisional self, the confirmed booking it would land under. */
function annotateProposal(
  day: RibbonDay,
  startMs: number,
  endMs: number,
): Pick<RibbonDrag, "bufferHit" | "coveredInkTitle"> {
  const bufferHit =
    day.buffers.find((buffer) => overlapsHalfOpen(startMs, endMs, buffer.startMs, buffer.endMs)) ?? null;
  const coveredInk = day.ghosts.find(
    (ghost) => ghost.exclusion === "warning" && overlapsHalfOpen(startMs, endMs, ghost.occStartMs, ghost.occEndMs),
  );
  return { bufferHit, coveredInkTitle: coveredInk?.title ?? null };
}

export type TypedRibbonDrag =
  | { readonly ok: true; readonly drag: RibbonDrag }
  | { readonly ok: false; readonly blockedBy: string };

/** A typed window as a drag (goal 19 S6): exact, never snapped, and refused
 *  outright when it lands on a hard span. Typing is explicit, so a silent
 *  clamp would lie; the pointer's rubber band is for hands, not words. */
export function typedRibbonDrag(day: RibbonDay, self: RibbonSlot, startMs: number, endMs: number): TypedRibbonDrag {
  const block = day.ghosts.find(
    (ghost) => ghost.exclusion === "hard" && overlapsHalfOpen(startMs, endMs, ghost.occStartMs, ghost.occEndMs),
  );
  if (block !== undefined) return { ok: false, blockedBy: block.title };
  return {
    ok: true,
    drag: {
      ...beginRibbonDrag("move", self),
      proposedStartMs: startMs,
      proposedEndMs: endMs,
      ...annotateProposal(day, startMs, endMs),
    },
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

// --- the phase handles (goal 19 S6) -----------------------------------------
//
// The booking (the Diary slot) is the hire window: it begins with setup and
// ends when clear-down finishes. Nothing but the ribbon writes a time (goal
// 19 D1): the two outer handles move the booking itself; the inner boundaries
// are written as event PHASES the ribbon owns by template key.
//
//   setup       [setupStartMs, doorsMs)   no key: a phase named "Setup" (the
//                                         table pins template_key by CHECK)
//   doors       [doorsMs, liveMs)         key "arrival": the guests' arrival,
//                                         from doors opening to going live
//   live        no phase of its own: where arrival ends and the office's
//               detailed phases begin
//   clear-down  [clearDownMs, endMs)      key "breakdown", shown as Clear-down
//
// Source-agnostic: the shell adapts GET /events/:id/phase-graph or the client
// schedule into RibbonPhaseInput. Nothing here reads the clock or the DOM.

/** The template keys the ribbon owns. */
export type RibbonHandleKey = "setup" | "arrival" | "breakdown";

export interface RibbonPhaseInput {
  readonly id: string;
  readonly templateKey: string | null;
  readonly name: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

/** Invariant: setupStartMs <= doorsMs <= liveMs <= clearDownMs <= endMs, and
 *  liveMs + MIN_INGOT_DURATION_MS <= clearDownMs: the live stretch is never
 *  shorter than the smallest ingot. */
export interface RibbonHandles {
  readonly setupStartMs: number;
  readonly doorsMs: number;
  readonly liveMs: number;
  readonly clearDownMs: number;
  readonly endMs: number;
}

export type RibbonHandle = "setup-start" | "doors" | "live" | "clear-down" | "end";

export interface RibbonHandleDefaults {
  readonly setupMinutes: number;
  readonly arrivalMinutes: number;
  readonly clearDownMinutes: number;
}

export const RIBBON_HANDLE_DEFAULTS: RibbonHandleDefaults = {
  setupMinutes: 60,
  arrivalMinutes: 30,
  clearDownMinutes: 60,
};

export interface RibbonPhaseWrite {
  readonly op: "create" | "update" | "delete";
  readonly phaseId: string | null;
  readonly templateKey: RibbonHandleKey;
  readonly name: "Setup" | "Arrival" | "Clear-down";
  readonly startsAt: string;
  readonly durationMinutes: number;
}

interface MsSpan {
  readonly startMs: number;
  readonly endMs: number;
}

/** The order the handles sit in, and the order writes come out in. */
const RIBBON_HANDLE_KEYS: readonly RibbonHandleKey[] = ["setup", "arrival", "breakdown"];

const RIBBON_HANDLE_PHASE_LABELS: Readonly<Record<RibbonHandleKey, RibbonPhaseWrite["name"]>> = {
  setup: "Setup",
  arrival: "Arrival",
  breakdown: "Clear-down",
};

/** Names a key-less stored phase may carry and still be the ribbon's own
 *  (compared trimmed, case-insensitively). A phase update cannot set the
 *  template key, so a phase found this way stays found this way. */
const RIBBON_HANDLE_PHASE_NAMES: Readonly<Record<RibbonHandleKey, readonly string[]>> = {
  setup: ["setup"],
  arrival: ["arrival"],
  breakdown: ["breakdown", "clear-down"],
};

/** The stored phase the ribbon treats as its own for a key: matched by
 *  template key first, else, among key-less phases only, by name. A phase
 *  carrying another key is the office's and is never claimed. */
function findOwnedPhase(
  phases: readonly RibbonPhaseInput[],
  key: RibbonHandleKey,
): RibbonPhaseInput | null {
  const byKey = phases.find((phase) => phase.templateKey === key);
  if (byKey !== undefined) return byKey;
  const names = RIBBON_HANDLE_PHASE_NAMES[key];
  const byName = phases.find(
    (phase) => phase.templateKey === null && names.includes(phase.name.trim().toLowerCase()),
  );
  return byName ?? null;
}

/** A phase's span in ms, or null when its times cannot be read. */
function storedSpan(phase: RibbonPhaseInput | null): MsSpan | null {
  if (phase === null) return null;
  const startMs = Date.parse(phase.startsAt);
  const endMs = Date.parse(phase.endsAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
  return { startMs, endMs };
}

function clampNumber(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/** Fit the wanted boundaries into the slot. When the slot is too short for
 *  them all, shrink setup first, then clear-down, then arrival; the live
 *  stretch keeps the smallest ingot (or the whole slot when even that is
 *  shorter, which the Diary never produces). */
function fitHandles(
  startMs: number,
  endMs: number,
  wantedDoorsMs: number,
  wantedLiveMs: number,
  wantedClearDownMs: number,
): RibbonHandles {
  const available = Math.max(0, endMs - startMs);
  const liveMinimum = Math.min(MIN_INGOT_DURATION_MS, available);
  let setupLength = clampNumber(wantedDoorsMs - startMs, 0, available);
  let arrivalLength = clampNumber(wantedLiveMs - wantedDoorsMs, 0, available);
  let clearDownLength = clampNumber(endMs - wantedClearDownMs, 0, available);
  let excess = setupLength + arrivalLength + liveMinimum + clearDownLength - available;
  if (excess > 0) {
    const cut = Math.min(excess, setupLength);
    setupLength -= cut;
    excess -= cut;
  }
  if (excess > 0) {
    const cut = Math.min(excess, clearDownLength);
    clearDownLength -= cut;
    excess -= cut;
  }
  if (excess > 0) {
    arrivalLength -= Math.min(excess, arrivalLength);
  }
  const doorsMs = startMs + setupLength;
  return {
    setupStartMs: startMs,
    doorsMs,
    liveMs: doorsMs + arrivalLength,
    clearDownMs: endMs - clearDownLength,
    endMs,
  };
}

/** The handles for a booking from its stored phases, falling back to the
 *  defaults. Phases outside the slot are ignored: the Diary may have moved
 *  the booking while its phases stayed (see the honesty note above). */
export function deriveRibbonHandles(
  slot: { readonly startMs: number; readonly endMs: number },
  phases: readonly RibbonPhaseInput[],
  defaults: RibbonHandleDefaults = RIBBON_HANDLE_DEFAULTS,
): RibbonHandles {
  const { startMs, endMs } = slot;
  const insideSlot = (key: RibbonHandleKey): MsSpan | null => {
    const span = storedSpan(findOwnedPhase(phases, key));
    if (span === null || span.startMs < startMs || span.endMs > endMs) return null;
    return span;
  };
  const setup = insideSlot("setup");
  const arrival = insideSlot("arrival");
  const breakdown = insideSlot("breakdown");

  const doorsMs = arrival?.startMs ?? setup?.endMs ?? startMs + defaults.setupMinutes * MINUTE_MS;
  const liveMs = arrival?.endMs ?? doorsMs + defaults.arrivalMinutes * MINUTE_MS;
  const clearDownMs = breakdown?.startMs ?? endMs - defaults.clearDownMinutes * MINUTE_MS;
  return fitHandles(startMs, endMs, doorsMs, liveMs, clearDownMs);
}

/** Where a handle may sit without pushing its neighbours. */
function handleBounds(handles: RibbonHandles, handle: RibbonHandle): { readonly lo: number; readonly hi: number } {
  switch (handle) {
    case "setup-start":
      return { lo: Number.NEGATIVE_INFINITY, hi: handles.doorsMs };
    case "doors":
      return { lo: handles.setupStartMs, hi: handles.liveMs };
    case "live":
      return { lo: handles.doorsMs, hi: handles.clearDownMs - MIN_INGOT_DURATION_MS };
    case "clear-down":
      return { lo: handles.liveMs + MIN_INGOT_DURATION_MS, hi: handles.endMs };
    case "end":
      return { lo: handles.clearDownMs, hi: Number.POSITIVE_INFINITY };
  }
}

function withHandle(handles: RibbonHandles, handle: RibbonHandle, ms: number): RibbonHandles {
  switch (handle) {
    case "setup-start":
      return { ...handles, setupStartMs: ms };
    case "doors":
      return { ...handles, doorsMs: ms };
    case "live":
      return { ...handles, liveMs: ms };
    case "clear-down":
      return { ...handles, clearDownMs: ms };
    case "end":
      return { ...handles, endMs: ms };
  }
}

/** Snap a handle to the grid (quarter hours, or minutes when fine) and clamp
 *  it so the invariant holds without pushing any other handle: inner handles
 *  stop at their neighbours, the start at doors, the end at clear-down. Pure;
 *  always a new object; a non-finite proposal is no move. */
export function moveRibbonHandle(
  handles: RibbonHandles,
  handle: RibbonHandle,
  proposedMs: number,
  options: { readonly fine?: boolean } = {},
): RibbonHandles {
  if (!Number.isFinite(proposedMs)) return { ...handles };
  const { lo, hi } = handleBounds(handles, handle);
  // Nothing satisfies the invariant (a slot shorter than the smallest ingot):
  // leave the handles as they are rather than invent a position.
  if (lo > hi) return { ...handles };
  const step = options.fine === true ? RIBBON_FINE_SNAP_MINUTES : RIBBON_SNAP_MINUTES;
  return withHandle(handles, handle, clampNumber(snapMs(proposedMs, step), lo, hi));
}

function handleSpan(handles: RibbonHandles, key: RibbonHandleKey): MsSpan {
  switch (key) {
    case "setup":
      return { startMs: handles.setupStartMs, endMs: handles.doorsMs };
    case "arrival":
      return { startMs: handles.doorsMs, endMs: handles.liveMs };
    case "breakdown":
      return { startMs: handles.clearDownMs, endMs: handles.endMs };
  }
}

function spanMinutes(startMs: number, endMs: number): number {
  return Math.max(0, Math.round((endMs - startMs) / MINUTE_MS));
}

/** One write per owned key whose stored span differs from the handles, in
 *  the stable order setup, arrival, breakdown. A zero-length span deletes
 *  the stored phase (nothing when none exists); an unchanged phase earns no
 *  write, so applying these writes and deriving again is a fixed point. */
export function ribbonPhaseWrites(
  handles: RibbonHandles,
  phases: readonly RibbonPhaseInput[],
): readonly RibbonPhaseWrite[] {
  const writes: RibbonPhaseWrite[] = [];
  for (const templateKey of RIBBON_HANDLE_KEYS) {
    const { startMs, endMs } = handleSpan(handles, templateKey);
    const durationMinutes = spanMinutes(startMs, endMs);
    const existing = findOwnedPhase(phases, templateKey);
    const write = {
      phaseId: existing?.id ?? null,
      templateKey,
      name: RIBBON_HANDLE_PHASE_LABELS[templateKey],
      startsAt: new Date(startMs).toISOString(),
      durationMinutes,
    };
    if (durationMinutes === 0) {
      if (existing !== null) writes.push({ op: "delete", ...write });
      continue;
    }
    if (existing === null) {
      writes.push({ op: "create", ...write });
      continue;
    }
    const stored = storedSpan(existing);
    const unchanged =
      stored !== null &&
      stored.startMs === startMs &&
      spanMinutes(stored.startMs, stored.endMs) === durationMinutes;
    if (!unchanged) writes.push({ op: "update", ...write });
  }
  return writes;
}

/** The booking write (the Diary slot): non-null only when an outer handle
 *  moved. The shell sends it through the existing move/propose doors. */
export function ribbonSlotWrite(
  before: RibbonHandles,
  after: RibbonHandles,
): { readonly startMs: number; readonly endMs: number } | null {
  if (before.setupStartMs === after.setupStartMs && before.endMs === after.endMs) return null;
  return { startMs: after.setupStartMs, endMs: after.endMs };
}

// --- the client's day (goal 19 S6) ------------------------------------------
//
// The client's side never sees the venue calendar. Their ribbon is built from
// the room-day projection (GET /events/:id/room-day): their own slot by name,
// every other booking in the room as an anonymous span, "busy" (confirmed, or
// the house has the room) or "held" (another event's provisional time), and
// the venue's turnaround for this room and event type. A busy span is a wall
// for a proposal: the office could never confirm a time on top of it, so the
// ribbon does not let the client propose one. A held span is not a wall: the
// office decides between provisional times.

export interface ClientOwnSlot {
  readonly bookingId: string;
  readonly kind: BookingKind;
  readonly title: string;
  readonly startMs: number;
  readonly endMs: number;
}

export interface ClientRibbonDayInput {
  readonly spans: readonly RoomDaySpan[];
  readonly space: { readonly id: string; readonly name: string };
  readonly timeZone: string;
  readonly turnaroundMinutes: number;
  /** The client's own booking in this room, when the house holds one. */
  readonly own: ClientOwnSlot | null;
  /** Where the bar rests before any proposal: the event's planned window. */
  readonly draft: { readonly startMs: number; readonly endMs: number; readonly title: string } | null;
}

/** The id the ribbon gives a window that is not yet proposed. */
export const CLIENT_DRAFT_SLOT_ID = "draft";

function slotOf(id: string, title: string, kind: BookingKind, startMs: number, endMs: number): RibbonSlot {
  return { id, title, kind, eventType: null, startMs, endMs, occStartMs: startMs, occEndMs: endMs };
}

/** The room-day spans + the client's own slot (or the draft) → the ribbon's
 *  world, or null when there is nothing to place yet. */
export function buildClientRibbonDay(input: ClientRibbonDayInput): RibbonDay | null {
  const own = input.own;
  const self = own !== null
    ? slotOf(own.bookingId, own.title, own.kind, own.startMs, own.endMs)
    : input.draft !== null
      ? slotOf(CLIENT_DRAFT_SLOT_ID, input.draft.title, "hold", input.draft.startMs, input.draft.endMs)
      : null;
  if (self === null) return null;
  const range = boardRange(self.startMs, "day", input.timeZone);
  const ghosts: RibbonGhost[] = [];
  input.spans.forEach((span, index) => {
    const startMs = Date.parse(span.startsAt);
    const endMs = Date.parse(span.endsAt);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return;
    if (!overlapsHalfOpen(startMs, endMs, range.fromMs, range.toMs)) return;
    if (span.kind === "yours") {
      if (own !== null && span.bookingId === own.bookingId) return;
      ghosts.push({ ...slotOf(span.bookingId, span.title, "hold", startMs, endMs), exclusion: "none" });
      return;
    }
    ghosts.push(
      span.kind === "busy"
        ? { ...slotOf(`busy:${String(index)}`, RIBBON_COPY.busySpan, "ink", startMs, endMs), exclusion: "hard" }
        : { ...slotOf(`held:${String(index)}`, RIBBON_COPY.heldSpan, "hold", startMs, endMs), exclusion: "none" },
    );
  });
  ghosts.sort((a, b) => a.occStartMs - b.occStartMs || (a.id < b.id ? -1 : 1));
  const minutes = input.turnaroundMinutes;
  const buffers: RibbonBuffer[] = [];
  if (minutes > 0) {
    for (const ghost of ghosts) {
      if (ghost.exclusion !== "hard") continue;
      buffers.push(
        { ghostId: ghost.id, side: "before", startMs: ghost.occStartMs - minutes * MINUTE_MS, endMs: ghost.occStartMs, minutes, ruleName: RIBBON_COPY.venueRuleName },
        { ghostId: ghost.id, side: "after", startMs: ghost.occEndMs, endMs: ghost.occEndMs + minutes * MINUTE_MS, minutes, ruleName: RIBBON_COPY.venueRuleName },
      );
    }
  }
  return { range, spaceId: input.space.id, self, ghosts, buffers, guidelinesAvailable: minutes > 0 };
}
