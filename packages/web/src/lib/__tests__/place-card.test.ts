// A card set down from the hand (lib/place-in-hand.ts placeCardAt, stores/placement-store.ts
// placeSetup): its whole set as one step, judged again at the commit with every body, set down at
// the pose the judge resolves, its tables numbered (card-dock Q-05, Q-08a, Q-46).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import { getCatalogueItem, getCatalogueItemBySlug } from "../catalogue.js";
import { cardNeeds, registerStoreStock, stockIdentity } from "../card-stock.js";
import { createGhostWorld, judgeGhost } from "../ghost-truth.js";
import { judgeCardAt, placeCardAt, placePieceInHand } from "../place-in-hand.js";
import { computeSurfaceHeight, resetPlacedIdCounter, type PlacedItem } from "../placement.js";
import { setPlannerFeaturesForTesting } from "../planner-features.js";
import { cardParamsFor, stampSetup, type CardId, type CardParams, type CardParamsRequest } from "../setup-cards.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useChairDialogStore } from "../../stores/chair-dialog-store.js";
import { useGhostVerdictStore } from "../../stores/ghost-verdict-store.js";
import { usePlacementNoticeStore } from "../../stores/placement-notice-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";

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
  useGhostVerdictStore.getState().setVerdict(null);
  useSelectionStore.getState().clearSelection();
  useCatalogueStore.getState().disarm();
});

afterEach(() => {
  setPlannerFeaturesForTesting(null);
});

/** A piece's place, turn and height, to nine places, and what it is. */
function pose(piece: PlacedItem): string {
  return [piece.catalogueItemId, piece.x.toFixed(9), piece.z.toFixed(9), piece.y.toFixed(9), piece.rotationY.toFixed(9)].join(" ");
}

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

  it("judges a set card whatever the switch says: the card dock's own (QoL B-01)", () => {
    placeCardAt(params("round"), { x: 0, z: 0 }, 0);
    expect(placeCardAt(params("round"), { x: 0, z: CHAIR_REACH }, 0)).toEqual([]);
    expect(tables()).toHaveLength(1);
  });

  it("without the switch, sets a piece card's stamp down as asked", () => {
    setPlannerFeaturesForTesting({ setupCards: true });
    const poseur = params("piece:poseur-table");
    placeCardAt(poseur, { x: 0, z: 0 }, 0);
    placeCardAt(poseur, { x: 0, z: 0.1 }, 0);
    expect(tables()).toHaveLength(2);
  });
});

