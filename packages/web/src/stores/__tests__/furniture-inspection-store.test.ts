import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFurnitureInspectionStore } from "../furniture-inspection-store.js";

const CHAIR_ID = "placed-chair-1";
const TABLE_ID = "placed-table-1";
const SEAT_PART_ID = "seat";

beforeEach(() => {
  useFurnitureInspectionStore.getState().closeInspection();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("furniture inspection store", () => {
  it("starts closed with no presentation state", () => {
    const state = useFurnitureInspectionStore.getState();

    expect(state.inspectedPlacedItemId).toBeNull();
    expect(state.selectedGeneratedPartId).toBeNull();
    expect(state.explodeProgress).toBe(0);
  });

  it("opens an inspection for a placed furniture item", () => {
    useFurnitureInspectionStore.getState().openInspection(CHAIR_ID);

    const state = useFurnitureInspectionStore.getState();
    expect(state.inspectedPlacedItemId).toBe(CHAIR_ID);
    expect(state.selectedGeneratedPartId).toBeNull();
    expect(state.explodeProgress).toBe(0);
  });

  it("starts a clean inspection when switching to another placed item", () => {
    const state = useFurnitureInspectionStore.getState();
    state.openInspection(CHAIR_ID);
    state.selectGeneratedPart(SEAT_PART_ID);
    state.setExplodeProgress(0.65);

    state.openInspection(TABLE_ID);

    const switched = useFurnitureInspectionStore.getState();
    expect(switched.inspectedPlacedItemId).toBe(TABLE_ID);
    expect(switched.selectedGeneratedPartId).toBeNull();
    expect(switched.explodeProgress).toBe(0);
  });

  it("closes the inspection and clears all presentation state", () => {
    const state = useFurnitureInspectionStore.getState();
    state.openInspection(CHAIR_ID);
    state.selectGeneratedPart(SEAT_PART_ID);
    state.setExplodeProgress(1);

    state.closeInspection();

    const closed = useFurnitureInspectionStore.getState();
    expect(closed.inspectedPlacedItemId).toBeNull();
    expect(closed.selectedGeneratedPartId).toBeNull();
    expect(closed.explodeProgress).toBe(0);
  });

  it("keeps close idempotent", () => {
    const state = useFurnitureInspectionStore.getState();

    state.closeInspection();
    state.closeInspection();

    expect(useFurnitureInspectionStore.getState()).toMatchObject({
      inspectedPlacedItemId: null,
      selectedGeneratedPartId: null,
      explodeProgress: 0,
    });
  });

  it("selects and clears a generated model part while inspection is open", () => {
    const state = useFurnitureInspectionStore.getState();
    state.openInspection(CHAIR_ID);

    state.selectGeneratedPart(SEAT_PART_ID);
    expect(useFurnitureInspectionStore.getState().selectedGeneratedPartId).toBe(SEAT_PART_ID);

    state.selectGeneratedPart(null);
    expect(useFurnitureInspectionStore.getState().selectedGeneratedPartId).toBeNull();
  });

  it("ignores generated-part selection while inspection is closed", () => {
    useFurnitureInspectionStore.getState().selectGeneratedPart(SEAT_PART_ID);

    expect(useFurnitureInspectionStore.getState().selectedGeneratedPartId).toBeNull();
  });

  it("sets fractional explode progress while inspection is open", () => {
    const state = useFurnitureInspectionStore.getState();
    state.openInspection(CHAIR_ID);

    state.setExplodeProgress(0.375);

    expect(useFurnitureInspectionStore.getState().explodeProgress).toBe(0.375);
  });

  it.each([
    { input: -0.25, expected: 0 },
    { input: 1.25, expected: 1 },
  ])("clamps finite explode progress $input to $expected", ({ input, expected }) => {
    const state = useFurnitureInspectionStore.getState();
    state.openInspection(CHAIR_ID);

    state.setExplodeProgress(input);

    expect(useFurnitureInspectionStore.getState().explodeProgress).toBe(expected);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "collapses safely for non-finite explode progress %s",
    (input) => {
      const state = useFurnitureInspectionStore.getState();
      state.openInspection(CHAIR_ID);
      state.setExplodeProgress(0.5);

      state.setExplodeProgress(input);

      expect(useFurnitureInspectionStore.getState().explodeProgress).toBe(0);
    },
  );

  it("ignores explode progress while inspection is closed", () => {
    useFurnitureInspectionStore.getState().setExplodeProgress(0.75);

    expect(useFurnitureInspectionStore.getState().explodeProgress).toBe(0);
  });

  it("toggles a collapsed model to fully exploded", () => {
    const state = useFurnitureInspectionStore.getState();
    state.openInspection(CHAIR_ID);

    state.toggleExploded();

    expect(useFurnitureInspectionStore.getState().explodeProgress).toBe(1);
  });

  it("toggles a fully exploded model back to collapsed", () => {
    const state = useFurnitureInspectionStore.getState();
    state.openInspection(CHAIR_ID);
    state.setExplodeProgress(1);

    state.toggleExploded();

    expect(useFurnitureInspectionStore.getState().explodeProgress).toBe(0);
  });

  it("collapses a partially exploded model when toggled", () => {
    const state = useFurnitureInspectionStore.getState();
    state.openInspection(CHAIR_ID);
    state.setExplodeProgress(0.4);

    state.toggleExploded();

    expect(useFurnitureInspectionStore.getState().explodeProgress).toBe(0);
  });

  it("ignores explode toggles while inspection is closed", () => {
    useFurnitureInspectionStore.getState().toggleExploded();

    expect(useFurnitureInspectionStore.getState().explodeProgress).toBe(0);
  });

  it("does not write presentation state to browser persistence", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const state = useFurnitureInspectionStore.getState();

    state.openInspection(CHAIR_ID);
    state.selectGeneratedPart(SEAT_PART_ID);
    state.setExplodeProgress(0.5);
    state.toggleExploded();
    state.closeInspection();

    expect(setItem).not.toHaveBeenCalled();
  });
});
