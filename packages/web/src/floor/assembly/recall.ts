// ---------------------------------------------------------------------------
// Layout Recall (goal 03, S5): a saved layout that opens assembles itself.
//
// This small module loads with the planner; the Assembly itself loads only
// where it may play (flag.ts: by default, the first time a layout opens on
// this device). It watches the editor store for a saved layout finishing its
// load and, unless this device has already seen that layout, holds the room
// empty at once (floor/presentation-channel.ts), so the furniture is never
// seen before it is summoned. The Assembly (GrandAssembly.tsx) takes the hold
// over once the drawn Grand Hall is there to play in. If the room turns out
// to be another one, or nothing takes the hold over in time, the furniture is
// let go as placed: a hold can never hide a layout for good.
// ---------------------------------------------------------------------------

import { useEffect } from "react";
import { create } from "zustand";
import { useEditorStore } from "../../stores/editor-store.js";
import {
  currentFurniturePresentation,
  publishFurniturePresentation,
  type PresentationFrame,
} from "../presentation-channel.js";

export interface AssemblyRequest {
  readonly nonce: number;
  /** The layout that opened, or null for a replay of whatever is open. */
  readonly configId: string | null;
  readonly reason: "open" | "replay";
}

interface RecallState {
  /** A layout opened, or a replay asked for, that the Assembly has not yet taken up. */
  readonly request: AssemblyRequest | null;
  /** Whether the Assembly is holding the room or playing now. */
  readonly active: boolean;
  /** Whether the Skip has sped the show up. */
  readonly fast: boolean;
  /** Bumped to send the show straight to its end (the Skip's second press). */
  readonly skipNonce: number;
  /** When the Assembly last gave the room back (`performance.now()`): the control settles at rest from here. */
  readonly restedAt: number;
}

export const useAssemblyRecallStore = create<RecallState>()(() => ({
  request: null, active: false, fast: false, skipNonce: 0, restedAt: Number.NEGATIVE_INFINITY,
}));

/** Layouts this device has watched assemble, or furnished itself: the first-open rule passes them by. */
const SEEN_KEY = "venviewer.assembly.seen";
/** The most layouts the device remembers (the oldest are forgotten first). */
const SEEN_LIMIT = 200;

