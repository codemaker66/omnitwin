import { describe, expect, it } from "vitest";
import {
  CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
  FreezePhaseLayoutSnapshotBodySchema,
  FreezePhaseLayoutSnapshotParamsSchema,
  FreezePhaseLayoutSnapshotResponseSchema,
  historicalRuntimeFromBinding,
  RoomLayoutTimelineQuerySchema,
  RoomLayoutTimelineResponseSchema,
} from "../index.js";

const VENUE_ID = CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.venueId;
const SPACE_ID = CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.spaceId;
const EVENT_ID = "55555555-5555-4555-8555-555555555555";
const PHASE_ID = "66666666-6666-4666-8666-666666666666";
const SNAPSHOT_ID = "77777777-7777-4777-8777-777777777777";
const CONFIGURATION_ID = CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.configurationId;

describe("RoomLayoutTimelineQuerySchema", () => {
  it("accepts an explicit DST-safe week range within the eight-day ceiling", () => {
    expect(RoomLayoutTimelineQuerySchema.safeParse({
      venueId: VENUE_ID,
      spaceId: SPACE_ID,
      from: "2026-10-25T00:00:00.000Z",
      to: "2026-11-01T01:00:00.000Z",
    }).success).toBe(true);
  });

  it("accepts complete day and week venue-local requests", () => {
    for (const scope of ["day", "week"] as const) {
      expect(RoomLayoutTimelineQuerySchema.safeParse({
        venueId: VENUE_ID,
        spaceId: SPACE_ID,
        scope,
        anchorDate: "2026-10-25",
      }).success).toBe(true);
    }
  });

  it("rejects partial, mixed, and impossible venue-local requests", () => {
    expect(RoomLayoutTimelineQuerySchema.safeParse({
      venueId: VENUE_ID,
      spaceId: SPACE_ID,
      scope: "day",
    }).success).toBe(false);
    expect(RoomLayoutTimelineQuerySchema.safeParse({
      venueId: VENUE_ID,
      spaceId: SPACE_ID,
      scope: "day",
      anchorDate: "2026-02-30",
      from: "2026-02-28T00:00:00.000Z",
      to: "2026-03-01T00:00:00.000Z",
    }).success).toBe(false);
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
  const baseResponse = {
    venueId: VENUE_ID,
    spaceId: SPACE_ID,
    timeZone: "Europe/London",
    from: "2026-10-25T00:00:00.000Z",
    to: "2026-10-26T00:00:00.000Z",
    range: {
      scope: "day" as const,
      anchorDate: "2026-10-25",
      from: "2026-10-25T00:00:00.000Z",
      to: "2026-10-26T00:00:00.000Z",
    },
  };
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
    figures: {
      guests: {
        value: CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.guestCount,
        source: "frozen_snapshot" as const,
      },
      seatedCapacity: {
        state: "available" as const,
        value: 1,
        source: "frozen_snapshot" as const,
        basis: "chair_objects" as const,
      },
      staffing: {
        state: "not_checked" as const,
        value: null,
        source: "phase_staff_conflicts" as const,
        staffConflictsStatus: "not_checked" as const,
        staffConflictsLabel: "Staff conflicts not checked",
      },
      revenue: {
        state: "unavailable" as const,
        reason: "no_matching_planning_scenario" as const,
      },
    },
  };
  const availableKeyframe = {
    state: "available" as const,
    snapshotId: SNAPSHOT_ID,
    snapshotStatus: "frozen" as const,
    canonicalSnapshotId: "88888888-8888-4888-8888-888888888888",
    proofDigest: "b".repeat(64),
    frozenBy: "99999999-9999-4999-8999-999999999999",
    supersedesSnapshotId: null,
    createdAt: "2026-10-24T12:00:00.000Z",
    frozenAt: "2026-10-24T12:05:00.000Z",
    objectCount: CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.objects.length,
    guestCount: CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.guestCount,
    payload: CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
    historicalRuntime: historicalRuntimeFromBinding(null),
  };
  const missingKeyframe = {
    state: "missing" as const,
    reason: "no_snapshot" as const,
    message: "No saved layout for this phase.",
  };
  const missingFigures = {
    guests: { value: baseFrame.guestCount, source: "phase" as const },
    seatedCapacity: {
      state: "unavailable" as const,
      reason: "no_valid_frozen_keyframe" as const,
    },
    staffing: baseFrame.figures.staffing,
    revenue: {
      state: "unavailable" as const,
      reason: "no_valid_frozen_keyframe" as const,
    },
  };

  function availableResponse() {
    return {
      ...baseResponse,
      frames: [{ ...baseFrame, keyframe: availableKeyframe }],
    };
  }

  function acceptsFrame(frame: unknown): boolean {
    return RoomLayoutTimelineResponseSchema.safeParse({
      ...baseResponse,
      frames: [frame],
    }).success;
  }

  it("accepts an available keyframe carrying an immutable canonical payload", () => {
    const parsed = RoomLayoutTimelineResponseSchema.parse(availableResponse());

    expect(parsed.frames[0]?.keyframe.state).toBe("available");
  });

  it("rejects mismatched frame and phase identities", () => {
    const response = availableResponse();
    expect(RoomLayoutTimelineResponseSchema.safeParse({
      ...response,
      frames: [{
        ...response.frames[0],
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }],
    }).success).toBe(false);
  });

  it("rejects available payloads from another venue or room", () => {
    const response = availableResponse();
    for (const payload of [
      {
        ...availableKeyframe.payload,
        venueId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
      {
        ...availableKeyframe.payload,
        spaceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      },
      {
        ...availableKeyframe.payload,
        venueRuntime: {
          ...availableKeyframe.payload.venueRuntime,
          spaceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        },
      },
    ]) {
      expect(RoomLayoutTimelineResponseSchema.safeParse({
        ...response,
        frames: [{
          ...response.frames[0],
          keyframe: { ...availableKeyframe, payload },
        }],
      }).success).toBe(false);
    }
  });

  it("requires exact bidirectional room-flip kind, template, and gap identity", () => {
    const response = availableResponse();
    expect(acceptsFrame({
      ...response.frames[0],
      kind: "room_flip",
      keyframe: {
        state: "missing",
        reason: "room_flip_gap",
        message: "Room flip transition gap.",
      },
      figures: missingFigures,
    })).toBe(false);
    expect(acceptsFrame({
      ...response.frames[0],
      templateKey: "room-flip",
    })).toBe(false);
    expect(acceptsFrame({
      ...response.frames[0],
      keyframe: {
        state: "missing",
        reason: "room_flip_gap",
        message: "Room flip transition gap.",
      },
      figures: missingFigures,
    })).toBe(false);
    expect(acceptsFrame({
      ...response.frames[0],
      kind: "room_flip",
      templateKey: "room-flip",
      keyframe: {
        state: "missing",
        reason: "room_flip_gap",
        message: "Room flip transition gap.",
      },
      figures: missingFigures,
    })).toBe(true);
  });

  it("keeps guest figures coherent with frozen, phase, and event sources", () => {
    const response = availableResponse();
    expect(acceptsFrame({
      ...response.frames[0],
      figures: {
        ...response.frames[0]?.figures,
        guests: { value: availableKeyframe.payload.guestCount, source: "phase" },
      },
    })).toBe(false);

    const missingFrame = {
      ...baseFrame,
      keyframe: missingKeyframe,
      figures: missingFigures,
    };
    expect(acceptsFrame(missingFrame)).toBe(true);
    expect(acceptsFrame({
      ...missingFrame,
      figures: {
        ...missingFigures,
        guests: { value: baseFrame.eventGuestCount, source: "event" },
      },
    })).toBe(false);
    expect(acceptsFrame({
      ...missingFrame,
      guestCount: null,
      figures: {
        ...missingFigures,
        guests: { value: baseFrame.eventGuestCount, source: "event" },
      },
    })).toBe(true);
  });

  it("derives capacity from complete chair-first or table seating evidence", () => {
    const response = availableResponse();
    expect(acceptsFrame({
      ...response.frames[0],
      figures: {
        ...response.frames[0]?.figures,
        seatedCapacity: {
          state: "available",
          value: 10,
          source: "frozen_snapshot",
          basis: "table_seat_counts",
        },
      },
    })).toBe(false);

    const tableFallbackPayload = {
      ...availableKeyframe.payload,
      objects: availableKeyframe.payload.objects.map((object) => (
        object.assetDefinition.category === "chair"
          ? {
              ...object,
              assetDefinition: { ...object.assetDefinition, seatCount: null },
            }
          : object
      )),
    };
    expect(acceptsFrame({
      ...response.frames[0],
      keyframe: { ...availableKeyframe, payload: tableFallbackPayload },
      figures: {
        ...response.frames[0]?.figures,
        seatedCapacity: {
          state: "available",
          value: 10,
          source: "frozen_snapshot",
          basis: "table_seat_counts",
        },
      },
    })).toBe(true);

    const incompletePayload = {
      ...tableFallbackPayload,
      objects: tableFallbackPayload.objects.map((object) => ({
        ...object,
        assetDefinition: { ...object.assetDefinition, seatCount: null },
      })),
    };
    expect(acceptsFrame({
      ...response.frames[0],
      keyframe: { ...availableKeyframe, payload: incompletePayload },
      figures: {
        ...response.frames[0]?.figures,
        seatedCapacity: {
          state: "unavailable",
          reason: "capacity_evidence_incomplete",
        },
      },
    })).toBe(true);
    expect(acceptsFrame({
      ...baseFrame,
      keyframe: missingKeyframe,
      figures: {
        ...missingFigures,
        seatedCapacity: baseFrame.figures.seatedCapacity,
      },
    })).toBe(false);
  });

  it("keeps revenue guest counts and keyframe availability coherent", () => {
    const response = availableResponse();
    const availableRevenue = {
      state: "available" as const,
      source: "planning_scenario" as const,
      scenario: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Dinner planning estimate",
        status: "active" as const,
        scenarioKind: "layout_based" as const,
        currency: "GBP" as const,
        plannedGuestCount: availableKeyframe.payload.guestCount,
        estimatedRevenueMinor: 2_875_000,
        comfortStatus: "not_checked" as const,
        reviewGateCount: 1,
        updatedAt: "2026-10-24T13:00:00.000Z",
      },
      disclosure: "Planning scenario estimate; not a quote or approval." as const,
    };
    expect(acceptsFrame({
      ...response.frames[0],
      figures: { ...response.frames[0]?.figures, revenue: availableRevenue },
    })).toBe(true);
    expect(acceptsFrame({
      ...response.frames[0],
      figures: {
        ...response.frames[0]?.figures,
        revenue: {
          ...availableRevenue,
          scenario: {
            ...availableRevenue.scenario,
            plannedGuestCount: availableRevenue.scenario.plannedGuestCount + 1,
          },
        },
      },
    })).toBe(false);
    expect(acceptsFrame({
      ...baseFrame,
      keyframe: missingKeyframe,
      figures: { ...missingFigures, revenue: availableRevenue },
    })).toBe(false);
    expect(acceptsFrame({
      ...response.frames[0],
      figures: {
        ...response.frames[0]?.figures,
        revenue: { state: "unavailable", reason: "no_valid_frozen_keyframe" },
      },
    })).toBe(false);
  });

  it("requires duplicated staffing evidence to match the frame", () => {
    const response = availableResponse();
    expect(acceptsFrame({
      ...response.frames[0],
      figures: {
        ...response.frames[0]?.figures,
        staffing: {
          ...baseFrame.figures.staffing,
          staffConflictsLabel: "Different evidence label",
        },
      },
    })).toBe(false);
    expect(acceptsFrame({
      ...response.frames[0],
      staffConflictsStatus: "current",
      figures: {
        ...response.frames[0]?.figures,
        staffing: baseFrame.figures.staffing,
      },
    })).toBe(false);
  });

  it("requires unique frames ordered by startsAt and then id", () => {
    const response = availableResponse();
    const first = response.frames[0];
    const earlierId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const laterId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const withIdentity = (id: string, startsAt: string, endsAt: string) => ({
      ...first,
      id,
      phaseId: id,
      startsAt,
      endsAt,
    });

    expect(RoomLayoutTimelineResponseSchema.safeParse({
      ...response,
      frames: [first, first],
    }).success).toBe(false);
    expect(RoomLayoutTimelineResponseSchema.safeParse({
      ...response,
      frames: [
        withIdentity(earlierId, "2026-10-25T20:00:00.000Z", "2026-10-25T21:00:00.000Z"),
        withIdentity(laterId, "2026-10-25T18:00:00.000Z", "2026-10-25T19:00:00.000Z"),
      ],
    }).success).toBe(false);
    expect(RoomLayoutTimelineResponseSchema.safeParse({
      ...response,
      frames: [
        withIdentity(laterId, "2026-10-25T18:00:00.000Z", "2026-10-25T19:00:00.000Z"),
        withIdentity(earlierId, "2026-10-25T18:00:00.000Z", "2026-10-25T19:00:00.000Z"),
      ],
    }).success).toBe(false);
    expect(RoomLayoutTimelineResponseSchema.safeParse({
      ...response,
      frames: [
        withIdentity(earlierId, "2026-10-25T18:00:00.000Z", "2026-10-25T19:00:00.000Z"),
        withIdentity(laterId, "2026-10-25T18:00:00.000Z", "2026-10-25T19:00:00.000Z"),
      ],
    }).success).toBe(true);
  });

  it("requires ordered frame times that overlap the authoritative range", () => {
    const response = availableResponse();
    for (const frame of [
      { ...response.frames[0], endsAt: response.frames[0]?.startsAt },
      {
        ...response.frames[0],
        startsAt: "2026-10-26T00:00:00.000Z",
        endsAt: "2026-10-26T01:00:00.000Z",
      },
      {
        ...response.frames[0],
        startsAt: "2026-10-24T22:00:00.000Z",
        endsAt: "2026-10-25T00:00:00.000Z",
      },
    ]) {
      expect(RoomLayoutTimelineResponseSchema.safeParse({
        ...response,
        frames: [frame],
      }).success).toBe(false);
    }
  });

  it("requires available snapshot counts to match the canonical payload", () => {
    const response = availableResponse();
    for (const keyframe of [
      { ...availableKeyframe, objectCount: availableKeyframe.objectCount + 1 },
      { ...availableKeyframe, guestCount: availableKeyframe.guestCount + 1 },
      // The database remains nullable for legacy rows, but the API resolver
      // marks a null count invalid before it can become an available keyframe.
      { ...availableKeyframe, guestCount: null },
    ]) {
      expect(RoomLayoutTimelineResponseSchema.safeParse({
        ...response,
        frames: [{ ...response.frames[0], keyframe }],
      }).success).toBe(false);
    }
  });

  it("rejects a response whose compatibility fields disagree with its authoritative range", () => {
    expect(RoomLayoutTimelineResponseSchema.safeParse({
      ...baseResponse,
      to: "2026-10-27T00:00:00.000Z",
      frames: [],
    }).success).toBe(false);
  });

  it("rejects fabricated fields on missing keyframes", () => {
    expect(RoomLayoutTimelineResponseSchema.safeParse({
      ...baseResponse,
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
