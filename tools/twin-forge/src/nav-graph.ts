import type { TwinNavEdge, TwinScanNode } from "@omnitwin/types";

// -----------------------------------------------------------------------------
// nav-graph — the walk graph, and the invariant that it must be walkable.
//
// buildNavGraph is same-floor BY CONSTRUCTION (a KNN link between storeys
// would tunnel through a floor slab), and stairwells are the authored
// overrides' job. What was missing until now is anything that checks the job
// was done: the shipped Trades Hall bundle carried 149 viewpoints in two
// islands — 84 upstairs and 65 down — with the staircase captured to a
// landing and never linked onward, so no visitor could walk between the
// storeys at all. The route finder simply returned "unreachable" and the
// Usher teleported instead, which is exactly why it went unnoticed for a
// year of shipping.
//
// assertNavGraphConnected turns that silent condition into a build failure
// that names the islands and the override that would join them.
// -----------------------------------------------------------------------------

const STOREY_HEIGHT_M = 3.5;
const TRIPOD_HEIGHT_M = 1.5;

/** Bucket a scan height into a floor index (ground = 0). */
export function floorOf(zMetres: number): number {
  if (!Number.isFinite(zMetres)) {
    throw new Error("scan height must be finite");
  }
  const floor = Math.round((zMetres - TRIPOD_HEIGHT_M) / STOREY_HEIGHT_M);
  return Object.is(floor, -0) ? 0 : floor;
}

export interface NavGraphOptions {
  readonly k?: number;
  readonly maxDistanceM?: number;
  readonly overrides?: {
    readonly add?: readonly (readonly [string, string])[];
    readonly remove?: readonly (readonly [string, string])[];
  };
}

function key(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function resolveOverridePair(
  byId: ReadonlyMap<string, TwinScanNode>,
  a: string,
  b: string,
): readonly [TwinScanNode, TwinScanNode] {
  if (a === b) {
    throw new Error(`nav override cannot connect a node to itself: ${a}`);
  }
  const nodeA = byId.get(a);
  const nodeB = byId.get(b);
  if (nodeA === undefined || nodeB === undefined) {
    throw new Error(`nav override references unknown node: ${a} / ${b}`);
  }
  return [nodeA, nodeB];
}

function distance(a: TwinScanNode, b: TwinScanNode): number {
  const dx = a.pose.t[0] - b.pose.t[0];
  const dy = a.pose.t[1] - b.pose.t[1];
  const dz = a.pose.t[2] - b.pose.t[2];
  return Math.hypot(dx, dy, dz);
}

/**
 * K-nearest-neighbour walk graph. Same-floor only (stairwell links are
 * exactly what the hand-edited overrides file is for), symmetric, deduped.
 */
export function buildNavGraph(
  nodes: readonly TwinScanNode[],
  opts: NavGraphOptions = {},
): TwinNavEdge[] {
  const k = opts.k ?? 4;
  const maxD = opts.maxDistanceM ?? 8;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chosen = new Map<string, TwinNavEdge>();

  for (const a of nodes) {
    const near = nodes
      .filter((b) => b.id !== a.id && b.floor === a.floor)
      .map((b) => ({ b, d: distance(a, b) }))
      .filter(({ d }) => d <= maxD)
      .sort((x, y) => x.d - y.d)
      .slice(0, k);
    for (const { b, d } of near) {
      const kk = key(a.id, b.id);
      if (!chosen.has(kk)) {
        const [idA, idB] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
        chosen.set(kk, { a: idA, b: idB, distanceM: Number(d.toFixed(3)) });
      }
    }
  }

  const removedKeys = new Set<string>();
  for (const [x, y] of opts.overrides?.remove ?? []) {
    resolveOverridePair(byId, x, y);
    removedKeys.add(key(x, y));
    chosen.delete(key(x, y));
  }
  for (const [x, y] of opts.overrides?.add ?? []) {
    const [na, nb] = resolveOverridePair(byId, x, y);
    if (removedKeys.has(key(x, y))) {
      throw new Error(`nav override cannot both add and remove the same edge: ${x} / ${y}`);
    }
    const [idA, idB] = x < y ? [x, y] : [y, x];
    chosen.set(key(x, y), { a: idA, b: idB, distanceM: Number(distance(na, nb).toFixed(3)) });
  }

  return [...chosen.values()].sort((e1, e2) => e1.a.localeCompare(e2.a) || e1.b.localeCompare(e2.b));
}

/**
 * The graph's connected components — the sets of viewpoints that can actually
 * reach one another on foot. Largest first, each sorted by id, so the output
 * is stable enough to assert on and to print in an error.
 */
export function navGraphComponents(
  nodes: readonly TwinScanNode[],
  edges: readonly TwinNavEdge[],
): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const scanNode of nodes) {
    adjacency.set(scanNode.id, []);
  }
  for (const edge of edges) {
    adjacency.get(edge.a)?.push(edge.b);
    adjacency.get(edge.b)?.push(edge.a);
  }

  const seen = new Set<string>();
  const components: string[][] = [];
  for (const scanNode of nodes) {
    if (seen.has(scanNode.id)) {
      continue;
    }
    const members: string[] = [];
    const stack = [scanNode.id];
    seen.add(scanNode.id);
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) {
        break;
      }
      members.push(current);
      for (const neighbour of adjacency.get(current) ?? []) {
        if (!seen.has(neighbour)) {
          seen.add(neighbour);
          stack.push(neighbour);
        }
      }
    }
    components.push(members.sort());
  }
  // Largest first; ties broken by first id so the ordering is total.
  return components.sort(
    (a, b) => b.length - a.length || (a[0] ?? "").localeCompare(b[0] ?? ""),
  );
}

