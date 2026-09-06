import { describe, expect, it } from "vitest";
import { Matrix4, Vector3 } from "three";
import type { HallkeeperFloorPlan } from "@omnitwin/types";
import { prepareFrozenPlan, savedFootprintCorners } from "../hallkeeper-frozen-plan.js";

const object: HallkeeperFloorPlan["objects"][number] = {
  objectId: "00000000-0000-4000-8000-000000000001", assetDefinitionId: "00000000-0000-4000-8000-000000000002",
  name: "Test chair", category: "chair", x: 12, z: 5, rotationY: 0.73, scale: 1.7, widthM: 0.5, depthM: 0.65, collisionType: "box",
};
const plan: HallkeeperFloorPlan = { coordinateSpace: "real_m_v1", objects: [object],
  outline: [{ x: 10, z: 3 }, { x: 20, z: 3 }, { x: 20, z: 8 }, { x: 16, z: 8 }, { x: 16, z: 13 }, { x: 10, z: 13 }] };

describe("saved hallkeeper geometry", () => {
  it("matches actual Three transforms, including non-square scaled rotated chairs", () => {
    const transform = new Matrix4().makeTranslation(object.x, 0, object.z)
      .multiply(new Matrix4().makeRotationY(object.rotationY)).multiply(new Matrix4().makeScale(object.scale, object.scale, object.scale));
    const local = [[-0.25, -0.325], [0.25, -0.325], [0.25, 0.325], [-0.25, 0.325]] as const;
    const corners = savedFootprintCorners(object);
    local.forEach(([x, z], index) => {
      const expected = new Vector3(x, 0, z).applyMatrix4(transform);
      expect(corners[index]?.x).toBeCloseTo(expected.x, 12);
      expect(corners[index]?.y).toBeCloseTo(expected.z, 12);
    });
  });

  it("keeps the non-centred nonrectangular outline and off-room furniture in one undistorted frame", () => {
    const source = { ...plan, objects: [{ ...object, x: 24, z: 15 }] };
    const before = JSON.stringify(source);
    const result = prepareFrozenPlan(source);
    expect(result.kind).toBe("saved");
    if (result.kind !== "saved") throw new Error("Expected saved plan");
    const p = result.plan;
    expect(p.outline).toHaveLength(6);
    expect(p.outline[1]!.x - p.outline[0]!.x).toBeCloseTo(10 * p.pointsPerMetre);
    expect(p.outline[5]!.y - p.outline[0]!.y).toBeCloseTo(10 * p.pointsPerMetre);
    expect(p.objects[0]!.center.x - p.outline[0]!.x).toBeCloseTo(14 * p.pointsPerMetre);
    expect(p.objects[0]!.center.y - p.outline[0]!.y).toBeCloseTo(12 * p.pointsPerMetre);
    for (const point of [...p.outline, ...p.objects.flatMap((entry) => entry.corners)]) {
      expect(point.x).toBeGreaterThanOrEqual(31.999); expect(point.x).toBeLessThanOrEqual(968.001);
      expect(point.y).toBeGreaterThanOrEqual(31.999); expect(point.y).toBeLessThanOrEqual(568.001);
    }
    expect(JSON.stringify(source)).toBe(before);
  });

  it("rejects finite source values whose derived dimensions overflow", () => {
    expect(prepareFrozenPlan({ ...plan, objects: [{ ...object, widthM: Number.MAX_VALUE, scale: Number.MAX_VALUE }] })).toEqual({ kind: "invalid" });
  });

  it("rejects unknown frames, zero dimensions and malformed objects at the rendering boundary", () => {
    expect(prepareFrozenPlan({ ...plan, coordinateSpace: "normalized" }).kind).toBe("invalid");
    expect(prepareFrozenPlan({ ...plan, objects: [{ ...object, widthM: 0 }] }).kind).toBe("invalid");
    expect(prepareFrozenPlan({ ...plan, objects: [null] }).kind).toBe("invalid");
  });
});
