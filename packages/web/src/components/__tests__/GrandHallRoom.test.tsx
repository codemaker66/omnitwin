import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { FrontSide } from "three";
import {
  computeRoomSurfaces,
  GRAND_HALL_SURFACES,
  CAMERA_EYE_HEIGHT,
  type RoomSurface,
} from "../GrandHallRoom.js";
import { FLOOR_COLOR, WALL_COLOR, CEILING_COLOR } from "../../constants/colors.js";

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
    camera: { position: { x: 0, y: 0, z: 0, set: vi.fn(), copy: vi.fn() }, quaternion: { setFromEuler: vi.fn() } },
    gl: { domElement: document.createElement("canvas") },
    invalidate: vi.fn(),
  }),
  useFrame: vi.fn(),
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
  it("matches the dimensions from @omnitwin/types (21 × 10.5 × 8)", () => {
    const floor = findSurface(GRAND_HALL_SURFACES, "floor");
    expect(floor.size).toEqual([21, 10.5]);

    const ceiling = findSurface(GRAND_HALL_SURFACES, "ceiling");
    expect(ceiling.position[1]).toBe(8);
  });

  it("positions back wall at z = -5.25 (half of 10.5m length)", () => {
    const wall = findSurface(GRAND_HALL_SURFACES, "wall-back");
    expect(wall.position[2]).toBe(-5.25);
  });

  it("positions left wall at x = -10.5 (half of 21m width)", () => {
    const wall = findSurface(GRAND_HALL_SURFACES, "wall-left");
    expect(wall.position[0]).toBe(-10.5);
  });

  it("sizes the left/right walls to 10.5m × 8m (length × height)", () => {
    const wall = findSurface(GRAND_HALL_SURFACES, "wall-left");
    expect(wall.size).toEqual([10.5, 8]);
  });

  it("has exactly 6 surfaces", () => {
    expect(GRAND_HALL_SURFACES).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// Camera constants
// ---------------------------------------------------------------------------

describe("CAMERA_EYE_HEIGHT", () => {
  it("is approximately adult eye level (1.5m–2.0m)", () => {
    expect(CAMERA_EYE_HEIGHT).toBeGreaterThanOrEqual(1.5);
    expect(CAMERA_EYE_HEIGHT).toBeLessThanOrEqual(2.0);
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

  it("passes camera config with eye-height position", () => {
    CanvasMock.mockClear();
    render(<App />);
    const firstCall = CanvasMock.mock.calls[0];
    if (firstCall === undefined) {
      throw new Error("Canvas was never called");
    }
    const props = firstCall[0] as Record<string, unknown>;
    const camera = props["camera"] as Record<string, unknown>;
    const position = camera["position"] as readonly number[];
    expect(position[1]).toBe(CAMERA_EYE_HEIGHT);
  });
});
