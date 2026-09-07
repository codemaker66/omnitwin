import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { EventPhaseGraph } from "@omnitwin/types";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Configuration } from "../api/configurations.js";
import type { Space, Venue } from "../api/spaces.js";

vi.mock("../App.js", () => ({
  App: () => <div data-testid="mock-editor-3d" />,
}));

vi.mock("../components/editor/cockpit/PlannerCockpit.js", () => ({
  PlannerCockpit: () => <div data-testid="mock-planner-cockpit" />,
}));

vi.mock("../pages/BlueprintPage.js", () => ({
  BlueprintPage: () => <div data-testid="mock-blueprint" />,
}));

vi.mock("../components/editor/SaveSendPanel.js", () => ({
  SaveSendPanel: () => null,
}));

vi.mock("../components/editor/MobilePlannerTopBar.js", () => ({
  MobilePlannerTopBar: () => null,
}));

vi.mock("../components/editor/SubmitForReviewPanel.js", () => ({
  SubmitForReviewPanel: () => null,
}));

vi.mock("../components/editor/EditorBridge.js", () => ({
  EditorBridge: () => null,
}));

vi.mock("../components/editor/ObjectNotePanel.js", () => ({
  ObjectNotePanel: () => null,
}));

vi.mock("../components/editor/EventDetailsPanel.js", () => ({
  EventDetailsPanel: () => null,
}));

vi.mock("../components/truth/TruthModeIndicator.js", () => ({
  TruthModeIndicator: () => null,
}));

vi.mock("../hooks/use-media-query.js", () => ({
  useIsCoarsePointer: () => false,
  useIsNarrowViewport: () => false,
}));

vi.mock("../api/configurations.js", () => ({
  getPublicConfig: vi.fn(),
  getConfig: vi.fn(),
  createPublicConfig: vi.fn(),
  publicBatchSave: vi.fn(),
  authBatchSave: vi.fn(),
  parseRevisionConflict: vi.fn(() => null),
  claimConfig: vi.fn(),
  submitGuestEnquiry: vi.fn(),
}));

vi.mock("../api/spaces.js", () => ({
  listVenues: vi.fn(),
  listSpaces: vi.fn(),
  getSpace: vi.fn(),
  getVenue: vi.fn(),
}));
vi.mock("../api/events.js", () => ({ getEventPhaseGraph: vi.fn() }));

const configMock = vi.mocked(await import("../api/configurations.js"));
const spacesMock = vi.mocked(await import("../api/spaces.js"));
const eventsMock = vi.mocked(await import("../api/events.js"));
const { EditorPage } = await import("../pages/EditorPage.js");
const { useAuthStore } = await import("../stores/auth-store.js");
const { useEditorStore } = await import("../stores/editor-store.js");

const tradesHall: Venue = {
  id: "venue-trades",
  name: "Trades Hall",
  slug: "trades-hall",
  address: "85 Glassford Street",
  logoUrl: null,
  brandColour: null,
};

const cityRooms: Venue = {
  id: "venue-city",
  name: "City Rooms",
  slug: "city-rooms",
  address: "1 Example Street",
  logoUrl: null,
  brandColour: null,
};

const grandHall: Space = {
  id: "space-grand",
  venueId: tradesHall.id,
  name: "Grand Hall",
  slug: "grand-hall",
  widthM: "21",
  lengthM: "10.5",
  heightM: "7.5",
  floorPlanOutline: [{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 10.5 }, { x: 0, y: 10.5 }],
};

const receptionRoom: Space = {
  id: "space-reception",
  venueId: tradesHall.id,
  name: "Reception Room",
  slug: "reception-room",
  widthM: "13.4",
  lengthM: "11.2",
  heightM: "3.2",
  floorPlanOutline: [{ x: 0, y: 0 }, { x: 13.4, y: 0 }, { x: 13.4, y: 11.2 }, { x: 0, y: 11.2 }],
};

