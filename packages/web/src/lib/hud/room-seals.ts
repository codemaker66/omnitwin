import { getCatalogueItem } from "../catalogue.js";
import type { CirculationReport } from "../circulation.js";
import { placedItemsCirculation } from "../circulation-scene.js";
import { effectiveTableLinenStyle, isDiningTableItem } from "../furniture-semantics.js";
import { isSceneFurniturePlacement } from "../table-dressing.js";
import { countLabel } from "../count-label.js";
import type { DoorClearSpace } from "../door-clear-spaces.js";
import { doorBlockedLine, doorBlockers, type DoorBlocker } from "../keep-doors-clear.js";
import type { PlacedItem } from "../placement.js";
import { pieceCardId, type CardId } from "../setup-cards.js";
import { planeFacts, type PlaneFacts } from "../slate-facts.js";
import type { PlannerEventKind } from "../../stores/planner-event-store.js";
import { floorCounts, type FloorCounts } from "./hand-cards.js";

// ---------------------------------------------------------------------------
// "Your room": the six seals down the left of the planner (13 Nov 2026).
//
// Each seal is one fact about the room as it stands, lit when there is nothing
// left to do about it, so the room's state is read at a glance instead of
// worked out from panels. Every seal states something the planner measured or
// counted (seats placed, what stands in a door's space, the narrowest gap,
// what is on the floor). None is a safety verdict: the figures are the
// planner's own measurements and the venue's published guide, worded as such
// (docs/engineering/planner-honest-numbers.md).
// ---------------------------------------------------------------------------

export type SealId = "seats" | "doors" | "aisles" | "top-table" | "dance-floor" | "bar" | "stage" | "lectern" | "screen";

/**
 * lit: nothing left to do. progress: on the way (carries `progress`).
 * waiting: not started, and that is fine. attention: something to look at.
 */
export type SealState = "lit" | "progress" | "waiting" | "attention";

export interface RoomSeal {
  readonly id: SealId;
  readonly label: string;
  /** A short figure beside the label: "80 / 120", "1.4 m", "1 blocked". */
  readonly value: string | null;
  readonly state: SealState;
  /** 0 to 1, for the seats ring; null on every other seal. */
  readonly progress: number | null;
  /** One plain sentence saying what the seal is reading. */
  readonly detail: string;
  /** The card that would light a waiting seal, for a one-press start. */
  readonly card: CardId | null;
}

export interface RoomFacts {
  readonly plane: PlaneFacts;
  readonly counts: FloorCounts;
  /** Null for a room with no recorded doors: nothing is said about doors there. */
  readonly doors: { readonly blockers: readonly DoorBlocker[]; readonly line: string } | null;
  readonly aisles: Pick<CirculationReport, "tightestGapM" | "tightestPair" | "band">;
  /** There are dining tables and every one wears a cloth (its own, or one laid on it). */
  readonly dressed: boolean;
  readonly kind: PlannerEventKind | null;
}

function everyTableDressed(items: readonly PlacedItem[]): boolean {
  let tables = 0;
  for (const item of items) {
    if (!isSceneFurniturePlacement(item)) continue;
    const catalogue = getCatalogueItem(item.catalogueItemId);
    if (catalogue === undefined || !isDiningTableItem(catalogue)) continue;
    tables += 1;
    if (effectiveTableLinenStyle(catalogue, item) === null) return false;
  }
  return tables > 0;
}

/** Everything the seals and the next-move line read, from the room as it stands. */
export function roomFacts(input: {
  readonly items: readonly PlacedItem[];
  readonly guests: number | null;
  readonly roomSlug: string | null;
  readonly doorSpaces: readonly DoorClearSpace[] | null;
  readonly kind: PlannerEventKind | null;
}): RoomFacts {
  const blockers = input.doorSpaces === null || input.doorSpaces.length === 0 ? null : doorBlockers(input.items, input.doorSpaces);
  const circulation = placedItemsCirculation(input.items);
  return {
    plane: planeFacts({ items: input.items, guests: input.guests, roomSlug: input.roomSlug }),
    counts: floorCounts(input.items),
    doors: blockers === null || input.doorSpaces === null ? null : { blockers, line: doorBlockedLine(blockers, input.doorSpaces) },
    aisles: { tightestGapM: circulation.tightestGapM, tightestPair: circulation.tightestPair, band: circulation.band },
    dressed: everyTableDressed(input.items),
    kind: input.kind,
  };
}

