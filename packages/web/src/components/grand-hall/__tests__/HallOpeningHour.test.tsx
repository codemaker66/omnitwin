import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ClientEventSchedule, EventPhaseGraph } from "@omnitwin/types";
import { useAuthStore } from "../../../stores/auth-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useHallTimeStore } from "../../../stores/hall-time-store.js";
import { useLinkedEvent, type LinkedEvent } from "../../../hooks/use-linked-event.js";
import { useClientEventSchedule } from "../../../hooks/use-client-event-schedule.js";
import { HallOpeningHour } from "../HallOpeningHour.js";

vi.mock("../../../hooks/use-linked-event.js", () => ({ useLinkedEvent: vi.fn() }));
vi.mock("../../../hooks/use-client-event-schedule.js", () => ({ useClientEventSchedule: vi.fn() }));

const NOW = Date.UTC(2026, 9, 17, 13, 0);
const STARTS_AT = "2026-11-14T18:30:00.000Z";
const EVENT = "00000000-0000-4000-8000-000000000001";
const VENUE = "00000000-0000-4000-8000-000000000002";
const CONFIG = "00000000-0000-4000-8000-000000000003";
const ROOM = "00000000-0000-4000-8000-000000000004";
const PLAN_PATH = `/plan/${CONFIG}?eventId=${EVENT}`;

const linked = vi.mocked(useLinkedEvent);
const schedule = vi.mocked(useClientEventSchedule);

function signIn(role: string): void {
  useAuthStore.getState().setUser({
    id: "user-1", role, platformRole: "none", name: "Someone",
    venueId: role === "client" ? null : VENUE, email: "someone@example.test",
  });
}

function staffEvent(startsAt: string | null): LinkedEvent {
  const graph: EventPhaseGraph = {
    event: {
      id: EVENT, venueId: VENUE, createdBy: null, name: "Wedding dinner", eventType: "wedding",
      status: "in_planning", startsAt, endsAt: null, guestCount: 120, clientName: null, notes: null,
      createdAt: STARTS_AT, updatedAt: STARTS_AT,
    },
    phases: [], scenarios: [], layoutVariants: [], configurationLinks: [], phaseLayoutSnapshots: [],
  };
  return { status: "loaded", eventName: graph.event.name, graph };
}

function clientSchedule(startsAt: string | null): ReturnType<typeof useClientEventSchedule> {
  const data: ClientEventSchedule = {
    event: { id: EVENT, venueId: VENUE, name: "Wedding dinner", eventType: null, status: "draft", startsAt, endsAt: null, guestCount: 120 },
    venue: { id: VENUE, name: "Trades Hall", timezone: "Europe/London" }, scheduleState: "working", phases: [],
    layouts: [{ id: CONFIG, name: "Dinner layout", space: { id: ROOM, name: "Grand Hall" } }], slots: [],
  };
  return { status: "loaded", data, refresh: () => undefined };
}

function view(path: string) {
  return <MemoryRouter initialEntries={[path]}><HallOpeningHour /></MemoryRouter>;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  useHallTimeStore.setState({ mode: "now", at: 0, scrubbing: false, openedFor: null, chosen: false });
  useEditorStore.setState({ configId: CONFIG, venueId: VENUE });
  linked.mockReturnValue({ status: "none", eventName: null, graph: null });
  schedule.mockReturnValue({ status: "none", data: null, refresh: () => undefined });
});
afterEach(() => {
  cleanup();
  useAuthStore.getState().logout();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("HallOpeningHour", () => {
  it("opens the venue team's plan at its event's start", () => {
    signIn("staff");
    linked.mockReturnValue(staffEvent(STARTS_AT));
    render(view(PLAN_PATH));
    expect(useHallTimeStore.getState()).toMatchObject({ mode: "set", at: Date.parse(STARTS_AT), openedFor: `${CONFIG}|${EVENT}` });
    expect(linked).toHaveBeenCalledWith(VENUE);
    // The team's own event read is enough: no client schedule is asked for.
    expect(schedule).toHaveBeenCalledWith(null, expect.objectContaining({ enabled: false }));
  });

  it("opens a client's plan at the start in their shared schedule", () => {
    signIn("client");
    schedule.mockReturnValue(clientSchedule(STARTS_AT));
    render(view(PLAN_PATH));
    expect(schedule).toHaveBeenCalledWith(EVENT, { configurationId: CONFIG, expectedVenueId: VENUE, enabled: true });
    expect(useHallTimeStore.getState()).toMatchObject({ mode: "set", at: Date.parse(STARTS_AT) });
  });

  it("follows the clock for a plan without an event, and for a visitor", () => {
    render(view(`/plan/${CONFIG}`));
    expect(useHallTimeStore.getState()).toMatchObject({ mode: "now", openedFor: `${CONFIG}|` });
    expect(schedule).toHaveBeenCalledWith(null, expect.objectContaining({ enabled: false }));
  });

  it("moves to the event's start when it arrives after the plan opened", () => {
    signIn("manager");
    linked.mockReturnValue({ status: "loading", eventName: null, graph: null });
    const shown = render(view(PLAN_PATH));
    expect(useHallTimeStore.getState().mode).toBe("now");
    linked.mockReturnValue(staffEvent(STARTS_AT));
    shown.rerender(view(PLAN_PATH));
    expect(useHallTimeStore.getState()).toMatchObject({ mode: "set", at: Date.parse(STARTS_AT) });
  });

  it("follows the clock when the event has no start yet", () => {
    signIn("staff");
    linked.mockReturnValue(staffEvent(null));
    render(view(PLAN_PATH));
    expect(useHallTimeStore.getState()).toMatchObject({ mode: "now", openedFor: `${CONFIG}|${EVENT}` });
  });
});
