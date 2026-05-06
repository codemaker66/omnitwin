import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CameraReferenceComposer,
  clampCameraReferenceDialogPosition,
  getInitialCameraReferenceDialogPosition,
} from "../CameraReferenceComposer.js";
import { useBookmarkStore } from "../../stores/bookmark-store.js";
import { useCameraReferenceStore, type CameraReferenceDraft } from "../../stores/camera-reference-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";

const BASE_DRAFT: CameraReferenceDraft = {
  screenX: 200,
  screenY: 150,
  source: "furniture",
  sourceLabel: "Banquet Chair",
  placedItemId: "chair-1",
  furnitureCategory: "chair",
  point: [1.2, -0.4],
  baseY: 0.45,
  yaw: 0.25,
  suggestedName: "Banquet Chair",
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
  usePlacementStore.setState({
    placedItems: [{
      id: "chair-1",
      catalogueItemId: "banquet-chair",
      label: "",
      x: 1.2,
      y: 0.45,
      z: -0.4,
      rotationY: 0.25,
      clothed: false,
      groupId: null,
    }],
    undoStack: [],
    redoStack: [],
    ghostPosition: null,
    ghostValid: false,
    ghostInvalidReason: null,
    snapEnabled: true,
  });
}

function openComposer(draft: CameraReferenceDraft = BASE_DRAFT): HTMLElement {
  useCameraReferenceStore.getState().openDraft(draft);
  render(<CameraReferenceComposer />);
  return screen.getByRole("dialog", { name: draft.source === "furniture" ? "Label furniture" : "Add camera POV" });
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

    expect(panel.classList.contains("camera-reference-composer")).toBe(true);
    expect(panel.dataset.cameraKeyboardLock).toBe("true");
    expect(panel.style.userSelect).toBe("none");
    expect(dragHandle.style.userSelect).toBe("none");
    expect(eyebrow.style.userSelect).toBe("none");
    expect(title.style.userSelect).toBe("none");
    expect(source.style.userSelect).toBe("none");
    expect(nameInput.style.userSelect).toBe("text");
    expect(nameInput.getAttribute("draggable")).toBe("false");

    const mouseDown = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      clientX: 260,
      clientY: 190,
    });
    expect(dragHandle.dispatchEvent(mouseDown)).toBe(false);
    expect(mouseDown.defaultPrevented).toBe(true);
  });

  it("opens furniture right-clicks as labels by default, not camera bookmarks", () => {
    openComposer();

    expect(screen.getByTestId("camera-reference-eyebrow").textContent).toBe("Seat placement label");
    expect(screen.getByTestId("camera-reference-title").textContent).toBe("Name seat");
    const nameInput = screen.getByLabelText("Name");
    if (!(nameInput instanceof HTMLInputElement)) throw new Error("Expected name field to be an input");
    expect(nameInput.value).toBe("Banquet Chair");
    expect(screen.queryByText("Eye height")).toBeNull();
    expect(screen.getByRole("button", { name: "Add camera POV to this label" }).getAttribute("aria-pressed")).toBe("false");

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Bride" } });
    fireEvent.click(screen.getByRole("button", { name: "Save label" }));

    expect(usePlacementStore.getState().placedItems[0]?.label).toBe("Bride");
    expect(useBookmarkStore.getState().bookmarks).toHaveLength(0);
  });

  it("adds a camera bookmark only when the furniture camera toggle is enabled", () => {
    openComposer();

    fireEvent.click(screen.getByTestId("camera-reference-toggle"));
    expect(screen.getByText("Eye height")).toBeDefined();
    expect(screen.getByTestId("camera-reference-toggle").getAttribute("aria-pressed")).toBe("true");

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Bride" } });
    fireEvent.click(screen.getByRole("button", { name: "Save label + view" }));

    const bookmark = useBookmarkStore.getState().bookmarks[0];
    expect(usePlacementStore.getState().placedItems[0]?.label).toBe("Bride");
    expect(bookmark?.name).toBe("Bride");
    expect(bookmark?.reference?.placedItemId).toBe("chair-1");
    expect(useBookmarkStore.getState().pendingNavigationId).toBe(bookmark?.id);
  });

  it("keeps floor right-clicks as camera POV creation", () => {
    openComposer({
      screenX: 160,
      screenY: 120,
      source: "floor",
      sourceLabel: "Floor grid",
      point: [0, 0],
      baseY: 0,
      yaw: null,
      suggestedName: "Floor POV",
    });

    expect(screen.getByRole("dialog", { name: "Add camera POV" })).toBeDefined();
    expect(screen.getByTestId("camera-reference-title").textContent).toBe("Add POV");
    expect(screen.getByText("Eye height")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Add + view" }));
    expect(useBookmarkStore.getState().bookmarks[0]?.reference?.source).toBe("floor");
  });

  it("blocks native browser text drag and drop inside the dialog inputs", () => {
    openComposer();
    const nameInput = screen.getByLabelText("Name");

    const dragStart = new Event("dragstart", { bubbles: true, cancelable: true });
    expect(nameInput.dispatchEvent(dragStart)).toBe(false);
    expect(dragStart.defaultPrevented).toBe(true);

    const drop = new Event("drop", { bubbles: true, cancelable: true });
    expect(nameInput.dispatchEvent(drop)).toBe(false);
    expect(drop.defaultPrevented).toBe(true);
  });

  it("scopes a muted gold text-selection style to the POV dialog", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(path.resolve("src/components/CameraReferenceComposer.css"), "utf-8");

    expect(source).toContain(".camera-reference-composer ::selection");
    expect(source).toContain(".camera-reference-composer input::selection");
    expect(source).toContain("rgba(191, 153, 55, 0.5)");
    expect(source).toContain("-webkit-user-drag: none");
    expect(source).toContain("caret-color: #d6b85d");
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
