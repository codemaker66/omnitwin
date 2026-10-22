import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TradesHallVenueStatus } from "../../../../hooks/use-trades-hall-venue.js";

const venue = vi.hoisted(() => ({ status: "trades-hall" as TradesHallVenueStatus }));
vi.mock("../../../../hooks/use-trades-hall-venue.js", () => ({
  useTradesHallVenueStatus: () => venue.status,
  useTradesHallVenue: () => venue.status === "trades-hall",
}));

const { RiggingLensPanel } = await import("../RiggingLensPanel.js");
const { useLightingRigStore } = await import("../../../../stores/lighting-rig-store.js");
const fixtures = await import("./planner-truth-fixtures.js");

function metricValue(label: string): string {
  const labelEl = screen.getByText(label);
  return labelEl.nextElementSibling?.textContent ?? "";
}

function panelText(): string {
  return screen.getByTestId("rigging-lens-panel").textContent ?? "";
}

beforeEach(() => {
  venue.status = "trades-hall";
  useLightingRigStore.getState().reset();
  fixtures.resetPlannerTruth();
  fixtures.openRoom(fixtures.plannerRoom());
});
afterEach(() => { cleanup(); useLightingRigStore.getState().reset(); fixtures.resetPlannerTruth(); });

describe("RiggingLensPanel — the point is a building fact, not a default", () => {
  it("opens with no load, no WLL and no verdict: the point is not recorded", () => {
    render(<RiggingLensPanel />);
    expect(screen.getByText("Rigging & WLL")).toBeTruthy();
    expect(screen.getByTestId<HTMLInputElement>("rig-load").value).toBe("");
    expect(screen.getByTestId<HTMLInputElement>("rig-wll").value).toBe("");
    expect(screen.getByTestId("rig-point-unrecorded-status").textContent).toBe("Not recorded");
    expect(screen.getByTestId("rig-empty")).toBeTruthy();
    expect(screen.queryByTestId("rig-status")).toBeNull();
    expect(panelText()).not.toMatch(/\bwithin\b/i);
    expect(panelText()).not.toContain("500");
  });

  it("asks the events team on behalf of a visitor, with the question written", () => {
    render(<RiggingLensPanel />);
    const ask = screen.getByTestId("rig-point-unrecorded-ask");
    expect(ask.textContent).toBe("Ask the events team");
    const href = decodeURIComponent(ask.getAttribute("href") ?? "");
    expect(href).toMatch(/^mailto:info@tradeshallglasgow\.co\.uk\?/);
    expect(href).toContain("working load limit of the rigging point we would use in the Grand Hall");
  });

  it("names the hallkeeper for venue staff", () => {
    fixtures.viewAsStaff();
    render(<RiggingLensPanel />);
    const ask = screen.getByTestId("rig-point-unrecorded-ask");
    expect(ask.textContent).toBe("Ask the hallkeeper");
    expect(ask.getAttribute("href")).toMatch(/^mailto:\?subject=/);
  });

  it("works out leg tension from the load alone and passes no judgement on it", () => {
    render(<RiggingLensPanel />);
    fireEvent.change(screen.getByTestId("rig-load"), { target: { value: "200" } });
    expect(metricValue("Leg tension")).toBe("200 kg");
    expect(screen.queryByTestId("rig-status")).toBeNull();
    expect(screen.queryByText("Share of the WLL entered")).toBeNull();
    expect(panelText()).not.toMatch(/\bwithin\b/i);
  });

  it("states the arithmetic against an entered WLL as entered, never as within it", () => {
    render(<RiggingLensPanel />);
    fireEvent.change(screen.getByTestId("rig-load"), { target: { value: "200" } });
    fireEvent.change(screen.getByTestId("rig-wll"), { target: { value: "500" } });
    expect(metricValue("Share of the WLL entered")).toBe("40% of 500 kg");
    expect(metricValue("WLL entered less leg tension")).toBe("300 kg");
    expect(screen.getByTestId("rig-entered-note").textContent).toBe("Entered here in this plan; not a check of the point.");
    expect(screen.queryByTestId("rig-status")).toBeNull();
    expect(panelText()).not.toMatch(/\bwithin\b/i);
  });

  it("flags a load over the WLL entered and offers the person to ask", () => {
    render(<RiggingLensPanel />);
    fireEvent.change(screen.getByTestId("rig-wll"), { target: { value: "500" } });
    fireEvent.change(screen.getByTestId("rig-load"), { target: { value: "600" } });
    expect(screen.getByTestId("rig-status").textContent).toBe("Over the WLL entered");
    expect(screen.getAllByTestId("rig-warning").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId("rig-over-ask").textContent).toBe("Ask the events team");
  });

  it("returns to not recorded when the WLL is cleared", () => {
    render(<RiggingLensPanel />);
    fireEvent.change(screen.getByTestId("rig-wll"), { target: { value: "500" } });
    fireEvent.change(screen.getByTestId("rig-wll"), { target: { value: "" } });
    expect(screen.getByTestId("rig-point-unrecorded")).toBeTruthy();
  });
});

describe("RiggingLensPanel — warnings that stand on what was entered", () => {
  it("warns on a shallow two-leg bridle angle", () => {
    render(<RiggingLensPanel />);
    fireEvent.click(screen.getByTestId("rig-2leg"));
    fireEvent.change(screen.getByTestId("rig-angle"), { target: { value: "20" } });
    expect(screen.getAllByTestId("rig-warning").some((el) => /Shallow bridle angle/.test(el.textContent ?? ""))).toBe(true);
  });

  it("forbids a hoist on a point entered as static-only", () => {
    render(<RiggingLensPanel />);
    fireEvent.change(screen.getByTestId("rig-permitted"), { target: { value: "static-only" } });
    fireEvent.change(screen.getByTestId("rig-loadkind"), { target: { value: "power-hoist" } });
    expect(screen.getAllByTestId("rig-warning").some((el) => /static-only point must NOT anchor a hoist/.test(el.textContent ?? ""))).toBe(true);
  });

  it("raises no rating warning for a point nobody rated", () => {
    render(<RiggingLensPanel />);
    fireEvent.change(screen.getByTestId("rig-loadkind"), { target: { value: "power-hoist" } });
    expect(screen.queryByTestId("rig-warning")).toBeNull();
  });

  it("offers the imported rig weight as the suspended load", () => {
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
