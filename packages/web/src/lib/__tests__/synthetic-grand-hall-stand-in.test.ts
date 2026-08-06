import { describe, expect, it } from "vitest";
import { CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE } from "@omnitwin/types";
import {
  SYNTHETIC_GRAND_HALL_STAND_IN_LABEL,
  isGrandHallVenueRuntime,
  shouldUseSyntheticGrandHallStandIn,
} from "../synthetic-grand-hall-stand-in.js";

const GRAND_HALL_RUNTIME = CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.venueRuntime;
const SALOON_RUNTIME = {
  ...GRAND_HALL_RUNTIME,
  spaceSlug: "saloon",
  spaceName: "Saloon",
};

describe("synthetic Grand Hall stand-in", () => {
  it("identifies Grand Hall from frozen runtime identity only", () => {
    expect(isGrandHallVenueRuntime(GRAND_HALL_RUNTIME)).toBe(true);
    expect(isGrandHallVenueRuntime({
      ...GRAND_HALL_RUNTIME,
      spaceSlug: "historic-main-room",
      spaceName: "Grand Hall",
    })).toBe(true);
    expect(isGrandHallVenueRuntime(SALOON_RUNTIME)).toBe(false);
    expect(isGrandHallVenueRuntime(null)).toBe(false);
  });

  it("decorates only trustworthy frozen Grand Hall frames without an exact capture", () => {
    expect(shouldUseSyntheticGrandHallStandIn({
      mode: "keyframe",
      venueRuntime: GRAND_HALL_RUNTIME,
      hasExactHistoricalRuntime: false,
    })).toBe(true);
    expect(shouldUseSyntheticGrandHallStandIn({
      mode: "transition",
      venueRuntime: GRAND_HALL_RUNTIME,
      hasExactHistoricalRuntime: false,
    })).toBe(true);

    for (const mode of ["inactive", "unavailable", "schedule-gap"] as const) {
      expect(shouldUseSyntheticGrandHallStandIn({
        mode,
        venueRuntime: GRAND_HALL_RUNTIME,
        hasExactHistoricalRuntime: false,
      })).toBe(false);
    }
    expect(shouldUseSyntheticGrandHallStandIn({
      mode: "keyframe",
      venueRuntime: SALOON_RUNTIME,
      hasExactHistoricalRuntime: false,
    })).toBe(false);
    expect(shouldUseSyntheticGrandHallStandIn({
      mode: "keyframe",
      venueRuntime: GRAND_HALL_RUNTIME,
      hasExactHistoricalRuntime: true,
    })).toBe(false);
  });

  it("names the visual as synthetic and explicitly non-measured", () => {
    expect(SYNTHETIC_GRAND_HALL_STAND_IN_LABEL).toContain("Synthetic");
    expect(SYNTHETIC_GRAND_HALL_STAND_IN_LABEL).toContain("not a measured capture");
  });
});
