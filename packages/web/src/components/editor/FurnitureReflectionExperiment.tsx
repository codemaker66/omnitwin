import { useLayoutEffect } from "react";
import { useThree } from "@react-three/fiber";
import { mountFurnitureReflectionExperiment } from "../../lib/furniture-reflection-experiment.js";

/** Optional image-based lighting for existing PBR proxies; no capture renderer,
 * background, camera, exposure, geometry or material factory is modified. */
export function FurnitureReflectionExperiment(): null {
  const { scene, gl, invalidate } = useThree();
  useLayoutEffect(() => mountFurnitureReflectionExperiment(scene, gl, invalidate), [scene, gl, invalidate]);
  return null;
}
