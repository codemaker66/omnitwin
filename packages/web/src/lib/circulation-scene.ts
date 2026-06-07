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
  type CirculationBand,
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

  const ax = pair.pointA.x * renderScale;
  const az = pair.pointA.z * renderScale;
  const bx = pair.pointB.x * renderScale;
  const bz = pair.pointB.z * renderScale;

  return {
    from: [ax, floorY, az],
    to: [bx, floorY, bz],
    mid: [(ax + bx) / 2, floorY, (az + bz) / 2],
    gapM: pair.gapM,
    band: report.band,
    color: circulationBandColor(report.band),
    emphasis: report.band === "tight" || report.band === "blocked",
  };
}
