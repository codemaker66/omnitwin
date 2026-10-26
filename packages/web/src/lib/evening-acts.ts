import { HOUR_MS, MINUTE_MS } from "./evening-window.js";

// ---------------------------------------------------------------------------
// The event's acts on the evening's line (T-674, v2 slice 10; spec 6.2, 9).
//
// An act is a phase of the event with a time: its own start, or the end of
// the act before it (or the event's start for the first) when the running
// order gives only durations. Acts run in their order; one that begins
// before the last has ended cuts it short on the line. Every act is labelled
// at its start, its name with its start time under it, so no time sits under
// another act's name; two labels that would come within 12 px never share a
// row: the shorter act takes the second row, and the act under the playhead
// never moves. Released within 6 minutes of a stop, the hour glides there.
// ---------------------------------------------------------------------------

/** A phase as the event graph (staff) or the shared schedule (a client) carries it. */
export interface PhaseTiming {
  readonly id: string;
  readonly name: string;
  readonly startsAt: string | null;
  readonly durationMinutes: number;
  readonly sortOrder?: number;
}

export interface TimedAct {
  readonly id: string;
  readonly name: string;
  readonly start: number;
  readonly end: number;
}

/** The acts with times, in the order they begin. Phases with no time to stand on are left off. */
export function timedActs(phases: readonly PhaseTiming[], eventStart: number | null): TimedAct[] {
  const ordered = phases
    .map((phase, index) => ({ phase, index }))
    .sort((a, b) => (a.phase.sortOrder ?? a.index) - (b.phase.sortOrder ?? b.index) || a.index - b.index);
  const acts: TimedAct[] = [];
  let cursor = eventStart !== null && Number.isFinite(eventStart) ? eventStart : null;
  for (const { phase } of ordered) {
    const own = phase.startsAt === null ? Number.NaN : Date.parse(phase.startsAt);
    const start = Number.isFinite(own) ? own : cursor;
    if (start === null) continue;
    const end = start + Math.max(0, phase.durationMinutes) * MINUTE_MS;
    acts.push({ id: phase.id, name: phase.name, start, end });
    cursor = end;
  }
  return acts
    .map((act, index) => ({ act, index }))
    .sort((a, b) => a.act.start - b.act.start || a.index - b.index)
    .map(({ act }) => act);
}

/** Where the hour stands in the running order. */
export type ActPlace =
  | { readonly kind: "in"; readonly act: TimedAct; readonly index: number }
  | { readonly kind: "before"; readonly act: TimedAct; readonly index: number }
  | { readonly kind: "after"; readonly act: TimedAct; readonly index: number }
  | { readonly kind: "none" };

/** The act the hour is in (the later of two that overlap), or the one it waits for, or the last it follows. */
export function actAt(acts: readonly TimedAct[], at: number): ActPlace {
  let inside = -1;
  acts.forEach((act, index) => {
    if (at >= act.start && at < act.end) inside = index;
  });
  const current = acts[inside];
  if (current !== undefined) return { kind: "in", act: current, index: inside };
  const nextIndex = acts.findIndex((act) => act.start > at);
  const next = acts[nextIndex];
  if (next !== undefined) return { kind: "before", act: next, index: nextIndex };
  const last = acts[acts.length - 1];
  return last === undefined ? { kind: "none" } : { kind: "after", act: last, index: acts.length - 1 };
}

/** The head's words for where the hour stands: "Ceilidh", "Before Arrival", "After Carriages". */
export function actWords(place: ActPlace): string | null {
  switch (place.kind) {
    case "in": return place.act.name;
    case "before": return `Before ${place.act.name}`;
    case "after": return `After ${place.act.name}`;
    case "none": return null;
  }
}

export type SegmentTone = "past" | "current" | "ahead";

export interface ActSegment {
  readonly act: TimedAct;
  readonly index: number;
  /** Where its bar runs: from its start to its end, cut short by the next act. */
  readonly from: number;
  readonly to: number;
  readonly tone: SegmentTone;
}

