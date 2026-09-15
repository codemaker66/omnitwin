import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ClientEventSchedule } from "@omnitwin/types";
import { ClientEventPhases, scheduleTimeLabel } from "./ClientEventSchedule.js";
import { CockpitBottom } from "../editor/cockpit/CockpitBottom.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { getClientEventSchedule } from "../../api/client-event-schedule.js";
import { getRoomLayoutTimeline } from "../../api/room-layout-timeline.js";
import { getEventPhaseGraph } from "../../api/events.js";

vi.mock("../../api/client-event-schedule.js", () => ({ getClientEventSchedule: vi.fn() }));
vi.mock("../../api/room-layout-timeline.js", () => ({ getRoomLayoutTimeline: vi.fn() }));
vi.mock("../../api/events.js", () => ({ getEventPhaseGraph: vi.fn() }));
const request = vi.mocked(getClientEventSchedule);
const EVENT = "11111111-1111-4111-8111-111111111111";
const CONFIG = "22222222-2222-4222-8222-222222222222";
const VENUE = "33333333-3333-4333-8333-333333333333";
const SPACE = { id: "44444444-4444-4444-8444-444444444444", name: "Ballroom" };
const data: ClientEventSchedule = { event: { id: EVENT, venueId: VENUE, name: "Autumn celebration", eventType: null, status: "draft", startsAt: null, endsAt: null, guestCount: 12 }, venue: { id: VENUE, name: "City rooms", timezone: "Europe/London" }, scheduleState: "working",
  phases: [{ id: "55555555-5555-4555-8555-555555555555", name: "Dinner", startsAt: "2026-09-18T22:30:00.000Z", durationMinutes: 90, space: SPACE }], layouts: [{ id: CONFIG, name: "Dinner layout", space: SPACE }] };
beforeEach(() => {
  request.mockReset();
  vi.mocked(getRoomLayoutTimeline).mockClear();
  vi.mocked(getEventPhaseGraph).mockClear();
  useEditorStore.setState({ configId: CONFIG, venueId: VENUE });
});
afterEach(() => { cleanup(); useAuthStore.getState().logout(); });

describe("customer planning schedule", () => {
  it("keeps unknown timing honest and includes the following day for an overnight phase", () => {
    expect(scheduleTimeLabel(null, 30, "Europe/London")).toBe("Time to be confirmed");
    expect(scheduleTimeLabel("2026-09-18T22:30:00.000Z", 90, "Europe/London")).toBe("Fri 18 Sept · 23:30–Sat 19 Sept · 01:00");
    render(<ClientEventPhases data={{ ...data, phases: data.phases.map((phase) => ({ ...phase, startsAt: null, space: null })) }} />);
    expect(screen.getByText("Time to be confirmed")).toBeTruthy();
    expect(screen.getByText("Room to be confirmed")).toBeTruthy();
  });

  it.each(["client", "planner"])("renders one phase for %s without requesting a staff graph or room calendar", async (role) => {
    useAuthStore.getState().setUser({ id: "owner", role, platformRole: "none", venueId: null, name: "Owner", email: "owner@example.test" });
    request.mockResolvedValue(data);
    render(<MemoryRouter initialEntries={[`/plan/${CONFIG}?eventId=${EVENT}`]}><CockpitBottom /></MemoryRouter>);
    expect(await screen.findByText("Dinner")).toBeTruthy();
    expect(screen.getByText(/Working plan · Times may change/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Event details" }).getAttribute("href")).toBe(`/events/${EVENT}`);
    expect(getRoomLayoutTimeline).not.toHaveBeenCalled();
    expect(getEventPhaseGraph).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /freeze/i })).toBeNull();
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("tracks the expanded dock height through resizing and restores its scoped offset on unmount", () => {
    useAuthStore.getState().setUser({ id: "owner", role: "client", platformRole: "none", venueId: null, name: "Owner", email: "owner@example.test" });
    let height = 95.5;
    let notifyResize = (): void => undefined;
    const disconnect = vi.fn();
    class DockResizeObserver implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) { notifyResize = (): void => { callback([], this); }; }
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = disconnect;
    }
    vi.stubGlobal("ResizeObserver", DockResizeObserver);
    const rectangle = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 0, 320, height));
    const shell = document.createElement("div");
    shell.className = "cockpit-shell is-mobile";
    shell.style.setProperty("--client-event-dock-height", "7px");
    document.body.append(shell);
    try {
      const result = render(<MemoryRouter initialEntries={[`/plan/${CONFIG}`]}><CockpitBottom /></MemoryRouter>, { container: shell });
      expect(shell.style.getPropertyValue("--client-event-dock-height")).toBe("95.5px");
      expect(screen.getByRole("button", { name: "Hide event schedule" }).getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByText("You can keep working on your room plan.")).toBeTruthy();
      act(() => { height = 70; fireEvent.click(screen.getByRole("button", { name: "Hide event schedule" })); notifyResize(); });
      expect(shell.style.getPropertyValue("--client-event-dock-height")).toBe("70px");
      expect(screen.getByRole("button", { name: "Show event schedule" }).getAttribute("aria-expanded")).toBe("false");
      expect(request).not.toHaveBeenCalled();
      result.unmount();
      expect(disconnect).toHaveBeenCalledOnce();
      expect(shell.style.getPropertyValue("--client-event-dock-height")).toBe("7px");
    } finally {
      rectangle.mockRestore();
      vi.unstubAllGlobals();
      shell.remove();
    }
  });

  it("shows shared activity, clears it on failure, and retries into a populated schedule", async () => {
    useAuthStore.getState().setUser({ id: "owner", role: "client", platformRole: "none", venueId: null, name: "Owner", email: "owner@example.test" });
    let reject: (error: Error) => void = () => undefined;
    request.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; })).mockResolvedValueOnce(data);
    render(<MemoryRouter initialEntries={[`/plan/${CONFIG}?eventId=${EVENT}`]}><CockpitBottom /></MemoryRouter>);
    expect(screen.getByRole("status").querySelector("[data-activity-indicator]")).not.toBeNull();
    act(() => { reject(new Error("offline")); });
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => { expect(screen.getByText("Dinner")).toBeTruthy(); });
  });
});
