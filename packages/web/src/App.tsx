import { Canvas } from "@react-three/fiber";
import { GRAND_HALL_RENDER_DIMENSIONS } from "./constants/scale.js";
import { CameraRig } from "./components/CameraRig.js";
import { GrandHallRoom } from "./components/GrandHallRoom.js";
import { SectionPlane } from "./components/SectionPlane.js";
import { SectionSlider } from "./components/SectionSlider.js";
import { WallTogglePanel, AutoWallSelector, InvalidateOnToggle } from "./components/WallTogglePanel.js";
import { BookmarkPanel } from "./components/BookmarkPanel.js";
import { XrayToggle } from "./components/XrayToggle.js";
import { MeasurementTool } from "./components/MeasurementTool.js";
import { MeasurementOverlay } from "./components/MeasurementOverlay.js";
import { Toolbar } from "./components/Toolbar.js";
import { PerfMonitor } from "./components/PerfMonitor.js";
import { PerfOverlay } from "./components/PerfOverlay.js";
import { useSectionStore } from "./stores/section-store.js";
import { useBookmarkStore } from "./stores/bookmark-store.js";

// Initialize stores with Grand Hall dimensions
useSectionStore.getState().setMaxHeight(GRAND_HALL_RENDER_DIMENSIONS.height);
useBookmarkStore.getState().initialize(GRAND_HALL_RENDER_DIMENSIONS);

/**
 * Root application component — venue planning tool.
 *
 * Canvas configured with:
 * - frameloop="demand": only re-render when invalidated (orbit/pan/zoom)
 * - dpr={[1, 2]}: cap device pixel ratio at 2x
 * - powerPreference="high-performance": hint browser to use discrete GPU
 * - Orbital camera: establishing shot looking down at the room
 *
 * Camera interaction (RTS-style, like StarCraft 2):
 * - WASD / Arrow keys: pan camera across the room
 * - Scroll wheel: zoom in/out
 * - Right-click drag: orbit (rotate around look-at point)
 * - Middle-click drag: pan
 * - Left-click: reserved for object selection
 *
 * Section slider (right side):
 * - Drag down to slice away walls/ceiling from top
 * - Drag up to restore full 3D view
 */
export function App(): React.ReactElement {
  return (
    <>
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        camera={{ fov: 55, near: 0.1, far: 200 }}
      >
        <color attach="background" args={["#f5f5f0"]} />
        <SectionPlane />
        <AutoWallSelector />
        <InvalidateOnToggle />
        <GrandHallRoom />
        <XrayToggle />
        <MeasurementTool />
        <CameraRig dimensions={GRAND_HALL_RENDER_DIMENSIONS} />
        {import.meta.env.DEV && <PerfMonitor />}
      </Canvas>
      {/* Right-side toolbar: wall toggle icon + section slider */}
      <div style={{
        position: "absolute",
        right: 20,
        top: "50%",
        transform: "translateY(-50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        zIndex: 10,
        pointerEvents: "auto",
      }}>
        <WallTogglePanel />
        <SectionSlider />
      </div>
      {/* Bottom-left: camera bookmarks */}
      <BookmarkPanel />
      {/* Top-right: tool tray (measure, x-ray, etc.) */}
      <Toolbar />
      <MeasurementOverlay />
      {import.meta.env.DEV && <PerfOverlay />}
    </>
  );
}
