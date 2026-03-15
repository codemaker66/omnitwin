import { useEffect, useMemo, useRef, useCallback } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { SpaceDimensions } from "@omnitwin/types";
import { useBookmarkStore } from "../stores/bookmark-store.js";
import { sampleTransition } from "../lib/camera-animation.js";

// ---------------------------------------------------------------------------
// Camera configuration — pure data, fully testable
// ---------------------------------------------------------------------------

/**
 * Computes default camera position for an immersive interior perspective
 * — like standing just inside the entrance of the room, looking across
 * its full length.
 *
 * The camera is placed at human eye level (1.7m), near one end of the
 * room's longest axis, with a slight lateral offset for a natural 3/4
 * feel. The room should fill 80-90% of the viewport at FOV 55°.
 */
export function computeDefaultCameraPosition(
  dimensions: SpaceDimensions,
): readonly [number, number, number] {
  const { width, length } = dimensions;
  const maxDim = Math.max(width, length);
  const minDim = Math.min(width, length);
  // Position ~38% of the longest axis from center — inside the room,
  // near one wall. This gives enough distance to frame the opposite end.
  const alongAxis = maxDim * 0.38;
  // Slight lateral offset for a natural 3/4 view, not dead-center.
  const lateral = minDim * 0.08;
  const eyeLevel = 1.7;

  // Place camera along the longest axis so you look across the full room.
  if (width >= length) {
    return [alongAxis, eyeLevel, lateral];
  }
  return [lateral, eyeLevel, alongAxis];
}

/**
 * Computes the orbit target: center of the room at human eye level (1.5m).
 * This keeps the orbit feeling natural — you're looking around a space
 * from within it, not staring down at a tabletop model.
 */
export function computeCameraTarget(
  _dimensions: SpaceDimensions,
): readonly [number, number, number] {
  return [0, 1.5, 0];
}

/**
 * Computes min/max orbit distance constraints.
 * - Min ~5m: close enough to inspect details, but not inside walls.
 * - Max ~25m: far enough to see the whole room, but never so far
 *   that it looks like a toy model.
 */
export function computeDistanceLimits(
  dimensions: SpaceDimensions,
): { readonly minDistance: number; readonly maxDistance: number } {
  const maxDim = Math.max(dimensions.width, dimensions.length, dimensions.height);
  return {
    minDistance: Math.max(2, maxDim * 0.24),
    maxDistance: Math.max(15, maxDim * 1.2),
  };
}

/**
 * Computes the rectangular bounds the camera target can pan within.
 * Allows panning slightly beyond the room edges (20% margin) so
 * the user can see all corners without the target snapping at the edge.
 */
export function computePanBounds(
  dimensions: SpaceDimensions,
): { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number } {
  const marginX = dimensions.width * 0.2;
  const marginZ = dimensions.length * 0.2;
  return {
    minX: -dimensions.width / 2 - marginX,
    maxX: dimensions.width / 2 + marginX,
    minZ: -dimensions.length / 2 - marginZ,
    maxZ: dimensions.length / 2 + marginZ,
  };
}

/** Minimum polar angle — don't let camera go below the floor plane. */
export const MIN_POLAR_ANGLE = 0.1; // ~6° from directly overhead

/** Maximum polar angle — nearly horizontal, never below the floor. */
export const MAX_POLAR_ANGLE = Math.PI * 0.48; // ~86° from vertical (nearly horizontal)

/** Damping factor — lower = more slide/coast after interaction. */
export const DAMPING_FACTOR = 0.04;

/** Base pan speed in meters per second at reference zoom distance. */
export const PAN_SPEED = 20;

/** Edge scroll zone width in pixels from screen edge. */
export const EDGE_SCROLL_ZONE = 40;

/** Number of frames to keep rendering after an OrbitControls interaction,
 *  allowing damping to coast smoothly in demand mode. ~3 seconds at 60fps. */
export const DAMPING_SETTLE_FRAMES = 180;

