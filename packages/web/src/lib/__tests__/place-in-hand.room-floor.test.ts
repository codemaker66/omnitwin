// Where a click sets the piece in hand down (lib/place-in-hand.ts), room by room. The ghost shows
// where the piece will stand, and a click on a valid ghost must set it exactly there. In a room
// that carries its own floor (lib/room-floor) the placement store used to take the ghost's spot
// through the grid and the walls a second time, and the floor's wall rule does not give the same
// answer twice: the piece was set down up to 1.44 m from its valid ghost, on a spot nothing had
// judged against the other furniture (review of audit editor-save-4, finding 1).
//
// Each case drives the real path: the catalogue pick, the store's own ghost for a pointer, the click
// (placePieceInHand) and, for a dining table, the chair question's answer.
import { afterEach, describe, expect, it } from "vitest";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import { roomGeometries } from "../../data/room-geometries.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useChairDialogStore } from "../../stores/chair-dialog-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";
import { getCatalogueItemBySlug, type CatalogueItem } from "../catalogue.js";
import { answerChairQuestion } from "../chair-question.js";
import { placePieceInHand } from "../place-in-hand.js";
import { createPlacedItem, getPlacementViolations, type PlacedItem } from "../placement.js";
import { plannerRoomOf, type PlannerRoomDimensions } from "../room-floor.js";
import { banquetSeatsPerTable } from "../table-group.js";

const SHAPED_ROOMS = ["Robert Adam Room", "Reception Room", "Saloon"] as const;

function piece(slug: string): CatalogueItem {
  const found = getCatalogueItemBySlug(slug);
  if (found === undefined) throw new Error(`no catalogue item ${slug}`);
  return found;
}

/** The room as the planner's room store holds it once the room is open. */
function roomNamed(name: string): PlannerRoomDimensions {
  const geometry = roomGeometries[name];
  if (geometry === undefined) throw new Error(`no geometry for ${name}`);
  return plannerRoomOf(geometry.wallPolygon, geometry.ceilingHeight);
}

function emptyFloor(snapEnabled: boolean, placedItems: readonly PlacedItem[] = []): void {
  usePlacementStore.setState({ placedItems, ghostPosition: null, ghostRotation: 0, ghostValid: false, ghostInvalidReason: null, snapEnabled });
  useChairDialogStore.getState().clearDialog();
}

/** A click with `item` in hand; a dining table's chair question is answered with `seats`. The piece set down, if any. */
function click(item: CatalogueItem, seats: number, before: readonly PlacedItem[] = []): PlacedItem | undefined {
  placePieceInHand(() => undefined);
  if (useChairDialogStore.getState().pending !== null) answerChairQuestion(seats);
  const had = new Set(before.map((placed) => placed.id));
  return usePlacementStore.getState().placedItems.find((placed) => placed.catalogueItemId === item.id && !had.has(placed.id));
}

/** A step no multiple of which is a grid line, so the pointers fall all over each grid cell. */
const POINTER_STEP = 0.23;

interface Clicks {
  /** Pointers whose ghost was valid, each of them clicked. */
  readonly valid: number;
  /** Clicks that set the piece anywhere but exactly on its ghost. */
  readonly astray: number;
  /** The one set down farthest from its ghost. */
  readonly worst: string | null;
}

/** A click at every pointer over the room's bounds whose ghost is valid, on an empty floor each time. */
function clickEverywhere(room: PlannerRoomDimensions, bounds: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number }, item: CatalogueItem, seats: number, snapEnabled: boolean): Clicks {
  useRoomDimensionsStore.getState().setDimensions(room);
  let valid = 0;
  let astray = 0;
  let worstM = 0;
  let worst: string | null = null;
  for (let x = bounds.minX + POINTER_STEP / 2; x < bounds.maxX; x += POINTER_STEP) {
    for (let z = bounds.minZ + POINTER_STEP / 2; z < bounds.maxZ; z += POINTER_STEP) {
      emptyFloor(snapEnabled);
      useCatalogueStore.getState().selectItem(item.id);
      usePlacementStore.getState().updateGhost(x, z, item.id);
      const { ghostPosition, ghostValid } = usePlacementStore.getState();
      if (ghostPosition === null || !ghostValid) continue;
      valid += 1;
      const [gx, , gz] = ghostPosition;
      const set = click(item, seats);
      if (set !== undefined && set.x === gx && set.z === gz) continue;
      astray += 1;
      const offM = set === undefined ? Number.POSITIVE_INFINITY : Math.hypot(set.x - gx, set.z - gz);
      if (offM <= worstM) continue;
      worstM = offM;
      worst = `pointer (${x.toFixed(3)}, ${z.toFixed(3)}), valid ghost (${gx.toFixed(3)}, ${gz.toFixed(3)}), `
        + (set === undefined ? "nothing set down" : `set down at (${set.x.toFixed(3)}, ${set.z.toFixed(3)}), ${offM.toFixed(2)} m away`);
    }
  }
  return { valid, astray, worst };
}

