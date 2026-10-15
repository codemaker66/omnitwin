import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { RoomDay, RoomDaySpan } from "@omnitwin/types";
import { mergeRoomDaySpans, useRoomDay } from "../use-room-day.js";

// The room's day for the client's ribbon (goal 19 S6): two venue days asked
// for together, merged once, deduplicated where a booking crosses 04:00.

const { getRoomDayMock } = vi.hoisted(() => ({ getRoomDayMock: vi.fn() }));
vi.mock("../../api/when-window.js", () => ({ getRoomDay: getRoomDayMock }));

const EVENT = "00000000-0000-4000-8000-0000000000e1";
const ROOM = "00000000-0000-4000-8000-0000000000a1";
const OWN = "00000000-0000-4000-8000-0000000000b1";

function day(date: string, spans: readonly RoomDaySpan[], turnaroundMinutes = 90): RoomDay {
  return {
    eventId: EVENT, space: { id: ROOM, name: "Grand Hall" }, day: date, timezone: "Europe/London",
    range: { startsAt: `${date}T03:00:00.000Z`, endsAt: `${date}T03:00:00.000Z` }, turnaroundMinutes, spans: [...spans],
  };
}

const LATE = { kind: "busy" as const, startsAt: "2030-05-10T01:00:00.000Z", endsAt: "2030-05-10T04:30:00.000Z" };
const MORNING = { kind: "held" as const, startsAt: "2030-05-10T08:00:00.000Z", endsAt: "2030-05-10T10:00:00.000Z" };
const OURS = { kind: "yours" as const, bookingId: OWN, title: "Our dinner", startsAt: "2030-05-10T17:00:00.000Z", endsAt: "2030-05-10T22:00:00.000Z" };

afterEach(() => { getRoomDayMock.mockReset(); });

describe("mergeRoomDaySpans", () => {
  it("keeps one copy of a span both days report and sorts by start", () => {
    expect(mergeRoomDaySpans([LATE, MORNING], [OURS, LATE])).toEqual([LATE, MORNING, OURS]);
    expect(mergeRoomDaySpans([OURS], [{ ...OURS, startsAt: "2030-05-10T18:00:00.000Z" }])).toEqual([OURS]);
  });
});

describe("useRoomDay", () => {
  it("asks for the shown venue day and the one before, merges them and reports the shown day's turnaround", async () => {
    getRoomDayMock.mockImplementation((_event: string, query: { day: string }) =>
      Promise.resolve(query.day === "2030-05-10" ? day("2030-05-10", [MORNING, OURS, LATE]) : day("2030-05-09", [LATE], 30)));
    const { result } = renderHook(() => useRoomDay(EVENT, ROOM, "2030-05-10"));
    expect(result.current.status).toBe("loading");
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    expect(getRoomDayMock.mock.calls.map((call: unknown[]) => (call[1] as { day: string }).day).sort()).toEqual(["2030-05-09", "2030-05-10"]);
    expect(result.current.data).toEqual({ spans: [LATE, MORNING, OURS], turnaroundMinutes: 90 });
    expect(result.current.isRefreshing).toBe(false);
  });

  it("asks for nothing until it has an event, a room and a day", () => {
    const { result } = renderHook(() => useRoomDay(EVENT, null, "2030-05-10"));
    expect(result.current.status).toBe("loading");
    expect(result.current.data).toBeNull();
    expect(getRoomDayMock).not.toHaveBeenCalled();
  });

  it("reports an error, and a refetch keeps the last day on screen while it asks again", async () => {
    getRoomDayMock.mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useRoomDay(EVENT, ROOM, "2030-05-10"));
    await waitFor(() => { expect(result.current.status).toBe("error"); });
    getRoomDayMock.mockImplementation((_event: string, query: { day: string }) => Promise.resolve(day(query.day, query.day === "2030-05-10" ? [OURS] : [])));
    act(() => { result.current.refetch(); });
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    expect(result.current.data?.spans).toEqual([OURS]);
    const resolvers: ((value: RoomDay) => void)[] = [];
    getRoomDayMock.mockImplementation(() => new Promise<RoomDay>((resolve) => { resolvers.push(resolve); }));
    act(() => { result.current.refetch(); });
    expect(result.current.isRefreshing).toBe(true);
    expect(result.current.data?.spans).toEqual([OURS]);
    act(() => { for (const resolve of resolvers) resolve(day("2030-05-10", [MORNING, OURS])); });
    await waitFor(() => { expect(result.current.isRefreshing).toBe(false); });
  });
});
