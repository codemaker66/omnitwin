// ---------------------------------------------------------------------------
// Loading a surveyed room: its record, its reliefs and its surfaces
//
// A room listed in the registry (room-registry.ts) is drawn from three kinds
// of file: survey.json, the walls' relief and, where the record describes
// one, the ceiling's. loadSurveyedRoom fetches them at the entry's revision,
// checks each against the record and builds the room's surfaces
// (room-geometry.ts); useSurveyedRoom does that for a component and holds the
// outcome as one state.
//
// Nothing here falls back. A room either loads whole or fails with the file
// and the reason, so a caller can say that the surveyed room could not be
// loaded and draw the room some other way knowingly:
//
//   network    the request never completed
//   http       the server refused it (the status is kept)
//   json       survey.json is not JSON (a dev server answers a missing file
//              with its page)
//   schema     survey.json is not a record this reader can use
//   revision   the record is another revision than the registry asks for, so
//              files kept by a browser could be paired with the wrong record
//   format     a relief file is not a GHR1 container, or holds other entries
//              than the record names
//   integrity  a relief file is not the size the record lists for it
//   geometry   the surfaces cannot be built (a relief wound inside out)
//   unexpected anything else, kept with its message
//
// The photographs are not loaded here: they belong to the renderer and its
// device (room-photos.ts), and a room is drawn in their average tone until
// they arrive. An abort is passed through untouched and is never a failure.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { fetchSurveyRecord, SurveyLoadError, type SurveyLoadFailure } from "./load-survey.js";
import { assertReliefIds, parseReliefContainer, type ReliefMesh } from "./relief-container.js";
import { buildRoomFrame, type RoomFrame } from "./room-frame.js";
import {
  buildCeilingGeometry, buildFloorGeometry, buildWallsGeometry, type RoomGeometry, type RoomReliefs,
} from "./room-geometry.js";
import { surveyFileUrl, type SurveyedRoomEntry } from "./room-registry.js";
import type { SurveyRecord } from "./survey-record.js";

/** The record's file name in every survey folder. */
export const SURVEY_RECORD_FILE = "survey.json";

export type SurveyedRoomFailureReason = SurveyLoadFailure | "revision" | "format" | "integrity" | "geometry" | "unexpected";

/** Why a surveyed room could not be loaded. */
export interface SurveyedRoomFailure {
  /** The file that could not be used. */
  readonly file: string;
  readonly url: string;
  readonly reason: SurveyedRoomFailureReason;
  /** The HTTP status, for an "http" failure. */
  readonly status: number | null;
  /** What went wrong, for a log or a developer; not words for a planner. */
  readonly detail: string;
}

export class SurveyedRoomLoadError extends Error {
  readonly failure: SurveyedRoomFailure;

  constructor(failure: SurveyedRoomFailure, cause?: unknown) {
    super(`Surveyed room: ${failure.file} (${failure.reason}): ${failure.detail}`, cause === undefined ? undefined : { cause });
    this.name = "SurveyedRoomLoadError";
    this.failure = failure;
  }
}

/** A surveyed room, loaded and checked: what SurveyedRoomModel draws. */
export interface SurveyedRoom {
  readonly entry: SurveyedRoomEntry;
  readonly record: SurveyRecord;
  readonly frame: RoomFrame;
  /** The measured reliefs as read from their files. */
  readonly reliefs: RoomReliefs;
  /** The room's surfaces as plain arrays, built from the record and the reliefs. */
  readonly geometry: RoomGeometry;
}

