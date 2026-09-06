import { getHemisphereLightConfig } from "../lib/lighting.js";
import { useDeviceStore } from "../stores/device-store.js";

interface RoomLightingProps {
  readonly variant: "polygon" | "grand-hall";
}

/** Existing room light presets, independent of procedural shell visibility. */
export function RoomLighting({ variant }: RoomLightingProps): React.ReactElement {
  const tier = useDeviceStore((state) => state.tier);
  if (variant === "polygon") {
    return (
      <>
        <hemisphereLight args={["#f0f0ff", "#d0c8c0", 1.2]} />
        <ambientLight intensity={0.3} />
      </>
    );
  }

  const lightConfig = getHemisphereLightConfig(tier);
  return (
    <>
      <hemisphereLight
        args={[lightConfig.skyColor, lightConfig.groundColor, lightConfig.intensity]}
      />
      <ambientLight intensity={0.38} color="#f7ead0" />
      <directionalLight
        position={[12, 5.5, 9]}
        intensity={0.52}
        color="#f7dfae"
        castShadow={false}
      />
      <directionalLight
        position={[-10, 6, -8]}
        intensity={0.16}
        color="#e5edf4"
        castShadow={false}
      />
    </>
  );
}
