import type { CatalogueItem } from "../../lib/catalogue.js";
import { toRenderSpace } from "../../constants/scale.js";

// ---------------------------------------------------------------------------
// Dinner place-setting layout — where each cover sits on a dressed table, in
// the table's local frame before its presentation scale. Pure, so the planner,
// the dressing ghost and tests share one layout instead of copies.
// ---------------------------------------------------------------------------

export interface PlaceSetting {
  readonly x: number;
  readonly z: number;
  readonly rotationY: number;
}

/** Covers rest this far above the table's catalogue height, in render units. */
export const TABLE_SETTING_SURFACE_OFFSET = 0.032;

/** Upper bound on covers laid on one table. */
export const MAX_TABLE_SETTINGS = 48;

export function normalizeSettingCount(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  return Math.max(1, Math.min(MAX_TABLE_SETTINGS, Math.round(value)));
}

export function roundSettings(
  tableItem: CatalogueItem,
  settingsCount: number | undefined,
): readonly PlaceSetting[] {
  const count = normalizeSettingCount(settingsCount, 10);
  const radius = toRenderSpace(tableItem.width) * 0.34;
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;
    return {
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      rotationY: -angle + Math.PI / 2,
    };
  });
}

export function rectSettings(
  tableItem: CatalogueItem,
  settingsCount: number | undefined,
): readonly PlaceSetting[] {
  const length = toRenderSpace(tableItem.width);
  const depth = toRenderSpace(tableItem.depth);
  const fallbackCount = Math.max(4, Math.min(12, Math.round(length / 0.55) * 2));
  const count = normalizeSettingCount(settingsCount, fallbackCount);
  const perSide = Math.max(1, Math.ceil(count / 2));
  const insetX = length * 0.36;
  const sideZ = depth * 0.25;
  const settings: PlaceSetting[] = [];
  for (let i = 0; i < perSide; i++) {
    const t = perSide === 1 ? 0.5 : i / (perSide - 1);
    const x = -insetX + t * insetX * 2;
    if (settings.length < count) settings.push({ x, z: -sideZ, rotationY: 0 });
    if (settings.length < count) settings.push({ x, z: sideZ, rotationY: Math.PI });
  }
  return settings;
}

/** Cover positions for a round or rectangular dining table. */
export function tableSettingLayout(
  tableItem: CatalogueItem,
  settingsCount: number | undefined,
): readonly PlaceSetting[] {
  return tableItem.tableShape === "round"
    ? roundSettings(tableItem, settingsCount)
    : rectSettings(tableItem, settingsCount);
}

/** Height of every cover's origin in the table's local frame. */
export function tableSettingHeight(tableItem: Pick<CatalogueItem, "height">): number {
  return tableItem.height + TABLE_SETTING_SURFACE_OFFSET;
}
