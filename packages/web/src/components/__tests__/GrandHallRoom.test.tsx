import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { FrontSide } from "three";
import {
  computeRoomSurfaces,
  computeWainscotingSurfaces,
  isSurfaceClippable,
  GRAND_HALL_SURFACES,
  GRAND_HALL_WAINSCOTING,
  DOME_RADIUS,
  DOME_RECESS_DEPTH,
  type RoomSurface,
} from "../GrandHallRoom.js";
import {
  FLOOR_COLOR, WALL_COLOR, CEILING_COLOR,
  WAINSCOT_COLOR, WAINSCOT_HEIGHT,
  DOME_COLOR,
} from "../../constants/colors.js";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";

// ---------------------------------------------------------------------------
// Mock R3F — happy-dom has no WebGL context
// ---------------------------------------------------------------------------

const CanvasMock = vi.hoisted(() =>
  vi.fn(({ children }: { children?: React.ReactNode }) => (
    <div data-testid="r3f-canvas">{children}</div>
  )),
);

vi.mock("@react-three/fiber", () => ({
  Canvas: CanvasMock,
  useThree: () => ({
    camera: {
      position: { x: 0, y: 0, z: 0, set: vi.fn(), copy: vi.fn() },
      quaternion: { setFromEuler: vi.fn() },
      lookAt: vi.fn(),
    },
    gl: { domElement: document.createElement("canvas") },
    invalidate: vi.fn(),
    // CameraRig reads size for aspect-aware pose; stub desktop viewport.
    size: { width: 1440, height: 900 },
  }),
  useFrame: vi.fn(),
}));

