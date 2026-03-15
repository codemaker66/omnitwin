import { useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useXrayStore } from "../stores/xray-store.js";

/**
 * X-Ray mode controller — R3F component (must be inside Canvas).
 *
 * Handles:
 * - X key shortcut to toggle x-ray mode
 * - useFrame to advance the 200ms opacity fade and invalidate during transition
 *
 * This component renders nothing — it's a pure side-effect controller.
 */
export function XrayToggle(): null {
  const { invalidate } = useThree();

  // X key shortcut
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      // Ignore if typing in an input
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (event.code !== "KeyX") return;

      useXrayStore.getState().toggle();
      invalidate();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, [invalidate]);

  // Invalidate when xray is toggled externally (e.g. toolbar button)
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
