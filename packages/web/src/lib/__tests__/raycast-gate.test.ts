import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import { SELECTION_PICK_IGNORED, intersectSelectable, skipDescendantRaycast } from "../raycast-gate.js";

function box(name: string, y: number): Mesh {
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  mesh.name = name;
  mesh.position.set(0, y, 0);
  return mesh;
}

/**
 * A press straight down from above, as a plan view picks; off the centre,
 * where a face's two triangles meet and would both report the hit.
 */
function down(): Raycaster {
  return new Raycaster(new Vector3(0.2, 10, 0.1), new Vector3(0, -1, 0));
}

describe("intersectSelectable", () => {
  it("finds what three's own recursive raycast finds, nearest first", () => {
    const scene = new Group();
    const shelf = new Group();
    shelf.add(box("low", 0), box("high", 3));
    scene.add(shelf, box("middle", 1.5));
    scene.updateMatrixWorld(true);
    const three = down().intersectObjects(scene.children, true).map((hit) => [hit.object.name, hit.distance]);
    const picked = intersectSelectable(down(), scene.children).map((hit) => [hit.object.name, hit.distance]);
    expect(picked).toEqual(three);
    expect(picked.map(([name]) => name)).toEqual(["high", "middle", "low"]);
  });

  it("never tests a subtree flagged as no selection target", () => {
    const scene = new Group();
    const hall = new Group();
    hall.userData[SELECTION_PICK_IGNORED] = true;
    const wall = box("hall-wall", 3);
    const wallRaycast = vi.spyOn(wall, "raycast");
    hall.add(wall);
    scene.add(hall, box("table", 0));
    scene.updateMatrixWorld(true);
    expect(intersectSelectable(down(), scene.children).map((hit) => hit.object.name)).toEqual(["table"]);
    expect(wallRaycast).not.toHaveBeenCalled();
    // The flag is the pick's alone: three's raycast, as the measuring tools
    // use it, still meets the room's surfaces.
    expect(down().intersectObjects(scene.children, true).map((hit) => hit.object.name)).toEqual(["hall-wall", "table"]);
  });

  it("keeps out of a subtree whose raycast gate closes it, and off other layers", () => {
    const scene = new Group();
    const inactive = new Group();
    inactive.raycast = skipDescendantRaycast;
    inactive.add(box("inactive-shell", 3));
    const elsewhere = box("other-layer", 2);
    elsewhere.layers.set(2);
    scene.add(inactive, elsewhere, box("table", 0));
    scene.updateMatrixWorld(true);
    expect(intersectSelectable(down(), scene.children).map((hit) => hit.object.name)).toEqual(["table"]);
  });
});
