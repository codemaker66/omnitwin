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
import { seatingCountsFromPlacedItems } from "../../lib/seating-counts.js";
import { circulationBandLabel } from "../../lib/circulation.js";
import { placedItemsCirculation } from "../../lib/circulation-scene.js";
import { gradeLayout, type LayoutBand, type RecommendationSeverity } from "../../lib/layout-intelligence.js";

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
  // Seating counts (round/banquet/chair) come from the shared helper so the
  // HUD, enquiry modal, and capacity engine can never disagree. The HUD also
  // needs stage + dressing tallies, which are HUD-only and computed here.
  const { roundTables, banquetTables, chairs } = seatingCountsFromPlacedItems(placedItems);
  let stagedObjects = 0;
  let dressedTables = 0;

  for (const placed of placedItems) {
    const item = getCatalogueItem(placed.catalogueItemId);
    if (item === undefined) continue;

    if (item.category === "stage") stagedObjects += 1;
    if (item.category === "table" && (placed.clothed || placed.tableSetting !== null)) {
      dressedTables += 1;
    }
  }

  return { roundTables, banquetTables, chairs, stagedObjects, dressedTables };
}

function plural(value: number, singular: string, pluralLabel = `${singular}s`): string {
  return value === 1 ? `1 ${singular}` : `${value.toLocaleString("en-GB")} ${pluralLabel}`;
}

function gradeBandColor(band: LayoutBand): string {
  switch (band) {
    case "S": return "#2bb673";
    case "A": return "#7bbf59";
    case "B": return "#dcc64d";
    case "C": return "#d98324";
    case "D": return "#c0473a";
  }
}

function recommendationColor(severity: RecommendationSeverity): string {
  switch (severity) {
    case "critical": return "#e06a5b";
    case "warning": return "#e0a24a";
    case "tip": return "#b8ad92";
    case "praise": return "#54c98e";
  }
}

const gradePanelBaseStyle: React.CSSProperties = {
  display: "grid",
  gap: 10,
  minHeight: 150,
  padding: "17px 18px 15px",
};

const gradeRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "52px minmax(0, 1fr)",
  gap: 13,
  alignItems: "center",
  minWidth: 0,
};

const gradeCopyStyle: React.CSSProperties = {
  display: "grid",
  minWidth: 0,
  gap: 4,
};

const gradeScoreDenominatorStyle: React.CSSProperties = {
  marginLeft: 2,
  color: "rgba(246, 239, 227, 0.56)",
  fontSize: 12,
  fontWeight: 680,
};

const gradeHeadlineStyle: React.CSSProperties = {
  display: "-webkit-box",
  overflow: "hidden",
  overflowWrap: "anywhere",
  color: "rgba(246, 239, 227, 0.84)",
  fontSize: 12,
  fontWeight: 720,
  letterSpacing: 0,
  lineHeight: 1.24,
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 2,
};

function gradeBadgeStyle(color: string): React.CSSProperties {
  return {
    display: "grid",
    placeItems: "center",
    width: 52,
    height: 52,
    border: `2px solid ${color}`,
    borderRadius: 999,
    background: "rgba(255, 255, 255, 0.04)",
    color,
    fontSize: 20,
    fontWeight: 820,
    letterSpacing: 0,
    lineHeight: 1,
  };
}

function gradeScoreStyle(color: string): React.CSSProperties {
  return {
    color,
    fontSize: 20,
    fontWeight: 820,
    letterSpacing: 0,
    lineHeight: 1,
  };
}