function readSeen(): string[] {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Whether this device has already seen this layout assemble, or furnished it itself. */
export function hasSeenLayout(configId: string): boolean {
  return readSeen().includes(configId);
}

/** Remember that this device has seen this layout: by default it then opens as placed. */
export function markLayoutSeen(configId: string): void {
  const seen = readSeen().filter((id) => id !== configId);
  seen.push(configId);
  try { window.localStorage.setItem(SEEN_KEY, JSON.stringify(seen.slice(-SEEN_LIMIT))); } catch { /* a convenience only */ }
}

/** The empty room: every piece hidden while the room is readied. */
export const EMPTY_ROOM: PresentationFrame = { pieces: new Map(), others: "hidden" };

/** The longest a hold waits for the Assembly to take it over once nothing it needs is still on its way, ms. */
export const HOLD_LIMIT_MS = 8000;

/**
 * The longest a hold waits in all while the Assembly's stage or code is still
 * on its way, ms. A phone's cold first load can take longer than HOLD_LIMIT_MS
 * to draw the hall and fetch the Assembly, and letting the hold lapse then
 * would drop the Assembly with it.
 */
export const HOLD_CAP_MS = 45_000;

let holdTimer: ReturnType<typeof setTimeout> | null = null;
/** When the current hold began (Date.now()). */
let holdSince = 0;
/** Whether the Assembly's stage or code is still on its way (set by the planner). */
let stageComing = false;
let nonce = 0;
/** Whether this device asks for the Assembly (set by the planner while it is mounted). */
let asked = false;
/** Whether a layout plays on every open here, seen or not (`?assembly=accio`; set by the planner). */
let playsEveryOpen = false;
/** The layout last announced, so a reload of the same layout (a save conflict) does not replay it. */
let announced: string | null = null;
/** A layout that finished loading before the planner said whether it asks for the Assembly. */
let unannounced: string | null = null;

function clearHoldTimer(): void {
  if (holdTimer !== null) clearTimeout(holdTimer);
  holdTimer = null;
}

/** Let the hold lapse after `ms`, unless the Assembly's stage or code is still on its way (up to HOLD_CAP_MS). */
function armHoldTimer(ms: number): void {
  holdTimer = setTimeout(() => {
    holdTimer = null;
    const waited = Date.now() - holdSince;
    if (stageComing && waited < HOLD_CAP_MS) {
      armHoldTimer(Math.min(HOLD_LIMIT_MS, HOLD_CAP_MS - waited));
      return;
    }
    releaseHold();
    useAssemblyRecallStore.setState({ request: null });
  }, ms);
}

/** Hold the room empty until the Assembly takes it over, or for HOLD_LIMIT_MS once nothing is on its way. */
export function holdRoomEmpty(): void {
  clearHoldTimer();
  publishFurniturePresentation(EMPTY_ROOM);
  holdSince = Date.now();
  armHoldTimer(HOLD_LIMIT_MS);
}

function setStageComing(next: boolean): void {
  if (stageComing === next) return;
  stageComing = next;
  // Everything has arrived: the Assembly gets the whole limit from now to take the hold over.
  if (!next && holdTimer !== null) {
    clearHoldTimer();
    armHoldTimer(HOLD_LIMIT_MS);
  }
}

/** The Assembly owns the room from here: the hold no longer lapses on its own. */
export function takeHold(): void {
  clearHoldTimer();
}

/** Let the furniture go as placed, if it is only being held. */
export function releaseHold(): void {
  clearHoldTimer();
  if (currentFurniturePresentation() === EMPTY_ROOM) publishFurniturePresentation(null);
}

function announce(configId: string): void {
  announced = configId;
  unannounced = null;
  // The first-open rule: a layout this device has already seen opens as placed.
  if (!playsEveryOpen && hasSeenLayout(configId)) return;
  nonce += 1;
  useAssemblyRecallStore.setState({ request: { nonce, configId, reason: "open" } });
  holdRoomEmpty();
}

type EditorState = ReturnType<typeof useEditorStore.getState>;

/** A saved layout has just finished loading with something in it. */
function layoutOpened(state: EditorState, previous: EditorState): string | null {
  if (state.configId === null || state.isLoading || state.error !== null || state.objects.length === 0) return null;
  if (!previous.isLoading && previous.configId === state.configId) return null;
  return state.configId;
}

useEditorStore.subscribe((state, previous) => {
  // This device furnished the layout itself (a save of this same layout went through with pieces in it).
  if (previous.isDirty && !state.isDirty && !previous.isLoading && !state.isLoading
    && state.configId !== null && state.configId === previous.configId && state.objects.length > 0) {
    markLayoutSeen(state.configId);
  }
  const opened = layoutOpened(state, previous);
  if (opened === null || opened === announced) return;
  if (asked) announce(opened);
  else unannounced = opened;
});

/** Ask for the Assembly again over the layout that is open (the replay control). */
export function requestAssemblyReplay(): void {
  nonce += 1;
  useAssemblyRecallStore.setState({ request: { nonce, configId: useEditorStore.getState().configId, reason: "replay" } });
}

/** The Skip, first press: the show plays on, at speed. */
export function speedUpAssembly(): void {
  if (useAssemblyRecallStore.getState().active) useAssemblyRecallStore.setState({ fast: true });
}

/** The Skip, second press: the show goes straight to its end. */
export function skipAssemblyToEnd(): void {
  useAssemblyRecallStore.setState((state) => ({ skipNonce: state.skipNonce + 1 }));
}

/** The Assembly has taken up (or turned down) this request. */
export function consumeAssemblyRequest(request: AssemblyRequest): void {
  if (useAssemblyRecallStore.getState().request?.nonce === request.nonce) useAssemblyRecallStore.setState({ request: null });
}

/**
 * The planner's side of Layout Recall. `wanted`: this device asks for the
 * Assembly. `stage`: the drawn Grand Hall is there to play in (the Assembly
 * is mounted). `elsewhere`: the open room is known not to be one it plays in.
 * `coming`: the Assembly may still play here, but its stage or its code is
 * still on its way, so a hold waits for it (up to HOLD_CAP_MS). `always`: a
 * layout plays on every open here, seen or not.
 */
export function useAssemblyRecall(wanted: boolean, stage: boolean, elsewhere: boolean, coming = false, always = false): void {
  useEffect(() => {
    if (!wanted) return undefined;
    asked = true;
    playsEveryOpen = always;
    // A layout that finished loading before the planner was told, or before
    // this module was even loaded (the planner's code arrives after the layout).
    const open = useEditorStore.getState();
    const loaded = open.configId !== null && !open.isLoading && open.error === null && open.objects.length > 0;
    if (loaded && open.configId !== announced) announce(open.configId);
    else if (unannounced !== null && unannounced === open.configId) announce(unannounced);
    return () => {
      asked = false;
      playsEveryOpen = false;
      stageComing = false;
      // Leaving the planner: the next time it opens a layout, that is an opening again.
      announced = null;
      unannounced = null;
      releaseHold();
      useAssemblyRecallStore.setState({ request: null, active: false, fast: false });
    };
  }, [always, wanted]);

  useEffect(() => {
    if (!wanted || stage || !elsewhere) return;
    // Not a room the Assembly plays in: the layout is shown as placed.
    releaseHold();
    useAssemblyRecallStore.setState({ request: null });
  }, [elsewhere, stage, wanted]);

  useEffect(() => {
    setStageComing(wanted && coming);
  }, [coming, wanted]);
}

/** Tests: forget every opening and hold. */
export function resetAssemblyRecallForTests(): void {
  clearHoldTimer();
  holdSince = 0;
  stageComing = false;
  asked = false;
  playsEveryOpen = false;
  announced = null;
  unannounced = null;
  nonce = 0;
  try { window.localStorage.removeItem(SEEN_KEY); } catch { /* none to forget */ }
  publishFurniturePresentation(null);
  useAssemblyRecallStore.setState({ request: null, active: false, fast: false, skipNonce: 0, restedAt: Number.NEGATIVE_INFINITY });
}
