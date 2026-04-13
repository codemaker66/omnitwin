import { create } from "zustand";
import type { SpaceDimensions } from "@omnitwin/types";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../constants/scale.js";
import { useRoomDimensionsStore } from "./room-dimensions-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The 4 wall keys. */
export type WallKey = "wall-front" | "wall-back" | "wall-left" | "wall-right";

/** All togglable surface keys (walls + ceiling + dome). Floor is always visible. */
export type SurfaceKey = WallKey | "ceiling" | "dome";

/** Wall display mode. */
export type WallMode = "auto-2" | "auto-3" | "manual";

export const WALL_KEYS: readonly WallKey[] = [
  "wall-front",
  "wall-back",
  "wall-left",
  "wall-right",
];

export interface VisibilityState {
  /** Current wall display mode. */
  readonly mode: WallMode;
  /** Wall visibility booleans — derived from opacity in auto modes, user-controlled in manual. */
  readonly walls: Readonly<Record<WallKey, boolean>>;
  /** Per-wall opacity (0 = fully hidden, 1 = fully visible) for smooth transitions. */
  readonly wallOpacity: Readonly<Record<WallKey, number>>;
  /** Per-wall click locks. A locked wall ignores auto-show/hide from camera.
   *  First click locks it OFF, second click unlocks it back to auto. */
  readonly wallLocks: Readonly<Record<WallKey, boolean>>;
  /** Ceiling visibility (always manual). */
  readonly ceiling: boolean;
  /** Dome visibility (always manual). */
  readonly dome: boolean;
  /** Whether the menu panel is expanded. */
  readonly menuOpen: boolean;
  /** Set the wall display mode. */
  readonly setMode: (mode: WallMode) => void;
  /** Toggle a wall: first click hides + locks, second click rebuilds (stays locked until done). */
  readonly toggleWall: (key: WallKey) => void;
  /** Unlock a wall after rebuild animation completes so auto resumes. */
  readonly unlockWall: (key: WallKey) => void;
  /** Toggle ceiling visibility. */
  readonly toggleCeiling: () => void;
  /** Toggle dome visibility. */
  readonly toggleDome: () => void;
  /** Toggle menu open/closed. */
  readonly toggleMenu: () => void;
  /** Update auto walls based on camera position. Returns true if still transitioning. */
  readonly updateAutoWalls: (cameraX: number, cameraZ: number, delta: number) => boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Hermite smoothstep — smooth 0→1 transition between edge0 and edge1. */
export function smoothstep(x: number, edge0: number, edge1: number): number {
  if (edge0 === edge1) return x >= edge0 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Linear opacity transition speed (opacity units per second).
 *  At 1.5, a full 0→1 build takes ~0.67s — fast enough that walls are never
 *  stuck half-formed when the camera is at the "right" angle. */
export const WALL_TRANSITION_SPEED = 4.0;

/** Maximum delta (seconds) for opacity lerp — prevents instant jumps after idle frames. */
export const MAX_LERP_DELTA = 0.1;

/** Smoothstep edges for auto-2 mode — lenient, requires significant rotation before toggling.
 *  At [0.15, 0.55], walls stay visible across a wider camera range so they don't
 *  flicker with small movements. Looking straight at a wall: only that wall hides.
 *  At 45° corners: 2 walls comfortably visible. */
export const AUTO_2_EDGES: readonly [number, number] = [0.15, 0.55];

/** Smoothstep edges for auto-3 mode — walls disappear as soon as camera
 *  crosses to their side. Tight range for seamless transitions. */
export const AUTO_3_EDGES: readonly [number, number] = [-0.15, 0.15];

/** Distance (render-space units) from the wall plane where fade begins.
 *  A wall only starts fading when the camera is within this distance of it. */
const FADE_START = 1.0;
/** Distance past the wall plane where the wall is fully hidden.
 *  Negative = must go well PAST the wall before it fully disappears. */
const FADE_END = -6.0;

/**
 * Computes target opacity (0–1) for each wall based on camera position.
 *
 * A wall only hides when the camera is physically near that wall's boundary.
 * Standing inside the room (even off-center) keeps all walls visible.
 * Walls fade out smoothly as the camera approaches within FADE_START units
 * of the wall plane, and are fully hidden at/past the wall.
 *
 * @param roomDims - Current render-space room dimensions. Defaults to Grand
 *   Hall for backward compatibility with tests; production callers (updateAutoWalls)
 *   always pass the active room dimensions from useRoomDimensionsStore.
 */
export function computeWallTargetOpacities(
  cameraX: number,
  cameraZ: number,
  _count: 2 | 3,
  roomDims: SpaceDimensions = GRAND_HALL_RENDER_DIMENSIONS,
): Readonly<Record<WallKey, number>> {
  const halfRoomW = roomDims.width / 2;
  const halfRoomL = roomDims.length / 2;

  // Distance from each wall plane (positive = inside room, negative = outside)
  const distRight = halfRoomW - cameraX;  // + when inside, - when past right wall
  const distLeft = halfRoomW + cameraX;   // + when inside, - when past left wall
  const distFront = halfRoomL - cameraZ;  // + when inside, - when past front wall
  const distBack = halfRoomL + cameraZ;   // + when inside, - when past back wall

  return {
    "wall-right": smoothstep(distRight, FADE_END, FADE_START),
    "wall-left": smoothstep(distLeft, FADE_END, FADE_START),
    "wall-front": smoothstep(distFront, FADE_END, FADE_START),
    "wall-back": smoothstep(distBack, FADE_END, FADE_START),
  };
}

/**
 * Returns the opacity (0–1) for a named surface based on current store state.
 * Floor is always 1. Ceiling/dome are binary (0 or 1). Walls and wainscoting
 * use the continuous wallOpacity values for smooth transitions.
 */
export function getSurfaceOpacity(
  name: string,
  wallOpacity: Readonly<Record<WallKey, number>>,
  ceiling: boolean,
  dome: boolean,
): number {
  if (name === "floor") return 1;
  if (name === "ceiling") return ceiling ? 1 : 0;
  if (name === "dome") return dome ? 1 : 0;

  // Wainscoting follows its parent wall's opacity
  if (name.startsWith("wainscot-")) {
    const wallKey = name.replace("wainscot-", "wall-") as WallKey;
    return wallOpacity[wallKey];
  }

  // Direct wall lookup
  if (name in wallOpacity) {
    return wallOpacity[name as WallKey];
  }

  return 1;
}

/**
 * Backward-compatible boolean visibility check.
 * Returns true if the surface opacity is above the visibility threshold.
 */
export function isSurfaceVisible(
  name: string,
  wallOpacity: Readonly<Record<WallKey, number>>,
  ceiling: boolean,
  dome: boolean,
): boolean {
  return getSurfaceOpacity(name, wallOpacity, ceiling, dome) > 0.01;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useVisibilityStore = create<VisibilityState>()((set, get) => ({
  mode: "auto-3" as WallMode,
  walls: {
    "wall-front": true,
    "wall-back": true,
    "wall-left": true,
    "wall-right": true,
  },
  wallOpacity: {
    "wall-front": 1,
    "wall-back": 1,
    "wall-left": 1,
    "wall-right": 1,
  },
  wallLocks: {
    "wall-front": false,
    "wall-back": false,
    "wall-left": false,
    "wall-right": false,
  },
  ceiling: false,
  dome: false,
  menuOpen: false,

  setMode: (mode: WallMode) => {
    // Changing mode clears all locks
    set({
      mode,
      wallLocks: { "wall-front": false, "wall-back": false, "wall-left": false, "wall-right": false },
    });
  },

  toggleWall: (key: WallKey) => {
    const state = get();
    if (state.wallLocks[key]) {
      // Already locked (hidden) → stay locked while rebuilding (so BrickWall
      // animates instead of snapping). BrickWall will call unlockWall() once done.
      set({
        walls: { ...state.walls, [key]: true },
        wallOpacity: { ...state.wallOpacity, [key]: 1 },
      });
    } else {
      // Not locked → lock it OFF, hide it, auto can't bring it back
      set({
        wallLocks: { ...state.wallLocks, [key]: true },
        walls: { ...state.walls, [key]: false },
        wallOpacity: { ...state.wallOpacity, [key]: 0 },
      });
    }
  },

  unlockWall: (key: WallKey) => {
    set((state) => ({
      wallLocks: { ...state.wallLocks, [key]: false },
    }));
  },

  toggleCeiling: () => {
    set((state) => ({ ceiling: !state.ceiling }));
  },

  toggleDome: () => {
    set((state) => ({ dome: !state.dome }));
  },

  toggleMenu: () => {
    set((state) => ({ menuOpen: !state.menuOpen }));
  },

  updateAutoWalls: (cameraX: number, cameraZ: number, delta: number): boolean => {
    const state = get();
    if (state.mode === "manual") return false;
    const { wallLocks } = state;

    const count = state.mode === "auto-2" ? 2 : 3;
    const { dimensions } = useRoomDimensionsStore.getState();
    const targets = computeWallTargetOpacities(cameraX, cameraZ, count, dimensions);

    // Linear transition — uniform fade speed, no fast initial jump.
    // Clamp delta to prevent instant jumps after demand-mode idle frames.
    const clampedDelta = Math.min(delta, MAX_LERP_DELTA);
    const step = WALL_TRANSITION_SPEED * clampedDelta;
    const newOpacity: Record<WallKey, number> = {
      "wall-front": 0, "wall-back": 0, "wall-left": 0, "wall-right": 0,
    };
    let transitioning = false;

    for (const key of WALL_KEYS) {
      // Locked walls are click-controlled — auto doesn't touch them
      if (wallLocks[key]) {
        newOpacity[key] = state.wallOpacity[key];
        continue;
      }
      const current = state.wallOpacity[key];
      const target = targets[key];
      const diff = target - current;

      if (Math.abs(diff) < 0.005) {
        newOpacity[key] = target; // Snap when close enough
      } else if (diff > 0) {
        newOpacity[key] = Math.min(target, current + step);
        transitioning = true;
      } else {
        newOpacity[key] = Math.max(target, current - step);
        transitioning = true;
      }
    }

    // Only update store if opacity actually changed
    let changed = false;
    for (const key of WALL_KEYS) {
      if (Math.abs(newOpacity[key] - state.wallOpacity[key]) > 0.001) {
        changed = true;
        break;
      }
    }

    if (changed) {
      set({
        wallOpacity: newOpacity,
        walls: {
          "wall-front": newOpacity["wall-front"] > 0.5,
          "wall-back": newOpacity["wall-back"] > 0.5,
          "wall-left": newOpacity["wall-left"] > 0.5,
          "wall-right": newOpacity["wall-right"] > 0.5,
        },
      });
    }

    return transitioning;
  },
}));
