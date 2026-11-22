import { describe, expect, it } from "vitest";
import { Texture, type Material } from "three";
import { ConditionalNode, MathNode, MeshStandardNodeMaterial, NodeMaterial, VarNode, type Node } from "three/webgpu";
import { filmToe } from "../../../lib/film-toe.js";
import {
  HallBeyondPhotos, createBeyondFloorMaterial, createBeyondPoolMaterial, createBeyondSolidMaterial, createFirstFloorCardMaterial,
} from "../hall-beyond.js";
import { DoorSwingUniforms } from "../hall-doors.js";
import { createDoorLeafMaterials, createHallMaterials, HallGlazingUniforms, HallSectionUniforms } from "../hall-materials.js";
import { HallMoodUniforms } from "../hall-mood.js";
import { HallPhotos } from "../hall-photos.js";
import { createHallSection, SECTION_PRESETS, type HallSectionOptions } from "../hall-section.js";

// ---------------------------------------------------------------------------
// Which of the hall's materials give Neutral's toe back (lib/film-toe.ts).
//
// The scan's photographs do, and what is matched to them at a seam: the walls,
// the ceiling and the dome, the door leaves' photographed faces, the two
// photographed door linings, and the windows' bars, whose paint is the colour
// the scan photographed. Nothing else does: the drawn floor, the gilt, the
// brass, the painted mahogany, the windows' outer reveals, the wall bodies'
// other finishes and the dimmed rooms past the doors were tuned under the
// toe, as the furniture was.
//
// The lift is a plain node expression that reads the `filmToe` uniform, so a
// colour gives the toe back when that uniform is in its graph. The walk below
// sees every node built as a plain node, which is how each place that shows a
// photograph builds its colour. It does not see inside a deferred `Fn` body:
// a lift added there would go unnoticed by the "does not" checks.
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

/** A node behind the variable three may store a function's result in (`mix` asks for one). */
function unwrapped(node: Node): Node {
  let inner = node;
  while (inner instanceof VarNode) inner = inner.node;
  return inner;
}

/**
 * A chain of selects as `count` branches, in order: each select's own result,
 * then all that the last of them falls to (which may be a select of its own:
 * a finish's colour is free to be one).
 */
function selectBranches(node: Node, count: number): Node[] {
  const branches: Node[] = [];
  let current = unwrapped(node);
  while (branches.length < count - 1) {
    if (!(current instanceof ConditionalNode) || current.elseNode === null) throw new Error(`the chain of selects ended after ${String(branches.length)} of ${String(count)} branches`);
    branches.push(current.ifNode);
    current = unwrapped(current.elseNode);
  }
  branches.push(current);
  return branches;
}

function dispose(materials: ReadonlyMap<string, Material>): void {
  for (const material of materials.values()) material.dispose();
}

/** The wall bodies' finishes, in the order their material picks them (hall-section.ts createWallBodyMaterial). */
const BODY_FINISHES = ["outer face", "cut's top", "door lining", "window lining", "corner block's top", "bay lining", "bay backing", "cut's upright face"] as const;

