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
  describe("auto-2 mode", () => {
    it("camera at +X,+Z (31°) shows back wall, side walls hidden with tight edges", () => {
      const opacities = computeWallTargetOpacities(5, 3, 2);
      // Back wall: -hideScore ≈ 0.51 → near edge boundary
      expect(opacities["wall-back"]).toBeGreaterThan(0);
      // Front and right are behind camera → hidden
      expect(opacities["wall-front"]).toBeLessThan(0.1);
    });

    it("camera at -X,-Z (31°) shows front wall, side walls hidden with tight edges", () => {
      const opacities = computeWallTargetOpacities(-5, -3, 2);
      expect(opacities["wall-front"]).toBeGreaterThan(0);
      expect(opacities["wall-back"]).toBeLessThan(0.1);
    });

    it("camera aligned with +Z axis shows only back wall", () => {
      const opacities = computeWallTargetOpacities(0, 5, 2);
      expect(opacities["wall-back"]).toBeGreaterThan(0.9);
      expect(opacities["wall-front"]).toBeLessThan(0.1);
      // Perpendicular walls hidden when aligned
      expect(opacities["wall-left"]).toBeLessThan(0.1);
      expect(opacities["wall-right"]).toBeLessThan(0.1);
    });

    it("camera aligned with +X axis shows only left wall", () => {
      const opacities = computeWallTargetOpacities(5, 0, 2);
      expect(opacities["wall-left"]).toBeGreaterThan(0.9);
      expect(opacities["wall-right"]).toBeLessThan(0.1);
      expect(opacities["wall-front"]).toBeLessThan(0.1);
      expect(opacities["wall-back"]).toBeLessThan(0.1);
    });

    it("camera at origin returns all walls visible", () => {
      const opacities = computeWallTargetOpacities(0, 0, 2);
      expect(opacities["wall-front"]).toBe(1);
      expect(opacities["wall-back"]).toBe(1);
      expect(opacities["wall-left"]).toBe(1);
      expect(opacities["wall-right"]).toBe(1);
    });

    it("diagonal camera shows exactly 2 walls at full opacity", () => {
      // At 45°, two walls should be fully visible
      const opacities = computeWallTargetOpacities(5, 5, 2);
      const fullyVisible = Object.values(opacities).filter((o) => o > 0.9).length;
      expect(fullyVisible).toBe(2);
    });
  });

  describe("auto-3 mode", () => {
    it("camera strongly on +X axis shows left, front, and back walls", () => {
      // nx ≈ 1, nz ≈ 0.1 — perpendicular walls should appear with auto-3 edges
      const opacities = computeWallTargetOpacities(10, 1, 3);
      expect(opacities["wall-left"]).toBeGreaterThan(0.9);
      expect(opacities["wall-right"]).toBeLessThan(0.1);
      // Perpendicular walls should be at least partially visible
      expect(opacities["wall-back"]).toBeGreaterThan(0.3);
    });

    it("auto-3 shows more walls than auto-2 for same position", () => {
      const auto2 = computeWallTargetOpacities(5, 3, 2);
      const auto3 = computeWallTargetOpacities(5, 3, 3);
      const sum2 = Object.values(auto2).reduce((a, b) => a + b, 0);
      const sum3 = Object.values(auto3).reduce((a, b) => a + b, 0);
      expect(sum3).toBeGreaterThanOrEqual(sum2);
    });
  });

  describe("smooth transitions", () => {
    it("nearby camera positions produce similar opacities (no flickering)", () => {
      const a = computeWallTargetOpacities(5, 3, 2);
      const b = computeWallTargetOpacities(5, 3.1, 2);
      // Small camera movement → small opacity change (tighter edges = steeper transition)
      for (const key of ["wall-front", "wall-back", "wall-left", "wall-right"] as WallKey[]) {
        expect(Math.abs(a[key] - b[key])).toBeLessThan(0.15);
      }
    });

    it("opacities are always in [0, 1] range", () => {
      const positions = [[5, 3], [-5, 3], [0, 10], [10, 0], [0.01, 0.01], [100, 1]];
      for (const [x, z] of positions) {
        const opacities = computeWallTargetOpacities(x ?? 0, z ?? 0, 2);
        for (const key of ["wall-front", "wall-back", "wall-left", "wall-right"] as WallKey[]) {
          expect(opacities[key]).toBeGreaterThanOrEqual(0);
          expect(opacities[key]).toBeLessThanOrEqual(1);
        }
      }
    });
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
      ceiling: false,
      dome: false,
      menuOpen: false,
    });
  });

  it("defaults to auto-2 mode", () => {
    expect(useVisibilityStore.getState().mode).toBe("auto-2");
  });

  it("setMode changes mode", () => {
    useVisibilityStore.getState().setMode("auto-3");
    expect(useVisibilityStore.getState().mode).toBe("auto-3");
  });

  it("toggleWall switches to manual mode and snaps opacity", () => {
    useVisibilityStore.getState().toggleWall("wall-front");
    const state = useVisibilityStore.getState();
    expect(state.mode).toBe("manual");
    expect(state.walls["wall-front"]).toBe(true);
    expect(state.wallOpacity["wall-front"]).toBe(1);
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
    // Start with left=1, right=0. Move camera to -X to reverse.
    useVisibilityStore.setState({
      wallOpacity: { "wall-front": 0, "wall-back": 1, "wall-left": 1, "wall-right": 0 },
    });
    // Camera at -X,+Z — left should hide, right should show
    useVisibilityStore.getState().updateAutoWalls(-5, 3, 0.016);
    const { wallOpacity } = useVisibilityStore.getState();
    // After one frame, left should have decreased (moving toward 0)
    expect(wallOpacity["wall-left"]).toBeLessThan(1);
    // Right should have increased (moving toward 1)
    expect(wallOpacity["wall-right"]).toBeGreaterThan(0);
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
    // Simulate a 2-second idle frame
    useVisibilityStore.getState().updateAutoWalls(5, 5, 2.0);
    const { wallOpacity } = useVisibilityStore.getState();
    // With delta clamping, max step per frame is limited (linear: speed * clampedDelta)
    // wall-left and wall-back should be targets (1), but opacity should not reach 1 in one step
    const maxStep = WALL_TRANSITION_SPEED * MAX_LERP_DELTA;
    expect(wallOpacity["wall-left"]).toBeLessThanOrEqual(maxStep + 0.01);
    expect(wallOpacity["wall-back"]).toBeLessThanOrEqual(maxStep + 0.01);
  });

  it("normal delta (16ms) produces small opacity step", () => {
    useVisibilityStore.getState().updateAutoWalls(5, 5, 0.016);
    const { wallOpacity } = useVisibilityStore.getState();
    // Should be a small step, not a jump
    expect(wallOpacity["wall-left"]).toBeLessThan(0.15);
    expect(wallOpacity["wall-left"]).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Aligned camera — only far wall visible
// ---------------------------------------------------------------------------

describe("aligned camera behavior", () => {
  it("perfectly aligned with +Z axis shows only back wall (auto-2)", () => {
    const opacities = computeWallTargetOpacities(0, 10, 2);
    expect(opacities["wall-back"]).toBe(1);
    expect(opacities["wall-front"]).toBe(0);
    expect(opacities["wall-left"]).toBe(0);
    expect(opacities["wall-right"]).toBe(0);
  });

  it("nearly aligned (~5°) still shows only back wall", () => {
    // 5° off-axis: sin(5°) ≈ 0.087
    const opacities = computeWallTargetOpacities(0.087, 1, 2);
    expect(opacities["wall-back"]).toBeGreaterThan(0.9);
    // Side walls should still be hidden within the margin
    expect(opacities["wall-left"]).toBeLessThan(0.1);
    expect(opacities["wall-right"]).toBeLessThan(0.1);
  });

  it("significantly off-axis (~40°) shows second wall fading in", () => {
    // 40° off-axis: sin(40°) ≈ 0.64, cos(40°) ≈ 0.77
    const opacities = computeWallTargetOpacities(0.64, 0.77, 2);
    expect(opacities["wall-back"]).toBeGreaterThan(0.5);
    // Side wall should be partially visible (0.64 is between edges [0.5, 0.65])
    expect(opacities["wall-left"]).toBeGreaterThan(0.1);
  });
});
