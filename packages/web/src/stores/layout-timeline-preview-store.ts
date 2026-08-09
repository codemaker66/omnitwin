import { create } from "zustand";
import type {
  LayoutSnapshotVenueRuntimeReference,
  PhaseLayoutHistoricalRuntime,
  PhaseLayoutRuntimeAvailableBinding,
} from "@omnitwin/types";
import type { PlacedItem } from "../lib/placement.js";
import { setLayoutTimelineMutationLock } from "../lib/layout-timeline-preview-lock.js";
import {
  buildTimelineItemTransitionPlan,
  interpolateTimelineItemTransitionPlan,
  timelineTransitionUsesImperativeMorph,
  type TimelineItemTransitionPlan,
} from "../lib/layout-timeline.js";
import { frozenRoomEnvelopesMatch } from "../lib/frozen-layout-room.js";

declare const dormantHistoricalRuntimeRenderInputBrand: unique symbol;

/**
 * Branded dormant renderer input used only by renderer-focused tests. It is
 * structurally impossible for a parsed network timeline response to create
 * this branch. T-541 must replace it with an authenticated activation type.
 */
export type HistoricalRuntimeRenderInput =
  | PhaseLayoutHistoricalRuntime
  | {
      readonly state: "available";
      readonly binding: PhaseLayoutRuntimeAvailableBinding;
      readonly [dormantHistoricalRuntimeRenderInputBrand]: true;
    };

/** The immutable phase identity needed by the read-only scene preview. */
export interface LayoutTimelinePreviewFrameMetadata {
  readonly id: string;
  readonly eventId: string;
  readonly eventName: string;
  readonly phaseId: string;
  readonly phaseName: string;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  /** Present only for a schema-valid immutable keyframe. */
  readonly venueRuntime: LayoutSnapshotVenueRuntimeReference | null;
  /** Exact frozen runtime proof for this endpoint; unavailable is explicit. */
  readonly historicalRuntime: HistoricalRuntimeRenderInput | null;
}

export type LayoutTimelinePreviewTransitionMode =
  | "same-event-morph"
  | "cross-event-replace"
  | "reduced-motion-crossfade";

export type LayoutTimelinePreviewSessionMode =
  | "inactive"
  | "keyframe"
  | "transition"
  | "unavailable"
  | "schedule-gap";

export interface BeginLayoutTimelinePreviewTransitionInput {
  readonly fromFrame: LayoutTimelinePreviewFrameMetadata;
  readonly toFrame: LayoutTimelinePreviewFrameMetadata;
  /** Null means the phase has no trustworthy saved keyframe. An empty array is a valid empty layout. */
  readonly fromItems: readonly PlacedItem[] | null;
  readonly toItems: readonly PlacedItem[] | null;
  /** Immutable endpoint used by orthographic evidence capture during a retarget. */
  readonly fromCaptureItems?: readonly PlacedItem[] | null;
  /** Immutable endpoint used by orthographic evidence capture during a retarget. */
  readonly toCaptureItems?: readonly PlacedItem[] | null;
  readonly reducedMotion: boolean;
  /** False forces a static endpoint replace instead of inventing spatial motion. */
  readonly spatialMorphAllowed: boolean;
}

export interface LayoutTimelinePreviewTransition {
  readonly fromFrame: LayoutTimelinePreviewFrameMetadata;
  readonly toFrame: LayoutTimelinePreviewFrameMetadata;
  readonly fromItems: readonly PlacedItem[];
  readonly toItems: readonly PlacedItem[];
  readonly fromCaptureItems: readonly PlacedItem[];
  readonly toCaptureItems: readonly PlacedItem[];
  readonly reducedMotion: boolean;
  readonly mode: LayoutTimelinePreviewTransitionMode;
  readonly itemTransitionPlan: TimelineItemTransitionPlan | null;
  /** Different origins/bounds must hard-cut with their matching room shell. */
  readonly roomEnvelopeChanged: boolean;
  readonly progress: number;
}

