import { beforeEach, describe, expect, it } from "vitest";
import { useCameraReferenceStore } from "../camera-reference-store.js";

const initialState = useCameraReferenceStore.getState();

beforeEach(() => {
  useCameraReferenceStore.setState(initialState, true);
});

describe("camera reference store", () => {
  it("starts without a draft", () => {
    expect(useCameraReferenceStore.getState().draft).toBeNull();
  });

  it("opens and closes a camera reference draft", () => {
    useCameraReferenceStore.getState().openDraft({
      screenX: 120,
      screenY: 160,
      source: "floor",
      sourceLabel: "Floor grid",
      point: [1, 2],
      baseY: 0,
      yaw: null,
      suggestedName: "Floor POV",
    });

    expect(useCameraReferenceStore.getState().draft?.sourceLabel).toBe("Floor grid");
    useCameraReferenceStore.getState().closeDraft();
    expect(useCameraReferenceStore.getState().draft).toBeNull();
  });
});
