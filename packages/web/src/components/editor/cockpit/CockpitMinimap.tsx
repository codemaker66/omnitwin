import { useEffect, useMemo, useRef, type MouseEvent, type ReactElement } from "react";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../../stores/room-dimensions-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useLayoutTimelinePreviewStore } from "../../../stores/layout-timeline-preview-store.js";
import { useCockpitReplay } from "../../../hooks/use-cockpit-replay.js";
import { getCatalogueItem } from "../../../lib/catalogue.js";
import type { PlacedItem } from "../../../lib/placement.js";
import {
  minimapLayout,
  minimapProject,
  minimapToWorld,
} from "../../../lib/cockpit-minimap-model.js";
import { projectReplayPointToFloor } from "../../../lib/cockpit-overlay-projection.js";
import {
  cockpitOverlayLayers,
  conflictSeverityColor,
  selectRouteConflicts,
  shouldLoadReplay,
} from "../../../lib/cockpit-scene-overlay-model.js";
import { FloatingWidgetFrame, type FloatingWidgetPlacement } from "../../shared/FloatingWidgetFrame.js";
import "./CockpitMinimap.css";

// ---------------------------------------------------------------------------
// CockpitMinimap — a live top-down plan inset of the editable scene.
//
// Reflects the real placed furniture and the room footprint (planning
// overview, not a survey). In the Flow / Evidence lenses it doubles as a
// review radar: the simulated route-conflict markers are projected onto the
// plan so spatial review evidence reads at a glance. Clicking anywhere eases
// the planner camera to recentre there via the cockpit-store focus request.
//
// SAFE: conflict markers are *simulated* planning evidence requiring human
// review — never measured or certified.
// ---------------------------------------------------------------------------

const MINIMAP_MAX_PX = 132;
const HERITAGE_INSET_M = 1.2;
const MAX_MINIMAP_CONFLICTS = 4;
const MINIMAP_AVOID_PADDING_PX = 14;
const MINIMAP_DEFAULT_PLACEMENT: FloatingWidgetPlacement = {
  type: "anchor",
  anchor: "top-left",
  offsetX: 84,
  offsetY: 112,
};
const MINIMAP_AVOID_SELECTORS = [
  ".planner-status-header",
  ".cockpit-layer-controls",
  "[data-testid='planner-toolbar']",
  "[data-floating-widget-id='planner-view-mode']",
  ".planner-command-deck",
  ".planner-section-slider-dock",
  "[data-testid='truth-mode-indicator']",
  "[data-testid='truth-mode-popover']",
  ".planner-spatial-hud",
  "[data-testid='save-send-panel']",
  "[data-testid='cockpit-bottom']",
] as const;

function dotColor(category: string | undefined): string {
  switch (category) {
    case "table":
      return "#f08a21";
    case "chair":
      return "#32b77a";
    case "stage":
      return "#be8fc1";
    default:
      return "#b8ad92";
  }
}

interface MinimapConflictMarker {
  readonly id: string;
  readonly left: number;
  readonly top: number;
  readonly color: string;
  readonly message: string;
}

function TimelinePreviewMinimapDots({
  layout,
}: {
  readonly layout: ReturnType<typeof minimapLayout>;
}): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const draw = (items: readonly PlacedItem[]): void => {
      const canvas = canvasRef.current;
      if (canvas === null) return;
      canvas.dataset.previewObjectCount = String(items.length);
      const context = canvas.getContext("2d");
      if (context === null) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      for (const item of items) {
        const { left, top } = minimapProject(item.x, item.z, layout);
        const category = getCatalogueItem(item.catalogueItemId)?.category;
        context.beginPath();
        context.arc(left, top, 3.5, 0, Math.PI * 2);
        context.fillStyle = dotColor(category);
        context.fill();
      }
    };

    draw(useLayoutTimelinePreviewStore.getState().currentItems);
    return useLayoutTimelinePreviewStore.subscribe((state, previous) => {
      if (state.currentItems === previous.currentItems) return;
      draw(state.currentItems);
    });
  }, [layout]);

  return (
    <canvas
      ref={canvasRef}
      className="cockpit-minimap__preview-canvas"
      width={Math.ceil(layout.width)}
      height={Math.ceil(layout.height)}
      aria-label="Phase preview furniture positions"
    />
  );
}