const ballroom: Space = {
  id: "space-ballroom",
  venueId: cityRooms.id,
  name: "Ballroom",
  slug: "ballroom",
  widthM: "18",
  lengthM: "9",
  heightM: "6",
  floorPlanOutline: [{ x: 0, y: 0 }, { x: 18, y: 0 }, { x: 18, y: 9 }, { x: 0, y: 9 }],
};

function publicConfigFor(space: Space, id: string): Configuration {
  return {
    id,
    spaceId: space.id,
    venueId: space.venueId,
    userId: null,
    name: "New Layout",
    isPublicPreview: true,
    revision: 1,
    objects: [],
  };
}

/** The created-plan route, exposing what query it was reached with. */
function CreatedRouteWithSearch(): ReactElement {
  const location = useLocation();
  return <div data-testid="created-route" data-search={location.search} data-path={location.pathname} />;
}

function renderEditor(initialEntry: string): void {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/plan/:code" element={<div data-testid="created-route" />} />
        <Route path="/plan" element={<EditorPage />} />
        <Route path="/v/:venueSlug/plan" element={<EditorPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useEditorStore.getState().reset();
  useAuthStore.getState().setUser(null);
  spacesMock.getSpace.mockImplementation((_venueId: string, spaceId: string) =>
    Promise.resolve(spaceId === ballroom.id ? ballroom : grandHall),
  );
});

afterEach(() => {
  cleanup();
});

describe("EditorPage venue-scoped bootstrap", () => {
  it("creates the first layout in the explicitly requested venue", async () => {
    spacesMock.listVenues.mockResolvedValue([tradesHall, cityRooms]);
    spacesMock.listSpaces.mockImplementation((venueId: string) =>
      Promise.resolve(venueId === cityRooms.id ? [ballroom] : [grandHall]),
    );
    configMock.createPublicConfig.mockResolvedValue(publicConfigFor(ballroom, "cfg-city"));

    renderEditor("/v/city-rooms/plan?space=ballroom");

    await waitFor(() => {
      expect(spacesMock.listSpaces).toHaveBeenCalledWith(cityRooms.id);
      expect(configMock.createPublicConfig).toHaveBeenCalledWith(ballroom.id);
    });
    expect(configMock.createPublicConfig).not.toHaveBeenCalledWith(grandHall.id);
    await screen.findByTestId("created-route");
  });

  it("reuses a recent anonymous public config for the requested space", async () => {
    spacesMock.listVenues.mockResolvedValue([tradesHall, cityRooms]);
    spacesMock.listSpaces.mockImplementation((venueId: string) =>
      Promise.resolve(venueId === cityRooms.id ? [ballroom] : [grandHall]),
    );
    localStorage.setItem("omnitwin_my_configs", JSON.stringify([
      { configId: "cfg-grand-old", createdAt: "2026-06-17T08:00:00.000Z" },
      { configId: "cfg-city-existing", createdAt: "2026-06-17T09:00:00.000Z" },
    ]));
    configMock.getPublicConfig.mockImplementation((configId: string) =>
      Promise.resolve(configId === "cfg-city-existing"
        ? publicConfigFor(ballroom, configId)
        : publicConfigFor(grandHall, configId)),
    );

    renderEditor("/v/city-rooms/plan?space=ballroom");

    await waitFor(() => {
      expect(configMock.getPublicConfig).toHaveBeenCalledWith("cfg-city-existing");
    });
    expect(configMock.createPublicConfig).not.toHaveBeenCalled();
    await screen.findByTestId("created-route");
  });

  it("shows an explicit not-found state for unknown venue slugs", async () => {
    spacesMock.listVenues.mockResolvedValue([tradesHall]);

    renderEditor("/v/missing-venue/plan");

    await screen.findByText("Venue not found");
    expect(screen.getByText(/missing-venue/)).toBeTruthy();
    expect(spacesMock.listSpaces).not.toHaveBeenCalled();
    expect(configMock.createPublicConfig).not.toHaveBeenCalled();
  });

  it("shows an explicit forbidden state for scoped users on another venue", async () => {
    useAuthStore.getState().setUser({
      id: "user-planner",
      email: "planner@example.com",
      role: "planner",
      platformRole: "none",
      venueId: tradesHall.id,
      name: "Planner",
    });
    spacesMock.listVenues.mockResolvedValue([tradesHall, cityRooms]);

    renderEditor("/v/city-rooms/plan");

    await screen.findByText("Planner unavailable for this venue");
    expect(screen.getByText(/City Rooms/)).toBeTruthy();
    expect(spacesMock.listSpaces).not.toHaveBeenCalled();
    expect(configMock.createPublicConfig).not.toHaveBeenCalled();
  });
});

