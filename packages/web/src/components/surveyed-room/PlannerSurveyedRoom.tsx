// ---------------------------------------------------------------------------
// The planner's surveyed room, loaded and handed to the scene
//
// The code the planner asks for only where a survey is asked for
// (use-planner-surveyed-room.ts): this file and everything it imports (the
// survey's reader, its geometry, its materials, the model) stay out of the
// planner every other visitor loads. Nothing imports it but that one dynamic
// import (src/__tests__/bundle-splitting.test.ts holds that).
//
// It is mounted beside the planner's canvas, not in it, so a survey loads
// whether or not the canvas is up yet and is kept when a canvas is rebuilt.
// It draws nothing itself:
//
//   - it reads the space's venue and goes no further unless that is Trades
//     Hall: another venue's room of the same slug keeps its shell, and so does
//     a room whose venue cannot be read;
//   - it loads the survey (use-surveyed-room.ts) and says how that stands, for
//     the planner's caption (stores/surveyed-room-store.ts): files counted in,
//     drawn, or failed with the file and the reason;
//   - once the room is ready it hands the scene the room to draw (a
//     SurveyedRoomModel element, which the scene places in its canvas while
//     the model view shows) and the camera's opening pose for it
//     (room-opening-view.ts), and takes both back when the room leaves.
//
// The opening pose is one object for as long as the room and the size of its
// data stand. CameraRig opens the camera afresh whenever it is handed a new
// pose object, so the pose follows the room's numbers, as the rig's own
// dimensions do, and never the object that carries them: a space read again
// and found equal leaves the camera where the planner put it.
// ---------------------------------------------------------------------------

import { useEffect, useLayoutEffect, useMemo } from "react";
import type { SpaceDimensions } from "@omnitwin/types";
import { useTradesHallVenueStatus } from "../../hooks/use-trades-hall-venue.js";
import { useSurveyedRoomStore } from "../../stores/surveyed-room-store.js";
import { surveyedRoomOpeningPose } from "./room-opening-view.js";
import { SurveyedRoomModel, type SurveyedRoomPhotoProgress } from "./SurveyedRoomModel.js";
import type { PlannerSurveyedRoomDrawn, PlannerSurveyedRoomRequest } from "./use-planner-surveyed-room.js";
import { useSurveyedRoom } from "./use-surveyed-room.js";

export interface PlannerSurveyedRoomProps {
  /** The survey asked for, and the venue of the space it is asked for. */
  readonly request: PlannerSurveyedRoomRequest;
  /** The planner's name for the room, as its space has it: what the caption calls it. */
  readonly roomName: string;
  /** The room's data as the planner sizes it: what the camera's opening is worked out from. */
  readonly dimensions: SpaceDimensions;
  /** The planner camera's vertical field of view, degrees. */
  readonly fovDeg: number;
  /** Handed the room to draw once it is ready, and null when it no longer is. */
  readonly onDrawn: (drawn: PlannerSurveyedRoomDrawn | null) => void;
}

/** Files not yet counted: the venue is still being read, or the record has not said how many there are. */
const NOT_COUNTED = { settled: 0, expected: null } as const;
/** A load that has ended, either way, counts no files in. */
const FILES_DONE_WITH = { settled: 0, expected: null } as const;

/** The drawn room's photograph report (SurveyedRoomModel's `onPhotoProgress`), kept for the caption. */
function reportPhotos(progress: SurveyedRoomPhotoProgress): void {
  useSurveyedRoomStore.getState().reportPhotos({ expected: progress.expected, settled: progress.settled, failed: progress.failed.length });
}

export function PlannerSurveyedRoom({ request, roomName, dimensions, fovDeg, onDrawn }: PlannerSurveyedRoomProps): null {
  // The venue is read only here, where a room has a survey to draw.
  const venue = useTradesHallVenueStatus(request.venueId);
  const state = useSurveyedRoom(venue === "trades-hall" ? request.entry : null);

  const publish = useSurveyedRoomStore((store) => store.publish);
  useEffect(() => {
    if (venue === "other" || venue === "unknown") {
      // Not Trades Hall's room after all, or a venue that cannot be read: no surveyed room is asked for here.
      publish(null);
    } else if (state.status === "ready") {
      publish({ roomName, phase: "ready", files: FILES_DONE_WITH, failure: null });
    } else if (state.status === "failed") {
      const { file, reason, detail } = state.failure;
      publish({ roomName, phase: "failed", files: FILES_DONE_WITH, failure: `${file} (${reason}): ${detail}` });
    } else {
      // Still arriving: the venue being read, or the survey's files.
      const files = state.status === "loading" ? { settled: state.settled, expected: state.expected } : NOT_COUNTED;
      publish({ roomName, phase: "loading", files, failure: null });
    }
  }, [publish, roomName, state, venue]);

  const room = state.status === "ready" ? state.room : null;
  // By the room's numbers, never the object that carries them: see the note at the top.
  const { width, length, height } = dimensions;
  const opening = useMemo(
    () => (room === null ? null : surveyedRoomOpeningPose(room.geometry, { width, length, height }, fovDeg)),
    [fovDeg, height, length, room, width],
  );
  const model = useMemo(() => (room === null ? null : <SurveyedRoomModel room={room} onPhotoProgress={reportPhotos} />), [room]);
  // Before the planner paints again, so the shell goes and the room comes in one step of the scene.
  useLayoutEffect(() => {
    if (opening === null || model === null) return undefined;
    onDrawn({ request, opening, model });
    return () => { onDrawn(null); };
  }, [model, onDrawn, opening, request]);

  return null;
}
