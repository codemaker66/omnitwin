import { useMemo } from "react";
import { getCatalogueItem } from "../../lib/catalogue.js";
import type { PlacedItem } from "../../lib/placement.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { RENDER_SCALE } from "../../constants/scale.js";
import {
  computeCapacityIntelligence,
  inferSeatingStyle,
  comfortBandLabel,
  type CapacityIntelligence,
} from "../../lib/layout-capacity.js";
import {
  GENERIC_ESTIMATE_LABEL,
  plannerLayoutStyle,
  publishedFiguresPhrase,
  publishedFormatForStyle,
  type PublishedCapacityAnswer,
  type PublishedFormat,
} from "../../lib/planner-truth.js";
import { usePlannerTruth } from "../../hooks/use-planner-truth.js";
import { ActivityStatus } from "../shared/Activity.js";
import { seatingCountsFromPlacedItems } from "../../lib/seating-counts.js";
import { isDiningTableItem } from "../../lib/furniture-semantics.js";
import { isSceneFurniturePlacement } from "../../lib/table-dressing.js";
import { circulationBandLabel } from "../../lib/circulation.js";
import { countLabel } from "../../lib/count-label.js";
import { placedItemsCirculation } from "../../lib/circulation-scene.js";
import { gradeLayout, type LayoutBand, type RecommendationSeverity } from "../../lib/layout-intelligence.js";
import { FloatingWidgetFrame, type FloatingWidgetPlacement } from "../shared/FloatingWidgetFrame.js";

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
    if (!isSceneFurniturePlacement(placed)) continue;
    const item = getCatalogueItem(placed.catalogueItemId);
    if (item === undefined) continue;

    if (item.category === "stage") stagedObjects += 1;
    if (isDiningTableItem(item) && (placed.clothed || placed.tableSetting !== null)) {
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
    case "B": return "#c98a5b";
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

const HUD_DEFAULT_PLACEMENT: FloatingWidgetPlacement = {
  type: "anchor",
  anchor: "top-right",
  offsetX: 22,
  offsetY: 104,
};

const HUD_AVOID_SELECTORS = [
  ".planner-status-header",
  ".cockpit-layer-controls",
  "[data-testid='planner-toolbar']",
  "[data-floating-widget-id='planner-view-mode']",
  "[data-floating-widget-id='cockpit-minimap']",
  ".planner-command-deck",
  ".planner-section-slider-dock",
  "[data-testid='truth-mode-indicator']",
  "[data-testid='truth-mode-popover']",
  "[data-testid='save-send-panel']",
  "[data-testid='cockpit-bottom']",
] as const;

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
  fontWeight: 600,
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
    fontWeight: 700,
    letterSpacing: 0,
    lineHeight: 1,
  };
}

function gradeScoreStyle(color: string): React.CSSProperties {
  return {
    color,
    fontSize: 20,
    fontWeight: 700,
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
    fontWeight: 600,
    letterSpacing: 0,
    lineHeight: 1.3,
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
  };
}

interface CapacityReadout {
  /** The figure the seats are counted against, or null to show seats alone. */
  readonly denominator: number | null;
  readonly fillPercent: number;
  readonly caption: string;
  readonly detail: string | null;
  /** Who stated the figure, and when, when a figure is shown. */
  readonly source: string | null;
  readonly disclosure: string;
  readonly ariaLabel: string;
  readonly reading: boolean;
}

interface CapacityReadoutInput {
  readonly staff: boolean;
  readonly published: PublishedCapacityAnswer;
  readonly format: PublishedFormat | null;
  readonly seats: number;
  readonly hasLayout: boolean;
  readonly capacity: CapacityIntelligence;
  readonly styleLabel: string;
}

/**
 * What the HUD's capacity panel may say to this viewer. Venue staff keep the
 * floor-area arithmetic, labelled as an estimate at generic spacing. Everyone
 * else is counted against the venue's published figure for the layout, with
 * who stated it and when, or sees seats alone: the computed count once read
 * "80 / 147" and "339" to visitors in a room the venue publishes at 180 and
 * 250 (redteam fix-first 1).
 */
function capacityReadout(input: CapacityReadoutInput): CapacityReadout {
  // "1 seat", "220 seats": one helper for every count label.
  const seats = countLabel(input.seats, "seat");
  const empty = "Start placing furniture to build capacity";
  if (input.staff) {
    const estimate = input.capacity.comfortableCapacity;
    return {
      denominator: estimate,
      fillPercent: Math.min(100, input.capacity.utilizationPercent),
      caption: input.hasLayout ? comfortBandLabel(input.capacity.band) : empty,
      detail: input.hasLayout && input.capacity.spacePerGuestM2 !== null
        ? `${input.capacity.spacePerGuestM2.toFixed(1)} m²/guest · ${input.styleLabel} · ~${estimate.toLocaleString("en-GB")} at generic spacing`
        : null,
      source: null,
      disclosure: `${GENERIC_ESTIMATE_LABEL} · venue staff only · not the venue's published figure`,
      ariaLabel: `${seats} planned; estimate at generic spacing about ${countLabel(estimate, "guest")}`,
      reading: false,
    };
  }
  const confirmed = "Final numbers are confirmed by the events team.";
  if (input.published.kind === "reading") {
    return {
      denominator: null, fillPercent: 0, caption: "Reading the venue's published figures…", detail: null,
      source: null, disclosure: confirmed, ariaLabel: `${seats} planned`, reading: true,
    };
  }
  if (input.published.kind === "not-published") {
    return {
      denominator: null, fillPercent: 0,
      caption: input.hasLayout ? "No published capacity for this room" : empty,
      detail: null, source: null, disclosure: confirmed, ariaLabel: `${seats} planned`, reading: false,
    };
  }
  const { capacity, source } = input.published;
  if (input.format === null) {
    return {
      denominator: null, fillPercent: 0,
      caption: input.hasLayout ? `The venue publishes no figure for ${input.styleLabel}` : empty,
      detail: input.hasLayout ? null : `Published ${publishedFiguresPhrase(capacity, null)}`,
      source: input.hasLayout ? null : source,
      disclosure: confirmed, ariaLabel: `${seats} planned`, reading: false,
    };
  }
  const figure = capacity[input.format];
  const above = input.seats > figure;
  return {
    denominator: figure,
    fillPercent: figure > 0 ? Math.min(100, Math.round((input.seats / figure) * 100)) : 0,
    caption: above
      ? `${seats} placed; the venue publishes ${publishedFiguresPhrase(capacity, input.format)}.`
      : `Published ${publishedFiguresPhrase(capacity, input.format)}`,
    detail: above ? "The events team will say what is possible." : null,
    source,
    disclosure: confirmed,
    ariaLabel: `${seats} planned; the venue publishes ${publishedFiguresPhrase(capacity, input.format)}`,
    reading: false,
  };
}

