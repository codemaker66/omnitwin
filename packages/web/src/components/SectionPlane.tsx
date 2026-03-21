import { useEffect, useMemo } from "react";
import { Plane, Vector3 } from "three";
import { useThree } from "@react-three/fiber";
import { useSectionStore } from "../stores/section-store.js";
import { getFullRoomBounds } from "../lib/section-box.js";

// ---------------------------------------------------------------------------
// Shared clipping plane arrays — referenced by materials in GrandHallRoom
// ---------------------------------------------------------------------------

/**
 * Always 6 clipping planes. In "plane" mode, 5 of them are pushed to
 * extreme values so only the top plane clips. In "box" mode, all 6 are
 * active from the box bounds.
 *
 * Using a fixed-size array avoids Three.js shader recompilation on mode
 * switch (shader is compiled for N clipping planes).
 *
 * Order: top, bottom, left, right, back, front.
 */
/** Large constant that pushes a clipping plane far enough to never clip the room. */
const FAR_CONSTANT = 10000;

const _room = getFullRoomBounds();

export const sectionClipPlanes: Plane[] = [
  new Plane(new Vector3(0, -1, 0), _room.maxY),    // [0] top — default to ceiling
  new Plane(new Vector3(0, 1, 0), FAR_CONSTANT),    // [1] bottom — inactive
  new Plane(new Vector3(1, 0, 0), FAR_CONSTANT),    // [2] left — inactive
  new Plane(new Vector3(-1, 0, 0), FAR_CONSTANT),   // [3] right — inactive
  new Plane(new Vector3(0, 0, 1), FAR_CONSTANT),    // [4] back — inactive
  new Plane(new Vector3(0, 0, -1), FAR_CONSTANT),   // [5] front — inactive
];

/** Convenience alias for the top clip plane (index 0). */
export const sectionClipPlane = sectionClipPlanes[0] as Plane;

/** Empty array for materials that should never be clipped. */
export const noClipPlanes: Plane[] = [];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Updates the shared section clipping planes based on the store's state.
 *
 * In "plane" mode: only the top plane clips (bottom/left/right/back/front
 * are pushed to extreme values so they never intersect the room).
 * In "box" mode: all 6 planes clip from box bounds.
 *
 * Uses per-material clipping (localClippingEnabled) so floor, grid, and
 * guidelines are excluded from clipping.
 */
export function SectionPlane(): null {
  const { gl, invalidate } = useThree();
  const height = useSectionStore((s) => s.height);
  const maxHeight = useSectionStore((s) => s.maxHeight);
  const mode = useSectionStore((s) => s.mode);
  const boxBounds = useSectionStore((s) => s.boxBounds);

  // Ensure local clipping is enabled on the renderer
  useMemo(() => {
    gl.localClippingEnabled = true;
  }, [gl]);

  useEffect(() => {
    const top = sectionClipPlanes[0];
    const bottom = sectionClipPlanes[1];
    const left = sectionClipPlanes[2];
    const right = sectionClipPlanes[3];
    const back = sectionClipPlanes[4];
    const front = sectionClipPlanes[5];
    if (!top || !bottom || !left || !right || !back || !front) return;

    if (mode === "plane") {
      // Only top plane active — push others to extreme values
      top.constant = height;
      bottom.constant = FAR_CONSTANT;
      left.constant = FAR_CONSTANT;
      right.constant = FAR_CONSTANT;
      back.constant = FAR_CONSTANT;
      front.constant = FAR_CONSTANT;
    } else {
      // Box mode — all 6 planes from bounds
      // Plane equation: normal · P + constant = 0
      // Fragments where normal · P + constant < 0 are clipped.
      //
      // top:    normal (0,-1,0), clips y > maxY → constant = maxY
      // bottom: normal (0,+1,0), clips y < minY → constant = -minY
      // left:   normal (+1,0,0), clips x < minX → constant = -minX
      // right:  normal (-1,0,0), clips x > maxX → constant = maxX
      // back:   normal (0,0,+1), clips z < minZ → constant = -minZ
      // front:  normal (0,0,-1), clips z > maxZ → constant = maxZ
      top.constant = boxBounds.maxY;
      bottom.constant = -boxBounds.minY;
      left.constant = -boxBounds.minX;
      right.constant = boxBounds.maxX;
      back.constant = -boxBounds.minZ;
      front.constant = boxBounds.maxZ;
    }

    invalidate();
  }, [height, maxHeight, mode, boxBounds, invalidate]);

  // B key toggles section box mode
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (event.code !== "KeyB") return;

      useSectionStore.getState().toggleBox();
      invalidate();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, [invalidate]);

  // Invalidate when store changes externally (e.g. toolbar button, slider drag)
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
