import { create } from "zustand";

// ---------------------------------------------------------------------------
// cost-store — the planner's editable rates for the Costs lens scenario.
//
// Money is integer minor units (pence). The defaults are generic EXAMPLE
// planning rates, not Trades Hall's prices — the panel says so and every rate
// is editable. The Costs lens multiplies these by layout-derived quantities to
// produce a scenario estimate (never a quote).
// ---------------------------------------------------------------------------

export const DEFAULT_COST_RATES = {
  roomHireMinor: 75000, // £750.00
  cateringPerCoverMinor: 4500, // £45.00 / cover
  furniturePerTableMinor: 800, // £8.00 / table
  avPerItemMinor: 15000, // £150.00 / item
  lightingPerFixtureMinor: 3500, // £35.00 / fixture
  marginPercent: 0,
} as const;

interface CostRatesState {
  readonly roomHireMinor: number;
  readonly cateringPerCoverMinor: number;
  readonly furniturePerTableMinor: number;
  readonly avPerItemMinor: number;
  readonly lightingPerFixtureMinor: number;
  readonly marginPercent: number;
  readonly setRoomHireMinor: (minor: number) => void;
  readonly setCateringPerCoverMinor: (minor: number) => void;
  readonly setFurniturePerTableMinor: (minor: number) => void;
  readonly setAvPerItemMinor: (minor: number) => void;
  readonly setLightingPerFixtureMinor: (minor: number) => void;
  readonly setMarginPercent: (percent: number) => void;
  readonly reset: () => void;
}

export const useCostStore = create<CostRatesState>((set) => ({
  ...DEFAULT_COST_RATES,
  setRoomHireMinor: (minor) => { set({ roomHireMinor: Math.max(0, Math.round(minor)) }); },
  setCateringPerCoverMinor: (minor) => { set({ cateringPerCoverMinor: Math.max(0, Math.round(minor)) }); },
  setFurniturePerTableMinor: (minor) => { set({ furniturePerTableMinor: Math.max(0, Math.round(minor)) }); },
  setAvPerItemMinor: (minor) => { set({ avPerItemMinor: Math.max(0, Math.round(minor)) }); },
  setLightingPerFixtureMinor: (minor) => { set({ lightingPerFixtureMinor: Math.max(0, Math.round(minor)) }); },
  setMarginPercent: (percent) => { set({ marginPercent: Math.max(0, Math.min(100, Math.round(percent))) }); },
  reset: () => { set({ ...DEFAULT_COST_RATES }); },
}));
