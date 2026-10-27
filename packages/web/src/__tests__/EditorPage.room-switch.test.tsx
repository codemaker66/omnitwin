import { act, cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The slate's room switch (QoL D-X3). It leaves /plan/<layout> for
// /plan?space=<room> in the same page, and the bootstrap opens a room only
// when no layout is open, so on master the switch changed the address and the
// old layout stayed on screen (measured in Chromium). The switch names the
// layout it leaves; the page closes exactly that one, and the bootstrap opens
// the room. Any other arrival at /plan keeps what is open.
// ---------------------------------------------------------------------------

vi.mock("../components/planner-chrome/PlannerChromeV2.js", () => ({ PlannerChromeV2: () => <div data-testid="planner-chrome-v2" /> }));
vi.mock("../components/editor/cockpit/PlannerCockpit.js", () => ({ PlannerCockpit: () => <div data-testid="planner-cockpit" /> }));
vi.mock("../components/editor/EditorBridge.js", () => ({ EditorBridge: () => null }));
vi.mock("../api/spaces.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/spaces.js")>();
  return { ...actual, listVenues: vi.fn(() => new Promise(() => undefined)), getSpace: vi.fn(() => new Promise(() => undefined)) };
});

const { EditorPage } = await import("../pages/EditorPage.js");
const { useEditorStore } = await import("../stores/editor-store.js");
const { useAuthStore } = await import("../stores/auth-store.js");
const spacesApi = await import("../api/spaces.js");

const routes = [
  { path: "/plan", element: <EditorPage /> },
  { path: "/plan/:code", element: <EditorPage /> },
];

beforeEach(() => {
  vi.mocked(spacesApi.listVenues).mockClear();
  useAuthStore.setState({ isLoading: false });
  useEditorStore.setState({
    configId: "cfg-grand-hall",
    isLoading: false,
    error: null,
    loadConfiguration: vi.fn(() => Promise.resolve()),
  });
});

afterEach(() => {
  cleanup();
  useEditorStore.getState().reset();
});

describe("the slate's room switch", () => {
  it("closes the layout it leaves, so the planner opens the room", async () => {
    const router = createMemoryRouter(routes, { initialEntries: ["/plan/cfg-grand-hall?chrome=v2"] });
    render(<RouterProvider router={router} />);
    expect(await screen.findByTestId("planner-chrome-v2")).toBeTruthy();

    await act(async () => {
      await router.navigate("/plan?space=saloon&chrome=v2", { state: { leavingLayout: "cfg-grand-hall" } });
    });

    expect(useEditorStore.getState().configId).toBeNull();
    expect(spacesApi.listVenues).toHaveBeenCalled();
  });

  it("keeps what is open for any other arrival at /plan", async () => {
    const router = createMemoryRouter(routes, { initialEntries: ["/plan/cfg-grand-hall?chrome=v2"] });
    render(<RouterProvider router={router} />);
    expect(await screen.findByTestId("planner-chrome-v2")).toBeTruthy();

    await act(async () => {
      await router.navigate("/plan?space=saloon&chrome=v2");
    });
    expect(useEditorStore.getState().configId).toBe("cfg-grand-hall");

    await act(async () => {
      await router.navigate("/plan?space=saloon&chrome=v2", { state: { leavingLayout: "cfg-another" } });
    });
    expect(useEditorStore.getState().configId).toBe("cfg-grand-hall");
  });
});
