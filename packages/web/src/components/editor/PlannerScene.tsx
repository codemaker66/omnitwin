import { useMemo, type ReactElement } from "react";
import { Canvas } from "@react-three/fiber";
import type { SpaceDimensions } from "@omnitwin/types";
import { GRAND_HALL_RENDER_DIMENSIONS, scaleForRendering } from "../../constants/scale.js";
import { PlannerCanvasBoundary } from "../PlannerCanvasBoundary.js";
import { CameraRig } from "../CameraRig.js";
import { GrandHallRoom } from "../GrandHallRoom.js";
import { RoomMesh } from "./RoomMesh.js";
import { SectionPlane } from "../SectionPlane.js";
import { InvalidateOnToggle, AutoWallSelector } from "../WallTogglePanel.js";
import { XrayToggle } from "../XrayToggle.js";
import { MeasurementTool } from "../MeasurementTool.js";
import { TapeMeasure } from "../TapeMeasure.js";
import { PlacementGhost } from "../PlacementGhost.js";
import { DiagramLabels } from "../DiagramLabels.js";
import { PlacedFurniture } from "../PlacedFurniture.js";
import { SelectionSystem } from "../SelectionSystem.js";
import { MarqueeSelect } from "../MarqueeSelect.js";
import { SnapGuides } from "../SnapGuides.js";
import { CirculationOverlay } from "../CirculationOverlay.js";
import { MarkupLayer } from "../MarkupLayer.js";
import { SceneProvider } from "../SceneProvider.js";
import { PerfMonitor } from "../PerfMonitor.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { computeBoundingBox, resolveRoomGeometry } from "../../data/room-geometries.js";

/**
 * Computes render dimensions from room geometry polygon data.
 * Falls back to Grand Hall dimensions if no space is loaded.
 */
function useRoomDimensions(): SpaceDimensions {
  const space = useEditorStore((s) => s.space);
  return useMemo(() => {
    if (space === null) return GRAND_HALL_RENDER_DIMENSIONS;
    const geom = resolveRoomGeometry(space);
    if (geom !== null) {
      const bbox = computeBoundingBox(geom.wallPolygon);
      return scaleForRendering({ width: bbox.width, length: bbox.depth, height: geom.ceilingHeight });
    }
    return scaleForRendering({
      width: parseFloat(space.widthM),
      length: parseFloat(space.lengthM),
      height: parseFloat(space.heightM),
    });
  }, [space]);
}

/**
 * The live editable planner scene — the single R3F canvas plus every editing
 * system (room geometry, furniture, selection, markup, circulation, camera).
 * Extracted from App so the planner cockpit can host it in its stage cell.
 */
export function PlannerScene(): ReactElement {
  const space = useEditorStore((s) => s.space);
  const dimensions = useRoomDimensions();
  const roomGeometry = space !== null ? resolveRoomGeometry(space) : null;
  const roomVariant = space?.name === "Grand Hall" ? "grand-hall" : "generic";

  return (
    <PlannerCanvasBoundary>
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        camera={{ fov: 55, near: 0.1, far: 200 }}
        style={{ width: "100%", height: "100%" }}
      >
        <color attach="background" args={["#eee9de"]} />
        <fog attach="fog" args={["#efe9dc", 54, 138]} />
        <SceneProvider />
        <SectionPlane />
        <InvalidateOnToggle />
        {roomGeometry !== null ? (
          <RoomMesh geometry={roomGeometry} variant={roomVariant} />
        ) : (
          <>
            <AutoWallSelector />
            <GrandHallRoom />
          </>
        )}
        <XrayToggle />
        <MeasurementTool />
        <TapeMeasure />
        <PlacedFurniture />
        <PlacementGhost />
        <SelectionSystem />
        <SnapGuides />
        <CirculationOverlay />
        <MarqueeSelect />
        <MarkupLayer />
        <DiagramLabels />
        <CameraRig dimensions={dimensions} />
        {import.meta.env.DEV && <PerfMonitor />}
      </Canvas>
    </PlannerCanvasBoundary>
  );
}
