import { create } from "zustand";
import type { DoorClearSpace } from "../lib/door-clear-spaces.js";

// ---------------------------------------------------------------------------
// The open room's door clear spaces (lib/door-clear-spaces), for whatever
// keeps them clear: set from the planner's room (use-planner-room-dimensions)
// as the room's size is. A room whose doors are not recorded has none and
// `recorded` false, so nothing claims its doors were kept clear.
//
// Also whether a hand is carrying furniture (SelectionSystem), so the floor
// shows the spaces only while placing or carrying, and the pieces just slid
// clear of a door, for the motion layer to carry from where they were set down.
// ---------------------------------------------------------------------------

interface DoorClearSpaceState {
  readonly spaces: readonly DoorClearSpace[];
  readonly recorded: boolean;
  readonly carrying: boolean;
  /** The open room's spaces, or null when its doors are not recorded. */
  readonly setRoomSpaces: (spaces: readonly DoorClearSpace[] | null) => void;
  readonly setCarrying: (carrying: boolean) => void;
}

const NONE: readonly DoorClearSpace[] = [];

export const useDoorClearSpaceStore = create<DoorClearSpaceState>()((set, get) => ({
  spaces: NONE,
  recorded: false,
  carrying: false,
  setRoomSpaces: (spaces) => {
    const next = spaces ?? NONE;
    if (get().spaces === next && get().recorded === (spaces !== null)) return;
    set({ spaces: next, recorded: spaces !== null });
  },
  setCarrying: (carrying) => {
    if (get().carrying !== carrying) set({ carrying });
  },
}));

/** Pieces moved clear of a door by (dx, dz) render units: drawn from where they were set down, they slide out. */
export interface DoorSlideEvent {
  readonly ids: readonly string[];
  readonly dx: number;
  readonly dz: number;
}

type DoorSlideListener = (event: DoorSlideEvent) => void;

const slideListeners = new Set<DoorSlideListener>();

/** Hear each slide clear of a door. Returns the unsubscribe. */
export function subscribeDoorSlides(listener: DoorSlideListener): () => void {
  slideListeners.add(listener);
  return () => { slideListeners.delete(listener); };
}

/** Tell the motion layer pieces were just moved clear of a door. */
export function announceDoorSlide(event: DoorSlideEvent): void {
  if (event.ids.length === 0 || (event.dx === 0 && event.dz === 0)) return;
  for (const listener of slideListeners) listener(event);
}
