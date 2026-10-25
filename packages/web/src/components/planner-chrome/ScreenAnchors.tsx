import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { Vector3 } from "three";
import { projectScreenAnchors, screenAnchorCount, setScreenAnchorFrame, type ScreenPoint, type WorldPoint } from "../../lib/screen-anchors.js";

// ---------------------------------------------------------------------------
// The one projector for the chrome's screen anchors (T-671 slice 11′; spec
// §6.6 "Following"). Mounted inside the planner's canvas; once a frame it
// puts each registered world point through the live camera and hands its
// writer canvas pixels. Nothing registered, nothing done.
// ---------------------------------------------------------------------------

export function ScreenAnchors(): null {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const scratch = useMemo(() => ({ projected: new Vector3(), inCamera: new Vector3() }), []);
  useEffect(() => setScreenAnchorFrame(() => { invalidate(); }), [invalidate]);

  useFrame(() => {
    if (screenAnchorCount() === 0) return;
    projectScreenAnchors((world: WorldPoint): ScreenPoint => {
      const projected = scratch.projected.set(world[0], world[1], world[2]).project(camera);
      const inCamera = scratch.inCamera.set(world[0], world[1], world[2]).applyMatrix4(camera.matrixWorldInverse);
      const visible = inCamera.z < 0 && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1;
      return { x: (projected.x + 1) * size.width / 2, y: (1 - projected.y) * size.height / 2, visible };
    });
  });

  return null;
}
