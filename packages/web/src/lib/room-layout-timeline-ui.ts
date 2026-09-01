import type { CanonicalLayoutSnapshotV0, EventPhaseGraph } from "@omnitwin/types";
import {
  boardRange,
  dayColumns,
  hourTicks,
  msToWallInput,
  wallInputToMs,
  VENUE_TIME_ZONE,
  type BoardRange,
} from "../pages/diary/lib/board-time.js";

export interface LayoutTimelineMetrics {
  readonly guests: number;
  readonly objects: number;
  readonly tables: number;
  readonly seats: number;
  readonly stages: number;
  /**
   * The canonical snapshot does not have a bar category. A bar count is only
   * reported when the immutable object metadata carries the canonical
   * `catalogueSlug: "bar-counter"` witness; otherwise it remains unknown.
   */
  readonly bars: number | null;
}

export interface LayoutTimelineTick {
  readonly atMs: number;
  readonly label: string;
  readonly positionPercent: number;
}

export interface AvailableFrameSegment {
  readonly fromIndex: number;
  readonly toIndex: number;
  readonly progress: number;
}

export interface TimelinePhaseBlock {
  readonly frameIndex: number;
  readonly leftPercent: number;
  readonly widthPercent: number;
  readonly lane: number;
  readonly laneCount: number;
  readonly clippedStart: boolean;
  readonly clippedEnd: boolean;
}

export interface TimelineScopedRequestRange {
  readonly from: string;
  readonly to: string;
}

const DAY_DISPLAY_LEAD_MS = 60 * 60 * 1_000;
const DAY_DISPLAY_TAIL_MS = 0;
const DAY_DISPLAY_MINIMUM_MS = 8 * 60 * 60 * 1_000;
const OPERATIONAL_DAY_START_HOUR = 4;
const OPERATIONAL_DAY_NAVIGATION_OFFSET_MS = 6 * 60 * 60 * 1_000;

/** DST-safe venue event day: 04:00 on the owned date through next 04:00. */
export function operationalDayRange(
  anchorMs: number,
  timeZone: string = VENUE_TIME_ZONE,
): BoardRange {
  const wallInput = msToWallInput(anchorMs, timeZone);
  const wallHour = Number(wallInput.slice(11, 13));
  // Any 00:00–03:59 instant is owned by the preceding event day. Six elapsed
  // hours always crosses that civil boundary, including both DST transitions.
  const ownedDateAnchor = wallHour < OPERATIONAL_DAY_START_HOUR
    ? anchorMs - 6 * 60 * 60 * 1_000
    : anchorMs;
  const civilDay = boardRange(ownedDateAnchor, "day", timeZone);
  const fromDate = msToWallInput(civilDay.fromMs, timeZone).slice(0, 10);
  const toDate = msToWallInput(civilDay.toMs, timeZone).slice(0, 10);
  const fromMs = wallInputToMs(`${fromDate}T04:00`, timeZone);
  const toMs = wallInputToMs(`${toDate}T04:00`, timeZone);
  if (fromMs === null || toMs === null) return civilDay;
  return { view: "day", fromMs, toMs };
}

/** Moves between venue event days without assuming that each day is 24 hours. */
export function shiftOperationalDayRange(
  range: BoardRange,
  direction: -1 | 1,
  timeZone: string = VENUE_TIME_ZONE,
): BoardRange {
  const safeAnchor = direction === 1
    ? range.toMs + OPERATIONAL_DAY_NAVIGATION_OFFSET_MS
    : range.fromMs - OPERATIONAL_DAY_NAVIGATION_OFFSET_MS;
  return operationalDayRange(safeAnchor, timeZone);
}

/** Venue-local calendar date used by the scoped timeline API. */
export function timelineAnchorDateAt(
  atMs: number,
  timeZone: string,
): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(atMs));
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

/**
 * Day timelines own the quiet hours after midnight (00:00–03:59) as part of
 * the previous 04:00 operational day. Week timelines remain civil/Monday.
 */
export function timelineScopeAnchorDateAt(
  atMs: number,
  scope: "day" | "week",
  timeZone: string,
): string {
  if (scope === "week") return timelineAnchorDateAt(atMs, timeZone);
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(new Date(atMs)));
  const ownedInstant = hour < OPERATIONAL_DAY_START_HOUR
    ? atMs - OPERATIONAL_DAY_NAVIGATION_OFFSET_MS
    : atMs;
  return timelineAnchorDateAt(ownedInstant, timeZone);
}

