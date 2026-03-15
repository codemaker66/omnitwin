import { useEffect, useMemo } from "react";
import { Plane, Vector3 } from "three";
import { useThree } from "@react-three/fiber";
import { useSectionStore } from "../stores/section-store.js";

/**
 * The shared clipping plane array used by clippable materials.
 *
 * This is a module-level singleton so that GrandHallRoom can reference
 * the same Plane object that SectionPlane updates each frame.
 * Materials that should be clipped set `material.clippingPlanes = sectionClipPlanes`.
 * Materials that should NOT be clipped (floor, grid, human figure) leave it empty.
 */
export const sectionClipPlane = new Plane(new Vector3(0, -1, 0), 0);
export const sectionClipPlanes: Plane[] = [sectionClipPlane];

/** Empty array for materials that should never be clipped. */
export const noClipPlanes: Plane[] = [];

/**
 * Updates the shared section clipping plane based on the store's height.
 *
 * Uses per-material clipping (localClippingEnabled) rather than global
 * renderer.clippingPlanes, so floor, grid, and human figure are excluded
 * from clipping and always remain visible.
 */
export function SectionPlane(): null {
  const { gl, invalidate } = useThree();
  const height = useSectionStore((s) => s.height);
  const maxHeight = useSectionStore((s) => s.maxHeight);

  // Ensure local clipping is enabled on the renderer
  useMemo(() => {
    gl.localClippingEnabled = true;
  }, [gl]);

  useEffect(() => {
    // Update the shared plane's constant (y position for clipping)
    sectionClipPlane.constant = height;
    invalidate();
  }, [height, maxHeight, invalidate]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      gl.localClippingEnabled = false;
    };
  }, [gl]);

  return null;
}
