import { describe, expect, it } from "vitest";
import {
  CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
  type CanonicalLayoutSnapshotV0,
  type EventPhaseGraph,
} from "@omnitwin/types";
import { boardRange } from "../../pages/diary/lib/board-time.js";
import {
  activeTimelineFrameIndexAtTime,
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
  timelineScopeAnchorDateAt,
  timelineDisplayRange,
  timelineFramesAllowSpatialMorph,
  wallClockPlaybackCursor,
} from "../room-layout-timeline-ui.js";

describe("room layout timeline UI model", () => {
  it("assigns 00:00–03:59 to the prior Day while Week keeps the civil date", () => {
    const earlyMonday = Date.parse("2026-07-20T01:00:00.000Z");
    expect(timelineScopeAnchorDateAt(earlyMonday, "day", "Europe/London")).toBe("2026-07-19");
    expect(timelineScopeAnchorDateAt(earlyMonday, "week", "Europe/London")).toBe("2026-07-20");
  });

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
      { keyframe: { state: "available", snapshotStatus: "frozen" } },
      { keyframe: { state: "invalid" } },
      { keyframe: { state: "available", snapshotStatus: "frozen" } },
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

  it("allows spatial morph only across an exact slice of canonical room-flip gaps", () => {
    const available = { kind: "phase", keyframe: { state: "available" } } as const;
    const roomFlip = {
      kind: "room_flip",
      keyframe: { state: "missing", reason: "room_flip_gap" },
    } as const;
    const missing = {
      kind: "phase",
      keyframe: { state: "missing", reason: "no_snapshot" },
    } as const;
    const invalid = {
      kind: "phase",
      keyframe: { state: "invalid", reason: "payload_schema_invalid" },
    } as const;

    expect(timelineFramesAllowSpatialMorph([available, available], 0, 1)).toBe(true);
    expect(timelineFramesAllowSpatialMorph([available, roomFlip, available], 0, 2)).toBe(true);
    expect(timelineFramesAllowSpatialMorph([available, roomFlip, roomFlip, available], 3, 0)).toBe(true);
    expect(timelineFramesAllowSpatialMorph([available, missing, available], 0, 2)).toBe(false);
    expect(timelineFramesAllowSpatialMorph([available, invalid, roomFlip, available], 0, 3)).toBe(false);
    expect(timelineFramesAllowSpatialMorph([available, available, available], 0, 2)).toBe(false);
  });

  it("holds real phases and only interpolates through an explicit room flip", () => {
    const frames = [
      {
        startsAt: "2026-07-18T16:00:00.000Z",
        endsAt: "2026-07-18T18:00:00.000Z",
        kind: "phase",
        keyframe: { state: "available" },
      },
      {
        startsAt: "2026-07-18T18:00:00.000Z",
        endsAt: "2026-07-18T20:00:00.000Z",
        kind: "room_flip",
        keyframe: { state: "missing", reason: "room_flip_gap" },
      },
      {
        startsAt: "2026-07-18T20:00:00.000Z",
        endsAt: "2026-07-18T22:00:00.000Z",
        kind: "phase",
        keyframe: { state: "available" },
      },
    ] as const;
    expect(availableFrameCursorAtTime(frames, [0, 2], Date.parse("2026-07-18T17:00:00.000Z"))).toBe(0);
    expect(availableFrameCursorAtTime(frames, [0, 2], Date.parse("2026-07-18T19:00:00.000Z"))).toBe(1);
    expect(availableFrameCursorAtTime(frames, [0, 2], Date.parse("2026-07-18T12:00:00.000Z"))).toBe(0);
    expect(availableFrameCursorAtTime(frames, [0, 2], Date.parse("2026-07-18T23:00:00.000Z"))).toBe(2);
  });

  it("fails closed inside a room flip when an exact-slice blocker is before or after it", () => {
    const available = { kind: "phase", keyframe: { state: "available" } } as const;
    const invalid = { kind: "phase", keyframe: { state: "invalid" } } as const;
    const missing = {
      kind: "phase",
      keyframe: { state: "missing", reason: "no_snapshot" },
    } as const;
    const flip = {
      kind: "room_flip",
      keyframe: { state: "missing", reason: "room_flip_gap" },
    } as const;
    const timed = (
      frame: typeof available | typeof invalid | typeof missing | typeof flip,
      startHour: number,
    ) => ({
      ...frame,
      startsAt: new Date(Date.parse("2026-07-18T16:00:00.000Z") + startHour * 3_600_000).toISOString(),
      endsAt: new Date(Date.parse("2026-07-18T17:00:00.000Z") + startHour * 3_600_000).toISOString(),
    });
    const blockerBefore = [
      timed(available, 0),
      timed(invalid, 1),
      timed(flip, 2),
      timed(available, 3),
    ];
    const blockerAfter = [
      timed(available, 0),
      timed(flip, 1),
      timed(missing, 2),
      timed(available, 3),
    ];

    expect(availableFrameCursorAtTime(
      blockerBefore,
      [0, 3],
      Date.parse("2026-07-18T18:30:00.000Z"),
    )).toBeNull();
    expect(availableFrameCursorAtTime(
      blockerAfter,
      [0, 3],
      Date.parse("2026-07-18T17:30:00.000Z"),
    )).toBeNull();
  });

  it("resolves overlaps by latest start with stable API-order ties", () => {
    const frames = [
      { id: "early", startsAt: "2026-07-18T16:00:00.000Z", endsAt: "2026-07-18T19:00:00.000Z" },
      { id: "later-first", startsAt: "2026-07-18T17:00:00.000Z", endsAt: "2026-07-18T18:00:00.000Z" },
      { id: "later-tie", startsAt: "2026-07-18T17:00:00.000Z", endsAt: "2026-07-18T18:30:00.000Z" },
    ];
    const overlap = Date.parse("2026-07-18T17:30:00.000Z");

    expect(activeTimelineFrameIndexAtTime(frames, overlap)).toBe(1);
    expect(availableFrameCursorAtTime(
      frames.map((frame, index) => ({
        ...frame,
        kind: "phase",
        keyframe: { state: index === 1 ? "invalid" : "available" },
      })),
      [0, 2],
      overlap,
    )).toBeNull();
  });

  it("returns to a still-active long phase after a nested later phase ends", () => {
    const frames = [
      {
        startsAt: "2026-07-18T16:00:00.000Z",
        endsAt: "2026-07-18T22:00:00.000Z",
        kind: "phase",
        keyframe: { state: "available" },
      },
      {
        startsAt: "2026-07-18T17:00:00.000Z",
        endsAt: "2026-07-18T18:00:00.000Z",
        kind: "phase",
        keyframe: { state: "available" },
      },
    ] as const;

    expect(activeTimelineFrameIndexAtTime(frames, Date.parse("2026-07-18T19:00:00.000Z"))).toBe(0);
    expect(availableFrameCursorAtTime(
      frames,
      [0, 1],
      Date.parse("2026-07-18T19:00:00.000Z"),
    )).toBe(0);
  });

  it("does not bridge through an invalid or unsnapshotted real phase", () => {
    const frames = [
      { startsAt: "2026-07-18T16:00:00.000Z", endsAt: "2026-07-18T18:00:00.000Z", kind: "phase", keyframe: { state: "available" } },
      { startsAt: "2026-07-18T18:00:00.000Z", endsAt: "2026-07-18T19:00:00.000Z", kind: "phase", keyframe: { state: "invalid" } },
      { startsAt: "2026-07-18T20:00:00.000Z", endsAt: "2026-07-18T22:00:00.000Z", kind: "phase", keyframe: { state: "available" } },
    ] as const;
    expect(availableFrameCursorAtTime(frames, [0, 2], Date.parse("2026-07-18T18:30:00.000Z"))).toBeNull();
    expect(availableFrameCursorAtTime(frames, [0, 2], Date.parse("2026-07-18T19:30:00.000Z"))).toBeNull();
  });

  it("anchors a linked event to its earliest timed phase", () => {
    const eventId = "11111111-1111-4111-8111-111111111111";
    const venueId = "22222222-2222-4222-8222-222222222222";
    const spaceId = "33333333-3333-4333-8333-333333333333";
    const graph = {
      event: { id: eventId, venueId, startsAt: "2026-07-18T14:00:00.000Z" },
      phases: [
        { eventId, spaceId, startsAt: "2026-07-18T18:00:00.000Z" },
        { eventId, spaceId, startsAt: "2026-07-18T16:00:00.000Z" },
        { eventId, spaceId, startsAt: null },
        {
          eventId,
          spaceId: "44444444-4444-4444-8444-444444444444",
          startsAt: "2026-07-18T12:00:00.000Z",
        },
      ],
    } as EventPhaseGraph;
    expect(linkedEventTimelineAnchorMs(graph, venueId, spaceId))
      .toBe(Date.parse("2026-07-18T16:00:00.000Z"));
    expect(linkedEventTimelineAnchorMs(
      graph,
      venueId,
      "55555555-5555-4555-8555-555555555555",
    )).toBe(Date.parse("2026-07-18T14:00:00.000Z"));
  });

  it("rejects linked-event anchors from a foreign venue or inconsistent phase graph", () => {
    const eventId = "11111111-1111-4111-8111-111111111111";
    const venueId = "22222222-2222-4222-8222-222222222222";
    const spaceId = "33333333-3333-4333-8333-333333333333";
    const graph = {
      event: { id: eventId, venueId, startsAt: "2026-07-18T14:00:00.000Z" },
      phases: [{
        eventId: "99999999-9999-4999-8999-999999999999",
        spaceId,
        startsAt: "2026-07-18T16:00:00.000Z",
      }],
    } as EventPhaseGraph;

    expect(linkedEventTimelineAnchorMs(
      { ...graph, phases: [] },
      "44444444-4444-4444-8444-444444444444",
      spaceId,
    )).toBeNull();
    expect(linkedEventTimelineAnchorMs(graph, venueId, spaceId)).toBeNull();
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
