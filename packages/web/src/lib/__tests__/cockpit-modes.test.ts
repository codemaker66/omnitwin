import { describe, expect, it } from "vitest";
import {
  COCKPIT_MODES,
  COCKPIT_OVERLAY_KEYS,
  COCKPIT_LAYER_MODES,
  isCockpitMode,
} from "../cockpit-modes.js";

describe("cockpit-modes", () => {
  it("exposes the eleven lenses in nav order with labels", () => {
    expect(COCKPIT_MODES.map((m) => m.id)).toEqual([
      "design", "guests", "flow", "evidence", "lighting", "power", "rigging", "av", "ops", "costs", "share",
    ]);
    expect(COCKPIT_MODES.every((m) => m.label.length > 0)).toBe(true);
  });

  it("exposes overlay keys and layer modes", () => {
    expect(COCKPIT_OVERLAY_KEYS).toContain("guestFlow");
    expect(COCKPIT_OVERLAY_KEYS).toContain("densityHeatmap");
    expect(COCKPIT_LAYER_MODES).toEqual(["mesh", "splat", "hybrid"]);
  });

  it("narrows arbitrary strings with isCockpitMode", () => {
    expect(isCockpitMode("flow")).toBe(true);
    expect(isCockpitMode("nope")).toBe(false);
  });
});
