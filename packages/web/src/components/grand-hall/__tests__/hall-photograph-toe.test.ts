import { describe, expect, it } from "vitest";
import { Texture, type Material } from "three";
import { MeshStandardNodeMaterial, NodeMaterial, type Node } from "three/webgpu";
import { filmToe } from "../../../lib/film-toe.js";
import { DoorSwingUniforms } from "../hall-doors.js";
import { createDoorLeafMaterials, createHallMaterials, HallGlazingUniforms, HallSectionUniforms } from "../hall-materials.js";
import { HallMoodUniforms } from "../hall-mood.js";
import { HallPhotos } from "../hall-photos.js";

// ---------------------------------------------------------------------------
// Which of the hall's materials give Neutral's toe back (lib/film-toe.ts) when
// a view asks for a toe of its own, and that none does when it asks for
// nothing: the photographs' materials are then built as they always were.
//
// The lift is a plain node expression that reads the `filmToe` uniform, so a
// colour gives the toe back when that uniform is in its graph. The walk below
// sees every node built as a plain node, which is how each place that shows a
// photograph builds its colour. It does not see inside a deferred `Fn` body.
// ---------------------------------------------------------------------------

const textures = { mahoganyDark: new Texture() };

/** Whether `filmToe` is read anywhere under `roots`. Each node is visited once; three's own traverse walks a shared one again. */
function readsToe(...roots: (Node | null)[]): boolean {
  const seen = new Set<Node>();
  const pending = roots.filter((node): node is Node => node !== null);
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node === filmToe) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    pending.push(...node.getChildren());
  }
  return false;
}

/** Whether what a material shows gives the toe back: its colour, and a lit material's emission, where its photograph is put (hall-materials.ts). */
function givesToeBack(material: Material): boolean {
  if (!(material instanceof NodeMaterial)) return false;
  return material instanceof MeshStandardNodeMaterial ? readsToe(material.colorNode, material.emissiveNode) : readsToe(material.colorNode);
}

/** The keys of the materials that give the toe back, in order. */
function liftedKeys(materials: ReadonlyMap<string, Material>): string[] {
  return [...materials].filter(([, material]) => givesToeBack(material)).map(([key]) => key).sort();
}

function dispose(materials: ReadonlyMap<string, Material>): void {
  for (const material of materials.values()) material.dispose();
}

describe("the hall's materials and the curve's toe", () => {
  it("for a view with a toe of its own, the scan's photographs give it back and nothing else does", () => {
    const materials = createHallMaterials(textures, new HallPhotos(), new HallMoodUniforms(), new HallSectionUniforms(), null, {
      glazing: new HallGlazingUniforms(), photographToe: true,
    });
    expect([...materials.keys()].sort()).toEqual(["brass", "ceilingPhoto", "domePhoto", "floor", "gilt", "mahoganyDark", "paint", "wallPhoto", "wallPhotoGloss"]);
    expect(liftedKeys(materials)).toEqual(["ceilingPhoto", "domePhoto", "wallPhoto", "wallPhotoGloss"]);
    dispose(materials);
  });

  it("for a view that asks for nothing, no material reads the toe: the photographs are built as they always were", () => {
    const materials = createHallMaterials(textures, new HallPhotos(), new HallMoodUniforms(), new HallSectionUniforms(), null, { glazing: new HallGlazingUniforms() });
    expect(liftedKeys(materials)).toEqual([]);
    dispose(materials);
  });

  it("the door leaves' photographed faces follow the walls; their mahogany, their brass and Atelier's card never do", () => {
    const leaves = (options: { readonly card?: boolean; readonly photographToe?: boolean }): ReadonlyMap<string, Material> =>
      createDoorLeafMaterials(textures, new HallPhotos(), new HallMoodUniforms(), new HallSectionUniforms(), new DoorSwingUniforms(), null, options);
    const withToe = leaves({ photographToe: true });
    expect([...withToe.keys()].sort()).toEqual(["brass", "mahoganyDark", "wallPhoto", "wallPhotoGloss"]);
    expect(liftedKeys(withToe)).toEqual(["wallPhoto", "wallPhotoGloss"]);
    const card = leaves({ card: true, photographToe: true });
    expect(liftedKeys(card)).toEqual([]);
    const asBuiltBefore = leaves({});
    expect(liftedKeys(asBuiltBefore)).toEqual([]);
    for (const materials of [withToe, card, asBuiltBefore]) dispose(materials);
  });
});
