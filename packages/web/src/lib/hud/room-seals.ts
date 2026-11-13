import { getCatalogueItem } from "../catalogue.js";
import type { CirculationReport } from "../circulation.js";
import { placedItemsCirculation } from "../circulation-scene.js";
import { countLabel } from "../count-label.js";
import type { DoorClearSpace } from "../door-clear-spaces.js";
import { effectiveTableLinenStyle, isDiningTableItem } from "../furniture-semantics.js";
import { doorBlockedLine, doorBlockers, type DoorBlocker } from "../keep-doors-clear.js";
import type { PlacedItem } from "../placement.js";
import { planeFacts, type PlaneFacts } from "../slate-facts.js";
import { isSceneFurniturePlacement } from "../table-dressing.js";
import type { PlannerEventKind } from "../../stores/planner-event-store.js";
import { floorCounts, type FloorCounts } from "./hand-cards.js";

// ---------------------------------------------------------------------------
// The room as it stands: the facts the shelf's one status line reads
// (13 Nov 2026; D:/claude/planner-hud-20261113/DOCTRINE.md, "letterbox").
//
// The line says how many are seated, and then only what needs saying: whether
// the doors are clear and the narrowest aisle. Something to look at is marked
// as such, with the sentence that explains it. Every figure is one the
// planner measured or counted, or the venue's published guide, worded as
// such; none is a safety verdict (docs/engineering/planner-honest-numbers.md).
// The pieces on the floor are told by the counts on their own cards.
// ---------------------------------------------------------------------------

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

/** Everything the status line, the steps and the next move read, from the room as it stands. */
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

/** The status line's first words: the seats against the guests. */
export interface SeatLine {
  /** "80 of 120 seated", or "10 seats placed" while no guest count is known. */
  readonly text: string;
  /** More seats are placed than the venue publishes for this room. */
  readonly attention: boolean;
  /** The sentence behind an attention, or null. */
  readonly detail: string | null;
}

export function seatLine(plane: PlaneFacts): SeatLine {
  if (plane.guests === null || plane.guests === 0) {
    return { text: `${countLabel(plane.seats, "seat")} placed`, attention: false, detail: null };
  }
  const text = `${String(plane.seats)} of ${String(plane.guests)} seated`;
  if (plane.standing === "over" && plane.limit !== null) {
    return {
      text,
      attention: true,
      detail: `The venue publishes ${String(plane.limit)} for a ${plane.format} in this room, and ${String(plane.seats)} seats are placed. Ask the events team about a larger number.`,
    };
  }
  return { text, attention: false, detail: null };
}

export type RoomStatusId = "doors" | "aisles";

/** One fact after the seats on the status line. */
export interface RoomStatus {
  readonly id: RoomStatusId;
  /** The words on the line: "Doors clear", "1 door blocked", "Narrowest aisle 1.4 m". */
  readonly text: string;
  /** Something to look at: said in the accent, and a press chooses the pieces concerned. */
  readonly attention: boolean;
  /** One plain sentence saying what it is reading. */
  readonly detail: string;
}

function doorsStatus(doors: NonNullable<RoomFacts["doors"]>): RoomStatus {
  if (doors.blockers.length === 0) {
    return { id: "doors", text: "Doors clear", attention: false, detail: "Nothing stands in front of a door." };
  }
  const blocked = new Set(doors.blockers.flatMap((blocker) => blocker.doors)).size;
  return { id: "doors", text: `${countLabel(Math.max(1, blocked), "door")} blocked`, attention: true, detail: doors.line };
}

function aislesStatus(aisles: RoomFacts["aisles"]): RoomStatus | null {
  if (aisles.tightestGapM === null) return null;
  const gap = metres(aisles.tightestGapM);
  if (aisles.band === "tight" || aisles.band === "blocked") {
    const pair = aisles.tightestPair;
    const where = pair === null ? "" : `, between ${pair.aLabel} and ${pair.bLabel}`;
    return { id: "aisles", text: `Narrowest aisle ${gap}`, attention: true, detail: `The narrowest gap is ${gap}${where}.` };
  }
  return { id: "aisles", text: `Narrowest aisle ${gap}`, attention: false, detail: `The narrowest gap between pieces is ${gap}.` };
}

/**
 * What the status line says after the seats, in its fixed order: the doors,
 * where the room's are recorded, and the narrowest aisle once two pieces stand.
 */
export function roomStatus(facts: RoomFacts): readonly RoomStatus[] {
  const said: RoomStatus[] = [];
  if (facts.doors !== null) said.push(doorsStatus(facts.doors));
  const aisles = aislesStatus(facts.aisles);
  if (aisles !== null) said.push(aisles);
  return said;
}
