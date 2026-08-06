import { describe, expect, it } from "vitest";
import {
  CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
  FreezePhaseLayoutSnapshotBodySchema,
  FreezePhaseLayoutSnapshotParamsSchema,
  FreezePhaseLayoutSnapshotResponseSchema,
  RoomLayoutTimelineQuerySchema,
  RoomLayoutTimelineResponseSchema,
} from "../index.js";

const VENUE_ID = "11111111-1111-4111-8111-111111111111";
const SPACE_ID = "33333333-3333-4333-8333-333333333333";
const EVENT_ID = "55555555-5555-4555-8555-555555555555";
const PHASE_ID = "66666666-6666-4666-8666-666666666666";
const SNAPSHOT_ID = "77777777-7777-4777-8777-777777777777";
const CONFIGURATION_ID = CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.configurationId;

describe("RoomLayoutTimelineQuerySchema", () => {
  it("accepts a DST-safe week range within the eight-day ceiling", () => {
    expect(RoomLayoutTimelineQuerySchema.safeParse({
      venueId: VENUE_ID,
      spaceId: SPACE_ID,
      from: "2026-10-25T00:00:00.000Z",
      to: "2026-11-01T01:00:00.000Z",
    }).success).toBe(true);
  });

  it("rejects inverted and longer-than-eight-day ranges", () => {
    expect(RoomLayoutTimelineQuerySchema.safeParse({
      venueId: VENUE_ID,
      spaceId: SPACE_ID,
      from: "2026-11-01T00:00:00.000Z",
      to: "2026-10-31T00:00:00.000Z",
    }).success).toBe(false);
    expect(RoomLayoutTimelineQuerySchema.safeParse({
      venueId: VENUE_ID,
      spaceId: SPACE_ID,
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-09T00:00:00.001Z",
    }).success).toBe(false);
  });
});

describe("RoomLayoutTimelineResponseSchema", () => {
  const baseFrame = {
    id: PHASE_ID,
    kind: "phase" as const,
    eventId: EVENT_ID,
    eventName: "Wedding dinner",
    eventType: "wedding",
    eventStatus: "confirmed" as const,
    eventGuestCount: 180,
    phaseId: PHASE_ID,
    phaseName: "Dinner service",
    templateKey: "dinner" as const,
    sortOrder: 2,
    startsAt: "2026-10-25T18:00:00.000Z",
    endsAt: "2026-10-25T20:00:00.000Z",
    guestCount: 180,
    opsTasksCount: 2,
    reviewGatesCount: 1,
    densityStatus: "not_checked" as const,
    densityLabel: "Density not checked",
    staffConflictsStatus: "not_checked" as const,
    staffConflictsLabel: "Staff conflicts not checked",
  };

  it("accepts an available keyframe carrying an immutable canonical payload", () => {
    const parsed = RoomLayoutTimelineResponseSchema.parse({
      venueId: VENUE_ID,
      spaceId: SPACE_ID,
      from: "2026-10-25T00:00:00.000Z",
      to: "2026-10-26T00:00:00.000Z",
      frames: [{
        ...baseFrame,
        keyframe: {
          state: "available",
          snapshotId: SNAPSHOT_ID,
          snapshotStatus: "frozen",
          createdAt: "2026-10-24T12:00:00.000Z",
          frozenAt: "2026-10-24T12:05:00.000Z",
          objectCount: CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.objects.length,
          guestCount: 180,
          payload: CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
        },
      }],
    });

    expect(parsed.frames[0]?.keyframe.state).toBe("available");
  });

  it("rejects fabricated fields on missing keyframes", () => {
    expect(RoomLayoutTimelineResponseSchema.safeParse({
      venueId: VENUE_ID,
      spaceId: SPACE_ID,
      from: "2026-10-25T00:00:00.000Z",
      to: "2026-10-26T00:00:00.000Z",
      frames: [{
        ...baseFrame,
        keyframe: {
          state: "missing",
          reason: "no_snapshot",
          message: "No saved layout for this phase.",
          payload: CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
        },
      }],
    }).success).toBe(false);
  });
});

describe("phase layout freeze contract", () => {
  it("accepts identity-only input and a proof-linked frozen response", () => {
    expect(FreezePhaseLayoutSnapshotParamsSchema.parse({ eventId: EVENT_ID, phaseId: PHASE_ID }))
      .toEqual({ eventId: EVENT_ID, phaseId: PHASE_ID });
    expect(FreezePhaseLayoutSnapshotBodySchema.parse({ configurationId: CONFIGURATION_ID }))
      .toEqual({ configurationId: CONFIGURATION_ID });

    const response = FreezePhaseLayoutSnapshotResponseSchema.parse({
      outcome: "created",
      eventId: EVENT_ID,
      phaseId: PHASE_ID,
      configurationId: CONFIGURATION_ID,
      snapshotId: SNAPSHOT_ID,
      canonicalSnapshotId: "88888888-8888-4888-8888-888888888888",
      snapshotHash: "a".repeat(64),
      proofDigest: "b".repeat(64),
      frozenBy: "99999999-9999-4999-8999-999999999999",
      status: "frozen",
      coordinateSpace: "real_m_v1",
      objectCount: 12,
      guestCount: 180,
      createdAt: "2026-10-24T12:05:00.000Z",
      frozenAt: "2026-10-24T12:05:00.000Z",
      supersedesSnapshotId: null,
    });
    expect(response.status).toBe("frozen");
  });

  it("rejects browser geometry, unsupported coordinates, and mutable lifecycle states", () => {
    expect(FreezePhaseLayoutSnapshotBodySchema.safeParse({
      configurationId: CONFIGURATION_ID,
      objects: [],
    }).success).toBe(false);
    expect(FreezePhaseLayoutSnapshotResponseSchema.safeParse({
      outcome: "created",
      eventId: EVENT_ID,
      phaseId: PHASE_ID,
      configurationId: CONFIGURATION_ID,
      snapshotId: SNAPSHOT_ID,
      canonicalSnapshotId: "88888888-8888-4888-8888-888888888888",
      snapshotHash: "a".repeat(64),
      proofDigest: "b".repeat(64),
      frozenBy: "99999999-9999-4999-8999-999999999999",
      status: "draft",
      coordinateSpace: "legacy_render_v0",
      objectCount: 12,
      guestCount: 180,
      createdAt: "2026-10-24T12:05:00.000Z",
      frozenAt: "2026-10-24T12:05:00.000Z",
      supersedesSnapshotId: null,
    }).success).toBe(false);
  });
});
