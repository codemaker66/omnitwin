import { describe, it, expect, beforeEach } from "vitest";
import { useSelectionStore } from "../selection-store.js";

function resetStore(): void {
  useSelectionStore.setState({
    selectedIds: new Set<string>(),
    marqueeActive: false,
    marqueeStart: null,
    marqueeEnd: null,
    marqueeWorldStart: null,
    marqueeWorldEnd: null,
  });
}

beforeEach(resetStore);

// ---------------------------------------------------------------------------
// Single selection
// ---------------------------------------------------------------------------

describe("select", () => {
  it("selects a single item", () => {
    useSelectionStore.getState().select("item-1");
    expect(useSelectionStore.getState().selectedIds.has("item-1")).toBe(true);
    expect(useSelectionStore.getState().selectedIds.size).toBe(1);
  });

  it("replaces previous selection", () => {
    useSelectionStore.getState().select("item-1");
    useSelectionStore.getState().select("item-2");
    expect(useSelectionStore.getState().selectedIds.has("item-1")).toBe(false);
    expect(useSelectionStore.getState().selectedIds.has("item-2")).toBe(true);
    expect(useSelectionStore.getState().selectedIds.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Toggle select (Shift+click)
// ---------------------------------------------------------------------------

describe("toggleSelect", () => {
  it("adds an item when not selected", () => {
    useSelectionStore.getState().toggleSelect("item-1");
    expect(useSelectionStore.getState().selectedIds.has("item-1")).toBe(true);
  });

  it("removes an item when already selected", () => {
    useSelectionStore.getState().select("item-1");
    useSelectionStore.getState().toggleSelect("item-1");
    expect(useSelectionStore.getState().selectedIds.has("item-1")).toBe(false);
  });

  it("builds up multi-selection", () => {
    useSelectionStore.getState().toggleSelect("item-1");
    useSelectionStore.getState().toggleSelect("item-2");
    useSelectionStore.getState().toggleSelect("item-3");
    expect(useSelectionStore.getState().selectedIds.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Select multiple (marquee)
// ---------------------------------------------------------------------------

describe("selectMultiple", () => {
  it("selects multiple items at once", () => {
    useSelectionStore.getState().selectMultiple(["a", "b", "c"]);
    const ids = useSelectionStore.getState().selectedIds;
    expect(ids.size).toBe(3);
    expect(ids.has("a")).toBe(true);
    expect(ids.has("b")).toBe(true);
    expect(ids.has("c")).toBe(true);
  });

  it("replaces previous selection", () => {
    useSelectionStore.getState().select("old");
    useSelectionStore.getState().selectMultiple(["new-1", "new-2"]);
    expect(useSelectionStore.getState().selectedIds.has("old")).toBe(false);
    expect(useSelectionStore.getState().selectedIds.size).toBe(2);
  });

  it("empty array clears selection", () => {
    useSelectionStore.getState().select("item-1");
    useSelectionStore.getState().selectMultiple([]);
    expect(useSelectionStore.getState().selectedIds.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Clear selection
// ---------------------------------------------------------------------------

describe("clearSelection", () => {
  it("removes all selections", () => {
    useSelectionStore.getState().selectMultiple(["a", "b", "c"]);
    useSelectionStore.getState().clearSelection();
    expect(useSelectionStore.getState().selectedIds.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isSelected
// ---------------------------------------------------------------------------

describe("isSelected", () => {
  it("returns true for selected item", () => {
    useSelectionStore.getState().select("item-1");
    expect(useSelectionStore.getState().isSelected("item-1")).toBe(true);
  });

  it("returns false for unselected item", () => {
    expect(useSelectionStore.getState().isSelected("item-1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Marquee
// ---------------------------------------------------------------------------

describe("marquee", () => {
  it("starts inactive", () => {
    expect(useSelectionStore.getState().marqueeActive).toBe(false);
    expect(useSelectionStore.getState().marqueeStart).toBeNull();
    expect(useSelectionStore.getState().marqueeEnd).toBeNull();
  });

  it("startMarquee activates and sets screen + world points", () => {
    useSelectionStore.getState().startMarquee(10, 20, 1.5, 3.0);
    expect(useSelectionStore.getState().marqueeActive).toBe(true);
    expect(useSelectionStore.getState().marqueeStart).toEqual({ x: 10, y: 20 });
    expect(useSelectionStore.getState().marqueeEnd).toEqual({ x: 10, y: 20 });
    expect(useSelectionStore.getState().marqueeWorldStart).toEqual({ x: 1.5, z: 3.0 });
    expect(useSelectionStore.getState().marqueeWorldEnd).toEqual({ x: 1.5, z: 3.0 });
  });

  it("updateMarquee updates screen + world end points", () => {
    useSelectionStore.getState().startMarquee(10, 20, 1.5, 3.0);
    useSelectionStore.getState().updateMarquee(100, 80, 5.0, 8.0);
    expect(useSelectionStore.getState().marqueeEnd).toEqual({ x: 100, y: 80 });
    expect(useSelectionStore.getState().marqueeWorldEnd).toEqual({ x: 5.0, z: 8.0 });
  });

  it("endMarquee deactivates and clears all points", () => {
    useSelectionStore.getState().startMarquee(10, 20, 1.5, 3.0);
    useSelectionStore.getState().updateMarquee(100, 80, 5.0, 8.0);
    useSelectionStore.getState().endMarquee();
    expect(useSelectionStore.getState().marqueeActive).toBe(false);
    expect(useSelectionStore.getState().marqueeStart).toBeNull();
    expect(useSelectionStore.getState().marqueeEnd).toBeNull();
    expect(useSelectionStore.getState().marqueeWorldStart).toBeNull();
    expect(useSelectionStore.getState().marqueeWorldEnd).toBeNull();
  });
});