export interface NavBridgeCandidate {
  readonly a: string;
  readonly b: string;
  readonly distanceM: number;
}

/**
 * A rise this small is level ground — a corridor the capture stepped over, or
 * a threshold — and needs no horizontal run to be plausible.
 */
const BRIDGE_LEVEL_RISE_M = 0.5;

/**
 * Below this run-to-rise ratio a pair is a FLOOR SLAB, not a staircase.
 *
 * Found by running the suggester against the real Trades Hall bundle: its
 * nearest cross-storey pair was scan_057 to scan_119 at 2.97 m — of which
 * 0.04 m was horizontal. Those are the same plan position on two storeys, and
 * the "helpful" suggestion would have walked the visitor down through the
 * floor. A real stair pitched at 30–37 degrees spends more run than rise;
 * even a steep service stair keeps a ratio near 0.8. Three quarters is
 * therefore generous to genuine stairs and still refuses every slab.
 */
const BRIDGE_MIN_RUN_PER_RISE = 0.75;

/** Could these two viewpoints plausibly be joined on foot? Geometry only —
 *  this narrows what a human is asked to look at, it never decides. */
function bridgeIsPlausible(a: TwinScanNode, b: TwinScanNode): boolean {
  const run = Math.hypot(a.pose.t[0] - b.pose.t[0], a.pose.t[1] - b.pose.t[1]);
  const rise = Math.abs(a.pose.t[2] - b.pose.t[2]);
  if (rise <= BRIDGE_LEVEL_RISE_M) {
    return true;
  }
  return run >= rise * BRIDGE_MIN_RUN_PER_RISE;
}

/**
 * For each island beyond the first, the shortest real pair of viewpoints
 * joining it to the largest one — i.e. the override an operator should
 * consider authoring. A SUGGESTION, never an automatic edge: only a human who
 * has seen the capture can say whether two viewpoints 4 m apart are a
 * staircase or two rooms with a floor slab between them, and guessing wrong
 * walks the visitor through solid stone.
 */
export function suggestNavBridges(
  nodes: readonly TwinScanNode[],
  components: readonly (readonly string[])[],
): NavBridgeCandidate[] {
  const [mainland, ...islands] = components;
  if (mainland === undefined || islands.length === 0) {
    return [];
  }
  const byId = new Map(nodes.map((scanNode) => [scanNode.id, scanNode]));
  const bridges: NavBridgeCandidate[] = [];
  for (const island of islands) {
    let best: NavBridgeCandidate | null = null;
    // Fallback: the nearest pair of ANY shape, offered only when no plausible
    // one exists. Better to name an implausible pair and let the operator
    // reject it than to report an island with no lead at all.
    let nearest: NavBridgeCandidate | null = null;
    for (const aId of mainland) {
      const a = byId.get(aId);
      if (a === undefined) {
        continue;
      }
      for (const bId of island) {
        const b = byId.get(bId);
        if (b === undefined) {
          continue;
        }
        const d = distance(a, b);
        const candidate: NavBridgeCandidate = {
          a: aId,
          b: bId,
          distanceM: Number(d.toFixed(3)),
        };
        if (nearest === null || d < nearest.distanceM) {
          nearest = candidate;
        }
        if (bridgeIsPlausible(a, b) && (best === null || d < best.distanceM)) {
          best = candidate;
        }
      }
    }
    const chosen = best ?? nearest;
    if (chosen !== null) {
      bridges.push(chosen);
    }
  }
  return bridges;
}

/**
 * Refuse a walkthrough whose viewpoints cannot all reach one another. The
 * message names the islands and the shortest joining pair, so the operator can
 * author the stairwell override without reverse-engineering the graph.
 *
 * An empty capture is not a failure — there is no island to strand anyone on.
 */
export function assertNavGraphConnected(
  nodes: readonly TwinScanNode[],
  edges: readonly TwinNavEdge[],
): void {
  if (nodes.length === 0) {
    return;
  }
  const components = navGraphComponents(nodes, edges);
  if (components.length <= 1) {
    return;
  }
  const bridges = suggestNavBridges(nodes, components);
  const sizes = components.map((component) => component.length).join(" + ");
  const suggestions = bridges
    .map(
      (bridge) =>
        `    ["${bridge.a}", "${bridge.b}"]   (${String(bridge.distanceM)} m apart)`,
    )
    .join("\n");
  throw new Error(
    `walk graph is split into ${String(components.length)} islands (${sizes} viewpoints): ` +
      `a visitor standing in one can never walk to another.\n` +
      `  If these are joined in the real building — a staircase, a corridor the ` +
      `capture stepped over — author the link in the nav overrides file and ` +
      `re-run with --overrides. Shortest joining pairs:\n${suggestions}\n` +
      `  If the capture really is disconnected (two buildings, an unreachable ` +
      `wing), re-run with --allow-disconnected to record that deliberately.`,
  );
}
