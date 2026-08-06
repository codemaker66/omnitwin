import { beforeEach, describe, expect, it } from "vitest";
import type { PlacedItem } from "../../lib/placement.js";
import { useEditorStore } from "../editor-store.js";
import { usePlacementStore } from "../placement-store.js";
import {
  useLayoutTimelinePreviewStore,
  type LayoutTimelinePreviewFrameMetadata,
} from "../layout-timeline-preview-store.js";

const ITEM_ID = "c95895c6-0051-5b5c-b1a9-353f47c366ca";

function item(id: string, x: number): PlacedItem {
  return {
    id,
    catalogueItemId: ITEM_ID,
    label: "",
    x,
    y: 0,
    z: 0,
    rotationY: 0,
    clothed: false,
    clothStyle: null,
    tableSetting: null,
    groupId: null,
  };
}

function frame(id: string, eventId = "event-a"): LayoutTimelinePreviewFrameMetadata {
  return {
    id,
    eventId,
    eventName: eventId === "event-a" ? "Wedding Dinner" : "Conference",
    phaseId: `phase-${id}`,
    phaseName: id,
    startsAt: "2026-07-18T18:00:00.000Z",
    endsAt: "2026-07-18T19:00:00.000Z",
  };
}

beforeEach(() => {
  useLayoutTimelinePreviewStore.getState().clear();
});

describe("layout timeline preview store", () => {
  it("morphs matching furniture only between phases of the same event", () => {
    const from = item("stable-chair", 0);
    const to = item("stable-chair", 8);
    useLayoutTimelinePreviewStore.getState().beginTransition({
      fromFrame: frame("setup"),
      toFrame: frame("dinner"),
      fromItems: [from],
      toItems: [to],
      reducedMotion: false,
    });

    useLayoutTimelinePreviewStore.getState().setProgress(0.25);
    const state = useLayoutTimelinePreviewStore.getState();
    expect(state.transition?.mode).toBe("same-event-morph");
    const transitionPlan = state.transition?.itemTransitionPlan;
    expect(transitionPlan?.pairs).toHaveLength(1);
    expect(state.currentItems[0]?.x).toBe(2);
    expect(state.activeFrame?.id).toBe("setup");

    state.setProgress(0.75);
    expect(useLayoutTimelinePreviewStore.getState().transition?.itemTransitionPlan).toBe(transitionPlan);
  });

  it("never glides furniture across event boundaries", () => {
    const from = item("stable-chair", 0);
    const to = item("stable-chair", 8);
    useLayoutTimelinePreviewStore.getState().beginTransition({
      fromFrame: frame("breakdown", "event-a"),
      toFrame: frame("setup", "event-b"),
      fromItems: [from],
      toItems: [to],
      reducedMotion: false,
    });

    useLayoutTimelinePreviewStore.getState().setProgress(0.25);
    expect(useLayoutTimelinePreviewStore.getState().transition?.mode).toBe("cross-event-replace");
    expect(useLayoutTimelinePreviewStore.getState().transition?.itemTransitionPlan).toBeNull();
    const captureBeforeMidpoint = useLayoutTimelinePreviewStore.getState().captureItems;
    expect(useLayoutTimelinePreviewStore.getState().currentItems).toBe(
      useLayoutTimelinePreviewStore.getState().transition?.fromItems,
    );

    useLayoutTimelinePreviewStore.getState().setProgress(0.4);
    expect(useLayoutTimelinePreviewStore.getState().captureItems).toBe(captureBeforeMidpoint);

    useLayoutTimelinePreviewStore.getState().setProgress(0.75);
    expect(useLayoutTimelinePreviewStore.getState().currentItems).toBe(
      useLayoutTimelinePreviewStore.getState().transition?.toItems,
    );
    expect(useLayoutTimelinePreviewStore.getState().captureItems).toBe(
      useLayoutTimelinePreviewStore.getState().transition?.toItems,
    );
  });

  it("uses a non-spatial crossfade policy when reduced motion is requested", () => {
    useLayoutTimelinePreviewStore.getState().beginTransition({
      fromFrame: frame("setup"),
      toFrame: frame("dinner"),
      fromItems: [item("chair", 0)],
      toItems: [item("chair", 12)],
      reducedMotion: true,
    });

    useLayoutTimelinePreviewStore.getState().setProgress(0.4);
    let state = useLayoutTimelinePreviewStore.getState();
    expect(state.transition?.mode).toBe("reduced-motion-crossfade");
    expect(state.currentItems[0]?.x).toBe(0);

    state.setProgress(0.6);
    state = useLayoutTimelinePreviewStore.getState();
    expect(state.currentItems[0]?.x).toBe(12);
  });

  it("clears an active preview instead of guessing a missing keyframe", () => {
    useLayoutTimelinePreviewStore.getState().settle(frame("setup"), [item("chair", 0)]);
    expect(useLayoutTimelinePreviewStore.getState().activeFrame).not.toBeNull();

    useLayoutTimelinePreviewStore.getState().beginTransition({
      fromFrame: frame("setup"),
      toFrame: frame("dinner"),
      fromItems: [item("chair", 0)],
      toItems: null,
      reducedMotion: false,
    });

    expect(useLayoutTimelinePreviewStore.getState().activeFrame).toBeNull();
    expect(useLayoutTimelinePreviewStore.getState().currentItems).toEqual([]);
    expect(useLayoutTimelinePreviewStore.getState().captureItems).toEqual([]);
    expect(useLayoutTimelinePreviewStore.getState().transition).toBeNull();
  });

  it("settles a keyframe and clears it explicitly", () => {
    const savedItems = [item("chair", 4)];
    useLayoutTimelinePreviewStore.getState().settle(frame("dinner"), savedItems);
    expect(useLayoutTimelinePreviewStore.getState().activeFrame?.id).toBe("dinner");
    expect(useLayoutTimelinePreviewStore.getState().currentItems).toBe(savedItems);
    expect(useLayoutTimelinePreviewStore.getState().captureItems).toBe(savedItems);
    expect(useLayoutTimelinePreviewStore.getState().transition).toBeNull();

    useLayoutTimelinePreviewStore.getState().clear();
    expect(useLayoutTimelinePreviewStore.getState().activeFrame).toBeNull();
    expect(useLayoutTimelinePreviewStore.getState().currentItems).toEqual([]);
  });

  it("never writes timeline preview state into placement or editor autosave state", () => {
    const placedItemsBefore = usePlacementStore.getState().placedItems;
    const editorObjectsBefore = useEditorStore.getState().objects;

    useLayoutTimelinePreviewStore.getState().beginTransition({
      fromFrame: frame("setup"),
      toFrame: frame("dinner"),
      fromItems: [item("chair", 0)],
      toItems: [item("chair", 8)],
      reducedMotion: false,
    });
    useLayoutTimelinePreviewStore.getState().setProgress(0.8);
    useLayoutTimelinePreviewStore.getState().settle(frame("dinner"), [item("chair", 8)]);
    useLayoutTimelinePreviewStore.getState().clear();

    expect(usePlacementStore.getState().placedItems).toBe(placedItemsBefore);
    expect(useEditorStore.getState().objects).toBe(editorObjectsBefore);
  });
});
