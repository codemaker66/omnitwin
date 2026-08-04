import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../App.js", () => ({ App: () => <div data-testid="mock-editor-3d" /> }));
vi.mock("../components/editor/cockpit/PlannerCockpit.js", () => ({
  PlannerCockpit: () => <div data-testid="planner-cockpit" />,
}));
vi.mock("../pages/BlueprintPage.js", () => ({ BlueprintPage: () => <div data-testid="mock-blueprint" /> }));
vi.mock("../components/editor/MobilePlannerTopBar.js", () => ({ MobilePlannerTopBar: () => null }));
vi.mock("../components/editor/SaveSendPanel.js", () => ({ SaveSendPanel: () => null }));
vi.mock("../components/editor/SubmitForReviewPanel.js", () => ({ SubmitForReviewPanel: () => null }));
vi.mock("../components/editor/EditorBridge.js", () => ({ EditorBridge: () => null }));
vi.mock("../components/editor/ObjectNotePanel.js", () => ({ ObjectNotePanel: () => null }));
vi.mock("../components/editor/EventDetailsPanel.js", () => ({ EventDetailsPanel: () => null }));
vi.mock("../components/truth/TruthModeIndicator.js", () => ({ TruthModeIndicator: () => null }));
vi.mock("../hooks/use-media-query.js", () => ({
  useIsCoarsePointer: () => false,
  useIsNarrowViewport: () => false,
}));

const { EditorPage } = await import("../pages/EditorPage.js");
const { useEditorStore } = await import("../stores/editor-store.js");
const originalLoadConfiguration = useEditorStore.getState().loadConfiguration;

beforeEach(() => {
  useEditorStore.setState({
    configId: "cfg-1",
    isLoading: false,
    error: null,
    loadConfiguration: originalLoadConfiguration,
  });
});

afterEach(() => {
  cleanup();
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
});
