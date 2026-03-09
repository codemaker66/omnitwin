import { describe, it, expect } from "vitest";
import {
  computeMovementDelta,
  computeRoomBounds,
  clampToRoomBounds,
  clampPitch,
  keyToDirection,
  isMoving,
  MOVE_SPEED,
  LOOK_SENSITIVITY,
  PITCH_LIMIT,
  WALL_MARGIN,
  type MovementInput,
  type RoomBounds,
} from "../movement.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NO_INPUT: MovementInput = { forward: false, backward: false, left: false, right: false };
const FORWARD: MovementInput = { ...NO_INPUT, forward: true };
const BACKWARD: MovementInput = { ...NO_INPUT, backward: true };
const LEFT: MovementInput = { ...NO_INPUT, left: true };
const RIGHT: MovementInput = { ...NO_INPUT, right: true };
const FORWARD_LEFT: MovementInput = { ...NO_INPUT, forward: true, left: true };
const FORWARD_RIGHT: MovementInput = { ...NO_INPUT, forward: true, right: true };

const ONE_SECOND = 1;
const YAW_ZERO = 0; // Looking toward -Z

// ---------------------------------------------------------------------------
// Constants validation
// ---------------------------------------------------------------------------

describe("movement constants", () => {
  it("MOVE_SPEED is a reasonable walking speed (2-5 m/s)", () => {
    expect(MOVE_SPEED).toBeGreaterThanOrEqual(2);
    expect(MOVE_SPEED).toBeLessThanOrEqual(5);
  });

  it("LOOK_SENSITIVITY is positive and small", () => {
    expect(LOOK_SENSITIVITY).toBeGreaterThan(0);
    expect(LOOK_SENSITIVITY).toBeLessThan(0.01);
  });

  it("PITCH_LIMIT is close to 89 degrees in radians", () => {
    const expected = (89 * Math.PI) / 180;
    expect(PITCH_LIMIT).toBeCloseTo(expected);
  });

  it("WALL_MARGIN is positive and less than 1m", () => {
    expect(WALL_MARGIN).toBeGreaterThan(0);
    expect(WALL_MARGIN).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------
// isMoving
// ---------------------------------------------------------------------------

describe("isMoving", () => {
  it("returns false when no keys held", () => {
    expect(isMoving(NO_INPUT)).toBe(false);
  });

  it("returns true when forward is held", () => {
    expect(isMoving(FORWARD)).toBe(true);
  });

  it("returns true when multiple keys are held", () => {
    expect(isMoving(FORWARD_LEFT)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeMovementDelta
// ---------------------------------------------------------------------------

describe("computeMovementDelta", () => {
  it("returns zero displacement when no input", () => {
    const delta = computeMovementDelta(NO_INPUT, YAW_ZERO, MOVE_SPEED, ONE_SECOND);
    expect(delta.dx).toBe(0);
    expect(delta.dz).toBe(0);
  });

  it("returns zero displacement when delta is zero", () => {
    const delta = computeMovementDelta(FORWARD, YAW_ZERO, MOVE_SPEED, 0);
    expect(delta.dx).toBeCloseTo(0);
    expect(delta.dz).toBeCloseTo(0);
  });

  // At yaw=0 (looking toward -Z), forward should move in -Z
  it("moves in -Z direction when facing forward (yaw=0) and pressing forward", () => {
    const delta = computeMovementDelta(FORWARD, YAW_ZERO, MOVE_SPEED, ONE_SECOND);
    expect(delta.dx).toBeCloseTo(0);
    expect(delta.dz).toBeCloseTo(-MOVE_SPEED);
  });

  it("moves in +Z direction when pressing backward at yaw=0", () => {
    const delta = computeMovementDelta(BACKWARD, YAW_ZERO, MOVE_SPEED, ONE_SECOND);
    expect(delta.dx).toBeCloseTo(0);
    expect(delta.dz).toBeCloseTo(MOVE_SPEED);
  });

  it("strafes in -X direction when pressing left at yaw=0", () => {
    const delta = computeMovementDelta(LEFT, YAW_ZERO, MOVE_SPEED, ONE_SECOND);
    expect(delta.dx).toBeCloseTo(-MOVE_SPEED);
    expect(delta.dz).toBeCloseTo(0);
  });

  it("strafes in +X direction when pressing right at yaw=0", () => {
    const delta = computeMovementDelta(RIGHT, YAW_ZERO, MOVE_SPEED, ONE_SECOND);
    expect(delta.dx).toBeCloseTo(MOVE_SPEED);
    expect(delta.dz).toBeCloseTo(0);
  });

  // At yaw=π/2, camera forward direction is [-sin(π/2), 0, -cos(π/2)] = [-1, 0, 0]
  it("moves in -X direction when facing left (yaw=π/2) and pressing forward", () => {
    const yaw = Math.PI / 2;
    const delta = computeMovementDelta(FORWARD, yaw, MOVE_SPEED, ONE_SECOND);
    expect(delta.dx).toBeCloseTo(-MOVE_SPEED);
    expect(delta.dz).toBeCloseTo(0);
  });

  // Diagonal movement should be normalized (not faster)
  it("normalizes diagonal movement to same speed as cardinal", () => {
    const cardinal = computeMovementDelta(FORWARD, YAW_ZERO, MOVE_SPEED, ONE_SECOND);
    const diagonal = computeMovementDelta(FORWARD_LEFT, YAW_ZERO, MOVE_SPEED, ONE_SECOND);
    const cardinalSpeed = Math.sqrt(cardinal.dx ** 2 + cardinal.dz ** 2);
    const diagonalSpeed = Math.sqrt(diagonal.dx ** 2 + diagonal.dz ** 2);
    expect(diagonalSpeed).toBeCloseTo(cardinalSpeed);
  });

  it("scales displacement linearly with delta time", () => {
    const half = computeMovementDelta(FORWARD, YAW_ZERO, MOVE_SPEED, 0.5);
    const full = computeMovementDelta(FORWARD, YAW_ZERO, MOVE_SPEED, 1.0);
    expect(half.dz).toBeCloseTo(full.dz / 2);
  });

  it("scales displacement linearly with speed", () => {
    const slow = computeMovementDelta(FORWARD, YAW_ZERO, 1.0, ONE_SECOND);
    const fast = computeMovementDelta(FORWARD, YAW_ZERO, 2.0, ONE_SECOND);
    expect(fast.dz).toBeCloseTo(slow.dz * 2);
  });

  // Opposing inputs cancel out
  it("returns zero when forward and backward are both held", () => {
    const both: MovementInput = { forward: true, backward: true, left: false, right: false };
    const delta = computeMovementDelta(both, YAW_ZERO, MOVE_SPEED, ONE_SECOND);
    expect(delta.dx).toBeCloseTo(0);
    expect(delta.dz).toBeCloseTo(0);
  });

  it("returns zero when left and right are both held", () => {
    const both: MovementInput = { forward: false, backward: false, left: true, right: true };
    const delta = computeMovementDelta(both, YAW_ZERO, MOVE_SPEED, ONE_SECOND);
    expect(delta.dx).toBeCloseTo(0);
    expect(delta.dz).toBeCloseTo(0);
  });

  // Yaw = π (facing +Z, turned 180°)
  it("moves in +Z when facing backward (yaw=π) and pressing forward", () => {
    const delta = computeMovementDelta(FORWARD, Math.PI, MOVE_SPEED, ONE_SECOND);
    expect(delta.dx).toBeCloseTo(0);
    expect(delta.dz).toBeCloseTo(MOVE_SPEED);
  });

  // Forward+Right diagonal at yaw=0 should move toward -Z and +X
  it("moves diagonally when forward+right at yaw=0", () => {
    const delta = computeMovementDelta(FORWARD_RIGHT, YAW_ZERO, MOVE_SPEED, ONE_SECOND);
    expect(delta.dx).toBeGreaterThan(0); // rightward
    expect(delta.dz).toBeLessThan(0); // forward (-Z)
  });
});

// ---------------------------------------------------------------------------
// computeRoomBounds
// ---------------------------------------------------------------------------

describe("computeRoomBounds", () => {
  const grandHall = { width: 21, length: 10.5, height: 8 };

  it("computes symmetric bounds for Grand Hall", () => {
    const bounds = computeRoomBounds(grandHall, WALL_MARGIN);
    expect(bounds.minX).toBeCloseTo(-10.5 + WALL_MARGIN);
    expect(bounds.maxX).toBeCloseTo(10.5 - WALL_MARGIN);
    expect(bounds.minZ).toBeCloseTo(-5.25 + WALL_MARGIN);
    expect(bounds.maxZ).toBeCloseTo(5.25 - WALL_MARGIN);
  });

  it("bounds are symmetric around zero", () => {
    const bounds = computeRoomBounds(grandHall, WALL_MARGIN);
    expect(bounds.minX).toBeCloseTo(-bounds.maxX);
    expect(bounds.minZ).toBeCloseTo(-bounds.maxZ);
  });

  it("bounds shrink with larger margin", () => {
    const narrow = computeRoomBounds(grandHall, 1.0);
    const wide = computeRoomBounds(grandHall, 0.1);
    expect(narrow.maxX).toBeLessThan(wide.maxX);
    expect(narrow.maxZ).toBeLessThan(wide.maxZ);
  });

  it("handles a 1×1×1 room", () => {
    const bounds = computeRoomBounds({ width: 1, length: 1, height: 1 }, 0.1);
    expect(bounds.minX).toBeCloseTo(-0.4);
    expect(bounds.maxX).toBeCloseTo(0.4);
  });
});

// ---------------------------------------------------------------------------
// clampToRoomBounds
// ---------------------------------------------------------------------------

describe("clampToRoomBounds", () => {
  const bounds: RoomBounds = { minX: -10, maxX: 10, minZ: -5, maxZ: 5 };

  it("returns position unchanged when inside bounds", () => {
    const result = clampToRoomBounds(3, 2, bounds);
    expect(result.x).toBe(3);
    expect(result.z).toBe(2);
  });

  it("clamps X to minX when too far left", () => {
    const result = clampToRoomBounds(-15, 0, bounds);
    expect(result.x).toBe(-10);
    expect(result.z).toBe(0);
  });

  it("clamps X to maxX when too far right", () => {
    const result = clampToRoomBounds(15, 0, bounds);
    expect(result.x).toBe(10);
  });

  it("clamps Z to minZ when too far back", () => {
    const result = clampToRoomBounds(0, -8, bounds);
    expect(result.z).toBe(-5);
  });

  it("clamps Z to maxZ when too far forward", () => {
    const result = clampToRoomBounds(0, 8, bounds);
    expect(result.z).toBe(5);
  });

  it("clamps both axes simultaneously", () => {
    const result = clampToRoomBounds(20, -20, bounds);
    expect(result.x).toBe(10);
    expect(result.z).toBe(-5);
  });

  it("allows positions exactly on the boundary", () => {
    const result = clampToRoomBounds(10, -5, bounds);
    expect(result.x).toBe(10);
    expect(result.z).toBe(-5);
  });
});

// ---------------------------------------------------------------------------
// clampPitch
// ---------------------------------------------------------------------------

describe("clampPitch", () => {
  it("returns pitch unchanged when within limits", () => {
    expect(clampPitch(0.5, PITCH_LIMIT)).toBe(0.5);
  });

  it("clamps positive pitch to limit", () => {
    expect(clampPitch(2.0, PITCH_LIMIT)).toBeCloseTo(PITCH_LIMIT);
  });

  it("clamps negative pitch to -limit", () => {
    expect(clampPitch(-2.0, PITCH_LIMIT)).toBeCloseTo(-PITCH_LIMIT);
  });

  it("returns zero unchanged", () => {
    expect(clampPitch(0, PITCH_LIMIT)).toBe(0);
  });

  it("returns exactly the limit when at the boundary", () => {
    expect(clampPitch(PITCH_LIMIT, PITCH_LIMIT)).toBeCloseTo(PITCH_LIMIT);
    expect(clampPitch(-PITCH_LIMIT, PITCH_LIMIT)).toBeCloseTo(-PITCH_LIMIT);
  });
});

// ---------------------------------------------------------------------------
// keyToDirection
// ---------------------------------------------------------------------------

describe("keyToDirection", () => {
  it("maps KeyW to forward", () => {
    expect(keyToDirection("KeyW")).toBe("forward");
  });

  it("maps ArrowUp to forward", () => {
    expect(keyToDirection("ArrowUp")).toBe("forward");
  });

  it("maps KeyS to backward", () => {
    expect(keyToDirection("KeyS")).toBe("backward");
  });

  it("maps ArrowDown to backward", () => {
    expect(keyToDirection("ArrowDown")).toBe("backward");
  });

  it("maps KeyA to left", () => {
    expect(keyToDirection("KeyA")).toBe("left");
  });

  it("maps ArrowLeft to left", () => {
    expect(keyToDirection("ArrowLeft")).toBe("left");
  });

  it("maps KeyD to right", () => {
    expect(keyToDirection("KeyD")).toBe("right");
  });

  it("maps ArrowRight to right", () => {
    expect(keyToDirection("ArrowRight")).toBe("right");
  });

  it("returns null for non-movement keys", () => {
    expect(keyToDirection("Space")).toBeNull();
    expect(keyToDirection("KeyQ")).toBeNull();
    expect(keyToDirection("Escape")).toBeNull();
  });
});
