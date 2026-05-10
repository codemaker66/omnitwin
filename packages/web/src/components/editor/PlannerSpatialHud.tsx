import { useMemo } from "react";
import { getCatalogueItem } from "../../lib/catalogue.js";
import type { PlacedItem } from "../../lib/placement.js";
import { usePlacementStore } from "../../stores/placement-store.js";

interface HudStats {
  readonly roundTables: number;
  readonly banquetTables: number;
  readonly chairs: number;
  readonly stagedObjects: number;
  readonly dressedTables: number;
}

const COMFORTABLE_CAPACITY = 200;

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
  const stats = useMemo(() => computeHudStats(placedItems), [placedItems]);
  const capacityPercent = Math.min(100, Math.round((stats.chairs / COMFORTABLE_CAPACITY) * 100));
  const hasLayout = stats.roundTables > 0 || stats.banquetTables > 0 || stats.chairs > 0;

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
          style={{ "--capacity": `${String(capacityPercent)}%` } as React.CSSProperties}
          aria-label={`${String(stats.chairs)} seats planned, ${String(capacityPercent)} percent of comfortable capacity`}
        >
          <div className="planner-spatial-hud__gauge-inner">
            <span>{stats.chairs.toLocaleString("en-GB")}</span>
            <small>/ {COMFORTABLE_CAPACITY}</small>
          </div>
        </div>
        <div className="planner-spatial-hud__caption">
          {hasLayout
            ? `${String(capacityPercent)}% of comfortable planning capacity`
            : "Start placing furniture to build capacity"}
        </div>
        <div className="planner-spatial-hud__subcaption">
          {stats.dressedTables > 0 ? `${plural(stats.dressedTables, "table")} dressed` : "No dressed tables yet"}
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
