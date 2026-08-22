import { TRADES_HALL_ENQUIRY_VENUE_SLUG } from "@omnitwin/types";
import { describe, expect, it } from "vitest";
import {
  plannerAllowsOperationalGeometry,
  resolvePlannerLayerComposition,
  resolvePlannerLayerPolicy,
  type PlannerLayerPolicyInput,
  type PlannerRoomIdentity,
  type PlannerRoomKey,
} from "../planner-layer-composition.js";

const CURRENT_ROOM: PlannerRoomKey = {
  spaceId: "space-1",
  venueId: "venue-1",
  roomSlug: "reception-room",
};

function resolvedIdentity(
  overrides: Partial<PlannerRoomIdentity> = {},
): PlannerRoomIdentity {
  return {
    ...CURRENT_ROOM,
    status: "resolved",
    venueSlug: TRADES_HALL_ENQUIRY_VENUE_SLUG,
    ...overrides,
  } as PlannerRoomIdentity;
}

function policy(
  overrides: Partial<PlannerLayerPolicyInput> = {},
): ReturnType<typeof resolvePlannerLayerPolicy> {
  return resolvePlannerLayerPolicy({
    currentRoom: CURRENT_ROOM,
    roomIdentity: resolvedIdentity(),
    requestedMode: "hybrid",
    ...overrides,
  });
}

function composition({
  layerPolicy = policy(),
  hasCapturedAsset = false,
}: {
  readonly layerPolicy?: ReturnType<typeof resolvePlannerLayerPolicy>;
  readonly hasCapturedAsset?: boolean;
} = {}): ReturnType<typeof resolvePlannerLayerComposition> {
  return resolvePlannerLayerComposition({
    policy: layerPolicy,
    hasCapturedAsset,
  });
}

describe("resolvePlannerLayerPolicy", () => {
  it("fails closed while the room identity is missing or pending", () => {
    expect(policy({ roomIdentity: null })).toEqual({
      kind: "identity-pending",
      effectiveMode: "hybrid",
      controlsLocked: true,
    });
    expect(policy({
      roomIdentity: {
        ...CURRENT_ROOM,
        status: "pending",
        venueSlug: null,
      },
    })).toEqual({
      kind: "identity-pending",
      effectiveMode: "hybrid",
      controlsLocked: true,
    });
  });

  it("rejects a resolved identity belonging to a previous room key", () => {
    expect(policy({
      roomIdentity: resolvedIdentity({ spaceId: "stale-space" }),
    }).kind).toBe("identity-pending");
    expect(policy({
      roomIdentity: resolvedIdentity({ venueId: "stale-venue" }),
    }).kind).toBe("identity-pending");
    expect(policy({
      roomIdentity: resolvedIdentity({ roomSlug: "stale-room" }),
    }).kind).toBe("identity-pending");
  });

  it("fails closed when the current room identity could not be verified", () => {
    expect(policy({
      roomIdentity: {
        ...CURRENT_ROOM,
        status: "unavailable",
        venueSlug: null,
      },
      requestedMode: "mesh",
    })).toEqual({
      kind: "identity-unavailable",
      effectiveMode: "mesh",
      controlsLocked: true,
    });
  });

  it("locks only the venue-verified Trades Hall Grand Hall to captured mode", () => {
    const grandHallRoom = { ...CURRENT_ROOM, roomSlug: "grand-hall" };
    expect(policy({
      currentRoom: grandHallRoom,
      roomIdentity: resolvedIdentity({ roomSlug: "grand-hall" }),
      requestedMode: "mesh",
    })).toEqual({
      kind: "captured-only",
      effectiveMode: "splat",
      controlsLocked: true,
    });
  });

  it("keeps another venue's grand-hall slug configurable", () => {
    const grandHallRoom = { ...CURRENT_ROOM, roomSlug: "grand-hall" };
    expect(policy({
      currentRoom: grandHallRoom,
      roomIdentity: resolvedIdentity({
        roomSlug: "grand-hall",
        venueSlug: "another-venue",
      }),
      requestedMode: "mesh",
    })).toEqual({
      kind: "configurable",
      effectiveMode: "mesh",
      controlsLocked: false,
    });
  });
});

