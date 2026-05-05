import { describe, expect, it } from "vitest";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
import {
  computeCylinderSegmentTransform,
  computeFoldingRoundTableVisualSpec,
  FOLDING_ROUND_TABLE_COLORS,
} from "../meshes/RoundTableMesh.js";

function roundTable() {
  const item = getCatalogueItemBySlug("round-table-6ft");
  if (item === undefined) {
    throw new Error("6ft round table catalogue item missing");
  }
  return item;
}

describe("RoundTableMesh visual spec", () => {
  it("renders as a folding table with four perimeter legs instead of a central pedestal", () => {
    const spec = computeFoldingRoundTableVisualSpec(roundTable());

    expect(spec.legSegments).toHaveLength(4);
    expect(spec.braceSegments).toHaveLength(4);
    expect(spec.frameRingRadius).toBeGreaterThan(spec.radius * 0.6);

    for (const segment of spec.legSegments) {
      const topRadius = Math.hypot(segment.start[0], segment.start[2]);
      const footRadius = Math.hypot(segment.end[0], segment.end[2]);

      expect(topRadius).toBeGreaterThan(spec.radius * 0.6);
      expect(footRadius).toBeGreaterThan(topRadius);
      expect(footRadius).toBeLessThan(spec.radius);
    }
  });

  it("uses a white plastic top, grey rim, dark metal frame, and black rubber feet", () => {
    const spec = computeFoldingRoundTableVisualSpec(roundTable());

    expect(spec.topColor).toBe(FOLDING_ROUND_TABLE_COLORS.top);
    expect(spec.topHighlightColor).toBe(FOLDING_ROUND_TABLE_COLORS.topHighlight);
    expect(spec.rimColor).toBe(FOLDING_ROUND_TABLE_COLORS.rim);
    expect(spec.frameColor).toBe(FOLDING_ROUND_TABLE_COLORS.frame);
    expect(spec.rubberFootColor).toBe(FOLDING_ROUND_TABLE_COLORS.rubberFoot);
  });

  it("still lets placement ghosts override the full table colour", () => {
    const override = "#33cc66";
    const spec = computeFoldingRoundTableVisualSpec(roundTable(), override);

    expect(spec.topColor).toBe(override);
    expect(spec.topHighlightColor).toBe(override);
    expect(spec.rimColor).toBe(override);
    expect(spec.undersideColor).toBe(override);
    expect(spec.frameColor).toBe(override);
    expect(spec.rubberFootColor).toBe(override);
  });

  it("computes stable cylinder transforms for angled folding legs", () => {
    const spec = computeFoldingRoundTableVisualSpec(roundTable());
    const segment = spec.legSegments[0];
    if (segment === undefined) {
      throw new Error("Expected at least one leg segment");
    }
    const transform = computeCylinderSegmentTransform(segment);

    expect(transform.length).toBeGreaterThan(roundTable().height * 0.85);
    expect(transform.position[1]).toBeGreaterThan(spec.footHeight);
    expect(transform.position[1]).toBeLessThan(spec.height);
    expect(transform.quaternion.length()).toBeCloseTo(1);
  });
});