function metres(value: number): string {
  return `${(Math.floor(value * 10) / 10).toFixed(1)} m`;
}

function seatsSeal(plane: PlaneFacts): RoomSeal {
  const base = { id: "seats", label: "Seats", card: null } as const;
  if (plane.guests === null || plane.guests === 0) {
    return {
      ...base,
      value: plane.seats > 0 ? String(plane.seats) : null,
      state: "waiting",
      progress: null,
      detail: "Say how many guests are coming and this ring fills as you seat them.",
    };
  }
  const value = `${String(plane.seats)} / ${String(plane.guests)}`;
  const progress = Math.min(1, plane.seats / plane.guests);
  if (plane.standing === "over" && plane.limit !== null) {
    return {
      ...base,
      value,
      state: "attention",
      progress,
      detail: `The venue publishes ${String(plane.limit)} for a ${plane.format} in this room, and ${String(plane.seats)} seats are placed. Ask the events team about a larger number.`,
    };
  }
  if (plane.short > 0) {
    return { ...base, value, state: "progress", progress, detail: `${countLabel(plane.short, "guest")} still to seat.` };
  }
  return { ...base, value, state: "lit", progress: 1, detail: "Every guest has a seat." };
}

function doorsSeal(doors: NonNullable<RoomFacts["doors"]>): RoomSeal {
  const blocked = doors.blockers.length;
  if (blocked === 0) {
    return { id: "doors", label: "Doors clear", value: null, state: "lit", progress: null, detail: "Nothing stands in front of a door.", card: null };
  }
  return { id: "doors", label: "Doors", value: `${String(blocked)} blocked`, state: "attention", progress: null, detail: doors.line, card: null };
}

function aislesSeal(aisles: RoomFacts["aisles"]): RoomSeal {
  const base = { id: "aisles", label: "Aisles", progress: null, card: null } as const;
  if (aisles.tightestGapM === null) {
    return { ...base, value: null, state: "waiting", detail: "Shows the narrowest gap between pieces once two are placed." };
  }
  const gap = metres(aisles.tightestGapM);
  if (aisles.band === "tight" || aisles.band === "blocked") {
    const pair = aisles.tightestPair;
    const where = pair === null ? "" : `, between ${pair.aLabel} and ${pair.bLabel}`;
    return { ...base, value: gap, state: "attention", detail: `The narrowest gap is ${gap}${where}.` };
  }
  return { ...base, value: gap, state: "lit", detail: `The narrowest gap between pieces is ${gap}.` };
}

function presenceSeal(id: SealId, label: string, placed: number, card: CardId): RoomSeal {
  return placed > 0
    ? { id, label, value: placed > 1 ? `×${String(placed)}` : null, state: "lit", progress: null, detail: `${label} is on the floor.`, card: null }
    : { id, label, value: null, state: "waiting", progress: null, detail: `Not placed. Press to take the ${label} card.`, card };
}

function slugCount(counts: FloorCounts, ...slugs: readonly string[]): number {
  return slugs.reduce((sum, slug) => sum + (counts.bySlug.get(slug) ?? 0), 0);
}

/** The seals in their fixed order: the three every room has, then three for this kind of event. */
export function roomSeals(facts: RoomFacts): readonly RoomSeal[] {
  const seals: RoomSeal[] = [seatsSeal(facts.plane)];
  if (facts.doors !== null) seals.push(doorsSeal(facts.doors));
  seals.push(aislesSeal(facts.aisles));
  if (facts.kind === "corporate") {
    seals.push(
      presenceSeal("stage", "Stage", slugCount(facts.counts, "platform", "platform-narrow", "staging-deck-6x4", "staging-deck-6x3"), pieceCardId("platform")),
      presenceSeal("lectern", "Lectern", slugCount(facts.counts, "lectern"), pieceCardId("lectern")),
      presenceSeal("screen", "Screen", slugCount(facts.counts, "projector-screen", "hisense-television"), pieceCardId("projector-screen")),
    );
  } else {
    seals.push(
      presenceSeal("top-table", "Top table", facts.counts.topTables, "top-table"),
      presenceSeal("dance-floor", "Dance floor", facts.counts.danceFloors, "dance-floor"),
      presenceSeal("bar", "Bar", slugCount(facts.counts, "bar-counter"), pieceCardId("bar-counter")),
    );
  }
  return seals;
}
