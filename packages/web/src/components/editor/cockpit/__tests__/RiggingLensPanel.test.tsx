import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RiggingLensPanel } from "../RiggingLensPanel.js";
import { useLightingRigStore } from "../../../../stores/lighting-rig-store.js";

function metricValue(label: string): string {
  const labelEl = screen.getByText(label);
  return labelEl.nextElementSibling?.textContent ?? "";
}

beforeEach(() => { useLightingRigStore.getState().reset(); });
afterEach(() => { cleanup(); useLightingRigStore.getState().reset(); });

describe("RiggingLensPanel", () => {
  it("renders the default single-point assessment within WLL", () => {
    render(<RiggingLensPanel />);
    expect(screen.getByTestId("rigging-lens-panel")).toBeTruthy();
    expect(screen.getByText("Rigging & WLL")).toBeTruthy();
    // 200 kg load, single point, WLL 500 → tension 200, 40 %, headroom 300.
    expect(metricValue("Leg tension")).toBe("200 kg");
    expect(metricValue("Utilisation")).toBe("40% of WLL");
    expect(metricValue("Headroom")).toBe("300 kg");
    expect(screen.getByTestId("rig-status").textContent).toBe("Within WLL");
    expect(screen.queryByTestId("rig-warning")).toBeNull();
  });

  it("flags Over WLL when the load exceeds the point limit", () => {
    render(<RiggingLensPanel />);
    fireEvent.change(screen.getByTestId("rig-load"), { target: { value: "600" } });
    expect(screen.getByTestId("rig-status").textContent).toBe("Over WLL");
    expect(screen.getAllByTestId("rig-warning").length).toBeGreaterThanOrEqual(1);
  });

  it("warns on a shallow two-leg bridle angle", () => {
    render(<RiggingLensPanel />);
    fireEvent.click(screen.getByTestId("rig-2leg"));
    fireEvent.change(screen.getByTestId("rig-angle"), { target: { value: "20" } });
    expect(screen.getAllByTestId("rig-warning").some((el) => /Shallow bridle angle/.test(el.textContent ?? ""))).toBe(true);
  });

  it("forbids a hoist on a static-only point", () => {
    render(<RiggingLensPanel />);
    fireEvent.change(screen.getByTestId("rig-permitted"), { target: { value: "static-only" } });
    fireEvent.change(screen.getByTestId("rig-loadkind"), { target: { value: "power-hoist" } });
    expect(screen.getAllByTestId("rig-warning").some((el) => /static-only point must NOT anchor a hoist/.test(el.textContent ?? ""))).toBe(true);
  });

  it("offers the imported rig weight as the suspended load", () => {
    useLightingRigStore.getState().clear();
    useLightingRigStore.getState().addImportedFixture(
      { manufacturer: "Robe", name: "MegaPointe", family: "beam-hybrid", channels: 40, weightKg: 25, modeName: "Standard" },
      4, // 4 × 25 kg = 100 kg
    );
    render(<RiggingLensPanel />);
    const button = screen.getByTestId("rig-use-rig-weight");
    expect(button.textContent).toContain("100 kg");
    fireEvent.click(button);
    expect(screen.getByTestId<HTMLInputElement>("rig-load").value).toBe("100");
  });

  it("hides the rig-weight shortcut when no imported fixtures carry weight", () => {
    render(<RiggingLensPanel />);
    expect(screen.queryByTestId("rig-use-rig-weight")).toBeNull();
  });
});