/** How much each scroll tick adds to zoom velocity (multiplied by current distance). */
export const ZOOM_IMPULSE = 0.025;

/** Friction applied per frame — velocity *= (1 - friction). Lower = more coast. */
export const ZOOM_FRICTION = 0.09;

/** Below this velocity, snap to zero and stop rendering zoom frames. */
export const ZOOM_VELOCITY_THRESHOLD = 0.001;

// ---------------------------------------------------------------------------
// Keyboard state tracking
// ---------------------------------------------------------------------------

const PAN_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"]);

function createKeyboardState(): { readonly keys: Set<string>; attach: () => () => void } {
  const keys = new Set<string>();

  function onKeyDown(event: KeyboardEvent): void {
    if (PAN_KEYS.has(event.code)) {
      keys.add(event.code);
    }
  }

  function onKeyUp(event: KeyboardEvent): void {
    keys.delete(event.code);
  }

  function onBlur(): void {
    keys.clear();
  }

  function attach(): () => void {
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      keys.clear();
    };
  }

  return { keys, attach };
}

// ---------------------------------------------------------------------------
// Pure pan direction computation
// ---------------------------------------------------------------------------

/**
 * Computes a unit XZ pan direction from currently pressed keys.
 * Returns [0, 0] if no pan keys are held. Output is normalized.
 *
 * W/Up = -Z (forward into screen), S/Down = +Z, A/Left = -X, D/Right = +X.
 * This matches camera-relative panning for a top-down RTS view.
 */
export function computeKeyboardPanDirection(
  pressedKeys: ReadonlySet<string>,
): readonly [number, number] {
  let dx = 0;
  let dz = 0;

  if (pressedKeys.has("KeyW") || pressedKeys.has("ArrowUp")) dz -= 1;
  if (pressedKeys.has("KeyS") || pressedKeys.has("ArrowDown")) dz += 1;
  if (pressedKeys.has("KeyA") || pressedKeys.has("ArrowLeft")) dx -= 1;
  if (pressedKeys.has("KeyD") || pressedKeys.has("ArrowRight")) dx += 1;

  if (dx === 0 && dz === 0) return [0, 0];

  // Normalize diagonal movement
  const length = Math.sqrt(dx * dx + dz * dz);
  return [dx / length, dz / length];
}

/**
 * Computes edge scroll direction based on mouse position relative to viewport.
 * Returns [0, 0] if mouse is not near any edge.
 */
