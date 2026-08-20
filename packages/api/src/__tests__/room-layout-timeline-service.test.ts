import { describe, expect, it } from "vitest";
import {
  CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
  canonicalLayoutSnapshotDigest,
  runLayoutValidator,
} from "@omnitwin/types";
import {
  deriveRoomLayoutTimelineGuestsFigure,
  deriveRoomLayoutTimelineRevenueFigure,
  deriveRoomLayoutTimelineSeatedCapacity,
  resolveRoomLayoutTimelineKeyframe,
  selectEffectiveLayoutTimelineSnapshot,
  type LayoutTimelineSnapshotCandidate,
} from "../services/room-layout-timeline.js";

const PAYLOAD = CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE;
const VENUE_ID = PAYLOAD.venueId;
const SPACE_ID = PAYLOAD.spaceId;
const PHASE_ID = "66666666-6666-4666-8666-666666666666";
const CANONICAL_ID = "88888888-8888-4888-8888-888888888888";
const PROOF = runLayoutValidator(PAYLOAD, {
  policyBundleId: PAYLOAD.policyBundle.policyBundleId,
  policyBundleDigest: PAYLOAD.policyBundle.policyBundleDigest,
  policyBundleVersion: PAYLOAD.policyBundle.policyBundleVersion,
  minPrimaryFurnitureClearanceM: 1,
  clearanceWarningMarginM: 0.2,
  pricing: null,
});

function payloadWithDigest(payload: typeof PAYLOAD): Pick<
  LayoutTimelineSnapshotCandidate,
  "payload" | "snapshotHash"
> {
  return { payload, snapshotHash: canonicalLayoutSnapshotDigest(payload) };
}

function candidate(
  id: string,
  overrides: Partial<LayoutTimelineSnapshotCandidate> = {},
): LayoutTimelineSnapshotCandidate {
  return {
    id,
    eventPhaseId: PHASE_ID,
    configurationId: PAYLOAD.configurationId,
    canonicalSnapshotId: CANONICAL_ID,
    proofDigest: PROOF.proofDigest,
    supersedesSnapshotId: null,
    frozenBy: "99999999-9999-4999-8999-999999999999",
    canonicalRowId: CANONICAL_ID,
    canonicalConfigurationId: PAYLOAD.configurationId,
    canonicalVenueId: VENUE_ID,
    canonicalSpaceId: SPACE_ID,
    canonicalSnapshotDigest: canonicalLayoutSnapshotDigest(PAYLOAD),
    canonicalPayload: PAYLOAD,
    proofSnapshotId: CANONICAL_ID,
    proofSnapshotDigest: canonicalLayoutSnapshotDigest(PAYLOAD),
    proofRowDigest: PROOF.proofDigest,
    proofPayload: PROOF,
    predecessor: null,
    snapshotHash: canonicalLayoutSnapshotDigest(PAYLOAD),
    status: "frozen",
    objectCount: PAYLOAD.objects.length,
    guestCount: PAYLOAD.guestCount,
    payload: PAYLOAD,
    coordinateSpace: "real_m_v1",
    createdAt: new Date("2026-10-24T12:00:00.000Z"),
    frozenAt: new Date("2026-10-24T12:05:00.000Z"),
    configurationSpaceId: SPACE_ID,
    configurationVenueId: VENUE_ID,
    ...overrides,
  };
}

function resolve(candidates: readonly LayoutTimelineSnapshotCandidate[]) {
  return resolveRoomLayoutTimelineKeyframe({
    venueId: VENUE_ID,
    spaceId: SPACE_ID,
    isRoomFlip: false,
    candidates,
  });
}

