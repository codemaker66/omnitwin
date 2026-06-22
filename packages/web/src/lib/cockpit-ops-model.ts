import { getCatalogueItem } from "./catalogue.js";
import type { PlacedItem } from "./placement.js";
import { seatingCountsFromPlacedItems } from "./seating-counts.js";
import { BAR_CATALOGUE_SLUG } from "./guest-flow-layout-input.js";

// ---------------------------------------------------------------------------
// cockpit-ops-model — the Ops lens's live setup plan (Epic 0, fifth real lens).
//
// Turns the placed layout into a load-in task list with an INDICATIVE effort
// estimate (crew-minutes per item type → suggested crew + setup window). This
// is the instant, no-backend preview behind the Ops lens; the panel also
// compiles the full server-side ops handoff pack from the saved configuration.
//
// Pure: no React, no API. SAFE: effort figures are planning-grade rules of
// thumb, not a guaranteed schedule — the panel keeps that wording visible and
// defers to the operations team.
// ---------------------------------------------------------------------------

/** Indicative crew-minutes per unit of work (planning-grade rules of thumb). */
export const OPS_EFFORT_MINUTES = {
  stage: 20,
  table: 3,
  dressTable: 4,
  chair: 0.5,
  bar: 15,
  av: 10,
  lectern: 5,
} as const;

/** Crew-minutes a single crew member is assumed to work in the target window. */
export const OPS_TARGET_SETUP_MINUTES = 90;

export interface OpsTaskLine {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly effortMinutes: number;
}

export interface OpsSetupPlan {
  readonly tasks: readonly OpsTaskLine[];
  /** Placeable items on the floor (tables + chairs + stage + bar + AV + lectern). */
  readonly totalItems: number;
  /** Sum of task effort in crew-minutes. */
  readonly totalCrewMinutes: number;
  /** Crew suggested to hit the target setup window. */
  readonly suggestedCrew: number;
  /** Estimated wall-clock setup time with the suggested crew, in minutes. */
  readonly estimatedSetupMinutes: number;
}

interface LayoutCounts {
  readonly roundTables: number;
  readonly banquetTables: number;
  readonly chairs: number;
  readonly stages: number;
  readonly bars: number;
  readonly avItems: number;
  readonly lecterns: number;
  readonly clothedTables: number;
}

function collectCounts(placedItems: readonly PlacedItem[]): LayoutCounts {
  const seating = seatingCountsFromPlacedItems(placedItems);
  let stages = 0;
  let bars = 0;
  let avItems = 0;
  let lecterns = 0;
  let clothedTables = 0;
  for (const placed of placedItems) {
    const item = getCatalogueItem(placed.catalogueItemId);
    if (item === undefined) continue;
    if (item.category === "stage") stages += 1;
    else if (item.category === "av") avItems += 1;
    else if (item.category === "lectern") lecterns += 1;
    else if (item.slug === BAR_CATALOGUE_SLUG) bars += 1;
    if (item.category === "table" && placed.clothed) clothedTables += 1;
  }
  return {
    roundTables: seating.roundTables,
    banquetTables: seating.banquetTables,
    chairs: seating.chairs,
    stages, bars, avItems, lecterns, clothedTables,
  };
}

/**
 * Build the indicative setup plan from the live layout. Pure. Tasks are listed
 * in a sensible load-in order; only non-empty tasks appear.
 */
export function buildOpsSetupPlan(placedItems: readonly PlacedItem[]): OpsSetupPlan {
  const c = collectCounts(placedItems);
  const candidates: ReadonlyArray<{ key: string; label: string; count: number; perUnit: number }> = [
    { key: "stage", label: "Set up stage", count: c.stages, perUnit: OPS_EFFORT_MINUTES.stage },
    { key: "round-tables", label: "Lay round tables", count: c.roundTables, perUnit: OPS_EFFORT_MINUTES.table },
    { key: "long-tables", label: "Lay long tables", count: c.banquetTables, perUnit: OPS_EFFORT_MINUTES.table },
    { key: "dress-tables", label: "Dress tables (linen)", count: c.clothedTables, perUnit: OPS_EFFORT_MINUTES.dressTable },
    { key: "chairs", label: "Place chairs", count: c.chairs, perUnit: OPS_EFFORT_MINUTES.chair },
    { key: "bar", label: "Set up bar", count: c.bars, perUnit: OPS_EFFORT_MINUTES.bar },
    { key: "av", label: "Set up AV / equipment", count: c.avItems, perUnit: OPS_EFFORT_MINUTES.av },
    { key: "lectern", label: "Position lectern", count: c.lecterns, perUnit: OPS_EFFORT_MINUTES.lectern },
  ];

  const tasks: OpsTaskLine[] = candidates
    .filter((task) => task.count > 0)
    .map((task) => ({
      key: task.key,
      label: task.label,
      count: task.count,
      effortMinutes: Math.round(task.count * task.perUnit),
    }));

  const totalItems = c.roundTables + c.banquetTables + c.chairs + c.stages + c.bars + c.avItems + c.lecterns;
  const totalCrewMinutes = tasks.reduce((sum, task) => sum + task.effortMinutes, 0);
  const suggestedCrew = totalCrewMinutes > 0
    ? Math.max(1, Math.ceil(totalCrewMinutes / OPS_TARGET_SETUP_MINUTES))
    : 0;
  const estimatedSetupMinutes = suggestedCrew > 0 ? Math.ceil(totalCrewMinutes / suggestedCrew) : 0;

  return { tasks, totalItems, totalCrewMinutes, suggestedCrew, estimatedSetupMinutes };
}

/** Human-readable duration, e.g. "45 min" or "1 h 25 min". */
export function formatSetupDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${String(total)} min`;
  const hours = Math.floor(total / 60);
  const rem = total % 60;
  return rem === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rem)} min`;
}
