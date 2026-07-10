import { Suspense, type ReactElement } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { SparkSplatLayer } from "../scene/SparkSplatLayer.js";

export interface PublicRoomRuntimeCanvasProps {
  readonly visualUrl: string;
  readonly onLoaded: () => void;
  readonly onFailed: () => void;
}

export const PUBLIC_ROOM_RUNTIME_MIN_DPR = 1;
export const PUBLIC_ROOM_RUNTIME_MAX_DPR = 1;
export const PUBLIC_ROOM_RUNTIME_PERFORMANCE = {
  min: 0.7,
  debounce: 180,
} as const;

export function PublicRoomRuntimeCanvas({
  visualUrl,
  onLoaded,
  onFailed,
}: PublicRoomRuntimeCanvasProps): ReactElement {
  return (
    <Canvas
      className="room-showcase-runtime-canvas"
      frameloop="demand"
      camera={{ position: [0, 1.7, 4.8], fov: 48 }}
      dpr={[PUBLIC_ROOM_RUNTIME_MIN_DPR, PUBLIC_ROOM_RUNTIME_MAX_DPR]}
      performance={PUBLIC_ROOM_RUNTIME_PERFORMANCE}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
    >
      <color attach="background" args={["#111318"]} />
      <ambientLight intensity={1.6} />
      <Suspense fallback={null}>
        <SparkSplatLayer
          url={visualUrl}
          opacity={1}
          position={[0, -1.1, 0]}
          scale={1}
          onLoad={onLoaded}
          onError={onFailed}
        />
      </Suspense>
      <OrbitControls
        regress
        enableDamping
        enablePan={false}
        minDistance={1.8}
        maxDistance={8}
        target={[0, 0.6, 0]}
      />
    </Canvas>
  );
}
