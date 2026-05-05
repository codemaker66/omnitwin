import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CameraReferenceComposer,
  clampCameraReferenceDialogPosition,
  getInitialCameraReferenceDialogPosition,
} from "../CameraReferenceComposer.js";
import { useBookmarkStore } from "../../stores/bookmark-store.js";
import { useCameraReferenceStore, type CameraReferenceDraft } from "../../stores/camera-reference-store.js";

const BASE_DRAFT: CameraReferenceDraft = {
  screenX: 200,
  screenY: 150,
  source: "furniture",
  sourceLabel: "Banquet Chair",
  point: [1.2, -0.4],
  baseY: 0.45,
  yaw: 0.25,
  suggestedName: "Banquet Chair POV",
};

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
}

function resetStores(): void {
  useCameraReferenceStore.setState({ draft: null });
  useBookmarkStore.setState({
    bookmarks: [],
    transition: null,
    nextId: 1,
    pendingNavigationId: null,
    activeReferenceId: null,
  });
}

function openComposer(draft: CameraReferenceDraft = BASE_DRAFT): HTMLElement {
  useCameraReferenceStore.getState().openDraft(draft);
  render(<CameraReferenceComposer />);
  return screen.getByRole("dialog", { name: "Add camera POV" });
}

describe("CameraReferenceComposer dialog placement", () => {
  beforeEach(() => {
    setViewport(1024, 768);
    resetStores();
  });

  afterEach(() => {
    cleanup();
    resetStores();
  });

  it("places a new dialog near the right-click point and clamps inside the viewport", () => {
    expect(getInitialCameraReferenceDialogPosition(200, 150, { width: 1024, height: 768 })).toEqual({
      left: 212,
      top: 162,
    });
    expect(getInitialCameraReferenceDialogPosition(990, 740, { width: 1024, height: 768 })).toEqual({
      left: 668,
      top: 428,
    });
  });

  it("clamps a dragged dialog to the visible viewport", () => {
    expect(clampCameraReferenceDialogPosition(
      { left: -400, top: 900 },
      { width: 1024, height: 768 },
      { width: 340, height: 324 },
    )).toEqual({
      left: 16,
      top: 428,
    });
  });

  it("renders non-editable dialog chrome as non-selectable while keeping inputs editable", () => {
    const panel = openComposer();
    const dragHandle = screen.getByTestId("camera-reference-drag-handle");
    const eyebrow = screen.getByTestId("camera-reference-eyebrow");
    const title = screen.getByTestId("camera-reference-title");
    const source = screen.getByTestId("camera-reference-source");
    const nameInput = screen.getByLabelText("Name");

    expect(panel.dataset.cameraKeyboardLock).toBe("true");
    expect(panel.style.userSelect).toBe("none");
    expect(dragHandle.style.userSelect).toBe("none");
    expect(eyebrow.style.userSelect).toBe("none");
    expect(title.style.userSelect).toBe("none");
    expect(source.style.userSelect).toBe("none");
    expect(nameInput.style.userSelect).toBe("text");

    const mouseDown = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      clientX: 260,
      clientY: 190,
    });
    expect(dragHandle.dispatchEvent(mouseDown)).toBe(false);
    expect(mouseDown.defaultPrevented).toBe(true);
  });

  it("moves by dragging the header without selecting dialog text", () => {
    const panel = openComposer();
    const dragHandle = screen.getByTestId("camera-reference-drag-handle");

    Object.defineProperty(panel, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(212, 162, 340, 324),
    });

    fireEvent.pointerDown(dragHandle, {
      button: 0,
      pointerId: 7,
      clientX: 260,
      clientY: 190,
    });
    fireEvent.pointerMove(dragHandle, {
      pointerId: 7,
      clientX: 520,
      clientY: 430,
    });

    expect(panel.style.left).toBe("472px");
    expect(panel.style.top).toBe("402px");
    expect(window.getSelection()?.toString()).toBe("");

    fireEvent.pointerMove(dragHandle, {
      pointerId: 7,
      clientX: 2000,
      clientY: 2000,
    });

    expect(panel.style.left).toBe("668px");
    expect(panel.style.top).toBe("428px");

    fireEvent.pointerUp(dragHandle, {
      pointerId: 7,
      clientX: 2000,
      clientY: 2000,
    });
  });
});
