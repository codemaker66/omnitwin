import { SectionSlider } from "./components/SectionSlider.js";
import { MeasurementOverlay } from "./components/MeasurementOverlay.js";
import { PlacementHint } from "./components/PlacementHint.js";
import { PlacementNotice } from "./components/editor/PlacementNotice.js";
import { MarkupPersistence } from "./components/MarkupPersistence.js";
import { ChairCountDialog } from "./components/ChairCountDialog.js";
import { CameraReferenceComposer, CameraReferenceHeightSwitch } from "./components/CameraReferenceComposer.js";
import { PlannerCommandDeck } from "./components/editor/PlannerCommandDeck.js";
import { PlannerSpatialHud } from "./components/editor/PlannerSpatialHud.js";
import { VerticalToolbox } from "./components/editor/VerticalToolbox.js";
import { PlannerScene } from "./components/editor/PlannerScene.js";
import { GeneratedFurnitureProxyBadge } from "./components/editor/cockpit/FurnitureInspectionDock.js";
import { usePlacementStore } from "./stores/placement-store.js";
import { useChairDialogStore } from "./stores/chair-dialog-store.js";
import { useCatalogueStore } from "./stores/catalogue-store.js";
import { useLayoutTimelinePreviewStore } from "./stores/layout-timeline-preview-store.js";
import { useIsCoarsePointer, useIsNarrowViewport } from "./hooks/use-media-query.js";
import { usePlannerRoomDimensions } from "./hooks/use-planner-room-dimensions.js";
import "./App.css";

export function App({ compactDesktop = false }: { readonly compactDesktop?: boolean }): React.ReactElement {
  const chairRequest = useChairDialogStore((s) => s.pending);
  const isNarrow = useIsNarrowViewport();
  const isTouch = useIsCoarsePointer();
  const mobileChrome = isNarrow || isTouch;
  // The room's size, from the loaded space; the section, bookmark and
  // room-size stores follow it (shared with the new chrome's room stage).
  usePlannerRoomDimensions();
  const timelinePreviewActive = useLayoutTimelinePreviewStore((state) => state.mode !== "inactive");

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

      {!compactDesktop && <GeneratedFurnitureProxyBadge />}

      {/* Vertical icon toolbox — left edge (≥641px) or bottom rail (≤640px) */}
      <MarkupPersistence />
      {!timelinePreviewActive && <VerticalToolbox compactDesktop={compactDesktop} />}
      {!timelinePreviewActive && !mobileChrome && (
        <>
          {!compactDesktop && <PlannerSpatialHud />}
          <PlannerCommandDeck compact={compactDesktop} />
        </>
      )}

      {!timelinePreviewActive && !mobileChrome && !compactDesktop && (
        <div className="planner-section-slider-dock">
          <SectionSlider />
        </div>
      )}

      {!timelinePreviewActive && <MeasurementOverlay />}
      {!timelinePreviewActive && <PlacementHint />}
      {!timelinePreviewActive && <PlacementNotice mobile={mobileChrome} />}
      {!timelinePreviewActive && <CameraReferenceComposer />}
      {!timelinePreviewActive && <CameraReferenceHeightSwitch />}

      {!timelinePreviewActive && <ChairCountDialog
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
      />}
    </div>
  );
}