describe("plannerAllowsOperationalGeometry", () => {
  it("allows planning chrome only for a venue-verified configurable room", () => {
    expect(plannerAllowsOperationalGeometry(policy())).toBe(true);
    expect(plannerAllowsOperationalGeometry(policy({
      currentRoom: { ...CURRENT_ROOM, roomSlug: "grand-hall" },
      roomIdentity: resolvedIdentity({ roomSlug: "grand-hall" }),
    }))).toBe(false);
    expect(plannerAllowsOperationalGeometry(policy({ roomIdentity: null }))).toBe(false);
  });

  it("does not suppress another venue's verified grand-hall room", () => {
    expect(plannerAllowsOperationalGeometry(policy({
      currentRoom: { ...CURRENT_ROOM, roomSlug: "grand-hall" },
      roomIdentity: resolvedIdentity({
        roomSlug: "grand-hall",
        venueSlug: "another-venue",
      }),
    }))).toBe(true);
  });
});

describe("resolvePlannerLayerComposition", () => {
  it.each(["identity-pending", "identity-unavailable"] as const)(
    "renders no architecture while policy is %s",
    (kind) => {
      expect(composition({
        layerPolicy: {
          kind,
          effectiveMode: "hybrid",
          controlsLocked: true,
        },
        hasCapturedAsset: true,
      })).toEqual({
        architecture: "unavailable",
        renderCapturedArchitecture: false,
        renderProceduralArchitecture: false,
        renderArchitecturalInk: false,
        renderPlanningOverlays: false,
      });
    },
  );

  it.each(["mesh", "splat", "hybrid"] as const)(
    "does not re-enable generated Trades Hall Grand Hall architecture in %s preference",
    (requestedMode) => {
      expect(composition({
        layerPolicy: policy({
          currentRoom: { ...CURRENT_ROOM, roomSlug: "grand-hall" },
          roomIdentity: resolvedIdentity({ roomSlug: "grand-hall" }),
          requestedMode,
        }),
        hasCapturedAsset: true,
      })).toEqual({
        architecture: "captured",
        renderCapturedArchitecture: true,
        renderProceduralArchitecture: false,
        renderArchitecturalInk: false,
        renderPlanningOverlays: false,
      });
    },
  );

  it("fails closed instead of inventing Trades Hall Grand Hall architecture without a capture", () => {
    expect(composition({
      layerPolicy: policy({
        currentRoom: { ...CURRENT_ROOM, roomSlug: "grand-hall" },
        roomIdentity: resolvedIdentity({ roomSlug: "grand-hall" }),
      }),
      hasCapturedAsset: false,
    })).toEqual({
      architecture: "unavailable",
      renderCapturedArchitecture: false,
      renderProceduralArchitecture: false,
      renderArchitecturalInk: false,
      renderPlanningOverlays: false,
    });
  });

  it("preserves every existing layer choice for configurable rooms", () => {
    expect(composition()).toMatchObject({
      architecture: "procedural",
      renderCapturedArchitecture: false,
      renderProceduralArchitecture: true,
      renderArchitecturalInk: true,
      renderPlanningOverlays: true,
    });
    expect(composition({
      layerPolicy: policy({ requestedMode: "splat" }),
      hasCapturedAsset: true,
    })).toMatchObject({
      architecture: "captured",
      renderCapturedArchitecture: true,
      renderProceduralArchitecture: false,
      renderArchitecturalInk: true,
      renderPlanningOverlays: true,
    });
    expect(composition({
      layerPolicy: policy({ requestedMode: "mesh" }),
      hasCapturedAsset: true,
    })).toMatchObject({
      architecture: "procedural",
      renderCapturedArchitecture: false,
      renderProceduralArchitecture: true,
      renderArchitecturalInk: true,
      renderPlanningOverlays: true,
    });
    expect(composition({ hasCapturedAsset: true })).toMatchObject({
      architecture: "hybrid",
      renderCapturedArchitecture: true,
      renderProceduralArchitecture: true,
      renderArchitecturalInk: true,
      renderPlanningOverlays: true,
    });
  });
});
