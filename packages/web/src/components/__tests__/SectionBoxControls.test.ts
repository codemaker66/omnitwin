import { describe, it, expect, beforeEach } from "vitest";
import { useSectionStore } from "../../stores/section-store.js";
import { getFullRoomBounds, MIN_BOX_EXTENT, faceLabel, BOX_FACES } from "../../lib/section-box.js";

// ---------------------------------------------------------------------------
// These tests verify SectionBoxControls' integration with the section store.
// The component itself is an HTML overlay — we test the store interactions
// and the pipeline of toggling/adjusting the section box.
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

beforeEach(resetStore);

describe("SectionBoxControls store integration", () => {
  it("B key toggle: starts in plane mode, toggle activates box", () => {
    expect(useSectionStore.getState().boxEnabled).toBe(false);
    useSectionStore.getState().toggleBox();
    expect(useSectionStore.getState().boxEnabled).toBe(true);
    expect(useSectionStore.getState().mode).toBe("box");
  });

  it("full flow: activate box → adjust face → verify clamped", () => {
    useSectionStore.getState().toggleBox();
    useSectionStore.getState().setBoxFace("minX", 5);
    expect(useSectionStore.getState().boxBounds.minX).toBe(5);

    // Try to push minX past maxX
    useSectionStore.getState().setBoxFace("minX", fullBounds.maxX + 50);
    expect(useSectionStore.getState().boxBounds.minX).toBe(fullBounds.maxX - MIN_BOX_EXTENT);
  });

  it("reset button restores full room bounds", () => {
    useSectionStore.getState().toggleBox();
    useSectionStore.getState().setBoxFace("minX", 5);
    useSectionStore.getState().setBoxFace("maxY", 3);
    useSectionStore.getState().setBoxFace("minZ", 2);
    useSectionStore.getState().resetBox();
    expect(useSectionStore.getState().boxBounds).toEqual(fullBounds);
  });

  it("toggling box off switches back to plane mode", () => {
    useSectionStore.getState().toggleBox();
    expect(useSectionStore.getState().mode).toBe("box");
    useSectionStore.getState().toggleBox();
    expect(useSectionStore.getState().mode).toBe("plane");
    expect(useSectionStore.getState().boxEnabled).toBe(false);
  });

  it("plane mode slider still works independently", () => {
    useSectionStore.getState().setHeight(3.5);
    expect(useSectionStore.getState().height).toBe(3.5);
    // Box bounds are unaffected
    expect(useSectionStore.getState().boxBounds).toEqual(fullBounds);
  });

  it("box bounds persist when toggling modes", () => {
    useSectionStore.getState().toggleBox();
    useSectionStore.getState().setBoxFace("minX", 5);
    useSectionStore.getState().toggleBox(); // back to plane
    useSectionStore.getState().toggleBox(); // back to box
    expect(useSectionStore.getState().boxBounds.minX).toBe(5);
  });
});

describe("faceLabel for UI rendering", () => {
  it("all 6 faces have labels", () => {
    for (const face of BOX_FACES) {
      expect(faceLabel(face)).toBeTruthy();
    }
  });
});
