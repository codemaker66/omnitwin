import { useMemo, type MouseEvent, type ReactElement } from "react";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../../stores/room-dimensions-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { getCatalogueItem } from "../../../lib/catalogue.js";
import {
  minimapLayout,
  minimapProject,
  minimapToWorld,
} from "../../../lib/cockpit-minimap-model.js";
import "./CockpitMinimap.css";

// ---------------------------------------------------------------------------
// CockpitMinimap — a live top-down plan inset of the editable scene.
//
// Reflects the real placed furniture and the room footprint (planning
// overview, not a survey). Doubles as navigation: clicking a point eases the
// planner camera to recentre there via the cockpit-store focus request, which
// the in-canvas CockpitCameraFocus consumes.
// ---------------------------------------------------------------------------

const MINIMAP_MAX_PX = 132;
const HERITAGE_INSET_M = 1.2;

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

export function CockpitMinimap(): ReactElement {
  const placedItems = usePlacementStore((state) => state.placedItems);
  const dimensions = useRoomDimensionsStore((state) => state.dimensions);
  const requestFocus = useCockpitStore((state) => state.requestFocus);

  const layout = useMemo(() => minimapLayout(dimensions, MINIMAP_MAX_PX), [dimensions]);
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

  return (
    <aside className="cockpit-minimap" aria-label="Plan view minimap">
      <header className="cockpit-minimap__title">Plan view</header>
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
        {placedItems.map((item) => {
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
      </button>
      <p className="cockpit-minimap__note">Planning overview · click to recentre</p>
    </aside>
  );
}
