import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Space } from "../api/spaces.js";

vi.mock("../App.js", () => ({ App: () => <div data-testid="mock-editor-3d" /> }));
vi.mock("../components/editor/cockpit/PlannerCockpit.js", () => ({
  PlannerCockpit: () => <div data-testid="planner-cockpit" />,
}));
vi.mock("../pages/BlueprintPage.js", () => ({ BlueprintPage: () => <div data-testid="mock-blueprint" /> }));
vi.mock("../components/editor/MobilePlannerTopBar.js", () => ({ MobilePlannerTopBar: () => null }));
vi.mock("../components/editor/SaveSendPanel.js", () => ({
  SaveSendPanel: () => <div data-testid="save-send-panel" />,
}));
vi.mock("../components/editor/SubmitForReviewPanel.js", () => ({
  SubmitForReviewPanel: () => <div data-testid="submit-review-panel" />,
}));
vi.mock("../components/editor/EditorBridge.js", () => ({
  EditorBridge: () => <div data-testid="editor-bridge" />,
}));
vi.mock("../components/editor/ObjectNotePanel.js", () => ({
  ObjectNotePanel: () => <div data-testid="object-note-panel" />,
}));
vi.mock("../components/editor/EventDetailsPanel.js", () => ({
  EventDetailsPanel: () => <div data-testid="event-details-panel" />,
}));
vi.mock("../components/truth/TruthModeIndicator.js", () => ({
  TruthModeIndicator: () => <div>Procedural preview</div>,
}));
vi.mock("../hooks/use-media-query.js", () => ({
  useIsCoarsePointer: () => false,
  useIsNarrowViewport: () => false,
}));

const { EditorPage } = await import("../pages/EditorPage.js");
const { useCockpitStore } = await import("../stores/cockpit-store.js");
const { useEditorStore } = await import("../stores/editor-store.js");
const originalLoadConfiguration = useEditorStore.getState().loadConfiguration;

const GRAND_HALL_SPACE: Space = {
  id: "space-grand-hall",
  venueId: "venue-trades-hall",
  name: "Grand Hall",
  slug: "grand-hall",
  widthM: "21",
  lengthM: "10.5",
  heightM: "7",
  floorPlanOutline: [
    { x: 0, y: 0 },
    { x: 21, y: 0 },
    { x: 21, y: 10.5 },
    { x: 0, y: 10.5 },
  ],
};

function setRoomIdentity(
  status: "pending" | "unavailable" | "resolved",
  venueSlug: string | null,
): void {
  const roomKey = {
    spaceId: GRAND_HALL_SPACE.id,
    venueId: GRAND_HALL_SPACE.venueId,
    roomSlug: GRAND_HALL_SPACE.slug,
  } as const;
  if (status === "resolved" && venueSlug !== null) {
    useCockpitStore.getState().setPlannerRoomIdentity({
      ...roomKey,
      status,
      venueSlug,
    });
    return;
  }
  useCockpitStore.getState().setPlannerRoomIdentity({
    ...roomKey,
    status: status === "resolved" ? "unavailable" : status,
    venueSlug: null,
  });
}

beforeEach(() => {
  useCockpitStore.getState().reset();
  useEditorStore.getState().reset();
  useEditorStore.setState({
    configId: "cfg-1",
    space: GRAND_HALL_SPACE,
    isLoading: false,
    error: null,
    loadConfiguration: originalLoadConfiguration,
  });
  setRoomIdentity("resolved", "another-venue");
});

afterEach(() => {
  cleanup();
  useCockpitStore.getState().reset();
});

