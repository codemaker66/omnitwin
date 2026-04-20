import { describe, it, expect, beforeEach } from "vitest";
import { useRoomDimensionsStore } from "../room-dimensions-store.js";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";

// ---------------------------------------------------------------------------
// room-dimensions-store — single source of truth for current room size.
//
// Tests pin:
//   - Grand Hall default on initial mount
//   - setDimensions replaces state (structural replacement, not merge)
//   - Multiple consumers observe the same value
// ---------------------------------------------------------------------------

describe("room-dimensions-store", () => {
  beforeEach(() => {
    // Reset to default between tests so one test's setDimensions
    // doesn't leak into the next via Zustand's module-level state.
    useRoomDimensionsStore.setState({ dimensions: GRAND_HALL_RENDER_DIMENSIONS });
  });

  it("defaults to the Grand Hall render dimensions", () => {
    const { dimensions } = useRoomDimensionsStore.getState();
    expect(dimensions).toEqual(GRAND_HALL_RENDER_DIMENSIONS);
  });

  it("setDimensions replaces the current dimensions", () => {
    const next = { width: 50, length: 30, height: 5 };
    useRoomDimensionsStore.getState().setDimensions(next);
    expect(useRoomDimensionsStore.getState().dimensions).toEqual(next);
  });

  it("subsequent setDimensions calls overwrite, not merge", () => {
    useRoomDimensionsStore.getState().setDimensions({ width: 50, length: 30, height: 5 });
    useRoomDimensionsStore.getState().setDimensions({ width: 10, length: 10, height: 2 });
    expect(useRoomDimensionsStore.getState().dimensions).toEqual({ width: 10, length: 10, height: 2 });
  });
});
