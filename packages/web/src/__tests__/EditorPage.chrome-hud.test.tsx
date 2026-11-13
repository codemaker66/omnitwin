import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The HUD behind its flag (docs/superpowers/specs/2026-11-13-planner-hud-design.md;
// its look, docs/superpowers/specs/2026-11-13-planner-hud-design.md). With `?chrome=hud` the
// planner is the room, full bleed, between the HUD's two bars (the top bar
// and the shelf), and none of v1's surfaces (the cockpit and its docks, the
// 3D/2D switch, the Event details button, the floating panels). The layout
// still syncs and saves through one EditorBridge. Without the flag v1 is still
// the default, and `?chrome=v2` still gives the second chrome.
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
const bridge = vi.hoisted(() => ({ mounts: 0 }));
vi.mock("../components/editor/EditorBridge.js", () => ({
  EditorBridge: () => {
    useEffect(() => {
      bridge.mounts += 1;
    }, []);
    return <div data-testid="editor-bridge" />;
  },
}));
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
const { usePlannerHudStore } = await import("../stores/planner-hud-store.js");
const { PLANNER_CHROME_STORAGE_KEY } = await import("../lib/planner-chrome-flag.js");
const { setPlannerChromeFeatures, setPlannerFeaturesForTesting } = await import("../lib/planner-features.js");
const originalLoadConfiguration = useEditorStore.getState().loadConfiguration;
// The page loads the HUD lazily; having it in the module cache keeps its first transform out of the tests' waits.
await import("../components/planner-hud/PlannerHud.js");

/** The lazy HUD, once it has loaded. */
async function hudOnScreen(): Promise<HTMLElement> {
  return waitFor(() => screen.getByTestId("planner-hud"), { timeout: 10_000 });
}

function openPlanner(search = ""): void {
  render(
    <MemoryRouter initialEntries={[`/plan/cfg-1${search}`]}>
      <Routes><Route path="/plan/:code" element={<EditorPage />} /></Routes>
    </MemoryRouter>,
  );
}

/** Everything today's planner has on screen that the HUD replaces. */
const V1_SURFACES = [
  "planner-cockpit",
  "mock-editor-3d",
  "mock-blueprint",
  "mobile-top-bar",
  "save-send-panel",
  "submit-for-review",
  "object-note-panel",
  "event-details-panel",
] as const;

beforeEach(() => {
  window.localStorage.removeItem(PLANNER_CHROME_STORAGE_KEY);
  media.mobile = false;
  bridge.mounts = 0;
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
  window.localStorage.removeItem(PLANNER_CHROME_STORAGE_KEY);
  usePlannerHudStore.getState().reset();
  setPlannerFeaturesForTesting(null);
  setPlannerChromeFeatures({});
});

describe("EditorPage with the HUD", () => {
  it("renders the HUD over the room, and none of v1's surfaces", async () => {
    openPlanner("?chrome=hud");
    await hudOnScreen();

    // The room is the page's main landmark, inside the HUD.
    const hud = screen.getByTestId("planner-hud");
    expect(screen.getByRole("main").contains(screen.getByTestId("mock-room-stage"))).toBe(true);
    expect(hud.contains(screen.getByRole("main"))).toBe(true);

    for (const v1 of V1_SURFACES) expect(screen.queryByTestId(v1), v1).toBeNull();
    expect(screen.queryByTestId("planner-chrome-v2")).toBeNull();
    expect(screen.queryByRole("group", { name: "View mode" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Event details" })).toBeNull();
  });

  it("keeps the layout syncing: EditorBridge is mounted exactly once", async () => {
    openPlanner("?chrome=hud");
    await hudOnScreen();
    expect(screen.getAllByTestId("editor-bridge")).toHaveLength(1);
    expect(bridge.mounts).toBe(1);
  });

  it("shows the journey's four steps, in order, under a plain name", async () => {
    openPlanner("?chrome=hud");
    await hudOnScreen();
    const journey = screen.getByRole("navigation", { name: "Your plan, step by step" });
    const steps = within(journey).getAllByRole("listitem").map((item) => item.textContent);
    expect(steps).toEqual(["Your event", "Lay out", "Finishing touches", "Send"]);
  });

  it("says the room's facts once, on the shelf's status line, with no column of seals", async () => {
    openPlanner("?chrome=hud");
    await hudOnScreen();
    const shelf = screen.getByRole("region", { name: "Furniture and the next steps" });
    expect(within(shelf).getByRole("status", { name: "The room as it stands" }).textContent).toContain("0 seats placed");
    expect(screen.queryByRole("complementary", { name: "Your room" })).toBeNull();
  });

  it("deals the hand: eight cards, More, the keys beside them, and the one primary key", async () => {
    openPlanner("?chrome=hud");
    await hudOnScreen();
    const hand = screen.getByRole("region", { name: "Furniture and the next steps" });
    expect(hand.querySelectorAll("[data-card]")).toHaveLength(8);
    expect(within(hand).getByRole("button", { name: "More furniture" })).toBeTruthy();
    expect(within(hand).getByRole("button", { name: "Lay out for me" })).toBeTruthy();
    expect(within(hand).getByRole("button", { name: "Undo" })).toBeTruthy();
    expect(within(hand).getByRole("button", { name: "Redo" })).toBeTruthy();
    expect(within(hand).getByRole("button", { name: "Say how many guests" })).toBeTruthy();
    expect(within(hand).queryByRole("button", { name: "Send to Events Team" })).toBeNull();
  });

  it("has the view's more-tools key, and no piece verbs until something is chosen", async () => {
    openPlanner("?chrome=hud");
    await hudOnScreen();
    expect(screen.getByRole("button", { name: "More tools" })).toBeTruthy();
    expect(document.querySelector(".hud-piece")).toBeNull();
  });

  it("is remembered on this device until another chrome is asked for", async () => {
    openPlanner("?chrome=hud");
    await hudOnScreen();
    cleanup();
    openPlanner();
    await hudOnScreen();
    cleanup();
    openPlanner("?chrome=v1");
    await waitFor(() => { expect(screen.getByTestId("planner-cockpit")).toBeTruthy(); });
    expect(screen.queryByTestId("planner-hud")).toBeNull();
  });
});

describe("the other chromes beside the HUD", () => {
  it("is still today's chrome without the flag", async () => {
    openPlanner();
    await waitFor(() => { expect(screen.getByTestId("planner-cockpit")).toBeTruthy(); });
    expect(screen.getByRole("group", { name: "View mode" })).toBeTruthy();
    expect(screen.queryByTestId("planner-hud")).toBeNull();
    expect(screen.queryByTestId("planner-chrome-v2")).toBeNull();
  });

  it("still renders the second chrome for ?chrome=v2, with no HUD", async () => {
    openPlanner("?chrome=v2");
    await waitFor(() => { expect(screen.getByTestId("planner-chrome-v2")).toBeTruthy(); });
    expect(screen.queryByTestId("planner-hud")).toBeNull();
    expect(screen.getByTestId("mock-room-stage")).toBeTruthy();
    expect(screen.getAllByTestId("editor-bridge")).toHaveLength(1);
    for (const v1 of V1_SURFACES) expect(screen.queryByTestId(v1), v1).toBeNull();
  });
});
