import { HallkeeperFloorPlanSchema, type HallkeeperFloorPlan } from "@omnitwin/types";

export interface PlanPoint { readonly x: number; readonly y: number }
type Footprint = HallkeeperFloorPlan["objects"][number];
export interface ProjectedFootprint {
  readonly object: Footprint;
  readonly center: PlanPoint;
  readonly corners: readonly PlanPoint[];
  readonly width: number;
  readonly depth: number;
}
export interface ProjectedFrozenPlan {
  readonly pointsPerMetre: number;
  readonly outline: readonly PlanPoint[];
  readonly objects: readonly ProjectedFootprint[];
}
export type FrozenPlanResult = { readonly kind: "legacy" } | { readonly kind: "invalid" }
  | { readonly kind: "saved"; readonly plan: ProjectedFrozenPlan };

/** Frozen catalogue dimensions and Three Y rotation, with +Z down on the page.
 * This matches the approved PDF; it does not infer chairs from bundle capacity. */
export function savedFootprintCorners(object: Footprint): readonly PlanPoint[] {
  const w = object.widthM * object.scale / 2;
  const d = object.depthM * object.scale / 2;
  const c = Math.cos(object.rotationY); const s = Math.sin(object.rotationY);
  const local: readonly [number, number][] = [[-w, -d], [w, -d], [w, d], [-w, d]];
  return local.map(([x, z]) => ({ x: object.x + c * x + s * z, y: object.z - s * x + c * z }));
}

/** Fit outline and every actual footprint uniformly. Never clamp off-room items
 * or recenter coordinates using a current room/catalogue record. */
export function prepareFrozenPlan(input: unknown): FrozenPlanResult {
  if (input === undefined || input === null) return { kind: "legacy" };
  const parsed = HallkeeperFloorPlanSchema.safeParse(input);
  if (!parsed.success) return { kind: "invalid" };
  const source = parsed.data;
  const outlines = source.outline.map(({ x, z }) => ({ x, y: z }));
  const corners = source.objects.map(savedFootprintCorners);
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const point of [...outlines, ...corners.flat()]) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return { kind: "invalid" };
    minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
  }
  // Leave 32 units around the plan and a separate footer for the metre bar.
  const width = maxX - minX; const depth = maxY - minY;
  const pointsPerMetre = Math.min(936 / width, 536 / depth);
  if (!Number.isFinite(width) || !Number.isFinite(depth) || !Number.isFinite(pointsPerMetre) || pointsPerMetre <= 0) return { kind: "invalid" };
  const left = (1000 - width * pointsPerMetre) / 2;
  const top = (600 - depth * pointsPerMetre) / 2;
  const project = (point: PlanPoint): PlanPoint => ({ x: left + (point.x - minX) * pointsPerMetre, y: top + (point.y - minY) * pointsPerMetre });
  const objects = source.objects.map((object, index): ProjectedFootprint => ({
    object, center: project({ x: object.x, y: object.z }), corners: (corners[index] ?? []).map(project),
    width: object.widthM * object.scale * pointsPerMetre, depth: object.depthM * object.scale * pointsPerMetre,
  }));
  if (objects.some((object) => !Number.isFinite(object.width) || !Number.isFinite(object.depth))) return { kind: "invalid" };
  return { kind: "saved", plan: { pointsPerMetre, outline: outlines.map(project), objects } };
}