describe("selectEffectiveLayoutTimelineSnapshot", () => {
  it("uses frozen > draft > stale > superseded before recency", () => {
    const frozen = candidate("77777777-7777-4777-8777-777777777771", {
      status: "frozen",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const draft = candidate("77777777-7777-4777-8777-777777777772", {
      status: "draft",
      createdAt: new Date("2026-12-01T00:00:00.000Z"),
    });
    const stale = candidate("77777777-7777-4777-8777-777777777773", {
      status: "stale",
    });
    const superseded = candidate("77777777-7777-4777-8777-777777777774", {
      status: "superseded",
    });

    expect(selectEffectiveLayoutTimelineSnapshot([superseded, stale, draft, frozen])?.id)
      .toBe(frozen.id);
  });

  it("selects the newest candidate within one status deterministically", () => {
    const frozenLater = candidate("77777777-7777-4777-8777-777777777775", {
      status: "frozen",
      createdAt: new Date("2026-10-24T11:00:00.000Z"),
      frozenAt: new Date("2026-10-24T14:00:00.000Z"),
    });
    const createdLater = candidate("77777777-7777-4777-8777-777777777776", {
      status: "frozen",
      createdAt: new Date("2026-10-24T13:00:00.000Z"),
      frozenAt: new Date("2026-10-24T13:30:00.000Z"),
    });

    expect(selectEffectiveLayoutTimelineSnapshot([createdLater, frozenLater])?.id)
      .toBe(frozenLater.id);
  });
});

describe("effective frozen snapshot regressions", () => {
  const firstId = "77777777-7777-4777-8777-777777777761";
  const secondId = "77777777-7777-4777-8777-777777777762";

  it("keeps frozen T1 available ahead of newer mutable/stale lifecycle rows", () => {
    const first = candidate(firstId, {
      frozenAt: new Date("2026-10-24T12:00:00.000Z"),
    });
    const later = (["draft", "stale", "superseded"] as const).map((status, index) => (
      candidate(`77777777-7777-4777-8777-77777777776${String(index + 3)}`, {
        status,
        createdAt: new Date("2026-10-25T12:00:00.000Z"),
        frozenAt: null,
      })
    ));
    expect(resolve([first, ...later])).toMatchObject({
      state: "available",
      snapshotId: firstId,
    });
  });

  it("selects a valid superseding frozen T2", () => {
    const first = candidate(firstId, {
      frozenAt: new Date("2026-10-24T12:00:00.000Z"),
    });
    const second = candidate(secondId, {
      supersedesSnapshotId: firstId,
      predecessor: {
        id: firstId,
        eventPhaseId: PHASE_ID,
        status: "frozen",
        createdAt: first.createdAt,
        frozenAt: first.frozenAt,
      },
      createdAt: new Date("2026-10-25T12:00:00.000Z"),
      frozenAt: new Date("2026-10-25T12:05:00.000Z"),
    });
    expect(resolve([first, second])).toMatchObject({
      state: "available",
      snapshotId: secondId,
    });
  });

  it("surfaces invalid frozen T2 without falling back to valid T1", () => {
    const first = candidate(firstId, {
      frozenAt: new Date("2026-10-24T12:00:00.000Z"),
    });
    const second = candidate(secondId, {
      supersedesSnapshotId: firstId,
      predecessor: {
        id: firstId,
        eventPhaseId: PHASE_ID,
        status: "frozen",
        createdAt: first.createdAt,
        frozenAt: first.frozenAt,
      },
      canonicalSnapshotDigest: "0".repeat(64),
      createdAt: new Date("2026-10-25T12:00:00.000Z"),
      frozenAt: new Date("2026-10-25T12:05:00.000Z"),
    });
    const keyframe = resolve([first, second]);
    expect(keyframe).toMatchObject({
      state: "invalid",
      snapshotId: secondId,
      reason: "canonical_lineage_mismatch",
    });
    expect(keyframe).not.toHaveProperty("payload");
  });
});

describe("resolveRoomLayoutTimelineKeyframe", () => {
  it("returns an available canonical keyframe without copying unverified fields", () => {
    const keyframe = resolve([
      candidate("77777777-7777-4777-8777-777777777777", { status: "frozen" }),
    ]);

    expect(keyframe).toMatchObject({
      state: "available",
      snapshotStatus: "frozen",
      snapshotHash: canonicalLayoutSnapshotDigest(PAYLOAD),
      objectCount: PAYLOAD.objects.length,
      payload: PAYLOAD,
    });
  });

  it("returns missing when no snapshot exists and always treats room flips as gaps", () => {
    expect(resolve([])).toEqual({
      state: "missing",
      reason: "no_snapshot",
      message: "No saved layout for this phase.",
    });
    expect(resolveRoomLayoutTimelineKeyframe({
      venueId: VENUE_ID,
      spaceId: SPACE_ID,
      isRoomFlip: true,
      candidates: [candidate("77777777-7777-4777-8777-777777777778")],
    })).toEqual({
      state: "missing",
      reason: "room_flip_gap",
      message: "Room flip is a transition gap, not a saved layout.",
    });
  });

  it.each(["draft", "stale", "superseded"] as const)(
    "never exposes a %s snapshot as an available viewer keyframe",
    (status) => {
      expect(resolve([candidate("77777777-7777-4777-8777-777777777782", { status })]))
        .toMatchObject({ state: "invalid", reason: "snapshot_not_frozen" });
    },
  );

  it.each([
    { canonicalSnapshotId: null },
    { proofDigest: null },
    { frozenBy: null },
    { frozenAt: null },
  ])("rejects a frozen snapshot with missing lineage: $canonicalSnapshotId$proofDigest$frozenBy$frozenAt", (overrides) => {
    expect(resolve([candidate("77777777-7777-4777-8777-777777777783", {
      status: "frozen",
      ...overrides,
    })])).toMatchObject({ state: "invalid", reason: "frozen_lineage_missing" });
  });

  it("rejects independently valid canonical/proof references that do not form one chain", () => {
    expect(resolve([candidate("77777777-7777-4777-8777-777777777784", {
      canonicalSnapshotDigest: "0".repeat(64),
    })])).toMatchObject({ state: "invalid", reason: "canonical_lineage_mismatch" });
    expect(resolve([candidate("77777777-7777-4777-8777-777777777785", {
      proofRowDigest: "a".repeat(64),
    })])).toMatchObject({ state: "invalid", reason: "proof_lineage_mismatch" });
  });

  it("rejects a predecessor from another phase", () => {
    const predecessorId = "77777777-7777-4777-8777-777777777786";
    expect(resolve([candidate("77777777-7777-4777-8777-777777777787", {
      supersedesSnapshotId: predecessorId,
      predecessor: {
        id: predecessorId,
        eventPhaseId: "66666666-6666-4666-8666-666666666667",
        status: "frozen",
        createdAt: new Date("2026-10-24T11:00:00.000Z"),
        frozenAt: new Date("2026-10-24T11:05:00.000Z"),
      },
    })])).toMatchObject({ state: "invalid", reason: "predecessor_lineage_mismatch" });
  });

  it.each([
    {
      label: "an unknown status",
      overrides: { status: "approved" },
      reason: "snapshot_status_invalid",
    },
    {
      label: "a missing payload",
      overrides: { payload: null },
      reason: "payload_missing",
    },
    {
      label: "a malformed payload",
      overrides: { payload: { schemaVersion: "unknown" } },
      reason: "payload_schema_invalid",
    },
    {
      label: "a missing snapshot digest",
      overrides: { snapshotHash: null },
      reason: "snapshot_hash_missing",
    },
    {
      label: "a mismatched snapshot digest",
      overrides: { snapshotHash: "0".repeat(64) },
      reason: "snapshot_hash_mismatch",
    },
    {
      label: "legacy coordinates",
      overrides: { coordinateSpace: "legacy_render_v0" },
      reason: "coordinate_space_invalid",
    },
    {
      label: "a venue mismatch",
      overrides: payloadWithDigest({
        ...PAYLOAD,
        venueId: "11111111-1111-4111-8111-111111111112",
      }),
      reason: "venue_identity_mismatch",
    },
    {
      label: "a nested venue mismatch",
      overrides: payloadWithDigest({
          ...PAYLOAD,
          venueRuntime: {
            ...PAYLOAD.venueRuntime,
            venueId: "11111111-1111-4111-8111-111111111112",
          },
      }),
      reason: "venue_identity_mismatch",
    },
    {
      label: "a space mismatch",
      overrides: payloadWithDigest({
        ...PAYLOAD,
        spaceId: "33333333-3333-4333-8333-333333333334",
      }),
      reason: "space_identity_mismatch",
    },
    {
      label: "a configuration mismatch",
      overrides: { configurationId: "44444444-4444-4444-8444-444444444445" },
      reason: "configuration_identity_mismatch",
    },
    {
      label: "an object-count mismatch",
      overrides: { objectCount: PAYLOAD.objects.length + 1 },
      reason: "object_count_mismatch",
    },
    {
      label: "a guest-count mismatch",
      overrides: { guestCount: PAYLOAD.guestCount + 1 },
      reason: "guest_count_mismatch",
    },
    {
      label: "a null legacy guest count",
      overrides: { guestCount: null },
      reason: "guest_count_mismatch",
    },
  ])("marks $label invalid", ({ overrides, reason }) => {
    const keyframe = resolve([
      candidate("77777777-7777-4777-8777-777777777779", overrides),
    ]);
    expect(keyframe).toMatchObject({ state: "invalid", reason });
    expect(keyframe).not.toHaveProperty("payload");
  });

  it("does not fall through from an invalid frozen snapshot to an older draft", () => {
    const keyframe = resolve([
      candidate("77777777-7777-4777-8777-777777777780", {
        status: "frozen",
        payload: null,
      }),
      candidate("77777777-7777-4777-8777-777777777781", { status: "draft" }),
    ]);
    expect(keyframe).toMatchObject({ state: "invalid", reason: "payload_missing" });
  });
});

describe("room timeline figures", () => {
  const available = resolve([
    candidate("77777777-7777-4777-8777-777777777791"),
  ]);

  it("uses frozen, phase, then event guest truth in that order", () => {
    expect(deriveRoomLayoutTimelineGuestsFigure({
      keyframe: available,
      phaseGuestCount: 90,
      eventGuestCount: 100,
    })).toEqual({ value: PAYLOAD.guestCount, source: "frozen_snapshot" });
    const missing = resolve([]);
    expect(deriveRoomLayoutTimelineGuestsFigure({
      keyframe: missing,
      phaseGuestCount: 90,
      eventGuestCount: 100,
    })).toEqual({ value: 90, source: "phase" });
    expect(deriveRoomLayoutTimelineGuestsFigure({
      keyframe: missing,
      phaseGuestCount: null,
      eventGuestCount: 100,
    })).toEqual({ value: 100, source: "event" });
  });

  it("derives chair-first capacity and refuses incomplete seat evidence", () => {
    expect(deriveRoomLayoutTimelineSeatedCapacity(available)).toEqual({
      state: "available",
      value: 1,
      source: "frozen_snapshot",
      basis: "chair_objects",
    });
    if (available.state !== "available") throw new Error("Expected test keyframe.");
    const incomplete = {
      ...available,
      payload: {
        ...available.payload,
        objects: available.payload.objects.map((object) => ({
          ...object,
          assetDefinition: { ...object.assetDefinition, seatCount: null },
        })),
      },
    };
    expect(deriveRoomLayoutTimelineSeatedCapacity(incomplete)).toEqual({
      state: "unavailable",
      reason: "capacity_evidence_incomplete",
    });
  });

  it("selects only matching planning scenarios and marks guest-stale estimates unavailable", () => {
    const base = {
      venueId: VENUE_ID,
      eventId: "55555555-5555-4555-8555-555555555555",
      configurationId: PAYLOAD.configurationId,
      name: "Dinner plan",
      status: "active",
      scenarioKind: "layout_based",
      currency: "GBP",
      plannedGuestCount: PAYLOAD.guestCount,
      estimatedRevenueMinor: 2_875_000,
      comfortStatus: "not_checked",
      reviewGateCount: 1,
      updatedAt: new Date("2026-06-01T12:00:00.000Z"),
    };
    const revenue = deriveRoomLayoutTimelineRevenueFigure({
      venueId: VENUE_ID,
      eventId: base.eventId,
      commercialAccess: true,
      keyframe: available,
      candidates: [
        { ...base, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", configurationId: null, estimatedRevenueMinor: 99_000_000 },
        { ...base, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", venueId: "11111111-1111-4111-8111-111111111112", estimatedRevenueMinor: 88_000_000 },
        { ...base, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3" },
      ],
    });
    expect(revenue).toMatchObject({
      state: "available",
      source: "planning_scenario",
      scenario: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
        estimatedRevenueMinor: 2_875_000,
      },
      disclosure: "Planning scenario estimate; not a quote or approval.",
    });
    expect(deriveRoomLayoutTimelineRevenueFigure({
      venueId: VENUE_ID,
      eventId: base.eventId,
      commercialAccess: true,
      keyframe: available,
      candidates: [{
        ...base,
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
        plannedGuestCount: PAYLOAD.guestCount + 1,
      }],
    })).toEqual({ state: "unavailable", reason: "planning_scenario_stale" });
    expect(deriveRoomLayoutTimelineRevenueFigure({
      venueId: VENUE_ID,
      eventId: base.eventId,
      commercialAccess: false,
      keyframe: available,
      candidates: [{ ...base, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5" }],
    })).toEqual({ state: "restricted", reason: "insufficient_commercial_access" });
    expect(deriveRoomLayoutTimelineRevenueFigure({
      venueId: VENUE_ID,
      eventId: base.eventId,
      commercialAccess: true,
      keyframe: resolve([]),
      candidates: [],
    })).toEqual({ state: "unavailable", reason: "no_valid_frozen_keyframe" });
  });
});
