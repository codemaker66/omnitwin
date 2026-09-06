import { describe, expect, it } from "vitest";
import { ShapeGeometry } from "three";
import { CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE } from "@omnitwin/types";
import { frozenLayoutRoomModel } from "../../../lib/frozen-layout-room.js";
import { frozenRoomBoundaryPositions, frozenRoomFloorShape } from "../FrozenLayoutRoom.js";

describe("frozen room rendering coordinates", () => {
  it("keeps an asymmetric outline on the same X/Z side as canonical furniture", () => {
    const model = frozenLayoutRoomModel({
      ...CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.venueRuntime,
      floorPlanOutline: [{ x: 2, y: 3 }, { x: 10, y: 3 }, { x: 10, y: 7 }, { x: 5, y: 7 }, { x: 5, y: 12 }, { x: 2, y: 12 }],
      spaceDimensions: { width: 8, length: 9, height: 4 },
    });
    const geometry = new ShapeGeometry(frozenRoomFloorShape(model));
    geometry.rotateX(-Math.PI / 2);
    const position = geometry.getAttribute("position");
    const vertices = Array.from({ length: position.count }, (_, index) => [position.getX(index), position.getZ(index)]);
    for (const [x, z] of model.geometry.wallPolygon) {
      expect(vertices.some(([vx, vz]) => Math.abs((vx ?? 0) - x) < 1e-5 && Math.abs((vz ?? 0) - z) < 1e-5)).toBe(true);
    }
    expect(model.furnitureOffset).toEqual([-6, 0, -7.5]);
    const boundary = frozenRoomBoundaryPositions(model);
    expect(boundary).toHaveLength(6 * 3 * 2 * 3);
    expect(boundary.slice(0, 6)).toEqual([-4, 0.008, -4.5, 4, 0.008, -4.5]);
    expect(boundary.slice(6, 12)).toEqual([-4, 4, -4.5, 4, 4, -4.5]);
    geometry.dispose();
  });
});
