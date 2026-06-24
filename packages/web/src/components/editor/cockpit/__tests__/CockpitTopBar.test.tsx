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
  it("renders brand, SAFE review badge, idle save status, user initials and 'No event linked'", () => {
    renderTopBar();
    expect(screen.getByText("Venviewer")).toBeTruthy();
    expect(screen.getByText(/Planning evidence \/ human review required/)).toBeTruthy();
    expect(screen.getByText("No event linked")).toBeTruthy();
    expect(screen.getByText("Save Layout")).toBeTruthy();
    expect(screen.getByText("BF")).toBeTruthy();
  });

  it("opens the Layers menu and toggles an overlay in the cockpit store", () => {
    renderTopBar();
    expect(screen.queryByRole("menu", { name: /layers/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /layers/i }));
    const menu = screen.getByRole("menu", { name: /layers/i });
    expect(useCockpitStore.getState().overlayVisibility.densityHeatmap).toBe(true);
    fireEvent.click(within(menu).getByRole("menuitemcheckbox", { name: /density heatmap/i }));
    expect(useCockpitStore.getState().overlayVisibility.densityHeatmap).toBe(false);
  });
});
