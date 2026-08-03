import { afterEach, describe, expect, it, vi } from "vitest";
import { CANONICAL_ASSETS, CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE } from "@omnitwin/types";
import type { PlacedItem } from "../../../lib/placement.js";
import { buildTimelineItemTransitionPlan } from "../../../lib/layout-timeline.js";
import type {
  LayoutTimelinePreviewFrameMetadata,
  LayoutTimelinePreviewTransition,
  LayoutTimelinePreviewTransitionMode,
} from "../../../stores/layout-timeline-preview-store.js";
import {
  nearestTimelineKeyframeItems,
  subscribeTimelineMorphInvalidation,
  timelinePreviewOpacity,
  timelinePreviewRenderLayers,
  timelinePreviewUsesSimplifiedLod,
  timelineSimplifiedProxyDimensions,
  timelineFurnitureRenderKind,
  timelineCaptureEndpointReuse,
  timelineStaticTransitionHardCuts,
  timelineUniformMorphTranslation,
} from "../TimelinePreviewFurniture.js";
import { useLayoutTimelinePreviewStore } from "../../../stores/layout-timeline-preview-store.js";

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
    historicalRuntime: null,
    venueRuntime: CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.venueRuntime,
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
    roomEnvelopeChanged: false,
    progress,
  };
}

