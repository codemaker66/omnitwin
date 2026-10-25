// A card set down from the hand (lib/place-in-hand.ts placeCardAt, stores/placement-store.ts
// placeSetup): its whole set as one step, judged again at the commit with every body, set down at
// the pose the judge resolves, its tables numbered (card-dock Q-05, Q-08a, Q-46).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import { getCatalogueItem, getCatalogueItemBySlug } from "../catalogue.js";
import { createGhostWorld, judgeGhost } from "../ghost-truth.js";
import { placeCardAt } from "../place-in-hand.js";
import { resetPlacedIdCounter, type PlacedItem } from "../placement.js";
import { setPlannerFeaturesForTesting } from "../planner-features.js";
import { cardParamsFor, stampSetup, type CardId, type CardParams, type CardParamsRequest } from "../setup-cards.js";
import { usePlacementNoticeStore } from "../../stores/placement-notice-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";

/** A 6 ft round's outermost chair reach along Z: its ring radius and half a chair's depth. */
const CHAIR_REACH = 0.915 + 0.05 + 0.58;

function params(card: CardId, asked: CardParamsRequest = {}): CardParams {
  const found = cardParamsFor(card, asked);
  if (found === null) throw new Error(`no ${card}`);
  return found;
}

function placed(): readonly PlacedItem[] {
  return usePlacementStore.getState().placedItems;
}

function tables(): readonly PlacedItem[] {
  return placed().filter((piece) => getCatalogueItem(piece.catalogueItemId)?.category === "table");
}

/** How many times placedItems is written while `act` runs: EditorBridge makes each write one undo step. */
function writesDuring(act: () => void): number {
  let writes = 0;
  const unsubscribe = usePlacementStore.subscribe((state, previous) => { if (state.placedItems !== previous.placedItems) writes += 1; });
  act();
  unsubscribe();
  return writes;
}

beforeEach(() => {
  resetPlacedIdCounter();
  useRoomDimensionsStore.setState({ dimensions: GRAND_HALL_RENDER_DIMENSIONS });
  usePlacementStore.setState({ placedItems: [], ghostPosition: null, ghostValid: false, ghostInvalidReason: null, snapEnabled: true });
  usePlacementNoticeStore.getState().dismiss();
});

afterEach(() => {
  setPlannerFeaturesForTesting(null);
});

describe("a card set down", () => {
  it("lays a Round of 10 as one step: the table and its ten chairs, one group", () => {
    const writes = writesDuring(() => { placeCardAt(params("round"), { x: 0, z: 0 }, 0); });
    expect(writes).toBe(1);
    expect(placed()).toHaveLength(11);
    expect(new Set(placed().map((piece) => piece.groupId)).size).toBe(1);
  });

  it("lays a 5 × 5 dance floor as one group with no table, which the seat stepper on a round beside it leaves alone", () => {
    placeCardAt(params("dance-floor"), { x: -5, z: 0 }, 0);
    placeCardAt(params("round"), { x: 4, z: 0 }, 0);
    const floor = placed().filter((piece) => getCatalogueItem(piece.catalogueItemId)?.slug === "dancefloor-panel");
    expect(floor).toHaveLength(25);
    expect(new Set(floor.map((piece) => piece.groupId)).size).toBe(1);
    const round = tables()[0];
    if (round === undefined) throw new Error("no round");
    usePlacementStore.getState().rearrangeGroup(round.id, 8);
    expect(placed().filter((piece) => getCatalogueItem(piece.catalogueItemId)?.slug === "dancefloor-panel")).toEqual(floor);
    expect(placed().filter((piece) => piece.groupId === round.groupId)).toHaveLength(9);
  });

  it("resizes a 5 × 5 floor to 6 × 5 as one write, five panels added and the 25 in place keeping their ids", () => {
    placeCardAt(params("dance-floor"), { x: 0, z: 0 }, 0);
    const before = placed();
    const groupId = before[0]?.groupId ?? "";
    const writes = writesDuring(() => { expect(usePlacementStore.getState().resizeArea(groupId, 6, 5)).toBe(true); });
    expect(writes).toBe(1);
    expect(placed()).toHaveLength(30);
    expect(placed().every((piece) => piece.groupId === groupId)).toBe(true);
    const ids = new Set(placed().map((piece) => piece.id));
    for (const panel of before) expect(ids.has(panel.id)).toBe(true);
  });

  it("leaves a floor as it is when its size does not change, and anything that is not a floor alone", () => {
    placeCardAt(params("dance-floor"), { x: -5, z: 0 }, 0);
    placeCardAt(params("round"), { x: 5, z: 0 }, 0);
    const floorGroup = placed()[0]?.groupId ?? "";
    const roundGroup = tables()[0]?.groupId ?? "";
    const before = placed();
    expect(usePlacementStore.getState().resizeArea(floorGroup, 5, 5)).toBe(false);
    expect(usePlacementStore.getState().resizeArea(roundGroup, 6, 6)).toBe(false);
    expect(placed()).toBe(before);
  });

  it("lays the set exactly where it was asked, never snapped to the grid", () => {
    placeCardAt(params("round"), { x: 0.37, z: -1.23 }, 0.4);
    expect(tables()[0]).toMatchObject({ x: 0.37, z: -1.23, rotationY: 0.4 });
  });
});

