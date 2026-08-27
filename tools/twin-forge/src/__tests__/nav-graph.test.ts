import { describe, expect, it } from "vitest";
import type { TwinScanNode } from "@omnitwin/types";
import {
  assertNavGraphConnected,
  buildNavGraph,
  floorOf,
  navGraphComponents,
  suggestNavBridges,
} from "../nav-graph.js";

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
    const edges = buildNavGraph([node("scan_000", 0, 0, 1.5), node("scan_001", 1, 0, -2.13)], { k: 2, maxDistanceM: 8 });
    expect(edges).toEqual([]);
  });

  it("only connects different floors through an explicit authored add override", () => {
    const nodes = [node("scan_000", 0, 0, 1.5), node("scan_001", 1, 0, -2.13)];

    expect(buildNavGraph(nodes, { k: 2, maxDistanceM: 8 })).toEqual([]);
    expect(
      buildNavGraph(nodes, {
        k: 2,
        maxDistanceM: 8,
        overrides: { add: [["scan_000", "scan_001"]] },
      }),
    ).toEqual([{ a: "scan_000", b: "scan_001", distanceM: 3.765 }]);
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

  it("rejects unknown, self-referential, and contradictory authored overrides", () => {
    const nodes = [node("scan_000", 0, 0), node("scan_001", 2, 0)];
    expect(() =>
      buildNavGraph(nodes, { overrides: { remove: [["scan_000", "scan_999"]] } }),
    ).toThrow("unknown node");
    expect(() =>
      buildNavGraph(nodes, { overrides: { add: [["scan_000", "scan_000"]] } }),
    ).toThrow("itself");
    expect(() =>
      buildNavGraph(nodes, {
        overrides: {
          add: [["scan_000", "scan_001"]],
          remove: [["scan_001", "scan_000"]],
        },
      }),
    ).toThrow("both add and remove");
  });
});

// -----------------------------------------------------------------------------
// CONNECTIVITY — the invariant that a walkthrough must be walkable.
//
// buildNavGraph is same-floor by construction and says so; stairwells are the
// authored overrides' job. Nothing ever checked that the job was DONE, and on
// the shipped Trades Hall bundle it was not: 149 viewpoints in two islands of
// 84 and 65, so no visitor could walk between the storeys at all. These tests
// pin the instrument that makes that condition impossible to ship silently.
// -----------------------------------------------------------------------------

describe("navGraphComponents", () => {
  it("returns one component for a connected graph", () => {
    const nodes = [node("scan_000", 0, 0), node("scan_001", 2, 0), node("scan_002", 4, 0)];
    const edges = buildNavGraph(nodes, { k: 2, maxDistanceM: 8 });
    expect(navGraphComponents(nodes, edges)).toEqual([
      ["scan_000", "scan_001", "scan_002"],
    ]);
  });

  it("finds the storey islands the shipped bundle actually had, largest first", () => {
    const nodes = [
      node("scan_000", 0, 0, 1.5),
      node("scan_001", 2, 0, 1.5),
      node("scan_002", 4, 0, 1.5),
      node("scan_100", 0, 0, -2),
      node("scan_101", 2, 0, -2),
    ];
    const edges = buildNavGraph(nodes, { k: 2, maxDistanceM: 8 });
    const components = navGraphComponents(nodes, edges);
    expect(components).toHaveLength(2);
    expect(components[0]).toEqual(["scan_000", "scan_001", "scan_002"]);
    expect(components[1]).toEqual(["scan_100", "scan_101"]);
  });

  it("counts an isolated node as its own component", () => {
    const nodes = [node("scan_000", 0, 0), node("scan_001", 2, 0), node("scan_009", 400, 0)];
    const edges = buildNavGraph(nodes, { k: 2, maxDistanceM: 8 });
    expect(navGraphComponents(nodes, edges)).toEqual([
      ["scan_000", "scan_001"],
      ["scan_009"],
    ]);
  });
});

