import { describe, expect, it } from "vitest";
import { normalizeFurnitureScale } from "../furniture-scale.js";

describe("normalizeFurnitureScale", () => {
  it("preserves a finite positive persisted scale", () => {
    expect(normalizeFurnitureScale(0.5)).toBe(0.5);
    expect(normalizeFurnitureScale(2)).toBe(2);
  });

  it.each([undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "falls back to 1 for an invalid scale (%s)",
    (scale) => {
      expect(normalizeFurnitureScale(scale)).toBe(1);
    },
  );
});
