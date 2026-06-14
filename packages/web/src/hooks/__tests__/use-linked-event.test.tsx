import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type { EventPhaseGraph } from "@omnitwin/types";

vi.mock("../../api/events.js", () => ({ getEventPhaseGraph: vi.fn() }));

const eventsApi = vi.mocked(await import("../../api/events.js"));
const { useLinkedEvent } = await import("../use-linked-event.js");

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function wrapperFor(url: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>;
  };
}

const fakeGraph = {
  event: { name: "Spring Wedding" },
  phases: [{ id: "ceremony", name: "Ceremony" }],
} as unknown as EventPhaseGraph;

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
      wrapper: wrapperFor("/plan/cfg-1?eventId=evt-1"),
    });
    await waitFor(() => { expect(result.current.status).toBe("loaded"); });
    expect(result.current.eventName).toBe("Spring Wedding");
    expect(eventsApi.getEventPhaseGraph).toHaveBeenCalledWith("evt-1");
  });

  it("reports 'error' and no event name when the fetch fails", async () => {
    eventsApi.getEventPhaseGraph.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useLinkedEvent(), {
      wrapper: wrapperFor("/plan/cfg-1?eventId=evt-2"),
    });
    await waitFor(() => { expect(result.current.status).toBe("error"); });
    expect(result.current.eventName).toBeNull();
  });
});
