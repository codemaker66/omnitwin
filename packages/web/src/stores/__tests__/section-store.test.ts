import { describe, it, expect, beforeEach } from "vitest";
import { useSectionStore, clampHeight } from "../section-store.js";
import { getFullRoomBounds, MIN_BOX_EXTENT } from "../../lib/section-box.js";

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
// Store behaviour — plane mode (legacy)
// ---------------------------------------------------------------------------

const fullBounds = getFullRoomBounds();

function resetStore(): void {
  useSectionStore.setState({
    mode: "plane",
    height: 7,
    maxHeight: 7,
    boxBounds: fullBounds,
    boxEnabled: false,
  });
}

describe("useSectionStore — plane mode", () => {
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

  it("default mode is plane", () => {
    expect(useSectionStore.getState().mode).toBe("plane");
    expect(useSectionStore.getState().boxEnabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Store behaviour — box mode
// ---------------------------------------------------------------------------

describe("useSectionStore — box mode", () => {
  beforeEach(resetStore);

  it("toggleBox switches to box mode", () => {
    useSectionStore.getState().toggleBox();
    expect(useSectionStore.getState().mode).toBe("box");
    expect(useSectionStore.getState().boxEnabled).toBe(true);
  });

  it("toggleBox twice returns to plane mode", () => {
    useSectionStore.getState().toggleBox();
    useSectionStore.getState().toggleBox();
    expect(useSectionStore.getState().mode).toBe("plane");
    expect(useSectionStore.getState().boxEnabled).toBe(false);
  });

  it("setMode sets mode directly", () => {
    useSectionStore.getState().setMode("box");
    expect(useSectionStore.getState().mode).toBe("box");
    expect(useSectionStore.getState().boxEnabled).toBe(true);
  });

  it("initial box bounds match full room", () => {
    const bounds = useSectionStore.getState().boxBounds;
    expect(bounds).toEqual(fullBounds);
  });

  it("setBoxFace updates a single face", () => {
    useSectionStore.getState().setBoxFace("minX", 0);
    expect(useSectionStore.getState().boxBounds.minX).toBe(0);
    // Other faces unchanged
    expect(useSectionStore.getState().boxBounds.maxX).toBe(fullBounds.maxX);
  });

  it("setBoxFace clamps to prevent inversion", () => {
    useSectionStore.getState().setBoxFace("minX", fullBounds.maxX + 100);
    expect(useSectionStore.getState().boxBounds.minX).toBe(fullBounds.maxX - MIN_BOX_EXTENT);
  });

  it("setBoxFace clamps to room boundary", () => {
    useSectionStore.getState().setBoxFace("minX", -9999);
    expect(useSectionStore.getState().boxBounds.minX).toBe(fullBounds.minX);
  });

  it("resetBox restores full room bounds", () => {
    useSectionStore.getState().setBoxFace("minX", 5);
    useSectionStore.getState().setBoxFace("maxY", 3);
    useSectionStore.getState().resetBox();
    expect(useSectionStore.getState().boxBounds).toEqual(fullBounds);
  });

  it("multiple face adjustments work independently", () => {
    useSectionStore.getState().setBoxFace("minX", 0);
    useSectionStore.getState().setBoxFace("maxZ", 5);
    useSectionStore.getState().setBoxFace("maxY", 4);

    const bounds = useSectionStore.getState().boxBounds;
    expect(bounds.minX).toBe(0);
    expect(bounds.maxZ).toBe(5);
    expect(bounds.maxY).toBe(4);
    // Unchanged faces
    expect(bounds.maxX).toBe(fullBounds.maxX);
    expect(bounds.minY).toBe(fullBounds.minY);
    expect(bounds.minZ).toBe(fullBounds.minZ);
  });
});
