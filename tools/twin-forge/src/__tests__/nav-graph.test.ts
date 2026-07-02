import { describe, expect, it } from "vitest";
import type { TwinScanNode } from "@omnitwin/types";
import { buildNavGraph, floorOf } from "../nav-graph.js";

function node(id: string, x: number, y: number, z = 1.5): TwinScanNode {
  return { id, index: Number(id.slice(5)), pose: { q: [1, 0, 0, 0], t: [x, y, z] }, floor: floorOf(z), roomSlug: null };
}

describe("buildNavGraph", () => {
  it("connects k nearest neighbours within range, symmetrically deduped", () => {
    const nodes = [node("scan_000", 0, 0), node("scan_001", 2, 0), node("scan_002", 4, 0), node("scan_003", 40, 0)];
    const edges = buildNavGraph(nodes, { k: 2, maxDistanceM: 8 });
    const pairs = edges.map((e) => `${e.a}-${e.b}`).sort();
    expect(pairs).toEqual(["scan_000-scan_001", "scan_000-scan_002", "scan_001-scan_002"]);
    expect(edges.every((e) => e.distanceM <= 8)).toBe(true);
  });

  it("never connects across floors", () => {
    const edges = buildNavGraph([node("scan_000", 0, 0, 1.5), node("scan_001", 1, 0, 6.5)], { k: 2, maxDistanceM: 8 });
    expect(edges).toEqual([]);
  });

  it("applies add/remove overrides", () => {
    const nodes = [node("scan_000", 0, 0), node("scan_001", 2, 0), node("scan_002", 100, 0)];
    const edges = buildNavGraph(nodes, {
      k: 1, maxDistanceM: 8,
      overrides: { add: [["scan_000", "scan_002"]], remove: [["scan_000", "scan_001"]] },
    });
    const pairs = edges.map((e) => `${e.a}-${e.b}`);
    expect(pairs).toContain("scan_000-scan_002");
    expect(pairs).not.toContain("scan_000-scan_001");
  });
});

describe("floorOf", () => {
  it("buckets tripod heights into floors (~3.5m storeys, tripod ≈1.5m)", () => {
    expect(floorOf(1.5)).toBe(0);
    expect(floorOf(6.4)).toBe(1);
    expect(floorOf(10.2)).toBe(2);
  });
});
