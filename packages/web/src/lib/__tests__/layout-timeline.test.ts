import { describe, expect, it } from "vitest";
import {
  CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
} from "@omnitwin/types";
import type { PlacedItem } from "../placement.js";
import {
  buildTimelineItemTransitionPlan,
  interpolateTimelineItemTransitionPlan,
  interpolateTimelineItems,
  interpolateTimelineFrameItems,
  placedItemsFromCanonicalSnapshot,
  timelineSegment,
  timelineTransitionInterpolationOperationCount,
} from "../layout-timeline.js";

function placed(
  id: string,
  catalogueItemId: string,
  x: number,
  z: number,
  rotationY = 0,
): PlacedItem {
  return {
    id,
    catalogueItemId,
    label: "",
    x,
    y: 0,
    z,
    rotationY,
    clothed: false,
    clothStyle: null,
    tableSetting: null,
    groupId: null,
  };
}

describe("layout timeline model", () => {
  it("parses real canonical snapshot objects into read-only scene items", () => {
    const items = placedItemsFromCanonicalSnapshot(CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE);
    expect(items).not.toBeNull();
    expect(items?.length).toBe(CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.objects.length);
    expect(items?.map((item) => item.catalogueItemId).sort()).toEqual(
      CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.objects
        .map((object) => object.assetDefinition.assetDefinitionId)
        .sort(),
    );
    const firstStoredObject = CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.objects[0];
    expect(items?.find((item) => item.id === firstStoredObject?.objectId)?.scale).toBe(
      firstStoredObject?.scale,
    );
  });

  it("interpolates stable IDs and takes the shortest rotation path", () => {
    const from = [{ ...placed("stable", "chair", 0, 0, Math.PI * 1.9), scale: 0.5 }];
    const to = [{ ...placed("stable", "chair", 10, 4, Math.PI * 0.1), scale: 1.5 }];
    const halfway = interpolateTimelineItems(from, to, 0.5);
    expect(halfway[0]?.x).toBe(5);
    expect(halfway[0]?.z).toBe(2);
    expect(Math.abs((halfway[0]?.rotationY ?? 0) - Math.PI * 2)).toBeLessThan(0.000001);
    expect(halfway[0]?.scale).toBe(1);
    expect(interpolateTimelineItems(from, to, 0)[0]?.scale).toBe(0.5);
    expect(interpolateTimelineItems(from, to, 1)[0]?.scale).toBe(1.5);
  });

  it("matches changed IDs by nearest same-SKU position", () => {
    const from = [placed("from-a", "chair", 0, 0), placed("from-b", "chair", 10, 0)];
    const to = [placed("to-b", "chair", 12, 0), placed("to-a", "chair", 2, 0)];
    const halfway = interpolateTimelineItems(from, to, 0.5);
    expect(halfway.map((item) => item.x)).toEqual([1, 11]);
  });

  it("keeps precomputed-plan samples equivalent to the compatibility interpolator", () => {
    const from = [
      placed("stable", "chair", 0, 0),
      placed("old-near", "chair", 10, 0),
      placed("removed", "table", 3, 3),
    ];
    const to = [
      placed("stable", "chair", 4, 0),
      placed("new-near", "chair", 12, 0),
      placed("added", "bar", 5, 5),
    ];
    const plan = buildTimelineItemTransitionPlan(from, to);

    for (const progress of [0, 0.2, 0.49, 0.5, 0.8, 1]) {
      expect(interpolateTimelineItemTransitionPlan(plan, progress)).toEqual(
        interpolateTimelineItems(from, to, progress),
      );
    }
  });

  it("samples a 500-object precomputed plan 120 times with linear bounded work", () => {
    const from = Array.from({ length: 500 }, (_, index) => (
      placed(`from-${String(index)}`, "chair", index * 2, 0)
    ));
    const to = Array.from({ length: 500 }, (_, index) => (
      placed(`to-${String(index)}`, "chair", index * 2 + 1, 0)
    ));
    const plan = buildTimelineItemTransitionPlan(from, to);
    const searchComparisonsPaidOnce = plan.pairSearchComparisons;
    let sampleOperations = 0;

    for (let sample = 0; sample < 120; sample += 1) {
      const progress = sample / 119;
      sampleOperations += timelineTransitionInterpolationOperationCount(plan, progress);
      expect(interpolateTimelineItemTransitionPlan(plan, progress)).toHaveLength(500);
    }

    expect(plan.pairs).toHaveLength(500);
    expect(plan.pairSearchComparisons).toBe(searchComparisonsPaidOnce);
    expect(searchComparisonsPaidOnce).toBeLessThanOrEqual(500 * 500);
    expect(sampleOperations).toBeLessThanOrEqual(120 * 500);
  });

  it("strikes and materializes unmatched objects at the midpoint", () => {
    const before = interpolateTimelineItems(
      [placed("old", "table", 0, 0)],
      [placed("new", "bar", 4, 0)],
      0.49,
    );
    const after = interpolateTimelineItems(
      [placed("old", "table", 0, 0)],
      [placed("new", "bar", 4, 0)],
      0.5,
    );
    expect(before.map((item) => item.id)).toEqual(["old"]);
    expect(after.map((item) => item.id)).toEqual(["new"]);
  });

  it("never glides corresponding SKUs across event boundaries", () => {
    const from = [placed("from", "chair", 0, 0)];
    const to = [placed("to", "chair", 10, 0)];
    expect(interpolateTimelineFrameItems({
      fromEventId: "event-a",
      toEventId: "event-b",
      fromItems: from,
      toItems: to,
      progress: 0.49,
    })).toBe(from);
    expect(interpolateTimelineFrameItems({
      fromEventId: "event-a",
      toEventId: "event-b",
      fromItems: from,
      toItems: to,
      progress: 0.5,
    })).toBe(to);
  });

  it("uses a complete keyframe swap when reduced motion is requested", () => {
    const from = [placed("stable", "chair", 0, 0)];
    const to = [placed("stable", "chair", 10, 0)];
    const result = interpolateTimelineFrameItems({
      fromEventId: "event-a",
      toEventId: "event-a",
      fromItems: from,
      toItems: to,
      progress: 0.75,
      reducedMotion: true,
    });
    expect(result).toBe(to);
  });

  it("clamps timeline cursors to valid adjacent segments", () => {
    expect(timelineSegment(-10, 4)).toEqual({ fromIndex: 0, toIndex: 0, progress: 0 });
    expect(timelineSegment(1.25, 4)).toEqual({ fromIndex: 1, toIndex: 2, progress: 0.25 });
    expect(timelineSegment(99, 4)).toEqual({ fromIndex: 3, toIndex: 3, progress: 0 });
  });
});
