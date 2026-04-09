import { describe, it, expect, beforeEach } from "vitest";
import { useSectionStore, clampHeight } from "../section-store.js";

// ---------------------------------------------------------------------------
// Pure helper — clampHeight
// ---------------------------------------------------------------------------

describe("clampHeight", () => {
  it("returns value when within range", () => {
    expect(clampHeight(3, 0, 7)).toBe(3);
  });

  it("clamps to min when value is below", () => {
    expect(clampHeight(-1, 0, 7)).toBe(0);
  });

  it("clamps to max when value is above", () => {
    expect(clampHeight(10, 0, 7)).toBe(7);
  });

  it("returns min when value equals min", () => {
    expect(clampHeight(0, 0, 7)).toBe(0);
  });

  it("returns max when value equals max", () => {
    expect(clampHeight(7, 0, 7)).toBe(7);
  });

  it("works with non-integer values", () => {
    expect(clampHeight(3.5, 0, 7)).toBe(3.5);
  });
});

// ---------------------------------------------------------------------------
// Store behaviour — ceiling clip plane
// ---------------------------------------------------------------------------

function resetStore(): void {
  useSectionStore.setState({
    height: 7,
    maxHeight: 7,
  });
}

describe("useSectionStore", () => {
  beforeEach(resetStore);

  it("defaults to maxHeight (full walls visible)", () => {
    const state = useSectionStore.getState();
    expect(state.height).toBe(7);
    expect(state.maxHeight).toBe(7);
  });

  it("setHeight updates height", () => {
    useSectionStore.getState().setHeight(3.5);
    expect(useSectionStore.getState().height).toBe(3.5);
  });

  it("setHeight clamps to 0", () => {
    useSectionStore.getState().setHeight(-5);
    expect(useSectionStore.getState().height).toBe(0);
  });

  it("setHeight clamps to maxHeight", () => {
    useSectionStore.getState().setHeight(100);
    expect(useSectionStore.getState().height).toBe(7);
  });

  it("setHeight(0) means floor only", () => {
    useSectionStore.getState().setHeight(0);
    expect(useSectionStore.getState().height).toBe(0);
  });

  it("setMaxHeight updates maxHeight", () => {
    useSectionStore.getState().setMaxHeight(10);
    expect(useSectionStore.getState().maxHeight).toBe(10);
  });

  it("setMaxHeight clamps existing height if needed", () => {
    useSectionStore.getState().setHeight(7);
    useSectionStore.getState().setMaxHeight(5);
    expect(useSectionStore.getState().height).toBe(5);
    expect(useSectionStore.getState().maxHeight).toBe(5);
  });

  it("setMaxHeight preserves height when still in range", () => {
    useSectionStore.getState().setHeight(3);
    useSectionStore.getState().setMaxHeight(10);
    expect(useSectionStore.getState().height).toBe(3);
  });
});
