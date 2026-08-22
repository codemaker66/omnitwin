import { ROOM_DISPLAY_NAMES } from "../shell/twin-rooms.js";
import type { PublishedRoomSlug } from "../../lib/trades-hall-venue-truth.js";

// -----------------------------------------------------------------------------
// tour-copy — every word the guided tour can render, as data.
//
// Same contract as twin-copy.ts and the shell panels: no user-visible string is
// buried in JSX, and allTourCopy() hands the whole script to the claim guard
// (findUnsupportedProposalClaim) in __tests__/tour-model.test.ts. A surface that
// keeps its copy to itself is simply unguarded — the guard can only check the
// strings it is given.
//
// THE RULE THE CAPTIONS ARE WRITTEN UNDER
//
// A caption describes what the visitor is looking at. It does not sell it, and
// it does not describe anything nobody has verified. That rules out most of what
// a venue tour would normally say — "the light through the west windows", "room
// for a hundred and eighty at round tables" — because this codebase has no
// validated record of which way the west windows face from scan_058, and the
// capacity figures already have exactly one home (trades-hall-venue-truth.ts,
// joined at read time by twin-rooms.ts) which is not here.
//
// What IS verifiable, and therefore all these captions say:
//
//   • the room's name, but ONLY through ROOM_DISPLAY_NAMES, reached through a
//     slug that twin-rooms.ts has bound to that viewpoint by hand against
//     ground-truth photography. There is no free-text room name anywhere in this
//     file, so no caller — including a future one — can name a sixth room or
//     name the Saloon "Grand Hall".
//   • where the tour is in its own sequence: first, onward, again, last. That is
//     a fact about the stop list, not about the building.
//   • that two stops sharing a slug are two viewpoints of one room. "From
//     elsewhere in the room" is true by construction for ANY same-slug pair,
//     which is why it is phrased that way rather than "from the other end" —
//     twin-rooms.ts does record that scan_028 and scan_046 are the Grand Hall's
//     opposite ends, but that note is about those two ids, and a caption
//     template outlives the pair it was written for.
//
// The beats are derived in tour-model.ts from the stop list, never declared per
// stop. A hand-declared "again" on a stop that is not a repeat would be a
// sentence that lies about the building while every test still passed.
// -----------------------------------------------------------------------------

/** The rail's accessible name — announced before any of its controls, so each
 *  button's own label can stay short without losing its context. */
export const TOUR_GROUP_LABEL = "Guided tour";

/**
 * The default tour's name, rendered in the eyebrow above the caption.
 *
 * Deliberately not "Highlight reel", "The best of Trades Hall", or anything else
 * that ranks what the visitor is about to see. The tour visits the viewpoints
 * whose rooms are confirmed; that is a fact about our records, not a judgement
 * about the building, and a title that implied otherwise would be the first
 * unsupported claim on the surface.
 */
export const TOUR_DEFAULT_TITLE = "A walk through the building";

// — transport controls. Every label names the action the press will take, the
//   house idiom from TWIN_FULLSCREEN_ENTER / TWIN_FULLSCREEN_EXIT. —

export const TOUR_PLAY_LABEL = "Play the tour";
export const TOUR_PAUSE_LABEL = "Pause the tour";
export const TOUR_REPLAY_LABEL = "Play the tour again";
export const TOUR_NEXT_LABEL = "Next stop";
export const TOUR_PREVIOUS_LABEL = "Previous stop";

/**
 * The line shown the moment the visitor takes the view back.
 *
 * It says what happened and whose doing it was, because the alternative — the
 * tour silently stopping — reads as a bug. "The view is yours" is also the whole
 * design stated in four words: the tour never fights for the camera.
 */
export const TOUR_PAUSED_NOTE = "Paused — the view is yours.";

/** The end of the sequence. It hands the building back rather than looping by
 *  default: an unattended tour that restarts forever is a screensaver. */
export const TOUR_ENDED_NOTE = "That is the walk. The rest of the building is yours.";