function boundsOf(name: string): { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number } {
  const geometry = roomGeometries[name];
  if (geometry === undefined) throw new Error(`no geometry for ${name}`);
  const xs = geometry.wallPolygon.map(([x]) => x);
  const zs = geometry.wallPolygon.map(([, z]) => z);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

const CHAIR = piece("burgess-turini-18-3");
const TRESTLE = piece("trestle-6ft");
const ROUND = piece("round-table-6ft-white");

/** What is in hand, and the seats its chair question is answered with (0 sets a table down alone). */
const IN_HAND: readonly (readonly [string, CatalogueItem, number])[] = [
  ["a chair", CHAIR, 0],
  ["a 6 ft trestle on its own", TRESTLE, 0],
  ["a 6 ft round on its own", ROUND, 0],
  ["a 6 ft trestle with its chairs", TRESTLE, banquetSeatsPerTable(TRESTLE)],
  ["a 6 ft round with its chairs", ROUND, banquetSeatsPerTable(ROUND)],
];

afterEach(() => {
  useCatalogueStore.getState().clearSelection();
  emptyFloor(true);
  useRoomDimensionsStore.getState().setDimensions(GRAND_HALL_RENDER_DIMENSIONS);
});

describe.each(SHAPED_ROOMS)("a click in the %s", (name) => {
  describe.each([["on", true], ["off", false]] as const)("with the grid %s", (_grid, snapEnabled) => {
    it.each(IN_HAND)("sets %s exactly where its valid ghost stood", (_what, item, seats) => {
      const clicks = clickEverywhere(roomNamed(name), boundsOf(name), item, seats, snapEnabled);
      expect(clicks.valid).toBeGreaterThan(400);
      expect({ astray: clicks.astray, worst: clicks.worst }).toEqual({ astray: 0, worst: null });
    });
  });
});

describe("a click in the Grand Hall, a rectangle centred on the origin", () => {
  // Here the store still takes the ghost's spot through the grid and the walls again, as it always has:
  // the rectangle's rule gives the same answer the second time. These held before the shaped rooms' fix.
  describe.each([["on", true], ["off", false]] as const)("with the grid %s", (_grid, snapEnabled) => {
    it.each(IN_HAND)("sets %s exactly where its valid ghost stood", (_what, item, seats) => {
      const { width, length } = GRAND_HALL_RENDER_DIMENSIONS;
      const bounds = { minX: -width / 2, maxX: width / 2, minZ: -length / 2, maxZ: length / 2 };
      const clicks = clickEverywhere(GRAND_HALL_RENDER_DIMENSIONS, bounds, item, seats, snapEnabled);
      expect(clicks.valid).toBeGreaterThan(400);
      expect({ astray: clicks.astray, worst: clicks.worst }).toEqual({ astray: 0, worst: null });
    });
  });
});

describe("a click in the Reception Room, by the review's own example", () => {
  it("sets a 6 ft round down on its ghost at (-3.241, -2), not 1.44 m along the wall", () => {
    useRoomDimensionsStore.getState().setDimensions(roomNamed("Reception Room"));
    emptyFloor(true);
    useCatalogueStore.getState().selectItem(ROUND.id);
    usePlacementStore.getState().updateGhost(-2.45, -2.45, ROUND.id);
    const { ghostPosition, ghostValid } = usePlacementStore.getState();
    expect(ghostValid).toBe(true);
    expect(ghostPosition?.[0]).toBeCloseTo(-3.241, 3);
    expect(ghostPosition?.[2]).toBe(-2);
    const set = click(ROUND, 0);
    expect([set?.x, set?.z]).toEqual([ghostPosition?.[0], ghostPosition?.[2]]);
  });

  it("never sets the round down on a chair its ghost stood clear of", () => {
    const room = roomNamed("Reception Room");
    useRoomDimensionsStore.getState().setDimensions(room);
    // A chair where the second pass used to carry the round.
    const chair = createPlacedItem(CHAIR.id, -3.241, -0.559);
    emptyFloor(true, [chair]);
    useCatalogueStore.getState().selectItem(ROUND.id);
    usePlacementStore.getState().updateGhost(-2.45, -2.45, ROUND.id);
    const { ghostPosition, ghostValid } = usePlacementStore.getState();
    expect(ghostValid).toBe(true);
    const set = click(ROUND, 0, [chair]);
    expect([set?.x, set?.z]).toEqual([ghostPosition?.[0], ghostPosition?.[2]]);
    if (set === undefined) throw new Error("nothing set down");
    expect(getPlacementViolations(set.x, set.z, ROUND, set.rotationY, [chair], new Set(), set.y, room)).toEqual([]);
  });
});
