import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { GRAND_HALL_RENDER_DIMENSIONS, scaleForRendering } from "./constants/scale.js";
import type { SpaceDimensions } from "@omnitwin/types";
import { CameraRig } from "./components/CameraRig.js";
import { GrandHallRoom } from "./components/GrandHallRoom.js";
import { RoomMesh } from "./components/editor/RoomMesh.js";
import { SectionPlane } from "./components/SectionPlane.js";
import { SectionSlider } from "./components/SectionSlider.js";
import { InvalidateOnToggle } from "./components/WallTogglePanel.js";
import { XrayToggle } from "./components/XrayToggle.js";
import { MeasurementTool } from "./components/MeasurementTool.js";
import { MeasurementOverlay } from "./components/MeasurementOverlay.js";
import { TapeMeasure } from "./components/TapeMeasure.js";
import { PlacementHint } from "./components/PlacementHint.js";
import { PerfMonitor } from "./components/PerfMonitor.js";
import { PerfOverlay } from "./components/PerfOverlay.js";
import { PlacementGhost } from "./components/PlacementGhost.js";
import { DiagramLabels } from "./components/DiagramLabels.js";
import { PlacedFurniture } from "./components/PlacedFurniture.js";
import { SelectionSystem } from "./components/SelectionSystem.js";
import { MarqueeSelect } from "./components/MarqueeSelect.js";
import { SnapGuides } from "./components/SnapGuides.js";
import { ChairCountDialog } from "./components/ChairCountDialog.js";
import { VerticalToolbox } from "./components/editor/VerticalToolbox.js";
import { useSectionStore } from "./stores/section-store.js";
import { useBookmarkStore } from "./stores/bookmark-store.js";
import { usePlacementStore } from "./stores/placement-store.js";
import { useChairDialogStore } from "./stores/chair-dialog-store.js";
import { useCatalogueStore } from "./stores/catalogue-store.js";
import { useEditorStore } from "./stores/editor-store.js";
import { roomGeometries, computeBoundingBox } from "./data/room-geometries.js";

// Initialize stores with Grand Hall dimensions (default)
useSectionStore.getState().setMaxHeight(GRAND_HALL_RENDER_DIMENSIONS.height);
useBookmarkStore.getState().initialize(GRAND_HALL_RENDER_DIMENSIONS);

/**
 * Computes render dimensions from room geometry polygon data.
 * Falls back to Grand Hall dimensions if no match.
 */
function useRoomDimensions(): SpaceDimensions {
  const space = useEditorStore((s) => s.space);
  return useMemo(() => {
    if (space === null) return GRAND_HALL_RENDER_DIMENSIONS;

    const geom = roomGeometries[space.name];
    if (geom === undefined) {
      return scaleForRendering({
        width: parseFloat(space.widthM),
        length: parseFloat(space.lengthM),
        height: parseFloat(space.heightM),
      });
    }

    const bbox = computeBoundingBox(geom.wallPolygon);
    return scaleForRendering({
      width: bbox.width,
      length: bbox.depth,
      height: geom.ceilingHeight,
    });
  }, [space]);
}

export function App(): React.ReactElement {
  const chairRequest = useChairDialogStore((s) => s.pending);
  const space = useEditorStore((s) => s.space);
  const dimensions = useRoomDimensions();

  const ceilingHeight = dimensions.height;
  useMemo(() => {
    useSectionStore.getState().setMaxHeight(ceilingHeight);
    useBookmarkStore.getState().initialize(dimensions);
  }, [ceilingHeight, dimensions]);

  const spaceName = space?.name ?? null;
  const roomGeometry = spaceName !== null ? roomGeometries[spaceName] ?? null : null;

  return (
    <>
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        camera={{ fov: 55, near: 0.1, far: 200 }}
        style={{ marginLeft: 52 }}
      >
        <color attach="background" args={["#f5f5f0"]} />
        <SectionPlane />
        <InvalidateOnToggle />
        {roomGeometry !== null ? (
          <RoomMesh geometry={roomGeometry} />
        ) : (
          <GrandHallRoom />
        )}
        <XrayToggle />
        <MeasurementTool />
        <TapeMeasure />
        <PlacedFurniture />
        <PlacementGhost />
        <SelectionSystem />
        <SnapGuides />
        <MarqueeSelect />
        <DiagramLabels />
        <CameraRig dimensions={dimensions} />
        {import.meta.env.DEV && <PerfMonitor />}
      </Canvas>

      {/* Vertical icon toolbox — left edge */}
      <VerticalToolbox />

      {/* Right-side controls */}
      <div style={{
        position: "absolute", right: 20, top: "50%", transform: "translateY(-50%)",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
        zIndex: 10, pointerEvents: "auto",
      }}>
        <SectionSlider />
      </div>

      <MeasurementOverlay />
      <PlacementHint />

      <ChairCountDialog
        request={chairRequest}
        onConfirm={(count) => {
          const editId = useChairDialogStore.getState().editTableId;
          if (editId !== null) {
            usePlacementStore.getState().rearrangeGroup(editId, count);
          } else if (chairRequest !== null) {
            if (count > 0) {
              usePlacementStore.getState().placeTableGroup(
                chairRequest.catalogueItemId,
                chairRequest.x,
                chairRequest.z,
                chairRequest.rotationY,
                count,
              );
            } else {
              usePlacementStore.getState().placeItem(
                chairRequest.catalogueItemId,
                chairRequest.x,
                chairRequest.z,
                chairRequest.rotationY,
              );
            }
          }
          const itemId = chairRequest?.catalogueItemId ?? null;
          useChairDialogStore.getState().clearDialog();
          // Re-select the same catalogue item so user can place another immediately
          if (itemId !== null) {
            useCatalogueStore.getState().selectItem(itemId);
          }
        }}
        onCancel={() => {
          useChairDialogStore.getState().clearDialog();
        }}
      />
      {import.meta.env.DEV && <PerfOverlay />}
    </>
  );
}
