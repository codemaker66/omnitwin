// ---------------------------------------------------------------------------
// Layout Recall (goal 03, S5): a saved layout that opens assembles itself.
//
// This small module loads with the planner; the Assembly itself loads only
// where this device asks for it (flag.ts). It watches the editor store for a
// saved layout finishing its load and, where the Assembly is asked for, holds
// the room empty at once (floor/presentation-channel.ts), so the furniture is
// never seen before it is summoned. The Assembly (GrandAssembly.tsx) takes the
// hold over once the drawn Grand Hall is there to play in. If the room turns
// out to be another one, or nothing takes the hold over in time, the
// furniture is let go as placed: a hold can never hide a layout for good.
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
}

export const useAssemblyRecallStore = create<RecallState>()(() => ({ request: null, active: false }));

/** The empty room: every piece hidden while the room is readied. */
export const EMPTY_ROOM: PresentationFrame = { pieces: new Map(), others: "hidden" };

/** The longest a hold waits for the Assembly to take it over, ms. */
export const HOLD_LIMIT_MS = 5000;

let holdTimer: ReturnType<typeof setTimeout> | null = null;
let nonce = 0;
/** Whether this device asks for the Assembly (set by the planner while it is mounted). */
let asked = false;
/** The layout last announced, so a reload of the same layout (a save conflict) does not replay it. */
let announced: string | null = null;
/** A layout that finished loading before the planner said whether it asks for the Assembly. */
let unannounced: string | null = null;

function clearHoldTimer(): void {
  if (holdTimer !== null) clearTimeout(holdTimer);
  holdTimer = null;
}

/** Hold the room empty until the Assembly takes it over, or for HOLD_LIMIT_MS at most. */
export function holdRoomEmpty(): void {
  clearHoldTimer();
  publishFurniturePresentation(EMPTY_ROOM);
  holdTimer = setTimeout(() => {
    holdTimer = null;
    releaseHold();
    useAssemblyRecallStore.setState({ request: null });
  }, HOLD_LIMIT_MS);
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

/** The Assembly has taken up (or turned down) this request. */
export function consumeAssemblyRequest(request: AssemblyRequest): void {
  if (useAssemblyRecallStore.getState().request?.nonce === request.nonce) useAssemblyRecallStore.setState({ request: null });
}

/**
 * The planner's side of Layout Recall. `wanted`: this device asks for the
 * Assembly. `stage`: the drawn Grand Hall is there to play in (the Assembly
 * is mounted). `elsewhere`: the open room is known not to be one it plays in.
 */
export function useAssemblyRecall(wanted: boolean, stage: boolean, elsewhere: boolean): void {
  useEffect(() => {
    if (!wanted) return undefined;
    asked = true;
    // A layout that finished loading before the planner was told.
    if (unannounced !== null && unannounced === useEditorStore.getState().configId) announce(unannounced);
    return () => {
      asked = false;
      // Leaving the planner: the next time it opens a layout, that is an opening again.
      announced = null;
      unannounced = null;
      releaseHold();
      useAssemblyRecallStore.setState({ request: null, active: false });
    };
  }, [wanted]);

  useEffect(() => {
    if (!wanted || stage || !elsewhere) return;
    // Not a room the Assembly plays in: the layout is shown as placed.
    releaseHold();
    useAssemblyRecallStore.setState({ request: null });
  }, [elsewhere, stage, wanted]);
}

/** Tests: forget every opening and hold. */
export function resetAssemblyRecallForTests(): void {
  clearHoldTimer();
  asked = false;
  announced = null;
  unannounced = null;
  nonce = 0;
  publishFurniturePresentation(null);
  useAssemblyRecallStore.setState({ request: null, active: false });
}
