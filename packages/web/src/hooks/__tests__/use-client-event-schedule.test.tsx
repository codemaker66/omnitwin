import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientEventSchedule } from "@omnitwin/types";
import { ApiError } from "../../api/client.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { useClientEventSchedule } from "../use-client-event-schedule.js";
import { getClientEventSchedule } from "../../api/client-event-schedule.js";

vi.mock("../../api/client-event-schedule.js", () => ({ getClientEventSchedule: vi.fn() }));
const request = vi.mocked(getClientEventSchedule);
const EVENT = "11111111-1111-4111-8111-111111111111";
const CONFIG = "22222222-2222-4222-8222-222222222222";
const VENUE = "33333333-3333-4333-8333-333333333333";
const ROOM = "44444444-4444-4444-8444-444444444444";
const schedule: ClientEventSchedule = { event: { id: EVENT, venueId: VENUE, name: "Autumn celebration", eventType: null, status: "draft", startsAt: null, endsAt: null, guestCount: 12 },
  venue: { id: VENUE, name: "City rooms", timezone: "Europe/London" }, scheduleState: "working", phases: [],
  layouts: [{ id: CONFIG, name: "Dinner layout", space: { id: ROOM, name: "Ballroom" } }] };
function user(id = "owner", role = "client"): void {
  useAuthStore.getState().setUser({ id, role, platformRole: "none", name: "Owner", venueId: null, email: "owner@example.test" });
}
function deferred() {
  let resolve: (value: ClientEventSchedule) => void = () => undefined;
  const promise = new Promise<ClientEventSchedule>((accept) => { resolve = accept; });
  return { promise, resolve };
}
beforeEach(() => { request.mockReset(); user(); });
afterEach(() => { cleanup(); useAuthStore.getState().logout(); });

describe("useClientEventSchedule", () => {
  it("binds a successful read to the current event, venue and layout", async () => {
    request.mockResolvedValue(schedule);
    const { result } = renderHook(() => useClientEventSchedule(EVENT, { configurationId: CONFIG, expectedVenueId: VENUE }));
    expect(result.current.status).toBe("loading");
    await waitFor(() => { expect(result.current.status).toBe("loaded"); });
    expect(request).toHaveBeenCalledWith(EVENT, CONFIG, expect.any(AbortSignal));
    expect(result.current.data?.event.name).toBe("Autumn celebration");
  });

  it.each(["event", "venue", "layout"] as const)("rejects a mismatched %s response", async (mismatch) => {
    request.mockResolvedValue({ ...schedule,
      ...(mismatch === "event" ? { event: { ...schedule.event, id: ROOM } } : {}),
      ...(mismatch === "venue" ? { venue: { ...schedule.venue, id: ROOM } } : {}),
      ...(mismatch === "layout" ? { layouts: [] } : {}),
    });
    const { result } = renderHook(() => useClientEventSchedule(EVENT, { configurationId: CONFIG, expectedVenueId: VENUE }));
    await waitFor(() => { expect(result.current.status).toBe("error"); });
    expect(result.current.data).toBeNull();
  });

  it("does not fetch an unlinked plan, signed-out account or disabled staff projection", () => {
    const { result, rerender } = renderHook(({ eventId, enabled }) => useClientEventSchedule(eventId, { enabled }), { initialProps: { eventId: null as string | null, enabled: true } });
    expect(result.current.status).toBe("none");
    rerender({ eventId: EVENT, enabled: false });
    expect(result.current.status).toBe("none");
    act(() => { useAuthStore.getState().logout(); });
    rerender({ eventId: EVENT, enabled: true });
    expect(result.current.status).toBe("sign-in-required");
    expect(request).not.toHaveBeenCalled();
  });

  it.each([403, 404])("clears previously loaded information when access returns %s", async (status) => {
    request.mockResolvedValueOnce(schedule).mockRejectedValueOnce(new ApiError(status, "Unavailable", "NOT_FOUND"));
    const { result } = renderHook(() => useClientEventSchedule(EVENT));
    await waitFor(() => { expect(result.current.data).not.toBeNull(); });
    act(() => { result.current.refresh(); });
    expect(result.current.data).toBeNull();
    await waitFor(() => { expect(result.current.status).toBe("unavailable"); });
  });

  it("waits for the selected saved layout rather than using an unbound event request", async () => {
    request.mockResolvedValue(schedule);
    const { result, rerender } = renderHook(({ configurationId }: { configurationId: string | null }) => useClientEventSchedule(EVENT, { configurationId }), { initialProps: { configurationId: null as string | null } });
    expect(result.current.status).toBe("loading");
    expect(request).not.toHaveBeenCalled();
    rerender({ configurationId: CONFIG });
    await waitFor(() => { expect(result.current.status).toBe("loaded"); });
    expect(request.mock.calls[0]?.slice(0, 2)).toEqual([EVENT, CONFIG]);
    rerender({ configurationId: null });
    expect(result.current.data).toBeNull();
    expect(result.current.status).toBe("loading");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("aborts and masks a late response after account, role or layout changes", async () => {
    const old = deferred();
    const current = deferred();
    request.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const { result, rerender } = renderHook(({ configurationId }) => useClientEventSchedule(EVENT, { configurationId }), { initialProps: { configurationId: CONFIG } });
    const signal = request.mock.calls[0]?.[2];
    act(() => { user("new-owner", "planner"); });
    expect(signal?.aborted).toBe(true);
    expect(result.current.data).toBeNull();
    act(() => { old.resolve(schedule); });
    expect(result.current.status).toBe("loading");
    act(() => { current.resolve(schedule); });
    await waitFor(() => { expect(result.current.status).toBe("loaded"); });
    request.mockReturnValue(new Promise(() => undefined));
    rerender({ configurationId: ROOM });
    expect(result.current.data).toBeNull();
    expect(result.current.status).toBe("loading");
  });
});
