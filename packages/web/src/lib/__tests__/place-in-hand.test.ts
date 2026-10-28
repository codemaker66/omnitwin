// Setting the piece in hand down (lib/place-in-hand.ts). With its seats on the card a dining
// table and its chairs land in one step and no dialog opens (Q-07); without the switch the chair
// dialog asks, as before. The piece stays in hand either way it lands.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCatalogueItemBySlug } from "../catalogue.js";
import { placePieceInHand } from "../place-in-hand.js";
import { resetPlacedIdCounter } from "../placement.js";
import { setPlannerFeaturesForTesting } from "../planner-features.js";
import { seatsInHand } from "../setup-cards.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useChairDialogStore } from "../../stores/chair-dialog-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { usePlacementNoticeStore } from "../../stores/placement-notice-store.js";
import { createTableGroup } from "../table-group.js";

const round = getCatalogueItemBySlug("round-table-6ft");
const chair = getCatalogueItemBySlug("banquet-chair");

function inHandAt(itemId: string, x: number, z: number): void {
  useCatalogueStore.getState().selectItem(itemId);
  usePlacementStore.getState().updateGhost(x, z, itemId);
}

describe("placePieceInHand", () => {
  beforeEach(() => {
    resetPlacedIdCounter();
    usePlacementStore.setState({ placedItems: [], ghostPosition: null, ghostValid: false, ghostInvalidReason: null, snapEnabled: true });
    useChairDialogStore.getState().clearDialog();
  });

  afterEach(() => {
    setPlannerFeaturesForTesting(null);
    useCatalogueStore.getState().clearSelection();
  });

  it("sets a round and its seats down in one step with no dialog when the seats ride on the card", () => {
    setPlannerFeaturesForTesting({ seatsOnTheCard: true });
    expect(round).toBeDefined();
    if (round === undefined) return;
    inHandAt(round.id, 0, 0);
    const params = useCatalogueStore.getState().cardParams;
    expect(params).not.toBeNull();
    const seats = params === null ? 0 : seatsInHand(params);
    expect(seats).toBeGreaterThan(0);
    // EditorBridge mirrors each write of placedItems into the undo timeline: one write is one step.
    let writes = 0;
    const unsubscribe = usePlacementStore.subscribe((state, previous) => { if (state.placedItems !== previous.placedItems) writes += 1; });
    placePieceInHand(vi.fn());
    unsubscribe();
    expect(writes).toBe(1);
    const placed = usePlacementStore.getState().placedItems;
    expect(placed.filter((item) => item.catalogueItemId === round.id)).toHaveLength(1);
    expect(placed).toHaveLength(1 + seats);
    expect(useChairDialogStore.getState().pending).toBeNull();
    // Still in hand for the next one.
    expect(useCatalogueStore.getState().selectedItemId).toBe(round.id);
  });

  it("asks for the seats in the chair dialog without the switch, as before", () => {
    setPlannerFeaturesForTesting({ seatsOnTheCard: false });
    if (round === undefined) throw new Error("No round table in the catalogue");
    inHandAt(round.id, 0, 0);
    placePieceInHand(vi.fn());
    expect(usePlacementStore.getState().placedItems).toHaveLength(0);
    expect(useChairDialogStore.getState().pending?.catalogueItemId).toBe(round.id);
  });

  it("refuses, behind truthfulGhost alone, a round its ghost showed refused: nothing placed, no dialog, the ghost's words", () => {
    setPlannerFeaturesForTesting({ truthfulGhost: true, setupCards: false, seatsOnTheCard: false });
    if (round === undefined) throw new Error("No round table in the catalogue");
    const standing = createTableGroup(round.id, 0, 0, 0, 10);
    usePlacementStore.setState({ placedItems: standing });
    usePlacementNoticeStore.getState().dismiss();
    inHandAt(round.id, 0.4, 0);
    placePieceInHand(vi.fn());
    expect(usePlacementStore.getState().placedItems).toBe(standing);
    expect(useChairDialogStore.getState().pending).toBeNull();
    expect(usePlacementNoticeStore.getState().notice?.text).toMatch(/^Won't fit · would overlap/u);
  });

  it("asks, behind truthfulGhost alone, for a round's seats where its ghost stood on free floor", () => {
    setPlannerFeaturesForTesting({ truthfulGhost: true, setupCards: false, seatsOnTheCard: false });
    if (round === undefined) throw new Error("No round table in the catalogue");
    inHandAt(round.id, 3, 2);
    const ghost = usePlacementStore.getState().ghostPosition;
    placePieceInHand(vi.fn());
    expect(usePlacementStore.getState().placedItems).toHaveLength(0);
    const pending = useChairDialogStore.getState().pending;
    expect(pending?.catalogueItemId).toBe(round.id);
    expect(pending?.x).toBe(ghost?.[0]);
    expect(pending?.z).toBe(ghost?.[2]);
  });

  it("sets an ordinary piece down where its ghost stands and keeps it in hand", () => {
    if (chair === undefined) throw new Error("No banquet chair in the catalogue");
    inHandAt(chair.id, 1.2, -0.6);
    const ghost = usePlacementStore.getState().ghostPosition;
    const invalidate = vi.fn();
    placePieceInHand(invalidate);
    const placed = usePlacementStore.getState().placedItems;
    expect(placed).toHaveLength(1);
    expect(placed[0]?.x).toBeCloseTo(ghost?.[0] ?? Number.NaN, 6);
    expect(placed[0]?.z).toBeCloseTo(ghost?.[2] ?? Number.NaN, 6);
    expect(invalidate).toHaveBeenCalled();
    expect(useCatalogueStore.getState().selectedItemId).toBe(chair.id);
  });

  it("dresses the table under the ghost with a cloth in hand, rather than setting the cloth down as a piece", () => {
    const cloth = getCatalogueItemBySlug("white-table-cloth");
    if (round === undefined || cloth === undefined) throw new Error("Missing the round or the white cloth");
    usePlacementStore.getState().placeItem(round.id, 0, 0);
    inHandAt(cloth.id, 0.1, 0.1);
    placePieceInHand(vi.fn());
    const placed = usePlacementStore.getState().placedItems;
    expect(placed).toHaveLength(1);
    expect(placed[0]?.clothed).toBe(true);
  });

  it("does nothing with nothing in hand or no ghost", () => {
    placePieceInHand(vi.fn());
    if (chair === undefined) throw new Error("No banquet chair in the catalogue");
    useCatalogueStore.getState().selectItem(chair.id);
    placePieceInHand(vi.fn());
    expect(usePlacementStore.getState().placedItems).toHaveLength(0);
  });
});
