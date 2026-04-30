import { describe, it, expect, beforeEach } from "vitest";
import { useBookmarkStore } from "../../stores/bookmark-store.js";

// ---------------------------------------------------------------------------
// These tests verify the BookmarkPanel's integration with the store.
// The component itself is an HTML overlay — we test the store interactions
// that the component triggers, since WebGL mocking isn't needed.
// ---------------------------------------------------------------------------

const initialState = useBookmarkStore.getState();

beforeEach(() => {
  useBookmarkStore.setState(initialState, true);
});

describe("BookmarkPanel store integration", () => {
  const grandHall = { width: 21, length: 10.5, height: 7 };

  it("after initialize, store has 3 default bookmarks", () => {
    useBookmarkStore.getState().initialize(grandHall);
    expect(useBookmarkStore.getState().bookmarks).toHaveLength(3);
  });

  it("requestNavigation sets pendingNavigationId for CameraRig pickup", () => {
    useBookmarkStore.getState().initialize(grandHall);
    useBookmarkStore.getState().requestNavigation("default-overhead");
    expect(useBookmarkStore.getState().pendingNavigationId).toBe("default-overhead");
  });

  it("number key logic — bookmark at index 0 maps to Digit1", () => {
    useBookmarkStore.getState().initialize(grandHall);
    // Simulate what BookmarkPanel's keydown handler does
    const bookmark = useBookmarkStore.getState().bookmarks[0];
    expect(bookmark).toBeDefined();
    if (bookmark !== undefined) {
      useBookmarkStore.getState().requestNavigation(bookmark.id);
    }
    expect(useBookmarkStore.getState().pendingNavigationId).toBe("default-entrance");
  });

  it("number key logic — bookmark at index 2 maps to Digit3", () => {
    useBookmarkStore.getState().initialize(grandHall);
    const bookmark = useBookmarkStore.getState().bookmarks[2];
    expect(bookmark).toBeDefined();
    if (bookmark !== undefined) {
      useBookmarkStore.getState().requestNavigation(bookmark.id);
    }
    expect(useBookmarkStore.getState().pendingNavigationId).toBe("default-stage");
  });

  it("requesting navigation for non-existent bookmark still sets the ID", () => {
    // CameraRig handles the case where the bookmark isn't found
    useBookmarkStore.getState().requestNavigation("non-existent");
    expect(useBookmarkStore.getState().pendingNavigationId).toBe("non-existent");
  });

  it("full flow: request → startTransition → updateTransition → complete", () => {
    useBookmarkStore.getState().initialize(grandHall);

    // Step 1: UI requests navigation
    useBookmarkStore.getState().requestNavigation("default-overhead");

    // Step 2: CameraRig finds the bookmark and starts transition
    const bookmark = useBookmarkStore.getState().bookmarks.find(
      (b) => b.id === "default-overhead",
    );
    expect(bookmark).toBeDefined();
    if (bookmark !== undefined) {
      useBookmarkStore.getState().startTransition(bookmark, [7.98, 1.7, 0.8], [0, 1.5, 0]);
    }
    useBookmarkStore.setState({ pendingNavigationId: null });
    expect(useBookmarkStore.getState().transition).not.toBeNull();

    // Step 3: Animation ticks
    const duration = useBookmarkStore.getState().transition?.duration ?? 0;
    expect(duration).toBeGreaterThan(0);
    useBookmarkStore.getState().updateTransition(duration + 1);

    // Step 4: Transition completes
    expect(useBookmarkStore.getState().transition).toBeNull();
  });

  it("requesting a new bookmark mid-transition replaces the transition", () => {
    useBookmarkStore.getState().initialize(grandHall);

    // Start first transition
    const entrance = useBookmarkStore.getState().bookmarks.find((b) => b.id === "default-entrance");
    if (entrance !== undefined) {
      useBookmarkStore.getState().startTransition(entrance, [0, 0, 0], [0, 0, 0]);
    }
    expect(useBookmarkStore.getState().transition?.toPosition).toEqual(entrance?.position);

    // Mid-transition, request a different bookmark
    const stage = useBookmarkStore.getState().bookmarks.find((b) => b.id === "default-stage");
    if (stage !== undefined) {
      useBookmarkStore.getState().startTransition(stage, [0, 0, 0], [0, 0, 0]);
    }
    expect(useBookmarkStore.getState().transition?.toPosition).toEqual(stage?.position);
  });
});
