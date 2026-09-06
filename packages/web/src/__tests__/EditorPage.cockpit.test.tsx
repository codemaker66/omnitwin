import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../App.js", () => ({ App: () => <div data-testid="mock-editor-3d" /> }));
vi.mock("../components/editor/cockpit/PlannerCockpit.js", () => ({
  PlannerCockpit: () => <div data-testid="planner-cockpit" />,
}));
vi.mock("../pages/BlueprintPage.js", () => ({ BlueprintPage: () => <div data-testid="mock-blueprint" /> }));
vi.mock("../components/editor/MobilePlannerTopBar.js", () => ({ MobilePlannerTopBar: ({ onModeChange }: { onModeChange: (mode: "2d" | "3d") => void }) => <button type="button" onClick={() => { onModeChange("2d"); }}>Show test plan</button> }));
vi.mock("../components/editor/SaveSendPanel.js", () => ({ SaveSendPanel: () => null }));
vi.mock("../components/editor/SubmitForReviewPanel.js", () => ({ SubmitForReviewPanel: () => null }));
vi.mock("../components/editor/EditorBridge.js", () => ({ EditorBridge: () => null }));
vi.mock("../components/editor/ObjectNotePanel.js", () => ({ ObjectNotePanel: () => null }));
vi.mock("../components/editor/EventDetailsPanel.js", () => ({ EventDetailsPanel: () => null }));
vi.mock("../components/truth/TruthModeIndicator.js", () => ({ TruthModeIndicator: ({ summary }: { summary: { truthStatusLabel: string; displayedCaptureSource: string | null; measuredRuntimeAssetsLoaded: boolean } }) => <div data-testid="consumer-truth" data-capture={summary.displayedCaptureSource ?? "none"} data-measured={String(summary.measuredRuntimeAssetsLoaded)}>{summary.truthStatusLabel}</div> }));
const media = vi.hoisted(() => ({ mobile: false }));
vi.mock("../hooks/use-media-query.js", () => ({
  useIsCoarsePointer: () => false,
  useIsNarrowViewport: () => media.mobile,
}));

const { EditorPage } = await import("../pages/EditorPage.js");
const { useEditorStore } = await import("../stores/editor-store.js");
const { useCockpitStore } = await import("../stores/cockpit-store.js");
const originalLoadConfiguration = useEditorStore.getState().loadConfiguration;

beforeEach(() => {
  media.mobile = false;
  useCockpitStore.getState().reset();
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
  it("consumes only the current displayed capture and withdraws it for another config, hidden layer and 2D", async () => {
    media.mobile = true;
    useEditorStore.setState({ space: null });
    useCockpitStore.getState().setLayerMode("splat");
    const source = { configId: "cfg-1", spaceId: null, layerMode: "splat" as const, captureSource: "staged" as const, loadedChunks: 1, totalChunks: 12, proceduralGeometryVisible: false };
    useCockpitStore.getState().setSceneSource(source);
    render(<MemoryRouter initialEntries={["/plan/cfg-1"]}><Routes><Route path="/plan/:code" element={<EditorPage />} /></Routes></MemoryRouter>);
    await waitFor(() => { expect(screen.getByTestId("consumer-truth").getAttribute("data-capture")).toBe("staged"); });
    expect(screen.getByTestId("consumer-truth").getAttribute("data-measured")).toBe("false");
    act(() => { useCockpitStore.getState().setSceneSource({ ...source, configId: "old-config" }); });
    expect(screen.getByTestId("consumer-truth").getAttribute("data-capture")).toBe("none");
    act(() => { useCockpitStore.getState().setSceneSource(source); useCockpitStore.getState().setLayerMode("mesh"); });
    expect(screen.getByTestId("consumer-truth").getAttribute("data-capture")).toBe("none");
    act(() => { useCockpitStore.getState().setLayerMode("splat"); });
    expect(screen.getByTestId("consumer-truth").getAttribute("data-capture")).toBe("staged");
    fireEvent.click(screen.getByRole("button", { name: "Show test plan" }));
    expect(screen.getByTestId("consumer-truth").getAttribute("data-capture")).toBe("none");
    expect(screen.getByTestId("consumer-truth").textContent).toBe("2D planning geometry");
  });

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
