import { describe, expect, it } from "vitest";
import {
  CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
  type CanonicalLayoutSnapshotV0,
  type EventPhaseGraph,
} from "@omnitwin/types";
import { boardRange } from "../../pages/diary/lib/board-time.js";
import {
  adjacentAvailableFrameIndex,
  availableFrameCursorAtTime,
  availableFrameIndices,
  availableFrameSegment,
  layoutMetricsFromSnapshot,
  layoutTimelineTicks,
  linkedEventTimelineAnchorMs,
  operationalDayRange,
  shiftOperationalDayRange,
  timelinePhaseBlocks,
  timelineDisplayRange,
  wallClockPlaybackCursor,
} from "../room-layout-timeline-ui.js";

describe("room layout timeline UI model", () => {
  it("derives every metric from the immutable canonical object payload", () => {
    const sourceObject = CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.objects[0];
    if (sourceObject === undefined) throw new Error("Canonical fixture must contain a source object");
    const snapshot: CanonicalLayoutSnapshotV0 = {
      ...CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
      objects: [
        ...CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.objects,
        {
          ...sourceObject,
          objectId: "99999999-9999-4999-8999-999999999999",
          assetDefinition: {
            ...sourceObject.assetDefinition,
            assetDefinitionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            category: "stage",
            seatCount: null,
          },
          metadata: null,
        },
        {
          ...sourceObject,
          objectId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          assetDefinition: {
            ...sourceObject.assetDefinition,
            assetDefinitionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            category: "other",
            seatCount: null,
          },
          metadata: { catalogueSlug: "bar-counter" },
        },
      ],
    };

    expect(layoutMetricsFromSnapshot(snapshot)).toEqual({
      guests: 120,
      objects: 4,
      tables: 1,
      seats: 1,
      stages: 1,
      bars: 1,
    });
  });

  it("does not claim a zero bar count when the canonical payload has no bar identity witness", () => {
    expect(layoutMetricsFromSnapshot(CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE).bars).toBeNull();
  });

  it("uses actual venue-local day boundaries in a DST week", () => {
    const range = boardRange(Date.parse("2026-03-29T12:00:00.000Z"), "week");
    const ticks = layoutTimelineTicks(range, "week");

    expect(ticks).toHaveLength(8);
    expect(ticks[0]?.positionPercent).toBe(0);
    expect(ticks.at(-1)?.positionPercent).toBe(100);
    expect(ticks.map((tick) => tick.label)).toEqual([
      "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Mon",
    ]);
  });

  it("navigates only keyframes backed by available canonical payloads", () => {
    const frames = [
      { keyframe: { state: "missing" } },
      { keyframe: { state: "available" } },
      { keyframe: { state: "invalid" } },
      { keyframe: { state: "available" } },
    ] as const;
    const indices = availableFrameIndices(frames);

    expect(indices).toEqual([1, 3]);
    expect(adjacentAvailableFrameIndex(indices, 1, 1)).toBe(3);
    expect(adjacentAvailableFrameIndex(indices, 3, -1)).toBe(1);
    expect(adjacentAvailableFrameIndex(indices, 3, 1)).toBeNull();
  });

  it("bridges a raw scrub cursor over missing and room-flip cards", () => {
    expect(availableFrameSegment([0, 3, 5], 1.5)).toEqual({
      fromIndex: 0,
      toIndex: 3,
      progress: 0.5,
    });
    expect(availableFrameSegment([0, 3, 5], 4)).toEqual({
      fromIndex: 3,
      toIndex: 5,
      progress: 0.5,
    });
    expect(availableFrameSegment([3], 0)).toEqual({ fromIndex: 3, toIndex: 3, progress: 0 });
    expect(availableFrameSegment([], 1)).toBeNull();
  });

  it("maps the wall-clock ruler into the same ordinal cursor used by layout interpolation", () => {
    const frames = [
      { startsAt: "2026-07-18T16:00:00.000Z" },
      { startsAt: "2026-07-18T17:00:00.000Z" },
      { startsAt: "2026-07-18T20:00:00.000Z" },
    ];
    expect(availableFrameCursorAtTime(frames, [0, 2], Date.parse("2026-07-18T18:00:00.000Z"))).toBe(1);
    expect(availableFrameCursorAtTime(frames, [0, 2], Date.parse("2026-07-18T12:00:00.000Z"))).toBe(0);
    expect(availableFrameCursorAtTime(frames, [0, 2], Date.parse("2026-07-18T23:00:00.000Z"))).toBe(2);
  });

  it("anchors a linked event to its earliest timed phase", () => {
    const graph = {
      event: { startsAt: "2026-07-18T14:00:00.000Z" },
      phases: [
        { startsAt: "2026-07-18T18:00:00.000Z" },
        { startsAt: "2026-07-18T16:00:00.000Z" },
        { startsAt: null },
      ],
    } as EventPhaseGraph;
    expect(linkedEventTimelineAnchorMs(graph)).toBe(Date.parse("2026-07-18T16:00:00.000Z"));
  });

  it("positions phases against the real range and assigns overlap lanes", () => {
    const fromMs = Date.parse("2026-07-18T00:00:00.000Z");
    const toMs = Date.parse("2026-07-19T00:00:00.000Z");
    const blocks = timelinePhaseBlocks([
      { startsAt: "2026-07-17T23:00:00.000Z", endsAt: "2026-07-18T02:00:00.000Z" },
      { startsAt: "2026-07-18T17:00:00.000Z", endsAt: "2026-07-18T19:00:00.000Z" },
      { startsAt: "2026-07-18T18:00:00.000Z", endsAt: "2026-07-18T20:00:00.000Z" },
    ], fromMs, toMs);

    expect(blocks[0]).toMatchObject({ leftPercent: 0, clippedStart: true });
    expect(blocks[1]?.leftPercent).toBeCloseTo(70.833, 2);
    expect(blocks[1]?.widthPercent).toBeCloseTo(8.333, 2);
    expect(blocks[1]?.lane).not.toBe(blocks[2]?.lane);
    expect(blocks[1]?.laneCount).toBe(2);
  });

  it("weights full-range playback by real keyframe times rather than ordinal gaps", () => {
    const frames = [
      { startsAt: "2026-07-18T16:00:00.000Z" },
      { startsAt: "2026-07-18T17:00:00.000Z" },
      { startsAt: "2026-07-18T20:00:00.000Z" },
    ];
    const halfway = wallClockPlaybackCursor(frames, [0, 1, 2], 10_000, 20_000);
    expect(halfway?.atMs).toBe(Date.parse("2026-07-18T18:00:00.000Z"));
    expect(halfway?.cursor).toBeCloseTo(4 / 3, 5);
  });

  it("frames a day around its event envelope while preserving a full-day query", () => {
    const queryRange = boardRange(Date.parse("2026-07-18T12:00:00.000Z"), "day");
    const display = timelineDisplayRange(queryRange, [{
      startsAt: "2026-07-18T16:00:00.000Z",
      endsAt: "2026-07-19T00:30:00.000Z",
    }], "day");

    expect(display.fromMs).toBe(Date.parse("2026-07-18T15:00:00.000Z"));
    expect(display.toMs).toBe(Date.parse("2026-07-19T00:30:00.000Z"));
    expect(queryRange.toMs - queryRange.fromMs).toBe(24 * 60 * 60 * 1_000);
  });

  it("gives short day events at least an eight-hour display and leaves week view unchanged", () => {
    const queryRange = boardRange(Date.parse("2026-07-18T12:00:00.000Z"), "day");
    const frames = [{
      startsAt: "2026-07-18T16:00:00.000Z",
      endsAt: "2026-07-18T17:00:00.000Z",
    }];
    const dayDisplay = timelineDisplayRange(queryRange, frames, "day");
    expect(dayDisplay.toMs - dayDisplay.fromMs).toBe(8 * 60 * 60 * 1_000);
    expect(timelineDisplayRange(queryRange, frames, "week")).toBe(queryRange);
  });

  it("can run the 20-second playback across the padded display window", () => {
    const frames = [
      { startsAt: "2026-07-18T16:00:00.000Z" },
      { startsAt: "2026-07-18T20:00:00.000Z" },
    ];
    const display = {
      fromMs: Date.parse("2026-07-18T15:00:00.000Z"),
      toMs: Date.parse("2026-07-18T22:00:00.000Z"),
    };
    const halfway = wallClockPlaybackCursor(frames, [0, 1], 10_000, 20_000, display);
    expect(halfway?.atMs).toBe(Date.parse("2026-07-18T18:30:00.000Z"));
    expect(halfway?.cursor).toBeCloseTo(0.625, 5);
  });

  it("owns 00:00–03:59 phases by the preceding 04:00 event day", () => {
    const range = operationalDayRange(Date.parse("2026-07-15T01:00:00.000Z"));
    expect(range.fromMs).toBe(Date.parse("2026-07-14T03:00:00.000Z"));
    expect(range.toMs).toBe(Date.parse("2026-07-15T03:00:00.000Z"));
  });

  it("keeps 04:00 event-day boundaries DST-safe at 23 and 25 elapsed hours", () => {
    const spring = operationalDayRange(Date.parse("2026-03-28T12:00:00.000Z"));
    const autumn = operationalDayRange(Date.parse("2026-10-24T12:00:00.000Z"));
    expect(spring.toMs - spring.fromMs).toBe(23 * 60 * 60 * 1_000);
    expect(autumn.toMs - autumn.fromMs).toBe(25 * 60 * 60 * 1_000);
  });

  it("moves to adjacent operational days and back on an ordinary date", () => {
    const current = operationalDayRange(Date.parse("2026-07-18T12:00:00.000Z"));
    const next = shiftOperationalDayRange(current, 1);

    expect(next.fromMs).toBe(Date.parse("2026-07-19T03:00:00.000Z"));
    expect(next.toMs).toBe(Date.parse("2026-07-20T03:00:00.000Z"));
    expect(shiftOperationalDayRange(next, -1)).toEqual(current);
  });

  it("moves across both DST boundaries without skipping or repeating an event day", () => {
    const spring = operationalDayRange(Date.parse("2026-03-28T12:00:00.000Z"));
    const springNext = shiftOperationalDayRange(spring, 1);
    const autumn = operationalDayRange(Date.parse("2026-10-24T12:00:00.000Z"));
    const autumnNext = shiftOperationalDayRange(autumn, 1);

    expect(springNext.fromMs).toBe(spring.toMs);
    expect(springNext.toMs - springNext.fromMs).toBe(24 * 60 * 60 * 1_000);
    expect(shiftOperationalDayRange(springNext, -1)).toEqual(spring);
    expect(autumnNext.fromMs).toBe(autumn.toMs);
    expect(autumnNext.toMs - autumnNext.fromMs).toBe(24 * 60 * 60 * 1_000);
    expect(shiftOperationalDayRange(autumnNext, -1)).toEqual(autumn);
  });

  it("keeps after-midnight Breakdown on the prior event day without next-day duplication", () => {
    const frames = [
      { startsAt: "2026-07-14T20:45:00.000Z", endsAt: "2026-07-14T23:30:00.000Z" },
      { startsAt: "2026-07-14T23:30:00.000Z", endsAt: "2026-07-15T01:00:00.000Z" },
    ];
    const priorDay = operationalDayRange(Date.parse("2026-07-14T12:00:00.000Z"));
    const nextDay = operationalDayRange(Date.parse("2026-07-15T12:00:00.000Z"));
    expect(timelinePhaseBlocks(frames, priorDay.fromMs, priorDay.toMs)).toHaveLength(2);
    expect(timelinePhaseBlocks(frames, nextDay.fromMs, nextDay.toMs)).toHaveLength(0);
  });
});
