import { useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useXrayStore } from "../stores/xray-store.js";
import { letter, usePlannerKeyBindings, type KeyBinding } from "../lib/planner-keys.js";

const XRAY_KEYS: readonly KeyBinding[] = [{
  keys: letter("x"),
  run: () => { useXrayStore.getState().toggle(); },
}];

/**
 * X-Ray mode controller — R3F component (must be inside Canvas).
 *
 * Handles:
 * - X toggles x-ray mode (through the planner's one keyboard owner)
 * - useFrame to advance the 200ms opacity fade and invalidate during transition
 *
 * This component renders nothing — it's a pure side-effect controller.
 */
export function XrayToggle(): null {
  const { invalidate } = useThree();

  usePlannerKeyBindings(XRAY_KEYS);

  // Invalidate when xray is toggled (by X or a toolbar button)
  useEffect(() => {
    return useXrayStore.subscribe(() => { invalidate(); });
  }, [invalidate]);

  // Advance opacity fade each frame
  useFrame((_state, delta) => {
    const stillTransitioning = useXrayStore.getState().update(delta);
    if (stillTransitioning) {
      invalidate();
    }
  });

  return null;
}