export interface LayoutTimelinePreviewState {
  /**
   * Monotonic scene-tree revision. It advances only when the frozen renderer
   * must establish a new trustworthy frame, never for ordinary morph samples.
   */
  readonly renderRevision: number;
  readonly mode: LayoutTimelinePreviewSessionMode;
  readonly activeFrame: LayoutTimelinePreviewFrameMetadata | null;
  /** Renderer-local frozen room authority selected with the nearest endpoint. */
  readonly activeVenueRuntime: LayoutSnapshotVenueRuntimeReference | null;
  readonly unavailableMessage: string | null;
  readonly currentItems: readonly PlacedItem[];
  /** Nearest immutable endpoint, updated only when the scrub crosses its midpoint. */
  readonly captureItems: readonly PlacedItem[];
  readonly transition: LayoutTimelinePreviewTransition | null;
  /** At most one non-active frozen package selected for bounded prefetch. */
  readonly adjacentHistoricalRuntime: HistoricalRuntimeRenderInput | null;
  readonly setAdjacentHistoricalRuntime: (
    runtime: HistoricalRuntimeRenderInput | null,
  ) => void;
  readonly beginTransition: (input: BeginLayoutTimelinePreviewTransitionInput) => void;
  readonly setProgress: (progress: number) => void;
  readonly settle: (
    frame: LayoutTimelinePreviewFrameMetadata,
    items: readonly PlacedItem[] | null,
  ) => void;
  readonly showUnavailable: (
    frame: LayoutTimelinePreviewFrameMetadata,
    message: string,
  ) => void;
  /** Keeps the scene empty and mutation-locked while an authoritative range is loading. */
  readonly showPending: (message: string) => void;
  /** Represents a real empty schedule interval without borrowing a phase identity. */
  readonly showScheduleGap: (message: string) => void;
  readonly clear: () => void;
}

/**
 * Returns the physical arrangement currently drawn by the scene. Dense GPU
 * morphs keep `currentItems` on a semantic endpoint to avoid O(n) React-store
 * churn, so secondary previews and one-off retargets sample the stable plan.
 */
export function layoutTimelineRenderedItems(
  state: Pick<LayoutTimelinePreviewState, "currentItems" | "transition">,
): readonly PlacedItem[] {
  const plan = state.transition?.itemTransitionPlan ?? null;
  if (plan === null || !timelineTransitionUsesImperativeMorph(plan)) {
    return state.currentItems;
  }
  return interpolateTimelineItemTransitionPlan(
    plan,
    state.transition?.progress ?? 0,
  );
}

const CLEARED_PREVIEW = {
  renderRevision: 0,
  mode: "inactive",
  activeFrame: null,
  activeVenueRuntime: null,
  unavailableMessage: null,
  currentItems: [],
  captureItems: [],
  transition: null,
  adjacentHistoricalRuntime: null,
} as const;

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}