function gradeRecommendationStyle(color: string): React.CSSProperties {
  return {
    display: "-webkit-box",
    overflow: "hidden",
    overflowWrap: "anywhere",
    color,
    fontSize: 12,
    fontWeight: 720,
    letterSpacing: 0,
    lineHeight: 1.3,
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
  };
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

  // Circulation: exact aisle clearance between table footprints (tables only —
  // see placedTableFootprints for why chairs are excluded). The HUD and the
  // in-scene overlay share this same computation so they can never disagree.
  const circulation = useMemo(() => placedItemsCirculation(placedItems), [placedItems]);

  const hasLayout = stats.roundTables > 0 || stats.banquetTables > 0 || stats.chairs > 0;
  const gaugeFill = Math.min(100, capacity.utilizationPercent);
  const styleLabel = seatingStyle.replace(/-/g, " ");

  // Layout intelligence: synthesise the circulation + capacity + dressing
  // signals the HUD already computes into a single planning-grade grade.
  const grade = useMemo(
    () => gradeLayout({
      hasLayout,
      circulation,
      capacity,
      tableCount: stats.roundTables + stats.banquetTables,
      chairs: stats.chairs,
      dressedTables: stats.dressedTables,
    }),
    [hasLayout, circulation, capacity, stats.roundTables, stats.banquetTables, stats.chairs, stats.dressedTables],
  );
  const topRecommendation = grade.recommendations[0];
  const gradeColor = gradeBandColor(grade.band);
  const topRecommendationColor = topRecommendation === undefined
    ? gradeColor
    : recommendationColor(topRecommendation.severity);

  return (
    <aside className="planner-spatial-hud" data-testid="planner-spatial-hud" aria-label="Layout summary">
      <section
        className="planner-spatial-hud__panel planner-spatial-hud__panel--grade"
        data-testid="planner-layout-grade"
        aria-label={`Layout grade ${grade.band}, ${String(grade.score)} out of 100. ${grade.headline}`}
        style={{
          ...gradePanelBaseStyle,
          "--layout-grade-color": gradeColor,
          "--layout-recommendation-color": topRecommendationColor,
        } as React.CSSProperties}
      >
        <div className="planner-spatial-hud__title">Layout grade</div>
        <div className="planner-spatial-hud__grade-row" style={gradeRowStyle}>
          <span className="planner-spatial-hud__grade-badge" style={gradeBadgeStyle(gradeColor)} aria-hidden="true">
            {grade.band}
          </span>
          <span className="planner-spatial-hud__grade-copy" style={gradeCopyStyle}>
            <strong className="planner-spatial-hud__grade-score" style={gradeScoreStyle(gradeColor)}>
              {grade.score}
              <span className="planner-spatial-hud__grade-score-denominator" style={gradeScoreDenominatorStyle}>/100</span>
            </strong>
            <span className="planner-spatial-hud__grade-headline" style={gradeHeadlineStyle}>{grade.headline}</span>
          </span>
        </div>
        {topRecommendation !== undefined && (
          <div
            className="planner-spatial-hud__grade-recommendation"
            style={gradeRecommendationStyle(topRecommendationColor)}
          >
            {topRecommendation.message}
          </div>
        )}
      </section>

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

      <section className="planner-spatial-hud__panel planner-spatial-hud__panel--capacity" data-testid="planner-capacity-panel">
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
        {circulation.band !== "open" && circulation.tightestGapM !== null && (
          <div
            className="planner-spatial-hud__subcaption"
            style={
              circulation.band === "tight" || circulation.band === "blocked"
                ? { color: "#d98324" }
                : undefined
            }
          >
            Tightest table aisle {circulation.tightestGapM.toFixed(1)} m · {circulationBandLabel(circulation.band)}
          </div>
        )}
        {circulation.problemGaps.length > 1 && (
          <div className="planner-spatial-hud__subcaption" style={{ color: "#d98324" }}>
            {circulation.problemGaps.length} aisles below comfortable — flagged in the scene
          </div>
        )}
        <div className="planner-spatial-hud__subcaption">
          {stats.dressedTables > 0 ? `${plural(stats.dressedTables, "table")} dressed` : "No dressed tables yet"}
        </div>
        <div className="planner-spatial-hud__subcaption" style={{ opacity: 0.66, fontSize: 12 }}>
          Planning-grade estimate · human review required · final capacity confirmed by venue team
        </div>
      </section>

      <section className="planner-spatial-hud__panel planner-spatial-hud__panel--revenue">
        <div className="planner-spatial-hud__title">Revenue</div>
        <div style={{ display: "grid", gap: 6 }}>
          <strong style={{ color: hasLayout ? "#54c98e" : "#b8ad92", fontSize: 16 }}>
            {hasLayout ? "Scenario-ready layout" : "No quote linked"}
          </strong>
          <span style={{ color: "#d8d0c4", fontSize: 12, lineHeight: 1.35 }}>
            {hasLayout
              ? `${stats.chairs.toLocaleString("en-GB")} seats can feed a revenue scenario once quote or event data is linked.`
              : "Place furniture and link quote/event data to calculate exact commercial scenarios."}
          </span>
          <span style={{ color: "#b8ad92", fontSize: 12, lineHeight: 1.35 }}>
            Comfort status {capacity.band}; review constraints remain visible before commercial recommendations.
          </span>
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
