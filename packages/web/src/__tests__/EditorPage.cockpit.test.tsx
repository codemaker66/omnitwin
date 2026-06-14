import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

beforeEach(() => {
  useEditorStore.setState({ configId: "cfg-1", isLoading: false, error: null });
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
});
