import { useEffect, useMemo } from "react";
import { Plane, Vector3 } from "three";
import { useThree } from "@react-three/fiber";
import { useSectionStore } from "../stores/section-store.js";

// ---------------------------------------------------------------------------
// Shared clipping plane — single horizontal slice from above
// ---------------------------------------------------------------------------

/**
 * One clipping plane that cuts the room from the top down, letting users
 * peel back the ceiling to see inside. Materials that should be clipped
 * reference `sectionClipPlanes`; materials that should remain visible
 * (floor, grid) reference `noClipPlanes`.
 */
export const sectionClipPlanes: Plane[] = [
  new Plane(new Vector3(0, -1, 0), 7), // top — default to ceiling height
];

/** Convenience alias for the single clip plane. */
export const sectionClipPlane = sectionClipPlanes[0] as Plane;

/** Empty array for materials that should never be clipped. */
export const noClipPlanes: Plane[] = [];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Updates the shared clipping plane based on the section store's height.
 *
 * Uses per-material clipping (localClippingEnabled) so floor, grid, and
 * guidelines are excluded from clipping.
 */
export function SectionPlane(): null {
  const { gl, invalidate } = useThree();
  const height = useSectionStore((s) => s.height);

  // Ensure local clipping is enabled on the renderer
  useMemo(() => {
    gl.localClippingEnabled = true;
  }, [gl]);

  useEffect(() => {
    const top = sectionClipPlanes[0];
    if (top === undefined) return;
    top.constant = height;
    invalidate();
  }, [height, invalidate]);

  // Invalidate when store changes externally (e.g. slider drag)
  useEffect(() => {
    return useSectionStore.subscribe(() => { invalidate(); });
  }, [invalidate]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      gl.localClippingEnabled = false;
    };
  }, [gl]);

  return null;
}
