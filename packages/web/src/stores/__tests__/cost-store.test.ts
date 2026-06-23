import { afterEach, describe, expect, it } from "vitest";
import { useCostStore, DEFAULT_COST_RATES } from "../cost-store.js";

afterEach(() => { useCostStore.getState().reset(); });

describe("cost-store", () => {
  it("defaults to the example planning rates", () => {
    const s = useCostStore.getState();
    expect(s.roomHireMinor).toBe(DEFAULT_COST_RATES.roomHireMinor);
    expect(s.cateringPerCoverMinor).toBe(DEFAULT_COST_RATES.cateringPerCoverMinor);
    expect(s.furniturePerTableMinor).toBe(DEFAULT_COST_RATES.furniturePerTableMinor);
    expect(s.avPerItemMinor).toBe(DEFAULT_COST_RATES.avPerItemMinor);
    expect(s.lightingPerFixtureMinor).toBe(DEFAULT_COST_RATES.lightingPerFixtureMinor);
    expect(s.marginPercent).toBe(0);
  });

  it("setters update rates and never go negative", () => {
    useCostStore.getState().setRoomHireMinor(100000);
    expect(useCostStore.getState().roomHireMinor).toBe(100000);
    useCostStore.getState().setRoomHireMinor(-50);
    expect(useCostStore.getState().roomHireMinor).toBe(0);
    useCostStore.getState().setLightingPerFixtureMinor(5000);
    expect(useCostStore.getState().lightingPerFixtureMinor).toBe(5000);
  });

  it("clamps margin to 0..100", () => {
    useCostStore.getState().setMarginPercent(150);
    expect(useCostStore.getState().marginPercent).toBe(100);
    useCostStore.getState().setMarginPercent(-10);
    expect(useCostStore.getState().marginPercent).toBe(0);
    useCostStore.getState().setMarginPercent(15);
    expect(useCostStore.getState().marginPercent).toBe(15);
  });

  it("reset restores the defaults", () => {
    useCostStore.getState().setRoomHireMinor(123456);
    useCostStore.getState().setMarginPercent(20);
    useCostStore.getState().reset();
    expect(useCostStore.getState().roomHireMinor).toBe(DEFAULT_COST_RATES.roomHireMinor);
    expect(useCostStore.getState().marginPercent).toBe(0);
  });
});
