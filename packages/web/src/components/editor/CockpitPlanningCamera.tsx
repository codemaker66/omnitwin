import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { EventDispatcher, Vector3 } from "three";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";
import { planningCameraGoal, type CameraPose } from "../../lib/cockpit-planning-camera.js";
import type { CockpitMode } from "../../lib/cockpit-modes.js";

// ---------------------------------------------------------------------------
// CockpitPlanningCamera — eases the planner camera to a gentle, elevated
// planning pose the moment the Flow lens opens, so the floor-anchored guest-
// flow ribbons present themselves immediately (flat floor overlays read as
// edge-on slivers from an eye-level angle). It lifts in place — the viewer's
// azimuth is preserved — then hands control straight back. Honours
// prefers-reduced-motion by snapping. Returns null; it only drives the camera.
// ---------------------------------------------------------------------------

const PLANNING_EASE = 0.12;
const PLANNING_DONE = 0.08;
const DEFAULT_VERTICAL_FOV = 55;
const FLOW_LENS: CockpitMode = "flow";

// The default controls registered by OrbitControls(makeDefault) are a
// THREE.EventDispatcher at the type level; narrow to the orbit shape we drive.
interface OrbitLikeControls extends EventDispatcher {
  readonly target: Vector3;
  update: () => void;
}

function isOrbitLikeControls(value: unknown): value is OrbitLikeControls {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { readonly target?: unknown; readonly update?: unknown };
  if (typeof candidate.update !== "function") return false;
  const target = candidate.target;
  if (typeof target !== "object" || target === null) return false;
  const t = target as { readonly x?: unknown; readonly y?: unknown; readonly z?: unknown };
  return typeof t.x === "number" && typeof t.y === "number" && typeof t.z === "number";
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Vertical FOV of a perspective camera, defaulting when it is not perspective. */
function cameraVerticalFov(camera: { readonly type?: string; readonly fov?: number }): number {
  return camera.type === "PerspectiveCamera" && typeof camera.fov === "number"
    ? camera.fov
    : DEFAULT_VERTICAL_FOV;
}

export function CockpitPlanningCamera(): null {
  const activeMode = useCockpitStore((state) => state.activeMode);
  const dimensions = useRoomDimensionsStore((state) => state.dimensions);
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const goalRef = useRef<CameraPose | null>(null);
  const prevModeRef = useRef<CockpitMode | null>(null);

  // On entering the Flow lens (from any other lens, or as the opening lens),
  // compute the planning pose from the *current* camera and stash it to ease to.
  useEffect(() => {
    const previousMode = prevModeRef.current;
    prevModeRef.current = activeMode;
    if (activeMode !== FLOW_LENS || previousMode === FLOW_LENS) return;
    if (!isOrbitLikeControls(controls)) return;
    const aspect = size.width / Math.max(size.height, 1);
    goalRef.current = planningCameraGoal(
      dimensions,
      [camera.position.x, camera.position.y, camera.position.z],
      [controls.target.x, controls.target.y, controls.target.z],
      aspect,
      cameraVerticalFov(camera),
    );
    invalidate();
  }, [activeMode, dimensions, camera, controls, size, invalidate]);

  useFrame(() => {
    const goal = goalRef.current;
    if (goal === null) return;
    if (!isOrbitLikeControls(controls)) {
      goalRef.current = null;
      return;
    }

    const px = goal.position[0] - camera.position.x;
    const py = goal.position[1] - camera.position.y;
    const pz = goal.position[2] - camera.position.z;
    const tx = goal.target[0] - controls.target.x;
    const ty = goal.target[1] - controls.target.y;
    const tz = goal.target[2] - controls.target.z;

    const reduced = prefersReducedMotion();
    if (reduced || Math.hypot(px, py, pz) < PLANNING_DONE) {
      camera.position.x += px;
      camera.position.y += py;
      camera.position.z += pz;
      controls.target.x += tx;
      controls.target.y += ty;
      controls.target.z += tz;
      controls.update();
      goalRef.current = null;
      invalidate();
      return;
    }

    camera.position.x += px * PLANNING_EASE;
    camera.position.y += py * PLANNING_EASE;
    camera.position.z += pz * PLANNING_EASE;
    controls.target.x += tx * PLANNING_EASE;
    controls.target.y += ty * PLANNING_EASE;
    controls.target.z += tz * PLANNING_EASE;
    controls.update();
    invalidate();
  });

  return null;
}
