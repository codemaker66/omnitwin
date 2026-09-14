import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { ClientEventSchedule } from "@omnitwin/types";
import { EventLinkedPlannerBootstrap } from "../EventLinkedPlannerBootstrap.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { getClientEventSchedule } from "../../../api/client-event-schedule.js";
import { getEventPhaseGraph } from "../../../api/events.js";
import { getVenue } from "../../../api/spaces.js";

vi.mock("../../../api/client-event-schedule.js", () => ({ getClientEventSchedule: vi.fn() }));
vi.mock("../../../api/events.js", () => ({ getEventPhaseGraph: vi.fn() }));
vi.mock("../../../api/spaces.js", () => ({ getVenue: vi.fn() }));
const EVENT = "11111111-1111-4111-8111-111111111111";
const CONFIG = "22222222-2222-4222-8222-222222222222";
const VENUE = "33333333-3333-4333-8333-333333333333";
const SPACE = { id: "44444444-4444-4444-8444-444444444444", name: "Ballroom" };
const schedule: ClientEventSchedule = { event: { id: EVENT, venueId: VENUE, name: "Autumn celebration", eventType: null, status: "draft", startsAt: null, endsAt: null, guestCount: 12 },
  venue: { id: VENUE, name: "City rooms", timezone: "Europe/London" }, scheduleState: "working", phases: [], layouts: [{ id: CONFIG, name: "Dinner layout", space: SPACE }] };
function Destination(): React.ReactElement {
  const location = useLocation();
  return <output>{location.pathname + location.search}</output>;
}
function show(): void {
  render(<MemoryRouter initialEntries={[`/plan?eventId=${EVENT}&space=ballroom&view=2d`]}><Routes>
    <Route path="/plan" element={<EventLinkedPlannerBootstrap eventId={EVENT} spaceSlug="ballroom" carriedSearch={`eventId=${EVENT}&space=ballroom&view=2d`} />} />
    <Route path="/plan/:config" element={<Destination />} />
  </Routes></MemoryRouter>);
}
beforeEach(() => {
  vi.mocked(getClientEventSchedule).mockReset();
  vi.mocked(getEventPhaseGraph).mockClear();
  vi.mocked(getVenue).mockResolvedValue({ id: VENUE, name: "City rooms", slug: "city-rooms", address: "Fixture address", logoUrl: null, brandColour: null,
    spaces: [{ ...SPACE, venueId: VENUE, slug: "ballroom", widthM: "10", lengthM: "20", heightM: "5", floorPlanOutline: [] }] });
});
afterEach(() => { cleanup(); useAuthStore.getState().logout(); });

describe("customer event planner entry", () => {
  it.each(["client", "planner"])("opens the %s's authorized layout and preserves event context without an internal graph read", async (role) => {
    useAuthStore.getState().setUser({ id: "owner", role, platformRole: "none", venueId: null, name: "Owner", email: "owner@example.test" });
    vi.mocked(getClientEventSchedule).mockResolvedValue(schedule);
    show();
    expect(await screen.findByText(`/plan/${CONFIG}?eventId=${EVENT}&space=ballroom&view=2d`)).toBeTruthy();
    expect(getEventPhaseGraph).not.toHaveBeenCalled();
  });
  it("offers the real event schedule when no layout is available, without staff links", async () => {
    useAuthStore.getState().setUser({ id: "owner", role: "client", platformRole: "none", venueId: null, name: "Owner", email: "owner@example.test" });
    vi.mocked(getClientEventSchedule).mockResolvedValue({ ...schedule, layouts: [] });
    show();
    expect((await screen.findByRole("link", { name: "View event schedule" })).getAttribute("href")).toBe(`/events/${EVENT}`);
    expect(screen.queryByRole("link", { name: "Open event operations" })).toBeNull();
  });
  it("does not reveal a mismatched event response or send the customer to the staff workspace", async () => {
    useAuthStore.getState().setUser({ id: "owner", role: "client", platformRole: "none", venueId: null, name: "Owner", email: "owner@example.test" });
    vi.mocked(getClientEventSchedule).mockResolvedValue({ ...schedule, event: { ...schedule.event, id: CONFIG } });
    show();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("Autumn celebration")).toBeNull();
    expect(screen.getByRole("link", { name: "Venviewer home" }).getAttribute("href")).toBe("/");
  });
});
