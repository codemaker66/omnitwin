// ---------------------------------------------------------------------------
// The planner's surveyed room: what is asked, and where its code is asked for
//
// The planner draws a room as surveyed when three things hold: this device
// has asked for surveyed rooms (room-registry.ts, `?rooms=surveyed`), the
// room is listed in the registry by its space's slug, and the space is Trades
// Hall's (another venue's room of the same slug is never drawn as Trades
// Hall's).
//
// This file is the seam: all of that the planner itself carries, for every
// visitor. It reads the switch, finds the room's survey and, only where there
// is one, asks for the code that loads and draws it (PlannerSurveyedRoom.tsx,
// and through it the venue read, the survey's reader, its geometry, its
// materials and the model). Nothing here imports that code: `surveyedRoomCode`
// is the one place it is asked for, on demand, and
// src/__tests__/bundle-splitting.test.ts holds that. A device that has not
// turned the switch on, or a room without a survey, asks for nothing: no
// code, no venue and no file.
//
// From the moment a survey is asked for, the room is arriving, and the
// planner's caption says so (stores/surveyed-room-store.ts): the code's own
// download is the first part of that. The code then says how the survey's
// files stand and hands back the room to draw with the camera's opening pose
// for it. Until it does, and if anything cannot be had (the code included),
// the scene is handed nothing, the plain shell stays, and the caption says
// why: a failure is never silent, and never a blank canvas.
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

import { createElement, lazy, Suspense, useEffect, useLayoutEffect, useMemo, useState, type ReactElement } from "react";
import type { SpaceDimensions } from "@omnitwin/types";
import { useSurveyedRoomStore } from "../../stores/surveyed-room-store.js";
import type { RoomOpeningPose } from "./room-opening-view.js";
import { publicSurveyFolder, SURVEYED_ROOMS, surveyedRoomsEnabled, type SurveyedRoomEntry } from "./room-registry.js";
import type { SurveyedRoomModelProps } from "./SurveyedRoomModel.js";

/** What this device has asked for, read once from the page's address. */
export interface PlannerSurveyedRoomAsk {
  /** Whether this device draws surveyed rooms. */
  readonly enabled: boolean;
  /** A staged survey standing in for the registry's entry (development builds only), or null. */
  readonly staged: Pick<SurveyedRoomEntry, "base" | "revision"> | null;
}

const NOTHING_ASKED: PlannerSurveyedRoomAsk = { enabled: false, staged: null };
/** No files counted: before the record has said how many there are, and after a load has ended. */
const NO_FILES_COUNTED = { settled: 0, expected: null } as const;

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
 * A survey asked for the room of one venue. The planner holds one such object
 * for as long as both stand, and the room's code answers to it by identity: a
 * room handed back for an earlier request is never drawn.
 */
export interface PlannerSurveyedRoomRequest {
  readonly entry: SurveyedRoomEntry;
  /** The space's venue, which the code reads before anything is fetched: only Trades Hall's rooms are drawn as surveyed. */
  readonly venueId: string;
}

/** A surveyed room loaded and ready to draw, as its code hands it to the planner's scene. */
export interface PlannerSurveyedRoomDrawn {
  /** The request it answers. */
  readonly request: PlannerSurveyedRoomRequest;
  /** The camera's opening pose for the room (room-opening-view.ts): one object while the room and its data's numbers stand. */
  readonly opening: RoomOpeningPose;
  /** The room itself, for the scene to place inside its canvas. */
  readonly model: ReactElement<SurveyedRoomModelProps>;
}

/** What the planner's scene is handed. */
export interface PlannerSurveyedRoomSeam {
  /**
   * The surveyed room to draw in place of the plain shell, or null while there
   * is none: none asked for, still arriving, or failed (the shell stays).
   */
  readonly model: ReactElement<SurveyedRoomModelProps> | null;
  /** The camera's opening pose while that room is the one to draw; null otherwise, and the planner's own opening stands. */
  readonly opening: RoomOpeningPose | null;
  /**
   * What loads the survey, to mount once beside the canvas (it draws nothing):
   * null where no survey is asked for, and until its code has arrived.
   */
  readonly loader: ReactElement | null;
}

type SurveyedRoomCode = typeof import("./PlannerSurveyedRoom.js");

