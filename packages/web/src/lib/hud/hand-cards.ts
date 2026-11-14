import { getCatalogueItem, getCatalogueItemBySlug } from "../catalogue.js";
import { countLabel } from "../count-label.js";
import { setupCardPreviewUrl } from "../crafted-furniture.js";
import { isDiningTableItem } from "../furniture-semantics.js";
import type { PlacedItem } from "../placement.js";
import {
  DANCE_FLOOR_PANEL_SLUG,
  cardParamsFor,
  describeCard,
  pieceCardId,
  pieceCardSlug,
  type CardId,
  type CardParams,
} from "../setup-cards.js";
import { isSceneFurniturePlacement } from "../table-dressing.js";
import type { PlannerEventKind } from "../../stores/planner-event-store.js";

// ---------------------------------------------------------------------------
// The hand: the cards along the bottom of the planner (13 Nov 2026).
//
// A hand is a short, fixed row of what an event of this kind is made from, so
// nobody has to search a catalogue to begin: eight cards, always in the same
// places. Each card says its name, one fact (its seats, or its size) and how
// many already stand in the room. The cards themselves are setup-cards': this
// module only chooses which ones, in what order, and words their faces.
// ---------------------------------------------------------------------------

/** How many cards a hand holds. Eight sit comfortably beside the two keys on a 1280 px screen. */
export const HAND_SIZE = 8;

const WEDDING_HAND: readonly CardId[] = [
  "round",
  "top-table",
  "long-table",
  "dance-floor",
  pieceCardId("platform"),
  pieceCardId("bar-counter"),
  pieceCardId("poseur-table-white"),
  pieceCardId("cake-cutting-table"),
];

const CORPORATE_HAND: readonly CardId[] = [
  "round",
  "long-table",
  pieceCardId("platform"),
  pieceCardId("lectern"),
  pieceCardId("projector-screen"),
  pieceCardId("poseur-table-white"),
  pieceCardId("bar-counter"),
  pieceCardId("dancefloor-panel"),
];

/** The cards in hand for an event of this kind; an event nobody has described yet is dealt the wedding's. */
export function handCardIds(kind: PlannerEventKind | null): readonly CardId[] {
  return kind === "corporate" ? CORPORATE_HAND : WEDDING_HAND;
}

/** A piece card's name in the hand: the word a guest would use, shorter than the catalogue's. */
const HAND_NAMES: Readonly<Record<string, string>> = {
  platform: "Stage",
  "bar-counter": "Bar",
  "poseur-table-white": "Poseur table",
  "cake-cutting-table": "Cake table",
  lectern: "Lectern",
  "projector-screen": "Screen",
  "dancefloor-panel": "Dance floor",
};

export interface HandCard {
  readonly id: CardId;
  readonly params: CardParams;
  readonly name: string;
  /** One fact under the name: the seats it adds, or its size. */
  readonly detail: string;
  /** The picture of what it sets down, when one was rendered. */
  readonly art: string | null;
  /** How many of it stand in the room now. */
  readonly placed: number;
}

/** What stands on the floor, counted the way the hand's cards name things. */
export interface FloorCounts {
  readonly rounds: number;
  readonly topTables: number;
  readonly longTables: number;
  readonly danceFloors: number;
  /** Every other piece, by catalogue slug. */
  readonly bySlug: ReadonlyMap<string, number>;
}

/** A world offset as the table's own: the inverse of the turn the planner gives chairs round a table. */
function localZ(dx: number, dz: number, rotationY: number): number {
  return dx * Math.sin(rotationY) + dz * Math.cos(rotationY);
}

/** Whether every chair of a trestle's group sits on one long side: a top table's seating. */
function seatsOneSide(table: PlacedItem, chairs: readonly PlacedItem[]): boolean {
  if (chairs.length === 0) return false;
  let side = 0;
  for (const chair of chairs) {
    const z = localZ(chair.x - table.x, chair.z - table.z, table.rotationY);
    const sign = Math.sign(Math.round(z * 1000));
    if (sign === 0) return false;
    if (side === 0) side = sign;
    else if (side !== sign) return false;
  }
  return true;
}

