import type { TwinNavEdge } from "@omnitwin/types";

// -----------------------------------------------------------------------------
// travel-route — shortest-path routing over the nav graph, pure and unit-tested.
//
// The Usher (SS++ phase 1): when a visitor picks a distant node on the minimap,
// the walk GLIDES the real corridor route — Reception Room, across the landing,
// into the Grand Hall — instead of teleport-cutting. Teleports are the #1 thing
// that make a virtual tour feel like a maze of bubbles; walking the actual
// route builds the mental model of how the building connects, which is exactly
// the guest-flow reasoning a planner needs.
//
// Dijkstra over the manifest's undirected edges, weighted by distanceM. The
// graph is small (149 nodes / ~360 edges), so a simple scan-min frontier is
// clearer than a heap and comfortably fast.
// -----------------------------------------------------------------------------

/** Routes longer than this glide too long to feel like an usher and fall back
 *  to the instant teleport (the escape hatch remains a second click). */
export const MAX_USHER_HOPS = 12;

/**
 * Shortest route from `fromId` to `toId`: the node ids to hop through,
 * EXCLUDING the start, INCLUDING the target. Empty array when already there;
 * null when the target is unreachable (disconnected or unknown).
 */
export function shortestRoute(
  fromId: string,
  toId: string,
  edges: readonly TwinNavEdge[],
): string[] | null {
  if (fromId === toId) {
    return [];
  }
  const adjacency = new Map<string, { to: string; w: number }[]>();
  const link = (a: string, b: string, w: number): void => {
    const list = adjacency.get(a);
    if (list === undefined) {
      adjacency.set(a, [{ to: b, w }]);
    } else {
      list.push({ to: b, w });
    }
  };
  for (const edge of edges) {
    // Guard degenerate weights — a zero/negative distance would let Dijkstra
    // loop for free; clamp to a centimetre.
    const w = Math.max(edge.distanceM, 0.01);
    link(edge.a, edge.b, w);
    link(edge.b, edge.a, w);
  }
  if (!adjacency.has(fromId) || !adjacency.has(toId)) {
    return null;
  }

  const dist = new Map<string, number>([[fromId, 0]]);
  const prev = new Map<string, string>();
  const done = new Set<string>();

  for (;;) {
    // Scan-min frontier: the unvisited node with the smallest tentative cost.
    let current: string | null = null;
    let best = Infinity;
    for (const [id, d] of dist) {
      if (!done.has(id) && d < best) {
        best = d;
        current = id;
      }
    }
    if (current === null) {
      return null; // frontier exhausted — unreachable
    }
    if (current === toId) {
      break;
    }
    done.add(current);
    for (const { to, w } of adjacency.get(current) ?? []) {
      const candidate = best + w;
      if (candidate < (dist.get(to) ?? Infinity)) {
        dist.set(to, candidate);
        prev.set(to, current);
      }
    }
  }

  const route: string[] = [];
  for (let at: string | undefined = toId; at !== undefined && at !== fromId; at = prev.get(at)) {
    route.push(at);
  }
  route.reverse();
  return route;
}
