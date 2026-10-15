import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { Booking, CalendarResponse } from "@omnitwin/types";
import { ApiError } from "../../../../api/client.js";
import type { Enquiry } from "../../../../api/enquiries.js";
import { ENQUIRY_DAY_SETTLE_MS, enquiryDayPlan, useEnquiryDay } from "../use-enquiry-day.js";

// ---------------------------------------------------------------------------
// The open enquiry's Diary reads: a quarter second after it is shown, only
// where the person stops, a kept answer at once, failures kept honest, and
// nothing more read after a refusal.
// ---------------------------------------------------------------------------

const { getCalendar, listEnquiryBookings } = vi.hoisted(() => ({ getCalendar: vi.fn(), listEnquiryBookings: vi.fn() }));
vi.mock("../../../../api/diary.js", () => ({ getCalendar, listEnquiryBookings }));

const VENUE = "venue-1";

function enquiry(id: string, overrides: Partial<Enquiry> = {}): Enquiry {
  return {
    id, venueId: VENUE, spaceId: "room-1", configurationId: null, userId: null, guestEmail: null, guestPhone: null,
    guestName: null, state: "under_review", name: "Priya Shah", email: "priya@lumen.example", preferredDate: "2027-05-14",
    eventType: "wedding", estimatedGuests: 140, message: null, source: "website", roomChosen: true,
    createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z", ...overrides,
  };
}

function calendar(title: string): CalendarResponse {
  return {
    venueId: VENUE,
    range: { from: "2027-05-13T23:00:00.000Z", to: "2027-05-14T23:00:00.000Z" },
    rooms: [{ id: "room-1", name: title, slug: "grand-hall", sortOrder: 0 }],
    entries: [],
    conflicts: { conflicts: [], checks: { inkDoubleBook: { status: "checked" }, holdOverlap: { status: "checked" }, turnaround: { status: "checked", uncoveredPairCount: 0, detail: "Checked" } } },
  };
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void; readonly reject: (reason: Error) => void } {
  let resolvePromise: (value: T) => void = () => { throw new Error("Promise not initialized"); };
  let rejectPromise: (reason: Error) => void = () => { throw new Error("Promise not initialized"); };
  const promise = new Promise<T>((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

const NO_BOOKINGS: readonly Booking[] = [];

async function settle(ms = ENQUIRY_DAY_SETTLE_MS): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

/** Lets the reads' answers reach the hook. */
async function land(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
  });
}

beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });

describe("enquiryDayPlan", () => {
  it("reads only a booking enquiry at the reader's own venue", () => {
    expect(enquiryDayPlan(enquiry("a"), VENUE)?.day).toEqual({
      iso: "2027-05-14", startMs: Date.parse("2027-05-13T23:00:00.000Z"), endMs: Date.parse("2027-05-14T23:00:00.000Z"),
    });
    expect(enquiryDayPlan(enquiry("a"), null)).toBeNull();
    expect(enquiryDayPlan(enquiry("a"), "venue-2")).toBeNull();
    expect(enquiryDayPlan(enquiry("a", { eventType: "venue-access" }), VENUE)).toBeNull();
    expect(enquiryDayPlan(undefined, VENUE)).toBeNull();
  });

  it("reads no day for a closed enquiry or one with no date, only its own bookings", () => {
    expect(enquiryDayPlan(enquiry("a", { state: "rejected" }), VENUE)).toEqual({ enquiryId: "a", venueId: VENUE, day: null });
    expect(enquiryDayPlan(enquiry("a", { preferredDate: null }), VENUE)?.day).toBeNull();
    expect(enquiryDayPlan(enquiry("a", { preferredDate: "2027-02-30" }), VENUE)?.day).toBeNull();
  });
});

