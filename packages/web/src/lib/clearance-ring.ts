// ---------------------------------------------------------------------------
// Clearance ring — the judged clear zone around a selected dining table.
//
// Selecting a table draws a ring on the floor showing how much clear space
// the table actually has, live, judged against the planning-grade aisle
// rulebook in lib/circulation.ts: green when every neighbour keeps at least
// the single-file walkway (0.90 m), amber with a named reason when one does
// not. (The Stage goal phrases this as "lib/egress rules"; per-table aisle
// clearance lives in lib/circulation — lib/egress is exit-capacity maths.
// The mapping is flagged in T-562 rather than silently reinterpreted.)
//
// SAFE LANGUAGE: this is a PLANNING-GRADE circulation estimate, never a
// legal egress route or fire-code width — same rule CirculationOverlay
// follows.
//
// The ring radius is live: it hugs to the nearest obstruction (footprint
// half-diagonal + the actual clear gap), capped at the comfortable walkway —
// beyond comfortable, more space is not more pass. The circle is a deliberate
// simplification of the oriented footprint for display; the JUDGEMENT uses
// the exact convex-polygon gap, so a corner-to-corner pinch is never hidden
// by the circle's generosity.
// ---------------------------------------------------------------------------

import {
  CIRCULATION_AISLE,
  bandForGap,
  convexPolygonClosestPoints,
  footprintCorners,
  type CirculationBand,
  type FurnitureFootprint,
} from "./circulation.js";
import { placedCirculationFootprints } from "./circulation-scene.js";
import { getCatalogueItem } from "./catalogue.js";
import { isDiningTableItem } from "./furniture-semantics.js";
import type { PlacedItem } from "./placement.js";

export type ClearanceVerdict = "pass" | "fail";

export interface ClearanceRingModel {
  readonly itemId: string;
  /** Table label, for the reason text ("Trestle table"). */
  readonly label: string;
  /** Ring centre on the floor, metres (same space as footprints). */
  readonly centreX: number;
  readonly centreZ: number;
  /** Live ring radius: half-diagonal + min(nearest gap, comfortable). */
  readonly radiusM: number;
  readonly verdict: ClearanceVerdict;
  /** Exact clear gap to the nearest neighbour footprint, or null if alone. */
  readonly nearestGapM: number | null;
  readonly nearestLabel: string | null;
  /** Circulation band of the nearest gap — drives styling severity. */
  readonly band: CirculationBand;
  /** One-line reason, only when the verdict is fail. */
  readonly reason: string | null;
}

/** Radius of the circle that fully contains an oriented footprint. */
export function footprintHalfDiagonalM(f: FurnitureFootprint): number {
  return Math.hypot(f.width, f.depth) / 2;
}

function reasonForGap(gapM: number, neighbourLabel: string, band: CirculationBand): string | null {
  if (band === "blocked") {
    return `${gapM.toFixed(2)} m to ${neighbourLabel} — effectively impassable (needs ${
      CIRCULATION_AISLE.tightM.toFixed(2)} m)`;
  }
  if (band === "tight") {
    return `${gapM.toFixed(2)} m to ${neighbourLabel} — needs ${
      CIRCULATION_AISLE.tightM.toFixed(2)} m single-file`;
  }
  return null;
}

/**
 * Clearance rings for the currently selected dining tables.
 *
 * Judged live from the same footprint extraction the circulation HUD uses
 * (tables + passive freestanding AV; chairs deliberately excluded so a
 * table's own seating never reads as an obstruction). Pass = the nearest
 * neighbour keeps at least the single-file walkway; fail carries the named
 * neighbour and the rule it breaks.
 */
export function clearanceRingsForSelection(
  selectedIds: ReadonlySet<string>,
  placedItems: readonly PlacedItem[],
): readonly ClearanceRingModel[] {
  if (selectedIds.size === 0) return [];

  const footprints = placedCirculationFootprints(placedItems);
  if (footprints.length === 0) return [];

  const byId = new Map<string, FurnitureFootprint>();
  for (const f of footprints) byId.set(f.id, f);

  const rings: ClearanceRingModel[] = [];
  for (const id of selectedIds) {
    const footprint = byId.get(id);
    if (footprint === undefined) continue;
    const placed = placedItems.find((p) => p.id === id);
    if (placed === undefined) continue;
    const catalogueItem = getCatalogueItem(placed.catalogueItemId);
    if (catalogueItem === undefined || !isDiningTableItem(catalogueItem)) continue;

    const corners = footprintCorners(footprint);
    let nearestGapM: number | null = null;
    let nearestLabel: string | null = null;
    for (const other of footprints) {
      if (other.id === id) continue;
      const closest = convexPolygonClosestPoints(corners, footprintCorners(other));
      if (nearestGapM === null || closest.distance < nearestGapM) {
        nearestGapM = closest.distance;
        nearestLabel = other.label;
      }
    }

    const band = bandForGap(nearestGapM);
    const halfDiagonal = footprintHalfDiagonalM(footprint);
    const clearM = nearestGapM === null
      ? CIRCULATION_AISLE.comfortableM
      : Math.min(nearestGapM, CIRCULATION_AISLE.comfortableM);
    const failing = band === "tight" || band === "blocked";

    rings.push({
      itemId: id,
      label: footprint.label,
      centreX: footprint.cx,
      centreZ: footprint.cz,
      radiusM: halfDiagonal + clearM,
      verdict: failing ? "fail" : "pass",
      nearestGapM,
      nearestLabel,
      band,
      reason: failing && nearestGapM !== null && nearestLabel !== null
        ? reasonForGap(nearestGapM, nearestLabel, band)
        : null,
    });
  }
  return rings;
}

/**
 * The single ring whose reason deserves the floor pill: the tightest failing
 * one. Every failing ring shows amber; only the worst speaks — the same
 * primary-annotation philosophy CirculationOverlay applies to pinch lines.
 */
export function worstFailingRing(
  rings: readonly ClearanceRingModel[],
): ClearanceRingModel | null {
  let worst: ClearanceRingModel | null = null;
  for (const ring of rings) {
    if (ring.verdict !== "fail" || ring.nearestGapM === null) continue;
    if (worst === null || worst.nearestGapM === null || ring.nearestGapM < worst.nearestGapM) {
      worst = ring;
    }
  }
  return worst;
}
