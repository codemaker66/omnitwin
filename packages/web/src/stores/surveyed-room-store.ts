import { create } from "zustand";
import type { SurveyedRoomPhotosStatus, SurveyedRoomStatus } from "../components/surveyed-room/room-status.js";

// ---------------------------------------------------------------------------
// Surveyed room store — how the planner's surveyed room stands
//
// The planner's scene loads a surveyed room where this device asks for one
// (components/surveyed-room/use-planner-surveyed-room.ts) and publishes how
// that is going here, for the quiet caption that tells the planner and for
// the development lab. Null whenever no surveyed room is asked for: the
// switch is off, the room has no survey, or it is not Trades Hall's.
// ---------------------------------------------------------------------------

/** What the scene knows of the survey's data; the photographs are the model's to report. */
export type SurveyedRoomLoadStatus = Omit<SurveyedRoomStatus, "photos">;

interface SurveyedRoomStore {
  readonly status: SurveyedRoomStatus | null;
  /** The scene's word on the survey's data; null when no surveyed room is asked for. */
  readonly publish: (load: SurveyedRoomLoadStatus | null) => void;
  /** The drawn room's word on its photographs. */
  readonly reportPhotos: (photos: SurveyedRoomPhotosStatus) => void;
}

function samePhotos(a: SurveyedRoomPhotosStatus | null, b: SurveyedRoomPhotosStatus): boolean {
  return a !== null && a.expected === b.expected && a.settled === b.settled && a.failed === b.failed;
}

export const useSurveyedRoomStore = create<SurveyedRoomStore>()((set) => ({
  status: null,
  publish: (load) => {
    set((state) => {
      if (load === null) return state.status === null ? state : { status: null };
      // The photographs belong to the room that is drawn: a load that is not ready has none.
      return { status: { ...load, photos: load.phase === "ready" ? state.status?.photos ?? null : null } };
    });
  },
  reportPhotos: (photos) => {
    set((state) => (state.status === null || samePhotos(state.status.photos, photos) ? state : { status: { ...state.status, photos } }));
  },
}));

/** A surveyed room model's photograph report (SurveyedRoomModel's `onPhotoProgress`), kept for the caption. */
export function reportSurveyedRoomPhotos(progress: { readonly expected: number; readonly settled: number; readonly failed: readonly string[] }): void {
  useSurveyedRoomStore.getState().reportPhotos({ expected: progress.expected, settled: progress.settled, failed: progress.failed.length });
}
