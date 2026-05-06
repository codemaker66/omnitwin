import { describe, it, expect, beforeEach } from "vitest";
import { useBookmarkStore } from "../bookmark-store.js";
import type { CameraBookmark } from "../../lib/camera-animation.js";

// ---------------------------------------------------------------------------
// Reset store before each test
// ---------------------------------------------------------------------------

const initialState = useBookmarkStore.getState();

beforeEach(() => {
  useBookmarkStore.setState(initialState, true);
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe("BookmarkStore initial state", () => {
  it("starts with empty bookmarks", () => {
    expect(useBookmarkStore.getState().bookmarks).toEqual([]);
  });

  it("starts with no active transition", () => {
    expect(useBookmarkStore.getState().transition).toBeNull();
  });

  it("starts with nextId = 1", () => {
    expect(useBookmarkStore.getState().nextId).toBe(1);
  });

  it("starts with no pending navigation", () => {
    expect(useBookmarkStore.getState().pendingNavigationId).toBeNull();
  });

  it("starts with no active camera reference", () => {
    expect(useBookmarkStore.getState().activeReferenceId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// initialize
// ---------------------------------------------------------------------------

describe("initialize", () => {
  const grandHall = { width: 21, length: 10.5, height: 7 };

  it("populates default bookmarks for a room", () => {
    useBookmarkStore.getState().initialize(grandHall);
    const { bookmarks } = useBookmarkStore.getState();
    expect(bookmarks).toHaveLength(3);
  });

  it("default bookmarks have expected names", () => {
    useBookmarkStore.getState().initialize(grandHall);
    const names = useBookmarkStore.getState().bookmarks.map((b) => b.name);
    expect(names).toEqual(["Entrance View", "Overhead View", "Stage View"]);
  });

  it("re-initializing replaces all bookmarks", () => {
    useBookmarkStore.getState().initialize(grandHall);
    useBookmarkStore.getState().addBookmark("Custom", [0, 0, 0], [1, 1, 1]);
    expect(useBookmarkStore.getState().bookmarks).toHaveLength(4);

    // Re-initialize replaces everything
    useBookmarkStore.getState().initialize(grandHall);
    expect(useBookmarkStore.getState().bookmarks).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// addBookmark
// ---------------------------------------------------------------------------

describe("addBookmark", () => {
  it("appends a new bookmark", () => {
    useBookmarkStore.getState().addBookmark("Test View", [1, 2, 3], [0, 0, 0]);
    const { bookmarks } = useBookmarkStore.getState();
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0]?.name).toBe("Test View");
  });

  it("sets position and target correctly", () => {
    useBookmarkStore.getState().addBookmark("A", [10, 5, 3], [0, 1, 0]);
    const b = useBookmarkStore.getState().bookmarks[0];
    expect(b?.position).toEqual([10, 5, 3]);
    expect(b?.target).toEqual([0, 1, 0]);
  });

  it("generates unique IDs for each bookmark", () => {
    useBookmarkStore.getState().addBookmark("A", [0, 0, 0], [0, 0, 0]);
    useBookmarkStore.getState().addBookmark("B", [1, 1, 1], [1, 1, 1]);
    const { bookmarks } = useBookmarkStore.getState();
    expect(bookmarks[0]?.id).not.toBe(bookmarks[1]?.id);
  });

  it("increments nextId", () => {
    expect(useBookmarkStore.getState().nextId).toBe(1);
    useBookmarkStore.getState().addBookmark("A", [0, 0, 0], [0, 0, 0]);
    expect(useBookmarkStore.getState().nextId).toBe(2);
    useBookmarkStore.getState().addBookmark("B", [0, 0, 0], [0, 0, 0]);
    expect(useBookmarkStore.getState().nextId).toBe(3);
  });

  it("preserves existing bookmarks when adding", () => {
    useBookmarkStore.getState().initialize({ width: 21, length: 10.5, height: 7 });
    useBookmarkStore.getState().addBookmark("Custom", [0, 0, 0], [0, 0, 0]);
    expect(useBookmarkStore.getState().bookmarks).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// addReferenceBookmark
// ---------------------------------------------------------------------------

describe("addReferenceBookmark", () => {
  it("adds a named camera reference and returns its ID", () => {
    const id = useBookmarkStore.getState().addReferenceBookmark({
      name: "Bride chair",
      source: "furniture",
      sourceLabel: "Banquet Chair",
      placedItemId: "chair-1",
      point: [2, -3],
      baseY: 0,
      yaw: Math.PI,
      heightMode: "sitting",
    });

    const bookmark = useBookmarkStore.getState().bookmarks.find((b) => b.id === id);
    expect(bookmark?.kind).toBe("reference");
    expect(bookmark?.name).toBe("Bride chair");
    expect(bookmark?.reference?.heightMode).toBe("sitting");
    expect(bookmark?.reference?.placedItemId).toBe("chair-1");
  });

  it("updates a viewed reference height and queues a fresh camera navigation", () => {
    const id = useBookmarkStore.getState().addReferenceBookmark({
      name: "Bride chair",
      source: "furniture",
      sourceLabel: "Banquet Chair",
      point: [2, -3],
      baseY: 0,
      yaw: Math.PI,
      heightMode: "sitting",
    });
    const bookmark = useBookmarkStore.getState().bookmarks.find((b) => b.id === id);
    expect(bookmark).toBeDefined();
    if (bookmark === undefined) return;

    useBookmarkStore.getState().startTransition(bookmark, [0, 0, 0], [0, 0, 0]);
    useBookmarkStore.getState().updateReferenceHeight(id, "standing");
    const updated = useBookmarkStore.getState().bookmarks.find((b) => b.id === id);

    expect(updated?.reference?.heightMode).toBe("standing");
    expect(useBookmarkStore.getState().pendingNavigationId).toBe(id);
  });
});

// ---------------------------------------------------------------------------
// removeBookmark
// ---------------------------------------------------------------------------

describe("removeBookmark", () => {
  it("removes a bookmark by ID", () => {
    useBookmarkStore.getState().addBookmark("A", [0, 0, 0], [0, 0, 0]);
    const id = useBookmarkStore.getState().bookmarks[0]?.id ?? "";
    useBookmarkStore.getState().removeBookmark(id);
    expect(useBookmarkStore.getState().bookmarks).toHaveLength(0);
  });

  it("only removes the matching bookmark", () => {
    useBookmarkStore.getState().addBookmark("A", [0, 0, 0], [0, 0, 0]);
    useBookmarkStore.getState().addBookmark("B", [1, 1, 1], [1, 1, 1]);
    const idA = useBookmarkStore.getState().bookmarks[0]?.id ?? "";
    useBookmarkStore.getState().removeBookmark(idA);
    const remaining = useBookmarkStore.getState().bookmarks;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.name).toBe("B");
  });

  it("no-ops for non-existent ID", () => {
    useBookmarkStore.getState().addBookmark("A", [0, 0, 0], [0, 0, 0]);
    useBookmarkStore.getState().removeBookmark("non-existent");
    expect(useBookmarkStore.getState().bookmarks).toHaveLength(1);
  });

  it("can remove default bookmarks", () => {
    useBookmarkStore.getState().initialize({ width: 21, length: 10.5, height: 7 });
    useBookmarkStore.getState().removeBookmark("default-entrance");
    const names = useBookmarkStore.getState().bookmarks.map((b) => b.name);
    expect(names).not.toContain("Entrance View");
    expect(useBookmarkStore.getState().bookmarks).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// requestNavigation
// ---------------------------------------------------------------------------

describe("requestNavigation", () => {
  it("sets pendingNavigationId", () => {
    useBookmarkStore.getState().requestNavigation("default-entrance");
    expect(useBookmarkStore.getState().pendingNavigationId).toBe("default-entrance");
  });

  it("overwrites previous pending navigation", () => {
    useBookmarkStore.getState().requestNavigation("a");
    useBookmarkStore.getState().requestNavigation("b");
    expect(useBookmarkStore.getState().pendingNavigationId).toBe("b");
  });

  it("can be cleared by setting null directly", () => {
    useBookmarkStore.getState().requestNavigation("a");
    useBookmarkStore.setState({ pendingNavigationId: null });
    expect(useBookmarkStore.getState().pendingNavigationId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// startTransition
// ---------------------------------------------------------------------------

describe("startTransition", () => {
  const bookmark: CameraBookmark = {
    id: "test",
    name: "Test",
    position: [10, 5, 0],
    target: [0, 0, 0],
  };

  it("creates a transition with from/to coordinates", () => {
    const currentPos: readonly [number, number, number] = [0, 1.7, 5];
    const currentTarget: readonly [number, number, number] = [0, 1.5, 0];
    useBookmarkStore.getState().startTransition(bookmark, currentPos, currentTarget);
    const { transition } = useBookmarkStore.getState();
    expect(transition).not.toBeNull();
    expect(transition?.fromPosition).toEqual(currentPos);
    expect(transition?.fromTarget).toEqual(currentTarget);
    expect(transition?.toPosition).toEqual(bookmark.position);
    expect(transition?.toTarget).toEqual(bookmark.target);
  });

  it("sets elapsed to 0", () => {
    useBookmarkStore.getState().startTransition(bookmark, [0, 0, 0], [0, 0, 0]);
    expect(useBookmarkStore.getState().transition?.elapsed).toBe(0);
  });

  it("computes a positive duration", () => {
    useBookmarkStore.getState().startTransition(bookmark, [0, 0, 0], [0, 0, 0]);
    const duration = useBookmarkStore.getState().transition?.duration ?? 0;
    expect(duration).toBeGreaterThan(0);
  });

  it("replaces any existing transition", () => {
    const bk2: CameraBookmark = { id: "b2", name: "B2", position: [20, 10, 0], target: [0, 0, 0] };
    useBookmarkStore.getState().startTransition(bookmark, [0, 0, 0], [0, 0, 0]);
    useBookmarkStore.getState().startTransition(bk2, [0, 0, 0], [0, 0, 0]);
    expect(useBookmarkStore.getState().transition?.toPosition).toEqual(bk2.position);
  });
});

// ---------------------------------------------------------------------------
// updateTransition
// ---------------------------------------------------------------------------

describe("updateTransition", () => {
  const bookmark: CameraBookmark = {
    id: "test",
    name: "Test",
    position: [10, 5, 0],
    target: [0, 0, 0],
  };

  it("returns false when no transition is active", () => {
    const result = useBookmarkStore.getState().updateTransition(0.016);
    expect(result).toBe(false);
  });

  it("returns true when transition is still in progress", () => {
    useBookmarkStore.getState().startTransition(bookmark, [0, 0, 0], [0, 0, 0]);
    const result = useBookmarkStore.getState().updateTransition(0.016);
    expect(result).toBe(true);
  });

  it("advances elapsed time", () => {
    useBookmarkStore.getState().startTransition(bookmark, [0, 0, 0], [0, 0, 0]);
    useBookmarkStore.getState().updateTransition(0.1);
    const elapsed = useBookmarkStore.getState().transition?.elapsed ?? 0;
    expect(elapsed).toBeCloseTo(0.1);
  });

  it("returns false and clears transition when duration is exceeded", () => {
    useBookmarkStore.getState().startTransition(bookmark, [0, 0, 0], [0, 0, 0]);
    const duration = useBookmarkStore.getState().transition?.duration ?? 0;
    const result = useBookmarkStore.getState().updateTransition(duration + 1);
    expect(result).toBe(false);
    expect(useBookmarkStore.getState().transition).toBeNull();
  });

  it("accumulates elapsed across multiple updates", () => {
    useBookmarkStore.getState().startTransition(bookmark, [0, 0, 0], [0, 0, 0]);
    useBookmarkStore.getState().updateTransition(0.05);
    useBookmarkStore.getState().updateTransition(0.05);
    const elapsed = useBookmarkStore.getState().transition?.elapsed ?? 0;
    expect(elapsed).toBeCloseTo(0.1);
  });
});

// ---------------------------------------------------------------------------
// clearTransition
// ---------------------------------------------------------------------------

describe("clearTransition", () => {
  it("sets transition to null", () => {
    const bookmark: CameraBookmark = { id: "t", name: "T", position: [5, 0, 0], target: [0, 0, 0] };
    useBookmarkStore.getState().startTransition(bookmark, [0, 0, 0], [0, 0, 0]);
    expect(useBookmarkStore.getState().transition).not.toBeNull();
    useBookmarkStore.getState().clearTransition();
    expect(useBookmarkStore.getState().transition).toBeNull();
  });

  it("no-ops when already null", () => {
    useBookmarkStore.getState().clearTransition();
    expect(useBookmarkStore.getState().transition).toBeNull();
  });
});