export function CockpitMinimap(): ReactElement {
  const placedItems = usePlacementStore((state) => state.placedItems);
  const dimensions = useRoomDimensionsStore((state) => state.dimensions);
  const requestFocus = useCockpitStore((state) => state.requestFocus);
  const activeMode = useCockpitStore((state) => state.activeMode);
  const overlayVisibility = useCockpitStore((state) => state.overlayVisibility);
  const cameraInteractionActive = useCockpitStore((state) => state.cameraInteractionActive);
  const timelinePreviewActive = useLayoutTimelinePreviewStore((state) => state.activeFrame !== null);

  const layout = useMemo(() => minimapLayout(dimensions, MINIMAP_MAX_PX), [dimensions]);
  const layers = useMemo(
    () => cockpitOverlayLayers(overlayVisibility, activeMode),
    [overlayVisibility, activeMode],
  );
  const replayNeeded = useMemo(
    () => !timelinePreviewActive && shouldLoadReplay(overlayVisibility, activeMode),
    [overlayVisibility, activeMode, timelinePreviewActive],
  );
  const { artifact, bounds } = useCockpitReplay(replayNeeded);

  const conflictMarkers = useMemo<readonly MinimapConflictMarker[]>(() => {
    if (timelinePreviewActive || !layers.routeConflicts || artifact === null || bounds === null) return [];
    return selectRouteConflicts(artifact.routeConflicts, MAX_MINIMAP_CONFLICTS).map((conflict) => {
      const [x, , z] = projectReplayPointToFloor(conflict.point, bounds, dimensions, 0);
      const pixel = minimapProject(x, z, layout);
      return {
        id: conflict.id,
        left: pixel.left,
        top: pixel.top,
        color: conflictSeverityColor(conflict.severity),
        message: conflict.message,
      };
    });
  }, [timelinePreviewActive, layers.routeConflicts, artifact, bounds, dimensions, layout]);

  const heritageInset = Math.min(
    HERITAGE_INSET_M * layout.scale,
    layout.width / 2 - 2,
    layout.height / 2 - 2,
  );

  const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    const { x, z } = minimapToWorld(event.clientX - rect.left, event.clientY - rect.top, layout);
    requestFocus(x, z);
  };

  const note = timelinePreviewActive
    ? "Phase preview · saved plan unchanged · click to recentre"
    : conflictMarkers.length > 0
    ? `${String(conflictMarkers.length)} simulated review marker${conflictMarkers.length === 1 ? "" : "s"} · click to recentre`
    : "Planning overview · click to recentre";

  return (
    <FloatingWidgetFrame
      id="cockpit-minimap"
      title="Plan view"
      compactLabel="Plan"
      className="cockpit-minimap-widget"
      bodyClassName="cockpit-minimap-widget__body"
      defaultPlacement={MINIMAP_DEFAULT_PLACEMENT}
      avoidSelectors={MINIMAP_AVOID_SELECTORS}
      avoidPaddingPx={MINIMAP_AVOID_PADDING_PX}
      zIndex={36}
      autoCompact={cameraInteractionActive}
    >
      <aside className="cockpit-minimap" aria-label="Plan view minimap">
        <button
          type="button"
          className="cockpit-minimap__plate"
          style={{ width: layout.width, height: layout.height }}
          onClick={handleClick}
          aria-label="Recentre the planner camera on a point in the room"
        >
          {heritageInset > 0 && (
            <span
              className="cockpit-minimap__heritage"
              style={{ inset: `${String(heritageInset)}px` }}
              aria-hidden="true"
            />
          )}
          {timelinePreviewActive ? <TimelinePreviewMinimapDots layout={layout} /> : placedItems.map((item) => {
            const { left, top } = minimapProject(item.x, item.z, layout);
            const category = getCatalogueItem(item.catalogueItemId)?.category;
            return (
              <span
                key={item.id}
                className="cockpit-minimap__dot"
                style={{ left: `${String(left)}px`, top: `${String(top)}px`, background: dotColor(category) }}
                aria-hidden="true"
              />
            );
          })}
          {conflictMarkers.map((marker) => (
            <span
              key={marker.id}
              className="cockpit-minimap__conflict"
              style={{
                left: `${String(marker.left)}px`,
                top: `${String(marker.top)}px`,
                background: marker.color,
                color: marker.color,
              }}
              title={marker.message}
              aria-hidden="true"
            />
          ))}
        </button>
        <p className="cockpit-minimap__note">{note}</p>
      </aside>
    </FloatingWidgetFrame>
  );
}
