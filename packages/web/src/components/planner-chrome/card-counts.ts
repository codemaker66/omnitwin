import { CATALOGUE_CARDS } from "../../lib/card-defaults.js";
import { getCatalogueItem } from "../../lib/catalogue.js";
import type { PlacedItem } from "../../lib/placement.js";
import {
  CARD_COLOURWAYS,
  DANCE_FLOOR_PANEL_SLUG,
  cardMainSlug,
  isSetupCardId,
  pieceCardSlug,
  type CardId,
  type SetupCardId,
} from "../../lib/setup-cards.js";
import { tableChairSide, tableOwnChairs } from "../../lib/table-group.js";

// ---------------------------------------------------------------------------
// The "×N" on a card (card-dock spec §4.1–4.2): how many of it the room
// holds, one count for the rail and the catalogue alike.
//
// A piece card counts its pieces in any of its variants. A setup counts its
// sets: a Round of 10 its round tables in any cloth, a dance floor its floors,
// and Top table and Long table their runs of trestles. The room tells those
// two apart the way the planner does (tableChairSide): a top table seats its
// guests along its back only, a long table all round. A run is the trestles
// bound by one setId, or one trestle with its chairs. A run with no chairs
// at all is neither, only trestles (the Trestle cards count those).
// ---------------------------------------------------------------------------

export interface RoomCounts {
  /** Pieces in the room, by catalogue slug. */
  readonly bySlug: ReadonlyMap<string, number>;
  /** Sets in the room, by setup card. */
  readonly sets: ReadonlyMap<SetupCardId, number>;
}

/**
 * A setup's main piece in each of its cloths: "round-table-6ft-white",
 * "round-table-6ft-black"… The piece follows the cloth alone, so the count
 * asked for is any (and no switch is read while the module loads).
 */
function mainSlugs(card: "round" | "top-table" | "long-table"): ReadonlySet<string> {
  return new Set(CARD_COLOURWAYS[card].map((colourway) => cardMainSlug(
    card === "round" ? { card, seats: 1, colourway } : { card, trestles: 1, colourway },
  )));
}

const ROUND_SLUGS = mainSlugs("round");
/** Top and Long table set down the same trestles. */
const TRESTLE_SLUGS = new Set([...mainSlugs("top-table"), ...mainSlugs("long-table")]);

/** The pieces a set is bound by: its setId, else its group, else the piece alone. */
function setKey(piece: PlacedItem): string {
  return piece.setId ?? piece.groupId ?? piece.id;
}

/** Whether a trestle run is a top table, a long table, or neither (no chairs at all). */
function runKind(trestles: readonly PlacedItem[], groups: ReadonlyMap<string, readonly PlacedItem[]>): "top-table" | "long-table" | null {
  let seated = false;
  for (const trestle of trestles) {
    // Its own group is all tableChairSide reads, so the whole room is not walked once per trestle.
    const group = trestle.groupId === null ? [] : groups.get(trestle.groupId) ?? [];
    if (tableOwnChairs(trestle, group).length === 0) continue;
    if (tableChairSide(trestle, group) === "back") return "top-table";
    seated = true;
  }
  return seated ? "long-table" : null;
}

/** Counts the room once, for every card on the rail and in the catalogue. */
export function roomCounts(placedItems: readonly PlacedItem[]): RoomCounts {
  const bySlug = new Map<string, number>();
  const groups = new Map<string, PlacedItem[]>();
  const floors = new Set<string>();
  const runs = new Map<string, PlacedItem[]>();
  for (const piece of placedItems) {
    const slug = getCatalogueItem(piece.catalogueItemId)?.slug;
    if (slug === undefined) continue;
    bySlug.set(slug, (bySlug.get(slug) ?? 0) + 1);
    if (piece.groupId !== null) {
      const group = groups.get(piece.groupId);
      if (group === undefined) groups.set(piece.groupId, [piece]);
      else group.push(piece);
    }
    if (slug === DANCE_FLOOR_PANEL_SLUG) floors.add(piece.groupId ?? piece.id);
    if (TRESTLE_SLUGS.has(slug)) {
      const run = runs.get(setKey(piece));
      if (run === undefined) runs.set(setKey(piece), [piece]);
      else run.push(piece);
    }
  }
  let rounds = 0;
  for (const slug of ROUND_SLUGS) rounds += bySlug.get(slug) ?? 0;
  const sets = new Map<SetupCardId, number>([["round", rounds], ["dance-floor", floors.size], ["top-table", 0], ["long-table", 0]]);
  for (const trestles of runs.values()) {
    const kind = runKind(trestles, groups);
    if (kind !== null) sets.set(kind, (sets.get(kind) ?? 0) + 1);
  }
  return { bySlug, sets };
}

/** How many of a card the room holds: a piece card's pieces in any variant, a setup's sets. */
export function placedCount(card: CardId, counts: RoomCounts): number {
  if (isSetupCardId(card)) return counts.sets.get(card) ?? 0;
  const slug = pieceCardSlug(card) ?? card;
  const family = CATALOGUE_CARDS.find((entry) => entry.variants.some((variant) => variant.slug === slug));
  const slugs = family === undefined ? [slug] : family.variants.map((variant) => variant.slug);
  return slugs.reduce((sum, each) => sum + (counts.bySlug.get(each) ?? 0), 0);
}
