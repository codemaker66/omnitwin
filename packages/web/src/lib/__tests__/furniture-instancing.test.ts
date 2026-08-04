import { BoxGeometry, BufferGeometry, ExtrudeGeometry, Matrix4, Shape } from "three";
import { describe, it, expect, vi } from "vitest";
import { mergePartsByMaterial, type ExtractedPart } from "../furniture-instancing.js";
import {
  INSTANCE_CAPACITY_STEP,
  instanceCapacityFor,
} from "../../components/editor/InstancedFurnitureLayer.js";

describe("instanceCapacityFor", () => {
  // drei allocates the instance matrix buffer once, at mount, from `limit`,
  // but recomputes the draw count from live props each frame. If capacity ever
  // drops below the live count the surplus matrices are silently discarded and
  // those items disappear from the scene while remaining selectable.
  it("never returns a capacity below the live item count", () => {
    for (let count = 1; count <= 200; count += 1) {
      expect(instanceCapacityFor(count), `count ${String(count)}`)
        .toBeGreaterThanOrEqual(count);
    }
  });

  it("holds one bucket steady so routine placement does not remount the pool", () => {
    // Placing chairs 1..32 must all resolve to the same capacity, otherwise
    // every single drop rebuilds the buffer.
    const capacities = new Set<number>();
    for (let count = 1; count <= INSTANCE_CAPACITY_STEP; count += 1) {
      capacities.add(instanceCapacityFor(count));
    }
    expect(capacities.size).toBe(1);
    expect(instanceCapacityFor(INSTANCE_CAPACITY_STEP + 1))
      .toBeGreaterThan(INSTANCE_CAPACITY_STEP);
  });

  it("grows monotonically and stays finite for degenerate counts", () => {
    expect(instanceCapacityFor(0)).toBe(INSTANCE_CAPACITY_STEP);
    expect(instanceCapacityFor(-5)).toBe(INSTANCE_CAPACITY_STEP);
    expect(instanceCapacityFor(Number.NaN)).toBe(INSTANCE_CAPACITY_STEP);
    let previous = 0;
    for (let count = 1; count <= 500; count += 1) {
      const capacity = instanceCapacityFor(count);
      expect(capacity).toBeGreaterThanOrEqual(previous);
      previous = capacity;
    }
  });
});

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

  it("keeps indexed and non-indexed geometry in compatible groups with one material", () => {
    const profile = new Shape();
    profile.moveTo(0, 0);
    profile.lineTo(1, 0);
    profile.lineTo(1, 1);
    profile.closePath();
    const nonIndexed = new ExtrudeGeometry(profile, {
      depth: 0.1,
      bevelEnabled: false,
      steps: 1,
    });
    expect(new BoxGeometry().index).not.toBeNull();
    expect(nonIndexed.index).toBeNull();

    const groups = mergePartsByMaterial([
      { geometry: new BoxGeometry(), materialKey: "brass", matrix: new Matrix4() },
      { geometry: nonIndexed, materialKey: "brass", matrix: new Matrix4() },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.materialKey)).toEqual(["brass", "brass"]);
    expect(groups.map((group) => group.geometry.index === null)).toEqual([false, true]);
  });

  it("disposes every owned clone when an incompatible merge falls back", () => {
    const first = new BoxGeometry();
    const incompatible = new BoxGeometry();
    incompatible.deleteAttribute("normal");
    const dispose = vi.spyOn(BufferGeometry.prototype, "dispose");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => mergePartsByMaterial([
      { geometry: first, materialKey: "shared", matrix: new Matrix4() },
      { geometry: incompatible, materialKey: "shared", matrix: new Matrix4() },
    ])).toThrow(/could not merge geometries/);

    expect(dispose).toHaveBeenCalledTimes(2);
    expect(dispose.mock.instances).not.toContain(first);
    expect(dispose.mock.instances).not.toContain(incompatible);
    dispose.mockRestore();
    consoleError.mockRestore();
  });
});