// CARD A1 (G1a): the built Reception Room runtime package is the default /plan
// experience. The anonymous draft path must open the Reception Room unless the
// visitor explicitly asks for another space.
describe("EditorPage default /plan bootstrap", () => {
  it("bootstraps the anonymous /plan draft into the Reception Room", async () => {
    spacesMock.listVenues.mockResolvedValue([tradesHall]);
    spacesMock.listSpaces.mockResolvedValue([grandHall, receptionRoom]);
    configMock.createPublicConfig.mockResolvedValue(publicConfigFor(receptionRoom, "cfg-reception"));

    renderEditor("/plan");

    await waitFor(() => {
      expect(configMock.createPublicConfig).toHaveBeenCalledWith(receptionRoom.id);
    });
    expect(configMock.createPublicConfig).not.toHaveBeenCalledWith(grandHall.id);
    await screen.findByTestId("created-route");
  });

  it("keeps the opening heading generic until the venue's spaces resolve", () => {
    // Before the space list resolves, the heading must not claim a room the
    // bootstrap might not actually open (reviewer finding, CARD A1).
    spacesMock.listVenues.mockReturnValue(new Promise(() => { /* keep pending */ }));

    renderEditor("/plan");

    expect(screen.getByRole("heading", { name: "Opening the planner" })).toBeTruthy();
    expect(screen.getByRole("status").querySelector("[data-activity-indicator]")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: /Reception Room/ })).toBeNull();
  });

  it("names the Reception Room once the bootstrap has resolved it", async () => {
    spacesMock.listVenues.mockResolvedValue([tradesHall]);
    spacesMock.listSpaces.mockResolvedValue([grandHall, receptionRoom]);
    // Freeze config creation so the resolved-room loading state stays visible.
    configMock.createPublicConfig.mockReturnValue(new Promise(() => { /* keep pending */ }));

    renderEditor("/plan");

    expect(await screen.findByRole("heading", { name: "Opening the Reception Room planner" })).toBeTruthy();
  });

  it("ends opening activity when bootstrap fails", async () => {
    spacesMock.listVenues.mockRejectedValue(new Error("Venue lookup unavailable"));
    renderEditor("/plan");
    expect(screen.getByRole("status").querySelector("[data-activity-indicator]")).not.toBeNull();
    const failure = await screen.findByRole("alert");
    expect(failure.querySelector("[data-activity-indicator]")).toBeNull();
  });

  it("carries unrelated query options through the generic draft bootstrap", async () => {
    spacesMock.listVenues.mockResolvedValue([tradesHall]);
    spacesMock.listSpaces.mockResolvedValue([grandHall, receptionRoom]);
    configMock.createPublicConfig.mockResolvedValue(publicConfigFor(grandHall, "cfg-grand"));

    render(
      <MemoryRouter initialEntries={["/plan?space=grand-hall&view=2d"]}>
        <Routes>
          <Route path="/plan/:code" element={<CreatedRouteWithSearch />} />
          <Route path="/plan" element={<EditorPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const created = await screen.findByTestId("created-route");
    expect(configMock.createPublicConfig).toHaveBeenCalledWith(grandHall.id);
    expect(created.getAttribute("data-search")).toContain("view=2d");
  });

  it("still honours an explicit ?space= override", async () => {
    spacesMock.listVenues.mockResolvedValue([tradesHall]);
    spacesMock.listSpaces.mockResolvedValue([grandHall, receptionRoom]);
    configMock.createPublicConfig.mockResolvedValue(publicConfigFor(grandHall, "cfg-grand"));

    renderEditor("/plan?space=grand-hall");

    await waitFor(() => {
      expect(configMock.createPublicConfig).toHaveBeenCalledWith(grandHall.id);
    });
    await screen.findByTestId("created-route");
  });

  it("falls back to the Grand Hall when the venue has no reception-room space", async () => {
    spacesMock.listVenues.mockResolvedValue([tradesHall]);
    spacesMock.listSpaces.mockResolvedValue([grandHall]);
    configMock.createPublicConfig.mockResolvedValue(publicConfigFor(grandHall, "cfg-grand"));

    renderEditor("/plan");

    await waitFor(() => {
      expect(configMock.createPublicConfig).toHaveBeenCalledWith(grandHall.id);
    });
    await screen.findByTestId("created-route");
  });
});

