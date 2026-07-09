import { describe, expect, it } from "vitest";
import type { TwinNavEdge } from "@omnitwin/types";
import { MAX_USHER_HOPS, shortestRoute } from "../travel-route.js";

// -----------------------------------------------------------------------------
// travel-route — the Usher's pathfinding (SS++ phase 1), pure Dijkstra over
// the manifest's undirected, distance-weighted nav edges.
// -----------------------------------------------------------------------------

const edge = (a: string, b: string, distanceM: number): TwinNavEdge => ({
  a,
  b,
  distanceM,
});

/**
 * A small hall:  000 — 001 — 002 — 003   (corridor, 2 m steps)
 *                 \________ 004 ________/ (a 5 m + 5 m shortcut via one node)
 * 005 is an island (unreachable). The corridor 000→003 costs 6; the shortcut
 * costs 10 — Dijkstra must prefer the corridor even though it has more hops.
 */
const edges: readonly TwinNavEdge[] = [
  edge("scan_000", "scan_001", 2),
  edge("scan_001", "scan_002", 2),
  edge("scan_002", "scan_003", 2),
  edge("scan_000", "scan_004", 5),
  edge("scan_004", "scan_003", 5),
];

describe("shortestRoute", () => {
  it("walks the cheapest path, not the fewest hops", () => {
    expect(shortestRoute("scan_000", "scan_003", edges)).toEqual([
      "scan_001",
      "scan_002",
      "scan_003",
    ]);
  });

  it("takes the shortcut when it is genuinely cheaper", () => {
    const cheap = [...edges.slice(0, 3), edge("scan_000", "scan_004", 1), edge("scan_004", "scan_003", 1)];
    expect(shortestRoute("scan_000", "scan_003", cheap)).toEqual(["scan_004", "scan_003"]);
  });

  it("routes symmetrically over undirected edges", () => {
    expect(shortestRoute("scan_003", "scan_000", edges)).toEqual([
      "scan_002",
      "scan_001",
      "scan_000",
    ]);
  });

  it("returns [] when already standing on the target", () => {
    expect(shortestRoute("scan_001", "scan_001", edges)).toEqual([]);
  });

  it("returns null for unreachable or unknown nodes", () => {
    expect(shortestRoute("scan_000", "scan_005", edges)).toBeNull(); // island
    expect(shortestRoute("scan_000", "ghost", edges)).toBeNull();
    expect(shortestRoute("ghost", "scan_000", edges)).toBeNull();
  });

  it("survives degenerate zero-length edges without looping", () => {
    const degenerate = [...edges, edge("scan_001", "scan_002", 0)];
    expect(shortestRoute("scan_000", "scan_003", degenerate)).toEqual([
      "scan_001",
      "scan_002",
      "scan_003",
    ]);
  });

  it("exposes a sane usher cap", () => {
    expect(MAX_USHER_HOPS).toBeGreaterThanOrEqual(6);
    expect(MAX_USHER_HOPS).toBeLessThanOrEqual(20);
  });
});
