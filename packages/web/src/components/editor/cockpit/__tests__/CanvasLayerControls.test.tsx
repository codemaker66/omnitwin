import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useCockpitStore } from "../../../../stores/cockpit-store.js";
import { useEditorStore } from "../../../../stores/editor-store.js";
import type { Space } from "../../../../api/spaces.js";
import { CanvasLayerControls } from "../CanvasLayerControls.js";

function spaceWith(slug: string): Space {
  return {
    id: "s1", venueId: "v1", name: "Room", slug,
    widthM: "10", lengthM: "10", heightM: "5",
    floorPlanOutline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
  };
}

beforeEach(() => {
  useCockpitStore.getState().reset();
  useEditorStore.setState({ space: null });
});
afterEach(() => { cleanup(); });

describe("CanvasLayerControls", () => {
  it("renders mesh/splat/hybrid with hybrid pressed by default", () => {
    render(<CanvasLayerControls />);
    expect(screen.getByRole("button", { name: /mesh/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /splat/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /hybrid/i }).getAttribute("aria-pressed")).toBe("true");
  });

  it("sets the layer mode in the cockpit store on click", () => {
    render(<CanvasLayerControls />);
    fireEvent.click(screen.getByRole("button", { name: /splat/i }));
    expect(useCockpitStore.getState().layerMode).toBe("splat");
    expect(screen.getByRole("button", { name: /splat/i }).getAttribute("aria-pressed")).toBe("true");
  });

  it("disables Walk when the loaded space has no capture to walk", () => {
    useEditorStore.setState({ space: spaceWith("some-other-room") });
    render(<CanvasLayerControls />);
    const walk = screen.getByTestId("planner-walk-toggle");
    expect((walk as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables Walk for a captured room with walk data, and toggles the store", () => {
    // Every current Trades Hall capture carries walk data; reception is the
    // canonical clean one.
    useEditorStore.setState({ space: spaceWith("reception-room") });
    render(<CanvasLayerControls />);
    const walk = screen.getByTestId("planner-walk-toggle");
    expect((walk as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(walk);
    expect(useCockpitStore.getState().walkMode).toBe(true);
    expect(walk.getAttribute("aria-pressed")).toBe("true");
  });

  it("leaves walk mode on Escape", () => {
    useEditorStore.setState({ space: spaceWith("reception-room") });
    useCockpitStore.getState().setWalkMode(true);
    render(<CanvasLayerControls />);
    fireEvent.keyDown(window, { code: "Escape" });
    expect(useCockpitStore.getState().walkMode).toBe(false);
  });
});