export function computeEdgeScrollDirection(
  mouseX: number,
  mouseY: number,
  viewportWidth: number,
  viewportHeight: number,
  zone: number,
): readonly [number, number] {
  let dx = 0;
  let dz = 0;

  if (mouseX < zone) dx = -1;
  else if (mouseX > viewportWidth - zone) dx = 1;

  if (mouseY < zone) dz = -1;
  else if (mouseY > viewportHeight - zone) dz = 1;

  if (dx === 0 && dz === 0) return [0, 0];

  const length = Math.sqrt(dx * dx + dz * dz);
  return [dx / length, dz / length];
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CameraRigProps {
  readonly dimensions: SpaceDimensions;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * RTS-style camera rig (StarCraft 2 feel) for venue planning.
 *
 * Controls:
 * - WASD / Arrow keys: Pan camera across the room
 * - Scroll wheel: Inertial zoom in/out (momentum-based, smooth coast)
 * - Right-click drag: Orbit (rotate around look-at point)
 * - Middle-click drag: Pan
 * - Left-click: Reserved for object selection (no camera action)
 *
 * Pan speed scales with zoom distance (closer = slower, further = faster).
 * Camera target is clamped to room bounds with a small margin.
 */
export function CameraRig({ dimensions }: CameraRigProps): React.ReactElement {
  const { camera, gl, invalidate } = useThree();
  const controlsRef = useRef<OrbitControlsImpl>(null);

  const limits = computeDistanceLimits(dimensions);
  const bounds = computePanBounds(dimensions);

  // Set initial camera position on mount — eye level, inside the room
  const target = useMemo(() => computeCameraTarget(dimensions), [dimensions]);
  useEffect(() => {
    const [x, y, z] = computeDefaultCameraPosition(dimensions);
    camera.position.set(x, y, z);
    camera.lookAt(target[0], target[1], target[2]);
    invalidate();
  }, [camera, dimensions, target, invalidate]);

  // Keyboard input — keydown must call invalidate() to wake demand-mode frame loop
  const keyboardRef = useRef<ReturnType<typeof createKeyboardState> | null>(null);
  useEffect(() => {
    const kb = createKeyboardState();
    keyboardRef.current = kb;
    const detach = kb.attach();

    function onPanKeyDown(event: KeyboardEvent): void {
      if (PAN_KEYS.has(event.code)) {
        invalidate();
      }
    }
    window.addEventListener("keydown", onPanKeyDown);
    return () => {
      detach();
      window.removeEventListener("keydown", onPanKeyDown);
    };
  }, [invalidate]);

  // Reusable vectors to avoid per-frame allocation
  const panDelta = useRef(new Vector3());
  const zoomDir = useRef(new Vector3());

  const clampTarget = useCallback((t: Vector3): void => {
    t.x = Math.max(bounds.minX, Math.min(bounds.maxX, t.x));
    t.z = Math.max(bounds.minZ, Math.min(bounds.maxZ, t.z));
  }, [bounds]);

  // Damping decay — after an OrbitControls interaction (orbit, pan),
  // keep rendering frames so damping can interpolate smoothly.
  const dampingFrames = useRef(0);

  const onControlsChange = useCallback(() => {
    dampingFrames.current = DAMPING_SETTLE_FRAMES;
    invalidate();
  }, [invalidate]);

  // Custom inertial zoom — scroll ticks add velocity, friction decays it
  const zoomVelocity = useRef(0);

  useEffect(() => {
    const canvas = gl.domElement;

    function onWheel(event: WheelEvent): void {
      event.preventDefault();
      // Normalize scroll delta across browsers (line vs pixel mode)
      const raw = event.deltaY;
      const delta = Math.sign(raw) * Math.min(Math.abs(raw), 150);
      const normalizedDelta = delta / 100;
      // Each tick adds velocity proportional to current distance (feels natural)
      const controls = controlsRef.current;
      if (controls === null) return;
      const distance = camera.position.distanceTo(controls.target);
      zoomVelocity.current += normalizedDelta * ZOOM_IMPULSE * distance;
      invalidate();
    }

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [camera, gl, invalidate]);

  // Per-frame: bookmark transition animation
  // Runs before the main camera loop — if a transition is active, it takes
  // full control of the camera and skips normal pan/zoom/orbit.
  useFrame((_state, frameDelta) => {
    const controls = controlsRef.current;
    if (controls === null) return;

    const store = useBookmarkStore.getState();

    // Consume pending navigation request — UI sets this, we start the transition
    if (store.pendingNavigationId !== null) {
      const bookmark = store.bookmarks.find((b) => b.id === store.pendingNavigationId);
      if (bookmark !== undefined) {
        const pos: readonly [number, number, number] = [
          camera.position.x, camera.position.y, camera.position.z,
        ];
        const tgt: readonly [number, number, number] = [
          controls.target.x, controls.target.y, controls.target.z,
        ];
        store.startTransition(bookmark, pos, tgt);
      }
      useBookmarkStore.setState({ pendingNavigationId: null });
      invalidate();
    }

    if (store.transition === null) {
      // Re-enable controls when no transition is active
      if (!controls.enabled) {
        controls.enabled = true;
      }
      return;
    }

    // Disable user controls during transition
    controls.enabled = false;

    const { position: interpPos, target: interpTarget, done } = sampleTransition(store.transition);

    camera.position.set(interpPos[0], interpPos[1], interpPos[2]);
    controls.target.set(interpTarget[0], interpTarget[1], interpTarget[2]);
    controls.update();

    if (done) {
      store.clearTransition();
      controls.enabled = true;
    } else {
      store.updateTransition(frameDelta);
      invalidate();
    }
  });

  // Per-frame: inertial zoom + WASD panning + damping decay
  useFrame((_state, delta) => {
    const controls = controlsRef.current;
    const keyboard = keyboardRef.current;
    if (controls === null || keyboard === null) return;

    // Skip normal camera controls while a bookmark transition is active
    if (!controls.enabled) return;

    // Keep rendering while damping settles after orbit/pan
    if (dampingFrames.current > 0) {
      dampingFrames.current--;
      controls.update();
      invalidate();
    }

    // Inertial zoom — apply velocity then decay via friction
    if (Math.abs(zoomVelocity.current) > ZOOM_VELOCITY_THRESHOLD) {
      // Zoom direction: camera → target (positive velocity = zoom out = move away)
      const dir = zoomDir.current;
      dir.subVectors(camera.position, controls.target).normalize();

      const move = zoomVelocity.current * delta * 60; // Normalize to ~60fps feel
      camera.position.addScaledVector(dir, move);

      // Clamp distance to limits
      const distance = camera.position.distanceTo(controls.target);
      if (distance < limits.minDistance) {
        dir.subVectors(camera.position, controls.target).normalize();
        camera.position.copy(controls.target).addScaledVector(dir, limits.minDistance);
        zoomVelocity.current = 0; // Kill velocity at limits
      } else if (distance > limits.maxDistance) {
        dir.subVectors(camera.position, controls.target).normalize();
        camera.position.copy(controls.target).addScaledVector(dir, limits.maxDistance);
        zoomVelocity.current = 0;
      }

      // Friction: decay velocity each frame
      zoomVelocity.current *= (1 - ZOOM_FRICTION);

      // Snap to zero when negligible
      if (Math.abs(zoomVelocity.current) < ZOOM_VELOCITY_THRESHOLD) {
        zoomVelocity.current = 0;
      } else {
        invalidate(); // Keep rendering while coasting
      }

      controls.update();
    }

    // Keyboard pan direction
    const [dx, dz] = computeKeyboardPanDirection(keyboard.keys);

    if (dx === 0 && dz === 0) return;

    // Scale pan speed with zoom distance — closer = finer control
    const distance = camera.position.distanceTo(controls.target);
    const referenceDistance = (limits.minDistance + limits.maxDistance) / 2;
    const speedScale = distance / referenceDistance;
    const speed = PAN_SPEED * speedScale * delta;

    // Apply pan in camera-relative XZ plane
    // Get camera's forward direction projected onto XZ plane
    const forward = panDelta.current;
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    // Right vector = forward × up
    const rightX = -forward.z;
    const rightZ = forward.x;

    const moveX = (rightX * dx + forward.x * -dz) * speed;
    const moveZ = (rightZ * dx + forward.z * -dz) * speed;

    controls.target.x += moveX;
    controls.target.z += moveZ;
    clampTarget(controls.target);

    // Move camera by same amount to keep relative offset
    camera.position.x += moveX;
    camera.position.z += moveZ;

    controls.update();
    invalidate();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={DAMPING_FACTOR}
      enableZoom={false}
      minPolarAngle={MIN_POLAR_ANGLE}
      maxPolarAngle={MAX_POLAR_ANGLE}
      minDistance={limits.minDistance}
      maxDistance={limits.maxDistance}
      target={[target[0], target[1], target[2]]}
      enableRotate
      enablePan
      mouseButtons={{
        LEFT: -1 as number, // Disabled — reserved for object selection
        MIDDLE: 2, // THREE.MOUSE.PAN
        RIGHT: 0, // THREE.MOUSE.ROTATE (orbit)
      }}
      onChange={onControlsChange}
    />
  );
}
