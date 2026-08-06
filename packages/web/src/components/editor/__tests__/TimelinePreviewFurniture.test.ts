import { describe, expect, it } from "vitest";
import type { PlacedItem } from "../../../lib/placement.js";
import type {
  LayoutTimelinePreviewFrameMetadata,
  LayoutTimelinePreviewTransition,
  LayoutTimelinePreviewTransitionMode,
} from "../../../stores/layout-timeline-preview-store.js";
import {
  nearestTimelineKeyframeItems,
  timelinePreviewOpacity,
  timelinePreviewRenderLayers,
} from "../TimelinePreviewFurniture.js";

function item(id: string, x: number): PlacedItem {
  return {
    id,
    catalogueItemId: "catalogue-chair",
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

function frame(id: string, eventId: string): LayoutTimelinePreviewFrameMetadata {
  return {
    id,
    eventId,
    eventName: eventId,
    phaseId: id,
    phaseName: id,
    startsAt: null,
    endsAt: null,
  };
}

function transition(
  mode: LayoutTimelinePreviewTransitionMode,
  progress: number,
): LayoutTimelinePreviewTransition {
  const fromEventId = "event-a";
  const toEventId = mode === "cross-event-replace" ? "event-b" : "event-a";
  return {
    fromFrame: frame("from", fromEventId),
    toFrame: frame("to", toEventId),
    fromItems: [item("from-chair", 0)],
    toItems: [item("to-chair", 8)],
    reducedMotion: mode === "reduced-motion-crossfade",
    mode,
    itemTransitionPlan: null,
    progress,
  };
}

describe("timeline preview scene policy", () => {
  it("renders one interpolated layer for a same-event morph", () => {
    const currentItems = [item("morph-chair", 3)];
    const layers = timelinePreviewRenderLayers({
      currentItems,
      transition: transition("same-event-morph", 0.4),
    });

    expect(layers).toEqual([
      { key: "morph", items: currentItems, opacityRole: "fixed" },
    ]);
  });

  it("keeps cross-event endpoint trees static while progress only drives opacity", () => {
    const activeTransition = transition("cross-event-replace", 0.25);
    const layers = timelinePreviewRenderLayers({ currentItems: [], transition: activeTransition });

    expect(layers[0]).toMatchObject({ key: "from", opacityRole: "from-progress" });
    expect(layers[1]).toMatchObject({ key: "to", opacityRole: "to-progress" });
    expect(layers[0]?.items).toBe(activeTransition.fromItems);
    expect(layers[1]?.items).toBe(activeTransition.toItems);

    const laterLayers = timelinePreviewRenderLayers({
      currentItems: [],
      transition: { ...activeTransition, progress: 0.75 },
    });
    expect(laterLayers[0]?.items).toBe(activeTransition.fromItems);
    expect(laterLayers[1]?.items).toBe(activeTransition.toItems);
    expect(timelinePreviewOpacity("from-progress", 0.75)).toBe(0.25);
    expect(timelinePreviewOpacity("to-progress", 0.75)).toBe(0.75);
  });

  it("uses the same non-spatial static endpoint descriptors under reduced motion", () => {
    const layers = timelinePreviewRenderLayers({
      currentItems: [],
      transition: transition("reduced-motion-crossfade", 0.25),
    });

    expect(layers.map((layer) => layer.opacityRole)).toEqual(["from-progress", "to-progress"]);
  });

  it("selects the nearest immutable endpoint for capture", () => {
    const activeTransition = transition("same-event-morph", 0.49);
    expect(nearestTimelineKeyframeItems([], activeTransition)).toBe(activeTransition.fromItems);

    const afterMidpoint = { ...activeTransition, progress: 0.5 };
    expect(nearestTimelineKeyframeItems([], afterMidpoint)).toBe(afterMidpoint.toItems);
  });
});
