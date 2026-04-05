import { create } from "zustand";

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
  /** Ceiling visibility (always manual). */
  readonly ceiling: boolean;
  /** Dome visibility (always manual). */
  readonly dome: boolean;
  /** Whether the menu panel is expanded. */
  readonly menuOpen: boolean;
  /** Set the wall display mode. */
  readonly setMode: (mode: WallMode) => void;
  /** Toggle a specific wall (switches to manual mode). */
  readonly toggleWall: (key: WallKey) => void;
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
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Linear opacity transition speed (opacity units per second).
 *  At 1.5, a full 0→1 build takes ~0.67s — fast enough that walls are never
 *  stuck half-formed when the camera is at the "right" angle. */
export const WALL_TRANSITION_SPEED = 1.5;

/** Maximum delta (seconds) for opacity lerp — prevents instant jumps after idle frames. */
export const MAX_LERP_DELTA = 0.1;

/** Smoothstep edges for auto-2 mode — lenient, requires significant rotation before toggling.
 *  At [0.15, 0.55], walls stay visible across a wider camera range so they don't
 *  flicker with small movements. Looking straight at a wall: only that wall hides.
 *  At 45° corners: 2 walls comfortably visible. */
export const AUTO_2_EDGES: readonly [number, number] = [0.15, 0.55];

/** Smoothstep edges for auto-3 mode — lenient, typically 2–3 walls visible. */
export const AUTO_3_EDGES: readonly [number, number] = [-0.7, 0.0];

/**
 * Computes target opacity (0–1) for each wall based on camera position.
 *
 * Uses the normalized camera direction from the room center to determine
 * which walls are "behind" the camera (should be hidden) vs visible.
 *
 * The smoothstep function creates gradual transitions as the camera rotates,
 * preventing the jarring binary wall flips that occur with discrete sorting.
 *
 * Key behavior:
 * - When camera is aligned with one axis, only the far wall is visible
 * - At 45° angles, two walls are visible (the two the camera can see into)
 * - Transitions are smooth — no flickering near axis boundaries
 */
export function computeWallTargetOpacities(
  cameraX: number,
  cameraZ: number,
  count: 2 | 3,
): Readonly<Record<WallKey, number>> {
  const dist = Math.sqrt(cameraX * cameraX + cameraZ * cameraZ);

  if (dist < 0.01) {
    // Camera at center — all walls fully visible
    return { "wall-front": 1, "wall-back": 1, "wall-left": 1, "wall-right": 1 };
  }

  const nx = cameraX / dist;
  const nz = cameraZ / dist;

  // "Hide score" per wall — positive means camera is on that wall's side
  // (closer to it → should be hidden). Range: -1 to +1.
  const hideScores: Readonly<Record<WallKey, number>> = {
    "wall-right": nx,
    "wall-left": -nx,
    "wall-front": nz,
    "wall-back": -nz,
  };

  const [edge0, edge1] = count === 2 ? AUTO_2_EDGES : AUTO_3_EDGES;

  // Convert hide score to visibility using smoothstep.
  // -hideScore: high when camera is FAR from the wall (should be visible).
  // smoothstep: values above edge1 → 1 (visible), below edge0 → 0 (hidden).
  return {
    "wall-front": smoothstep(-hideScores["wall-front"], edge0, edge1),
    "wall-back": smoothstep(-hideScores["wall-back"], edge0, edge1),
    "wall-left": smoothstep(-hideScores["wall-left"], edge0, edge1),
    "wall-right": smoothstep(-hideScores["wall-right"], edge0, edge1),
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
  ceiling: false,
  dome: false,
  menuOpen: false,

  setMode: (mode: WallMode) => {
    set({ mode });
  },

  toggleWall: (key: WallKey) => {
    const state = get();
    const newVisible = !state.walls[key];
    set({
      mode: "manual" as WallMode,
      walls: { ...state.walls, [key]: newVisible },
      wallOpacity: { ...state.wallOpacity, [key]: newVisible ? 1 : 0 },
    });
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

    const count = state.mode === "auto-2" ? 2 : 3;
    const targets = computeWallTargetOpacities(cameraX, cameraZ, count);

    // Linear transition — uniform fade speed, no fast initial jump.
    // Clamp delta to prevent instant jumps after demand-mode idle frames.
    const clampedDelta = Math.min(delta, MAX_LERP_DELTA);
    const step = WALL_TRANSITION_SPEED * clampedDelta;
    const newOpacity: Record<WallKey, number> = {
      "wall-front": 0, "wall-back": 0, "wall-left": 0, "wall-right": 0,
    };
    let transitioning = false;

    for (const key of WALL_KEYS) {
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

    // Derive booleans from opacity (for UI checkboxes and compat)
    const newWalls: Record<WallKey, boolean> = {
      "wall-front": newOpacity["wall-front"] > 0.5,
      "wall-back": newOpacity["wall-back"] > 0.5,
      "wall-left": newOpacity["wall-left"] > 0.5,
      "wall-right": newOpacity["wall-right"] > 0.5,
    };

    // Only update store if opacity actually changed
    let changed = false;
    for (const key of WALL_KEYS) {
      if (Math.abs(newOpacity[key] - state.wallOpacity[key]) > 0.001) {
        changed = true;
        break;
      }
    }

    if (changed) {
      set({ wallOpacity: newOpacity, walls: newWalls });
    }

    return transitioning;
  },
}));
