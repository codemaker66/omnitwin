import { getCatalogueItem } from "./catalogue.js";
import type { PlacedItem } from "./placement.js";
import { seatingCountsFromPlacedItems } from "./seating-counts.js";
import { formatMinorAsCurrency } from "./money-input.js";

// ---------------------------------------------------------------------------
// cockpit-cost-model — layout-driven cost/revenue scenario (Epic 3, Costs lens).
//
// A what-if estimate: the QUANTITIES come from the live placed layout (covers,
// tables, chairs, AV items); the RATES are the planner's own editable inputs.
// All money is integer minor units (pence) with exact integer arithmetic — no
// floating point — matching the project's money discipline. This is a SCENARIO
// ESTIMATE, never a quote: it invents no venue pricing. The panel makes that
// explicit in its disclaimer.
// ---------------------------------------------------------------------------

export type CoversSource = "guest-count" | "placed-chairs" | "none";

export interface CostQuantities {
  readonly covers: number;
  readonly tables: number;
  readonly chairs: number;
  readonly avItems: number;
  /** Lighting fixtures from the rig (Lighting lens); 0 when no rig is set. */
  readonly lightingFixtures: number;
  /** Where the cover count came from, for honest display. */
  readonly coversSource: CoversSource;
}

/**
 * Derive cost quantities from the live layout. The planner's guest count
 * (`coversOverride`) wins; otherwise covers fall back to the placed chair count.
 * Lighting fixtures come from the rig (Lighting lens), not the floor layout.
 */
export function costQuantitiesFromLayout(
  placedItems: readonly PlacedItem[],
  coversOverride: number | null,
  lightingFixtures = 0,
): CostQuantities {
  const seating = seatingCountsFromPlacedItems(placedItems);
  const tables = seating.roundTables + seating.banquetTables;
  const chairs = seating.chairs;
  let avItems = 0;
  for (const placed of placedItems) {
    const item = getCatalogueItem(placed.catalogueItemId);
    if (item?.category === "av") avItems += 1;
  }
  const hasOverride = coversOverride !== null && Number.isFinite(coversOverride) && coversOverride > 0;
  const covers = hasOverride ? Math.floor(coversOverride) : chairs;
  const coversSource: CoversSource = hasOverride ? "guest-count" : chairs > 0 ? "placed-chairs" : "none";
  const rigFixtures = Number.isFinite(lightingFixtures) && lightingFixtures > 0 ? Math.floor(lightingFixtures) : 0;
  return { covers, tables, chairs, avItems, lightingFixtures: rigFixtures, coversSource };
}

export interface CostRates {
  readonly roomHireMinor: number;
  readonly cateringPerCoverMinor: number;
  readonly furniturePerTableMinor: number;
  readonly avPerItemMinor: number;
  /** Per-lighting-fixture hire rate; optional (0 when not priced). */
  readonly lightingPerFixtureMinor?: number;
  readonly marginPercent: number;
}

export interface CostLineItem {
  readonly key: string;
  readonly label: string;
  readonly detail: string;
  readonly amountMinor: number;
}

export interface CostScenarioModel {
  readonly lineItems: readonly CostLineItem[];
  readonly subtotalMinor: number;
  readonly marginMinor: number;
  readonly totalMinor: number;
  /** Total ÷ covers, or null when no covers are planned. */
  readonly perCoverMinor: number | null;
}

function nonNegativeMinor(minor: number): number {
  return Number.isFinite(minor) && minor > 0 ? Math.round(minor) : 0;
}

/** Build the cost scenario. Pure, exact integer arithmetic. */
export function buildCostScenario(quantities: CostQuantities, rates: CostRates): CostScenarioModel {
  const lineItems: CostLineItem[] = [
    { key: "room-hire", label: "Room hire", detail: "Flat venue hire", amountMinor: nonNegativeMinor(rates.roomHireMinor) },
  ];

  if (quantities.covers > 0) {
    const rate = nonNegativeMinor(rates.cateringPerCoverMinor);
    lineItems.push({
      key: "catering",
      label: "Catering",
      detail: `${quantities.covers.toLocaleString("en-GB")} covers × ${formatMinorAsCurrency(rate)}`,
      amountMinor: quantities.covers * rate,
    });
  }
  if (quantities.tables > 0) {
    const rate = nonNegativeMinor(rates.furniturePerTableMinor);
    lineItems.push({
      key: "furniture",
      label: "Furniture hire",
      detail: `${quantities.tables.toLocaleString("en-GB")} tables × ${formatMinorAsCurrency(rate)}`,
      amountMinor: quantities.tables * rate,
    });
  }
  if (quantities.avItems > 0) {
    const rate = nonNegativeMinor(rates.avPerItemMinor);
    lineItems.push({
      key: "av",
      label: "AV / equipment",
      detail: `${quantities.avItems.toLocaleString("en-GB")} items × ${formatMinorAsCurrency(rate)}`,
      amountMinor: quantities.avItems * rate,
    });
  }
  if (quantities.lightingFixtures > 0) {
    const rate = nonNegativeMinor(rates.lightingPerFixtureMinor ?? 0);
    lineItems.push({
      key: "lighting",
      label: "Lighting hire",
      detail: `${quantities.lightingFixtures.toLocaleString("en-GB")} fixtures × ${formatMinorAsCurrency(rate)}`,
      amountMinor: quantities.lightingFixtures * rate,
    });
  }

  const subtotalMinor = lineItems.reduce((sum, item) => sum + item.amountMinor, 0);
  const marginPercent = Number.isFinite(rates.marginPercent) && rates.marginPercent > 0 ? rates.marginPercent : 0;
  const marginMinor = Math.round((subtotalMinor * marginPercent) / 100);
  const totalMinor = subtotalMinor + marginMinor;
  const perCoverMinor = quantities.covers > 0 ? Math.round(totalMinor / quantities.covers) : null;

  return { lineItems, subtotalMinor, marginMinor, totalMinor, perCoverMinor };
}

/** Human label for where the cover count came from. */
export function coversSourceLabel(source: CoversSource): string {
  switch (source) {
    case "guest-count": return "from guest count";
    case "placed-chairs": return "from placed chairs";
    case "none": return "not set";
  }
}
