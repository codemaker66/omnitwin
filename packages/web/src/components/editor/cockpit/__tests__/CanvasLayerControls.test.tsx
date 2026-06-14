import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useCockpitStore } from "../../../../stores/cockpit-store.js";
import { CanvasLayerControls } from "../CanvasLayerControls.js";

beforeEach(() => { useCockpitStore.getState().reset(); });
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
});
