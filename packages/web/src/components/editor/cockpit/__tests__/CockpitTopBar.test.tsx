import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useEditorStore } from "../../../../stores/editor-store.js";
import { useAuthStore } from "../../../../stores/auth-store.js";
import { useCockpitStore } from "../../../../stores/cockpit-store.js";
import { CockpitTopBar } from "../CockpitTopBar.js";

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