describe("EditorPage cockpit", () => {
  it("renders the cockpit at /plan on desktop when a config is loaded", async () => {
    render(
      <MemoryRouter initialEntries={["/plan/cfg-1"]}>
        <Routes><Route path="/plan/:code" element={<EditorPage />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => { expect(screen.getByTestId("planner-cockpit")).toBeTruthy(); });
  });

  it("keeps the planner non-interactive until the requested configuration owns the store", async () => {
    let completeLoad: (() => void) | undefined;
    const loadConfiguration = vi.fn((configId: string) => new Promise<void>((resolve) => {
      completeLoad = () => {
        useEditorStore.setState({ configId, isLoading: false, error: null });
        resolve();
      };
    }));
    useEditorStore.setState({
      configId: "cfg-stale",
      isLoading: false,
      error: null,
      loadConfiguration,
    });

    render(
      <MemoryRouter initialEntries={["/plan/cfg-requested"]}>
        <Routes><Route path="/plan/:code" element={<EditorPage />} /></Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(loadConfiguration).toHaveBeenCalledWith("cfg-requested", false);
    });
    expect(screen.getByText("Loading the saved layout")).toBeTruthy();
    expect(screen.queryByTestId("planner-cockpit")).toBeNull();

    await act(async () => {
      completeLoad?.();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId("planner-3d-shell").getAttribute("data-planner-config-id"))
        .toBe("cfg-requested");
    });
  });

  it("honours a direct blueprint request only after a room resolves configurable", async () => {
    render(
      <MemoryRouter initialEntries={["/plan/cfg-1?view=2d"]}>
        <Routes><Route path="/plan/:code" element={<EditorPage />} /></Routes>
      </MemoryRouter>,
    );

    await waitFor(() => { expect(screen.getByTestId("mock-blueprint")).toBeTruthy(); });
    expect(screen.queryByTestId("planner-cockpit")).toBeNull();
    expect(screen.getByTestId("editor-bridge")).toBeTruthy();
    expect(screen.getByTestId("save-send-panel")).toBeTruthy();
    expect(screen.getByTestId("submit-review-panel")).toBeTruthy();
    expect(screen.getByTestId("object-note-panel")).toBeTruthy();
  });

  it("forces verified Trades Hall Grand Hall to source-only 3D and removes mutation chrome", async () => {
    setRoomIdentity("resolved", "trades-hall-glasgow");

    render(
      <MemoryRouter initialEntries={["/plan/cfg-1?view=2d&truth=1"]}>
        <Routes><Route path="/plan/:code" element={<EditorPage />} /></Routes>
      </MemoryRouter>,
    );

    await waitFor(() => { expect(screen.getByTestId("planner-cockpit")).toBeTruthy(); });
    expect(screen.queryByTestId("mock-blueprint")).toBeNull();
    expect(screen.queryByRole("button", { name: "2D" })).toBeNull();
    expect(screen.queryByTestId("editor-bridge")).toBeNull();
    expect(screen.queryByTestId("save-send-panel")).toBeNull();
    expect(screen.queryByTestId("submit-review-panel")).toBeNull();
    expect(screen.queryByTestId("object-note-panel")).toBeNull();
    expect(screen.queryByTestId("event-details-panel")).toBeNull();
    expect(screen.queryByText("Procedural preview")).toBeNull();
  });

  it.each([
    ["pending", null],
    ["unavailable", null],
  ] as const)("keeps %s room identity in non-mutating 3D", async (status, venueSlug) => {
    setRoomIdentity(status, venueSlug);

    render(
      <MemoryRouter initialEntries={["/plan/cfg-1?view=2d&truth=1"]}>
        <Routes><Route path="/plan/:code" element={<EditorPage />} /></Routes>
      </MemoryRouter>,
    );

    await waitFor(() => { expect(screen.getByTestId("planner-cockpit")).toBeTruthy(); });
    expect(screen.queryByTestId("mock-blueprint")).toBeNull();
    expect(screen.queryByRole("button", { name: "2D" })).toBeNull();
    expect(screen.queryByTestId("save-send-panel")).toBeNull();
    expect(screen.queryByTestId("submit-review-panel")).toBeNull();
    expect(screen.queryByText("Procedural preview")).toBeNull();
  });
});
