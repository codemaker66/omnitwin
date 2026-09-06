import { FloorPlanOutlineSchema, HallkeeperFloorPlanSchema, type HallkeeperFloorPlan } from "@omnitwin/types";

export interface FloorPlanAsset {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly widthM: string;
  readonly depthM: string;
  readonly collisionType: string;
}

interface FloorPlanPlacement {
  readonly id: string;
  readonly assetDefinitionId: string;
  readonly positionX: string;
  readonly positionZ: string;
  readonly rotationY: string;
  readonly scale: string;
}

/** Capture source geometry before approval. No inferred chair rings or room rectangle. */
export function buildHallkeeperFloorPlan(
  outline: unknown,
  objects: readonly FloorPlanPlacement[],
  assets: ReadonlyMap<string, FloorPlanAsset>,
): HallkeeperFloorPlan {
  const points = FloorPlanOutlineSchema.parse(outline);
  return HallkeeperFloorPlanSchema.parse({
    coordinateSpace: "real_m_v1",
    outline: points.map((point) => ({ x: point.x, z: point.y })),
    objects: [...objects].sort((a, b) => a.id.localeCompare(b.id)).map((object) => {
      const asset = assets.get(object.assetDefinitionId);
      if (asset === undefined) throw new Error(`Missing footprint catalogue entry for ${object.id}`);
      return {
        objectId: object.id, assetDefinitionId: asset.id, name: asset.name, category: asset.category,
        x: Number(object.positionX), z: Number(object.positionZ), rotationY: Number(object.rotationY),
        scale: Number(object.scale), widthM: Number(asset.widthM), depthM: Number(asset.depthM),
        collisionType: asset.collisionType,
      };
    }),
  });
}

export interface PlanPoint { readonly x: number; readonly z: number }
export interface PlanViewport { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/** Three.js positive Y yaw rotates local +X towards -Z. The page keeps +Z down. */
export function footprintCorners(object: HallkeeperFloorPlan["objects"][number]): readonly PlanPoint[] {
  const halfWidth = object.widthM * object.scale / 2;
  const halfDepth = object.depthM * object.scale / 2;
  const c = Math.cos(object.rotationY); const s = Math.sin(object.rotationY);
  return [[-halfWidth, -halfDepth], [halfWidth, -halfDepth], [halfWidth, halfDepth], [-halfWidth, halfDepth]]
    .map(([u = 0, v = 0]) => ({ x: object.x + c * u + s * v, z: object.z - s * u + c * v }));
}

/** One uniform scale, with out-of-room objects retained rather than clipped. */
export function projectHallkeeperFloorPlan(plan: HallkeeperFloorPlan, viewport: PlanViewport) {
  const bounds = [...plan.outline, ...plan.objects.flatMap(footprintCorners)];
  const minX = Math.min(...bounds.map((point) => point.x));
  const maxX = Math.max(...bounds.map((point) => point.x));
  const minZ = Math.min(...bounds.map((point) => point.z));
  const maxZ = Math.max(...bounds.map((point) => point.z));
  const pointsPerMetre = Math.min(viewport.width / (maxX - minX), viewport.height / (maxZ - minZ));
  const left = viewport.x + (viewport.width - (maxX - minX) * pointsPerMetre) / 2;
  const top = viewport.y + (viewport.height - (maxZ - minZ) * pointsPerMetre) / 2;
  const project = (point: PlanPoint) => ({ x: left + (point.x - minX) * pointsPerMetre, y: top + (point.z - minZ) * pointsPerMetre });
  return {
    pointsPerMetre,
    outline: plan.outline.map(project),
    objects: plan.objects.map((object) => ({
      object, center: project(object), corners: footprintCorners(object).map(project),
      width: object.widthM * object.scale * pointsPerMetre,
      depth: object.depthM * object.scale * pointsPerMetre,
    })),
  };
}
