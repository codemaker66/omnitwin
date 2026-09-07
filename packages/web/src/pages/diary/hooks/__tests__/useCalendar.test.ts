import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { CalendarResponse } from "@omnitwin/types";
import { useCalendar } from "../useCalendar.js";
import { boardRange } from "../../lib/board-time.js";

const { getCalendar } = vi.hoisted(() => ({ getCalendar: vi.fn() }));
vi.mock("../../../../api/diary.js", () => ({ getCalendar }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const first = boardRange(Date.parse("2026-09-07T12:00Z"), "week");
const second = boardRange(Date.parse("2026-09-14T12:00Z"), "week");
const response = (venueId: string): CalendarResponse => ({ venueId,
  range: { from: new Date(first.fromMs).toISOString(), to: new Date(first.toMs).toISOString() },
  rooms: [], entries: [], conflicts: { conflicts: [], checks: { inkDoubleBook: { status: "checked" }, holdOverlap: { status: "checked" }, turnaround: { status: "checked", uncoveredPairCount: 0, detail: "Checked" } } },
});

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void; readonly reject: (reason: Error) => void } {
  let resolvePromise: (value: T) => void = () => { throw new Error("Promise not initialized"); };
  let rejectPromise: (reason: Error) => void = () => { throw new Error("Promise not initialized"); };
  const promise = new Promise<T>((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

describe("useCalendar request identity", () => {
  it.each(["success", "failure"] as const)("shows loading without the previous error while an initial-load retry awaits %s", async (settlement) => {
    const retry = deferred<CalendarResponse>();
    getCalendar.mockRejectedValueOnce(new Error("Offline")).mockReturnValueOnce(retry.promise);
    const { result } = renderHook(() => useCalendar("venue-a", first));
    await waitFor(() => { expect(result.current.status).toBe("error"); });
    expect(result.current.error).toBe("Unexpected error");

    act(() => { result.current.refetch(); });
    expect(result.current.status).toBe("loading");
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBeNull();
    expect(result.current.isRefreshing).toBe(false);

    await act(async () => {
      if (settlement === "success") retry.resolve(response("venue-a"));
      else retry.reject(new Error("Still offline"));
      await retry.promise.catch(() => undefined);
    });
    expect(result.current.status).toBe(settlement === "success" ? "ready" : "error");
    expect(result.current.error).toBe(settlement === "success" ? null : "Unexpected error");
    expect(result.current.data?.venueId ?? null).toBe(settlement === "success" ? "venue-a" : null);
    expect(result.current.isRefreshing).toBe(false);
  });

  it.each(["success", "failure"] as const)("ignores a superseded retry's %s while the current retry is loading", async (settlement) => {
    const oldRetry = deferred<CalendarResponse>();
    const currentRetry = deferred<CalendarResponse>();
    getCalendar.mockRejectedValueOnce(new Error("Offline"))
      .mockReturnValueOnce(oldRetry.promise).mockReturnValueOnce(currentRetry.promise);
    const { result } = renderHook(() => useCalendar("venue-a", first));
    await waitFor(() => { expect(result.current.status).toBe("error"); });
    act(() => { result.current.refetch(); });
    act(() => { result.current.refetch(); });
    expect(getCalendar).toHaveBeenCalledTimes(3);
    expect(result.current.status).toBe("loading");

    await act(async () => {
      if (settlement === "success") oldRetry.resolve(response("venue-a"));
      else oldRetry.reject(new Error("Old request failed"));
      await oldRetry.promise.catch(() => undefined);
    });
    expect(result.current.status).toBe("loading");
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBeNull();

    await act(async () => { currentRetry.resolve(response("venue-a")); await currentRetry.promise; });
    expect(result.current.status).toBe("ready");
    expect(result.current.error).toBeNull();
    expect(result.current.data?.venueId).toBe("venue-a");
    expect(result.current.isRefreshing).toBe(false);
  });

  it("ignores an old response that finishes after the new venue has loaded", async () => {
    let resolveOld: ((value: CalendarResponse) => void) | undefined;
    getCalendar.mockImplementationOnce(() => new Promise<CalendarResponse>((resolve) => { resolveOld = resolve; }));
    const { result, rerender } = renderHook(({ venueId }) => useCalendar(venueId, first), { initialProps: { venueId: "venue-a" } });
    getCalendar.mockResolvedValueOnce(response("venue-b"));
    rerender({ venueId: "venue-b" });
    await waitFor(() => { expect(result.current.data?.venueId).toBe("venue-b"); });
    await act(async () => { resolveOld?.(response("venue-a")); await Promise.resolve(); });
    expect(result.current.data?.venueId).toBe("venue-b");expect(result.current.status).toBe("ready");expect(result.current.isRefreshing).toBe(false);
  });
  it("hides previous range/venue data while a new identity loads", async () => {
    getCalendar.mockResolvedValueOnce(response("venue-a"));
    const { result, rerender } = renderHook(({ venueId, range }) => useCalendar(venueId, range), { initialProps: { venueId: "venue-a", range: first } });
    await waitFor(() => { expect(result.current.data?.venueId).toBe("venue-a"); });
    getCalendar.mockImplementation(() => new Promise(() => undefined));
    rerender({ venueId: "venue-a", range: second });
    expect(result.current.data).toBeNull();expect(result.current.status).toBe("loading");
    rerender({ venueId: "venue-b", range: second });
    expect(result.current.data).toBeNull();expect(result.current.status).toBe("loading");
  });
});
