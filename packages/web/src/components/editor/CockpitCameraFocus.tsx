import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { EventDispatcher, Vector3 } from "three";
import { useCockpitStore } from "../../stores/cockpit-store.js";

// ---------------------------------------------------------------------------
// CockpitCameraFocus — eases the planner camera so it frames a floor point
// requested from the minimap. It nudges the default OrbitControls target (and
// the camera by the same XZ delta, preserving the orbit offset) toward the
// goal, then hands control straight back. Honours prefers-reduced-motion by
// snapping. Returns null — it only drives the camera.
// ---------------------------------------------------------------------------

const FOCUS_EASE = 0.16;
const FOCUS_DONE = 0.03;

// The default controls registered by OrbitControls(makeDefault) are a
// THREE.EventDispatcher at the type level; narrow to the orbit shape we use.
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
  const maybeTarget = target as { readonly x?: unknown; readonly z?: unknown };
  return typeof maybeTarget.x === "number" && typeof maybeTarget.z === "number";
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function CockpitCameraFocus(): null {
  const focusRequest = useCockpitStore((state) => state.focusRequest);
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls);
  const invalidate = useThree((state) => state.invalidate);
  const goalRef = useRef<{ readonly x: number; readonly z: number } | null>(null);

  useEffect(() => {
    if (focusRequest === null) return;
    goalRef.current = { x: focusRequest.x, z: focusRequest.z };
    invalidate();
  }, [focusRequest, invalidate]);

  useFrame(() => {
    const goal = goalRef.current;
    if (goal === null) return;
    if (!isOrbitLikeControls(controls)) return;

    const dx = goal.x - controls.target.x;
    const dz = goal.z - controls.target.z;
    const reduced = prefersReducedMotion();
    if (reduced || Math.hypot(dx, dz) < FOCUS_DONE) {
      controls.target.x += dx;
      controls.target.z += dz;
      camera.position.x += dx;
      camera.position.z += dz;
      controls.update();
      goalRef.current = null;
      invalidate();
      return;
    }

    const stepX = dx * FOCUS_EASE;
    const stepZ = dz * FOCUS_EASE;
    controls.target.x += stepX;
    controls.target.z += stepZ;
    camera.position.x += stepX;
    camera.position.z += stepZ;
    controls.update();
    invalidate();
  });

  return null;
}
