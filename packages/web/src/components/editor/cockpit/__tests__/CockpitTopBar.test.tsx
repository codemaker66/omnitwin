import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useEditorStore } from "../../../../stores/editor-store.js";
import { useAuthStore } from "../../../../stores/auth-store.js";
import { useCockpitStore } from "../../../../stores/cockpit-store.js";
import type { PlannerLayerPolicy } from "../../../../lib/planner-layer-composition.js";
import { CockpitTopBar } from "../CockpitTopBar.js";

const CONFIGURABLE_POLICY: PlannerLayerPolicy = {
  kind: "configurable",
  effectiveMode: "hybrid",
  controlsLocked: false,
};
const CAPTURED_ONLY_POLICY: PlannerLayerPolicy = {
  kind: "captured-only",
  effectiveMode: "splat",
  controlsLocked: true,
};
const PENDING_POLICY: PlannerLayerPolicy = {
  kind: "identity-pending",
  effectiveMode: "hybrid",
  controlsLocked: true,
};
const UNAVAILABLE_POLICY: PlannerLayerPolicy = {
  kind: "identity-unavailable",
  effectiveMode: "hybrid",
  controlsLocked: true,
};

function renderTopBar(layerPolicy: PlannerLayerPolicy = CONFIGURABLE_POLICY): void {
  render(
    <MemoryRouter initialEntries={["/plan/cfg-1"]}>
      <CockpitTopBar layerPolicy={layerPolicy} />
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

  it("replaces layout quantities and overlay controls with source-only status", () => {
    renderTopBar(CAPTURED_ONLY_POLICY);

    expect(screen.getByText("Source-only inspection")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /layers/i })).toBeNull();
  });

  it("uses generic resolving copy while a non-Grand-Hall identity is pending", () => {
    useEditorStore.setState({
      space: {
        id: "space-grand-hall",
        venueId: "venue-trades-hall",
        name: "Grand Hall",
        slug: "grand-hall",
        widthM: "21",
        lengthM: "10.5",
        heightM: "7",
        floorPlanOutline: [],
      },
    });
    useCockpitStore.getState().setRuntimeAssetStatus(
      "Exact captured Grand Hall source verified — all 11 members attached",
    );

    renderTopBar(PENDING_POLICY);

    expect(screen.getByText("Room identity resolving")).toBeTruthy();
    expect(screen.getByText("Room source resolving")).toBeTruthy();
    expect(screen.getByText("Room identity resolving — architectural layer hidden")).toBeTruthy();
    expect(screen.queryByText("Grand Hall")).toBeNull();
    expect(screen.queryByText(/all 11 members attached/i)).toBeNull();
    expect(screen.queryByText(/source-only/i)).toBeNull();
  });

  it("uses neutral room and runtime copy when identity is unavailable", () => {
    useEditorStore.setState({
      space: {
        id: "space-grand-hall",
        venueId: "venue-trades-hall",
        name: "Grand Hall",
        slug: "grand-hall",
        widthM: "21",
        lengthM: "10.5",
        heightM: "7",
        floorPlanOutline: [],
      },
    });
    useCockpitStore.getState().setRuntimeAssetStatus(
      "Exact captured Grand Hall source verified — all 11 members attached",
    );

    renderTopBar(UNAVAILABLE_POLICY);

    expect(screen.getByText("Room source unavailable")).toBeTruthy();
    expect(screen.getByText("Room identity unavailable — architectural layer hidden")).toBeTruthy();
    expect(screen.queryByText("Grand Hall")).toBeNull();
    expect(screen.queryByText(/all 11 members attached/i)).toBeNull();
  });

  it("shows exact-runtime status only when its lifecycle key matches the captured room", () => {
    useEditorStore.setState({
      space: {
        id: "space-grand-hall",
        venueId: "venue-trades-hall",
        name: "Grand Hall",
        slug: "grand-hall",
        widthM: "21",
        lengthM: "10.5",
        heightM: "7",
        floorPlanOutline: [],
      },
    });
    useCockpitStore.getState().beginExactGrandHallRuntime({
      spaceId: "another-space",
      venueId: "venue-trades-hall",
      roomSlug: "grand-hall",
      runtimePackageId: "stale-package",
    });

    const { unmount } = render(
      <MemoryRouter initialEntries={["/plan/cfg-1"]}>
        <CockpitTopBar layerPolicy={CAPTURED_ONLY_POLICY} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Captured Grand Hall source not verified — architectural layer hidden")).toBeTruthy();
    expect(screen.queryByText(/verifying exact protected bytes/i)).toBeNull();
    unmount();

    useCockpitStore.getState().beginExactGrandHallRuntime({
      spaceId: "space-grand-hall",
      venueId: "venue-trades-hall",
      roomSlug: "grand-hall",
      runtimePackageId: "current-package",
    });
    useCockpitStore.getState().completeExactGrandHallRuntime({
      spaceId: "space-grand-hall",
      venueId: "venue-trades-hall",
      roomSlug: "grand-hall",
      runtimePackageId: "current-package",
    }, "verified");
    renderTopBar(CAPTURED_ONLY_POLICY);
    expect(screen.getByText(/all 11 members attached/i)).toBeTruthy();
  });
});
