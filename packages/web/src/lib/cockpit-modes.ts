// Canonical lens / overlay / layer vocabulary for the planner cockpit.
// Kept free of React + icon imports so it is unit-testable and importable
// by the store. Icon mapping lives in the nav-rail component.

export const COCKPIT_MODES = [
  { id: "design", label: "Design" },
  { id: "guests", label: "Guests" },
  { id: "flow", label: "Flow" },
  { id: "evidence", label: "Evidence" },
  { id: "lighting", label: "Lighting" },
  { id: "power", label: "Power" },
  { id: "ops", label: "Ops" },
  { id: "costs", label: "Costs" },
  { id: "share", label: "Share" },
] as const;

export type CockpitMode = (typeof COCKPIT_MODES)[number]["id"];

export const COCKPIT_OVERLAY_KEYS = [
  "guestFlow",
  "routeClearance",
  "heritageBuffer",
  "densityHeatmap",
  "lightingProbes",
  "agentReplay",
] as const;

export type CockpitOverlayKey = (typeof COCKPIT_OVERLAY_KEYS)[number];

export const COCKPIT_LAYER_MODES = ["mesh", "splat", "hybrid"] as const;
export type CockpitLayerMode = (typeof COCKPIT_LAYER_MODES)[number];

export function isCockpitMode(value: string): value is CockpitMode {
  return COCKPIT_MODES.some((mode) => mode.id === value);
}
