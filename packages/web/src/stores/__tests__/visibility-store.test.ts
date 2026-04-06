import { describe, it, expect, beforeEach } from "vitest";
import {
  useVisibilityStore,
  isSurfaceVisible,
  getSurfaceOpacity,
  computeWallTargetOpacities,
  smoothstep,
  WALL_TRANSITION_SPEED,
  MAX_LERP_DELTA,
  AUTO_2_EDGES,
  AUTO_3_EDGES,
  type WallKey,
} from "../visibility-store.js";

// ---------------------------------------------------------------------------
// smoothstep — pure function
// ---------------------------------------------------------------------------

describe("smoothstep", () => {
  it("returns 0 when x is below edge0", () => {
    expect(smoothstep(-1, 0, 1)).toBe(0);
  });

  it("returns 1 when x is above edge1", () => {
    expect(smoothstep(2, 0, 1)).toBe(1);
  });

  it("returns 0.5 at the midpoint", () => {
    expect(smoothstep(0.5, 0, 1)).toBe(0.5);
  });

  it("returns 0 at edge0", () => {
    expect(smoothstep(0, 0, 1)).toBe(0);
  });

  it("returns 1 at edge1", () => {
    expect(smoothstep(1, 0, 1)).toBe(1);
  });

  it("produces smooth curve (derivative is 0 at edges)", () => {
    // Values near edges should change slowly (S-curve property)
    const nearZero = smoothstep(0.01, 0, 1);
    const nearOne = smoothstep(0.99, 0, 1);
    expect(nearZero).toBeLessThan(0.01); // Flatter than linear
    expect(nearOne).toBeGreaterThan(0.99);
  });
});

// ---------------------------------------------------------------------------
// computeWallTargetOpacities — pure function
// ---------------------------------------------------------------------------

describe("computeWallTargetOpacities", () => {
  // Room half-dims: W=21 (X axis), L=10 (Z axis). Fade zone = 3 units from wall.

  it("camera at center — all walls fully visible", () => {
    const o = computeWallTargetOpacities(0, 0, 3);
    expect(o["wall-front"]).toBe(1);
    expect(o["wall-back"]).toBe(1);
    expect(o["wall-left"]).toBe(1);
    expect(o["wall-right"]).toBe(1);
  });

  it("camera well inside room — all walls visible", () => {
    const o = computeWallTargetOpacities(5, 3, 3);
    expect(o["wall-front"]).toBe(1);
    expect(o["wall-back"]).toBe(1);
    expect(o["wall-left"]).toBe(1);
    expect(o["wall-right"]).toBe(1);
  });

  it("camera near right wall — right wall fades, others stay", () => {
    // At x=20, dist from right wall (21) = 1 unit → inside fade zone
    const o = computeWallTargetOpacities(20, 0, 3);
    expect(o["wall-right"]).toBeLessThan(0.5);
    expect(o["wall-left"]).toBe(1);
    expect(o["wall-front"]).toBe(1);
    expect(o["wall-back"]).toBe(1);
  });

  it("camera past right wall — right wall fully hidden", () => {
    const o = computeWallTargetOpacities(22, 0, 3);
    expect(o["wall-right"]).toBe(0);
  });

  it("camera near front wall — front wall fades", () => {
    const o = computeWallTargetOpacities(0, 9, 3);
    expect(o["wall-front"]).toBeLessThan(0.5);
    expect(o["wall-back"]).toBe(1);
  });

  it("camera in corner — two walls fade", () => {
    // Near right+front corner
    const o = computeWallTargetOpacities(20, 9, 3);
    expect(o["wall-right"]).toBeLessThan(0.5);
    expect(o["wall-front"]).toBeLessThan(0.5);
    expect(o["wall-left"]).toBe(1);
    expect(o["wall-back"]).toBe(1);
  });

  it("opacities are always in [0, 1] range", () => {
    const positions = [[0, 0], [25, 15], [-25, -15], [100, 100], [20, 9]];
    for (const [x, z] of positions) {
      const o = computeWallTargetOpacities(x ?? 0, z ?? 0, 3);
      for (const key of ["wall-front", "wall-back", "wall-left", "wall-right"] as WallKey[]) {
        expect(o[key]).toBeGreaterThanOrEqual(0);
        expect(o[key]).toBeLessThanOrEqual(1);
      }
    }
  });

  it("nearby positions produce similar opacities (no flickering)", () => {
    const a = computeWallTargetOpacities(19, 0, 3);
    const b = computeWallTargetOpacities(19.1, 0, 3);
    for (const key of ["wall-front", "wall-back", "wall-left", "wall-right"] as WallKey[]) {
      expect(Math.abs(a[key] - b[key])).toBeLessThan(0.1);
    }
  });
});

