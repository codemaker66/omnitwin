import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TruthModeIndicator } from "../TruthModeIndicator.js";
import {
  buildProceduralTruthSummary,
  isTruthModeUiEnabled,
} from "../../../lib/truth-mode-summary.js";

afterEach(() => {
  cleanup();
});

function renderProceduralIndicator(): void {
  render(
    <TruthModeIndicator
      summary={buildProceduralTruthSummary({
        surface: "planner_3d",
        placedObjectCount: 3,
        measuredRuntimeAssetsLoaded: false,
      })}
    />,
  );
}

describe("TruthModeIndicator", () => {
  it("renders the persistent L1 indicator", () => {
    renderProceduralIndicator();
    expect(screen.getByTestId("truth-mode-indicator")).toBeTruthy();
    expect(screen.getByText("Truth Mode L1")).toBeTruthy();
    expect(screen.getByText(/3D planning: Procedural preview/)).toBeTruthy();
    expect(screen.getByText("Procedural content present")).toBeTruthy();
    expect(screen.getByText("Measured runtime not loaded")).toBeTruthy();
  });

  it("opens and closes the L2 popover", () => {
    renderProceduralIndicator();
    fireEvent.click(screen.getByTestId("truth-mode-toggle"));
    expect(screen.getByRole("dialog", { name: /Truth Mode summary/i })).toBeTruthy();
    expect(screen.getByText("Truth Mode L2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Close Truth Mode summary/i }));
    expect(screen.queryByRole("dialog", { name: /Truth Mode summary/i })).toBeNull();
  });

  it("labels generated/procedural scenes honestly", () => {
    renderProceduralIndicator();
    fireEvent.click(screen.getByTestId("truth-mode-toggle"));
    expect(screen.getAllByText(/procedural runtime/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/procedural placeholder venue geometry/i)).toBeTruthy();
    expect(screen.getByText(/No signed measured RuntimeVenueManifest asset/i)).toBeTruthy();
  });

  it("does not show a verified status without verification data", () => {
    const { container } = render(
      <TruthModeIndicator
        summary={buildProceduralTruthSummary({
          surface: "spark_fixture",
          placedObjectCount: 0,
          measuredRuntimeAssetsLoaded: false,
        })}
      />,
    );
    fireEvent.click(screen.getByTestId("truth-mode-toggle"));
    expect(container.textContent).not.toMatch(/\bVerified\b/);
    expect(container.textContent).toContain("No review record or signed QA certificate is loaded");
  });

  it("uses a viewport-constrained width for mobile", () => {
    renderProceduralIndicator();
    const root = screen.getByTestId("truth-mode-indicator");
    expect(root.getAttribute("style") ?? "").toContain("calc(100vw - 24px)");
  });

  it("is gated in production unless the query param is present", () => {
    expect(isTruthModeUiEnabled(new URLSearchParams(), false)).toBe(false);
    expect(isTruthModeUiEnabled(new URLSearchParams("truth=1"), false)).toBe(true);
    expect(isTruthModeUiEnabled(new URLSearchParams("truthMode=true"), false)).toBe(true);
    expect(isTruthModeUiEnabled(new URLSearchParams(), true)).toBe(true);
  });
});
