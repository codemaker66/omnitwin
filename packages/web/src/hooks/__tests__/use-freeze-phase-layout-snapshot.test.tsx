import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client.js";
import { useFreezePhaseLayoutSnapshot } from "../use-freeze-phase-layout-snapshot.js";

const mocks = vi.hoisted(() => ({ freeze: vi.fn() }));

vi.mock("../../api/room-layout-timeline.js", () => ({
  freezePhaseLayoutSnapshot: mocks.freeze,
}));

const PARAMS = {
  eventId: "11111111-1111-4111-8111-111111111111",
  phaseId: "22222222-2222-4222-8222-222222222222",
};
const BODY = { configurationId: "33333333-3333-4333-8333-333333333333" };

beforeEach(() => {
  mocks.freeze.mockReset();
});

describe("useFreezePhaseLayoutSnapshot", () => {
  it("preserves an actionable 409 code and server message", async () => {
    mocks.freeze.mockRejectedValue(new ApiError(
      409,
      "This saved plan has no canonical planning snapshot.",
      "CONFIGURATION_CANONICAL_SNAPSHOT_MISSING",
    ));
    const { result } = renderHook(() => useFreezePhaseLayoutSnapshot());

    await act(async () => {
      await result.current.freeze(PARAMS, BODY);
    });

    expect(result.current).toMatchObject({
      status: "error",
      error: "This saved plan has no canonical planning snapshot.",
      errorCode: "CONFIGURATION_CANONICAL_SNAPSHOT_MISSING",
      result: null,
    });
  });
});