// ---------------------------------------------------------------------------
// getSurfaceOpacity — pure function
// ---------------------------------------------------------------------------

describe("getSurfaceOpacity", () => {
  const wallOpacity: Record<WallKey, number> = {
    "wall-front": 0.8,
    "wall-back": 1,
    "wall-left": 0,
    "wall-right": 0.3,
  };

  it("floor is always 1", () => {
    expect(getSurfaceOpacity("floor", wallOpacity, false, false)).toBe(1);
  });

  it("ceiling follows ceiling parameter", () => {
    expect(getSurfaceOpacity("ceiling", wallOpacity, true, false)).toBe(1);
    expect(getSurfaceOpacity("ceiling", wallOpacity, false, false)).toBe(0);
  });

  it("dome follows dome parameter", () => {
    expect(getSurfaceOpacity("dome", wallOpacity, false, true)).toBe(1);
    expect(getSurfaceOpacity("dome", wallOpacity, false, false)).toBe(0);
  });

  it("wall-front returns its opacity", () => {
    expect(getSurfaceOpacity("wall-front", wallOpacity, false, false)).toBe(0.8);
  });

  it("wall-left returns its opacity", () => {
    expect(getSurfaceOpacity("wall-left", wallOpacity, false, false)).toBe(0);
  });

  it("wainscot-front follows wall-front opacity", () => {
    expect(getSurfaceOpacity("wainscot-front", wallOpacity, false, false)).toBe(0.8);
  });

  it("wainscot-left follows wall-left opacity", () => {
    expect(getSurfaceOpacity("wainscot-left", wallOpacity, false, false)).toBe(0);
  });

  it("unknown surfaces default to 1", () => {
    expect(getSurfaceOpacity("unknown-mesh", wallOpacity, false, false)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// isSurfaceVisible — backward-compatible boolean check
// ---------------------------------------------------------------------------

describe("isSurfaceVisible", () => {
  const wallOpacity: Record<WallKey, number> = {
    "wall-front": 1,
    "wall-back": 1,
    "wall-left": 0,
    "wall-right": 0,
  };

  it("floor is always visible", () => {
    expect(isSurfaceVisible("floor", wallOpacity, false, false)).toBe(true);
  });

  it("ceiling follows ceiling parameter", () => {
    expect(isSurfaceVisible("ceiling", wallOpacity, true, false)).toBe(true);
    expect(isSurfaceVisible("ceiling", wallOpacity, false, false)).toBe(false);
  });

  it("dome follows dome parameter", () => {
    expect(isSurfaceVisible("dome", wallOpacity, false, true)).toBe(true);
    expect(isSurfaceVisible("dome", wallOpacity, false, false)).toBe(false);
  });

  it("wall with opacity 1 is visible", () => {
    expect(isSurfaceVisible("wall-front", wallOpacity, false, false)).toBe(true);
  });

  it("wall with opacity 0 is not visible", () => {
    expect(isSurfaceVisible("wall-left", wallOpacity, false, false)).toBe(false);
  });

  it("wainscot-front follows wall-front", () => {
    expect(isSurfaceVisible("wainscot-front", wallOpacity, false, false)).toBe(true);
  });

  it("wainscot-left follows wall-left", () => {
    expect(isSurfaceVisible("wainscot-left", wallOpacity, false, false)).toBe(false);
  });

  it("unknown surfaces default to visible", () => {
    expect(isSurfaceVisible("unknown-mesh", wallOpacity, false, false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Store — mode switching and wall updates
// ---------------------------------------------------------------------------

describe("useVisibilityStore", () => {
  beforeEach(() => {
    useVisibilityStore.setState({
      mode: "auto-2",
      walls: {
        "wall-front": false,
        "wall-back": true,
        "wall-left": true,
        "wall-right": false,
      },
      wallOpacity: {
        "wall-front": 0,
        "wall-back": 1,
        "wall-left": 1,
        "wall-right": 0,
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
    });
  });

  it("starts in auto-2 mode after reset (set by beforeEach)", () => {
    expect(useVisibilityStore.getState().mode).toBe("auto-2");
  });

  it("setMode changes mode", () => {
    useVisibilityStore.getState().setMode("auto-3");
    expect(useVisibilityStore.getState().mode).toBe("auto-3");
  });

  it("toggleWall locks wall off and snaps opacity to 0", () => {
    useVisibilityStore.getState().setMode("auto-3");
    useVisibilityStore.getState().toggleWall("wall-back"); // wall-back starts visible
    const state = useVisibilityStore.getState();
    expect(state.mode).toBe("auto-3"); // stays in auto — per-wall lock, not global
    expect(state.wallLocks["wall-back"]).toBe(true);
    expect(state.walls["wall-back"]).toBe(false);
    expect(state.wallOpacity["wall-back"]).toBe(0);
  });

  it("toggleWall again rebuilds wall (stays locked until animation completes)", () => {
    useVisibilityStore.getState().toggleWall("wall-back"); // lock off
    useVisibilityStore.getState().toggleWall("wall-back"); // rebuild (still locked)
    const state = useVisibilityStore.getState();
    expect(state.wallLocks["wall-back"]).toBe(true); // still locked during rebuild
    expect(state.walls["wall-back"]).toBe(true);
    expect(state.wallOpacity["wall-back"]).toBe(1);
  });

  it("unlockWall releases lock so auto resumes", () => {
    useVisibilityStore.getState().toggleWall("wall-back"); // lock off
    expect(useVisibilityStore.getState().wallLocks["wall-back"]).toBe(true);
    useVisibilityStore.getState().unlockWall("wall-back");
    expect(useVisibilityStore.getState().wallLocks["wall-back"]).toBe(false);
  });

  it("toggleWall sets opacity to 0 when hiding", () => {
    useVisibilityStore.getState().toggleWall("wall-back");
    const state = useVisibilityStore.getState();
    expect(state.walls["wall-back"]).toBe(false);
    expect(state.wallOpacity["wall-back"]).toBe(0);
  });

  it("toggleCeiling flips ceiling", () => {
    useVisibilityStore.getState().toggleCeiling();
    expect(useVisibilityStore.getState().ceiling).toBe(true);
    useVisibilityStore.getState().toggleCeiling();
    expect(useVisibilityStore.getState().ceiling).toBe(false);
  });

  it("toggleDome flips dome", () => {
    useVisibilityStore.getState().toggleDome();
    expect(useVisibilityStore.getState().dome).toBe(true);
  });

  it("toggleMenu opens and closes menu", () => {
    expect(useVisibilityStore.getState().menuOpen).toBe(false);
    useVisibilityStore.getState().toggleMenu();
    expect(useVisibilityStore.getState().menuOpen).toBe(true);
    useVisibilityStore.getState().toggleMenu();
    expect(useVisibilityStore.getState().menuOpen).toBe(false);
  });

  it("updateAutoWalls lerps opacity toward targets", () => {
    // Start with right=0. Camera near right wall (x=20) → right should fade.
    useVisibilityStore.setState({
      wallOpacity: { "wall-front": 1, "wall-back": 1, "wall-left": 1, "wall-right": 1 },
    });
    // Camera near right wall → right should decrease
    useVisibilityStore.getState().updateAutoWalls(20, 0, 0.016);
    const { wallOpacity } = useVisibilityStore.getState();
    expect(wallOpacity["wall-right"]).toBeLessThan(1);
    // Left wall is far away → stays at 1
    expect(wallOpacity["wall-left"]).toBe(1);
  });

  it("updateAutoWalls returns true while transitioning", () => {
    useVisibilityStore.setState({
      wallOpacity: { "wall-front": 0, "wall-back": 1, "wall-left": 1, "wall-right": 0 },
    });
    const transitioning = useVisibilityStore.getState().updateAutoWalls(-5, 3, 0.016);
    expect(transitioning).toBe(true);
  });

  it("updateAutoWalls returns false when converged", () => {
    // Set opacity to exactly match what the target would be
    const targets = computeWallTargetOpacities(5, 3, 2);
    useVisibilityStore.setState({ wallOpacity: { ...targets } });
    const transitioning = useVisibilityStore.getState().updateAutoWalls(5, 3, 0.016);
    expect(transitioning).toBe(false);
  });

  it("updateAutoWalls is no-op in manual mode", () => {
    useVisibilityStore.getState().setMode("manual");
    const opacityBefore = { ...useVisibilityStore.getState().wallOpacity };
    useVisibilityStore.getState().updateAutoWalls(5, 3, 0.016);
    expect(useVisibilityStore.getState().wallOpacity).toEqual(opacityBefore);
  });

  it("updateAutoWalls derives boolean walls from opacity", () => {
    // Set all opacity to 0, then update with camera position
    useVisibilityStore.setState({
      wallOpacity: { "wall-front": 0, "wall-back": 0, "wall-left": 0, "wall-right": 0 },
    });
    // Run many frames to converge
    for (let i = 0; i < 100; i++) {
      useVisibilityStore.getState().updateAutoWalls(5, 5, 0.016);
    }
    const { walls, wallOpacity } = useVisibilityStore.getState();
    // Walls with high opacity should have boolean true
    for (const key of ["wall-front", "wall-back", "wall-left", "wall-right"] as WallKey[]) {
      if (wallOpacity[key] > 0.5) {
        expect(walls[key]).toBe(true);
      } else {
        expect(walls[key]).toBe(false);
      }
    }
  });

  it("convergence: after many frames, opacity matches targets", () => {
    useVisibilityStore.setState({
      wallOpacity: { "wall-front": 0.5, "wall-back": 0.5, "wall-left": 0.5, "wall-right": 0.5 },
    });
    const targets = computeWallTargetOpacities(5, 3, 2);
    for (let i = 0; i < 200; i++) {
      useVisibilityStore.getState().updateAutoWalls(5, 3, 0.016);
    }
    const { wallOpacity } = useVisibilityStore.getState();
    for (const key of ["wall-front", "wall-back", "wall-left", "wall-right"] as WallKey[]) {
      expect(wallOpacity[key]).toBeCloseTo(targets[key], 1);
    }
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("visibility constants", () => {
  it("WALL_TRANSITION_SPEED is positive", () => {
    expect(WALL_TRANSITION_SPEED).toBeGreaterThan(0);
  });

  it("AUTO_2_EDGES has lower edge < upper edge", () => {
    expect(AUTO_2_EDGES[0]).toBeLessThan(AUTO_2_EDGES[1]);
  });

  it("AUTO_3_EDGES has lower edge < upper edge", () => {
    expect(AUTO_3_EDGES[0]).toBeLessThan(AUTO_3_EDGES[1]);
  });

  it("AUTO_3_EDGES are more lenient than AUTO_2_EDGES (lower threshold)", () => {
    expect(AUTO_3_EDGES[0]).toBeLessThan(AUTO_2_EDGES[0]);
  });

  it("MAX_LERP_DELTA is positive and reasonable", () => {
    expect(MAX_LERP_DELTA).toBeGreaterThan(0);
    expect(MAX_LERP_DELTA).toBeLessThanOrEqual(0.1);
  });
});

// ---------------------------------------------------------------------------
// Delta clamping — prevents instant jumps after idle
// ---------------------------------------------------------------------------

describe("delta clamping", () => {
  beforeEach(() => {
    useVisibilityStore.setState({
      mode: "auto-2",
      wallOpacity: { "wall-front": 0, "wall-back": 0, "wall-left": 0, "wall-right": 0 },
      walls: { "wall-front": false, "wall-back": false, "wall-left": false, "wall-right": false },
    });
  });

  it("large delta does not cause instant jump to target", () => {
    // All walls start at 0. Camera at center → all targets = 1.
    // Large delta should still clamp step.
    useVisibilityStore.getState().updateAutoWalls(0, 0, 2.0);
    const { wallOpacity } = useVisibilityStore.getState();
    const maxStep = WALL_TRANSITION_SPEED * MAX_LERP_DELTA;
    expect(wallOpacity["wall-front"]).toBeLessThanOrEqual(maxStep + 0.01);
  });

  it("normal delta (16ms) produces small opacity step", () => {
    useVisibilityStore.getState().updateAutoWalls(0, 0, 0.016);
    const { wallOpacity } = useVisibilityStore.getState();
    expect(wallOpacity["wall-front"]).toBeLessThan(0.15);
    expect(wallOpacity["wall-front"]).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Proximity-based wall hiding
// ---------------------------------------------------------------------------

describe("proximity wall behavior", () => {
  it("camera at front wall boundary — front wall hidden", () => {
    const o = computeWallTargetOpacities(0, 10, 3);
    expect(o["wall-front"]).toBe(0);
    expect(o["wall-back"]).toBe(1);
  });

  it("camera inside room near front wall — front wall fading", () => {
    const o = computeWallTargetOpacities(0, 8.5, 3);
    expect(o["wall-front"]).toBeLessThan(0.8);
    expect(o["wall-front"]).toBeGreaterThan(0);
  });

  it("camera far from all walls — all visible", () => {
    const o = computeWallTargetOpacities(0, 0, 3);
    expect(o["wall-front"]).toBe(1);
    expect(o["wall-back"]).toBe(1);
    expect(o["wall-left"]).toBe(1);
    expect(o["wall-right"]).toBe(1);
  });
});