describe("one stamp for the ghost and the commit", () => {
  it("sets a turned, pushed set down exactly as the ghost judged it: each piece's place, turn and height", () => {
    setPlannerFeaturesForTesting({ truthfulGhost: true });
    placeCardAt(params("round"), { x: 0, z: 0 }, 0);
    const origin = { x: 0.4, z: 2 * CHAIR_REACH - 0.1 };
    const world = createGhostWorld(placed(), GRAND_HALL_RENDER_DIMENSIONS);
    const judged = judgeCardAt(params("round"), origin, 0.3, world, undefined);
    expect(judged.verdict.state).toBe("pushed");
    // The judged set carries the turn on its table (a round's ring of chairs stands as it does at any turn).
    expect(judged.pieces.find((piece) => getCatalogueItem(piece.catalogueItemId)?.category === "table")?.rotationY).toBeCloseTo(0.3, 9);
    const ids = placeCardAt(params("round"), origin, 0.3);
    const set = placed().filter((piece) => ids.includes(piece.id));
    expect(set.map(pose).sort()).toEqual(judged.pieces.map(pose).sort());
  });

  it("judges a long table turned a quarter at the wall as refused, where unturned it fits", () => {
    setPlannerFeaturesForTesting({ truthfulGhost: true, tableSets: true });
    const card = params("long-table");
    const world = createGhostWorld([], GRAND_HALL_RENDER_DIMENSIONS);
    const reach = Math.max(...stampSetup(card, { x: 0, z: 0 }, 0).map((piece) => Math.abs(piece.z))) + 0.6;
    const origin = { x: 0, z: GRAND_HALL_RENDER_DIMENSIONS.length / 2 - reach - 0.3 };
    expect(judgeCardAt(card, origin, 0, world, undefined).verdict.state).toBe("fits");
    expect(judgeCardAt(card, origin, Math.PI / 2, world, undefined).verdict.state).toBe("refused");
    expect(placeCardAt(card, origin, Math.PI / 2)).toEqual([]);
    expect(placeCardAt(card, origin, 0).length).toBeGreaterThan(0);
  });

  it("stands each piece on the surface under it: a round across a dance floor's edge has chairs on the floor and chairs off it", () => {
    setPlannerFeaturesForTesting({ truthfulGhost: true });
    placeCardAt(params("dance-floor"), { x: 0, z: 0 }, 0);
    const floor = placed();
    const edge = Math.max(...floor.map((panel) => panel.x)) + (getCatalogueItem(floor[0]?.catalogueItemId ?? "")?.width ?? 0) / 2;
    const ids = placeCardAt(params("round"), { x: edge, z: 0 }, 0);
    const set = placed().filter((piece) => ids.includes(piece.id));
    expect(set).toHaveLength(11);
    for (const piece of set) {
      const item = getCatalogueItem(piece.catalogueItemId);
      if (item === undefined) throw new Error("no item");
      expect(piece.y, item.slug).toBeCloseTo(computeSurfaceHeight(piece.x, piece.z, item, floor, new Set()), 9);
    }
    expect(set.some((piece) => piece.y > 0)).toBe(true);
    expect(set.some((piece) => piece.y === 0)).toBe(true);
  });

  it("refuses a set the store has too few chairs for, with the store's words, and places nothing (B2)", () => {
    const stamped = stampSetup(params("round"), { x: 0, z: 0 }, 0);
    const chair = stockIdentity(stamped.find((piece) => getCatalogueItem(piece.catalogueItemId)?.category === "chair")?.catalogueItemId ?? "");
    const stock = new Map([[chair, 8]]);
    expect(placeCardAt(params("round"), { x: 0, z: 0 }, 0, { stock })).toEqual([]);
    expect(placed()).toHaveLength(0);
    expect(usePlacementNoticeStore.getState().notice?.text).toMatch(/: 8 in store, this needs 10$/u);
    expect(placeCardAt(params("round", { seats: 8 }), { x: 0, z: 0 }, 0, { stock })).toHaveLength(9);
  });

  it("refuses a floor grown through a wall, and leaves it as it was", () => {
    const halfLength = GRAND_HALL_RENDER_DIMENSIONS.length / 2;
    placeCardAt(params("dance-floor"), { x: 0, z: halfLength - 2.4 }, 0);
    const before = placed();
    const groupId = before[0]?.groupId ?? "";
    expect(usePlacementStore.getState().resizeArea(groupId, 5, 8)).toBe(false);
    expect(placed()).toBe(before);
    expect(usePlacementNoticeStore.getState().notice?.text).toMatch(/^Won't fit/u);
  });
});

describe("the store's stock on every adding commit (B2 hard; QoL B-X1)", () => {
  let unregister: () => void = () => undefined;
  afterEach(() => { unregister(); });

  /** The stock identity of the one table a Round of 10 needs. */
  function roundIdentity(): string {
    const table = [...cardNeeds(params("round"))].find(([, count]) => count === 1)?.[0];
    if (table === undefined) throw new Error("no round in the card");
    return table;
  }

  it("places the one Round of 10 the store holds, puts the card down with the reason, and refuses another", () => {
    unregister = registerStoreStock(() => new Map([[roundIdentity(), 1]]));
    useCatalogueStore.getState().armCard("round");
    usePlacementStore.setState({ ghostPosition: [0, 0, 0] });
    expect(placePieceInHand(() => undefined)).toHaveLength(11);
    expect(useCatalogueStore.getState().armedCardId).toBeNull();
    expect(usePlacementNoticeStore.getState().notice?.text).toBe("None left in store · Round of 10");
    useCatalogueStore.getState().armCard("round");
    usePlacementStore.setState({ ghostPosition: [-6, 0, 0] });
    const before = placed();
    expect(placePieceInHand(() => undefined)).toEqual([]);
    expect(placed()).toBe(before);
    expect(usePlacementNoticeStore.getState().notice?.text).toMatch(/: 1 in store, this needs 2$/u);
  });

  it("refuses a table set down the old way past the store (the chair dialog's commit), and never refuses unknown stock", () => {
    const round = getCatalogueItemBySlug("round-table-6ft-white");
    if (round === undefined) throw new Error("no round");
    unregister = registerStoreStock(() => new Map([[roundIdentity(), 1]]));
    usePlacementStore.getState().placeTableGroup(round.id, 0, 0, 0, 10);
    const before = placed();
    usePlacementStore.getState().placeTableGroup(round.id, 6, 0, 0, 10);
    expect(placed()).toBe(before);
    unregister();
    usePlacementStore.getState().placeTableGroup(round.id, 6, 0, 0, 10);
    expect(tables()).toHaveLength(2);
  });
});

describe("a card set down as a card, whichever chrome armed it (Q-07, Q-13)", () => {
  it("sets every set card down whole in one write with no chair dialog, the switches as shipped", () => {
    for (const card of ["round", "top-table", "long-table", "dance-floor"] as const) {
      usePlacementStore.setState({ placedItems: [] });
      useCatalogueStore.getState().armCard(card);
      usePlacementStore.setState({ ghostPosition: [0, 0, 0] });
      const writes = writesDuring(() => { expect(placePieceInHand(() => undefined).length, card).toBeGreaterThan(1); });
      expect(writes, card).toBe(1);
      expect(useChairDialogStore.getState().pending, card).toBeNull();
    }
  });

  it("keeps v1's chair dialog for a dining table with the card dock on, until its seats ride on the card", () => {
    const round = getCatalogueItemBySlug("round-table-6ft-white");
    if (round === undefined) throw new Error("no round");
    setPlannerFeaturesForTesting({ setupCards: true });
    useCatalogueStore.getState().selectItem(round.id);
    usePlacementStore.setState({ ghostPosition: [0, 0, 0] });
    placePieceInHand(() => undefined);
    expect(placed()).toHaveLength(0);
    expect(useChairDialogStore.getState().pending).toMatchObject({ catalogueItemId: round.id });
    useChairDialogStore.getState().clearDialog();
    setPlannerFeaturesForTesting({ setupCards: true, seatsOnTheCard: true });
    useCatalogueStore.getState().selectItem(round.id);
    usePlacementStore.setState({ ghostPosition: [0, 0, 0] });
    expect(placePieceInHand(() => undefined).length).toBeGreaterThan(1);
    expect(useChairDialogStore.getState().pending).toBeNull();
  });

  it("still asks the chair dialog for a dining table picked from v1's list while the card dock is off", () => {
    const round = getCatalogueItemBySlug("round-table-6ft-white");
    if (round === undefined) throw new Error("no round");
    useCatalogueStore.getState().selectItem(round.id);
    usePlacementStore.setState({ ghostPosition: [0, 0, 0] });
    placePieceInHand(() => undefined);
    expect(placed()).toHaveLength(0);
    expect(useChairDialogStore.getState().pending).toMatchObject({ catalogueItemId: round.id });
    useChairDialogStore.getState().clearDialog();
  });
});

describe("a click on a placed piece with something in hand (truthfulGhost)", () => {
  function ghostAt(x: number, z: number): void {
    usePlacementStore.setState({ ghostPosition: [x, 0, z] });
  }

  it("picks the piece where the card's set could not stand, and puts the card down", () => {
    setPlannerFeaturesForTesting({ setupCards: true, truthfulGhost: true });
    placeCardAt(params("round"), { x: 0, z: 0 }, 0);
    const before = placed();
    const table = tables()[0];
    useCatalogueStore.getState().armCard("round");
    ghostAt(0, 0);
    expect(placePieceInHand(() => undefined, { pieceUnderPointer: table?.id ?? null })).toEqual([]);
    expect(placed()).toBe(before);
    expect(useSelectionStore.getState().selectedIds).toEqual(new Set([table?.id]));
    expect(useCatalogueStore.getState().cardParams).toBeNull();
  });

  it("sets the card's set down where it fits, though the pointer is on a piece (seen past a chair back)", () => {
    setPlannerFeaturesForTesting({ setupCards: true, truthfulGhost: true });
    placeCardAt(params("round"), { x: -6, z: 0 }, 0);
    const far = tables()[0];
    useCatalogueStore.getState().armCard("round");
    ghostAt(0, 0);
    expect(placePieceInHand(() => undefined, { pieceUnderPointer: far?.id ?? null })).toHaveLength(11);
    expect(tables()).toHaveLength(2);
    expect(useSelectionStore.getState().selectedIds.size).toBe(0);
    expect(useCatalogueStore.getState().armedCardId).toBe("round");
  });

  it("dresses the table a cloth is let go on, never picks it", () => {
    setPlannerFeaturesForTesting({ setupCards: true, truthfulGhost: true });
    const poseur = getCatalogueItemBySlug("poseur-table");
    const cloth = getCatalogueItemBySlug("white-table-cloth");
    if (poseur === undefined || cloth === undefined) throw new Error("no poseur or cloth");
    usePlacementStore.getState().placeItem(poseur.id, 0, 0, 0);
    const table = placed()[0];
    useCatalogueStore.getState().selectItem(cloth.id);
    ghostAt(0, 0);
    placePieceInHand(() => undefined, { pieceUnderPointer: table?.id ?? null });
    expect(placed()[0]).toMatchObject({ id: table?.id, clothed: true, clothStyle: "white" });
    expect(useSelectionStore.getState().selectedIds.size).toBe(0);
    expect(useCatalogueStore.getState().selectedItemId).toBe(cloth.id);
  });
});

describe("the ghost following the pointer (setupCards)", () => {
  it("keeps a card's whole set off the single piece's wall snap, and keeps the snap for a piece alone", () => {
    setPlannerFeaturesForTesting({ setupCards: true });
    const halfWidth = GRAND_HALL_RENDER_DIMENSIONS.width / 2;
    const poseur = getCatalogueItemBySlug("poseur-table");
    if (poseur === undefined) throw new Error("no poseur");
    useCatalogueStore.getState().armCard("round");
    const tableId = useCatalogueStore.getState().selectedItemId ?? "";
    usePlacementStore.setState({ snapEnabled: false });
    usePlacementStore.getState().updateGhost(halfWidth - 1.2, 0, tableId);
    expect(usePlacementStore.getState().ghostPosition?.[0]).toBe(halfWidth - 1.2);
    useCatalogueStore.getState().selectItem(poseur.id);
    usePlacementStore.getState().updateGhost(halfWidth - poseur.width / 2 - 0.05, 0, poseur.id);
    expect(usePlacementStore.getState().ghostPosition?.[0]).toBeCloseTo(halfWidth - poseur.width / 2, 6);
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
