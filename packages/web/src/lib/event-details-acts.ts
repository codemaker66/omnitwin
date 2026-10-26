import { addMinutes, glasgowClock } from "./event-details-times.js";

// ---------------------------------------------------------------------------
// The running order in Event details (T-674 slice 19; spec 6.13, 6.2).
//
// The acts are the event's phases: a name, a start and a duration. The
// evening draws the same phases on its line, so what is typed here is what
// it shows. The list is kept in time order (acts with no start last, in the
// event's own order), and when one act runs into the next the panel says so
// in a plain sentence rather than refusing the time: the hall's own run of
// show sometimes overlaps on purpose, and only a person knows which.
// ---------------------------------------------------------------------------

export interface ActFacts {
  readonly id: string;
  readonly name: string;
  readonly startsAt: string | null;
  readonly durationMinutes: number;
  /** The event's own order, for acts with no start. */
  readonly sortOrder: number;
}

export interface OrderedAct extends ActFacts {
  readonly endsAt: string | null;
}

export interface ActOverlap {
  readonly earlierId: string;
  readonly laterId: string;
  readonly line: string;
}

function startMs(act: ActFacts): number | null {
  if (act.startsAt === null) return null;
  const ms = Date.parse(act.startsAt);
  return Number.isNaN(ms) ? null : ms;
}

/** The acts in time order; those with no start keep the event's order, after the timed ones. */
export function runningOrder(acts: readonly ActFacts[]): readonly OrderedAct[] {
  return [...acts]
    .sort((a, b) => {
      const at = startMs(a);
      const bt = startMs(b);
      if (at !== null && bt !== null && at !== bt) return at - bt;
      if (at === null && bt !== null) return 1;
      if (at !== null && bt === null) return -1;
      return a.sortOrder - b.sortOrder;
    })
    .map((act) => ({ ...act, endsAt: startMs(act) === null || act.startsAt === null ? null : addMinutes(act.startsAt, act.durationMinutes) }));
}

/**
 * Each act that runs past the start of the next, said in Glasgow time:
 * "Dinner runs to 21:30, past the start of Ceilidh at 21:00."
 */
export function actOverlaps(ordered: readonly OrderedAct[]): readonly ActOverlap[] {
  const timed = ordered.filter((act) => act.startsAt !== null && act.endsAt !== null);
  const out: ActOverlap[] = [];
  for (let index = 0; index < timed.length - 1; index += 1) {
    const earlier = timed[index];
    const later = timed[index + 1];
    if (earlier === undefined || later === undefined || earlier.endsAt === null || later.startsAt === null) continue;
    if (Date.parse(earlier.endsAt) <= Date.parse(later.startsAt)) continue;
    out.push({
      earlierId: earlier.id,
      laterId: later.id,
      line: `${earlier.name} runs to ${glasgowClock(earlier.endsAt) ?? ""}, past the start of ${later.name} at ${glasgowClock(later.startsAt) ?? ""}.`,
    });
  }
  return out;
}

/** What a typed act name can be: the event's own rule, 1 to 100 characters once trimmed. */
export function actNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Name the act to save it";
  if (trimmed.length > 100) return "Up to 100 characters";
  return null;
}

/** What a typed duration can be: whole minutes, none to a day. */
export function durationProblem(minutes: number): string | null {
  if (!Number.isInteger(minutes) || minutes < 0) return "Type whole minutes";
  if (minutes > 24 * 60) return "Up to 24 hours";
  return null;
}
