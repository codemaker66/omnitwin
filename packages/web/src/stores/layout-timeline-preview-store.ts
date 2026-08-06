import { create } from "zustand";
import type { PlacedItem } from "../lib/placement.js";
import {
  buildTimelineItemTransitionPlan,
  interpolateTimelineItemTransitionPlan,
  type TimelineItemTransitionPlan,
} from "../lib/layout-timeline.js";

/** The immutable phase identity needed by the read-only scene preview. */
export interface LayoutTimelinePreviewFrameMetadata {
  readonly id: string;
  readonly eventId: string;
  readonly eventName: string;
  readonly phaseId: string;
  readonly phaseName: string;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
}

export type LayoutTimelinePreviewTransitionMode =
  | "same-event-morph"
  | "cross-event-replace"
  | "reduced-motion-crossfade";

export interface BeginLayoutTimelinePreviewTransitionInput {
  readonly fromFrame: LayoutTimelinePreviewFrameMetadata;
  readonly toFrame: LayoutTimelinePreviewFrameMetadata;
  /** Null means the phase has no trustworthy saved keyframe. An empty array is a valid empty layout. */
  readonly fromItems: readonly PlacedItem[] | null;
  readonly toItems: readonly PlacedItem[] | null;
  readonly reducedMotion: boolean;
}

export interface LayoutTimelinePreviewTransition {
  readonly fromFrame: LayoutTimelinePreviewFrameMetadata;
  readonly toFrame: LayoutTimelinePreviewFrameMetadata;
  readonly fromItems: readonly PlacedItem[];
  readonly toItems: readonly PlacedItem[];
  readonly reducedMotion: boolean;
  readonly mode: LayoutTimelinePreviewTransitionMode;
  readonly itemTransitionPlan: TimelineItemTransitionPlan | null;
  readonly progress: number;
}

export interface LayoutTimelinePreviewState {
  readonly activeFrame: LayoutTimelinePreviewFrameMetadata | null;
  readonly currentItems: readonly PlacedItem[];
  /** Nearest immutable endpoint, updated only when the scrub crosses its midpoint. */
  readonly captureItems: readonly PlacedItem[];
  readonly transition: LayoutTimelinePreviewTransition | null;
  readonly beginTransition: (input: BeginLayoutTimelinePreviewTransitionInput) => void;
  readonly setProgress: (progress: number) => void;
  readonly settle: (
    frame: LayoutTimelinePreviewFrameMetadata,
    items: readonly PlacedItem[] | null,
  ) => void;
  readonly clear: () => void;
}

const CLEARED_PREVIEW = {
  activeFrame: null,
  currentItems: [],
  captureItems: [],
  transition: null,
} as const;

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}

function transitionMode(
  input: BeginLayoutTimelinePreviewTransitionInput,
): LayoutTimelinePreviewTransitionMode {
  if (input.reducedMotion) return "reduced-motion-crossfade";
  return input.fromFrame.eventId === input.toFrame.eventId
    ? "same-event-morph"
    : "cross-event-replace";
}

/**
 * Ephemeral, presentation-only timeline state. This store deliberately has no
 * dependency on editor-store or placement-store, so scrubbing cannot enter the
 * autosave bridge or the editor undo history.
 */
export const useLayoutTimelinePreviewStore = create<LayoutTimelinePreviewState>()((set, get) => ({
  ...CLEARED_PREVIEW,

  beginTransition: (input) => {
    if (input.fromItems === null || input.toItems === null) {
      set(CLEARED_PREVIEW);
      return;
    }

    const mode = transitionMode(input);
    const transition: LayoutTimelinePreviewTransition = {
      fromFrame: input.fromFrame,
      toFrame: input.toFrame,
      fromItems: input.fromItems,
      toItems: input.toItems,
      reducedMotion: input.reducedMotion,
      mode,
      itemTransitionPlan: mode === "same-event-morph"
        ? buildTimelineItemTransitionPlan(input.fromItems, input.toItems)
        : null,
      progress: 0,
    };
    set({
      activeFrame: input.fromFrame,
      currentItems: input.fromItems,
      captureItems: input.fromItems,
      transition,
    });
  },

  setProgress: (progress) => {
    const current = get().transition;
    if (current === null) return;
    const clamped = clampProgress(progress);
    const beforeMidpoint = clamped < 0.5;
    const activeFrame = beforeMidpoint ? current.fromFrame : current.toFrame;
    const captureItems = beforeMidpoint ? current.fromItems : current.toItems;
    const currentItems = current.itemTransitionPlan === null
      ? captureItems
      : interpolateTimelineItemTransitionPlan(current.itemTransitionPlan, clamped);
    set({
      activeFrame,
      currentItems,
      captureItems,
      transition: { ...current, progress: clamped },
    });
  },

  settle: (frame, items) => {
    if (items === null) {
      set(CLEARED_PREVIEW);
      return;
    }
    set({ activeFrame: frame, currentItems: items, captureItems: items, transition: null });
  },

  clear: () => { set(CLEARED_PREVIEW); },
}));