describe("useEnquiryDay", () => {
  it("reads nothing for an enquiry the reader reads no Diary for", async () => {
    const { result } = renderHook(() => useEnquiryDay(enquiry("a"), null));
    await settle();
    expect(result.current.status).toBe("off");
    expect(getCalendar).not.toHaveBeenCalled();
    expect(listEnquiryBookings).not.toHaveBeenCalled();
  });

  it("waits a quarter second, then reads the day asked for and the enquiry's own bookings", async () => {
    const day = deferred<CalendarResponse>();
    const own = deferred<readonly Booking[]>();
    getCalendar.mockReturnValue(day.promise);
    listEnquiryBookings.mockReturnValue(own.promise);
    const { result } = renderHook(() => useEnquiryDay(enquiry("a"), VENUE));
    expect(result.current.status).toBe("waiting");
    await settle(ENQUIRY_DAY_SETTLE_MS - 1);
    expect(getCalendar).not.toHaveBeenCalled();
    await settle(1);
    expect(getCalendar).toHaveBeenCalledWith(VENUE, "2027-05-13T23:00:00.000Z", "2027-05-14T23:00:00.000Z", expect.any(AbortSignal));
    expect(listEnquiryBookings).toHaveBeenCalledWith("a", expect.any(AbortSignal));
    expect(result.current.status).toBe("reading");
    await act(async () => {
      day.resolve(calendar("Grand Hall"));
      own.resolve(NO_BOOKINGS);
      await Promise.all([day.promise, own.promise]);
    });
    await land();
    expect(result.current.status).toBe("ready");
    expect(result.current.answer?.day?.rooms.map((room) => room.name)).toEqual(["Grand Hall"]);
    expect(result.current.settled).toBe(1);
  });

  it("reads only where the person stops when stepping through", async () => {
    getCalendar.mockResolvedValue(calendar("Grand Hall"));
    listEnquiryBookings.mockResolvedValue(NO_BOOKINGS);
    const { rerender } = renderHook(({ open }) => useEnquiryDay(open, VENUE), { initialProps: { open: enquiry("a") } });
    await settle(100);
    rerender({ open: enquiry("b") });
    await settle(100);
    rerender({ open: enquiry("c") });
    await settle();
    expect(listEnquiryBookings.mock.calls.map((call) => call[0] as unknown)).toEqual(["c"]);
  });

  it("shows a kept answer at once when an enquiry is shown again, and reads it again", async () => {
    getCalendar.mockResolvedValue(calendar("Grand Hall"));
    listEnquiryBookings.mockResolvedValue(NO_BOOKINGS);
    const { result, rerender } = renderHook(({ open }) => useEnquiryDay(open, VENUE), { initialProps: { open: enquiry("a") } });
    await settle();
    await land();
    rerender({ open: enquiry("b", { preferredDate: "2027-05-15" }) });
    expect(result.current.status).toBe("waiting");
    rerender({ open: enquiry("a") });
    expect(result.current.status).toBe("ready");
    await settle();
    expect(listEnquiryBookings).toHaveBeenCalledTimes(2);
  });

  it("keeps the answer when a read again fails, and says that read failed", async () => {
    getCalendar.mockResolvedValueOnce(calendar("Grand Hall")).mockRejectedValueOnce(new ApiError(500, "Down", "INTERNAL"));
    listEnquiryBookings.mockResolvedValue(NO_BOOKINGS);
    const { result } = renderHook(() => useEnquiryDay(enquiry("a"), VENUE));
    await settle();
    await land();
    act(() => { result.current.readNow(); });
    expect(result.current.reading).toBe(true);
    await land();
    expect([result.current.status, result.current.failed]).toEqual(["ready", true]);
    expect(result.current.answer?.day?.rooms[0]?.name).toBe("Grand Hall");
  });

  it("says nothing could be read, and Try again reads at once", async () => {
    getCalendar.mockRejectedValueOnce(new ApiError(0, "Offline", "NETWORK_ERROR")).mockResolvedValueOnce(calendar("Grand Hall"));
    listEnquiryBookings.mockResolvedValue(NO_BOOKINGS);
    const { result } = renderHook(() => useEnquiryDay(enquiry("a"), VENUE));
    await settle();
    await land();
    expect([result.current.status, result.current.failed]).toEqual(["failed", true]);
    act(() => { result.current.readNow(); });
    // Still failed while it reads again, so Try again keeps its place.
    expect([result.current.status, result.current.failed, result.current.reading]).toEqual(["reading", true, true]);
    await land();
    expect([result.current.status, result.current.failed]).toEqual(["ready", false]);
  });

  it("fails when the enquiry's own bookings cannot be read, even with the day read", async () => {
    getCalendar.mockResolvedValue(calendar("Grand Hall"));
    listEnquiryBookings.mockRejectedValue(new ApiError(404, "Route GET:/bookings not found", "NOT_FOUND"));
    const { result } = renderHook(() => useEnquiryDay(enquiry("a"), VENUE));
    await settle();
    await land();
    expect(result.current.status).toBe("failed");
  });

  it("reads no more after a refusal", async () => {
    getCalendar.mockRejectedValue(new ApiError(403, "Forbidden", "FORBIDDEN"));
    listEnquiryBookings.mockResolvedValue(NO_BOOKINGS);
    const { result, rerender } = renderHook(({ open }) => useEnquiryDay(open, VENUE), { initialProps: { open: enquiry("a") } });
    await settle();
    await land();
    expect(result.current.status).toBe("off");
    rerender({ open: enquiry("b") });
    await settle();
    act(() => { result.current.readNow(); });
    expect(getCalendar).toHaveBeenCalledTimes(1);
  });

  it("lets an aborted read change nothing", async () => {
    const late = deferred<CalendarResponse>();
    getCalendar.mockReturnValueOnce(late.promise).mockResolvedValue(calendar("Saloon"));
    listEnquiryBookings.mockResolvedValue(NO_BOOKINGS);
    const { result, rerender } = renderHook(({ open }) => useEnquiryDay(open, VENUE), { initialProps: { open: enquiry("a") } });
    await settle();
    rerender({ open: enquiry("b", { preferredDate: "2027-05-15" }) });
    await act(async () => { late.resolve(calendar("Grand Hall")); await late.promise; });
    await land();
    rerender({ open: enquiry("a") });
    // The answer that landed after "a" was left was never kept.
    expect(result.current.status).toBe("waiting");
  });

  it("reads only its own bookings for a closed enquiry", async () => {
    listEnquiryBookings.mockResolvedValue(NO_BOOKINGS);
    const { result } = renderHook(() => useEnquiryDay(enquiry("a", { state: "withdrawn" }), VENUE));
    await settle();
    await land();
    expect(getCalendar).not.toHaveBeenCalled();
    expect(result.current.answer).toEqual({ day: null, own: [], readAtMs: expect.any(Number) as unknown });
  });

  it("reads again at once when the page comes back into view", async () => {
    getCalendar.mockResolvedValue(calendar("Grand Hall"));
    listEnquiryBookings.mockResolvedValue(NO_BOOKINGS);
    renderHook(() => useEnquiryDay(enquiry("a"), VENUE));
    await settle();
    await land();
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(listEnquiryBookings).toHaveBeenCalledTimes(2);
  });
});
