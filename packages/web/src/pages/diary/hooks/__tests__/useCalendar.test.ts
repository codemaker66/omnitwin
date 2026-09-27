import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { CalendarResponse } from "@omnitwin/types";
import { CALENDAR_REUSE_MS, useCalendar } from "../useCalendar.js";
import { boardRange } from "../../lib/board-time.js";

const { getCalendar } = vi.hoisted(() => ({ getCalendar: vi.fn() }));
vi.mock("../../../../api/diary.js", () => ({ getCalendar }));
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.restoreAllMocks(); });
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

describe("useCalendar keeps the board steady (roadmap N3)", () => {
  const flush = async (): Promise<void> => { await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); }); };

  it("keeps the venue's frame while another range loads, never its bookings", async () => {
    getCalendar.mockResolvedValueOnce(response("venue-a")).mockImplementation(() => new Promise(() => undefined));
    const { result, rerender } = renderHook(({ range }) => useCalendar("venue-a", range), { initialProps: { range: first } });
    await waitFor(() => { expect(result.current.data?.venueId).toBe("venue-a"); });
    rerender({ range: second });
    expect(result.current.data).toBeNull();
    expect(result.current.status).toBe("loading");
    expect(result.current.frame?.venueId).toBe("venue-a");
    expect(result.current.isRefreshing).toBe(false);
  });

  it("reads the next range ahead, shows it at once on arrival, and reads it again", async () => {
    const reread = deferred<CalendarResponse>();
    getCalendar.mockResolvedValueOnce(response("venue-a")).mockResolvedValueOnce(response("venue-a")).mockReturnValueOnce(reread.promise);
    const { result, rerender } = renderHook(({ range, next }) => useCalendar("venue-a", range, next),
      { initialProps: { range: first, next: [second] } });
    await waitFor(() => { expect(getCalendar).toHaveBeenCalledTimes(2); });
    expect(getCalendar.mock.calls[1]?.[1]).toBe(new Date(second.fromMs).toISOString());
    await flush();

    rerender({ range: second, next: [] });
    expect(result.current.status).toBe("ready");
    expect(result.current.data).not.toBeNull();
    expect(result.current.isRefreshing).toBe(true);
    expect(getCalendar).toHaveBeenCalledTimes(3);
    await act(async () => { reread.resolve(response("venue-a")); await reread.promise; });
    expect(result.current.isRefreshing).toBe(false);
  });

  it("keeps the range on screen when a refresh fails, and says when", async () => {
    getCalendar.mockResolvedValueOnce(response("venue-a")).mockRejectedValueOnce(new Error("Offline"));
    const { result } = renderHook(() => useCalendar("venue-a", first));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    const readAtMs = result.current.readAtMs;
    expect(readAtMs).not.toBeNull();

    act(() => { result.current.refetch(); });
    expect(result.current.isRefreshing).toBe(true);
    await waitFor(() => { expect(result.current.refreshFailedAtMs).not.toBeNull(); });
    expect(result.current.status).toBe("ready");
    expect(result.current.data?.venueId).toBe("venue-a");
    expect(result.current.error).toBeNull();
    expect(result.current.isRefreshing).toBe(false);
    expect(result.current.readAtMs).toBe(readAtMs);
  });

  it("forgets the other ranges on a refetch, because a change can touch any week", async () => {
    getCalendar.mockResolvedValue(response("venue-a"));
    const { result, rerender } = renderHook(({ range, next }) => useCalendar("venue-a", range, next),
      { initialProps: { range: first, next: [second] } });
    await waitFor(() => { expect(getCalendar).toHaveBeenCalledTimes(2); });
    await flush();

    rerender({ range: first, next: [] });
    act(() => { result.current.refetch(); });
    await waitFor(() => { expect(result.current.isRefreshing).toBe(false); });
    getCalendar.mockImplementation(() => new Promise(() => undefined));
    rerender({ range: second, next: [] });
    expect(result.current.data).toBeNull();
    expect(result.current.status).toBe("loading");
    expect(result.current.frame?.venueId).toBe("venue-a");
  });

  it("waits for a fresh read of a range read ahead too long ago", async () => {
    let now = Date.parse("2026-09-27T09:00:00.000Z");
    vi.spyOn(Date, "now").mockImplementation(() => now);
    getCalendar.mockResolvedValueOnce(response("venue-a")).mockResolvedValueOnce(response("venue-a"))
      .mockImplementation(() => new Promise(() => undefined));
    const { result, rerender } = renderHook(({ range, next }) => useCalendar("venue-a", range, next),
      { initialProps: { range: first, next: [second] } });
    await waitFor(() => { expect(getCalendar).toHaveBeenCalledTimes(2); });
    await flush();

    now += CALENDAR_REUSE_MS + 60_000;
    rerender({ range: second, next: [] });
    expect(result.current.data).toBeNull();
    expect(result.current.status).toBe("loading");
  });

  it("keeps the range it is on however long the board stays open", async () => {
    let now = Date.parse("2026-09-27T09:00:00.000Z");
    vi.spyOn(Date, "now").mockImplementation(() => now);
    getCalendar.mockResolvedValue(response("venue-a"));
    const { result, rerender } = renderHook(({ range }) => useCalendar("venue-a", range), { initialProps: { range: first } });
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    now += 3 * CALENDAR_REUSE_MS;
    rerender({ range: first });
    expect(result.current.data?.venueId).toBe("venue-a");
  });

  it("does not keep a read ahead that set out before a refetch", async () => {
    const ahead = deferred<CalendarResponse>();
    getCalendar.mockResolvedValueOnce(response("venue-a")).mockReturnValueOnce(ahead.promise)
      .mockResolvedValueOnce(response("venue-a")).mockImplementation(() => new Promise(() => undefined));
    const { result, rerender } = renderHook(({ range, next }) => useCalendar("venue-a", range, next),
      { initialProps: { range: first, next: [second] } });
    await waitFor(() => { expect(getCalendar).toHaveBeenCalledTimes(2); });

    // A colleague's change arrives while the read ahead is out, and the read
    // ahead lands in the same moment, before the board has redrawn.
    await act(async () => {
      result.current.refetch();
      ahead.resolve(response("venue-a"));
      await ahead.promise;
      await Promise.resolve();
    });
    await waitFor(() => { expect(result.current.isRefreshing).toBe(false); });
    rerender({ range: second, next: [] });
    expect(result.current.data).toBeNull();
    expect(result.current.status).toBe("loading");
  });

  it("says nothing when a read ahead fails; the visit reads the range itself", async () => {
    getCalendar.mockResolvedValueOnce(response("venue-a")).mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce(response("venue-a"));
    const { result, rerender } = renderHook(({ range, next }) => useCalendar("venue-a", range, next),
      { initialProps: { range: first, next: [second] } });
    await waitFor(() => { expect(getCalendar).toHaveBeenCalledTimes(2); });
    await flush();
    expect(result.current.status).toBe("ready");
    expect(result.current.error).toBeNull();
    expect(result.current.refreshFailedAtMs).toBeNull();

    rerender({ range: second, next: [] });
    expect(result.current.status).toBe("loading");
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
  });
});
