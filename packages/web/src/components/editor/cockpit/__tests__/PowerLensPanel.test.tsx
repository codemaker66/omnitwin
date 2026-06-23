import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PowerLensPanel } from "../PowerLensPanel.js";
import { useLightingRigStore } from "../../../../stores/lighting-rig-store.js";

function metricValue(label: string): string {
  const labelEl = screen.getByText(label);
  return labelEl.nextElementSibling?.textContent ?? "";
}

beforeEach(() => { useLightingRigStore.getState().reset(); });
afterEach(() => { cleanup(); useLightingRigStore.getState().reset(); });

describe("PowerLensPanel", () => {
  it("distributes the starter rig across three balanced phases", () => {
    render(<PowerLensPanel />);
    expect(screen.getByTestId("power-lens-panel")).toBeTruthy();
    expect(screen.getByText("Power & distro")).toBeTruthy();
    // Starter rig 5,800 W over 3 phases → ~1,950/1,925/1,925 W, ~9.4 A each.
    expect(metricValue("Total load")).toBe("5,800 W");
    expect(screen.getByTestId("power-phase-L1").textContent).toMatch(/9\.4 A/);
    expect(screen.getByTestId("power-phase-L3")).toBeTruthy();
    expect(metricValue("Phase imbalance")).toBe("1%");
    expect(metricValue("Recommended supply")).toBe("16 A 3-phase");
    expect(screen.queryByTestId("power-warning")).toBeNull();
  });

  it("collapses onto one phase in single-phase mode", () => {
    render(<PowerLensPanel />);
    fireEvent.click(screen.getByTestId("power-1ph"));
    expect(screen.getByTestId("power-phase-L1").textContent).toMatch(/28\.0 A/); // 5800 / 207
    expect(screen.queryByTestId("power-phase-L2")).toBeNull();
    expect(metricValue("Phase imbalance")).toBe("0%");
  });

  it("warns when a phase exceeds the chosen breaker", () => {
    render(<PowerLensPanel />);
    fireEvent.change(screen.getByTestId("power-breaker"), { target: { value: "5" } });
    expect(screen.getAllByTestId("power-warning").length).toBeGreaterThanOrEqual(1);
  });

  it("shows an empty hint when the rig is cleared", () => {
    useLightingRigStore.getState().clear();
    render(<PowerLensPanel />);
    expect(metricValue("Total load")).toBe("0 W");
    expect(screen.getByTestId("power-empty")).toBeTruthy();
  });
});
