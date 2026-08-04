import type { TwinNavEdge, TwinScanNode } from "@omnitwin/types";

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
