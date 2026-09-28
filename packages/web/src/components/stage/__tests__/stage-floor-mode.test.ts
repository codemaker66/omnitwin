import { describe, expect, it } from "vitest";
import { floorColourModeFromSearch } from "../StageFloor.js";

describe("floor colour choice for Blake's review (T-639)", () => {
  it("shows the photographs as they are by default", () => {
    expect(floorColourModeFromSearch("", true)).toBe("photo");
  });

  it("offers the matched floor where splats may run", () => {
    expect(floorColourModeFromSearch("?floor=matched", true)).toBe("matched");
  });

  it("ignores the query where splats may not run", () => {
    expect(floorColourModeFromSearch("?floor=matched", false)).toBe("photo");
  });
});
