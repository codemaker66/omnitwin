import { describe, expect, it, vi } from "vitest";
import { DoubleSide, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Scene, ShapeGeometry, Vector3 } from "three";
import type { RoomGeometry } from "../../data/room-geometries.js";
import { PLANNER_INTERACTION_FLOOR_NAME, findPlacementFloor, placementFloorPoint, plannerInteractionFloorShape } from "../planner-interaction-floor.js";

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

  it("finds the floor point under a screen point, and none off the room", () => {
    const scene = new Scene();
    const target = floor(null); scene.add(target);
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 10, 0);
    // Looking straight down: an up along the floor keeps the camera's basis defined.
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const rect = { left: 0, top: 0, width: 400, height: 400 };
    const centre = placementFloorPoint(scene, camera, new Raycaster(), rect, 200, 200);
    expect(centre?.x).toBeCloseTo(0, 6);
    expect(centre?.z).toBeCloseTo(0, 6);
    // The room is 8 m by 6 m; the screen's corner looks well beyond it.
    expect(placementFloorPoint(scene, camera, new Raycaster(), rect, 0, 0)).toBeNull();
    target.geometry.dispose(); (target.material as MeshBasicMaterial).dispose();
  });

  it("walks the scene for the interaction surface once, then reuses it while it stays in the scene", () => {
    const scene = new Scene();
    const room = new Group(); scene.add(room);
    const target = floor(null); room.add(target);
    expect(findPlacementFloor(scene)).toBe(target);
    // A pointer move asks on every event: none of them walks the scene's hundreds of nodes again.
    const walk = vi.spyOn(scene, "getObjectByName");
    for (let move = 0; move < 5; move++) expect(findPlacementFloor(scene)).toBe(target);
    expect(walk).not.toHaveBeenCalled();
    // Once it leaves the scene it is not returned, and its replacement is found.
    room.remove(target);
    expect(findPlacementFloor(scene)).toBeNull();
    const next = floor(null); scene.add(next);
    expect(findPlacementFloor(scene)).toBe(next);
    walk.mockRestore();
    for (const mesh of [target, next]) { mesh.geometry.dispose(); (mesh.material as MeshBasicMaterial).dispose(); }
  });
});
