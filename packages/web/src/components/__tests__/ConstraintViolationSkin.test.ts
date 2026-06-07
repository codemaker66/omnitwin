import { describe, expect, it } from "vitest";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { buildViolationCrossMarks } from "../../lib/constraint-violation-skin.js";

describe("buildViolationCrossMarks", () => {
  it("spreads holographic warning marks across a furniture footprint", () => {
    const table = getCatalogueItemBySlug("round-table-6ft");
    expect(table).toBeDefined();
    if (table === undefined) throw new Error("round-table-6ft catalogue item missing");

    const marks = buildViolationCrossMarks(table);

    expect(marks.length).toBeGreaterThan(4);
    expect(marks.length).toBeLessThanOrEqual(18);
    expect(new Set(marks.map((mark) => mark.x.toFixed(2))).size).toBeGreaterThan(1);
    expect(new Set(marks.map((mark) => mark.z.toFixed(2))).size).toBeGreaterThan(1);
  });

  it("caps dense warning skins so invalid layouts stay cheap to render", () => {
    const platform = getCatalogueItemBySlug("platform");
    expect(platform).toBeDefined();
    if (platform === undefined) throw new Error("platform catalogue item missing");

    const marks = buildViolationCrossMarks(platform, 5);

    expect(marks).toHaveLength(5);
  });
});