function transitionMode(
  input: BeginLayoutTimelinePreviewTransitionInput,
): LayoutTimelinePreviewTransitionMode {
  if (input.reducedMotion) return "reduced-motion-crossfade";
  const matchingFrozenEnvelope = input.fromFrame.venueRuntime !== null
    && input.toFrame.venueRuntime !== null
    && frozenRoomEnvelopesMatch(
      input.fromFrame.venueRuntime,
      input.toFrame.venueRuntime,
    );
  return input.fromFrame.eventId === input.toFrame.eventId
    && input.spatialMorphAllowed
    && matchingFrozenEnvelope
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

  setAdjacentHistoricalRuntime: (runtime) => {
    set((state) => state.adjacentHistoricalRuntime === runtime
      ? state
      : { adjacentHistoricalRuntime: runtime });
  },

  beginTransition: (input) => {
    if (
      input.fromItems === null
      || input.toItems === null
      || input.fromFrame.venueRuntime === null
      || input.toFrame.venueRuntime === null
    ) {
      setLayoutTimelineMutationLock(true);
      set({
        mode: "unavailable",
        activeFrame: input.toFrame,
        activeVenueRuntime: null,
        unavailableMessage: "No trustworthy frozen layout is available for this time.",
        currentItems: [],
        captureItems: [],
        transition: null,
      });
      return;
    }

    const mode = transitionMode(input);
    const fromCaptureItems = input.fromCaptureItems ?? input.fromItems;
    const toCaptureItems = input.toCaptureItems ?? input.toItems;
    const transition: LayoutTimelinePreviewTransition = {
      fromFrame: input.fromFrame,
      toFrame: input.toFrame,
      fromItems: input.fromItems,
      toItems: input.toItems,
      fromCaptureItems,
      toCaptureItems,
      reducedMotion: input.reducedMotion,
      mode,
      itemTransitionPlan: mode === "same-event-morph"
        ? buildTimelineItemTransitionPlan(input.fromItems, input.toItems)
        : null,
      roomEnvelopeChanged: !frozenRoomEnvelopesMatch(
        input.fromFrame.venueRuntime,
        input.toFrame.venueRuntime,
      ),
      progress: 0,
    };
    setLayoutTimelineMutationLock(true);
    set((state) => ({
      renderRevision: state.renderRevision + 1,
      mode: "transition",
      activeFrame: input.fromFrame,
      activeVenueRuntime: input.fromFrame.venueRuntime,
      unavailableMessage: null,
      currentItems: transition.fromItems,
      captureItems: transition.fromCaptureItems,
      transition,
    }));
  },

  setProgress: (progress) => {
    const current = get().transition;
    if (current === null) return;
    const clamped = clampProgress(progress);
    const beforeMidpoint = clamped < 0.5;
    const staticEndpointChanged = current.itemTransitionPlan === null
      && beforeMidpoint !== (current.progress < 0.5);
    const activeFrame = beforeMidpoint ? current.fromFrame : current.toFrame;
    const captureItems = beforeMidpoint
      ? current.fromCaptureItems
      : current.toCaptureItems;
    const physicalEndpointItems = beforeMidpoint
      ? current.fromItems
      : current.toItems;
    const currentItems = current.itemTransitionPlan !== null
      && !timelineTransitionUsesImperativeMorph(current.itemTransitionPlan)
      ? interpolateTimelineItemTransitionPlan(current.itemTransitionPlan, clamped)
      : physicalEndpointItems;
    set((state) => ({
      renderRevision: staticEndpointChanged
        ? state.renderRevision + 1
        : state.renderRevision,
      activeFrame,
      activeVenueRuntime: activeFrame.venueRuntime,
      currentItems,
      captureItems,
      transition: { ...current, progress: clamped },
    }));
  },

  settle: (frame, items) => {
    if (items === null || frame.venueRuntime === null) {
      setLayoutTimelineMutationLock(true);
      set({
        mode: "unavailable",
        activeFrame: frame,
        activeVenueRuntime: null,
        unavailableMessage: "No trustworthy frozen layout is available for this time.",
        currentItems: [],
        captureItems: [],
        transition: null,
      });
      return;
    }
    setLayoutTimelineMutationLock(true);
    set((state) => ({
      renderRevision: state.renderRevision + 1,
      mode: "keyframe",
      activeFrame: frame,
      activeVenueRuntime: frame.venueRuntime,
      unavailableMessage: null,
      currentItems: items,
      captureItems: items,
      transition: null,
    }));
  },

  showUnavailable: (frame, message) => {
    setLayoutTimelineMutationLock(true);
    set({
      mode: "unavailable",
      activeFrame: frame,
      activeVenueRuntime: null,
      unavailableMessage: message,
      currentItems: [],
      captureItems: [],
      transition: null,
    });
  },

  showPending: (message) => {
    setLayoutTimelineMutationLock(true);
    set({
      mode: "unavailable",
      activeFrame: null,
      activeVenueRuntime: null,
      unavailableMessage: message,
      currentItems: [],
      captureItems: [],
      transition: null,
    });
  },

  showScheduleGap: (message) => {
    setLayoutTimelineMutationLock(true);
    set({
      mode: "schedule-gap",
      activeFrame: null,
      activeVenueRuntime: null,
      unavailableMessage: message,
      currentItems: [],
      captureItems: [],
      transition: null,
    });
  },

  clear: () => {
    setLayoutTimelineMutationLock(false);
    set((state) => ({
      ...CLEARED_PREVIEW,
      renderRevision: state.renderRevision,
    }));
  },
}));
