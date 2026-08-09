import { describe, expect, it } from "vitest";
import {
  SYNTHETIC_GRAND_HALL_STAND_IN_LABEL,
} from "../synthetic-grand-hall-stand-in.js";

describe("synthetic Grand Hall stand-in", () => {
  it("names the visual-review stand-in as synthetic and explicitly non-measured", () => {
    expect(SYNTHETIC_GRAND_HALL_STAND_IN_LABEL).toContain("Synthetic");
    expect(SYNTHETIC_GRAND_HALL_STAND_IN_LABEL).toContain("not a measured capture");
  });
});
