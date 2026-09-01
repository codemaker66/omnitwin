import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomLayoutTimelineResponse } from "../../api/room-layout-timeline.js";

vi.mock("../../api/room-layout-timeline.js", () => ({
  getRoomLayoutTimeline: vi.fn(),
}));

const timelineApi = vi.mocked(await import("../../api/room-layout-timeline.js"));
const { useRoomLayoutTimeline } = await import("../use-room-layout-timeline.js");

const VENUE_ID = "11111111-1111-4111-8111-111111111111";
const SPACE_ID = "22222222-2222-4222-8222-222222222222";

function response(
  anchorDate: string,
  venueId = VENUE_ID,
  spaceId = SPACE_ID,
): RoomLayoutTimelineResponse {
  const next = new Date(`${anchorDate}T12:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const from = `${anchorDate}T03:00:00.000Z`;
  const to = `${next.toISOString().slice(0, 10)}T03:00:00.000Z`;
  return {
    venueId,
    spaceId,
    timeZone: "Europe/London",
    from,
    to,
    range: { scope: "day", anchorDate, from, to },
    frames: [],
  };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | null = null;
  let rejectPromise: ((reason: unknown) => void) | null = null;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: (value) => { resolvePromise?.(value); },
    reject: (reason) => { rejectPromise?.(reason); },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useRoomLayoutTimeline", () => {
  it("aborts the superseded request and ignores its late response", async () => {
    const first = deferred<RoomLayoutTimelineResponse>();
    const second = deferred<RoomLayoutTimelineResponse>();
    const signals: AbortSignal[] = [];
    timelineApi.getRoomLayoutTimeline.mockImplementationOnce((_query, signal) => {
      if (signal !== undefined) signals.push(signal);
      return first.promise;
    }).mockImplementationOnce((_query, signal) => {
      if (signal !== undefined) signals.push(signal);
      return second.promise;
    });

    const { result, rerender } = renderHook(
      ({ anchorDate }) => useRoomLayoutTimeline(
        VENUE_ID,
        SPACE_ID,
        { scope: "day", anchorDate },
      ),
      { initialProps: { anchorDate: "2026-07-18" } },
    );
    rerender({ anchorDate: "2026-07-19" });
    expect(signals[0]?.aborted).toBe(true);

    act(() => { second.resolve(response("2026-07-19")); });
    await waitFor(() => { expect(result.current.data?.range.anchorDate).toBe("2026-07-19"); });
    act(() => { first.resolve(response("2026-07-18")); });
    expect(result.current.data?.range.anchorDate).toBe("2026-07-19");
  });

  it("aborts the in-flight read on unmount", () => {
    let capturedSignal: AbortSignal | undefined;
    timelineApi.getRoomLayoutTimeline.mockImplementation((_query, signal) => {
      capturedSignal = signal;
      return new Promise<RoomLayoutTimelineResponse>(() => undefined);
    });
    const { unmount } = renderHook(() => useRoomLayoutTimeline(
      VENUE_ID,
      SPACE_ID,
      { scope: "week", anchorDate: "2026-07-18" },
    ));

    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("masks loaded data synchronously and refetches on a same-date room switch", async () => {
    const second = deferred<RoomLayoutTimelineResponse>();
    timelineApi.getRoomLayoutTimeline
      .mockResolvedValueOnce(response("2026-07-18"))
      .mockImplementationOnce(() => second.promise);
    const nextVenueId = "33333333-3333-4333-8333-333333333333";
    const nextSpaceId = "44444444-4444-4444-8444-444444444444";
    const { result, rerender } = renderHook(
      ({ venueId, spaceId }) => useRoomLayoutTimeline(
        venueId,
        spaceId,
        { scope: "day", anchorDate: "2026-07-18" },
      ),
      { initialProps: { venueId: VENUE_ID, spaceId: SPACE_ID } },
    );
    await waitFor(() => { expect(result.current.status).toBe("loaded"); });

    rerender({ venueId: nextVenueId, spaceId: nextSpaceId });
    expect(result.current.status).toBe("loading");
    expect(result.current.data).toBeNull();
    expect(timelineApi.getRoomLayoutTimeline).toHaveBeenLastCalledWith({
      venueId: nextVenueId,
      spaceId: nextSpaceId,
      scope: "day",
      anchorDate: "2026-07-18",
    }, expect.any(AbortSignal));

    act(() => {
      second.resolve(response("2026-07-18", nextVenueId, nextSpaceId));
    });
    await waitFor(() => { expect(result.current.data?.spaceId).toBe(nextSpaceId); });
  });

  it.each([
    ["venue", "33333333-3333-4333-8333-333333333333", SPACE_ID],
    ["space", VENUE_ID, "44444444-4444-4444-8444-444444444444"],
  ] as const)("rejects a fulfilled response whose %s differs from its request", async (
    _identity,
    responseVenueId,
    responseSpaceId,
  ) => {
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response(
      "2026-07-18",
      responseVenueId,
      responseSpaceId,
    ));
    const { result } = renderHook(() => useRoomLayoutTimeline(
      VENUE_ID,
      SPACE_ID,
      { scope: "day", anchorDate: "2026-07-18" },
    ));

    await waitFor(() => { expect(result.current.status).toBe("error"); });
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe("Room timeline response did not match the selected room.");
  });

  it.each([
    ["scope", { scope: "week", anchorDate: "2026-07-18" }],
    ["anchor", { scope: "day", anchorDate: "2026-07-19" }],
  ] as const)("rejects a fulfilled scoped response with mismatched %s", async (_label, mismatch) => {
    const loaded = response("2026-07-18");
    timelineApi.getRoomLayoutTimeline.mockResolvedValue({
      ...loaded,
      range: { ...loaded.range, ...mismatch },
    } as RoomLayoutTimelineResponse);
    const { result } = renderHook(() => useRoomLayoutTimeline(
      VENUE_ID,
      SPACE_ID,
      { scope: "day", anchorDate: "2026-07-18" },
    ));

    await waitFor(() => { expect(result.current.status).toBe("error"); });
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe("Room timeline response did not match the requested range.");
  });

  it.each([
    "range.from",
    "range.to",
    "from",
    "to",
  ] as const)("rejects a scoped response with a mismatched exact %s bound", async (field) => {
    const loaded = response("2026-07-18");
    const wrong = "2026-07-18T04:00:00.000Z";
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(field.startsWith("range.")
      ? {
          ...loaded,
          range: { ...loaded.range, [field.slice("range.".length)]: wrong },
        } as RoomLayoutTimelineResponse
      : { ...loaded, [field]: wrong });
    const { result } = renderHook(() => useRoomLayoutTimeline(
      VENUE_ID,
      SPACE_ID,
      { scope: "day", anchorDate: "2026-07-18" },
    ));

    await waitFor(() => { expect(result.current.status).toBe("error"); });
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe("Room timeline response did not match the requested range.");
  });

  it("rejects a custom response whose exact from/to differs from the request", async () => {
    const from = "2026-07-18T03:00:00.000Z";
    const to = "2026-07-19T03:00:00.000Z";
    const wrongFrom = "2026-07-18T04:00:00.000Z";
    const loaded = response("2026-07-18");
    timelineApi.getRoomLayoutTimeline.mockResolvedValue({
      ...loaded,
      from: wrongFrom,
      to,
      range: { scope: "custom", anchorDate: null, from: wrongFrom, to },
    });
    const { result } = renderHook(() => useRoomLayoutTimeline(
      VENUE_ID,
      SPACE_ID,
      { from, to },
    ));

    await waitFor(() => { expect(result.current.status).toBe("error"); });
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe("Room timeline response did not match the requested range.");
  });
});