/** Calendar-only range navigation; it cannot drift across a DST boundary. */
export function shiftTimelineAnchorDate(
  anchorDate: string,
  scope: "day" | "week",
  direction: -1 | 1,
): string {
  const date = new Date(`${anchorDate}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return anchorDate;
  date.setUTCDate(date.getUTCDate() + direction * (scope === "day" ? 1 : 7));
  return date.toISOString().slice(0, 10);
}

/**
 * Mirrors the API's PostgreSQL wall-clock range contract so a scoped response
 * is accepted only when both redundant bounds match the requested day/week.
 */
export function timelineScopedRequestRange(
  scope: "day" | "week",
  anchorDate: string,
  timeZone: string,
): TimelineScopedRequestRange | null {
  const anchor = new Date(`${anchorDate}T12:00:00.000Z`);
  if (Number.isNaN(anchor.getTime())) return null;
  if (scope === "week") {
    const day = anchor.getUTCDay();
    anchor.setUTCDate(anchor.getUTCDate() - (day === 0 ? 6 : day - 1));
  }
  const fromDate = anchor.toISOString().slice(0, 10);
  const toDate = shiftTimelineAnchorDate(fromDate, scope, 1);
  const wallTime = scope === "day" ? "04:00" : "00:00";
  try {
    const fromMs = wallInputToMs(`${fromDate}T${wallTime}`, timeZone);
    const toMs = wallInputToMs(`${toDate}T${wallTime}`, timeZone);
    if (fromMs === null || toMs === null) return null;
    return {
      from: new Date(fromMs).toISOString(),
      to: new Date(toMs).toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * The API reads the complete venue-local day. Its visual lens is deliberately
 * tighter: event envelope + operational breathing room, with an eight-hour
 * minimum so short events still have a useful scrub axis. The lens is not
 * clamped to midnight, allowing an event day to finish after 00:00.
 */
export function timelineDisplayRange<Frame extends {
  readonly startsAt: string;
  readonly endsAt: string;
}>(
  queryRange: BoardRange,
  frames: readonly Frame[],
  scope: "day" | "week",
): BoardRange {
  if (scope === "week" || frames.length === 0) return queryRange;
  const starts = frames.map((frame) => Date.parse(frame.startsAt)).filter(Number.isFinite);
  const ends = frames.map((frame) => Date.parse(frame.endsAt)).filter(Number.isFinite);
  if (starts.length === 0 || ends.length === 0) return queryRange;
  const fromMs = Math.min(...starts) - DAY_DISPLAY_LEAD_MS;
  let toMs = Math.max(...ends) + DAY_DISPLAY_TAIL_MS;
  const span = toMs - fromMs;
  if (span < DAY_DISPLAY_MINIMUM_MS) {
    toMs += DAY_DISPLAY_MINIMUM_MS - span;
  }
  return { view: queryRange.view, fromMs, toMs };
}

export function layoutMetricsFromSnapshot(
  snapshot: CanonicalLayoutSnapshotV0,
): LayoutTimelineMetrics {
  const objects = snapshot.objects;
  const chairs = objects.filter((object) => object.assetDefinition.category === "chair");
  const seatingBasis = chairs.length > 0
    ? chairs
    : objects.filter((object) => object.assetDefinition.category === "table");
  const barsWithWitness = objects.filter(
    (object) => object.metadata?.["catalogueSlug"] === "bar-counter",
  );

  return {
    guests: snapshot.guestCount,
    objects: objects.length,
    tables: objects.filter((object) => object.assetDefinition.category === "table").length,
    seats: seatingBasis.reduce(
      (total, object) => total + (object.assetDefinition.seatCount ?? 0),
      0,
    ),
    stages: objects.filter((object) => object.assetDefinition.category === "stage").length,
    bars: barsWithWitness.length > 0 ? barsWithWitness.length : null,
  };
}

export function timePositionPercent(
  atMs: number,
  fromMs: number,
  toMs: number,
): number {
  if (toMs <= fromMs) return 0;
  return Math.min(100, Math.max(0, ((atMs - fromMs) / (toMs - fromMs)) * 100));
}

function tickLabel(atMs: number, scope: "day" | "week", timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", scope === "day"
    ? { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }
    : { timeZone, weekday: "short" }).format(new Date(atMs));
}

/**
 * Produces a lightweight ruler from the diary's DST-safe hour ticks and local
 * day columns. A 23/25-hour day therefore keeps its honest visual width.
 */
export function layoutTimelineTicks(
  range: BoardRange,
  scope: "day" | "week",
  timeZone: string = VENUE_TIME_ZONE,
): readonly LayoutTimelineTick[] {
  if (range.toMs <= range.fromMs) return [];
  const candidates = scope === "day"
    ? hourTicks(range, timeZone).filter((_tick, index) => index % 4 === 0).map((tick) => tick.ms)
    : dayColumns(range, timeZone).map((column) => column.startMs);
  const instants = [...candidates, range.toMs];
  return instants.map((atMs) => {
    return {
      atMs,
      label: tickLabel(atMs, scope, timeZone),
      positionPercent: timePositionPercent(atMs, range.fromMs, range.toMs),
    };
  });
}

export function availableFrameIndices<Frame extends {
  readonly keyframe: { readonly state: string; readonly snapshotStatus?: string | null };
}>(
  frames: readonly Frame[],
): readonly number[] {
  return frames.flatMap((frame, index) =>
    frame.keyframe.state === "available" && frame.keyframe.snapshotStatus === "frozen"
      ? [index]
      : [],
  );
}

export function adjacentAvailableFrameIndex(
  availableIndices: readonly number[],
  activeIndex: number,
  direction: -1 | 1,
): number | null {
  if (direction === 1) {
    return availableIndices.find((index) => index > activeIndex) ?? null;
  }
  return [...availableIndices].reverse().find((index) => index < activeIndex) ?? null;
}

/**
 * Resolves a raw filmstrip cursor against trustworthy keyframes. Missing,
 * invalid, and room-flip cards stay in the index space but become an honest
 * transition interval between the available layouts on either side.
 */
export function availableFrameSegment(
  availableIndices: readonly number[],
  cursor: number,
): AvailableFrameSegment | null {
  const first = availableIndices[0];
  const last = availableIndices.at(-1);
  if (first === undefined || last === undefined) return null;
  const safeCursor = Number.isFinite(cursor) ? cursor : first;
  if (safeCursor <= first) return { fromIndex: first, toIndex: first, progress: 0 };
  if (safeCursor >= last) return { fromIndex: last, toIndex: last, progress: 0 };

  const toIndex = availableIndices.find((index) => index >= safeCursor);
  if (toIndex === undefined) return { fromIndex: last, toIndex: last, progress: 0 };
  const fromIndex = [...availableIndices].reverse().find((index) => index <= safeCursor);
  if (fromIndex === undefined || fromIndex === toIndex) {
    return { fromIndex: toIndex, toIndex, progress: 0 };
  }
  return {
    fromIndex,
    toIndex,
    progress: (safeCursor - fromIndex) / (toIndex - fromIndex),
  };
}

/**
 * Spatial interpolation is truthful only between adjacent saved layouts, or
 * when every frame between them is an explicit canonical room-flip gap.
 * Missing/invalid phases and skipped saved phases require a static replace.
 */
export function timelineFramesAllowSpatialMorph<Frame extends {
  readonly kind?: string;
  readonly keyframe?: { readonly state: string; readonly reason?: string };
}>(
  frames: readonly Frame[],
  fromIndex: number,
  toIndex: number,
): boolean {
  if (fromIndex === toIndex) return true;
  const first = Math.min(fromIndex, toIndex);
  const last = Math.max(fromIndex, toIndex);
  return frames.slice(first + 1, last).every((frame) =>
    frame.kind === "room_flip"
      && frame.keyframe?.state === "missing"
      && frame.keyframe.reason === "room_flip_gap",
  );
}

/**
 * Resolves overlapping schedule ownership consistently. The phase with the
 * latest start wins; equal starts preserve the API's stable order.
 */
export function activeTimelineFrameIndexAtTime<Frame extends {
  readonly startsAt: string;
  readonly endsAt?: string;
}>(frames: readonly Frame[], atMs: number): number | null {
  if (!Number.isFinite(atMs)) return null;
  let selectedIndex: number | null = null;
  let selectedStart = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    if (frame === undefined) continue;
    const startsAt = Date.parse(frame.startsAt);
    const endsAt = Date.parse(frame.endsAt ?? frame.startsAt);
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) continue;
    if (atMs < startsAt || atMs >= endsAt || startsAt <= selectedStart) continue;
    selectedIndex = index;
    selectedStart = startsAt;
  }
  return selectedIndex;
}

/**
 * Maps a wall-clock position to a trustworthy keyframe cursor. Available
 * phases hold their exact saved arrangement for their full duration. Motion
 * is confined to explicit room flips and genuine schedule gaps; invalid or
 * unsnapshotted phases are never bridged over.
 */
export function availableFrameCursorAtTime<Frame extends {
  readonly startsAt: string;
  readonly endsAt?: string;
  readonly kind?: string;
  readonly keyframe?: { readonly state: string; readonly reason?: string };
}>(
  frames: readonly Frame[],
  availableIndices: readonly number[],
  atMs: number,
): number | null {
  const firstIndex = availableIndices[0];
  const lastIndex = availableIndices.at(-1);
  if (firstIndex === undefined || lastIndex === undefined) return null;
  const firstFrame = frames[firstIndex];
  const lastFrame = frames[lastIndex];
  if (firstFrame === undefined || lastFrame === undefined) return null;
  const activeIndex = activeTimelineFrameIndexAtTime(frames, atMs);
  if (activeIndex !== null) {
    if (availableIndices.includes(activeIndex)) return activeIndex;
    const active = frames[activeIndex];
    if (active === undefined) return null;
    const roomFlip = active.kind === "room_flip"
      && active.keyframe?.state === "missing"
      && active.keyframe.reason === "room_flip_gap";
    if (!roomFlip) return null;
    const fromIndex = [...availableIndices].reverse().find((index) => index < activeIndex);
    const toIndex = availableIndices.find((index) => index > activeIndex);
    if (fromIndex === undefined || toIndex === undefined) return null;
    // A real invalid/missing phase anywhere between the endpoints blocks
    // wall-clock interpolation even while the active slice is a room flip.
    // Deliberate endpoint clicks may still use the store's static replace.
    if (!timelineFramesAllowSpatialMorph(frames, fromIndex, toIndex)) return null;
    const start = Date.parse(active.startsAt);
    const end = Date.parse(active.endsAt ?? active.startsAt);
    const progress = end <= start ? 0 : Math.min(1, Math.max(0, (atMs - start) / (end - start)));
    return fromIndex + (toIndex - fromIndex) * progress;
  }

  const firstMs = Date.parse(firstFrame.startsAt);
  const lastMs = Date.parse(lastFrame.endsAt ?? lastFrame.startsAt);
  if (!Number.isFinite(atMs) || atMs <= firstMs) return firstIndex;
  if (atMs >= lastMs) return lastIndex;

  const previousIndex = [...availableIndices].reverse().find((index) => {
    const frame = frames[index];
    return frame !== undefined && Date.parse(frame.endsAt ?? frame.startsAt) <= atMs;
  });
  const nextIndex = availableIndices.find((index) => {
    const frame = frames[index];
    return frame !== undefined && Date.parse(frame.startsAt) > atMs;
  });
  if (previousIndex === undefined) return firstIndex;
  if (nextIndex === undefined) return lastIndex;
  const blockers = frames.slice(previousIndex + 1, nextIndex).filter((frame) =>
    frame.kind !== "room_flip"
      || frame.keyframe?.state !== "missing"
      || frame.keyframe.reason !== "room_flip_gap",
  );
  if (blockers.length > 0) return null;
  const previous = frames[previousIndex];
  const next = frames[nextIndex];
  if (previous === undefined || next === undefined) return null;
  const gapStart = Date.parse(previous.endsAt ?? previous.startsAt);
  const gapEnd = Date.parse(next.startsAt);
  const progress = gapEnd <= gapStart ? 1 : Math.min(1, Math.max(0, (atMs - gapStart) / (gapEnd - gapStart)));
  return previousIndex + (nextIndex - previousIndex) * progress;
}

/**
 * The linked event may contain phases for several rooms. Only this planner's
 * selected-space phases can anchor its timeline; event start is the fallback.
 * Foreign venues and internally inconsistent graphs fail closed.
 */
export function linkedEventTimelineAnchorMs(
  graph: EventPhaseGraph | null,
  venueId: string | null,
  spaceId: string | null,
): number | null {
  if (
    graph === null
    || venueId === null
    || graph.event.venueId !== venueId
    || graph.phases.some((phase) => phase.eventId !== graph.event.id)
  ) return null;
  const phaseStarts = graph.phases
    .filter((phase) => spaceId !== null && phase.spaceId === spaceId)
    .flatMap((phase) => phase.startsAt === null ? [] : [Date.parse(phase.startsAt)])
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  const firstPhase = phaseStarts[0];
  if (firstPhase !== undefined) return firstPhase;
  if (graph.event.startsAt === null) return null;
  const eventStart = Date.parse(graph.event.startsAt);
  return Number.isFinite(eventStart) ? eventStart : null;
}

/** Places scheduled phases on the real wall-clock axis and assigns overlap lanes. */
export function timelinePhaseBlocks<Frame extends {
  readonly startsAt: string;
  readonly endsAt: string;
}>(
  frames: readonly Frame[],
  fromMs: number,
  toMs: number,
): readonly TimelinePhaseBlock[] {
  if (toMs <= fromMs) return [];
  const candidates = frames.flatMap((frame, frameIndex) => {
    const startsAtMs = Date.parse(frame.startsAt);
    const endsAtMs = Date.parse(frame.endsAt);
    if (!Number.isFinite(startsAtMs) || !Number.isFinite(endsAtMs) || endsAtMs <= startsAtMs) return [];
    const visibleStart = Math.max(fromMs, startsAtMs);
    const visibleEnd = Math.min(toMs, endsAtMs);
    if (visibleEnd <= visibleStart) return [];
    return [{ frameIndex, startsAtMs, endsAtMs, visibleStart, visibleEnd }];
  }).sort((left, right) => left.visibleStart - right.visibleStart || left.visibleEnd - right.visibleEnd);

  const laneEnds: number[] = [];
  const placed = candidates.map((candidate) => {
    let lane = laneEnds.findIndex((endMs) => endMs <= candidate.visibleStart);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = candidate.visibleEnd;
    return { candidate, lane };
  });
  const laneCount = Math.max(1, laneEnds.length);
  return placed.map(({ candidate, lane }) => ({
    frameIndex: candidate.frameIndex,
    leftPercent: timePositionPercent(candidate.visibleStart, fromMs, toMs),
    widthPercent: ((candidate.visibleEnd - candidate.visibleStart) / (toMs - fromMs)) * 100,
    lane,
    laneCount,
    clippedStart: candidate.startsAtMs < fromMs,
    clippedEnd: candidate.endsAtMs > toMs,
  }));
}

/** Maps playback elapsed time onto the real time span between keyframes. */
export function wallClockPlaybackCursor<Frame extends { readonly startsAt: string }>(
  frames: readonly Frame[],
  availableIndices: readonly number[],
  elapsedMs: number,
  durationMs: number,
  displayRange?: { readonly fromMs: number; readonly toMs: number },
): { readonly cursor: number; readonly atMs: number } | null {
  const firstIndex = availableIndices[0];
  const lastIndex = availableIndices.at(-1);
  if (firstIndex === undefined || lastIndex === undefined) return null;
  const firstFrame = frames[firstIndex];
  const lastFrame = frames[lastIndex];
  if (firstFrame === undefined || lastFrame === undefined) return null;
  const firstMs = Date.parse(firstFrame.startsAt);
  const lastMs = Date.parse(lastFrame.startsAt);
  if (!Number.isFinite(firstMs) || !Number.isFinite(lastMs)) return null;
  const progress = durationMs <= 0
    ? 1
    : Math.min(1, Math.max(0, elapsedMs / durationMs));
  const playbackFromMs = displayRange?.fromMs ?? firstMs;
  const playbackToMs = displayRange?.toMs ?? lastMs;
  const atMs = playbackFromMs + (playbackToMs - playbackFromMs) * progress;
  const cursor = availableFrameCursorAtTime(frames, availableIndices, atMs);
  return cursor === null ? null : { cursor, atMs };
}
