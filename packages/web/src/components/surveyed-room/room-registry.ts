// ---------------------------------------------------------------------------
// Which rooms are drawn as surveyed
//
// A surveyed room is published by tools/surveyed-rooms into a dated folder of
// the web's public files, with a survey.json that describes it. This table
// says where each Trades Hall room's survey lives and at which revision; a
// room is drawn as surveyed only when it is listed here, its space belongs to
// Trades Hall (never another venue's room of the same slug), and this device
// has asked for surveyed rooms.
//
// No room is listed yet: the Saloon joins once its files are published. The
// Grand Hall keeps its own code (components/grand-hall) and is not listed.
//
// The switch is per device while surveyed rooms are reviewed: `?rooms=surveyed`
// turns them on and remembers it; `?rooms=plain` turns them off again.
// Presentation only: the layout is the same either way.
// ---------------------------------------------------------------------------

import { isTradesHallVenueSlug } from "../../hooks/use-trades-hall-venue.js";

export interface SurveyedRoomEntry {
  /** The survey's public folder, without a trailing slash. */
  readonly base: string;
  /**
   * Raised whenever the survey's files are rebuilt in place, so a browser
   * never pairs a new record with an old atlas or relief it kept.
   */
  readonly revision: number;
}

/** Trades Hall's surveyed rooms, by space slug. */
export const SURVEYED_ROOMS: ReadonlyMap<string, SurveyedRoomEntry> = new Map<string, SurveyedRoomEntry>();

/** A survey file's URL, at the entry's revision. */
export function surveyFileUrl(entry: SurveyedRoomEntry, file: string): string {
  return `${entry.base}/${file}?r=${String(entry.revision)}`;
}

/** The survey for a Trades Hall space, or null when the space is not drawn as surveyed. */
export function surveyedRoomFor(
  venueSlug: string,
  spaceSlug: string,
  rooms: ReadonlyMap<string, SurveyedRoomEntry> = SURVEYED_ROOMS,
): SurveyedRoomEntry | null {
  if (!isTradesHallVenueSlug(venueSlug)) return null;
  return rooms.get(spaceSlug) ?? null;
}

const STORAGE_KEY = "venviewer.surveyed-rooms";

/** Whether this device draws surveyed rooms, from the URL or the last choice. */
export function surveyedRoomsEnabled(search: string): boolean {
  const asked = new URLSearchParams(search).get("rooms");
  if (asked === "surveyed" || asked === "plain") {
    try { window.localStorage.setItem(STORAGE_KEY, asked); } catch { /* a convenience only */ }
    return asked === "surveyed";
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "surveyed";
  } catch {
    return false;
  }
}
