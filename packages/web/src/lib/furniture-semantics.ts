import type { FurnitureCategory } from "@omnitwin/types";

/**
 * The small catalogue surface needed to classify a furniture item's planning
 * role. Keeping this structural lets the canonical asset and web catalogue
 * representations share one semantic rule.
 */
export interface FurnitureSemanticSource {
  readonly category: FurnitureCategory;
  readonly slug: string;
}

const TABLE_MOUNTABLE_AV_SLUGS: ReadonlySet<string> = new Set([
  "projector",
  "laptop",
  "microphone",
]);

/** AV items whose canonical planning role explicitly permits table placement. */
export function isTableMountableAvItem(item: FurnitureSemanticSource): boolean {
  return item.category === "av" && TABLE_MOUNTABLE_AV_SLUGS.has(item.slug);
}

/**
 * Passive freestanding AV equipment with a meaningful floor footprint.
 * A mic stand carries no implied microphone, power, or cable requirement.
 */
export function isPassiveFreestandingAvFloorItem(item: FurnitureSemanticSource): boolean {
  return item.category === "av" && item.slug === "mic-stand";
}

/** Imported floor fixtures that must remain obstacles even in category `other`. */
export function isFreestandingFloorEquipmentItem(item: FurnitureSemanticSource): boolean {
  return item.category === "other" && (item.slug === "room-divider" || item.slug === "servery-unit");
}

/**
 * Whether a candidate may rest on a placed furniture surface. Stages support
 * floor equipment and other stage units; tables support only assets whose
 * canonical role explicitly says they are table-mountable.
 */
export function canRestOnFurnitureSurface(
  candidate: FurnitureSemanticSource,
  surface: FurnitureSemanticSource,
): boolean {
  if (surface.category === "stage") return true;
  return surface.category === "table" && isTableMountableAvItem(candidate);
}

/** Linen colours encoded directly in a furniture variant or applied in-scene. */
export type TableLinenStyle = "black" | "white";
/** Imported fabric may have a finish that the scene's linen tools cannot author. */
export type IntrinsicTableLinenStyle = TableLinenStyle | "included";

const INTRINSIC_TABLE_LINEN: Readonly<Record<string, IntrinsicTableLinenStyle>> = {
  "poseur-table-black": "black",
  "poseur-table-white": "white",
  "trestle-6ft-black": "black",
  "trestle-6ft-white": "white",
  "trestle-4ft-black": "black",
  "trestle-4ft-white": "white",
  "round-table-6ft-black": "black",
  "round-table-6ft-white": "white",
  "round-cafe-table-white": "white",
  "square-cafe-table-white": "white",
  "ceremony-table": "white",
  // The supplied export contains cloth geometry but no texture/colour evidence.
  "cake-cutting-table": "included",
};

const SERVICE_TABLE_SLUGS: ReadonlySet<string> = new Set([
  "cake-cutting-table", "ceremony-table",
]);

/** The persisted, optional overlay state carried by placed/editor objects. */
export interface TableLinenStateSource {
  readonly clothed: boolean;
  readonly clothStyle: TableLinenStyle | null;
}

/** Standing-height poseur tables are tables, but they are not seated dining. */
export function isPoseurTableItem(item: FurnitureSemanticSource): boolean {
  return item.category === "table" && item.slug.startsWith("poseur-table");
}

/**
 * True only for tables that support seated dining workflows such as chair
 * groups, dinner place settings, dining-capacity counts and seating targets.
 */
export function isDiningTableItem(item: FurnitureSemanticSource): boolean {
  return item.category === "table" && !isPoseurTableItem(item)
    && !SERVICE_TABLE_SLUGS.has(item.slug);
}

/**
 * Linen authored into the catalogue variant itself, rather than added as a
 * scene overlay. Exact slugs preserve linen tools for bare tables while
 * preventing another cloth being drawn over imported dressed geometry.
 */
export function intrinsicTableLinenStyle(
  item: FurnitureSemanticSource,
): IntrinsicTableLinenStyle | null {
  if (item.category !== "table") return null;
  return Object.hasOwn(INTRINSIC_TABLE_LINEN, item.slug) ? INTRINSIC_TABLE_LINEN[item.slug] ?? null : null;
}

/** True when a generic table-cloth overlay may be applied to this item. */
export function canApplyTableLinenToItem(item: FurnitureSemanticSource): boolean {
  return item.category === "table" && intrinsicTableLinenStyle(item) === null;
}

/**
 * Resolve only scene-applied linen. Intrinsic variants deliberately return
 * null even if legacy metadata says `clothed`, preventing a duplicate mesh.
 */
export function appliedTableLinenStyle(
  item: FurnitureSemanticSource,
  state: TableLinenStateSource,
): TableLinenStyle | null {
  if (!canApplyTableLinenToItem(item) || !state.clothed) return null;
  return state.clothStyle === "white" ? "white" : "black";
}

/** The linen users and operational outputs should regard as physically real. */
export function effectiveTableLinenStyle(
  item: FurnitureSemanticSource,
  state: TableLinenStateSource,
): IntrinsicTableLinenStyle | null {
  return intrinsicTableLinenStyle(item) ?? appliedTableLinenStyle(item, state);
}
