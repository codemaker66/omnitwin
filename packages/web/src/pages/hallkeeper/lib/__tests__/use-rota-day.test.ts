import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { RotaShift, RotaWeek } from "@omnitwin/types";
import { ROTA_REREAD_MS, useRotaDay } from "../use-rota-day.js";

// ---------------------------------------------------------------------------
// The board's read of the rota: the weeks its day touches, merged; again as
// the board refreshes, but no more than every five minutes; nothing for a
// reader who may see only their own shifts; and the last good read kept
// when a read fails.
// ---------------------------------------------------------------------------

const getRotaWeekMock = vi.hoisted(() => vi.fn<(venueId: string, start: string | null, signal?: AbortSignal) => Promise<RotaWeek>>());
vi.mock("../../../../api/rota.js", () => ({
  getRotaWeek: (venueId: string, start: string | null, signal?: AbortSignal) => getRotaWeekMock(venueId, start, signal),
}));

const VENUE = "00000000-0000-4000-8000-000000000001";
const TZ = "Europe/London";
// Sunday 15 November 2026, 04:00 to Monday 04:00: two rota weeks.
const SUNDAY = { fromMs: Date.parse("2026-11-15T04:00:00Z"), toMs: Date.parse("2026-11-16T04:00:00Z") };
const SATURDAY = { fromMs: Date.parse("2026-11-14T04:00:00Z"), toMs: Date.parse("2026-11-15T04:00:00Z") };

function shift(id: string): RotaShift {
  return {
    id, venueId: VENUE, staffMemberId: null, role: "setup", startsAt: "2026-11-15T12:00:00.000Z", endsAt: "2026-11-15T16:00:00.000Z",
    breakMinutes: 0, eventId: null, eventName: null, spaceId: null, spaceName: null, note: null, status: "published", revision: 1,
    publishedAt: null, cancelledAt: null, cancellationNoticeHours: null, updatedAt: "2026-11-10T09:00:00.000Z", updatedByName: null, issues: [],
  };
}

function week(start: string, shifts: readonly RotaShift[], access: RotaWeek["access"] = "read"): RotaWeek {
  return {
    venueId: VENUE, timeZone: TZ, weekStart: start, from: `${start}T00:00:00.000Z`, to: `${start}T00:00:00.000Z`, access,
    people: [{ id: "00000000-0000-4000-8000-0000000000f1", displayName: "Jamie", employmentType: "casual", skills: ["setup"], isActive: true, hasAccount: false }],
    records: [], shifts: [...shifts], unavailability: [], rooms: [], accounts: [],
  };
}

const A = "00000000-0000-4000-8000-0000000005a1";
const B = "00000000-0000-4000-8000-0000000005b1";

beforeEach(() => { getRotaWeekMock.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe("useRotaDay", () => {
  it("reads both weeks a Sunday's late hours touch, and merges them once each", async () => {
    getRotaWeekMock.mockImplementation((_venue, start) => Promise.resolve(start === "2026-11-09" ? week(start, [shift(A)]) : week(start ?? "", [shift(A), shift(B)])));
    const { result } = renderHook(() => useRotaDay(VENUE, SUNDAY, TZ, true));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    expect(getRotaWeekMock.mock.calls.map(([, start]) => start)).toEqual(["2026-11-09", "2026-11-16"]);
    expect(result.current.shifts.map((item) => item.id)).toEqual([A, B]);
    expect(result.current.people).toHaveLength(1);
  });

  it("reads again as the board refreshes, but not within five minutes of the last read", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-11-14T10:00:00Z"));
    getRotaWeekMock.mockImplementation((_venue, start) => Promise.resolve(week(start ?? "", [shift(A)])));
    const { result } = renderHook(() => useRotaDay(VENUE, SATURDAY, TZ, true));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    expect(getRotaWeekMock).toHaveBeenCalledTimes(1);
    act(() => { result.current.refresh(); });
    expect(getRotaWeekMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.parse("2026-11-14T10:00:00Z") + ROTA_REREAD_MS);
    act(() => { result.current.refresh(); });
    await waitFor(() => { expect(getRotaWeekMock).toHaveBeenCalledTimes(2); });
  });

  it("shows no crew to someone who may read only their own shifts", async () => {
    getRotaWeekMock.mockImplementation((_venue, start) => Promise.resolve(week(start ?? "", [shift(A)], "own")));
    const { result } = renderHook(() => useRotaDay(VENUE, SATURDAY, TZ, true));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    expect(result.current.shifts).toEqual([]);
  });

  it("keeps the last good read when a read fails, and tries again at the next refresh", async () => {
    getRotaWeekMock.mockImplementationOnce((_venue, start) => Promise.resolve(week(start ?? "", [shift(A)])));
    const { result } = renderHook(() => useRotaDay(VENUE, SATURDAY, TZ, true));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + ROTA_REREAD_MS);
    getRotaWeekMock.mockImplementation(() => Promise.reject(new Error("offline")));
    act(() => { result.current.refresh(); });
    await waitFor(() => { expect(result.current.status).toBe("error"); });
    expect(result.current.shifts.map((item) => item.id)).toEqual([A]);
    // A failure is not held for five minutes.
    act(() => { result.current.refresh(); });
    await waitFor(() => { expect(getRotaWeekMock).toHaveBeenCalledTimes(3); });
  });

  it("reads nothing without a venue", () => {
    const { result } = renderHook(() => useRotaDay(null, SATURDAY, TZ, true));
    expect(result.current.status).toBe("idle");
    expect(getRotaWeekMock).not.toHaveBeenCalled();
  });
});