describe("timeline preview scene policy", () => {
  afterEach(() => {
    useLayoutTimelinePreviewStore.getState().clear();
  });
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

  it("hard-cuts furniture with the room shell when frozen coordinate envelopes differ", () => {
    const activeTransition = {
      ...transition("cross-event-replace", 0.49),
      roomEnvelopeChanged: true,
    };
    const before = timelinePreviewRenderLayers({ currentItems: [], transition: activeTransition });
    const after = timelinePreviewRenderLayers({
      currentItems: [],
      transition: { ...activeTransition, progress: 0.5 },
    });

    expect(before).toEqual([{
      key: "settled",
      items: activeTransition.fromItems,
      opacityRole: "fixed",
    }]);
    expect(after).toEqual([{
      key: "settled",
      items: activeTransition.toItems,
      opacityRole: "fixed",
    }]);
    expect(timelineStaticTransitionHardCuts("cross-event-replace", true)).toBe(true);
    expect(timelineStaticTransitionHardCuts("cross-event-replace", false)).toBe(false);
  });

  it("selects the nearest immutable endpoint for capture", () => {
    const activeTransition = transition("same-event-morph", 0.49);
    expect(nearestTimelineKeyframeItems([], activeTransition)).toBe(activeTransition.fromItems);

    const afterMidpoint = { ...activeTransition, progress: 0.5 };
    expect(nearestTimelineKeyframeItems([], afterMidpoint)).toBe(afterMidpoint.toItems);
  });

  it("uses embedded canonical geometry instead of silently dropping historical assets", () => {
    const historical: PlacedItem = {
      ...item("historical", 0),
      catalogueItemId: "99999999-9999-4999-8999-999999999999",
      embeddedAssetDefinition: {
        assetDefinitionId: "99999999-9999-4999-8999-999999999999",
        category: "table",
        widthM: 1.8,
        depthM: 1.8,
        heightM: 0.75,
        seatCount: 10,
        collisionType: "cylinder",
      },
    };
    expect(timelineFurnitureRenderKind(historical)).toBe("canonical-fallback");
    expect(timelineSimplifiedProxyDimensions(historical)).toEqual({
      width: 3.6,
      height: 0.75,
      depth: 3.6,
    });

    const currentCatalogueId = CANONICAL_ASSETS[0]?.id;
    expect(currentCatalogueId).toBeDefined();
    if (currentCatalogueId !== undefined) {
      const current = { ...item("current", 0), catalogueItemId: currentCatalogueId };
      expect(timelineFurnitureRenderKind(current))
        .toBe("catalogue");
      const canonical = CANONICAL_ASSETS[0];
      expect(timelineSimplifiedProxyDimensions(current)).toEqual({
        width: (canonical?.widthM ?? 0) * 2,
        height: canonical?.heightM ?? 0,
        depth: (canonical?.depthM ?? 0) * 2,
      });
    }
  });

  it("falls back for known catalogue IDs whose current definition has drifted", () => {
    const canonical = CANONICAL_ASSETS[0];
    expect(canonical).toBeDefined();
    if (canonical === undefined) return;
    const embeddedAssetDefinition = {
      assetDefinitionId: canonical.id,
      category: canonical.category,
      widthM: canonical.widthM,
      depthM: canonical.depthM,
      heightM: canonical.heightM,
      seatCount: canonical.seatCount,
      collisionType: canonical.collisionType,
    };
    const frozen: PlacedItem = {
      ...item("known-frozen", 0),
      catalogueItemId: canonical.id,
      embeddedAssetDefinition,
    };

    expect(timelineFurnitureRenderKind(frozen)).toBe("catalogue");

    const drifts: readonly PlacedItem[] = [
      {
        ...frozen,
        embeddedAssetDefinition: { ...embeddedAssetDefinition, widthM: canonical.widthM + 0.4 },
      },
      {
        ...frozen,
        embeddedAssetDefinition: {
          ...embeddedAssetDefinition,
          category: canonical.category === "table" ? "chair" : "table",
        },
      },
      {
        ...frozen,
        embeddedAssetDefinition: {
          ...embeddedAssetDefinition,
          collisionType: canonical.collisionType === "cylinder" ? "box" : "cylinder",
        },
      },
    ];

    for (const drifted of drifts) {
      expect(timelineFurnitureRenderKind(drifted)).toBe("canonical-fallback");
    }
    expect(timelineSimplifiedProxyDimensions(drifts[0] as PlacedItem)).toEqual({
      width: (canonical.widthM + 0.4) * 2,
      height: canonical.heightM,
      depth: canonical.depthM * 2,
    });
  });

  it("switches only high-cardinality previews to the simplified instanced LOD", () => {
    expect(timelinePreviewUsesSimplifiedLod(240)).toBe(false);
    expect(timelinePreviewUsesSimplifiedLod(241)).toBe(true);
  });

  it("uses a single group translation only for genuinely rigid high-cardinality plans", () => {
    const canonical = CANONICAL_ASSETS[0];
    expect(canonical).toBeDefined();
    if (canonical === undefined) return;
    const frozenItem = (id: string, x: number): PlacedItem => ({
      ...item(id, x),
      catalogueItemId: canonical.id,
    });
    const fromItems = [frozenItem("chair-a", 0), frozenItem("chair-b", 2)];
    const rigidPlan = buildTimelineItemTransitionPlan(fromItems, [
      frozenItem("chair-a", 8),
      frozenItem("chair-b", 10),
    ]);
    const nonRigidPlan = buildTimelineItemTransitionPlan(fromItems, [
      frozenItem("chair-a", 8),
      frozenItem("chair-b", 11),
    ]);

    expect(timelineUniformMorphTranslation(rigidPlan)).toEqual({ x: 8, y: 0, z: 0 });
    expect(timelineUniformMorphTranslation(nonRigidPlan)).toBeNull();
  });

  it("reuses hidden capture endpoint batches when a high-cardinality morph reverses", () => {
    const fromItems = Array.from(
      { length: 500 },
      (_, index) => item(`chair-${String(index)}`, index),
    );
    const toItems = Array.from(
      { length: 500 },
      (_, index) => item(`chair-${String(index)}`, index + 8),
    );
    const forward = buildTimelineItemTransitionPlan(fromItems, toItems);
    const reverse = buildTimelineItemTransitionPlan(toItems, fromItems);
    const initial = timelineCaptureEndpointReuse(null, forward);
    const reused = timelineCaptureEndpointReuse(initial, reverse);

    expect(initial.physicalPlan).toBe(forward);
    expect(reused.physicalPlan).toBe(forward);
    expect(reused.activePlan).toBe(reverse);
    expect(reused.activeFromUsesPhysicalTo).toBe(true);
    expect(reused.targetEndpoint).toBe("from");
  });

  it("invalidates the demand-rendered canvas for each distinct imperative morph progress", () => {
    const fromFrame = frame("from", "event-a");
    const toFrame = frame("to", "event-a");
    useLayoutTimelinePreviewStore.getState().beginTransition({
      fromFrame,
      toFrame,
      fromItems: [item("chair", 0)],
      toItems: [item("chair", 8)],
      reducedMotion: false,
      spatialMorphAllowed: true,
    });
    const plan = useLayoutTimelinePreviewStore.getState().transition?.itemTransitionPlan;
    expect(plan).not.toBeNull();
    if (plan === null || plan === undefined) return;
    const invalidate = vi.fn();
    const unsubscribe = subscribeTimelineMorphInvalidation(plan, invalidate);

    useLayoutTimelinePreviewStore.getState().setProgress(0.25);
    useLayoutTimelinePreviewStore.getState().setProgress(0.25);
    useLayoutTimelinePreviewStore.getState().setProgress(0.75);
    expect(invalidate).toHaveBeenCalledTimes(2);

    unsubscribe();
    useLayoutTimelinePreviewStore.getState().setProgress(0.9);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });
});
