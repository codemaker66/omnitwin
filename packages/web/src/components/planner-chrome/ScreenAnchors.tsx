import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { Plane, Raycaster, Vector2, Vector3 } from "three";
import { projectScreenAnchors, screenAnchorCount, setScreenAnchorFrame, setScreenFloorPicker, type ScreenPoint, type WorldPoint } from "../../lib/screen-anchors.js";

// ---------------------------------------------------------------------------
// The one projector for the chrome's screen anchors (T-671 slice 11′; spec
// §6.6 "Following"). Mounted inside the planner's canvas; once a frame it
// puts each registered world point through the live camera and hands its
// writer canvas pixels. Nothing registered, nothing done. It also says
// which floor point lies under a canvas pixel, for the caption's Move.
// ---------------------------------------------------------------------------

export function ScreenAnchors(): null {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const scratch = useMemo(() => ({ projected: new Vector3(), inCamera: new Vector3() }), []);
  useEffect(() => setScreenAnchorFrame(() => { invalidate(); }), [invalidate]);
  // The floor under a canvas pixel: a ray from the camera to the floor plane (y = 0).
  useEffect(() => {
    const ray = new Raycaster();
    const floor = new Plane(new Vector3(0, 1, 0), 0);
    const ndc = new Vector2();
    const hit = new Vector3();
    return setScreenFloorPicker((x, y) => {
      if (size.width === 0 || size.height === 0) return null;
      ndc.set((x / size.width) * 2 - 1, -(y / size.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return ray.ray.intersectPlane(floor, hit) === null ? null : { x: hit.x, z: hit.z };
    });
  }, [camera, size]);

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