/** How many of the room's data files have been read; `expected` is unknown until the record says. */
export interface SurveyedRoomProgress {
  readonly settled: number;
  readonly expected: number | null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rethrowIfAborted(signal: AbortSignal, error: unknown): void {
  if (signal.aborted) throw error;
}

/** One relief file's bytes, or a typed failure. */
async function fetchReliefFile(entry: SurveyedRoomEntry, file: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const url = surveyFileUrl(entry, file);
  const fail = (reason: SurveyedRoomFailureReason, detail: string, status: number | null, cause?: unknown): never => {
    throw new SurveyedRoomLoadError({ file, url, reason, status, detail }, cause);
  };
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    rethrowIfAborted(signal, error);
    return fail("network", `could not be fetched from ${url}`, null, error);
  }
  if (!response.ok) return fail("http", `HTTP ${String(response.status)} from ${url}`, response.status);
  try {
    return await response.arrayBuffer();
  } catch (error) {
    rethrowIfAborted(signal, error);
    return fail("network", `could not be read from ${url}`, null, error);
  }
}

/** A relief file read, parsed and held to what the record says of it. */
async function loadRelief(
  entry: SurveyedRoomEntry, record: SurveyRecord, file: string, ids: readonly string[], signal: AbortSignal,
): Promise<ReadonlyMap<string, ReliefMesh>> {
  const buffer = await fetchReliefFile(entry, file, signal);
  signal.throwIfAborted();
  const url = surveyFileUrl(entry, file);
  let relief: Map<string, ReliefMesh>;
  try {
    relief = parseReliefContainer(buffer, { maxEntries: ids.length, label: file });
    assertReliefIds(relief, ids, file);
  } catch (error) {
    throw new SurveyedRoomLoadError({ file, url, reason: "format", status: null, detail: messageOf(error) }, error);
  }
  const listed = record.files[file]?.bytes;
  if (listed !== undefined && listed !== buffer.byteLength) {
    throw new SurveyedRoomLoadError({
      file, url, reason: "integrity", status: null,
      detail: `is ${String(buffer.byteLength)} bytes but the record lists ${String(listed)}: it is not the file this record was published with`,
    });
  }
  return relief;
}

/** A failure nothing above foresaw, kept with its message so it is never silent. */
function unexpected(entry: SurveyedRoomEntry, error: unknown): SurveyedRoomFailure {
  return { file: SURVEY_RECORD_FILE, url: surveyFileUrl(entry, SURVEY_RECORD_FILE), reason: "unexpected", status: null, detail: messageOf(error) };
}

/** One surface built, or a "geometry" failure naming the file it was built from. */
function built<T>(entry: SurveyedRoomEntry, file: string, build: () => T): T {
  try {
    return build();
  } catch (error) {
    throw new SurveyedRoomLoadError({ file, url: surveyFileUrl(entry, file), reason: "geometry", status: null, detail: messageOf(error) }, error);
  }
}

async function load(entry: SurveyedRoomEntry, signal: AbortSignal, onProgress: (progress: SurveyedRoomProgress) => void): Promise<SurveyedRoom> {
  const recordUrl = surveyFileUrl(entry, SURVEY_RECORD_FILE);
  let record: SurveyRecord;
  try {
    record = await fetchSurveyRecord(recordUrl, signal);
  } catch (error) {
    if (!(error instanceof SurveyLoadError)) throw error;
    throw new SurveyedRoomLoadError({ file: SURVEY_RECORD_FILE, url: recordUrl, reason: error.reason, status: error.status, detail: error.message }, error);
  }
  if (record.revision !== entry.revision) {
    throw new SurveyedRoomLoadError({
      file: SURVEY_RECORD_FILE, url: recordUrl, reason: "revision", status: null,
      detail: `the record is revision ${String(record.revision)} but revision ${String(entry.revision)} was asked for`,
    });
  }
  const ceilingRelief = record.ceiling.relief;
  const expected = ceilingRelief === undefined ? 2 : 3;
  let settled = 1;
  onProgress({ settled, expected });
  const counted = async <T>(work: Promise<T>): Promise<T> => {
    const value = await work;
    settled += 1;
    if (!signal.aborted) onProgress({ settled, expected });
    return value;
  };
  const [walls, ceiling] = await Promise.all([
    counted(loadRelief(entry, record, record.relief.file, record.relief.order, signal)),
    ceilingRelief === undefined
      ? Promise.resolve(null)
      : counted(loadRelief(entry, record, ceilingRelief.file, [ceilingRelief.id], signal)).then((relief) => relief.get(ceilingRelief.id) ?? null),
  ]);
  signal.throwIfAborted();
  const reliefs: RoomReliefs = { walls, ceiling };
  const frame = built(entry, SURVEY_RECORD_FILE, () => buildRoomFrame(record.room.outline));
  const geometry: RoomGeometry = {
    walls: built(entry, record.relief.file, () => buildWallsGeometry(record, frame, walls)),
    ceiling: built(entry, ceilingRelief?.file ?? SURVEY_RECORD_FILE, () => buildCeilingGeometry(record, frame, ceiling)),
    floor: built(entry, SURVEY_RECORD_FILE, () => buildFloorGeometry(record, frame)),
  };
  return { entry, record, frame, reliefs, geometry };
}