describe("suggestNavBridges", () => {
  it("names the shortest real pair joining two islands, so the operator knows what to author", () => {
    const nodes = [
      node("scan_000", 0, 0, 1.5),
      node("scan_001", 2, 0, 1.5),
      // A stair foot 3 m below and 4 m along — the Trades Hall shape.
      node("scan_100", 6, 0, -1.5),
      node("scan_101", 8, 0, -1.5),
    ];
    const edges = buildNavGraph(nodes, { k: 2, maxDistanceM: 8 });
    const bridges = suggestNavBridges(nodes, navGraphComponents(nodes, edges));
    expect(bridges).toHaveLength(1);
    const [bridge] = bridges;
    expect(bridge?.a).toBe("scan_001");
    expect(bridge?.b).toBe("scan_100");
    expect(bridge?.distanceM).toBeCloseTo(5, 3);
  });

  it("says nothing when the graph is already whole", () => {
    const nodes = [node("scan_000", 0, 0), node("scan_001", 2, 0)];
    const edges = buildNavGraph(nodes, { k: 2, maxDistanceM: 8 });
    expect(suggestNavBridges(nodes, navGraphComponents(nodes, edges))).toEqual([]);
  });

  // The trap this rule exists to avoid, found by running the suggester against
  // the real Trades Hall bundle: its nearest cross-storey pair was scan_057 to
  // scan_119 — 2.97 m apart, but only 0.04 m of that horizontal. They are the
  // same plan position on two storeys, with a floor slab between them.
  // Authoring that override would have walked the visitor through the floor.
  it("refuses a stacked pair: near in 3D, but no horizontal run is a floor slab, not a stair", () => {
    const nodes = [
      node("scan_000", 0, 0, 1.5),
      node("scan_001", 2, 0, 1.5),
      // Directly beneath scan_001, one storey down — the slab case.
      node("scan_100", 2.03, 0, -1.5),
      node("scan_101", 4, 0, -1.5),
    ];
    const edges = buildNavGraph(nodes, { k: 2, maxDistanceM: 8 });
    const bridges = suggestNavBridges(nodes, navGraphComponents(nodes, edges));
    expect(bridges).toHaveLength(1);
    // Not the 3.0 m stacked pair — the longer pair that actually has a run.
    expect(bridges[0]?.a).not.toBe("scan_001");
    expect(bridges[0]?.b).not.toBe("scan_100");
  });

  it("prefers the stair-shaped pair even when a stacked pair is nearer", () => {
    const nodes = [
      node("scan_000", 0, 0, 1.5),
      node("scan_001", 2, 0, 1.5),
      // Stacked under scan_001 at 3.0 m; must lose to the stair below.
      node("scan_100", 2, 0, -1.5),
      // A stair foot: 3.5 m of run for 3 m of rise, 4.6 m away in 3D.
      node("scan_101", 5.5, 0, -1.5),
    ];
    const edges = buildNavGraph(nodes, { k: 2, maxDistanceM: 8 });
    const bridges = suggestNavBridges(nodes, navGraphComponents(nodes, edges));
    expect(bridges[0]?.a).toBe("scan_001");
    expect(bridges[0]?.b).toBe("scan_101");
  });

  it("still suggests a level pair — a corridor the capture stepped over is not a stair", () => {
    const nodes = [
      node("scan_000", 0, 0, 1.5),
      node("scan_001", 2, 0, 1.5),
      // Same storey, beyond KNN range: no rise at all, so no run is required.
      node("scan_002", 30, 0, 1.5),
      node("scan_003", 32, 0, 1.5),
    ];
    const edges = buildNavGraph(nodes, { k: 2, maxDistanceM: 8 });
    const bridges = suggestNavBridges(nodes, navGraphComponents(nodes, edges));
    expect(bridges).toHaveLength(1);
    expect(bridges[0]?.a).toBe("scan_001");
    expect(bridges[0]?.b).toBe("scan_002");
  });
});

describe("assertNavGraphConnected", () => {
  it("passes a whole graph in silence", () => {
    const nodes = [node("scan_000", 0, 0), node("scan_001", 2, 0)];
    expect(() => {
      assertNavGraphConnected(nodes, buildNavGraph(nodes, { k: 2, maxDistanceM: 8 }));
    }).not.toThrow();
  });

  it("refuses a split graph, naming the islands AND the override that would join them", () => {
    const nodes = [
      node("scan_000", 0, 0, 1.5),
      node("scan_001", 2, 0, 1.5),
      node("scan_100", 6, 0, -1.5),
      node("scan_101", 8, 0, -1.5),
    ];
    const edges = buildNavGraph(nodes, { k: 2, maxDistanceM: 8 });
    let thrown: Error | null = null;
    try {
      assertNavGraphConnected(nodes, edges);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown).not.toBeNull();
    const message = thrown?.message ?? "";
    // The count, the sizes, and an actionable override — an error a capture
    // operator can act on without reading this file.
    expect(message).toContain("2 islands");
    expect(message).toContain("scan_001");
    expect(message).toContain("scan_100");
    expect(message).toContain("overrides");
  });

  it("an authored stairwell override is exactly what makes it pass", () => {
    const nodes = [
      node("scan_000", 0, 0, 1.5),
      node("scan_001", 2, 0, 1.5),
      node("scan_100", 6, 0, -1.5),
      node("scan_101", 8, 0, -1.5),
    ];
    const bridged = buildNavGraph(nodes, {
      k: 2,
      maxDistanceM: 8,
      overrides: { add: [["scan_001", "scan_100"]] },
    });
    expect(() => {
      assertNavGraphConnected(nodes, bridged);
    }).not.toThrow();
    expect(navGraphComponents(nodes, bridged)).toHaveLength(1);
  });

  it("accepts an empty capture rather than inventing a failure", () => {
    expect(() => {
      assertNavGraphConnected([], []);
    }).not.toThrow();
  });
});

describe("floorOf", () => {
  it("buckets tripod heights into floors (~3.5m storeys, tripod ≈1.5m)", () => {
    expect(floorOf(1.5)).toBe(0);
    expect(floorOf(6.4)).toBe(1);
    expect(floorOf(10.2)).toBe(2);
    expect(floorOf(-1.5)).toBe(-1);
    expect(floorOf(-2.13)).toBe(-1);
    expect(Object.is(floorOf(0), -0)).toBe(false);
  });

  it("rejects non-finite capture heights", () => {
    expect(() => floorOf(Number.NaN)).toThrow("finite");
    expect(() => floorOf(Number.POSITIVE_INFINITY)).toThrow("finite");
  });
});
