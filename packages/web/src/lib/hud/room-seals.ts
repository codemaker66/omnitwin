import type { SpaceDimensions } from "@omnitwin/types";
import { getCatalogueItem } from "../catalogue.js";
import type { CirculationReport } from "../circulation.js";
import { placedItemsCirculation } from "../circulation-scene.js";
import { countLabel } from "../count-label.js";
import type { DoorClearSpace } from "../door-clear-spaces.js";
import { effectiveTableLinenStyle, isDiningTableItem } from "../furniture-semantics.js";
import { layoutGangwayReview } from "../gangway-review-record.js";
import { doorBlockedLine, doorBlockers, type DoorBlocker } from "../keep-doors-clear.js";
import type { PlacedItem } from "../placement.js";
import { planeFacts, type PlaneFacts } from "../slate-facts.js";
import { isSceneFurniturePlacement } from "../table-dressing.js";
import type { PlannerEventKind } from "../../stores/planner-event-store.js";
import { floorCounts, type FloorCounts } from "./hand-cards.js";

// ---------------------------------------------------------------------------
// The room as it stands: the facts the shelf's one status line reads
// (13 Nov 2026; docs/superpowers/specs/2026-11-13-planner-hud-design.md).
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
  readonly aisles: Pick<CirculationReport, "tightestGapM" | "tightestPair" | "band"> & {
    /**
     * A tight narrowest gap that is no more than the planner's own spacing: at
     * least what Lay out keeps between pieces, in a room whose gangways the
     * planner's own review finds nothing wrong with (laidAsThePlannerLays).
     */
    readonly asLaid: boolean;
  };
  /** There are dining tables and every one wears a cloth (its own, or one laid on it). */
  readonly dressed: boolean;
  readonly kind: PlannerEventKind | null;
}

/**
 * The clear passage the planner's own Lay out keeps behind every chair, to the
 * next table's chairs or a piece already on the floor, metres (lib/auto-fill,
 * BANQUET_CHAIR_CLEARANCE_M). A
 * copy, held to its original by a test (lib/hud/__tests__/hud-logic.test.ts):
 * the screen is behind a flag, and reading the original from here would put
 * its export into a file every planner downloads.
 */
export const LAID_CLEARANCE_M = 0.6;
/** A gap measured a hair under that spacing is that spacing. */
const LAID_CLEARANCE_SLACK_M = 0.005;

/**
 * Whether a tight narrowest gap is the planner's own spacing and nothing
 * worse. Lay out keeps LAID_CLEARANCE_M between a table's chairs and whatever
 * stands next to them (the next table's chairs, or a piece already on the
 * floor), and 1.1 m on the room's designated gangways, to its doors and along
 * its walls (lib/auto-fill, FILL_AISLE_RULE). The circulation scale calls any
 * gap under 0.9 m tight, so by the scale alone every room the planner had just
 * laid was sent back to be opened up. (By the scale's own measure the
 * planner's rounds of ten stand 0.65 m apart: the spacing is a floor, not a
 * figure to match.)
 *
 * Both must hold. The gap is at least that spacing; and the planner's own
 * review of the layout, the one that goes to the venue with it
 * (lib/gangway-review-record), finds no gangway under its guidance. With a
 * pinch on any gangway nothing is excused, and every tight gap is said as it
 * always was: a way to a door is never made quiet by this. Where the room's
 * size is not known the review cannot be asked, and nothing is excused.
 */
function laidAsThePlannerLays(
  circulation: Pick<CirculationReport, "tightestGapM" | "band">,
  items: readonly PlacedItem[],
  room: SpaceDimensions | null,
  roomSlug: string | null,
): boolean {
  if (circulation.band !== "tight" || circulation.tightestGapM === null || room === null) return false;
  if (circulation.tightestGapM < LAID_CLEARANCE_M - LAID_CLEARANCE_SLACK_M) return false;
  return layoutGangwayReview(items, room, roomSlug, null).items.length === 0;
}

/**
 * Whether the narrowest gap is one to open up: every gap the circulation
 * scale calls blocked, and every one it calls tight unless it is no more than
 * the planner's own spacing (RoomFacts.aisles.asLaid). The planner does not
 * send someone back to undo what it has just done for them, nor hold a piece
 * set by hand to more than it asks of itself.
 */
export function gapToOpenUp(aisles: RoomFacts["aisles"]): boolean {
  if (aisles.band === "blocked") return true;
  return aisles.band === "tight" && !aisles.asLaid;
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
  /** The room's size as the planner's room store holds it (render space); null where it is not known. */
  readonly room: SpaceDimensions | null;
}): RoomFacts {
  const blockers = input.doorSpaces === null || input.doorSpaces.length === 0 ? null : doorBlockers(input.items, input.doorSpaces);
  const circulation = placedItemsCirculation(input.items);
  return {
    plane: planeFacts({ items: input.items, guests: input.guests, roomSlug: input.roomSlug }),
    counts: floorCounts(input.items),
    doors: blockers === null || input.doorSpaces === null ? null : { blockers, line: doorBlockedLine(blockers, input.doorSpaces) },
    aisles: {
      tightestGapM: circulation.tightestGapM,
      tightestPair: circulation.tightestPair,
      band: circulation.band,
      asLaid: laidAsThePlannerLays(circulation, input.items, input.room, input.roomSlug),
    },
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
  if (gapToOpenUp(aisles)) {
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
