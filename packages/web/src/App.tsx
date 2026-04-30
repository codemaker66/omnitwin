import { useEffect, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { GRAND_HALL_RENDER_DIMENSIONS, scaleForRendering } from "./constants/scale.js";
import type { SpaceDimensions } from "@omnitwin/types";
import { CameraRig } from "./components/CameraRig.js";
import { GrandHallRoom } from "./components/GrandHallRoom.js";
import { RoomMesh } from "./components/editor/RoomMesh.js";
import { SectionPlane } from "./components/SectionPlane.js";
import { SectionSlider } from "./components/SectionSlider.js";
import { InvalidateOnToggle, WallTogglePanel, AutoWallSelector } from "./components/WallTogglePanel.js";
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
import { SceneProvider } from "./components/SceneProvider.js";
import { ChairCountDialog } from "./components/ChairCountDialog.js";
import { VerticalToolbox } from "./components/editor/VerticalToolbox.js";
import { useSectionStore } from "./stores/section-store.js";
import { useBookmarkStore } from "./stores/bookmark-store.js";
import { usePlacementStore } from "./stores/placement-store.js";
import { useChairDialogStore } from "./stores/chair-dialog-store.js";
import { useCatalogueStore } from "./stores/catalogue-store.js";
import { useEditorStore } from "./stores/editor-store.js";
import { useRoomDimensionsStore } from "./stores/room-dimensions-store.js";
import { computeBoundingBox, resolveRoomGeometry } from "./data/room-geometries.js";
import { useIsCoarsePointer, useIsNarrowViewport } from "./hooks/use-media-query.js";

// Initialize stores with Grand Hall dimensions (default).
// Runs once at module load. The useEffect in App() re-initializes when
// the actual space dimensions are known.
useSectionStore.getState().setMaxHeight(GRAND_HALL_RENDER_DIMENSIONS.height);
useBookmarkStore.getState().initialize(GRAND_HALL_RENDER_DIMENSIONS);

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
      return scaleForRendering({
        width: bbox.width,
        length: bbox.depth,
        height: geom.ceilingHeight,
      });
    }

    // Defensive: no polygon available (shouldn't happen post Prompt 7,
    // which makes floor-plan outlines required on every space write).
    return scaleForRendering({
      width: parseFloat(space.widthM),
      length: parseFloat(space.lengthM),
      height: parseFloat(space.heightM),
    });
  }, [space]);
}

export function App(): React.ReactElement {
  const chairRequest = useChairDialogStore((s) => s.pending);
  const space = useEditorStore((s) => s.space);
  const isNarrow = useIsNarrowViewport();
  const isTouch = useIsCoarsePointer();
  const mobileChrome = isNarrow || isTouch;
  const dimensions = useRoomDimensions();

  const { width: dimW, length: dimL, height: dimH } = dimensions;
  useEffect(() => {
    useSectionStore.getState().setMaxHeight(dimH);
    useBookmarkStore.getState().initialize({ width: dimW, length: dimL, height: dimH });
    useRoomDimensionsStore.getState().setDimensions({ width: dimW, length: dimL, height: dimH });
  }, [dimW, dimL, dimH]);

  // Prefer the hand-authored Trades Hall geometry when the space name
  // matches; fall back to the space's own polygon (any admin-authored or
  // second-venue space); fall through to the GrandHallRoom stand-in when
  // no space is loaded at all.
  const roomGeometry = space !== null ? resolveRoomGeometry(space) : null;
  const roomVariant = space?.name === "Grand Hall" ? "grand-hall" : "generic";

  return (
    <>
      {/* Canvas sits inside a wrapper whose padding is driven by CSS vars that
          VerticalToolbox sets on <html>. Desktop: --toolbox-offset = 68 (the
          left rail width), --toolbox-bottom = 0. Mobile (≤640): --toolbox-offset
          = 0 and --toolbox-bottom = 56 (the bottom rail height). The 3D canvas
          always fills the non-toolbar area regardless of viewport — previously
          a hardcoded marginLeft: 52 ate into narrow mobile viewports AND
          didn't match the toolbar's real width of 68 on desktop. */}
      <div style={{
        position: "absolute",
        inset: 0,
        paddingLeft: "var(--toolbox-offset, 68px)",
        paddingBottom: "var(--toolbox-bottom, 0px)",
        boxSizing: "border-box",
      }}>
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        camera={{ fov: 55, near: 0.1, far: 200 }}
        style={{ width: "100%", height: "100%" }}
      >
        <color attach="background" args={["#f5f5f0"]} />
        <SceneProvider />
        <SectionPlane />
        <InvalidateOnToggle />
        {roomGeometry !== null ? (
          /* RoomMesh has its own CameraWallDriver — no AutoWallSelector needed */
          <RoomMesh geometry={roomGeometry} variant={roomVariant} />
        ) : (
          /* GrandHallRoom needs the standalone wall driver */
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
        <MarqueeSelect />
        <DiagramLabels />
        <CameraRig dimensions={dimensions} />
        {import.meta.env.DEV && <PerfMonitor />}
      </Canvas>
      </div>

      {/* Vertical icon toolbox — left edge (≥641px) or bottom rail (≤640px) */}
      <VerticalToolbox />

      {!mobileChrome && (
        <div style={{
          position: "absolute",
          right: 20,
          top: "50%",
          transform: "translateY(-50%)",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
          zIndex: 10, pointerEvents: "auto",
        }}>
          <WallTogglePanel />
          <SectionSlider />
        </div>
      )}

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
