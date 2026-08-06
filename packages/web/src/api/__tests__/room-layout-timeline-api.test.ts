import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FreezePhaseLayoutSnapshotResponse } from "@omnitwin/types";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
}));

vi.mock("../client.js", () => ({
  api: { post: mocks.post, get: mocks.get },
}));

const { freezePhaseLayoutSnapshot } = await import("../room-layout-timeline.js");

const RESULT: FreezePhaseLayoutSnapshotResponse = {
  outcome: "created",
  eventId: "11111111-1111-4111-8111-111111111111",
  phaseId: "22222222-2222-4222-8222-222222222222",
  configurationId: "33333333-3333-4333-8333-333333333333",
  snapshotId: "44444444-4444-4444-8444-444444444444",
  canonicalSnapshotId: "55555555-5555-4555-8555-555555555555",
  snapshotHash: "a".repeat(64),
  proofDigest: "b".repeat(64),
  frozenBy: "66666666-6666-4666-8666-666666666666",
  status: "frozen",
  coordinateSpace: "real_m_v1",
  objectCount: 42,
  guestCount: 180,
  createdAt: "2026-07-18T12:00:00.000Z",
  frozenAt: "2026-07-18T12:00:00.000Z",
  supersedesSnapshotId: null,
};

beforeEach(() => {
  mocks.post.mockReset();
  mocks.get.mockReset();
});

describe("freezePhaseLayoutSnapshot", () => {
  it("sends identities only to the typed authenticated producer route", async () => {
    mocks.post.mockResolvedValue(RESULT);
    await expect(freezePhaseLayoutSnapshot(
      { eventId: RESULT.eventId, phaseId: RESULT.phaseId },
      { configurationId: RESULT.configurationId },
    )).resolves.toEqual(RESULT);

    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith(
      `/events/${RESULT.eventId}/phases/${RESULT.phaseId}/layout-snapshots`,
      { configurationId: RESULT.configurationId },
      false,
      expect.anything(),
    );
  });
});
