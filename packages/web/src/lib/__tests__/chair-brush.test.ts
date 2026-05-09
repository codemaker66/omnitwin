import { describe, expect, it } from "vitest";
import { getCatalogueItemBySlug } from "../catalogue.js";
import { computeChairBrushSummary, CHAIR_BRUSH_MAX_ITEMS } from "../chair-brush.js";
import { toRenderSpace } from "../../constants/scale.js";

const chair = getCatalogueItemBySlug("banquet-chair");

describe("computeChairBrushSummary", () => {
  it("turns a mostly straight drag into a row of chairs", () => {
    expect(chair).toBeDefined();
    if (chair === undefined) throw new Error("Missing banquet chair");

    const summary = computeChairBrushSummary(chair, 0, 0, toRenderSpace(4.5), toRenderSpace(0.1), 0);

    expect(summary.mode).toBe("row");
    expect(summary.rows).toBe(1);
    expect(summary.columns).toBeGreaterThan(4);
    expect(summary.points[0]).toMatchObject({ x: 0, z: 0, rotationY: 0 });
    expect(summary.points.at(-1)?.x).toBeGreaterThan(summary.points[0]?.x ?? 0);
  });

  it("turns a diagonal area drag into a block of chairs", () => {
    expect(chair).toBeDefined();
    if (chair === undefined) throw new Error("Missing banquet chair");

    const summary = computeChairBrushSummary(chair, 0, 0, toRenderSpace(3.5), toRenderSpace(3.2), 0);

    expect(summary.mode).toBe("block");
    expect(summary.columns).toBeGreaterThan(2);
    expect(summary.rows).toBeGreaterThan(2);
    expect(summary.points.length).toBe(summary.columns * summary.rows);
  });

  it("inherits rotation so rows can be laid out on a rotated axis", () => {
    expect(chair).toBeDefined();
    if (chair === undefined) throw new Error("Missing banquet chair");

    const summary = computeChairBrushSummary(chair, 0, 0, 0, toRenderSpace(4), Math.PI / 2);

    expect(summary.mode).toBe("row");
    expect(summary.points).toHaveLength(summary.columns);
    expect(summary.points.every((point) => point.rotationY === Math.PI / 2)).toBe(true);
    expect(Math.abs(summary.points.at(-1)?.z ?? 0)).toBeGreaterThan(2);
  });

  it("caps very large chair fields", () => {
    expect(chair).toBeDefined();
    if (chair === undefined) throw new Error("Missing banquet chair");

    const summary = computeChairBrushSummary(chair, 0, 0, toRenderSpace(100), toRenderSpace(100), 0);

    expect(summary.points).toHaveLength(CHAIR_BRUSH_MAX_ITEMS);
  });
});
