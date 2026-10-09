// ---------------------------------------------------------------------------
// HallViewDirector — glides the planner's camera to a requested framing
//
// Plan looks straight down on the floor; Room frames the whole hall from a
// high corner; Walk hands the camera to the eye-level interior controller.
// The glide reuses the planner's camera transition (CameraRig samples it, and
// it honours reduced motion), so every framing change feels the same.
// ---------------------------------------------------------------------------

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { useHallViewStore, type HallViewPreset } from "../../stores/hall-view-store.js";
import { useBookmarkStore } from "../../stores/bookmark-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { HALL_HALF_LENGTH, HALL_HALF_WIDTH, HALL_HEIGHT } from "./hall-spec.js";

type Pose = { readonly position: readonly [number, number, number]; readonly target: readonly [number, number, number] };

/** Framings for the Grand Hall, in metres. Plan sits just inside the orbit's polar limit. */
export const HALL_VIEW_POSES: Readonly<Record<Exclude<HallViewPreset, "walk">, Pose>> = {
  plan: { position: [0, 21.5, 2.3], target: [0, 0, 0] },
  room: { position: [10.2, 12.6, 13.2], target: [0, 0.6, 0] },
};

/** Where Walk mode stands you in the hall: by the east doors, facing the fireplace. */
export const HALL_WALK = {
  spawn: { position: [8.4, 1.62, 2.4] as [number, number, number], yaw: Math.PI / 2 - 0.12, pitch: 0.05 },
  bounds: {
    min: [-HALL_HALF_LENGTH + 0.35, 0, -HALL_HALF_WIDTH + 0.35] as [number, number, number],
    max: [HALL_HALF_LENGTH - 0.35, HALL_HEIGHT - 0.6, HALL_HALF_WIDTH - 0.35] as [number, number, number],
  },
} as const;

interface OrbitTarget { readonly target: { readonly x: number; readonly y: number; readonly z: number } }

function hasTarget(value: unknown): value is OrbitTarget {
  return typeof value === "object" && value !== null && "target" in value;
}

export function HallViewDirector(): null {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls);
  const invalidate = useThree((state) => state.invalidate);
  const request = useHallViewStore((state) => state.viewRequest);

  useEffect(() => {
    if (request === null) return;
    const store = useHallViewStore.getState();
    const cockpit = useCockpitStore.getState();
    if (request.preset === "walk") {
      cockpit.setWalkMode(true);
      store.clearViewRequest(request.nonce);
      invalidate();
      return;
    }
    // Leaving the room restores the orbit pose first; the glide starts there.
    if (cockpit.walkMode) cockpit.setWalkMode(false);
    const pose = HALL_VIEW_POSES[request.preset];
    const current = hasTarget(controls) ? controls.target : { x: 0, y: 0, z: 0 };
    useBookmarkStore.getState().startTransition(
      { id: `hall-view-${request.preset}`, name: request.preset === "plan" ? "Plan" : "Room", position: pose.position, target: pose.target, kind: "default" },
      [camera.position.x, camera.position.y, camera.position.z],
      [current.x, current.y, current.z],
    );
    store.clearViewRequest(request.nonce);
    invalidate();
  }, [camera, controls, invalidate, request]);

  return null;
}
