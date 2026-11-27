import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VenueRequest } from "@omnitwin/types";
import { listEventRequests } from "../../api/conversations.js";
import { useEventRequests } from "../use-event-requests.js";

vi.mock("../../api/conversations.js", () => ({ listEventRequests: vi.fn() }));
const list = vi.mocked(listEventRequests);

const EVENT = "11111111-1111-4111-8111-111111111111";

function request(id: string, createdAt: string): VenueRequest {
  return {
    id, venueId: "00000000-0000-4000-8000-00000000a001", bookingId: "00000000-0000-4000-8000-0000000000b2", eventId: EVENT,
    roomId: "00000000-0000-4000-8000-0000000000a1", roomName: "Grand Hall", kind: "chairs", quantity: 10, urgency: "soon", detail: null,
    requestedByUserId: "00000000-0000-4000-8000-0000000000aa", requestedByName: "Morag", requestedByRole: "client",
    audienceRoles: ["admin", "manager", "staff", "hallkeeper"], ownerUserId: null, ownerName: null, state: "sent", outcome: null,
    outcomeNote: null, escalationDueAt: null, escalatedAt: null, acknowledgedAt: null, acceptedAt: null, resolvedAt: null,
    threadId: null, handoverToUserId: null, handoverToName: null, handedOverAt: null, underwayAt: null, reopenedAt: null,
    createdAt, updatedAt: createdAt,
  };
}

const earlier = request("00000000-0000-4000-8000-0000000000d0", "2026-11-11T10:00:00.000Z");
const justMade = request("00000000-0000-4000-8000-0000000000d1", "2026-11-11T10:05:00.000Z");

beforeEach(() => { list.mockReset(); });
afterEach(() => { cleanup(); });

describe("useEventRequests", () => {
  it("keeps a request the page has just made when a poll sent before it lands afterwards (web-lib-state-7)", async () => {
    list.mockResolvedValueOnce([earlier]);
    const { result } = renderHook(() => useEventRequests(EVENT, { pollMs: 60_000 }));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });

    // A poll goes out and the server reads the list before the new request exists.
    let landStale: ((rows: readonly VenueRequest[]) => void) | undefined;
    list.mockImplementationOnce(() => new Promise<readonly VenueRequest[]>((resolve) => { landStale = resolve; }));
    act(() => { result.current.refresh(); });
    expect(list).toHaveBeenCalledTimes(2);

    // The POST answers and the page shows the request at once; the server now holds it.
    list.mockResolvedValue([justMade, earlier]);
    act(() => { result.current.merge(justMade); });
    expect(result.current.requests.map((row) => row.id)).toEqual([justMade.id, earlier.id]);

    // The older answer arrives after the merge.
    await act(async () => { landStale?.([earlier]); await Promise.resolve(); });
    expect(result.current.requests.map((row) => row.id)).toEqual([justMade.id, earlier.id]);
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(3); });
    expect(result.current.requests.map((row) => row.id)).toEqual([justMade.id, earlier.id]);
  });
});
