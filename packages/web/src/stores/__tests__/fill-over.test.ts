// Fill over a layout (card-dock Q-10; fillKeepOuts): the store's autoArrangeBanquet sets anew only
// the round groups of the fill table's kind, at the gangways' design to the room's doors; every
// other piece stays exactly where it is, ids and all, and keeps the aisle rule round it.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import { canLayOut, grandHallExits, planGangwayFill, FILL_AISLE_RULE } from "../../lib/auto-fill.js";
import { getCatalogueItem, getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { createGhostWorld, judgeGhost } from "../../lib/ghost-truth.js";
import { resetPlacedIdCounter, type PlacedItem } from "../../lib/placement.js";
import { setPlannerFeaturesForTesting } from "../../lib/planner-features.js";
import { cardParamsFor, stampSetup, type CardId, type CardParamsRequest } from "../../lib/setup-cards.js";
import { banquetSeatsPerTable } from "../../lib/table-group.js";
import { usePlacementStore } from "../placement-store.js";
import { useRoomDimensionsStore } from "../room-dimensions-store.js";

const round = getCatalogueItemBySlug("round-table-6ft-white");

function stamp(card: CardId, x: number, z: number, asked: CardParamsRequest = {}): readonly PlacedItem[] {
  const params = cardParamsFor(card, asked);
  if (params === null) throw new Error(`no ${card}`);
  return stampSetup(params, { x, z }, 0);
}

function fill(guests = 0): ReturnType<ReturnType<typeof usePlacementStore.getState>["autoArrangeBanquet"]> {
  if (round === undefined) throw new Error("no round");
  return usePlacementStore.getState().autoArrangeBanquet(round.id, guests, banquetSeatsPerTable(round), grandHallExits());
}

function placed(): readonly PlacedItem[] {
  return usePlacementStore.getState().placedItems;
}

beforeEach(() => {
  resetPlacedIdCounter();
  useRoomDimensionsStore.setState({ dimensions: GRAND_HALL_RENDER_DIMENSIONS });
  usePlacementStore.setState({ placedItems: [], ghostPosition: null });
  setPlannerFeaturesForTesting({ fillKeepOuts: true, tableSets: true });
});

afterEach(() => {
  setPlannerFeaturesForTesting(null);
});

describe("Fill over a layout", () => {
  it("states the figure the gangway design reaches in the Grand Hall: 110 with rounds of 10, against the 180 the venue publishes", () => {
    const plan = fill(180);
    expect(plan?.roomForSeats).toBe(110);
    expect(plan?.meetsTarget).toBe(false);
  });

  it("keeps a dance floor where it is, ids and all, and lays no table in it; the count falls", () => {
    const empty = round === undefined ? null : planGangwayFill({ table: round, seatsPerTable: 10, guests: 0, roomWidthM: 21, roomLengthM: 10.5, exits: grandHallExits(), rule: FILL_AISLE_RULE });
    const floor = stamp("dance-floor", 0, 0);
    usePlacementStore.setState({ placedItems: floor });
    let writes = 0;
    const unsubscribe = usePlacementStore.subscribe((state, previous) => { if (state.placedItems !== previous.placedItems) writes += 1; });
    const plan = fill();
    unsubscribe();
    expect(writes).toBe(1);
    expect(plan).not.toBeNull();
    for (const panel of floor) expect(placed()).toContain(panel);
    expect(plan?.roomForSeats ?? 0).toBeLessThan(empty?.roomForSeats ?? 0);
    const world = createGhostWorld(floor, GRAND_HALL_RENDER_DIMENSIONS);
    const refilled = placed().filter((piece) => !floor.includes(piece));
    for (const groupId of new Set(refilled.map((piece) => piece.groupId))) {
      const group = refilled.filter((piece) => piece.groupId === groupId);
      expect(judgeGhost(group, world).state).toBe("fits");
    }
  });

  it("keeps a top table set as it is, and sets its own rounds anew keeping their ids and names", () => {
    const top = stamp("top-table", 0, 4, { trestles: 4 });
    const old = stamp("round", -6, -2).map((piece, i) => (i === 0 ? { ...piece, label: "Table 7" } : piece));
    usePlacementStore.setState({ placedItems: [...top, ...old] });
    fill();
    for (const piece of top) expect(placed()).toContain(piece);
    const oldTable = old[0];
    const refilled = placed().find((piece) => piece.id === oldTable?.id);
    expect(refilled).toBeDefined();
    expect(refilled?.label).toBe("Table 7");
    expect(getCatalogueItem(refilled?.catalogueItemId ?? "")?.slug).toBe("round-table-6ft-white");
  });

  it("without the switch, fills as before", () => {
    setPlannerFeaturesForTesting(null);
    const floor = stamp("dance-floor", 0, 0);
    usePlacementStore.setState({ placedItems: floor });
    fill();
    expect(placed().some((piece) => floor.includes(piece))).toBe(false);
  });
});

describe("which styles may lay out a floor (planner-qol C-01)", () => {
  it("lets every style lay out an empty floor", () => {
    expect(canLayOut("dinner-rounds", true, false)).toBe(true);
    expect(canLayOut("theatre", true, false)).toBe(true);
  });

  it("lets banquet rounds re-plan a laid floor only with Fill over the layout, and never theatre rows", () => {
    expect(canLayOut("dinner-rounds", false, true)).toBe(true);
    expect(canLayOut("dinner-rounds", false, false)).toBe(false);
    expect(canLayOut("theatre", false, true)).toBe(false);
  });
});

describe("Fill over six numbered rounds (Q-46)", () => {
  it("keeps Table 1 to 6 and numbers the five new rounds Table 7 to 11", () => {
    setPlannerFeaturesForTesting({ fillKeepOuts: true, tableSets: true, tableNumbers: true });
    const isTable = (piece: PlacedItem): boolean => getCatalogueItem(piece.catalogueItemId)?.category === "table";
    const six = [-7.5, -4.5, -1.5, 1.5, 4.5, 7.5]
      .flatMap((x, i) => stamp("round", x, 0).map((piece, p) => (p === 0 ? { ...piece, label: `Table ${String(i + 1)}` } : piece)));
    usePlacementStore.setState({ placedItems: six });
    const oldTables = new Map(six.filter(isTable).map((table) => [table.id, table.label]));

    expect(fill(110)).not.toBeNull();
    const after = placed().filter(isTable);

    expect(after).toHaveLength(11);
    for (const [id, label] of oldTables) expect(after.find((table) => table.id === id)?.label).toBe(label);
    const added = after.filter((table) => !oldTables.has(table.id)).map((table) => table.label ?? "");
    expect([...added].sort((a, b) => a.localeCompare(b, "en", { numeric: true })))
      .toEqual(["Table 7", "Table 8", "Table 9", "Table 10", "Table 11"]);
  });
});
