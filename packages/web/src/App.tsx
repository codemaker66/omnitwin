import { Canvas } from "@react-three/fiber";
import { FirstPersonControls } from "./components/FirstPersonControls.js";
import { GrandHallRoom, CAMERA_EYE_HEIGHT } from "./components/GrandHallRoom.js";
import { PerfMonitor } from "./components/PerfMonitor.js";
import { PerfOverlay } from "./components/PerfOverlay.js";

/**
 * Root application component.
 * Canvas is configured with:
 * - frameloop="demand": only re-render when invalidated (no wasted GPU frames)
 * - dpr={[1, 2]}: cap device pixel ratio at 2x to prevent 9x overdraw on Retina
 * - powerPreference="high-performance": hint browser to use discrete GPU
 * - camera at eye height (1.7m) inside the Grand Hall, looking toward +Z
 *
 * Dev-only performance monitor: PerfMonitor (inside Canvas) samples frame timing
 * and draw calls; PerfOverlay (outside Canvas) renders the HTML overlay.
 * Toggle with backtick (`) key.
 */
export function App(): React.ReactElement {
  return (
    <>
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        camera={{ position: [0, CAMERA_EYE_HEIGHT, 0], fov: 75, near: 0.1, far: 100 }}
      >
        <color attach="background" args={["#1a1a2e"]} />
        <GrandHallRoom />
        <FirstPersonControls />
        {import.meta.env.DEV && <PerfMonitor />}
      </Canvas>
      {import.meta.env.DEV && <PerfOverlay />}
    </>
  );
}
