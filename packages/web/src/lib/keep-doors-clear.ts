import { toRealWorld } from "../constants/scale.js";
import { getCatalogueItem } from "./catalogue.js";
import { isDiningTableItem } from "./furniture-semantics.js";
import { computeRotatedFootprint, createGroupMemberIdsLookup, type PlacedItem } from "./placement.js";
import { isSceneFurniturePlacement } from "./table-dressing.js";
import {
  doorNameList,
  footprintInSpace,
  slideClearOfDoors,
  spacesEntered,
  type DoorClearSpace,
  type DoorSlide,
  type DoorSlideInput,
  type Footprint,
} from "./door-clear-spaces.js";

// ---------------------------------------------------------------------------
// Keeping doors clear with the planner's own furniture (Blake, 27 Oct 2026:
// "Keep them clear automatically (Recommended)").
//
// lib/door-clear-spaces knows rectangles; this knows placed pieces: their
// footprints by the planner's overlap rule, the tables (with their chairs)
// and lone pieces that stand in a door's clear space, and how to name them.
// The placement store, the drop and the notice on a saved layout all ask here,
// so they agree about what blocks a door.
// ---------------------------------------------------------------------------

/** A placed piece's footprint in metres, or null for what is not furniture on the floor (a cloth waiting to be laid, an unknown item). */
export function placedFootprint(piece: PlacedItem): Footprint | null {
  if (!isSceneFurniturePlacement(piece)) return null;
  const item = getCatalogueItem(piece.catalogueItemId);
  if (item === undefined) return null;
  const { halfW, halfD } = computeRotatedFootprint(item, piece.rotationY, piece.scale);
  return { x: toRealWorld(piece.x), z: toRealWorld(piece.z), halfW: toRealWorld(halfW), halfD: toRealWorld(halfD) };
}

function footprintsOf(pieces: readonly PlacedItem[]): Footprint[] {
  const footprints: Footprint[] = [];
  for (const piece of pieces) {
    const footprint = placedFootprint(piece);
    if (footprint !== null) footprints.push(footprint);
  }
  return footprints;
}

/** The doors a piece stands in front of, in the room's order. */
export function doorsBlockedBy(piece: PlacedItem, spaces: readonly DoorClearSpace[]): readonly DoorClearSpace[] {
  const footprint = placedFootprint(piece);
  return footprint === null ? [] : spacesEntered([footprint], spaces);
}

/**
 * The doors any piece stands in front of, in the room's order: the floor's
 * question each frame of a drag, so it groups nothing and stops once every
 * door is found.
 */
export function doorsBlockedByAny(placedItems: readonly PlacedItem[], spaces: readonly DoorClearSpace[]): readonly DoorClearSpace[] {
  if (spaces.length === 0) return [];
  const found = new Set<DoorClearSpace>();
  for (const piece of placedItems) {
    const footprint = placedFootprint(piece);
    if (footprint === null) continue;
    for (const space of spaces) if (!found.has(space) && footprintInSpace(footprint, space)) found.add(space);
    if (found.size === spaces.length) break;
  }
  return spaces.filter((space) => found.has(space));
}

/** How strongly the floor shows every door's space while a piece is placed or carried. */
export const DOOR_FLOOR_FAINT = 0.45;
/** How strongly it shows a space something stands in, glowing gold beside the notice that names it: fully, so the warning reads from the planner's camera. */
export const DOOR_FLOOR_BLOCKED = 1;

export interface DoorFloorState {
  readonly spaces: readonly DoorClearSpace[];
  /** A piece is in hand (its ghost on the floor). */
  readonly placing: boolean;
  /** A hand is carrying placed pieces. */
  readonly carrying: boolean;
  /** The doors something stands in front of now: placed pieces, and the ghost while placing. */
  readonly entered: readonly DoorClearSpace[];
}

/**
 * How strongly each door's space shows on the floor, 0 to 1, by door id:
 * faintly while placing or carrying and fully where the piece is entering
 * one; otherwise not at all, except a space something already stands in.
 */
export function doorFloorStrengths(state: DoorFloorState): ReadonlyMap<string, number> {
  const handling = state.placing || state.carrying;
  return new Map(state.spaces.map((space) => {
    const entered = state.entered.includes(space);
    return [space.id, handling ? (entered ? 1 : DOOR_FLOOR_FAINT) : (entered ? DOOR_FLOOR_BLOCKED : 0)];
  }));
}

/** The open room as the door rule reads it: its clear spaces and interior, metres. */
export interface DoorRoom {
  readonly spaces: readonly DoorClearSpace[];
  readonly roomWidthM: number;
  readonly roomLengthM: number;
}

