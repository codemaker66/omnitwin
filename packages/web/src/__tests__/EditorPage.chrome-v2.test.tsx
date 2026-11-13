import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The new chrome behind its flag (T-671 slice 6). Old and new chrome never
// render together: with `?chrome=v2` the planner is the room, full bleed, under
// the new chrome's zones, and none of today's surfaces (the cockpit and its
// docks, the 3D/2D switch, the Event details button, the floating panels).
// ---------------------------------------------------------------------------

vi.mock("../App.js", () => ({ App: () => <div data-testid="mock-editor-3d" /> }));
vi.mock("../components/editor/cockpit/PlannerCockpit.js", () => ({
  PlannerCockpit: () => <div data-testid="planner-cockpit" />,
}));
vi.mock("../components/planner-chrome/RoomStage.js", () => ({ RoomStage: () => <div data-testid="mock-room-stage" /> }));
vi.mock("../pages/BlueprintPage.js", () => ({ BlueprintPage: () => <div data-testid="mock-blueprint" /> }));
vi.mock("../components/editor/MobilePlannerTopBar.js", () => ({ MobilePlannerTopBar: () => <div data-testid="mobile-top-bar" /> }));
vi.mock("../components/editor/SaveSendPanel.js", () => ({ SaveSendPanel: () => <div data-testid="save-send-panel" /> }));
vi.mock("../components/editor/SubmitForReviewPanel.js", () => ({ SubmitForReviewPanel: () => <div data-testid="submit-for-review" /> }));
vi.mock("../components/editor/EditorBridge.js", () => ({ EditorBridge: () => <div data-testid="editor-bridge" /> }));
vi.mock("../components/editor/ObjectNotePanel.js", () => ({ ObjectNotePanel: () => <div data-testid="object-note-panel" /> }));
vi.mock("../components/editor/EventDetailsPanel.js", () => ({ EventDetailsPanel: () => <div data-testid="event-details-panel" /> }));
const media = vi.hoisted(() => ({ mobile: false }));
vi.mock("../hooks/use-media-query.js", () => ({
  useIsCoarsePointer: () => false,
  useIsNarrowViewport: () => media.mobile,
}));

const { EditorPage } = await import("../pages/EditorPage.js");
const { useEditorStore } = await import("../stores/editor-store.js");
const { useCockpitStore } = await import("../stores/cockpit-store.js");
const { PLANNER_CHROME_STORAGE_KEY } = await import("../lib/planner-chrome-flag.js");
const originalLoadConfiguration = useEditorStore.getState().loadConfiguration;

function openPlanner(search = ""): void {
  render(
    <MemoryRouter initialEntries={[`/plan/cfg-1${search}`]}>
      <Routes><Route path="/plan/:code" element={<EditorPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.removeItem(PLANNER_CHROME_STORAGE_KEY);
  media.mobile = false;
  useCockpitStore.getState().reset();
  useEditorStore.setState({
    configId: "cfg-1",
    isLoading: false,
    error: null,
    isPublicPreview: false,
    loadConfiguration: originalLoadConfiguration,
  });
});

afterEach(() => {
  cleanup();
});

describe("EditorPage with the new chrome", () => {
  it("renders the room under the new chrome's zones, and none of today's surfaces", async () => {
    openPlanner("?chrome=v2");
    await waitFor(() => { expect(screen.getByTestId("planner-chrome-v2")).toBeTruthy(); });
    expect(screen.getByTestId("mock-room-stage")).toBeTruthy();
    for (const zone of ["slate", "top-centre", "utilities", "left", "right", "above-dock", "dock", "next-step"]) {
      expect(document.querySelector(`[data-pc-zone="${zone}"]`), zone).not.toBeNull();
    }
    // The room is the page's main landmark, and the layout still syncs and saves.
    expect(screen.getByRole("main").contains(screen.getByTestId("mock-room-stage"))).toBe(true);
    expect(screen.getByTestId("editor-bridge")).toBeTruthy();

    for (const v1 of ["planner-cockpit", "mock-editor-3d", "mock-blueprint", "mobile-top-bar", "save-send-panel", "submit-for-review", "object-note-panel", "event-details-panel"]) {
      expect(screen.queryByTestId(v1), v1).toBeNull();
    }
    expect(screen.queryByRole("group", { name: "View mode" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Event details" })).toBeNull();
  });

  it("keeps the new chrome on this device until v1 is asked for", async () => {
    openPlanner("?chrome=v2");
    await waitFor(() => { expect(screen.getByTestId("planner-chrome-v2")).toBeTruthy(); });
    cleanup();
    openPlanner();
    await waitFor(() => { expect(screen.getByTestId("planner-chrome-v2")).toBeTruthy(); });
    cleanup();
    openPlanner("?chrome=v1");
    await waitFor(() => { expect(screen.getByTestId("planner-cockpit")).toBeTruthy(); });
    expect(screen.queryByTestId("planner-chrome-v2")).toBeNull();
  });

  it("is today's chrome without the flag", async () => {
    openPlanner();
    await waitFor(() => { expect(screen.getByTestId("planner-cockpit")).toBeTruthy(); });
    expect(screen.getByRole("group", { name: "View mode" })).toBeTruthy();
    expect(screen.queryByTestId("planner-chrome-v2")).toBeNull();
  });
});