vi.mock("@react-three/drei", () => ({
  OrbitControls: vi.fn(() => null),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

// Import App after mock is registered
const { App } = await import("../../App.js");

// ---------------------------------------------------------------------------
// Helper — find a surface by name
// ---------------------------------------------------------------------------

function findSurface(surfaces: readonly RoomSurface[], name: string): RoomSurface {
  const surface = surfaces.find((s) => s.name === name);
  if (surface === undefined) {
    throw new Error(`Surface "${name}" not found`);
  }
  return surface;
}

// ---------------------------------------------------------------------------
// Pure geometry tests — computeRoomSurfaces
// ---------------------------------------------------------------------------

describe("computeRoomSurfaces", () => {
  const dimensions = { width: 10, length: 8, height: 4 };
  const surfaces = computeRoomSurfaces(dimensions);

  it("returns exactly 6 surfaces", () => {
    expect(surfaces).toHaveLength(6);
  });

  it("returns surfaces named floor, ceiling, wall-back, wall-front, wall-left, wall-right", () => {
    const names = surfaces.map((s) => s.name).sort();
    expect(names).toEqual(["ceiling", "floor", "wall-back", "wall-front", "wall-left", "wall-right"]);
  });

  // --- Floor ---

  it("positions the floor at y=0 (ground level)", () => {
    const floor = findSurface(surfaces, "floor");
    expect(floor.position[1]).toBe(0);
  });

  it("sizes the floor to width × length", () => {
    const floor = findSurface(surfaces, "floor");
    expect(floor.size).toEqual([10, 8]);
  });

  it("rotates the floor -90° around X so normal faces up", () => {
    const floor = findSurface(surfaces, "floor");
    expect(floor.rotation[0]).toBeCloseTo(-Math.PI / 2);
    expect(floor.rotation[1]).toBe(0);
    expect(floor.rotation[2]).toBe(0);
  });

  it("assigns floor colour", () => {
    const floor = findSurface(surfaces, "floor");
    expect(floor.color).toBe(FLOOR_COLOR);
  });

  // --- Ceiling ---

  it("positions the ceiling at y=height", () => {
    const ceiling = findSurface(surfaces, "ceiling");
    expect(ceiling.position[1]).toBe(4);
  });

  it("sizes the ceiling to width × length", () => {
    const ceiling = findSurface(surfaces, "ceiling");
    expect(ceiling.size).toEqual([10, 8]);
  });

  it("rotates the ceiling +90° around X so normal faces down", () => {
    const ceiling = findSurface(surfaces, "ceiling");
    expect(ceiling.rotation[0]).toBeCloseTo(Math.PI / 2);
  });

  it("assigns ceiling colour", () => {
    const ceiling = findSurface(surfaces, "ceiling");
    expect(ceiling.color).toBe(CEILING_COLOR);
  });

  // --- Back wall ---

  it("positions the back wall at z = -length/2", () => {
    const wall = findSurface(surfaces, "wall-back");
    expect(wall.position[2]).toBe(-4);
  });

  it("centers the back wall vertically at height/2", () => {
    const wall = findSurface(surfaces, "wall-back");
    expect(wall.position[1]).toBe(2);
  });

  it("sizes the back wall to width × height", () => {
    const wall = findSurface(surfaces, "wall-back");
    expect(wall.size).toEqual([10, 4]);
  });

  it("back wall has no rotation (default normal +Z faces into room)", () => {
    const wall = findSurface(surfaces, "wall-back");
    expect(wall.rotation).toEqual([0, 0, 0]);
  });

  // --- Front wall ---

  it("positions the front wall at z = +length/2", () => {
    const wall = findSurface(surfaces, "wall-front");
    expect(wall.position[2]).toBe(4);
  });

  it("rotates the front wall 180° around Y so normal faces -Z into room", () => {
    const wall = findSurface(surfaces, "wall-front");
    expect(wall.rotation[1]).toBeCloseTo(Math.PI);
  });

  it("sizes the front wall to width × height", () => {
    const wall = findSurface(surfaces, "wall-front");
    expect(wall.size).toEqual([10, 4]);
  });

  // --- Left wall ---

  it("positions the left wall at x = -width/2", () => {
    const wall = findSurface(surfaces, "wall-left");
    expect(wall.position[0]).toBe(-5);
  });

  it("sizes the left wall to length × height", () => {
    const wall = findSurface(surfaces, "wall-left");
    expect(wall.size).toEqual([8, 4]);
  });

  it("rotates the left wall +90° around Y so normal faces +X into room", () => {
    const wall = findSurface(surfaces, "wall-left");
    expect(wall.rotation[1]).toBeCloseTo(Math.PI / 2);
  });

  // --- Right wall ---

  it("positions the right wall at x = +width/2", () => {
    const wall = findSurface(surfaces, "wall-right");
    expect(wall.position[0]).toBe(5);
  });

  it("sizes the right wall to length × height", () => {
    const wall = findSurface(surfaces, "wall-right");
    expect(wall.size).toEqual([8, 4]);
  });

  it("rotates the right wall -90° around Y so normal faces -X into room", () => {
    const wall = findSurface(surfaces, "wall-right");
    expect(wall.rotation[1]).toBeCloseTo(-Math.PI / 2);
  });

  // --- All walls share wall colour ---

  it("assigns wall colour to all 4 walls", () => {
    const wallNames = ["wall-back", "wall-front", "wall-left", "wall-right"];
    for (const name of wallNames) {
      const wall = findSurface(surfaces, name);
      expect(wall.color).toBe(WALL_COLOR);
    }
  });

  // --- Centering ---

  it("centers floor and ceiling on X=0, Z=0", () => {
    const floor = findSurface(surfaces, "floor");
    const ceiling = findSurface(surfaces, "ceiling");
    expect(floor.position[0]).toBe(0);
    expect(floor.position[2]).toBe(0);
    expect(ceiling.position[0]).toBe(0);
    expect(ceiling.position[2]).toBe(0);
  });

  it("centers all walls on their non-offset axes", () => {
    const back = findSurface(surfaces, "wall-back");
    const front = findSurface(surfaces, "wall-front");
    const left = findSurface(surfaces, "wall-left");
    const right = findSurface(surfaces, "wall-right");
    // Back/front walls centered on X
    expect(back.position[0]).toBe(0);
    expect(front.position[0]).toBe(0);
    // Left/right walls centered on Z
    expect(left.position[2]).toBe(0);
    expect(right.position[2]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Grand Hall specific dimensions
// ---------------------------------------------------------------------------

describe("GRAND_HALL_SURFACES", () => {
  it("matches the scaled render dimensions", () => {
    const { width, length, height } = GRAND_HALL_RENDER_DIMENSIONS;
    const floor = findSurface(GRAND_HALL_SURFACES, "floor");
    expect(floor.size).toEqual([width, length]);

    const ceiling = findSurface(GRAND_HALL_SURFACES, "ceiling");
    expect(ceiling.position[1]).toBe(height);
  });

  it("positions back wall at z = -halfLength", () => {
    const wall = findSurface(GRAND_HALL_SURFACES, "wall-back");
    expect(wall.position[2]).toBe(-GRAND_HALL_RENDER_DIMENSIONS.length / 2);
  });

  it("positions left wall at x = -halfWidth", () => {
    const wall = findSurface(GRAND_HALL_SURFACES, "wall-left");
    expect(wall.position[0]).toBe(-GRAND_HALL_RENDER_DIMENSIONS.width / 2);
  });

  it("sizes the left/right walls to length × height", () => {
    const { length, height } = GRAND_HALL_RENDER_DIMENSIONS;
    const wall = findSurface(GRAND_HALL_SURFACES, "wall-left");
    expect(wall.size).toEqual([length, height]);
  });

  it("has exactly 6 surfaces", () => {
    expect(GRAND_HALL_SURFACES).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// Wainscoting
// ---------------------------------------------------------------------------

describe("computeWainscotingSurfaces", () => {
  const dimensions = { width: 10, length: 8, height: 4 };
  const panels = computeWainscotingSurfaces(dimensions);

  it("returns exactly 4 panels", () => {
    expect(panels).toHaveLength(4);
  });

  it("returns panels named wainscot-back, wainscot-front, wainscot-left, wainscot-right", () => {
    const names = panels.map((p) => p.name).sort();
    expect(names).toEqual(["wainscot-back", "wainscot-front", "wainscot-left", "wainscot-right"]);
  });

  it("all panels use WAINSCOT_COLOR", () => {
    for (const panel of panels) {
      expect(panel.color).toBe(WAINSCOT_COLOR);
    }
  });

  it("panels are WAINSCOT_HEIGHT tall", () => {
    for (const panel of panels) {
      expect(panel.size[1]).toBe(WAINSCOT_HEIGHT);
    }
  });

  it("panels are positioned at half wainscot height (centered on lower wall)", () => {
    for (const panel of panels) {
      expect(panel.position[1]).toBeCloseTo(WAINSCOT_HEIGHT / 2);
    }
  });

  it("back panel is slightly inset from the wall (z-fighting prevention)", () => {
    const back = findSurface(panels, "wainscot-back");
    expect(back.position[2]).toBeGreaterThan(-4); // slightly closer than wall at -4
  });
});

describe("GRAND_HALL_WAINSCOTING", () => {
  it("has exactly 4 panels", () => {
    expect(GRAND_HALL_WAINSCOTING).toHaveLength(4);
  });

  it("back panel width matches scaled room width", () => {
    const back = findSurface(GRAND_HALL_WAINSCOTING, "wainscot-back");
    expect(back.size[0]).toBe(GRAND_HALL_RENDER_DIMENSIONS.width);
  });

  it("left panel width matches scaled room length", () => {
    const left = findSurface(GRAND_HALL_WAINSCOTING, "wainscot-left");
    expect(left.size[0]).toBe(GRAND_HALL_RENDER_DIMENSIONS.length);
  });
});

// ---------------------------------------------------------------------------
// Colour constants
// ---------------------------------------------------------------------------

describe("colour constants", () => {
  it("FLOOR_COLOR is a valid hex colour", () => {
    expect(FLOOR_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("WALL_COLOR is a valid hex colour", () => {
    expect(WALL_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("CEILING_COLOR is a valid hex colour", () => {
    expect(CEILING_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("all three colours are distinct", () => {
    const colors = new Set([FLOOR_COLOR, WALL_COLOR, CEILING_COLOR]);
    expect(colors.size).toBe(3);
  });

  it("WAINSCOT_COLOR is a valid hex colour", () => {
    expect(WAINSCOT_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("WAINSCOT_COLOR is distinct from wall and floor", () => {
    expect(WAINSCOT_COLOR).not.toBe(WALL_COLOR);
    expect(WAINSCOT_COLOR).not.toBe(FLOOR_COLOR);
  });
});

// ---------------------------------------------------------------------------
// Dome constants
// ---------------------------------------------------------------------------

describe("dome constants", () => {
  it("DOME_RADIUS is 3.5m (7m diameter)", () => {
    expect(DOME_RADIUS).toBe(3.5);
  });

  it("DOME_RECESS_DEPTH is a shallow cap, not a full hemisphere", () => {
    expect(DOME_RECESS_DEPTH).toBeGreaterThan(1);
    expect(DOME_RECESS_DEPTH).toBeLessThan(DOME_RADIUS);
  });

  it("dome fits within the room width", () => {
    expect(DOME_RADIUS * 2).toBeLessThanOrEqual(GRAND_HALL_RENDER_DIMENSIONS.width);
  });

  it("dome fits within the room length", () => {
    expect(DOME_RADIUS * 2).toBeLessThanOrEqual(GRAND_HALL_RENDER_DIMENSIONS.length);
  });

  it("DOME_COLOR is a valid hex colour", () => {
    expect(DOME_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("DOME_COLOR is distinct from CEILING_COLOR", () => {
    expect(DOME_COLOR).not.toBe(CEILING_COLOR);
  });
});

describe("Grand Hall ornaments source", () => {
  it("does not bake fixed wall-chair rows into the empty hall", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(path.resolve("src/components/GrandHallOrnaments.tsx"), "utf-8");
    expect(source).not.toContain("WallChairRows");
    expect(source).not.toContain("red-upholstered-wall-chair-rows");
    expect(source).not.toContain("BalconyWallCue");
    expect(source).not.toContain("floorplan-balcony-wall-cue");
  });

  it("builds the fireplace as separate surround pieces instead of overlapping solid blocks", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(path.resolve("src/components/GrandHallOrnaments.tsx"), "utf-8");
    expect(source).toContain("right-firebox-back-panel");
    expect(source).toContain("right-fireplace-left-jamb");
    expect(source).toContain("right-fireplace-right-jamb");
    expect(source).not.toContain("<boxGeometry args={[0.16, 1.08, 2.4]} />");
    expect(source).not.toContain("<boxGeometry args={[0.08, 0.72, 1.35]} />");
  });
});

// ---------------------------------------------------------------------------
// Section plane clipping
// ---------------------------------------------------------------------------

describe("isSurfaceClippable", () => {
  it("floor is NOT clippable (always visible)", () => {
    expect(isSurfaceClippable("floor")).toBe(false);
  });

  it("ceiling IS clippable", () => {
    expect(isSurfaceClippable("ceiling")).toBe(true);
  });

  it("all 4 walls are clippable", () => {
    expect(isSurfaceClippable("wall-back")).toBe(true);
    expect(isSurfaceClippable("wall-front")).toBe(true);
    expect(isSurfaceClippable("wall-left")).toBe(true);
    expect(isSurfaceClippable("wall-right")).toBe(true);
  });

  it("wainscoting is clippable", () => {
    expect(isSurfaceClippable("wainscot-back")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("computeRoomSurfaces edge cases", () => {
  it("handles a 1×1×1 unit cube", () => {
    const surfaces = computeRoomSurfaces({ width: 1, length: 1, height: 1 });
    expect(surfaces).toHaveLength(6);
    const floor = findSurface(surfaces, "floor");
    expect(floor.size).toEqual([1, 1]);
    expect(floor.position).toEqual([0, 0, 0]);
  });

  it("handles non-integer dimensions", () => {
    const surfaces = computeRoomSurfaces({ width: 3.7, length: 2.3, height: 1.1 });
    const ceiling = findSurface(surfaces, "ceiling");
    expect(ceiling.position[1]).toBeCloseTo(1.1);
    const back = findSurface(surfaces, "wall-back");
    expect(back.position[2]).toBeCloseTo(-1.15);
  });

  it("handles very large dimensions", () => {
    const surfaces = computeRoomSurfaces({ width: 200, length: 200, height: 50 });
    expect(surfaces).toHaveLength(6);
    const ceiling = findSurface(surfaces, "ceiling");
    expect(ceiling.position[1]).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Three.js material verification
// ---------------------------------------------------------------------------

describe("FrontSide import", () => {
  it("FrontSide equals 0 (Three.js constant)", () => {
    expect(FrontSide).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Component smoke test — renders inside mocked Canvas
// ---------------------------------------------------------------------------

describe("App with GrandHallRoom", () => {
  it("renders without crashing", () => {
    const { getByTestId } = render(<App />);
    expect(getByTestId("r3f-canvas")).toBeDefined();
  });
});
