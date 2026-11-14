// ---------------------------------------------------------------------------
// The planner's surveyed room
//
// The planner draws a room as surveyed when three things hold: this device
// has asked for surveyed rooms (room-registry.ts, `?rooms=surveyed`), the
// room is listed in the registry by its space's slug, and the space is Trades
// Hall's (another venue's room of the same slug is never drawn as Trades
// Hall's). The survey is then loaded (use-surveyed-room.ts) and, once ready,
// handed to the scene to draw in place of the plain shell. Until then, and
// if it cannot be loaded, the hook hands back null and the shell stays; how
// the load stands is published for the planner's caption either way
// (stores/surveyed-room-store.ts), so a failure is never silent.
//
// Nothing is asked of anyone for a device that has not turned the switch on,
// or for a room without a survey: no venue is read and nothing is fetched.
//
// Presentation only. Where furniture may stand, the room's bounds, snapping
// and what is saved come from the room's data, not from how it is drawn.
//
// In development builds a staged survey can be shown without listing it:
// `?roomsBase=<public folder>&roomsRev=<revision>` stands in for the
// registry's entry for whichever room the planner has open (still with
// `?rooms=surveyed`, and still only for a Trades Hall space). The folder's
// record must be that room's own, as for a listed one. Production builds
// ignore both parameters.
// ---------------------------------------------------------------------------

import { useEffect, useMemo } from "react";
import { useTradesHallVenue } from "../../hooks/use-trades-hall-venue.js";
import { useSurveyedRoomStore } from "../../stores/surveyed-room-store.js";
import { publicSurveyFolder, SURVEYED_ROOMS, surveyedRoomsEnabled, type SurveyedRoomEntry } from "./room-registry.js";
import { useSurveyedRoom, type SurveyedRoom } from "./use-surveyed-room.js";

/** What this device has asked for, read once from the page's address. */
export interface PlannerSurveyedRoomAsk {
  /** Whether this device draws surveyed rooms. */
  readonly enabled: boolean;
  /** A staged survey standing in for the registry's entry (development builds only), or null. */
  readonly staged: Pick<SurveyedRoomEntry, "base" | "revision"> | null;
}

const NOTHING_ASKED: PlannerSurveyedRoomAsk = { enabled: false, staged: null };
/** A load that has ended, either way, counts no files in. */
const FILES_DONE_WITH = { settled: 0, expected: null } as const;

/**
 * Reads the switch and, where `development` is true, a staged folder. A
 * folder that is not a plain path on this site, or a revision that is not a
 * whole number from 1 (1 when left out), stages nothing.
 */
export function plannerSurveyedRoomAsk(search: string, development: boolean): PlannerSurveyedRoomAsk {
  const enabled = surveyedRoomsEnabled(search);
  if (!development) return { enabled, staged: null };
  const params = new URLSearchParams(search);
  const base = publicSurveyFolder(params.get("roomsBase") ?? "");
  const asked = params.get("roomsRev") ?? "1";
  const revision = Number(asked);
  if (base === null || !/^[1-9][0-9]*$/.test(asked) || !Number.isSafeInteger(revision)) return { enabled, staged: null };
  return { enabled, staged: { base, revision } };
}

/**
 * The survey to load for the planner's room, or null: the switch is off, or
 * the room has neither a listed survey nor a staged one. A staged survey is
 * expected to be the open room's own.
 */
export function plannerSurveyedRoomEntry(
  ask: PlannerSurveyedRoomAsk, spaceSlug: string | null, rooms: ReadonlyMap<string, SurveyedRoomEntry> = SURVEYED_ROOMS,
): SurveyedRoomEntry | null {
  if (!ask.enabled || spaceSlug === null) return null;
  if (ask.staged !== null) return { slug: spaceSlug, ...ask.staged };
  return rooms.get(spaceSlug) ?? null;
}

/** The part of a space the planner's surveyed room is decided by. */
export interface PlannerRoomSpace {
  readonly slug: string;
  readonly name: string;
  readonly venueId: string;
}

/**
 * The surveyed room to draw for the planner's space, or null while there is
 * none to draw: none asked for, still loading, or failed (the plain shell
 * stays). `eligible` is false for a room drawn by other code (the Grand
 * Hall), which is then never asked about.
 */
export function usePlannerSurveyedRoom(space: PlannerRoomSpace | null, eligible: boolean): SurveyedRoom | null {
  const ask = useMemo(
    () => (typeof window === "undefined" ? NOTHING_ASKED : plannerSurveyedRoomAsk(window.location.search, import.meta.env.DEV)),
    [],
  );
  const slug = eligible && space !== null ? space.slug : null;
  const entry = useMemo(() => plannerSurveyedRoomEntry(ask, slug), [ask, slug]);
  // The venue is read only for a room that has a survey to draw.
  const tradesHall = useTradesHallVenue(entry !== null && space !== null ? space.venueId : null);
  const state = useSurveyedRoom(tradesHall === true ? entry : null);

  const roomName = space?.name ?? null;
  const publish = useSurveyedRoomStore((store) => store.publish);
  useEffect(() => {
    if (roomName === null || state.status === "idle") {
      publish(null);
      return;
    }
    if (state.status === "loading") publish({ roomName, phase: "loading", files: { settled: state.settled, expected: state.expected }, failure: null });
    else if (state.status === "ready") publish({ roomName, phase: "ready", files: FILES_DONE_WITH, failure: null });
    else {
      const { file, reason, detail } = state.failure;
      publish({ roomName, phase: "failed", files: FILES_DONE_WITH, failure: `${file} (${reason}): ${detail}` });
    }
  }, [publish, roomName, state]);
  // Nothing is left said of a scene that has gone.
  useEffect(() => () => { publish(null); }, [publish]);

  return state.status === "ready" ? state.room : null;
}
