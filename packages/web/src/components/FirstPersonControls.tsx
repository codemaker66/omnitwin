import { useRef, useEffect, useCallback } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { Euler, Vector3 } from "three";
import { TRADES_HALL_GRAND_HALL_DIMENSIONS } from "@omnitwin/types";
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
} from "../lib/movement.js";

// ---------------------------------------------------------------------------
// Precomputed constants — no allocations at runtime
// ---------------------------------------------------------------------------

const GRAND_HALL_BOUNDS: RoomBounds = computeRoomBounds(
  TRADES_HALL_GRAND_HALL_DIMENSIONS,
  WALL_MARGIN,
);

// Preallocated objects reused every frame (Renderer rule: no new in useFrame)
const _euler = new Euler(0, 0, 0, "YXZ");
const _position = new Vector3();

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * First-person camera controls for navigating the Grand Hall.
 *
 * - Click to engage pointer lock (mouse look)
 * - WASD / Arrow keys for movement
 * - Frame-rate independent via delta time
 * - Room bounds clamping prevents walking through walls
 * - Works with frameloop="demand": invalidates only while interacting
 *
 * Renders nothing — this is a side-effect-only component.
 */
export function FirstPersonControls(): null {
  const { camera, gl, invalidate } = useThree();

  // Mutable refs for input state — avoids re-renders on key press
  const keysRef = useRef<MovementInput>({
    forward: false,
    backward: false,
    left: false,
    right: false,
  });
  const isLockedRef = useRef(false);
  const yawRef = useRef(0);
  const pitchRef = useRef(0);

  // --- Pointer lock ---

  const requestLock = useCallback(() => {
    void gl.domElement.requestPointerLock();
  }, [gl.domElement]);

  useEffect(() => {
    const domElement = gl.domElement;

    const onLockChange = (): void => {
      isLockedRef.current = document.pointerLockElement === domElement;
    };

    const onMouseMove = (event: MouseEvent): void => {
      if (!isLockedRef.current) return;

      yawRef.current -= event.movementX * LOOK_SENSITIVITY;
      pitchRef.current = clampPitch(
        pitchRef.current - event.movementY * LOOK_SENSITIVITY,
        PITCH_LIMIT,
      );

      // Apply rotation to camera
      _euler.set(pitchRef.current, yawRef.current, 0, "YXZ");
      camera.quaternion.setFromEuler(_euler);

      invalidate();
    };

    domElement.addEventListener("click", requestLock);
    document.addEventListener("pointerlockchange", onLockChange);
    document.addEventListener("mousemove", onMouseMove);

    return () => {
      domElement.removeEventListener("click", requestLock);
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("mousemove", onMouseMove);
    };
  }, [camera, gl.domElement, invalidate, requestLock]);

  // --- Keyboard ---

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const direction = keyToDirection(event.code);
      if (direction === null) return;

      event.preventDefault();
      keysRef.current = { ...keysRef.current, [direction]: true };
      invalidate();
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      const direction = keyToDirection(event.code);
      if (direction === null) return;

      event.preventDefault();
      keysRef.current = { ...keysRef.current, [direction]: false };
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
    };
  }, [invalidate]);

  // --- Frame loop ---

  useFrame((_state, delta) => {
    const keys = keysRef.current;
    if (!isMoving(keys)) return;

    const movement = computeMovementDelta(keys, yawRef.current, MOVE_SPEED, delta);

    // Apply movement and clamp to room bounds
    _position.copy(camera.position);
    _position.x += movement.dx;
    _position.z += movement.dz;

    const clamped = clampToRoomBounds(_position.x, _position.z, GRAND_HALL_BOUNDS);
    camera.position.set(clamped.x, camera.position.y, clamped.z);

    // Keep rendering while moving
    invalidate();
  });

  return null;
}
