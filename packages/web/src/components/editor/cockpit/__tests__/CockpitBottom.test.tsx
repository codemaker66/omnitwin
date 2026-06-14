import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { EventPhaseGraph, EventPhase } from "@omnitwin/types";

vi.mock("../../../../api/events.js", () => ({ getEventPhaseGraph: vi.fn() }));

const eventsApi = vi.mocked(await import("../../../../api/events.js"));
const { CockpitBottom } = await import("../CockpitBottom.js");
const { useCockpitStore } = await import("../../../../stores/cockpit-store.js");

const now = "2026-06-11T10:00:00.000Z";

function phase(id: string, name: string, gates: number): EventPhase {
  return {
    id, eventId: "e1", templateKey: null, name, sortOrder: 0, startsAt: now,
    durationMinutes: 45, guestCount: null, opsTasksCount: 6, reviewGatesCount: gates,
    densityStatus: "not_checked", densityLabel: "Density not checked",
    staffConflictsStatus: "not_checked", staffConflictsLabel: "Staff conflicts not checked",
    notes: null, createdAt: now, updatedAt: now,
  };
}

const graph: EventPhaseGraph = {
  event: {
    id: "e1", venueId: "v1", createdBy: null, name: "Wedding", eventType: "wedding",
    status: "in_planning", startsAt: now, endsAt: null, guestCount: 120,
    clientName: null, notes: null, createdAt: now, updatedAt: now,
  },
  phases: [phase("a", "Arrival", 0), phase("d", "Dinner", 2)],
  scenarios: [], layoutVariants: [], configurationLinks: [], phaseLayoutSnapshots: [],
};

function renderBottom(url: string): void {
  render(<MemoryRouter initialEntries={[url]}><CockpitBottom /></MemoryRouter>);
}

beforeEach(() => { useCockpitStore.getState().reset(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("CockpitBottom", () => {
  it("shows a SAFE empty timeline and never fetches when no event is linked", () => {
    renderBottom("/plan/cfg-1");
    expect(screen.getByText(/no event linked/i)).toBeTruthy();
    expect(eventsApi.getEventPhaseGraph).not.toHaveBeenCalled();
  });

  it("renders the linked phases and selects one on click", async () => {
    eventsApi.getEventPhaseGraph.mockResolvedValue(graph);
    renderBottom("/plan/cfg-1?eventId=evt-1");
    await waitFor(() => { expect(screen.getByRole("button", { name: /arrival/i })).toBeTruthy(); });
    fireEvent.click(screen.getByRole("button", { name: /dinner/i }));
    expect(useCockpitStore.getState().selectedPhaseId).toBe("d");
  });

  it("switches the cockpit lens when an insight card is clicked", () => {
    renderBottom("/plan/cfg-1");
    fireEvent.click(screen.getByRole("button", { name: /ops compiler/i }));
    expect(useCockpitStore.getState().activeMode).toBe("ops");
  });
});
