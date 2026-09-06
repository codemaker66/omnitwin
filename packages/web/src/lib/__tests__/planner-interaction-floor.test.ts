import { describe, expect, it } from "vitest";
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Scene, ShapeGeometry, Vector3 } from "three";
import type { RoomGeometry } from "../../data/room-geometries.js";
import { PLANNER_INTERACTION_FLOOR_NAME, findPlacementFloor, plannerInteractionFloorShape } from "../planner-interaction-floor.js";

const dimensions = { width: 8, length: 6, height: 3 };
const concave: RoomGeometry = {
  wallPolygon: [[1, 2], [5, 2], [5, 4], [3, 4], [3, 7], [1, 7]],
  ceilingHeight: 3, features: [], hasDome: false, domeRadius: 0,
};

function floor(geometry: RoomGeometry | null): Mesh {
  const mesh = new Mesh(new ShapeGeometry(plannerInteractionFloorShape(geometry, dimensions)),
    new MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: DoubleSide }));
  mesh.name = PLANNER_INTERACTION_FLOOR_NAME;
  mesh.visible = false;
  mesh.rotation.x = -Math.PI / 2;
  mesh.updateMatrixWorld(true);
  return mesh;
}

function hit(mesh: Mesh, x: number, z: number): number {
  return new Raycaster(new Vector3(x, 3, z), new Vector3(0, -1, 0)).intersectObject(mesh, false).length;
}

describe("planning interaction floor", () => {
  it("raycasts the invisible surface without filling a concave room's missing area or mirroring Z", () => {
    const mesh = floor(concave);
    try {
      expect(hit(mesh, 2, 6)).toBeGreaterThan(0);
      expect(hit(mesh, 4, 3)).toBeGreaterThan(0);
      expect(hit(mesh, 4, 6)).toBe(0);
      expect(hit(mesh, 2, -6)).toBe(0);
      expect(mesh.visible).toBe(false);
    } finally { mesh.geometry.dispose(); (mesh.material as MeshBasicMaterial).dispose(); }
  });

  it("retains the existing centered rectangular fallback dimensions", () => {
    const mesh = floor(null);
    try {
      expect(hit(mesh, 3.9, 2.9)).toBeGreaterThan(0);
      expect(hit(mesh, -3.9, -2.9)).toBeGreaterThan(0);
      expect(hit(mesh, 4.1, 0)).toBe(0);
    } finally { mesh.geometry.dispose(); (mesh.material as MeshBasicMaterial).dispose(); }
  });

  it("prefers the interaction surface and resolves replacement shells without a stale cached object", () => {
    const scene = new Scene();
    const oldShell = new Mesh(); oldShell.name = "floor"; scene.add(oldShell);
    expect(findPlacementFloor(scene)).toBe(oldShell);
    const target = floor(null); scene.add(target);
    expect(findPlacementFloor(scene)).toBe(target);
    scene.remove(target, oldShell);
    expect(findPlacementFloor(scene)).toBeNull();
    const replacement = new Mesh(); replacement.name = "floor"; scene.add(replacement);
    expect(findPlacementFloor(scene)).toBe(replacement);
    target.geometry.dispose(); (target.material as MeshBasicMaterial).dispose();
    oldShell.geometry.dispose(); (oldShell.material as MeshBasicMaterial).dispose();
    replacement.geometry.dispose(); (replacement.material as MeshBasicMaterial).dispose();
  });
});
