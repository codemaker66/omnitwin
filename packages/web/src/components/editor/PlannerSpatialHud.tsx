import { useMemo } from "react";
import { getCatalogueItem } from "../../lib/catalogue.js";
import type { PlacedItem } from "../../lib/placement.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";
import { RENDER_SCALE } from "../../constants/scale.js";
import {
  computeCapacityIntelligence,
  inferSeatingStyle,
  comfortBandLabel,
} from "../../lib/layout-capacity.js";

interface HudStats {
  readonly roundTables: number;
  readonly banquetTables: number;
  readonly chairs: number;
  readonly stagedObjects: number;
  readonly dressedTables: number;
}

function computeHudStats(
  placedItems: readonly PlacedItem[],
): HudStats {
  let roundTables = 0;
  let banquetTables = 0;
  let chairs = 0;
  let stagedObjects = 0;
  let dressedTables = 0;

  for (const placed of placedItems) {
    const item = getCatalogueItem(placed.catalogueItemId);
    if (item === undefined) continue;

    if (item.category === "chair") chairs += 1;
    if (item.category === "stage") stagedObjects += 1;
    if (item.category === "table") {
      if (item.tableShape === "round") roundTables += 1;
      if (item.tableShape === "rectangular") banquetTables += 1;
      if (placed.clothed || placed.tableSetting !== null) dressedTables += 1;
    }
  }

  return { roundTables, banquetTables, chairs, stagedObjects, dressedTables };
}

function plural(value: number, singular: string, pluralLabel = `${singular}s`): string {
  return value === 1 ? `1 ${singular}` : `${value.toLocaleString("en-GB")} ${pluralLabel}`;
}

export function PlannerSpatialHud(): React.ReactElement {
  const placedItems = usePlacementStore((state) => state.placedItems);
  const dimensions = useRoomDimensionsStore((state) => state.dimensions);
  const stats = useMemo(() => computeHudStats(placedItems), [placedItems]);

  // Room dimensions are render-space (metres × RENDER_SCALE on X/Z); divide
  // back out for a real-metre floor area. Rectangular bounding-box area is a
  // planning-grade approximation, which is exactly the altitude this HUD reports.
  const floorAreaM2 = useMemo(() => {
    const widthM = dimensions.width / RENDER_SCALE;
    const lengthM = dimensions.length / RENDER_SCALE;
    return widthM * lengthM;
  }, [dimensions.width, dimensions.length]);

  const seatingStyle = useMemo(
    () => inferSeatingStyle({
      roundTables: stats.roundTables,
      banquetTables: stats.banquetTables,
      chairs: stats.chairs,
    }),
    [stats.roundTables, stats.banquetTables, stats.chairs],
  );

  const capacity = useMemo(
    () => computeCapacityIntelligence(floorAreaM2, stats.chairs, seatingStyle),
    [floorAreaM2, stats.chairs, seatingStyle],
  );

  const hasLayout = stats.roundTables > 0 || stats.banquetTables > 0 || stats.chairs > 0;
  const gaugeFill = Math.min(100, capacity.utilizationPercent);
  const styleLabel = seatingStyle.replace(/-/g, " ");

  return (
    <aside className="planner-spatial-hud" data-testid="planner-spatial-hud" aria-label="Layout summary">
      <section className="planner-spatial-hud__panel planner-spatial-hud__panel--spaces">
        <div className="planner-spatial-hud__title">Spaces</div>
        <div className="planner-spatial-hud__list">
          <HudRow color="#f08a21" label="Dining rounds" detail={plural(stats.roundTables, "round table")} />
          <HudRow color="#dcc64d" label="Banquet row" detail={plural(stats.banquetTables, "trestle")} />
          <HudRow color="#32b77a" label="Seating" detail={plural(stats.chairs, "chair")} />
          <HudRow
            color="#be8fc1"
            label="Stage / service"
            detail={stats.stagedObjects > 0 ? plural(stats.stagedObjects, "object") : "Open floor"}
          />
        </div>
      </section>

      <section className="planner-spatial-hud__panel planner-spatial-hud__panel--capacity">
        <div className="planner-spatial-hud__title">Capacity</div>
        <div
          className="planner-spatial-hud__gauge"
          style={{ "--capacity": `${String(gaugeFill)}%` } as React.CSSProperties}
          aria-label={`${String(stats.chairs)} seats planned, comfortable planning capacity about ${String(capacity.comfortableCapacity)} guests`}
        >
          <div className="planner-spatial-hud__gauge-inner">
            <span>{stats.chairs.toLocaleString("en-GB")}</span>
            <small>/ {capacity.comfortableCapacity.toLocaleString("en-GB")}</small>
          </div>
        </div>
        <div className="planner-spatial-hud__caption">
          {hasLayout
            ? comfortBandLabel(capacity.band)
            : "Start placing furniture to build capacity"}
        </div>
        {hasLayout && capacity.spacePerGuestM2 !== null && (
          <div className="planner-spatial-hud__subcaption">
            {capacity.spacePerGuestM2.toFixed(1)} m²/guest · {styleLabel} · ~{capacity.comfortableCapacity.toLocaleString("en-GB")} comfortable
          </div>
        )}
        <div className="planner-spatial-hud__subcaption">
          {stats.dressedTables > 0 ? `${plural(stats.dressedTables, "table")} dressed` : "No dressed tables yet"}
        </div>
        <div className="planner-spatial-hud__subcaption" style={{ opacity: 0.66, fontSize: "0.7em" }}>
          Planning-grade estimate · not a legal or fire capacity · human review required
        </div>
      </section>
    </aside>
  );
}

function HudRow({
  color,
  label,
  detail,
}: {
  readonly color: string;
  readonly label: string;
  readonly detail: string;
}): React.ReactElement {
  return (
    <div className="planner-spatial-hud__row">
      <span className="planner-spatial-hud__dot" style={{ backgroundColor: color }} aria-hidden="true" />
      <span className="planner-spatial-hud__row-copy">
        <strong>{label}</strong>
        <span>{detail}</span>
      </span>
    </div>
  );
}
