import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Space } from "../../../api/spaces.js";
import type { PlannerLayerPolicy } from "../../../lib/planner-layer-composition.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { MobilePlannerTopBar } from "../MobilePlannerTopBar.js";

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

beforeEach(() => {
  useEditorStore.getState().reset();
  useEditorStore.setState({
    configId: "config-1",
    space: GRAND_HALL_SPACE,
  });
  useAuthStore.getState().setUser(null);
});

afterEach(() => {
  cleanup();
  useEditorStore.getState().reset();
});

describe("MobilePlannerTopBar room-source policy", () => {
  it("preserves the editable draft, 2D, and send controls for configurable rooms", () => {
    useEditorStore.getState().addObject("chair", 0, 0, 0);

    render(
      <MobilePlannerTopBar
        mode="3d"
        onModeChange={() => {}}
        layerPolicy={CONFIGURABLE_POLICY}
      />,
    );

    expect(screen.getByText("Grand Hall")).toBeTruthy();
    expect(screen.getByText("Banquet Draft")).toBeTruthy();
    expect(screen.getByRole("button", { name: "2D" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send to Events Team" })).toBeTruthy();
  });

  it("reduces a verified captured room to a source-only 3D status", () => {
    useEditorStore.getState().addObject("chair", 0, 0, 0);

    render(
      <MobilePlannerTopBar
        mode="3d"
        onModeChange={() => {}}
        layerPolicy={CAPTURED_ONLY_POLICY}
      />,
    );

    expect(screen.getByText("Grand Hall")).toBeTruthy();
    expect(screen.getByText("Captured source · 3D only")).toBeTruthy();
    expect(screen.queryByText("Banquet Draft")).toBeNull();
    expect(screen.queryByRole("button", { name: "2D" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Send to Events Team" })).toBeNull();
  });

  it.each([
    ["identity-pending", "Room source resolving"],
    ["identity-unavailable", "Room source unavailable"],
  ] as const)("uses neutral copy for %s without leaking the prior room title", (kind, title) => {
    const layerPolicy: PlannerLayerPolicy = {
      kind,
      effectiveMode: "hybrid",
      controlsLocked: true,
    };

    render(
      <MobilePlannerTopBar
        mode="3d"
        onModeChange={() => {}}
        layerPolicy={layerPolicy}
      />,
    );

    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText("Source-only 3D")).toBeTruthy();
    expect(screen.queryByText("Grand Hall")).toBeNull();
    expect(screen.queryByText("Banquet Draft")).toBeNull();
    expect(screen.queryByText("Procedural preview")).toBeNull();
    expect(screen.queryByRole("button", { name: "2D" })).toBeNull();
  });
});