/** Eyebrow above the caption: whose tour, and how far through it. */
export function tourEyebrow(title: string, position: number, total: number): string {
  return `${title} · ${String(position)} of ${String(total)}`;
}

/**
 * The eyebrow before anyone has pressed play: whose tour, and roughly how long.
 *
 * "About" is not a hedge for its own sake. tourDurationMs() adds up dwells and
 * spring settle times; it cannot know how long the visitor's connection takes to
 * deliver the panos, so a bare "1 min" would be a number the product cannot keep.
 * The one word is the difference between an estimate and a promise.
 */
export function tourLengthLine(minutes: number): string {
  return `About ${String(minutes)} min`;
}

/** Accessible name for one stop marker. The room is named so a screen-reader
 *  user choosing a stop knows where it goes, not merely that it is the third. */
export function tourStopLabel(position: number, roomName: string): string {
  return `Stop ${String(position)}, ${roomName}`;
}

/** Polite live-region line, spoken on each arrival. The caption leads because
 *  the caption is the news; the position follows so the line stands alone. */
export function tourAnnouncement(caption: string, position: number, total: number): string {
  return `${caption} Stop ${String(position)} of ${String(total)}.`;
}

/**
 * Where a stop sits in the sequence. Derived in tour-model.ts, never authored:
 * see this file's header for why a hand-declared beat is a caption that can lie.
 */
export type TourBeat = "open" | "onward" | "again" | "last";

/** Every beat, for exhaustive sweeps and for the model's own derivation. */
export const TOUR_BEATS: readonly TourBeat[] = ["open", "onward", "again", "last"];

/**
 * The caption for one stop.
 *
 * Takes a SLUG, not a name. A free-text name parameter would let any caller
 * render a room label that bypassed the claim sweep — which can only check the
 * strings it is handed — and would put a second spelling of every room name in
 * the codebase. Constrained to PublishedRoomSlug, every name this function can
 * ever produce comes from ROOM_DISPLAY_NAMES, which one test already pins whole.
 */
export function tourCaption(beat: TourBeat, slug: PublishedRoomSlug): string {
  const name = ROOM_DISPLAY_NAMES[slug];
  switch (beat) {
    case "open":
      return `We begin in the ${name}.`;
    case "onward":
      return `Through to the ${name}.`;
    case "again":
      // True for any pair of stops sharing a slug: same verified room, different
      // viewpoint. Says nothing about which end, because the template outlives
      // the one pair whose ends anybody has actually checked.
      return `The ${name} again, from elsewhere in the room.`;
    case "last":
      return `And last, the ${name}.`;
  }
}

/**
 * Every user-visible string this surface can render — the claim-guard sweep
 * target, mirroring allTwinCopy() and allQuickActionCopy().
 *
 * The captions are ENUMERATED rather than sampled. Because a caption is a beat
 * and a slug, and both sets are finite and closed, the set of renderable
 * sentences is knowable here — so the sweep covers the tour exactly, instead of
 * covering one example and trusting the rest. A sixth room added to twin-rooms
 * therefore cannot ship four unswept captions.
 */
export function allTourCopy(): readonly string[] {
  const slugs = Object.keys(ROOM_DISPLAY_NAMES) as PublishedRoomSlug[];
  const captions = TOUR_BEATS.flatMap((beat) => slugs.map((slug) => tourCaption(beat, slug)));
  return [
    TOUR_GROUP_LABEL,
    TOUR_DEFAULT_TITLE,
    TOUR_PLAY_LABEL,
    TOUR_PAUSE_LABEL,
    TOUR_REPLAY_LABEL,
    TOUR_NEXT_LABEL,
    TOUR_PREVIOUS_LABEL,
    TOUR_PAUSED_NOTE,
    TOUR_ENDED_NOTE,
    tourEyebrow(TOUR_DEFAULT_TITLE, 2, 5),
    tourLengthLine(1),
    tourLengthLine(2),
    tourStopLabel(2, ROOM_DISPLAY_NAMES.saloon),
    tourAnnouncement(tourCaption("onward", "saloon"), 2, 5),
    ...captions,
  ];
}