describe("which of the hall's materials give the curve's toe back", () => {
  it("the scan's photographs and the bars matched to them do; the drawn floor, the gilt, the brass and the painted mahogany do not", () => {
    const materials = createHallMaterials(textures, new HallPhotos(), new HallMoodUniforms(), new HallSectionUniforms(), null, { glazing: new HallGlazingUniforms() });
    expect([...materials.keys()].sort()).toEqual(["brass", "ceilingPhoto", "domePhoto", "floor", "gilt", "mahoganyDark", "paint", "wallPhoto", "wallPhotoGloss"]);
    expect(liftedKeys(materials)).toEqual(["ceilingPhoto", "domePhoto", "paint", "wallPhoto", "wallPhotoGloss"]);
    dispose(materials);
  });

  it("in the windows' paint the bars do, whose colour the scan photographed, and the outer reveals do not", () => {
    const materials = createHallMaterials(textures, new HallPhotos(), new HallMoodUniforms(), new HallSectionUniforms(), null, { glazing: new HallGlazingUniforms() });
    const paint = materials.get("paint");
    if (!(paint instanceof MeshStandardNodeMaterial) || paint.emissiveNode === null) throw new Error("the windows' paint is not the lit material it was");
    // mix(bars, reveals, outside): the bars inside the glass, the reveals outside it (hall-materials.ts paintSurface).
    const mixed = unwrapped(paint.emissiveNode);
    if (!(mixed instanceof MathNode) || mixed.method !== MathNode.MIX) throw new Error("the windows' paint is no longer a mix of bars and reveals");
    expect(readsToe(mixed.aNode)).toBe(true);
    expect(readsToe(mixed.bNode)).toBe(false);
    dispose(materials);
  });

  it("the door leaves' photographed faces do; their mahogany, their brass and Atelier's card do not", () => {
    const leaves = (card: boolean): ReadonlyMap<string, Material> =>
      createDoorLeafMaterials(textures, new HallPhotos(), new HallMoodUniforms(), new HallSectionUniforms(), new DoorSwingUniforms(), null, { card });
    const room = leaves(false);
    expect([...room.keys()].sort()).toEqual(["brass", "mahoganyDark", "wallPhoto", "wallPhotoGloss"]);
    expect(liftedKeys(room)).toEqual(["wallPhoto", "wallPhotoGloss"]);
    const card = leaves(true);
    expect(liftedKeys(card)).toEqual([]);
    dispose(room);
    dispose(card);
  });

  it("of the wall bodies' finishes only a photographed door lining does, and beside it the plain lining does not", () => {
    const section = new HallSectionUniforms();
    const mood = new HallMoodUniforms();
    /** The finishes of a section's wall bodies that give the toe back, and its photographed lining's two sides. */
    const liftedFinishes = (options: HallSectionOptions, photographed: boolean): { finishes: string[]; lining: [boolean, boolean] | null } => {
      const photos = photographed ? new HallBeyondPhotos() : null;
      const built = createHallSection(section, mood, { textures, beyond: photos, ...options });
      const body = built.materials.body;
      if (!(body instanceof NodeMaterial) || body.colorNode === null) throw new Error("the wall bodies' material has no colour");
      const branches = selectBranches(body.colorNode, BODY_FINISHES.length);
      // The relief's cap over the cut and the plinth are no photograph on any section.
      expect(givesToeBack(built.materials.cap)).toBe(false);
      expect(givesToeBack(built.materials.plinth)).toBe(false);
      const liningAt = BODY_FINISHES.indexOf("door lining");
      const lining = branches[liningAt] === undefined ? null : unwrapped(branches[liningAt]);
      const sides: [boolean, boolean] | null = lining instanceof ConditionalNode ? [readsToe(lining.ifNode), readsToe(lining.elseNode)] : null;
      const finishes = BODY_FINISHES.filter((_, index) => readsToe(branches[index] ?? null));
      built.dispose();
      photos?.dispose();
      return { finishes, lining: sides };
    };
    // Ashlar's end and main doors' linings are the scan's photographs: where a fragment has one it is
    // lifted, and where it has none it takes the plain lining, which is not.
    expect(liftedFinishes({ preset: SECTION_PRESETS.ashlar }, true)).toEqual({ finishes: ["door lining"], lining: [true, false] });
    expect(liftedFinishes({ preset: SECTION_PRESETS.ashlar, sunlit: true, multisampled: true }, true)).toEqual({ finishes: ["door lining"], lining: [true, false] });
    // Without the photographs Ashlar's linings are its plain colour, as the other sections' always are.
    expect(liftedFinishes({ preset: SECTION_PRESETS.ashlar }, false)).toEqual({ finishes: [], lining: null });
    expect(liftedFinishes({ preset: SECTION_PRESETS.atelier }, true)).toEqual({ finishes: [], lining: null });
    expect(liftedFinishes({ preset: SECTION_PRESETS.nocturne }, true)).toEqual({ finishes: [], lining: null });
  });

  it("the dimmed rooms past the doors do not: their floors are held against the hall's drawn floor, which keeps the toe", () => {
    const context = { mood: new HallMoodUniforms(), swing: new DoorSwingUniforms(), section: new HallSectionUniforms(), sun: null };
    const photos = new HallBeyondPhotos();
    const beyond = new Map<string, Material>([
      ["floors", createBeyondFloorMaterial(context, photos)],
      ["solids", createBeyondSolidMaterial(context, textures)],
      ["pools", createBeyondPoolMaterial(context, 1)],
      ["first-floor card", createFirstFloorCardMaterial(context)],
    ]);
    expect(liftedKeys(beyond)).toEqual([]);
    dispose(beyond);
    photos.dispose();
  });
});