/**
 * Where `moving` (pieces that move together) goes to clear the doors, among
 * everything else in `placedItems`. `stepM` keeps it on the planner's grid
 * when snapping. A slide's offsets are metres, which are render units too
 * (RENDER_SCALE 1).
 */
export function doorSlideForPieces(
  moving: readonly PlacedItem[],
  placedItems: readonly PlacedItem[],
  room: DoorRoom,
  stepM: number | null,
  options: Pick<DoorSlideInput, "avoidOthers" | "maxDistanceM" | "anchor"> = {},
): DoorSlide {
  const movingIds = new Set(moving.map((piece) => piece.id));
  return slideClearOfDoors({
    moving: footprintsOf(moving),
    others: footprintsOf(placedItems.filter((piece) => !movingIds.has(piece.id))),
    spaces: room.spaces,
    roomWidthM: room.roomWidthM,
    roomLengthM: room.roomLengthM,
    stepM,
    ...options,
  });
}

/** A table with its chairs, a set, or a lone piece, standing in a door's clear space. */
export interface DoorBlocker {
  /** The pieces that move together, as a drag moves them. */
  readonly ids: readonly string[];
  /** As staff read it: "Table 4", "a round table", "a chair". */
  readonly name: string;
  /** The doors it stands in front of, in the room's order. */
  readonly doors: readonly DoorClearSpace[];
}

function blockerName(pieces: readonly PlacedItem[]): string {
  const table = pieces.find((piece) => {
    const item = getCatalogueItem(piece.catalogueItemId);
    return item !== undefined && isDiningTableItem(item);
  });
  const named = table ?? pieces[0];
  const label = named?.label?.trim() ?? "";
  if (label !== "") return label;
  const item = named === undefined ? undefined : getCatalogueItem(named.catalogueItemId);
  if (item === undefined) return "a piece";
  if (table !== undefined) return item.tableShape === "round" ? "a round table" : "a table";
  if (item.category === "chair") return pieces.length > 1 ? "a group of chairs" : "a chair";
  if (item.category === "table") return "a table";
  if (item.category === "stage") return "a stage section";
  return `the ${item.name}`;
}

/**
 * Every table with its chairs (or set, or lone piece) that stands in a door's
 * clear space, ordered by the first door it blocks, then as laid out. None
 * when the room has no recorded doors.
 */
export function doorBlockers(placedItems: readonly PlacedItem[], spaces: readonly DoorClearSpace[]): readonly DoorBlocker[] {
  if (spaces.length === 0) return [];
  const membersOf = createGroupMemberIdsLookup(placedItems);
  const byId = new Map(placedItems.map((piece) => [piece.id, piece]));
  const counted = new Set<string>();
  const blockers: DoorBlocker[] = [];
  for (const piece of placedItems) {
    if (counted.has(piece.id)) continue;
    const footprint = placedFootprint(piece);
    if (footprint === null || !spaces.some((space) => footprintInSpace(footprint, space))) continue;
    const ids = [...membersOf(piece.id)];
    for (const id of ids) counted.add(id);
    const pieces = ids.map((id) => byId.get(id)).filter((member): member is PlacedItem => member !== undefined);
    blockers.push({ ids, name: blockerName(pieces), doors: spacesEntered(footprintsOf(pieces), spaces) });
  }
  const firstDoor = (blocker: DoorBlocker): number => Math.min(...blocker.doors.map((door) => spaces.indexOf(door)));
  return blockers.sort((a, b) => firstDoor(a) - firstDoor(b));
}

function capitalised(words: string): string {
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * What blocks the doors, said plainly: "Table 4 is in front of the main
 * door." A second is named too; past that the rest are counted, their doors
 * in the room's order (`spaces`). Empty when nothing does.
 */
export function doorBlockedLine(blockers: readonly DoorBlocker[], spaces: readonly DoorClearSpace[]): string {
  const [first, second, ...rest] = blockers;
  if (first === undefined) return "";
  const opening = `${capitalised(first.name)} is in front of ${doorNameList(first.doors)}`;
  if (second === undefined) return `${opening}.`;
  if (rest.length === 0) return `${opening}, and ${second.name} in front of ${doorNameList(second.doors)}.`;
  const others = [second, ...rest];
  const blocked = new Set(others.flatMap((blocker) => blocker.doors));
  return `${opening}, and ${String(others.length)} more in front of ${doorNameList(spaces.filter((space) => blocked.has(space)))}.`;
}
