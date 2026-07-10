import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
}));

const configMock = vi.mocked(await import("../api/configurations.js"));
const spacesMock = vi.mocked(await import("../api/spaces.js"));
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

function renderEditor(initialEntry: string): void {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/plan/:code" element={<div data-testid="created-route" />} />
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