const EVENT_ID = "4e179764-8468-40ff-ae97-ca804ed06df6";
const OTHER_EVENT_ID = "11111111-1111-4111-8111-111111111111";
const eventOwner = { id: "demo-owner", email: "demo@example.com", role: "admin", platformRole: "none" as const, venueId: tradesHall.id, name: "Demo Owner" };
function graph(configIds: readonly string[], eventId = EVENT_ID): EventPhaseGraph {
  return {
    event: { id: eventId, venueId: tradesHall.id, name: "DEMO ONLY Elaine", status: "draft", createdBy: eventOwner.id,
      eventType: null, startsAt: null, endsAt: null, guestCount: 144, clientName: null, notes: null,
      createdAt: "2026-09-06T10:00:00.000Z", updatedAt: "2026-09-06T10:00:00.000Z" },
    phases: [], scenarios: [], layoutVariants: [], phaseLayoutSnapshots: [],
    configurationLinks: configIds.map((configurationId, index) => ({ id: `link-${String(index)}`, eventId,
      configurationId, layoutVariantId: null, linkType: "source_configuration", createdAt: "2026-09-06T10:00:00.000Z" })),
  };
}
function renderEventEditor(eventId = EVENT_ID): void {
  render(<MemoryRouter initialEntries={[`/plan?eventId=${eventId}&space=grand-hall&view=2d`]}>
    <Routes>
      <Route path="/plan" element={<EditorPage />} />
      <Route path="/plan/:code" element={<CreatedRouteWithSearch />} />
    </Routes>
  </MemoryRouter>);
}

function EventNavigation(): ReactElement {
  const navigate = useNavigate();
  return <button type="button" onClick={() => { void navigate(`/plan?eventId=${OTHER_EVENT_ID}&space=grand-hall`); }}>Change event</button>;
}

