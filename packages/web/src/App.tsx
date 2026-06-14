import { useEffect, useMemo } from "react";
import { GRAND_HALL_RENDER_DIMENSIONS, scaleForRendering } from "./constants/scale.js";
import type { SpaceDimensions } from "@omnitwin/types";
import { SectionSlider } from "./components/SectionSlider.js";
import { MeasurementOverlay } from "./components/MeasurementOverlay.js";
import { PlacementHint } from "./components/PlacementHint.js";
import { PerfOverlay } from "./components/PerfOverlay.js";
import { MarkupPersistence } from "./components/MarkupPersistence.js";
import { ChairCountDialog } from "./components/ChairCountDialog.js";
import { CameraReferenceComposer, CameraReferenceHeightSwitch } from "./components/CameraReferenceComposer.js";
import { PlannerCommandDeck } from "./components/editor/PlannerCommandDeck.js";
import { PlannerSpatialHud } from "./components/editor/PlannerSpatialHud.js";
import { VerticalToolbox } from "./components/editor/VerticalToolbox.js";
import { PlannerScene } from "./components/editor/PlannerScene.js";
import { useSectionStore } from "./stores/section-store.js";
import { useBookmarkStore } from "./stores/bookmark-store.js";
import { usePlacementStore } from "./stores/placement-store.js";
import { useChairDialogStore } from "./stores/chair-dialog-store.js";
import { useCatalogueStore } from "./stores/catalogue-store.js";
import { useEditorStore } from "./stores/editor-store.js";
import { useRoomDimensionsStore } from "./stores/room-dimensions-store.js";
import { computeBoundingBox, resolveRoomGeometry } from "./data/room-geometries.js";
import { useIsCoarsePointer, useIsNarrowViewport } from "./hooks/use-media-query.js";
import "./App.css";

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

  return (
    <div className="venviewer-planner-shell">
      {/* Canvas sits inside a wrapper whose padding is driven by CSS vars that
          VerticalToolbox sets on <html>. Desktop: --toolbox-offset = 68 (the
          left rail width), --toolbox-bottom = 0. Mobile (≤640): --toolbox-offset
          = 0 and --toolbox-bottom = 56 (the bottom rail height). The 3D canvas
          always fills the non-toolbar area regardless of viewport — previously
          a hardcoded marginLeft: 52 ate into narrow mobile viewports AND
          didn't match the toolbar's real width of 68 on desktop. */}
      <div
        className="planner-canvas-stage"
        style={{
          position: "absolute",
          inset: 0,
          paddingLeft: "var(--toolbox-offset, 68px)",
          paddingBottom: "var(--toolbox-bottom, 0px)",
          boxSizing: "border-box",
          touchAction: "none",
        }}
      >
        <PlannerScene />
      </div>

      {/* Vertical icon toolbox — left edge (≥641px) or bottom rail (≤640px) */}
      <MarkupPersistence />
      <VerticalToolbox />
      {!mobileChrome && (
        <>
          <PlannerSpatialHud />
          <PlannerCommandDeck />
        </>
      )}

      {!mobileChrome && (
        <div className="planner-section-slider-dock">
          <SectionSlider />
        </div>
      )}

      <MeasurementOverlay />
      <PlacementHint />
      <CameraReferenceComposer />
      <CameraReferenceHeightSwitch />

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
    </div>
  );
}
