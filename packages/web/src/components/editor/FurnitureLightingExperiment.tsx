import { useMemo } from "react";
import { Color, Object3D } from "three";
import { usePlacementStore } from "../../stores/placement-store.js";
import {
  createFurnitureLightProbe,
  furnitureShadowFrame,
  refreshFurnitureShadowProjection,
  FURNITURE_KEY_RGB,
  FURNITURE_SHADOW_MAP_SIZE,
} from "../../lib/furniture-lighting-experiment.js";

/** Source-linked presentation experiment; no scene render pass or floor receiver. */
export function FurnitureLightingExperiment({ shadows }: { readonly shadows: boolean }): React.ReactElement {
  const items = usePlacementStore((state) => state.placedItems);
  const frame = useMemo(() => furnitureShadowFrame(items), [items]);
  const probe = useMemo(createFurnitureLightProbe, []);
  const target = useMemo(() => new Object3D(), []);
  // Constructor RGB is linear. Passing a CSS hex here would apply sRGB decoding twice.
  const keyColor = useMemo(() => new Color(...FURNITURE_KEY_RGB), []);
  return (
    <group name="furniture-lighting-panorama-experiment">
      <primitive object={probe} />
      <primitive object={target} position={frame.target} />
      <directionalLight
        name="panorama-upper-region-key"
        position={frame.position}
        target={target}
        color={keyColor}
        intensity={1}
        castShadow={shadows}
        onUpdate={refreshFurnitureShadowProjection}
        shadow-mapSize={[FURNITURE_SHADOW_MAP_SIZE, FURNITURE_SHADOW_MAP_SIZE]}
        shadow-camera-left={frame.left}
        shadow-camera-right={frame.right}
        shadow-camera-top={frame.top}
        shadow-camera-bottom={frame.bottom}
        shadow-camera-near={frame.near}
        shadow-camera-far={frame.far}
        shadow-bias={-0.00002}
        shadow-normalBias={0.005}
        shadow-radius={2}
      />
    </group>
  );
}
