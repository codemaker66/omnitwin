import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client.js";
import { useFreezePhaseLayoutSnapshot } from "../use-freeze-phase-layout-snapshot.js";
import { useLayoutTimelinePreviewStore } from "../../stores/layout-timeline-preview-store.js";
import type { FreezePhaseLayoutSnapshotResponse } from "../../api/room-layout-timeline.js";

const mocks = vi.hoisted(() => ({ freeze: vi.fn() }));

vi.mock("../../api/room-layout-timeline.js", () => ({
  freezePhaseLayoutSnapshot: mocks.freeze,
}));

const PARAMS = {
  eventId: "11111111-1111-4111-8111-111111111111",
  phaseId: "22222222-2222-4222-8222-222222222222",
};
const BODY = { configurationId: "33333333-3333-4333-8333-333333333333" };
const RESULT: FreezePhaseLayoutSnapshotResponse = {
  outcome: "created",
  eventId: PARAMS.eventId,
  phaseId: PARAMS.phaseId,
  configurationId: BODY.configurationId,
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

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason: unknown) => void) | undefined;
  return {
    promise: new Promise<T>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    }),
    resolve: (value) => { resolvePromise?.(value); },
    reject: (reason) => { rejectPromise?.(reason); },
  };
}

beforeEach(() => {
  mocks.freeze.mockReset();
  useLayoutTimelinePreviewStore.getState().clear();
});
afterEach(() => { useLayoutTimelinePreviewStore.getState().clear(); });

describe("useFreezePhaseLayoutSnapshot", () => {
  it("preserves an actionable 409 code and exact server message", async () => {
    mocks.freeze.mockRejectedValue(new ApiError(
      409,
      "This saved plan has no canonical planning snapshot.",
      "CONFIGURATION_CANONICAL_SNAPSHOT_MISSING",
    ));
    const { result } = renderHook(() => useFreezePhaseLayoutSnapshot());

    await act(async () => { await result.current.freeze(PARAMS, BODY); });

    expect(result.current).toMatchObject({
      status: "error",
      error: "This saved plan has no canonical planning snapshot.",
      errorCode: "CONFIGURATION_CANONICAL_SNAPSHOT_MISSING",
      result: null,
    });
  });

  it("does not call the freeze API while timeline preview owns the renderer", async () => {
    useLayoutTimelinePreviewStore.getState().showPending("Loading timeline…");
    const { result } = renderHook(() => useFreezePhaseLayoutSnapshot());

    let freezeResult: Awaited<ReturnType<typeof result.current.freeze>> | undefined;
    await act(async () => { freezeResult = await result.current.freeze(PARAMS, BODY); });

    expect(freezeResult).toBeNull();
    expect(mocks.freeze).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("reconciles a dispatched success even if preview starts while the request is in flight", async () => {
    const pending = deferred<FreezePhaseLayoutSnapshotResponse>();
    mocks.freeze.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useFreezePhaseLayoutSnapshot());
    let request: Promise<FreezePhaseLayoutSnapshotResponse | null> | undefined;
    act(() => { request = result.current.freeze(PARAMS, BODY); });
    expect(mocks.freeze).toHaveBeenCalledTimes(1);

    act(() => { useLayoutTimelinePreviewStore.getState().showPending("Loading timeline…"); });
    await act(async () => {
      pending.resolve(RESULT);
      await request;
    });

    expect(await request).toEqual(RESULT);
    expect(result.current).toMatchObject({ status: "success", result: RESULT, error: null });
  });

  it("reconciles a dispatched error even if preview starts while the request is in flight", async () => {
    const pending = deferred<FreezePhaseLayoutSnapshotResponse>();
    mocks.freeze.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useFreezePhaseLayoutSnapshot());
    let request: Promise<FreezePhaseLayoutSnapshotResponse | null> | undefined;
    act(() => { request = result.current.freeze(PARAMS, BODY); });

    act(() => { useLayoutTimelinePreviewStore.getState().showPending("Loading timeline…"); });
    await act(async () => {
      pending.reject(new ApiError(409, "Freeze conflict.", "FREEZE_CONFLICT"));
      await request;
    });

    expect(await request).toBeNull();
    expect(result.current).toMatchObject({
      status: "error",
      result: null,
      error: "Freeze conflict.",
      errorCode: "FREEZE_CONFLICT",
    });
  });
});
