import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AVLensPanel } from "../AVLensPanel.js";

function metricValue(label: string): string {
  const labelEl = screen.getByText(label);
  return labelEl.nextElementSibling?.textContent ?? "";
}

afterEach(() => { cleanup(); });

describe("AVLensPanel", () => {
  it("renders clear speech for the default speaker / room", () => {
    render(<AVLensPanel />);
    expect(screen.getByTestId("av-lens-panel")).toBeTruthy();
    expect(screen.getByText("AV & coverage")).toBeTruthy();
    // 127 dB @1m, 12 m throw → ~105 dB; 90° → 24 m wide; ambient 70 → ~35 dB SNR.
    expect(metricValue("SPL at listener")).toBe("105 dB");
    expect(metricValue("Coverage width")).toBe("24.0 m at 12 m");
    expect(metricValue("Speech SNR")).toBe("35 dB over ambient");
    expect(screen.getByTestId("av-status").textContent).toBe("Clear speech");
  });

  it("flags below-ambient when the room is too loud", () => {
    render(<AVLensPanel />);
    fireEvent.change(screen.getByTestId("av-ambient"), { target: { value: "110" } });
    expect(screen.getByTestId("av-status").textContent).toBe("Below ambient");
  });

  it("recomputes coverage width when the angle narrows", () => {
    render(<AVLensPanel />);
    fireEvent.change(screen.getByTestId("av-angle"), { target: { value: "60" } });
    expect(metricValue("Coverage width")).toBe("13.9 m at 12 m");
  });
});
