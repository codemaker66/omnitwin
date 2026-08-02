import { beforeEach, describe, expect, it } from "vitest";
import { CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE } from "@omnitwin/types";
import type { PlacedItem } from "../../lib/placement.js";
import { isLayoutTimelineMutationLocked } from "../../lib/layout-timeline-preview-lock.js";
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
    venueRuntime: CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.venueRuntime,
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
      spatialMorphAllowed: true,
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

  it("keeps high-cardinality endpoint arrays stable while the renderer samples the morph plan", () => {
    const fromItems = Array.from(
      { length: 241 },
      (_, index) => item(`chair-${String(index)}`, index),
    );
    const toItems = Array.from(
      { length: 241 },
      (_, index) => item(`chair-${String(index)}`, index + 8),
    );
    useLayoutTimelinePreviewStore.getState().beginTransition({
      fromFrame: frame("arrival"),
      toFrame: frame("dinner"),
      fromItems,
      toItems,
      reducedMotion: false,
      spatialMorphAllowed: true,
    });

    useLayoutTimelinePreviewStore.getState().setProgress(0.25);
    expect(useLayoutTimelinePreviewStore.getState().currentItems).toBe(fromItems);
    expect(useLayoutTimelinePreviewStore.getState().transition?.itemTransitionPlan?.pairs)
      .toHaveLength(241);

    useLayoutTimelinePreviewStore.getState().setProgress(0.75);
    expect(useLayoutTimelinePreviewStore.getState().currentItems).toBe(toItems);
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
      spatialMorphAllowed: true,
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

  it("revises render readiness at static begin, midpoint, retarget, and settle without per-progress churn", () => {
    const fromItems = Array.from(
      { length: 500 },
      (_, index) => item(`arrival-${String(index)}`, index),
    );
    const dinnerItems = Array.from(
      { length: 500 },
      (_, index) => item(`dinner-${String(index)}`, index + 10),
    );
    const partyItems = Array.from(
      { length: 500 },
      (_, index) => item(`party-${String(index)}`, index + 20),
    );
    const preview = useLayoutTimelinePreviewStore.getState();
    preview.settle(frame("arrival", "event-a"), fromItems);
    const settledRevision = useLayoutTimelinePreviewStore.getState().renderRevision;

    preview.beginTransition({
      fromFrame: frame("arrival", "event-a"),
      toFrame: frame("dinner", "event-b"),
      fromItems,
      toItems: dinnerItems,
      reducedMotion: false,
      spatialMorphAllowed: false,
    });
    const beginRevision = useLayoutTimelinePreviewStore.getState().renderRevision;
    expect(beginRevision).toBe(settledRevision + 1);

    preview.setProgress(0.1);
    preview.setProgress(0.2);
    preview.setProgress(0.49);
    expect(useLayoutTimelinePreviewStore.getState().renderRevision).toBe(beginRevision);

    // Retargeting before the midpoint rebuilds the static from/to tree even
    // though the visible endpoint, room envelope, and session mode are stable.
    preview.beginTransition({
      fromFrame: frame("arrival", "event-a"),
      toFrame: frame("party", "event-c"),
      fromItems,
      toItems: partyItems,
      reducedMotion: false,
      spatialMorphAllowed: false,
    });
    const retargetRevision = useLayoutTimelinePreviewStore.getState().renderRevision;
    expect(retargetRevision).toBe(beginRevision + 1);

    preview.setProgress(0.5);
    const midpointRevision = useLayoutTimelinePreviewStore.getState().renderRevision;
    expect(midpointRevision).toBe(retargetRevision + 1);
    preview.setProgress(0.75);
    preview.setProgress(1);
    expect(useLayoutTimelinePreviewStore.getState().renderRevision).toBe(midpointRevision);

    preview.setProgress(0.49);
    const backwardMidpointRevision = useLayoutTimelinePreviewStore.getState().renderRevision;
    expect(backwardMidpointRevision).toBe(midpointRevision + 1);
    preview.setProgress(0.25);
    expect(useLayoutTimelinePreviewStore.getState().renderRevision).toBe(backwardMidpointRevision);
    preview.setProgress(0.5);
    const finalForwardMidpointRevision = useLayoutTimelinePreviewStore.getState().renderRevision;
    expect(finalForwardMidpointRevision).toBe(backwardMidpointRevision + 1);

    preview.settle(frame("party", "event-c"), partyItems);
    expect(useLayoutTimelinePreviewStore.getState().renderRevision)
      .toBe(finalForwardMidpointRevision + 1);
  });

  it("does not revise render readiness for ordinary spatial morph samples", () => {
    const fromItems = Array.from(
      { length: 500 },
      (_, index) => item(`stable-chair-${String(index)}`, index),
    );
    const toItems = Array.from(
      { length: 500 },
      (_, index) => item(`stable-chair-${String(index)}`, index + 8),
    );
    const preview = useLayoutTimelinePreviewStore.getState();
    preview.beginTransition({
      fromFrame: frame("arrival"),
      toFrame: frame("dinner"),
      fromItems,
      toItems,
      reducedMotion: false,
      spatialMorphAllowed: true,
    });
    const beginRevision = useLayoutTimelinePreviewStore.getState().renderRevision;
    expect(useLayoutTimelinePreviewStore.getState().transition?.itemTransitionPlan?.pairs)
      .toHaveLength(500);

    preview.setProgress(0.1);
    preview.setProgress(0.5);
    preview.setProgress(0.9);
    expect(useLayoutTimelinePreviewStore.getState().renderRevision).toBe(beginRevision);
  });

  it("does not revise render readiness for states that render no trustworthy frame", () => {
    const preview = useLayoutTimelinePreviewStore.getState();
    preview.settle(frame("arrival"), [item("chair", 0)]);
    const trustworthyRevision = useLayoutTimelinePreviewStore.getState().renderRevision;

    preview.showPending("Loading the authoritative timeline.");
    expect(useLayoutTimelinePreviewStore.getState().renderRevision).toBe(trustworthyRevision);
    preview.showScheduleGap("No phase is scheduled now.");
    expect(useLayoutTimelinePreviewStore.getState().renderRevision).toBe(trustworthyRevision);
    preview.showUnavailable(frame("missing"), "No frozen layout is available.");
    expect(useLayoutTimelinePreviewStore.getState().renderRevision).toBe(trustworthyRevision);
    preview.beginTransition({
      fromFrame: frame("arrival"),
      toFrame: frame("missing"),
      fromItems: null,
      toItems: [item("chair", 1)],
      reducedMotion: false,
      spatialMorphAllowed: true,
    });
    expect(useLayoutTimelinePreviewStore.getState().renderRevision).toBe(trustworthyRevision);
    preview.settle(frame("invalid"), null);
    expect(useLayoutTimelinePreviewStore.getState().renderRevision).toBe(trustworthyRevision);
    preview.clear();
    expect(useLayoutTimelinePreviewStore.getState().renderRevision).toBe(trustworthyRevision);
  });

  it("switches frozen room authority at the same midpoint as identity and capture items", () => {
    const fromFrame = frame("setup");
    const toRuntime = {
      ...CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.venueRuntime,
      floorPlanOutline: CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.venueRuntime.floorPlanOutline
        .map((point) => ({ x: point.x + 2, y: point.y })),
    };
    const toFrame = { ...frame("dinner"), venueRuntime: toRuntime };
    const fromItems = [item("chair", 0)];
    const toItems = [item("chair", 8)];
    useLayoutTimelinePreviewStore.getState().beginTransition({
      fromFrame,
      toFrame,
      fromItems,
      toItems,
      reducedMotion: false,
      // Even a faulty permissive caller cannot morph across coordinate frames.
      spatialMorphAllowed: true,
    });

    expect(useLayoutTimelinePreviewStore.getState().transition).toMatchObject({
      mode: "cross-event-replace",
      roomEnvelopeChanged: true,
      itemTransitionPlan: null,
    });

    useLayoutTimelinePreviewStore.getState().setProgress(0.49);
    expect(useLayoutTimelinePreviewStore.getState()).toMatchObject({
      activeFrame: fromFrame,
      activeVenueRuntime: fromFrame.venueRuntime,
      currentItems: fromItems,
      captureItems: fromItems,
    });

    useLayoutTimelinePreviewStore.getState().setProgress(0.5);
    expect(useLayoutTimelinePreviewStore.getState()).toMatchObject({
      activeFrame: toFrame,
      activeVenueRuntime: toRuntime,
      currentItems: toItems,
      captureItems: toItems,
    });
  });

  it("uses a static replace when intervening schedule truth forbids a same-event morph", () => {
    useLayoutTimelinePreviewStore.getState().beginTransition({
      fromFrame: frame("arrival"),
      toFrame: frame("dinner"),
      fromItems: [item("chair", 0)],
      toItems: [item("chair", 8)],
      reducedMotion: false,
      spatialMorphAllowed: false,
    });

    expect(useLayoutTimelinePreviewStore.getState().transition?.mode).toBe("cross-event-replace");
    expect(useLayoutTimelinePreviewStore.getState().transition?.itemTransitionPlan).toBeNull();
  });

  it("uses a non-spatial crossfade policy when reduced motion is requested", () => {
    useLayoutTimelinePreviewStore.getState().beginTransition({
      fromFrame: frame("setup"),
      toFrame: frame("dinner"),
      fromItems: [item("chair", 0)],
      toItems: [item("chair", 12)],
      reducedMotion: true,
      spatialMorphAllowed: true,
    });

    useLayoutTimelinePreviewStore.getState().setProgress(0.4);
    let state = useLayoutTimelinePreviewStore.getState();
    expect(state.transition?.mode).toBe("reduced-motion-crossfade");
    expect(state.currentItems[0]?.x).toBe(0);

    state.setProgress(0.6);
    state = useLayoutTimelinePreviewStore.getState();
    expect(state.currentItems[0]?.x).toBe(12);
  });

  it("keeps the preview session locked but hides furniture for a missing keyframe", () => {
    useLayoutTimelinePreviewStore.getState().settle(frame("setup"), [item("chair", 0)]);
    expect(useLayoutTimelinePreviewStore.getState().activeFrame).not.toBeNull();

    useLayoutTimelinePreviewStore.getState().beginTransition({
      fromFrame: frame("setup"),
      toFrame: frame("dinner"),
      fromItems: [item("chair", 0)],
      toItems: null,
      reducedMotion: false,
      spatialMorphAllowed: true,
    });

    expect(useLayoutTimelinePreviewStore.getState().mode).toBe("unavailable");
    expect(useLayoutTimelinePreviewStore.getState().activeFrame?.id).toBe("dinner");
    expect(useLayoutTimelinePreviewStore.getState().unavailableMessage).toMatch(/no trustworthy frozen layout/i);
    expect(useLayoutTimelinePreviewStore.getState().currentItems).toEqual([]);
    expect(useLayoutTimelinePreviewStore.getState().captureItems).toEqual([]);
    expect(useLayoutTimelinePreviewStore.getState().transition).toBeNull();
  });

  it("keeps loading ranges locked without carrying stale frame identity", () => {
    useLayoutTimelinePreviewStore.getState().settle(frame("dinner"), [item("chair", 0)]);
    useLayoutTimelinePreviewStore.getState().showPending("Loading the authoritative room timeline…");

    expect(useLayoutTimelinePreviewStore.getState()).toMatchObject({
      mode: "unavailable",
      activeFrame: null,
      unavailableMessage: "Loading the authoritative room timeline…",
      currentItems: [],
      captureItems: [],
      transition: null,
      activeVenueRuntime: null,
    });
    expect(isLayoutTimelineMutationLocked()).toBe(true);
  });

  it("represents a schedule gap without borrowing a phase or furniture", () => {
    useLayoutTimelinePreviewStore.getState().settle(frame("dinner"), [item("chair", 0)]);
    useLayoutTimelinePreviewStore.getState().showScheduleGap("No room phase is scheduled now.");

    expect(useLayoutTimelinePreviewStore.getState()).toMatchObject({
      mode: "schedule-gap",
      activeFrame: null,
      unavailableMessage: "No room phase is scheduled now.",
      currentItems: [],
      captureItems: [],
      transition: null,
      activeVenueRuntime: null,
    });
    expect(isLayoutTimelineMutationLocked()).toBe(true);
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
      spatialMorphAllowed: true,
    });
    useLayoutTimelinePreviewStore.getState().setProgress(0.8);
    useLayoutTimelinePreviewStore.getState().settle(frame("dinner"), [item("chair", 8)]);
    useLayoutTimelinePreviewStore.getState().clear();

    expect(usePlacementStore.getState().placedItems).toBe(placedItemsBefore);
    expect(useEditorStore.getState().objects).toBe(editorObjectsBefore);
  });

  it("fails closed across editor history and placement mutation actions until exit", () => {
    useEditorStore.getState().reset();
    useEditorStore.getState().addObject(ITEM_ID, 0, 0, 0);
    const editorBefore = useEditorStore.getState().objects;
    const placedBefore = [item("saved-chair", 0)];
    usePlacementStore.setState({ placedItems: placedBefore });

    useLayoutTimelinePreviewStore.getState().showUnavailable(
      frame("missing"),
      "No frozen layout.",
    );
    useEditorStore.getState().addObject(ITEM_ID, 2, 0, 0);
    useEditorStore.getState().updateObject(editorBefore[0]?.id ?? "missing", { positionX: 4 });
    useEditorStore.getState().removeObject(editorBefore[0]?.id ?? "missing");
    useEditorStore.getState().undo();
    useEditorStore.getState().redo();
    usePlacementStore.getState().moveItem("saved-chair", 4, 0);
    usePlacementStore.getState().removeItem("saved-chair");
    usePlacementStore.getState().clearAll();

    expect(useEditorStore.getState().objects).toBe(editorBefore);
    expect(usePlacementStore.getState().placedItems).toBe(placedBefore);
    expect(useLayoutTimelinePreviewStore.getState().mode).toBe("unavailable");
  });
});