/**
 * Loads a surveyed room. Rejects with a {@link SurveyedRoomLoadError} naming
 * the file and the reason, or with the abort's reason when `signal` aborts
 * (the requests still under way are then stopped). One file failing stops
 * the others.
 */
export async function loadSurveyedRoom(
  entry: SurveyedRoomEntry, signal?: AbortSignal, onProgress: (progress: SurveyedRoomProgress) => void = () => undefined,
): Promise<SurveyedRoom> {
  signal?.throwIfAborted();
  // The caller's abort, and this load's own on its first failure.
  const controller = new AbortController();
  const stop = (): void => { controller.abort(signal?.reason); };
  signal?.addEventListener("abort", stop, { once: true });
  try {
    return await load(entry, controller.signal, onProgress);
  } catch (error) {
    signal?.throwIfAborted();
    throw error instanceof SurveyedRoomLoadError ? error : new SurveyedRoomLoadError(unexpected(entry, error), error);
  } finally {
    signal?.removeEventListener("abort", stop);
    // Whatever is still being fetched (a sibling of the file that failed) is let go.
    controller.abort();
  }
}

export type SurveyedRoomState =
  /** No room was asked for. */
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly settled: number; readonly expected: number | null }
  | { readonly status: "ready"; readonly room: SurveyedRoom }
  /** The surveyed room could not be loaded; nothing of it is drawn. */
  | { readonly status: "failed"; readonly failure: SurveyedRoomFailure };

const IDLE: SurveyedRoomState = { status: "idle" };
const STARTING: SurveyedRoomState = { status: "loading", settled: 0, expected: null };

interface Held {
  /** The entry the state belongs to. */
  readonly key: string | null;
  readonly state: SurveyedRoomState;
}

/**
 * The surveyed room for a registry entry (null: none asked for). A new entry,
 * by its folder and revision rather than its identity, stops the load under
 * way and starts its own; the state of the room before is never shown for it.
 */
export function useSurveyedRoom(entry: SurveyedRoomEntry | null): SurveyedRoomState {
  const base = entry?.base ?? null;
  const revision = entry?.revision ?? null;
  const key = base === null || revision === null ? null : `${base}?r=${String(revision)}`;
  const [held, setHeld] = useState<Held>({ key: null, state: IDLE });

  useEffect(() => {
    if (base === null || revision === null || key === null) return undefined;
    const controller = new AbortController();
    const show = (state: SurveyedRoomState): void => {
      if (!controller.signal.aborted) setHeld({ key, state });
    };
    show(STARTING);
    const asked: SurveyedRoomEntry = { base, revision };
    loadSurveyedRoom(asked, controller.signal, (progress) => { show({ status: "loading", ...progress }); }).then(
      (room) => { show({ status: "ready", room }); },
      // An abort is this effect's own, and `show` then keeps quiet; anything else is a failure to tell.
      (error: unknown) => { show({ status: "failed", failure: error instanceof SurveyedRoomLoadError ? error.failure : unexpected(asked, error) }); },
    );
    return () => { controller.abort(); };
  }, [base, key, revision]);

  if (key === null) return IDLE;
  return held.key === key ? held.state : STARTING;
}
