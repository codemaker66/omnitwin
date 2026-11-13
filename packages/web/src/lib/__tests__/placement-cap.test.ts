import { describe, expect, it } from "vitest";
import { capReachedFor, capReachedLine } from "../placement-cap.js";
import { getCatalogueItemBySlug } from "../catalogue.js";

describe("placement cap line", () => {
  it("says how many the venue has, that they are placed, and what to do instead", () => {
    expect(capReachedLine(4)).toBe("The venue has 4 of these, and all 4 are placed; move one to use it elsewhere.");
    expect(capReachedLine(1)).toBe("The venue has one of these, and it is already placed; move it to use it elsewhere.");
    expect(capReachedLine(0)).toBe("The venue has none of these to place.");
  });

  it("is said for an item at its cap and not before", () => {
    const platform = getCatalogueItemBySlug("platform-narrow");
    if (platform === undefined || platform.maxCount === null) throw new Error("the narrow platform has a cap");
    expect(platform.maxCount).toBe(1);
    expect(capReachedFor(platform.id, [])).toBeNull();
    expect(capReachedFor(platform.id, [platform.id])).toBe(capReachedLine(1));
  });

  it("is never said for an item without a cap", () => {
    const chair = getCatalogueItemBySlug("burgess-turini-18-3");
    if (chair === undefined) throw new Error("no chair");
    expect(capReachedFor(chair.id, Array.from({ length: 500 }, () => chair.id))).toBeNull();
    expect(capReachedFor("not-a-catalogue-item", [])).toBeNull();
  });
});
