import { countLabel, countNoun } from "../count-label.js";
import type { RoomFacts } from "./room-seals.js";

// ---------------------------------------------------------------------------
// The journey: four steps across the top of the planner, and the one primary
// key at the right of the shelf, which always names the next best move
// (13 Nov 2026).
//
// The steps are places, not a wizard: any of them opens at any time. What the
// journey adds is a "you are here" and a single suggestion, so nobody has to
// decide what to do next from a blank screen. The move is worked out from the
// room as it stands, most useful first.
// ---------------------------------------------------------------------------

export type JourneyStepId = "event" | "layout" | "finishing" | "send";

export type JourneyStepState = "done" | "current" | "ahead";

export interface JourneyStep {
  readonly id: JourneyStepId;
  readonly label: string;
  readonly state: JourneyStepState;
}

export const JOURNEY_LABELS: Readonly<Record<JourneyStepId, string>> = {
  event: "Your event",
  layout: "Lay out",
  finishing: "Finishing touches",
  send: "Send",
};

const ORDER: readonly JourneyStepId[] = ["event", "layout", "finishing", "send"];

export interface JourneyProgress {
  /** The guest count is known. */
  readonly eventKnown: boolean;
  /** Every guest has a seat (or, with no count yet, nothing can be judged). */
  readonly seated: boolean;
  /** Every dining table wears its cloth. */
  readonly dressed: boolean;
  /** The plan has gone to the events team. */
  readonly sent: boolean;
}

/** The four steps, each done, current or ahead: the current one is the first not yet done. */
export function journeySteps(progress: JourneyProgress): readonly JourneyStep[] {
  const done: Readonly<Record<JourneyStepId, boolean>> = {
    event: progress.eventKnown,
    layout: progress.eventKnown && progress.seated,
    finishing: progress.eventKnown && progress.seated && progress.dressed,
    send: progress.sent,
  };
  const current = ORDER.find((id) => !done[id]) ?? null;
  return ORDER.map((id) => ({
    id,
    label: JOURNEY_LABELS[id],
    state: done[id] ? "done" : id === current ? "current" : "ahead",
  }));
}

export type NextMoveId = "ask-guests" | "lay-out" | "seat-more" | "clear-door" | "open-gap" | "ask-venue" | "send" | "sent";

export interface NextMove {
  readonly id: NextMoveId;
  /** The move as the one primary key says it: an imperative, capitalised ("Seat 40 more guests"). */
  readonly text: string;
  /** The step whose sheet carries the move out. */
  readonly step: JourneyStepId;
}

/** The single most useful thing to do now, from the room as it stands. */
export function nextMove(facts: RoomFacts, sent: boolean): NextMove {
  const { plane } = facts;
  if (sent) return { id: "sent", text: "Sent to the events team", step: "send" };
  if (plane.guests === null || plane.guests === 0) {
    return { id: "ask-guests", text: "Say how many guests", step: "event" };
  }
  if (plane.seats === 0 && plane.tables === 0) {
    return { id: "lay-out", text: `Lay out the room for ${countLabel(plane.guests, "guest")}`, step: "layout" };
  }
  if (facts.doors !== null && facts.doors.blockers.length > 0) {
    const first = facts.doors.blockers[0];
    const name = first === undefined ? "a piece" : first.name;
    return { id: "clear-door", text: `Move ${name} clear of the door`, step: "layout" };
  }
  if (plane.standing === "over" && plane.limit !== null) {
    return { id: "ask-venue", text: `Ask the events team about more than ${String(plane.limit)}`, step: "send" };
  }
  if (plane.short > 0) {
    return { id: "seat-more", text: `Seat ${String(plane.short)} more ${countNoun(plane.short, "guest")}`, step: "layout" };
  }
  if (facts.aisles.band === "tight" || facts.aisles.band === "blocked") {
    return { id: "open-gap", text: "Open up the narrowest gap", step: "layout" };
  }
  return { id: "send", text: "Send to the events team", step: "send" };
}