/** Counts the room's pieces as rounds, top tables, long tables, dance floors and everything else by slug. */
export function floorCounts(items: readonly PlacedItem[]): FloorCounts {
  let rounds = 0;
  const topSets = new Set<string>();
  const longSets = new Set<string>();
  const floors = new Set<string>();
  const bySlug = new Map<string, number>();
  const chairsByGroup = new Map<string, PlacedItem[]>();

  for (const item of items) {
    if (item.groupId === null) continue;
    if (getCatalogueItem(item.catalogueItemId)?.category !== "chair") continue;
    const chairs = chairsByGroup.get(item.groupId);
    if (chairs === undefined) chairsByGroup.set(item.groupId, [item]);
    else chairs.push(item);
  }

  for (const item of items) {
    if (!isSceneFurniturePlacement(item)) continue;
    const catalogue = getCatalogueItem(item.catalogueItemId);
    if (catalogue === undefined) continue;
    if (catalogue.slug === DANCE_FLOOR_PANEL_SLUG) {
      floors.add(item.groupId ?? item.id);
      continue;
    }
    if (isDiningTableItem(catalogue)) {
      if (catalogue.tableShape === "round") {
        rounds += 1;
        continue;
      }
      // A run of trestles set down as one table is one table, by its set.
      const set = item.setId ?? item.groupId ?? item.id;
      const chairs = item.groupId === null ? [] : chairsByGroup.get(item.groupId) ?? [];
      if (seatsOneSide(item, chairs)) topSets.add(set);
      else longSets.add(set);
      continue;
    }
    if (catalogue.category === "chair" && item.groupId !== null) continue;
    bySlug.set(catalogue.slug, (bySlug.get(catalogue.slug) ?? 0) + 1);
  }
  // A set whose trestles disagree (one chair moved across) reads as the long table it now is.
  for (const set of longSets) topSets.delete(set);

  return { rounds, topTables: topSets.size, longTables: longSets.size, danceFloors: floors.size, bySlug };
}

function placedFor(id: CardId, counts: FloorCounts): number {
  switch (id) {
    case "round": return counts.rounds;
    case "top-table": return counts.topTables;
    case "long-table": return counts.longTables;
    case "dance-floor": return counts.danceFloors;
    default: {
      const slug = pieceCardSlug(id);
      if (slug === null) return 0;
      return slug === DANCE_FLOOR_PANEL_SLUG ? counts.danceFloors : counts.bySlug.get(slug) ?? 0;
    }
  }
}

/** One card's face for the hand, or null when the catalogue no longer holds its piece. */
export function handCard(id: CardId, counts: FloorCounts, chairSlug: string): HandCard | null {
  const params = cardParamsFor(id);
  if (params === null) return null;
  const face = describeCard(params);
  const slug = pieceCardSlug(id);
  const name = slug === null ? face.name : HAND_NAMES[slug] ?? face.name;
  const detail = face.seats > 0 ? countLabel(face.seats, "seat") : face.size;
  const art = params.card === "piece"
    ? getCatalogueItemBySlug(params.slug)?.thumbnailUrl ?? null
    : setupCardPreviewUrl(params, chairSlug);
  return { id, params, name, detail, art, placed: placedFor(id, counts) };
}

/** The hand as it stands: this event's cards, each with its face and its count on the floor. */
export function handCards(kind: PlannerEventKind | null, items: readonly PlacedItem[], chairSlug: string): readonly HandCard[] {
  return handCardsFromCounts(kind, floorCounts(items), chairSlug);
}

/** The hand from counts already taken (the HUD takes them once for every station). */
export function handCardsFromCounts(kind: PlannerEventKind | null, counts: FloorCounts, chairSlug: string): readonly HandCard[] {
  const cards: HandCard[] = [];
  for (const id of handCardIds(kind)) {
    const card = handCard(id, counts, chairSlug);
    if (card !== null) cards.push(card);
  }
  return cards.slice(0, HAND_SIZE);
}
