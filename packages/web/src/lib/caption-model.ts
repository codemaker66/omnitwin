import { seatsFor } from "@omnitwin/types";
import { toRenderSpace } from "../constants/scale.js";
import { CATALOGUE_CARDS } from "./card-defaults.js";
import { getCatalogueItem, type CatalogueItem } from "./catalogue.js";
import { isDiningTableItem } from "./furniture-semantics.js";
import { footprintBounds, wholeSelection } from "./placement-edit.js";
import type { PlacedItem } from "./placement.js";
import type { PlannerFeature } from "./planner-features.js";
import { cardParamsFor, describeCard, pieceCardId } from "./setup-cards.js";

// ---------------------------------------------------------------------------
// What the caption says about a selection (T-671 slice 11′; approved spec
// §6.6; card-dock spec §8, §11). A table with its chairs, or a set with its
// trestles, is one piece. One piece: its number as the eyebrow ("TABLE 8"),
// its catalogue card's name, its size, and the seat stepper (the only place
// the caption shows seats). Several: "2 Round 6 ft" when alike, otherwise
// "3 pieces". The verbs are the ones that act on this selection; Move and
// Line up wait behind lane E's switches.
// ---------------------------------------------------------------------------

export type CaptionVerb = "seats" | "turn" | "duplicate" | "cloth" | "lineUp" | "move" | "remove";

export interface CaptionModel {
  /** Pieces selected, a table with its chairs counting once. */
  readonly count: number;
  /** "TABLE 8" for one numbered piece; capitals carry no unit. */
  readonly eyebrow: string | null;
  readonly name: string;
  /** "1.8 m round" for one piece. */
  readonly size: string | null;
  readonly seats: { readonly now: number; readonly min: number; readonly max: number } | null;
  readonly verbs: readonly CaptionVerb[];
  /** Where the caption's pin sits: over the selection's middle, at table height (render space). */
  readonly anchor: readonly [number, number, number];
  /** The piece the caption speaks for: the table of a table and chairs, the first of several. */
  readonly primaryId: string;
}

/** Height of the pin above the floor: a dining table's top. */
const PIN_HEIGHT_M = 0.76;

interface Unit {
  readonly main: PlacedItem;
  readonly item: CatalogueItem;
  readonly members: readonly PlacedItem[];
}

function isChair(item: CatalogueItem): boolean {
  return item.category === "chair";
}

/** The selection as pieces: each set or group is one, led by its table (or its first piece). */
function unitsOf(items: readonly PlacedItem[]): readonly Unit[] {
  const byKey = new Map<string, PlacedItem[]>();
  for (const placed of items) {
    const key = placed.setId ?? placed.groupId ?? placed.id;
    const members = byKey.get(key);
    if (members === undefined) byKey.set(key, [placed]);
    else members.push(placed);
  }
  const units: Unit[] = [];
  for (const members of byKey.values()) {
    const main = members.find((member) => {
      const item = getCatalogueItem(member.catalogueItemId);
      return item !== undefined && !isChair(item);
    }) ?? members[0];
    const item = main === undefined ? undefined : getCatalogueItem(main.catalogueItemId);
    if (main !== undefined && item !== undefined) units.push({ main, item, members });
  }
  return units;
}

/** The catalogue card a piece belongs to names it ("Round 6 ft"); otherwise the catalogue's own name. */
function cardName(item: CatalogueItem): string {
  return CATALOGUE_CARDS.find((card) => card.variants.some((variant) => variant.slug === item.slug))?.name ?? item.name;
}

function sizeOf(item: CatalogueItem): string | null {
  const params = cardParamsFor(pieceCardId(item.slug));
  if (params === null) return null;
  const size = describeCard(params).size;
  return size === "" ? null : size;
}

function seatsOf(unit: Unit): CaptionModel["seats"] {
  if (!isDiningTableItem(unit.item)) return null;
  const range = seatsFor({ slug: unit.item.slug });
  if (range === null) return null;
  const now = unit.members.filter((member) => {
    const item = getCatalogueItem(member.catalogueItemId);
    return item !== undefined && isChair(item);
  }).length;
  return { now, min: range.min, max: range.max };
}

export function captionModel(
  selectedIds: ReadonlySet<string>,
  placedItems: readonly PlacedItem[],
  enabled: (feature: PlannerFeature) => boolean,
): CaptionModel | null {
  if (selectedIds.size === 0) return null;
  const items = wholeSelection(selectedIds, placedItems);
  const units = unitsOf(items);
  const first = units[0];
  const bounds = footprintBounds(items);
  if (first === undefined || bounds === null) return null;
  const top = Math.max(...items.map((placed) => placed.y)) + toRenderSpace(PIN_HEIGHT_M);
  const anchor = [(bounds.minX + bounds.maxX) / 2, top, (bounds.minZ + bounds.maxZ) / 2] as const;
  // Cloth is dining dressing: offered when every piece is a dining table (not a poseur or a servery).
  const allTables = units.every((unit) => isDiningTableItem(unit.item));

  if (units.length === 1) {
    const seats = seatsOf(first);
    const label = first.main.label?.trim() ?? "";
    const verbs: CaptionVerb[] = [];
    if (seats !== null) verbs.push("seats");
    verbs.push("turn");
    // Duplicate is lane E's Ctrl D, behind the same switch.
    if (enabled("editingKeys")) verbs.push("duplicate");
    if (allTables) verbs.push("cloth");
    if (enabled("moveVerb")) verbs.push("move");
    // Details is P1 (Q-31): the caption offers it once the right zone can show it.
    verbs.push("remove");
    return {
      count: 1,
      eyebrow: label === "" ? null : label.toUpperCase(),
      name: cardName(first.item),
      size: sizeOf(first.item),
      seats,
      verbs,
      anchor,
      primaryId: first.main.id,
    };
  }

  const names = new Set(units.map((unit) => cardName(unit.item)));
  const verbs: CaptionVerb[] = [];
  if (enabled("editingKeys")) verbs.push("duplicate");
  if (allTables) verbs.push("cloth");
  if (enabled("lineUp")) verbs.push("lineUp");
  if (enabled("moveVerb")) verbs.push("move");
  verbs.push("remove");
  return {
    count: units.length,
    eyebrow: null,
    name: names.size === 1 ? `${String(units.length)} ${cardName(first.item)}` : `${String(units.length)} pieces`,
    size: null,
    seats: null,
    verbs,
    anchor,
    primaryId: first.main.id,
  };
}