describe("EditorPage event-linked bootstrap", () => {
  beforeEach(() => {
    useAuthStore.getState().setUser(eventOwner);
    spacesMock.listVenues.mockResolvedValue([tradesHall]);
    spacesMock.listSpaces.mockResolvedValue([grandHall, receptionRoom]);
    spacesMock.getVenue.mockResolvedValue({ ...tradesHall, spaces: [grandHall, receptionRoom] });
    configMock.getConfig.mockImplementation((id) => Promise.resolve({ ...publicConfigFor(grandHall, id), name: id, isPublicPreview: false, userId: eventOwner.id }));
  });

  it("reopens the only accessible linked plan and carries the event query without creating or probing public drafts", async () => {
    eventsMock.getEventPhaseGraph.mockResolvedValue(graph(["Dinner"]));
    localStorage.setItem("omnitwin_my_configs", JSON.stringify([{ configId: "unrelated", createdAt: "2026-09-06T10:00:00Z" }]));
    renderEventEditor();
    const route = await screen.findByTestId("created-route");
    expect(route.getAttribute("data-path")).toBe("/plan/Dinner");
    expect(route.getAttribute("data-search")).toContain(`eventId=${EVENT_ID}`);
    expect(route.getAttribute("data-search")).toContain("view=2d");
    expect(configMock.getConfig).toHaveBeenCalledWith("Dinner");
    expect(configMock.getPublicConfig).not.toHaveBeenCalled();
    expect(configMock.createPublicConfig).not.toHaveBeenCalled();
  });

  it("shows real named choices when an event has several plans, even when an unrelated editor is already open", async () => {
    useEditorStore.setState({ configId: "unrelated", isDirty: true });
    eventsMock.getEventPhaseGraph.mockResolvedValue(graph(["Dinner", "Ceremony"]));
    renderEventEditor();
    expect(await screen.findByRole("heading", { name: "Choose a saved layout" })).toBeTruthy();
    expect(screen.queryByTestId("created-route")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open Ceremony" }));
    expect((await screen.findByTestId("created-route")).getAttribute("data-path")).toBe("/plan/Ceremony");
    expect(configMock.createPublicConfig).not.toHaveBeenCalled();
  });

  it("shows a truthful no-linked-layout state instead of making a new public draft", async () => {
    eventsMock.getEventPhaseGraph.mockResolvedValue(graph([]));
    renderEventEditor();
    expect(await screen.findByRole("heading", { name: "No linked layout for this room" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open event operations" }).getAttribute("href")).toBe(`/ops/events/${EVENT_ID}`);
    expect(configMock.createPublicConfig).not.toHaveBeenCalled();
  });

  it("waits for authentication and does not start the anonymous draft path", async () => {
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: true });
    renderEventEditor();
    expect(screen.getByText("Checking your account…")).toBeTruthy();
    expect(eventsMock.getEventPhaseGraph).not.toHaveBeenCalled();
    expect(configMock.createPublicConfig).not.toHaveBeenCalled();
    act(() => { useAuthStore.getState().setUser(null); });
    expect(await screen.findByRole("heading", { name: "Sign in to open this event's layouts" })).toBeTruthy();
  });

  it("never uses a linked configuration from another venue or room", async () => {
    eventsMock.getEventPhaseGraph.mockResolvedValue(graph(["Wrong venue", "Wrong room"]));
    configMock.getConfig.mockImplementation((id) => Promise.resolve(publicConfigFor(id === "Wrong venue" ? ballroom : receptionRoom, id)));
    renderEventEditor();
    expect(await screen.findByRole("heading", { name: "No linked layout for this room" })).toBeTruthy();
    expect(screen.queryByTestId("created-route")).toBeNull();
    expect(configMock.createPublicConfig).not.toHaveBeenCalled();
  });

  it("withdraws an old account's event response after auth changes", async () => {
    let finish!: (value: EventPhaseGraph) => void;
    eventsMock.getEventPhaseGraph.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    renderEventEditor();
    await waitFor(() => { expect(eventsMock.getEventPhaseGraph).toHaveBeenCalled(); });
    act(() => { useAuthStore.getState().setUser(null); });
    await act(async () => { finish(graph(["Dinner"])); await Promise.resolve(); });
    expect(screen.getByRole("heading", { name: "Sign in to open this event's layouts" })).toBeTruthy();
    expect(configMock.getConfig).not.toHaveBeenCalled();
    expect(screen.queryByTestId("created-route")).toBeNull();
  });

  it("rejects a response for another event", async () => {
    eventsMock.getEventPhaseGraph.mockResolvedValue(graph(["Other event plan"], OTHER_EVENT_ID));
    renderEventEditor();
    expect(await screen.findByRole("heading", { name: "Could not open this event's layouts" })).toBeTruthy();
    expect(configMock.getConfig).not.toHaveBeenCalled();
  });

  it("ignores an old event response after the URL changes", async () => {
    let finish!: (value: EventPhaseGraph) => void;
    eventsMock.getEventPhaseGraph.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce({ ...graph(["New dinner", "New ceremony"], OTHER_EVENT_ID), event: { ...graph([], OTHER_EVENT_ID).event, name: "Second event" } });
    render(<MemoryRouter initialEntries={[`/plan?eventId=${EVENT_ID}&space=grand-hall`]}>
      <EventNavigation />
      <Routes><Route path="/plan" element={<EditorPage />} /><Route path="/plan/:code" element={<CreatedRouteWithSearch />} /></Routes>
    </MemoryRouter>);
    await waitFor(() => { expect(eventsMock.getEventPhaseGraph).toHaveBeenCalledWith(EVENT_ID); });
    fireEvent.click(screen.getByRole("button", { name: "Change event" }));
    expect(await screen.findByText("Second event · Grand Hall")).toBeTruthy();
    await act(async () => { finish(graph(["Old plan"])); await Promise.resolve(); });
    expect(screen.getByRole("button", { name: "Open New dinner" })).toBeTruthy();
    expect(screen.queryByTestId("created-route")).toBeNull();
    expect(configMock.getConfig).not.toHaveBeenCalledWith("Old plan");
  });

  it("does not navigate when authentication changes during a configuration access check", async () => {
    eventsMock.getEventPhaseGraph.mockResolvedValue(graph(["Dinner"]));
    let finish!: (value: Configuration) => void;
    configMock.getConfig.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    renderEventEditor();
    await waitFor(() => { expect(configMock.getConfig).toHaveBeenCalledWith("Dinner"); });
    act(() => { useAuthStore.getState().setUser(null); });
    await act(async () => { finish(publicConfigFor(grandHall, "Dinner")); await Promise.resolve(); });
    expect(screen.queryByTestId("created-route")).toBeNull();
    expect(screen.getByRole("heading", { name: "Sign in to open this event's layouts" })).toBeTruthy();
  });

  it("opens the one accessible match after another linked plan is explicitly denied", async () => {
    eventsMock.getEventPhaseGraph.mockResolvedValue(graph(["Denied", "Dinner"]));
    configMock.getConfig.mockImplementation((id) => id === "Denied"
      ? Promise.reject(new ApiError(403, "Forbidden", "FORBIDDEN"))
      : Promise.resolve({ ...publicConfigFor(grandHall, id), name: id }));
    renderEventEditor();
    expect((await screen.findByTestId("created-route")).getAttribute("data-path")).toBe("/plan/Dinner");
  });

  it("does not choose a partial result when another linked layout cannot be checked", async () => {
    eventsMock.getEventPhaseGraph.mockResolvedValue(graph(["Unavailable", "Dinner"]));
    configMock.getConfig.mockImplementation((id) => id === "Unavailable"
      ? Promise.reject(new ApiError(503, "Unavailable", "UNAVAILABLE"))
      : Promise.resolve({ ...publicConfigFor(grandHall, id), name: id }));
    renderEventEditor();
    expect(await screen.findByRole("heading", { name: "Could not open this event's layouts" })).toBeTruthy();
    expect(screen.queryByTestId("created-route")).toBeNull();
    expect(configMock.createPublicConfig).not.toHaveBeenCalled();
  });

  it("rejects an explicit venue slug that does not own the event", async () => {
    eventsMock.getEventPhaseGraph.mockResolvedValue(graph(["Dinner"]));
    renderEditor(`/v/city-rooms/plan?eventId=${EVENT_ID}&space=grand-hall`);
    expect(await screen.findByRole("heading", { name: "Could not open this event's layouts" })).toBeTruthy();
    expect(configMock.getConfig).not.toHaveBeenCalled();
  });

  it("does not silently substitute another room when the requested room is missing", async () => {
    eventsMock.getEventPhaseGraph.mockResolvedValue(graph(["Dinner"]));
    renderEditor(`/plan?eventId=${EVENT_ID}&space=missing-room`);
    expect(await screen.findByRole("heading", { name: "Could not open this event's layouts" })).toBeTruthy();
    expect(configMock.getConfig).not.toHaveBeenCalled();
    expect(configMock.createPublicConfig).not.toHaveBeenCalled();
  });

  it("rejects an invalid event ID without making a request or a draft", async () => {
    renderEventEditor("bad-id");
    expect(await screen.findByRole("heading", { name: "Could not open this event's layouts" })).toBeTruthy();
    expect(eventsMock.getEventPhaseGraph).not.toHaveBeenCalled();
    expect(configMock.createPublicConfig).not.toHaveBeenCalled();
  });

  it("stops an earlier generic room lookup when an event link takes over", async () => {
    let finish!: (value: Venue[]) => void;
    spacesMock.listVenues.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    eventsMock.getEventPhaseGraph.mockResolvedValue(graph(["Dinner", "Ceremony"], OTHER_EVENT_ID));
    render(<MemoryRouter initialEntries={["/plan?space=grand-hall"]}><EventNavigation />
      <Routes><Route path="/plan" element={<EditorPage />} /><Route path="/plan/:code" element={<CreatedRouteWithSearch />} /></Routes>
    </MemoryRouter>);
    await waitFor(() => { expect(spacesMock.listVenues).toHaveBeenCalled(); });
    fireEvent.click(screen.getByRole("button", { name: "Change event" }));
    await screen.findByRole("heading", { name: "Choose a saved layout" });
    await act(async () => { finish([tradesHall]); await Promise.resolve(); });
    expect(configMock.createPublicConfig).not.toHaveBeenCalled();
    expect(screen.queryByTestId("created-route")).toBeNull();
  });

  it("retains an already-created draft for recovery without committing or navigating it over an event link", async () => {
    let finish!: (value: Configuration) => void;
    configMock.createPublicConfig.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    eventsMock.getEventPhaseGraph.mockResolvedValue(graph(["Dinner", "Ceremony"], OTHER_EVENT_ID));
    render(<MemoryRouter initialEntries={["/plan?space=grand-hall"]}><EventNavigation />
      <Routes><Route path="/plan" element={<EditorPage />} /><Route path="/plan/:code" element={<CreatedRouteWithSearch />} /></Routes>
    </MemoryRouter>);
    await waitFor(() => { expect(configMock.createPublicConfig).toHaveBeenCalled(); });
    fireEvent.click(screen.getByRole("button", { name: "Change event" }));
    await screen.findByRole("heading", { name: "Choose a saved layout" });
    await act(async () => { finish(publicConfigFor(grandHall, "unrelated-created")); await Promise.resolve(); });
    expect(screen.queryByTestId("created-route")).toBeNull();
    expect(useEditorStore.getState()).toMatchObject({ configId: null, isLoading: false, error: null });
    expect(localStorage.getItem("omnitwin_my_configs")).toContain("unrelated-created");
  });

  it.each([false, true])("uses snapshot-only layouts only while the phase's live room still matches (explicit independent link: %s)", async (explicitLink) => {
    const base = graph(explicitLink ? ["Dinner"] : []);
    const phaseId = "phase-moved";
    eventsMock.getEventPhaseGraph.mockResolvedValue({ ...base,
      phases: [{ id: phaseId, eventId: EVENT_ID, spaceId: receptionRoom.id, templateKey: "dinner", name: "Dinner",
        sortOrder: 0, startsAt: null, durationMinutes: 90, guestCount: 144, opsTasksCount: 0, reviewGatesCount: 0,
        densityStatus: "not_checked", densityLabel: "Not checked", staffConflictsStatus: "not_checked", staffConflictsLabel: "Not checked",
        notes: null, createdAt: base.event.createdAt, updatedAt: base.event.updatedAt }],
      phaseLayoutSnapshots: [{ id: "snapshot", eventPhaseId: phaseId, layoutVariantId: null, configurationId: "Dinner", snapshotHash: null,
        status: "frozen", objectCount: 162, guestCount: 144, payload: null, createdAt: base.event.createdAt, frozenAt: base.event.createdAt }],
    });
    renderEventEditor();
    if (explicitLink) expect((await screen.findByTestId("created-route")).getAttribute("data-path")).toBe("/plan/Dinner");
    else {
      await screen.findByRole("heading", { name: "No linked layout for this room" });
      expect(screen.queryByTestId("created-route")).toBeNull();
    }
  });
});