export function PlannerSpatialHud(): React.ReactElement {
  const placedItems = usePlacementStore((state) => state.placedItems);
  const dimensions = useRoomDimensionsStore((state) => state.dimensions);
  const cameraInteractionActive = useCockpitStore((state) => state.cameraInteractionActive);
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

  // Circulation: exact clearance between planning-relevant floor footprints.
  // Chairs and tabletop AV are excluded; the HUD and in-scene overlay share this
  // same computation so they cannot disagree.
  const circulation = useMemo(() => placedItemsCirculation(placedItems), [placedItems]);

  const hasLayout = stats.roundTables > 0 || stats.banquetTables > 0 || stats.chairs > 0;
  const styleLabel = seatingStyle.replace(/-/g, " ");
  const { staff, published } = usePlannerTruth();
  const publishedFormat = useMemo(() => publishedFormatForStyle(plannerLayoutStyle(placedItems)), [placedItems]);
  const readout = capacityReadout({
    staff,
    published,
    format: publishedFormat,
    seats: stats.chairs,
    hasLayout,
    capacity,
    styleLabel,
  });
  const gaugeFill = readout.fillPercent;

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
    <FloatingWidgetFrame
      id="planner-spatial-hud"
      title="Layout intelligence"
      compactLabel={`Grade ${grade.band}`}
      className="planner-spatial-hud-widget"
      bodyClassName="planner-spatial-hud-widget__body"
      defaultPlacement={HUD_DEFAULT_PLACEMENT}
      avoidSelectors={HUD_AVOID_SELECTORS}
      avoidPaddingPx={14}
      zIndex={33}
      autoCompact={cameraInteractionActive}
    >
      <aside
        className="planner-spatial-hud"
        data-testid="planner-spatial-hud"
        data-has-layout={hasLayout ? "true" : "false"}
        aria-label="Layout summary"
      >
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
            <HudRow color="#c98a5b" label="Banquet row" detail={plural(stats.banquetTables, "trestle")} />
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
            aria-label={readout.ariaLabel}
          >
            <div className="planner-spatial-hud__gauge-inner">
              <span>{stats.chairs.toLocaleString("en-GB")}</span>
              {readout.denominator !== null && <small>/ {readout.denominator.toLocaleString("en-GB")}</small>}
            </div>
          </div>
          <div className="planner-spatial-hud__caption" data-testid="planner-capacity-caption">
            {readout.reading ? <ActivityStatus>{readout.caption}</ActivityStatus> : readout.caption}
          </div>
          {readout.detail !== null && (
            <div className="planner-spatial-hud__subcaption planner-spatial-hud__subcaption--capacity-detail">
              {readout.detail}
            </div>
          )}
          {readout.source !== null && (
            <div className="planner-spatial-hud__subcaption" data-testid="planner-capacity-source">
              {readout.source}
            </div>
          )}
          {circulation.band !== "open" && circulation.tightestGapM !== null && (
            <div
              className="planner-spatial-hud__subcaption planner-spatial-hud__subcaption--circulation"
              style={
                circulation.band === "tight" || circulation.band === "blocked"
                  ? { color: "#d98324" }
                  : undefined
              }
            >
              Tightest furniture clearance {circulation.tightestGapM.toFixed(1)} m · {circulationBandLabel(circulation.band)}
            </div>
          )}
          {circulation.problemGaps.length > 1 && (
            <div className="planner-spatial-hud__subcaption planner-spatial-hud__subcaption--circulation" style={{ color: "#d98324" }}>
              {circulation.problemGaps.length} clearances below comfortable — flagged in the scene
            </div>
          )}
          <div className="planner-spatial-hud__subcaption planner-spatial-hud__subcaption--secondary">
            {stats.dressedTables > 0 ? `${plural(stats.dressedTables, "table")} dressed` : "No dressed tables yet"}
          </div>
          <div
            className="planner-spatial-hud__subcaption planner-spatial-hud__subcaption--disclosure"
            style={{ opacity: 0.66, fontSize: 12 }}
            data-testid="planner-capacity-disclosure"
          >
            {readout.disclosure}
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
          </div>
        </section>
      </aside>
    </FloatingWidgetFrame>
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
