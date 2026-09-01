import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import type { EventPhaseGraph } from "@omnitwin/types";

vi.mock("../../api/events.js", () => ({ getEventPhaseGraph: vi.fn() }));

const eventsApi = vi.mocked(await import("../../api/events.js"));
const { useLinkedEvent } = await import("../use-linked-event.js");
const { useAuthStore } = await import("../../stores/auth-store.js");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useAuthStore.getState().logout();
});

function wrapperFor(url: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>;
  };
}

const now = "2026-06-11T10:00:00.000Z";
const fakeGraph: EventPhaseGraph = {
  event: {
    id: "00000000-0000-4000-8000-000000000001",
    venueId: "00000000-0000-4000-8000-000000000002",
    createdBy: null,
    name: "Spring Wedding",
    eventType: "wedding",
    status: "in_planning",
    startsAt: now,
    endsAt: null,
    guestCount: 120,
    clientName: null,
    notes: null,
    createdAt: now,
    updatedAt: now,
  },
  phases: [],
  scenarios: [],
  layoutVariants: [],
  configurationLinks: [],
  phaseLayoutSnapshots: [],
};

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolvePromise: ((value: T) => void) | undefined;
  return {
    promise: new Promise<T>((resolve) => { resolvePromise = resolve; }),
    resolve: (value) => { resolvePromise?.(value); },
  };
}

