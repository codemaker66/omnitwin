// The gangway review of whatever a click sets down (lib/auto-fill gangwayReview), swept over the three
// shaped rooms: every footprint in the catalogue, the long thin ones among them, each at 0 and at 90 degrees,
// with the grid on and off, a pointer every 0.23 m over the room's bounds. A click against a wall leaves the
// piece flush against it, which is where the second round's sweep did not look (it set units down
// directly and left out every one within a centimetre of a wall). Each click is the real path
// (gangway-against-walls.ts setDown), and each review is judged there by the slow way: nothing the shared
// schema refuses, 0.00 m only for a wall a piece lies against, real floor inside the room.
import { afterEach, describe, expect, it } from "vitest";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useChairDialogStore } from "../../stores/chair-dialog-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";
import { CATALOGUE_ITEMS } from "../catalogue.js";
import { isSceneFurniturePlacement } from "../table-dressing.js";
import { banquetSeatsPerTable } from "../table-group.js";
import {
  addUp,
  count,
  emptyTally,
  faultsOf,
  inWords,
  NO_FAULTS,
  piece,
  room,
  setDown,
  SHAPED_ROOMS,
  verdictOn,
  type Verdict,
} from "./gangway-against-walls.js";

/** A step no multiple of which is a grid line, so the pointers fall all over each grid cell. */
const POINTER_STEP = 0.23;

/** The catalogue's pieces that stand on the floor, one for each footprint: pieces of one kind, shape and size are set down alike. */
function oneOfEachFootprint(): readonly (readonly [string, string, boolean])[] {
  const alike = new Map<string, string[]>();
  for (const item of CATALOGUE_ITEMS) {
    if (!isSceneFurniturePlacement({ catalogueItemId: item.id })) continue;
    const footprint = `${item.category} ${String(item.tableShape)} ${String(item.width)} by ${String(item.depth)}`;
    alike.set(footprint, [...(alike.get(footprint) ?? []), item.slug]);
  }
  return [...alike.values()].flatMap((slugs) => {
    const [first] = slugs;
    return first === undefined ? [] : [[slugs.join(", "), first, false] as const];
  });
}

/**
 * What is in hand: every footprint in the catalogue, the long thin ones among them (the projector screen, the
 * room divider, the stage platforms, the trestles), each on its own; and a 6 ft trestle and a 6 ft round with
 * the chairs their chair question offers.
 */
const IN_HAND: readonly (readonly [string, string, boolean])[] = [
  ...oneOfEachFootprint(),
  ["a 6 ft trestle with its chairs", "trestle-6ft", true],
  ["a 6 ft round with its chairs", "round-table-6ft-white", true],
];

const inAll = emptyTally();
/** How many of the sweeps below have run: the last case speaks for them all only when all have. */
let sweeps = 0;

afterEach(() => {
  useCatalogueStore.getState().clearSelection();
  usePlacementStore.setState({ placedItems: [], ghostPosition: null, ghostRotation: 0, ghostValid: false, ghostInvalidReason: null, snapEnabled: true });
  useChairDialogStore.getState().clearDialog();
  useRoomDimensionsStore.getState().setDimensions(GRAND_HALL_RENDER_DIMENSIONS);
});

describe.each(SHAPED_ROOMS)("the gangway review of what a click sets down in the %s", (name) => {
  it.each(IN_HAND)("%s: nothing refused, no item without floor, 0.00 m only for a wall it lies against", (what, slug, withChairs) => {
    const r = room(name);
    const item = piece(slug);
    const seats = withChairs ? banquetSeatsPerTable(item) : 0;
    useRoomDimensionsStore.getState().setDimensions(r.dims);
    const xs = r.walls.map(([x]) => x);
    const zs = r.walls.map(([, z]) => z);
    const tally = emptyTally();
    // One spot is clicked from many pointers, most of all with the grid on: each is judged once.
    const verdicts = new Map<string, Verdict>();
    for (const snapEnabled of [true, false]) {
      for (const turn of [0, Math.PI / 2]) {
        for (let x = Math.min(...xs) + POINTER_STEP / 2; x < Math.max(...xs); x += POINTER_STEP) {
          for (let z = Math.min(...zs) + POINTER_STEP / 2; z < Math.max(...zs); z += POINTER_STEP) {
            const set = setDown(item, seats, x, z, turn, snapEnabled);
            if (set === null) continue;
            const spot = set.map((placed) => `${placed.catalogueItemId} ${String(placed.x)} ${String(placed.z)} ${String(placed.rotationY)}`).join("|");
            const verdict = verdicts.get(spot) ?? verdictOn(r, set);
            verdicts.set(spot, verdict);
            const [first] = set;
            count(tally, verdict, `grid ${snapEnabled ? "on" : "off"}, turned ${turn === 0 ? "0" : "90"}, pointer (${x.toFixed(3)}, ${z.toFixed(3)}), set at (${first?.x.toFixed(3) ?? "?"}, ${first?.z.toFixed(3) ?? "?"})`);
          }
        }
      }
    }
    addUp(inAll, tally);
    sweeps += 1;
    console.log(`swept ${name} | ${what}: spots ${String(verdicts.size)}, clicks ${inWords(tally)}`);
    expect(tally.units).toBeGreaterThan(1000);
    expect(faultsOf(tally)).toEqual(NO_FAULTS);
  }, 900_000);
});

describe("the gangway review of what a click sets down, in all three rooms", () => {
  it("held every item of every click to the slow way", () => {
    console.log(`swept in all: clicks ${inWords(inAll)}`);
    // Run on its own, or beside only some of the sweeps, this has nothing to add up: each sweep has spoken for itself.
    if (sweeps < SHAPED_ROOMS.length * IN_HAND.length) return;
    expect(inAll.units).toBeGreaterThan(100_000);
    expect(inAll.againstAWall).toBeGreaterThan(30_000);
    expect({ refused: inAll.refused, withoutFloor: inAll.withoutFloor, offTheFloor: inAll.offTheFloor, falseZero: inAll.falseZero, falseGap: inAll.falseGap, unsaid: inAll.unsaid }).toEqual({ refused: 0, withoutFloor: 0, offTheFloor: 0, falseZero: 0, falseGap: 0, unsaid: 0 });
  });
});
