// ---------------------------------------------------------------------------
// circulation-scene — bridges the planning-grade circulation engine (metres)
// to the render-space 3D scene (render units) and to band colours.
//
// The geometry engine in `circulation.ts` is pure and unit-agnostic: it works
// in metres. The planner scene positions furniture in render units
// (metres × RENDER_SCALE on X/Z; see constants/scale.ts). These helpers are
// the single, tested seam between the two coordinate systems, shared by the
// HUD readout and the in-scene overlay so they can never drift apart.
//
// SAFE LANGUAGE: colours and segments here visualise a PLANNING-GRADE estimate
// only — never a legal egress route or fire-code width. The wording lives in
// `circulationBandLabel` (circulation.ts); this module adds no new claims.
// ---------------------------------------------------------------------------

import { getCatalogueItem } from "./catalogue.js";
import type { PlacedItem } from "./placement.js";
import { RENDER_SCALE } from "../constants/scale.js";
import {
  computeCirculation,
  bandForGap,
  type CirculationBand,
  type CirculationGap,
  type CirculationReport,
  type FurnitureFootprint,
} from "./circulation.js";

/** Height above the floor (render units) at which the overlay line is drawn. */
export const CIRCULATION_OVERLAY_Y = 0.09;

/**
 * Extract table footprints (in metres) from placed items. Only `table`-category
 * items count as circulation obstacles — chairs cluster at their table, so
 * including them would report the intentionally tiny chair-to-table gaps
 * instead of the walkways between table groups. Render-space x/z divide back to
 * metres; catalogue width/depth are already metres.
 */
export function placedTableFootprints(placedItems: readonly PlacedItem[]): FurnitureFootprint[] {
  const footprints: FurnitureFootprint[] = [];
  for (const placed of placedItems) {
    const item = getCatalogueItem(placed.catalogueItemId);
    if (item === undefined || item.category !== "table") continue;
    footprints.push({
      id: placed.id,
      label: item.name,
      cx: placed.x / RENDER_SCALE,
      cz: placed.z / RENDER_SCALE,
      width: item.width,
      depth: item.depth,
      rotation: placed.rotationY,
    });
  }
  return footprints;
}

/** Compute the circulation report straight from placed items (tables only). */
export function placedItemsCirculation(placedItems: readonly PlacedItem[]): CirculationReport {
  return computeCirculation(placedTableFootprints(placedItems));
}

/** A render-space annotation for the tightest aisle, ready to draw in the scene. */
export interface CirculationOverlaySegment {
  /** Endpoint on footprint A, render units `[x, y, z]`. */
  readonly from: readonly [number, number, number];
  /** Endpoint on footprint B, render units. */
  readonly to: readonly [number, number, number];
  /** Midpoint of the segment, render units (where the label sits). */
  readonly mid: readonly [number, number, number];
  /** True clear gap, metres (already a planning-grade estimate). */
  readonly gapM: number;
  readonly band: CirculationBand;
  /** Band colour for the line and label. */
  readonly color: string;
  /** Whether the gap warrants attention (tight or blocked). */
  readonly emphasis: boolean;
  /** The headline (tightest) aisle, drawn prominently; secondaries are subtle. */
  readonly primary: boolean;
}

/** Band → colour, aligned with the HUD's warning palette. */
export function circulationBandColor(band: CirculationBand): string {
  switch (band) {
    case "open":
      return "#9a8f74";
    case "generous":
      return "#32b77a";
    case "comfortable":
      return "#7bbf59";
    case "tight":
      return "#d98324";
    case "blocked":
      return "#c0473a";
  }
}

/** Map one gap (metres) to a render-space overlay segment, banded by its own gap. */
function gapToOverlaySegment(
  gap: CirculationGap,
  primary: boolean,
  renderScale: number,
  floorY: number,
): CirculationOverlaySegment {
  const band = bandForGap(gap.gapM);
  const ax = gap.pointA.x * renderScale;
  const az = gap.pointA.z * renderScale;
  const bx = gap.pointB.x * renderScale;
  const bz = gap.pointB.z * renderScale;
  return {
    from: [ax, floorY, az],
    to: [bx, floorY, bz],
    mid: [(ax + bx) / 2, floorY, (az + bz) / 2],
    gapM: gap.gapM,
    band,
    color: circulationBandColor(band),
    emphasis: band === "tight" || band === "blocked",
    primary,
  };
}

/**
 * Map a circulation report to a render-space overlay segment for the tightest
 * aisle, or null when there is nothing meaningful to draw (fewer than two
 * tables). Witness points are in metres; multiply by `renderScale` to land them
 * in the scene — the exact inverse of `placedTableFootprints`.
 */
export function circulationOverlaySegment(
  report: CirculationReport,
  renderScale: number = RENDER_SCALE,
  floorY: number = CIRCULATION_OVERLAY_Y,
): CirculationOverlaySegment | null {
  const pair = report.tightestPair;
  if (report.band === "open" || pair === null) return null;
  return gapToOverlaySegment(pair, true, renderScale, floorY);
}

/**
 * Every aisle worth drawing: the headline tightest pair (`primary`) followed by
 * each *other* sub-comfortable pinch point (`primary: false`), so a layout with
 * several tight or blocked aisles surfaces all of them — not just the worst.
 * Returns an empty array when there is nothing to draw (fewer than two tables).
 *
 * `problemGaps[0]` coincides with the tightest pair, so the secondaries are
 * exactly `problemGaps.slice(1)`. When the tightest aisle is itself comfortable
 * or generous there are no problem pairs, and only the primary is returned.
 */
export function circulationOverlaySegments(
  report: CirculationReport,
  renderScale: number = RENDER_SCALE,
  floorY: number = CIRCULATION_OVERLAY_Y,
): CirculationOverlaySegment[] {
  const primary = circulationOverlaySegment(report, renderScale, floorY);
  if (primary === null) return [];
  const segments = [primary];
  for (const gap of report.problemGaps.slice(1)) {
    segments.push(gapToOverlaySegment(gap, false, renderScale, floorY));
  }
  return segments;
}
