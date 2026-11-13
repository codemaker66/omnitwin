import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TradesHallVenueStatus } from "../../../../hooks/use-trades-hall-venue.js";

const venue = vi.hoisted(() => ({ status: "trades-hall" as TradesHallVenueStatus }));
vi.mock("../../../../hooks/use-trades-hall-venue.js", () => ({
  useTradesHallVenueStatus: () => venue.status,
  useTradesHallVenue: () => venue.status === "trades-hall",
}));

const { PowerLensPanel } = await import("../PowerLensPanel.js");
const { useLightingRigStore } = await import("../../../../stores/lighting-rig-store.js");
const fixtures = await import("./planner-truth-fixtures.js");

function metricValue(label: string): string {
  const labelEl = screen.getByText(label);
  return labelEl.nextElementSibling?.textContent ?? "";
}

/** A rig a person built in the Lighting lens: 12 pars, 4 washes, 2 profiles. */
function addRig(): void {
  const rig = useLightingRigStore.getState();
  rig.setCount("par", 12);
  rig.setCount("wash", 4);
  rig.setCount("profile", 2);
}

beforeEach(() => {
  venue.status = "trades-hall";
  useLightingRigStore.getState().reset();
  fixtures.resetPlannerTruth();
  fixtures.openRoom(fixtures.plannerRoom());
});
afterEach(() => { cleanup(); useLightingRigStore.getState().reset(); fixtures.resetPlannerTruth(); });

describe("PowerLensPanel — no load nobody added, no supply nobody recorded", () => {
  it("opens on an empty rig: no load and nothing to distribute", () => {
    render(<PowerLensPanel />);
    expect(screen.getByText("Power & distro")).toBeTruthy();
    expect(metricValue("Total load")).toBe("0 W");
    expect(screen.getByTestId("power-empty")).toBeTruthy();
  });

  it("shows the venue supply as not recorded, with the person to ask", () => {
    render(<PowerLensPanel />);
    expect(screen.getByTestId("power-supply-unrecorded-status").textContent).toBe("Not recorded");
    expect(screen.getByTestId<HTMLInputElement>("power-breaker").value).toBe("");
    expect(screen.getByTestId("power-supply-unrecorded-ask").textContent).toBe("Ask the events team");
  });

  it("names the hallkeeper for venue staff", () => {
    fixtures.viewAsStaff();
    render(<PowerLensPanel />);
    expect(screen.getByTestId("power-supply-unrecorded-ask").textContent).toBe("Ask the hallkeeper");
  });

  it("raises no breaker warning and draws no meter against a supply nobody recorded", () => {
    addRig();
    render(<PowerLensPanel />);
    expect(screen.queryByTestId("power-warning")).toBeNull();
    expect(screen.getByTestId("power-phase-L1").querySelector(".lens-panel__meter")).toBeNull();
    expect(screen.getByTestId("power-lens-panel").textContent).not.toMatch(/\b(within|pass|fits|valid|compliant)\b/i);
  });

  it("says an entered breaker was entered here, and warns only when a phase is over it", () => {
    addRig();
    render(<PowerLensPanel />);
    fireEvent.change(screen.getByTestId("power-breaker"), { target: { value: "32" } });
    expect(screen.getByTestId("power-breaker-entered").textContent).toBe("Entered here in this plan; not a check of the supply.");
    expect(screen.queryByTestId("power-supply-unrecorded")).toBeNull();
    expect(screen.queryByTestId("power-warning")).toBeNull();
    fireEvent.change(screen.getByTestId("power-breaker"), { target: { value: "5" } });
    expect(screen.getAllByTestId("power-warning").some((el) => /exceeds the 5 A breaker/.test(el.textContent ?? ""))).toBe(true);
  });

  it("returns to not recorded when the breaker is cleared", () => {
    render(<PowerLensPanel />);
    fireEvent.change(screen.getByTestId("power-breaker"), { target: { value: "32" } });
    fireEvent.change(screen.getByTestId("power-breaker"), { target: { value: "" } });
    expect(screen.getByTestId("power-supply-unrecorded")).toBeTruthy();
  });
});

describe("PowerLensPanel — distribution of a rig someone built", () => {
  it("distributes the rig across three balanced phases", () => {
    addRig();
    render(<PowerLensPanel />);
    // 5,800 W over 3 phases → ~1,950/1,925/1,925 W, ~9.4 A each.
    expect(metricValue("Total load")).toBe("5,800 W");
    expect(screen.getByTestId("power-phase-L1").textContent).toMatch(/9\.4 A/);
    expect(screen.getByTestId("power-phase-L3")).toBeTruthy();
    expect(metricValue("Phase imbalance")).toBe("1%");
    expect(metricValue("Feeder for this load")).toBe("16 A 3-phase");
    // Each balanced phase fits a single 16 A way → 3 distro ways.
    expect(metricValue("Distro ways")).toBe("3 × 16 A ways");
    expect(screen.getByTestId("power-circuits-L1")).toBeTruthy();
  });

  it("splits a phase onto more ways when the circuit rating drops", () => {
    addRig();
    render(<PowerLensPanel />);
    // A 6 A way (~1,242 W) can't hold a whole ~1,950 W phase → multiple ways.
    fireEvent.change(screen.getByTestId("power-circuit"), { target: { value: "6" } });
    expect(metricValue("Distro ways")).toMatch(/ × 6 A ways$/);
    expect(screen.getByTestId("power-circuits-L1").childElementCount).toBeGreaterThan(1);
  });

  it("collapses onto one phase in single-phase mode", () => {
    addRig();
    render(<PowerLensPanel />);
    fireEvent.click(screen.getByTestId("power-1ph"));
    expect(screen.getByTestId("power-phase-L1").textContent).toMatch(/28\.0 A/); // 5800 / 207
    expect(screen.queryByTestId("power-phase-L2")).toBeNull();
    expect(metricValue("Phase imbalance")).toBe("0%");
  });
});
