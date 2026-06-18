import { describe, it, expect } from "vitest";
import { BoxGeometry, Matrix4 } from "three";
import { mergePartsByMaterial, type ExtractedPart } from "../furniture-instancing.js";

function firstGroup<T>(arr: readonly T[]): T {
  const x = arr[0];
  if (x === undefined) throw new Error("expected at least one group");
  return x;
}

describe("mergePartsByMaterial", () => {
  it("merges same-material parts into one geometry, baking each part's transform", () => {
    const g1 = new BoxGeometry(1, 1, 1);
    const g2 = new BoxGeometry(1, 1, 1);
    const parts: ExtractedPart[] = [
      { geometry: g1, materialKey: "wood", matrix: new Matrix4().makeTranslation(-5, 0, 0) },
      { geometry: g2, materialKey: "wood", matrix: new Matrix4().makeTranslation(5, 0, 0) },
    ];

    const groups = mergePartsByMaterial(parts);

    expect(groups).toHaveLength(1);
    const group = firstGroup(groups);
    expect(group.materialKey).toBe("wood");
    group.geometry.computeBoundingBox();
    const bb = group.geometry.boundingBox;
    expect(bb).not.toBeNull();
    // The two unit cubes were baked to x = -5 and +5, so the merged span is [-5.5, 5.5].
    expect(bb?.min.x ?? 0).toBeCloseTo(-5.5);
    expect(bb?.max.x ?? 0).toBeCloseTo(5.5);
    const expectedVerts = (g1.attributes.position?.count ?? 0) + (g2.attributes.position?.count ?? 0);
    expect(group.geometry.attributes.position?.count).toBe(expectedVerts);
  });

  it("keeps distinct materials as separate groups in first-seen order", () => {
    const parts: ExtractedPart[] = [
      { geometry: new BoxGeometry(), materialKey: "metal", matrix: new Matrix4() },
      { geometry: new BoxGeometry(), materialKey: "fabric", matrix: new Matrix4() },
      { geometry: new BoxGeometry(), materialKey: "metal", matrix: new Matrix4() },
    ];

    const groups = mergePartsByMaterial(parts);

    expect(groups.map((g) => g.materialKey)).toEqual(["metal", "fabric"]);
  });

  it("does not mutate the input geometry (clones before baking the transform)", () => {
    const g = new BoxGeometry(2, 2, 2);
    const before = Array.from(g.attributes.position?.array ?? []);

    mergePartsByMaterial([
      { geometry: g, materialKey: "x", matrix: new Matrix4().makeTranslation(3, 0, 0) },
    ]);

    expect(Array.from(g.attributes.position?.array ?? [])).toEqual(before);
  });
});
