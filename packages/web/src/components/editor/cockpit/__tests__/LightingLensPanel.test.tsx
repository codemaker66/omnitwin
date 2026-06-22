import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LightingLensPanel } from "../LightingLensPanel.js";
import { useLightingRigStore } from "../../../../stores/lighting-rig-store.js";

function metricValue(label: string): string {
  const labelEl = screen.getByText(label);
  return labelEl.nextElementSibling?.textContent ?? "";
}

beforeEach(() => { useLightingRigStore.getState().reset(); });
afterEach(() => { cleanup(); useLightingRigStore.getState().reset(); });

describe("LightingLensPanel", () => {
  it("renders the starter rig with its DMX patch and power", () => {
    render(<LightingLensPanel />);
    expect(screen.getByTestId("lighting-lens-panel")).toBeTruthy();
    expect(screen.getByText("Lighting & DMX")).toBeTruthy();
    // Starter rig: 12 PAR (7ch) + 4 wash (13ch) + 2 profile (5ch) = 18 fixtures, 146 channels.
    expect(screen.getByTestId<HTMLInputElement>("rig-par").value).toBe("12");
    expect(metricValue("Fixtures")).toBe("18");
    expect(metricValue("DMX channels")).toBe("146");
    expect(metricValue("Universes")).toBe("1");
    expect(screen.getByTestId("dmx-universe-1")).toBeTruthy();
    // Power: 12×200 + 4×575 + 2×550 = 5,800 W; 5800 / (230×0.9) = 28.0 A.
    expect(metricValue("Total load")).toBe("5,800 W");
    expect(metricValue("Single-phase")).toBe("28.0 A @ 230 V");
  });

  it("re-patches into more universes when the rig grows", () => {
    render(<LightingLensPanel />);
    fireEvent.change(screen.getByTestId("rig-par"), { target: { value: "100" } });
    expect(useLightingRigStore.getState().counts.par).toBe(100);
    expect(metricValue("Universes")).toBe("2");
  });

  it("shows an empty patch hint when the rig is cleared", () => {
    render(<LightingLensPanel />);
    fireEvent.click(screen.getByTestId("rig-clear"));
    expect(screen.getByTestId("dmx-empty")).toBeTruthy();
    expect(metricValue("Fixtures")).toBe("0");
  });
});
