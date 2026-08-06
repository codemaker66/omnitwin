import { describe, expect, it } from "vitest";
import {
  CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
  canonicalLayoutSnapshotDigest,
} from "@omnitwin/types";
import {
  resolveRoomLayoutTimelineKeyframe,
  selectEffectiveLayoutTimelineSnapshot,
  type LayoutTimelineSnapshotCandidate,
} from "../services/room-layout-timeline.js";

const PAYLOAD = CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE;
const VENUE_ID = PAYLOAD.venueId;
const SPACE_ID = PAYLOAD.spaceId;
const PHASE_ID = "66666666-6666-4666-8666-666666666666";

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
    snapshotHash: canonicalLayoutSnapshotDigest(PAYLOAD),
    status: "draft",
    objectCount: PAYLOAD.objects.length,
    guestCount: PAYLOAD.guestCount,
    payload: PAYLOAD,
    coordinateSpace: "real_m_v1",
    createdAt: new Date("2026-10-24T12:00:00.000Z"),
    frozenAt: null,
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

describe("resolveRoomLayoutTimelineKeyframe", () => {
  it("returns an available canonical keyframe without copying unverified fields", () => {
    const keyframe = resolve([
      candidate("77777777-7777-4777-8777-777777777777", { status: "frozen" }),
    ]);

    expect(keyframe).toMatchObject({
      state: "available",
      snapshotStatus: "frozen",
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