describe("the truthful ghost at the commit (truthfulGhost)", () => {
  it("sets a set the judge pushes clear down at the pushed pose, overlapping nothing", () => {
    setPlannerFeaturesForTesting({ truthfulGhost: true });
    placeCardAt(params("round"), { x: 0, z: 0 }, 0);
    const origin = { x: 0, z: 2 * CHAIR_REACH - 0.1 };
    const verdict = judgeGhost(stampSetup(params("round"), origin, 0), createGhostWorld(placed(), GRAND_HALL_RENDER_DIMENSIONS));
    expect(verdict.state).toBe("pushed");
    if (verdict.state !== "pushed") return;
    placeCardAt(params("round"), origin, 0);
    const second = tables()[1];
    expect(second?.x).toBeCloseTo(origin.x + verdict.dx, 9);
    expect(second?.z).toBeCloseTo(origin.z + verdict.dz, 9);
    const set = placed().filter((piece) => piece.groupId === second?.groupId);
    expect(judgeGhost(set, createGhostWorld(placed(), GRAND_HALL_RENDER_DIMENSIONS), { excludeIds: new Set(set.map((piece) => piece.id)) }).state).toBe("fits");
  });

  it("refuses a set that would sit in another, places nothing and says why", () => {
    setPlannerFeaturesForTesting({ truthfulGhost: true });
    placeCardAt(params("round"), { x: 0, z: 0 }, 0);
    const before = placed();
    const writes = writesDuring(() => { expect(placeCardAt(params("round"), { x: 0, z: CHAIR_REACH }, 0)).toEqual([]); });
    expect(writes).toBe(0);
    expect(placed()).toBe(before);
    expect(usePlacementNoticeStore.getState().notice?.text).toMatch(/^Won't fit · would overlap the round/u);
  });

  it("without the switch, sets the stamp down as asked", () => {
    placeCardAt(params("round"), { x: 0, z: 0 }, 0);
    placeCardAt(params("round"), { x: 0, z: CHAIR_REACH }, 0);
    expect(tables()).toHaveLength(2);
  });
});

describe("table numbers (tableNumbers)", () => {
  it("numbers three rounds 1 to 3, and gives the number of a removed one to the next", () => {
    setPlannerFeaturesForTesting({ tableNumbers: true });
    for (const x of [-6, 0, 6]) placeCardAt(params("round"), { x, z: 0 }, 0);
    expect(tables().map((table) => table.label)).toEqual(["Table 1", "Table 2", "Table 3"]);
    const second = tables()[1];
    if (second === undefined) throw new Error("no table 2");
    usePlacementStore.getState().removeItems(new Set([second.id]));
    placeCardAt(params("round"), { x: 0, z: 3.5 }, 0);
    expect(tables().map((table) => table.label).sort()).toEqual(["Table 1", "Table 2", "Table 3"]);
  });

  it("numbers every trestle of a set, and a table placed the old way", () => {
    setPlannerFeaturesForTesting({ tableNumbers: true, tableSets: true });
    placeCardAt(params("long-table", { trestles: 2 }), { x: 0, z: 0 }, 0);
    const round = getCatalogueItemBySlug("round-table-6ft-white");
    if (round === undefined) throw new Error("no round");
    usePlacementStore.getState().placeTableGroup(round.id, 6, 0, 0, 10);
    expect(tables().map((table) => table.label)).toEqual(["Table 1", "Table 2", "Table 3"]);
  });

  it("numbers a table laid out before numbering the first time it is moved, and leaves a named one alone", () => {
    const legacy = [...stampSetup(params("round"), { x: -5, z: 0 }, 0), ...stampSetup(params("round"), { x: 5, z: 0 }, 0)];
    const named = legacy.map((piece, i) => (i === 11 ? { ...piece, label: "Top table" } : piece));
    usePlacementStore.setState({ placedItems: named });
    setPlannerFeaturesForTesting({ tableNumbers: true });
    const first = named[0];
    const other = named[11];
    if (first === undefined || other === undefined) throw new Error("no tables");
    usePlacementStore.getState().moveGroup(first.id, 0.5, 0);
    usePlacementStore.getState().moveGroup(other.id, -0.5, 0);
    expect(placed().find((piece) => piece.id === first.id)?.label).toBe("Table 1");
    expect(placed().find((piece) => piece.id === other.id)?.label).toBe("Top table");
  });

  it("leaves labels alone without the switch", () => {
    placeCardAt(params("round"), { x: 0, z: 0 }, 0);
    expect(tables()[0]?.label ?? "").toBe("");
  });
});