/**
 * Where the surveyed room's code comes from: a seam for tests, the one dynamic
 * import otherwise. Where the fetch fails it rejects: Vite's import helper
 * rethrows, since the page's listener never prevents its default, and the
 * page reloads for a newer build only once the app's own server has answered
 * (route-error-boundary.tsx). An answer of nothing is still a failure.
 */
export const surveyedRoomCode = {
  load(): Promise<SurveyedRoomCode | undefined> {
    return import("./PlannerSurveyedRoom.js");
  },
};

/** The code's component, as React.lazy takes one; a failure where the code did
 *  not arrive. No build resolves with nothing now (see surveyedRoomCode); the
 *  check stays so such an answer could never be mounted. */
function componentOf(code: SurveyedRoomCode | undefined): { readonly default: SurveyedRoomCode["PlannerSurveyedRoom"] } {
  if (code === undefined) throw new Error("it did not arrive, and the page is reloading for a newer build");
  return { default: code.PlannerSurveyedRoom };
}

/**
 * Mounted only once the seam's own request for the code has come back with it
 * (below), so this never suspends on a download that fails or never ends.
 */
const PlannerSurveyedRoom = lazy(() => surveyedRoomCode.load().then(componentOf));

/**
 * The planner's surveyed room for its space: what to draw, the camera's
 * opening pose for it, and the loader to mount beside the canvas. `eligible`
 * is false for a room drawn by other code (the Grand Hall), which is then
 * never asked about. `dimensions` is the room's data as the planner sizes it
 * and `fovDeg` the planner camera's vertical field of view: what the opening
 * pose is worked out from, by the room's code.
 */
export function usePlannerSurveyedRoom(
  space: PlannerRoomSpace | null, eligible: boolean, dimensions: SpaceDimensions, fovDeg: number,
): PlannerSurveyedRoomSeam {
  const ask = useMemo(
    () => (typeof window === "undefined" ? NOTHING_ASKED : plannerSurveyedRoomAsk(window.location.search, import.meta.env.DEV)),
    [],
  );
  const slug = eligible && space !== null ? space.slug : null;
  const entry = useMemo(() => plannerSurveyedRoomEntry(ask, slug), [ask, slug]);
  const venueId = space?.venueId ?? null;
  const request = useMemo<PlannerSurveyedRoomRequest | null>(
    () => (entry === null || venueId === null ? null : { entry, venueId }),
    [entry, venueId],
  );
  const roomName = space?.name ?? null;

  const publish = useSurveyedRoomStore((store) => store.publish);
  // Said in the pass that asks, before anything has arrived: from here the room is arriving, its code first, so
  // the caption shows work under way and nothing reads the room as settled while its code is still on the way.
  useLayoutEffect(() => {
    if (request === null || roomName === null) return undefined;
    publish({ roomName, phase: "loading", files: NO_FILES_COUNTED, failure: null });
    // Nothing is left said of a survey no longer asked for, or of a scene that has gone.
    return () => { publish(null); };
  }, [publish, request, roomName]);

  // The code, asked for only here. If it cannot be had the room has failed as any survey fails: the shell stays
  // and the caption says so. Nothing of it is mounted until it is in hand.
  const [codeReady, setCodeReady] = useState(false);
  useEffect(() => {
    if (request === null || roomName === null) return undefined;
    let current = true;
    surveyedRoomCode.load().then(componentOf).then(
      () => { if (current) setCodeReady(true); },
      (error: unknown) => {
        if (!current) return;
        const detail = error instanceof Error ? error.message : String(error);
        publish({ roomName, phase: "failed", files: NO_FILES_COUNTED, failure: `the room's code (import): ${detail}` });
      },
    );
    return () => { current = false; };
  }, [publish, request, roomName]);

  const [drawn, setDrawn] = useState<PlannerSurveyedRoomDrawn | null>(null);
  // Only a room that answers what is asked now: one in hand for an earlier request (another room, another
  // venue's room of the same slug) is not drawn, from the first pass that asks for something else.
  const mine = drawn !== null && drawn.request === request ? drawn : null;
  const loader = request === null || roomName === null || !codeReady ? null
    : createElement(Suspense, { fallback: null }, createElement(PlannerSurveyedRoom, { request, roomName, dimensions, fovDeg, onDrawn: setDrawn }));

  return { model: mine?.model ?? null, opening: mine?.opening ?? null, loader };
}
