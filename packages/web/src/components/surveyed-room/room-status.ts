// ---------------------------------------------------------------------------
// How the planner's surveyed room stands, and what the planner says of it
//
// Where a device has asked for surveyed rooms and the planner's room is one,
// the planner draws its plain shell until the survey has loaded, and keeps
// the shell if it cannot be loaded. Either way it says so through its quiet
// caption (editor/cockpit/RoomResolveCaption.tsx), as it does for a capture
// and for the Grand Hall's surfaces: real counts while files arrive, a still
// note that lasts when something could not load, and silence once all is in.
//
// Plain data and words, no renderer and no store: the scene publishes a
// status (stores/surveyed-room-store.ts) and the caption reads it.
// ---------------------------------------------------------------------------

/** The photographs a drawn room loads on this device, as counted by its model. */
export interface SurveyedRoomPhotosStatus {
  readonly expected: number;
  /** Those that have arrived or failed. */
  readonly settled: number;
  /** Those that failed: their surfaces stay in a plain tone. */
  readonly failed: number;
}

export interface SurveyedRoomStatus {
  /** The planner's name for the room, as its space has it. */
  readonly roomName: string;
  /** The survey's data: still loading, loaded (the room is drawn from it) or unusable (the plain shell stays). */
  readonly phase: "loading" | "ready" | "failed";
  /** The survey's data files read, of those expected; the total is unknown until the record says. */
  readonly files: { readonly settled: number; readonly expected: number | null };
  /** The drawn room's photographs, once its model has said how many it loads; null before. */
  readonly photos: SurveyedRoomPhotosStatus | null;
  /** Why the survey could not be used, for a log or a developer: not words for a planner. */
  readonly failure: string | null;
}

/**
 * The caption for a surveyed room, or null when there is nothing to say: no
 * surveyed room is asked for here, or it has loaded whole.
 */
export function surveyedRoomCaption(status: SurveyedRoomStatus | null): string | null {
  if (status === null) return null;
  const name = status.roomName;
  if (status.phase === "failed") return `The surveyed ${name} could not load, so the room is drawn plainly. Planning is unaffected.`;
  if (status.phase === "loading") {
    const { settled, expected } = status.files;
    return expected === null ? `Loading the ${name} as surveyed` : `Loading the ${name} as surveyed · ${String(settled)} of ${String(expected)} files`;
  }
  // Drawn. Its photographs are loading only once its model has said so.
  const photos = status.photos;
  if (photos === null || photos.expected <= 0) return null;
  if (photos.settled < photos.expected) return `Loading the ${name}'s photographs · ${String(photos.settled)} of ${String(photos.expected)}`;
  if (photos.failed > 0) return `Some of the ${name}'s photographs could not load, so parts of the room are drawn in a plain tone. Planning is unaffected.`;
  return null;
}

/** Whether a surveyed room is still arriving: working motion shows only then. */
export function surveyedRoomWorking(status: SurveyedRoomStatus | null): boolean {
  if (status === null || status.phase === "failed") return false;
  if (status.phase === "loading") return true;
  return status.photos !== null && status.photos.settled < status.photos.expected;
}

/**
 * Whether something of a surveyed room could not load: the note that must
 * reach a planner on any screen, a phone's included.
 */
export function surveyedRoomTrouble(status: SurveyedRoomStatus | null): boolean {
  if (status === null) return false;
  if (status.phase === "failed") return true;
  return status.phase === "ready" && status.photos !== null && status.photos.settled >= status.photos.expected && status.photos.failed > 0;
}
