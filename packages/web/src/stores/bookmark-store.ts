import { create } from "zustand";
import type { SpaceDimensions } from "@omnitwin/types";
import {
  computeDefaultBookmarks,
  computeTransitionDuration,
  generateBookmarkId,
  type CameraBookmark,
  type CameraTransition,
} from "../lib/camera-animation.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BookmarkState {
  /** All saved bookmarks (defaults + user-created). */
  readonly bookmarks: readonly CameraBookmark[];
  /** Active transition (null when idle). */
  readonly transition: CameraTransition | null;
  /** Counter for generating unique bookmark IDs. */
  readonly nextId: number;
  /** Bookmark ID pending navigation — set by UI, consumed by R3F component that has camera access. */
  readonly pendingNavigationId: string | null;
  /** Initialize bookmarks with defaults for a room. */
  readonly initialize: (dimensions: SpaceDimensions) => void;
  /** Add a user bookmark from the current camera state. */
  readonly addBookmark: (
    name: string,
    position: readonly [number, number, number],
    target: readonly [number, number, number],
  ) => void;
  /** Remove a bookmark by ID. */
  readonly removeBookmark: (id: string) => void;
  /** Request navigation to a bookmark (sets pendingNavigationId for R3F pickup). */
  readonly requestNavigation: (bookmarkId: string) => void;
  /** Start a smooth transition to a bookmark. */
  readonly startTransition: (
    bookmark: CameraBookmark,
    currentPosition: readonly [number, number, number],
    currentTarget: readonly [number, number, number],
  ) => void;
  /** Update elapsed time on the active transition. Returns true if still animating. */
  readonly updateTransition: (delta: number) => boolean;
  /** Clear the active transition (called when animation completes). */
  readonly clearTransition: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useBookmarkStore = create<BookmarkState>()((set, get) => ({
  bookmarks: [],
  transition: null,
  nextId: 1,
  pendingNavigationId: null,

  initialize: (dimensions: SpaceDimensions) => {
    const defaults = computeDefaultBookmarks(dimensions);
    set({ bookmarks: defaults });
  },

  addBookmark: (
    name: string,
    position: readonly [number, number, number],
    target: readonly [number, number, number],
  ) => {
    const state = get();
    const id = generateBookmarkId(state.nextId);
    const bookmark: CameraBookmark = { id, name, position, target };
    set({
      bookmarks: [...state.bookmarks, bookmark],
      nextId: state.nextId + 1,
    });
  },

  removeBookmark: (id: string) => {
    const state = get();
    set({
      bookmarks: state.bookmarks.filter((b) => b.id !== id),
    });
  },

  requestNavigation: (bookmarkId: string) => {
    set({ pendingNavigationId: bookmarkId });
  },

  startTransition: (
    bookmark: CameraBookmark,
    currentPosition: readonly [number, number, number],
    currentTarget: readonly [number, number, number],
  ) => {
    const duration = computeTransitionDuration(
      currentPosition,
      bookmark.position,
      currentTarget,
      bookmark.target,
    );
    const transition: CameraTransition = {
      fromPosition: currentPosition,
      fromTarget: currentTarget,
      toPosition: bookmark.position,
      toTarget: bookmark.target,
      duration,
      elapsed: 0,
    };
    set({ transition });
  },

  updateTransition: (delta: number): boolean => {
    const state = get();
    if (state.transition === null) return false;

    const newElapsed = Math.min(
      state.transition.duration,
      state.transition.elapsed + delta,
    );
    const done = newElapsed >= state.transition.duration;

    if (done) {
      set({ transition: null });
      return false;
    }

    set({
      transition: { ...state.transition, elapsed: newElapsed },
    });
    return true;
  },

  clearTransition: () => {
    set({ transition: null });
  },
}));