/** Each act's bar on the line and its tone at the hour: past copper, the current act full copper, the rest cream. */
export function actSegments(acts: readonly TimedAct[], at: number): ActSegment[] {
  const place = actAt(acts, at);
  const current = place.kind === "in" ? place.index : -1;
  return acts.map((act, index) => {
    const next = acts[index + 1];
    const to = next !== undefined && next.start < act.end ? Math.max(act.start, next.start) : act.end;
    const tone: SegmentTone = index === current ? "current" : to <= at ? "past" : "ahead";
    return { act, index, from: act.start, to, tone };
  });
}

/** A label's place and size on the line, px. */
export interface LabelBox {
  readonly left: number;
  readonly width: number;
  /** The act's length, to choose which of two crowded labels moves. */
  readonly span: number;
  /** The act under the playhead: it never moves. */
  readonly current: boolean;
}

/** The least gap between two labels in one row (spec 6.2). */
export const LABEL_GAP_PX = 12;

/**
 * The row each label takes (0 first, 1 second): two labels within 12 px
 * never share a row; the shorter act moves (on a tie the earlier), and the
 * current act never moves.
 */
export function labelRows(boxes: readonly LabelBox[], gap: number = LABEL_GAP_PX): (0 | 1)[] {
  const rows: (0 | 1)[] = boxes.map(() => 0);
  let previous = -1;
  boxes.forEach((box, index) => {
    const before = previous >= 0 ? boxes[previous] : undefined;
    if (before === undefined || box.left >= before.left + before.width + gap) {
      previous = index;
      return;
    }
    const movePrevious = box.current || (!before.current && before.span <= box.span);
    if (movePrevious) {
      rows[previous] = 1;
      previous = index;
    } else {
      rows[index] = 1;
    }
  });
  return rows;
}

/** The next stop after the hour (direction 1) or the one before it (−1); a stop within 30 s counts as where the hour is. */
export function stepStop(stops: readonly number[], at: number, direction: 1 | -1): number | null {
  const sorted = [...stops].sort((a, b) => a - b);
  const slack = 30_000;
  if (direction > 0) return sorted.find((stop) => stop > at + slack) ?? null;
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const stop = sorted[index];
    if (stop !== undefined && stop < at - slack) return stop;
  }
  return null;
}

/** How near a released hour must be to a stop to glide to it. */
export const GLIDE_WITHIN_MS = 6 * MINUTE_MS;

/** The stop nearest the hour within reach, or null. */
export function nearStop(stops: readonly number[], at: number, within: number = GLIDE_WITHIN_MS): number | null {
  let best: number | null = null;
  for (const stop of stops) {
    const distance = Math.abs(stop - at);
    if (distance <= within && (best === null || distance < Math.abs(best - at))) best = stop;
  }
  return best;
}

export type Crossing =
  | { readonly kind: "hour"; readonly at: number }
  | { readonly kind: "act"; readonly at: number; readonly act: TimedAct }
  | { readonly kind: "sunrise"; readonly at: number }
  | { readonly kind: "sunset"; readonly at: number };

function crossed(from: number, to: number, mark: number): boolean {
  return to >= from ? mark > from && mark <= to : mark < from && mark >= to;
}

/**
 * What a dragged hour passed going from `from` to `to`, in the order it
 * passed them: whole hours, act starts, sunrise and sunset (the sounds' cues).
 */
export function crossings(from: number, to: number, marks: {
  readonly acts: readonly TimedAct[];
  readonly sunrise: number | null;
  readonly sunset: number | null;
}): Crossing[] {
  if (from === to) return [];
  const out: Crossing[] = [];
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  for (let hour = Math.ceil(low / HOUR_MS) * HOUR_MS; hour <= high; hour += HOUR_MS) {
    if (crossed(from, to, hour)) out.push({ kind: "hour", at: hour });
  }
  for (const act of marks.acts) {
    if (crossed(from, to, act.start)) out.push({ kind: "act", at: act.start, act });
  }
  if (marks.sunrise !== null && crossed(from, to, marks.sunrise)) out.push({ kind: "sunrise", at: marks.sunrise });
  if (marks.sunset !== null && crossed(from, to, marks.sunset)) out.push({ kind: "sunset", at: marks.sunset });
  return out.sort((a, b) => (to >= from ? a.at - b.at : b.at - a.at));
}
