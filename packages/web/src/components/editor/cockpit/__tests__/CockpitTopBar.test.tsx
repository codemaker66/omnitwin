import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ClientEventSchedule, EventPhaseGraph } from "@omnitwin/types";
import { useEditorStore } from "../../../../stores/editor-store.js";
import { useAuthStore } from "../../../../stores/auth-store.js";
import { useCockpitStore } from "../../../../stores/cockpit-store.js";
import { CockpitTopBar } from "../CockpitTopBar.js";

// The event reads, for the cases that link one; the rest link none and read nothing.
const mocks = vi.hoisted(() => ({ getEventPhaseGraph: vi.fn(), getClientEventSchedule: vi.fn() }));
vi.mock("../../../../api/events.js", () => ({ getEventPhaseGraph: mocks.getEventPhaseGraph }));
vi.mock("../../../../api/client-event-schedule.js", () => ({ getClientEventSchedule: mocks.getClientEventSchedule }));

function renderTopBar(): void {
  render(
    <MemoryRouter initialEntries={["/plan/cfg-1"]}>
      <CockpitTopBar />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useEditorStore.setState({
    space: null, isPublicPreview: false, objects: [],
    isDirty: false, isSaving: false, saveError: null, lastSavedAt: null,
  });
  useAuthStore.setState({
    user: { id: "user-1", email: "b@example.com", role: "planner", platformRole: "none", venueId: null, name: "Blake Faraway" },
    isAuthenticated: true,
  });
  useCockpitStore.getState().reset();
});

afterEach(() => { cleanup(); });

describe("CockpitTopBar", () => {
  it("shows the shared activity only while a save is running", () => {
    useEditorStore.setState({ isSaving: true });
    renderTopBar();
    const save = screen.getByTestId("cockpit-topbar").querySelector('[data-save-status="saving"]');
    expect(save?.querySelector("[data-activity-indicator]")).not.toBeNull();
  });

  it("does not animate a failed save", () => {
    useEditorStore.setState({ isSaving: false, saveError: "Connection lost" });
    renderTopBar();
    const save = screen.getByTestId("cockpit-topbar").querySelector('[data-save-status="failed"]');
    expect(save).not.toBeNull();
    expect(save?.querySelector("[data-activity-indicator]")).toBeNull();
  });

  it("renders brand, SAFE review badge, idle save status, user initials and 'No event linked'", () => {
    renderTopBar();
    expect(screen.getByText("Venviewer")).toBeTruthy();
    expect(screen.getByText(/Planning evidence \/ human review required/)).toBeTruthy();
    expect(screen.getByText("No event linked")).toBeTruthy();
    expect(screen.getByText("Save Layout")).toBeTruthy();
    expect(screen.getByText("BF")).toBeTruthy();
  });

  it("shows the room capture's state to staff only, never the engineering words", () => {
    renderTopBar();
    expect(screen.queryByTestId("cockpit-runtime-chip")).toBeNull();
    expect(document.body.textContent).not.toMatch(/runtime asset|splat/iu);
  });

  it("opens the planning overlays menu and toggles an overlay in the cockpit store", () => {
    renderTopBar();
    expect(screen.queryByRole("menu", { name: "Planning overlays" })).toBeNull();
    expect(screen.queryByRole("button", { name: /layers/iu })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Planning overlays" }));
    const menu = screen.getByRole("menu", { name: "Planning overlays" });
    expect(useCockpitStore.getState().overlayVisibility.densityHeatmap).toBe(true);
    fireEvent.click(within(menu).getByRole("menuitemcheckbox", { name: /density heatmap/i }));
    expect(useCockpitStore.getState().overlayVisibility.densityHeatmap).toBe(false);
  });
});

describe("CockpitTopBar with an event stored without a name (the event-name ruling)", () => {
  const VENUE = "00000000-0000-4000-8000-0000000000f1";
  const EVENT = "00000000-0000-4000-8000-0000000000e1";
  const STARTS = "2027-03-14T18:00:00.000Z";
  const stored = { id: EVENT, venueId: VENUE, name: "", eventType: "wedding", startsAt: STARTS, endsAt: null, guestCount: 80 };

  function renderLinked(): void {
    // A settled sign-in: the event reads wait while the session is checked.
    useAuthStore.setState({ isLoading: false });
    render(
      <MemoryRouter initialEntries={[`/plan/cfg-1?eventId=${EVENT}`]}>
        <CockpitTopBar />
      </MemoryRouter>,
    );
  }

  it("names it by its occasion and day for the venue's staff", async () => {
    useEditorStore.setState({ venueId: VENUE });
    useAuthStore.setState({
      user: { id: "user-2", email: "s@example.com", role: "staff", platformRole: "none", venueId: VENUE, name: "Isla Staff" },
      isAuthenticated: true,
    });
    const graph: EventPhaseGraph = {
      event: { ...stored, createdBy: null, status: "confirmed", clientName: null, notes: null, createdAt: STARTS, updatedAt: STARTS },
      phases: [], scenarios: [], layoutVariants: [], configurationLinks: [], phaseLayoutSnapshots: [],
    };
    mocks.getEventPhaseGraph.mockResolvedValue(graph);
    renderLinked();
    expect(await screen.findByText("Wedding, 14 March 2027")).toBeTruthy();
  });

  it("names it by its occasion and day for the client", async () => {
    const CONFIG = "00000000-0000-4000-8000-0000000000c1";
    useEditorStore.setState({ venueId: VENUE, configId: CONFIG });
    const schedule: ClientEventSchedule = {
      event: { ...stored, status: "confirmed" },
      venue: { id: VENUE, name: "Trades Hall", timezone: "Europe/London" },
      scheduleState: "working", phases: [],
      layouts: [{ id: CONFIG, name: "Dinner layout", space: { id: "00000000-0000-4000-8000-0000000000a1", name: "Grand Hall" } }],
      slots: [],
    };
    mocks.getClientEventSchedule.mockResolvedValue(schedule);
    renderLinked();
    expect(await screen.findByText("Wedding, 14 March 2027")).toBeTruthy();
  });
});