describe("useLinkedEvent", () => {
  it("reports 'none' with no eventId param and never calls the API", () => {
    const { result } = renderHook(() => useLinkedEvent(), { wrapper: wrapperFor("/plan/cfg-1") });
    expect(result.current.status).toBe("none");
    expect(result.current.eventName).toBeNull();
    expect(eventsApi.getEventPhaseGraph).not.toHaveBeenCalled();
  });

  it("loads the event graph when ?eventId is present", async () => {
    eventsApi.getEventPhaseGraph.mockResolvedValue(fakeGraph);
    const { result } = renderHook(() => useLinkedEvent(), {
      wrapper: wrapperFor(`/plan/cfg-1?eventId=${fakeGraph.event.id}`),
    });
    await waitFor(() => { expect(result.current.status).toBe("loaded"); });
    expect(result.current.eventName).toBe("Spring Wedding");
    expect(eventsApi.getEventPhaseGraph).toHaveBeenCalledWith(fakeGraph.event.id);
  });

  it("reports 'error' and no event name when the fetch fails", async () => {
    eventsApi.getEventPhaseGraph.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useLinkedEvent(), {
      wrapper: wrapperFor("/plan/cfg-1?eventId=evt-2"),
    });
    await waitFor(() => { expect(result.current.status).toBe("error"); });
    expect(result.current.eventName).toBeNull();
  });

  it("rejects a valid graph whose event identity differs from the request", async () => {
    eventsApi.getEventPhaseGraph.mockResolvedValue(fakeGraph);
    const requested = "99999999-9999-4999-8999-999999999999";
    const { result } = renderHook(() => useLinkedEvent(), {
      wrapper: wrapperFor(`/plan/cfg-1?eventId=${requested}`),
    });

    await waitFor(() => { expect(result.current.status).toBe("error"); });
    expect(result.current.graph).toBeNull();
    expect(result.current.eventName).toBeNull();
  });

  it("rejects a linked graph from a different selected venue", async () => {
    eventsApi.getEventPhaseGraph.mockResolvedValue(fakeGraph);
    const { result } = renderHook(() => useLinkedEvent(
      "99999999-9999-4999-8999-999999999999",
    ), {
      wrapper: wrapperFor(`/plan/cfg-1?eventId=${fakeGraph.event.id}`),
    });

    await waitFor(() => { expect(result.current.status).toBe("error"); });
    expect(result.current.graph).toBeNull();
  });

  it("rejects a graph whose nested phase belongs to a different event", async () => {
    const inconsistentGraph: EventPhaseGraph = {
      ...fakeGraph,
      phases: [{
        id: "11111111-1111-4111-8111-111111111111",
        eventId: "99999999-9999-4999-8999-999999999999",
        spaceId: "22222222-2222-4222-8222-222222222222",
        templateKey: "arrival",
        name: "Arrival",
        sortOrder: 0,
        startsAt: now,
        durationMinutes: 30,
        guestCount: 120,
        opsTasksCount: 0,
        reviewGatesCount: 0,
        densityStatus: "not_checked",
        densityLabel: "Density not checked",
        staffConflictsStatus: "not_checked",
        staffConflictsLabel: "Staff conflicts not checked",
        notes: null,
        createdAt: now,
        updatedAt: now,
      }],
    };
    eventsApi.getEventPhaseGraph.mockResolvedValue(inconsistentGraph);
    const { result } = renderHook(() => useLinkedEvent(fakeGraph.event.venueId), {
      wrapper: wrapperFor(`/plan/cfg-1?eventId=${fakeGraph.event.id}`),
    });

    await waitFor(() => { expect(result.current.status).toBe("error"); });
    expect(result.current.graph).toBeNull();
  });

  it("masks stale graph data and ignores late responses across auth changes and logout", async () => {
    const anonymous = deferred<EventPhaseGraph>();
    const staff = deferred<EventPhaseGraph>();
    const loggedOut = deferred<EventPhaseGraph>();
    eventsApi.getEventPhaseGraph
      .mockImplementationOnce(() => anonymous.promise)
      .mockImplementationOnce(() => staff.promise)
      .mockImplementationOnce(() => loggedOut.promise);
    const { result } = renderHook(() => useLinkedEvent(), {
      wrapper: wrapperFor(`/plan/cfg-1?eventId=${fakeGraph.event.id}`),
    });
    expect(result.current.status).toBe("loading");

    act(() => {
      useAuthStore.getState().setUser({
        id: "staff-user",
        email: "staff@venue.test",
        role: "staff",
        platformRole: "none",
        venueId: fakeGraph.event.venueId,
        name: "Venue Staff",
      });
    });
    expect(result.current.status).toBe("loading");
    expect(result.current.graph).toBeNull();
    act(() => { anonymous.resolve(fakeGraph); });
    expect(result.current.status).toBe("loading");
    act(() => { staff.resolve(fakeGraph); });
    await waitFor(() => { expect(result.current.status).toBe("loaded"); });

    act(() => { useAuthStore.getState().logout(); });
    expect(result.current.status).toBe("loading");
    expect(result.current.graph).toBeNull();
    expect(result.current.eventName).toBeNull();
    act(() => { loggedOut.resolve(fakeGraph); });
    await waitFor(() => { expect(result.current.status).toBe("loaded"); });
    expect(eventsApi.getEventPhaseGraph).toHaveBeenCalledTimes(3);
  });

  it("masks stale data and ignores a late response when the live URL eventId changes", async () => {
    const first = deferred<EventPhaseGraph>();
    const second = deferred<EventPhaseGraph>();
    const nextGraph: EventPhaseGraph = {
      ...fakeGraph,
      event: {
        ...fakeGraph.event,
        id: "99999999-9999-4999-8999-999999999999",
        name: "Autumn Gala",
      },
    };
    eventsApi.getEventPhaseGraph
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { result } = renderHook(() => ({
      linked: useLinkedEvent(),
      navigate: useNavigate(),
    }), {
      wrapper: wrapperFor(`/plan/cfg-1?eventId=${fakeGraph.event.id}`),
    });
    expect(result.current.linked.status).toBe("loading");

    act(() => {
      void result.current.navigate(`/plan/cfg-1?eventId=${nextGraph.event.id}`);
    });
    expect(result.current.linked.status).toBe("loading");
    expect(result.current.linked.graph).toBeNull();
    expect(result.current.linked.eventName).toBeNull();

    act(() => { first.resolve(fakeGraph); });
    expect(result.current.linked.status).toBe("loading");
    expect(result.current.linked.graph).toBeNull();

    act(() => { second.resolve(nextGraph); });
    await waitFor(() => { expect(result.current.linked.status).toBe("loaded"); });
    expect(result.current.linked.graph?.event.id).toBe(nextGraph.event.id);
    expect(result.current.linked.eventName).toBe("Autumn Gala");
    expect(eventsApi.getEventPhaseGraph).toHaveBeenNthCalledWith(1, fakeGraph.event.id);
    expect(eventsApi.getEventPhaseGraph).toHaveBeenNthCalledWith(2, nextGraph.event.id);
  });
});
