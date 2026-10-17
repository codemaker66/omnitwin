import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AVLensPanel } from "../AVLensPanel.js";

function metricValue(label: string): string {
  const labelEl = screen.getByText(label);
  return labelEl.nextElementSibling?.textContent ?? "";
}

function enter(testId: string, value: string): void {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

const VERDICT = /\b(clear speech|clear|good|marginal|intelligible|within|pass(?:es|ed)?|fits?|ok)\b/i;

afterEach(() => { cleanup(); });

describe("AVLensPanel — nothing assumed", () => {
  it("opens with every figure not recorded, no result and no verdict", () => {
    render(<AVLensPanel />);
    const panel = screen.getByTestId("av-lens-panel");
    for (const key of ["spl", "angle", "distance", "ambient"]) {
      expect(screen.getByTestId(`av-unrecorded-${key}`).textContent).toContain("Not recorded");
    }
    expect(screen.queryByText("SPL at listener")).toBeNull();
    expect(screen.queryByText("Speech over ambient")).toBeNull();
    expect(screen.queryByTestId("av-status")).toBeNull();
    expect(screen.queryByTestId("av-entered-note")).toBeNull();
    expect(screen.getByTestId("av-empty")).toBeTruthy();
    expect(panel.textContent).not.toMatch(VERDICT);
    for (const id of ["av-spl", "av-angle", "av-distance", "av-ambient", "av-target"]) {
      expect(screen.getByTestId<HTMLInputElement>(id).value).toBe("");
    }
  });

  it("works out only what the entered figures allow", () => {
    render(<AVLensPanel />);
    enter("av-spl", "127");
    enter("av-distance", "12");
    // 127 dB @ 1 m over a 12 m throw → about 105 dB.
    expect(metricValue("SPL at listener")).toBe("105 dB");
    expect(screen.queryByText("Coverage width")).toBeNull();
    expect(screen.queryByText("Speech over ambient")).toBeNull();
    expect(screen.getByTestId("av-unrecorded-ambient")).toBeTruthy();
    expect(screen.getByTestId("av-entered-note").textContent).toBe("Entered here in this plan; not a measurement of the room.");

    enter("av-angle", "90");
    expect(metricValue("Coverage width")).toBe("24.0 m at 12 m");
    enter("av-angle", "60");
    expect(metricValue("Coverage width")).toBe("13.9 m at 12 m");
  });

  it("states the speech level over ambient without a verdict word", () => {
    render(<AVLensPanel />);
    enter("av-spl", "127");
    enter("av-distance", "12");
    enter("av-ambient", "70");
    expect(metricValue("Speech over ambient")).toBe("35 dB over ambient");
    expect(screen.queryByTestId("av-status")).toBeNull();
    enter("av-target", "10");
    expect(metricValue("Target entered")).toBe("+10 dB over ambient");
    expect(screen.queryByTestId("av-status")).toBeNull();
    expect(screen.getByTestId("av-lens-panel").textContent).not.toMatch(VERDICT);
  });

  it("says plainly when the result falls short of an entered target or the ambient", () => {
    render(<AVLensPanel />);
    enter("av-spl", "100");
    enter("av-distance", "10");
    enter("av-ambient", "75");
    enter("av-target", "10");
    // 100 − 20 = 80 dB at the listener; 5 dB over a 75 dB room, 5 short of 10.
    expect(screen.getByTestId("av-status").textContent).toBe("Short of the target entered");
    expect(metricValue("Short of the target by")).toBe("5 dB");
    enter("av-ambient", "110");
    expect(screen.getByTestId("av-status").textContent).toBe("Below the ambient noise entered");
    expect(metricValue("Speech over ambient")).toBe("30 dB under ambient");
  });

  it("clearing a figure returns it to not recorded", () => {
    render(<AVLensPanel />);
    enter("av-ambient", "70");
    expect(screen.queryByTestId("av-unrecorded-ambient")).toBeNull();
    enter("av-ambient", "");
    expect(screen.getByTestId("av-unrecorded-ambient")).toBeTruthy();
  });
});
