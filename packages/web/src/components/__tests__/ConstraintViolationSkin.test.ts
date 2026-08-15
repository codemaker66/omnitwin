import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { ConstraintViolationSkin } from "../ConstraintViolationSkin.js";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { buildViolationCrossMarks } from "../../lib/constraint-violation-skin.js";

afterEach(() => {
  cleanup();
});

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

  it("covers the same normalized scaled footprint as placement", () => {
    const table = getCatalogueItemBySlug("trestle-6ft");
    expect(table).toBeDefined();
    if (table === undefined) throw new Error("trestle-6ft catalogue item missing");

    const base = buildViolationCrossMarks(table);
    const scaled = buildViolationCrossMarks(table, 18, 2);
    const invalid = buildViolationCrossMarks(table, 18, 0);
    const maxAbsX = (marks: ReturnType<typeof buildViolationCrossMarks>): number =>
      Math.max(...marks.map((mark) => Math.abs(mark.x)));

    expect(maxAbsX(scaled)).toBeGreaterThan(maxAbsX(base));
    expect(invalid).toEqual(base);
  });
});

describe("ConstraintViolationSkin", () => {
  it("renders collision warnings without per-marker runtime lights", () => {
    const chair = getCatalogueItemBySlug("banquet-chair");
    expect(chair).toBeDefined();
    if (chair === undefined) throw new Error("banquet-chair catalogue item missing");

    const { container } = render(createElement(ConstraintViolationSkin, { item: chair, y: 0 }));

    expect(container.querySelector("pointlight")).toBeNull();
    expect(container.querySelectorAll("meshbasicmaterial").length).toBeGreaterThan(0);
  });
});
