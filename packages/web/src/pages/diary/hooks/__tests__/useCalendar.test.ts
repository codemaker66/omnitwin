import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { CalendarResponse } from "@omnitwin/types";
import { useCalendar } from "../useCalendar.js";
import { boardRange } from "../../lib/board-time.js";

const { getCalendar } = vi.hoisted(() => ({ getCalendar: vi.fn() }));
vi.mock("../../../../api/diary.js", () => ({ getCalendar }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const first = boardRange(Date.parse("2026-09-07T12:00Z"), "week");
const second = boardRange(Date.parse("2026-09-14T12:00Z"), "week");
const response = (venueId: string): CalendarResponse => ({ venueId,
  range: { from: new Date(first.fromMs).toISOString(), to: new Date(first.toMs).toISOString() },
  rooms: [], entries: [], conflicts: { conflicts: [], checks: { inkDoubleBook: { status: "checked" }, holdOverlap: { status: "checked" }, turnaround: { status: "checked", uncoveredPairCount: 0, detail: "Checked" } } },
});

describe("useCalendar request identity", () => {
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
