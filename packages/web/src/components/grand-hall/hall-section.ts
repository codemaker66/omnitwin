// ---------------------------------------------------------------------------
// The cutaway's section: the walls as a model maker would cut them
//
// When the planner looks in from above, the walls nearest the camera are cut
// down (GrandHallModel's cutaway). The scanned walls are single surfaces, so
// a cut alone would leave them paper-thin and let the camera see the room
// through their backs. Each wall therefore has a body: an outer skin from the
// floor to the cut, a section cap across its thickness with a fine gilt edge
// on the room side, and the whole room stands on a plinth. The cap and skin
// follow each wall's eased cut height every frame by scale alone.
// ---------------------------------------------------------------------------

import { BoxGeometry, Color, PlaneGeometry, type BufferGeometry, type Material } from "three";
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from "three/webgpu";
import { color, mix, positionWorld, smoothstep, vec3 } from "three/tsl";
import { HALL_HALF_LENGTH, HALL_HALF_WIDTH, HALL_WALLS, type HallWall } from "./hall-spec.js";

/** Thickness of the walls' bodies behind their scanned faces, metres. */
export const SECTION_THICKNESS = 0.62;
/** How far the cap reaches into the room over the scanned relief, metres. */
const CAP_OVERHANG = 0.09;
/** Height of the cap's slab and of the gilt edge, metres. */
const CAP_HEIGHT = 0.035;
const EDGE_SIZE = 0.012;
/** Depth of the plinth under the floor, metres. */
const PLINTH_DEPTH = 0.42;

export interface SectionPiece {
  readonly wall: HallWall;
  /** Unit-high outside face of the wall's body: scaled to the cut height every frame. */
  readonly skin: BufferGeometry;
  readonly cap: BufferGeometry;
  readonly edge: BufferGeometry;
  /** Where the piece's centre sits in plan, and its rotation about y. */
  readonly centre: readonly [number, number];
  readonly rotationY: number;
}

export interface HallSection {
  readonly pieces: readonly SectionPiece[];
  readonly plinth: BufferGeometry;
  readonly materials: { readonly skin: Material; readonly cap: Material; readonly edge: Material; readonly plinth: Material };
  dispose(): void;
}

/** The walls' bodies, caps and the plinth, with their materials. */
export function createHallSection(): HallSection {
  const pieces = HALL_WALLS.map((wall) => {
    // Long enough to meet the neighbouring walls' skins at the corners.
    const length = wall.length + SECTION_THICKNESS * 2;
    // Only the outside face: a body's room side would cover the scanned wall
    // (whose window reveals lie behind the wall's plane). Unit high from the
    // floor, facing away from the room.
    const skin = new PlaneGeometry(length, 1);
    skin.rotateY(Math.PI);
    skin.translate(0, 0.5, -SECTION_THICKNESS / 2);
    const cap = new BoxGeometry(length, CAP_HEIGHT, SECTION_THICKNESS + CAP_OVERHANG);
    // The cap's top sits at the cut; its room side overhangs the relief.
    cap.translate(0, -CAP_HEIGHT / 2, CAP_OVERHANG / 2);
    const edge = new BoxGeometry(wall.length, EDGE_SIZE, EDGE_SIZE);
    edge.translate(0, -EDGE_SIZE / 2, SECTION_THICKNESS / 2 + CAP_OVERHANG - EDGE_SIZE / 2);
    // Centre of the body: halfway along the wall, half its thickness behind it.
    const centre: [number, number] = [
      wall.origin[0] + wall.tangent[0] * wall.length / 2 - wall.normal[0] * SECTION_THICKNESS / 2,
      wall.origin[2] + wall.tangent[2] * wall.length / 2 - wall.normal[2] * SECTION_THICKNESS / 2,
    ];
    // Local x along the wall, local +z into the room.
    const rotationY = Math.atan2(-wall.tangent[2], wall.tangent[0]);
    return { wall, skin, cap, edge, centre, rotationY };
  });

  const plinth = new BoxGeometry(
    (HALL_HALF_LENGTH + SECTION_THICKNESS) * 2 + 0.06,
    PLINTH_DEPTH,
    (HALL_HALF_WIDTH + SECTION_THICKNESS) * 2 + 0.06,
  );
  plinth.translate(0, -PLINTH_DEPTH / 2 - 0.001, 0);

  // The bodies: unlit deep warm ink, a shade lighter toward the cut, so the
  // walls read as solid without drawing the eye from the lit room.
  const skin = new MeshBasicNodeMaterial({ fog: false });
  const lift = smoothstep(0.0, 3.0, positionWorld.y);
  skin.colorNode = mix(vec3(0.006, 0.0045, 0.0035), vec3(0.03, 0.022, 0.016), lift);
  skin.name = "grand-hall-section-skin";
  // The section cap: a lighter warm stone, the cut face of the wall.
  const cap = new MeshStandardNodeMaterial({ roughness: 0.7, metalness: 0 });
  cap.colorNode = color(new Color("#3d2f24"));
  cap.name = "grand-hall-section-cap";
  // A fine gilt line where the cut meets the room.
  const edge = new MeshStandardNodeMaterial({ roughness: 0.28, metalness: 1 });
  edge.colorNode = vec3(0.83, 0.68, 0.38);
  edge.name = "grand-hall-section-edge";
  const plinthMaterial = new MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
  plinthMaterial.colorNode = vec3(0.022, 0.016, 0.012);
  plinthMaterial.name = "grand-hall-plinth";

  return {
    pieces,
    plinth,
    materials: { skin, cap, edge, plinth: plinthMaterial },
    dispose: () => {
      for (const piece of pieces) {
        piece.skin.dispose();
        piece.cap.dispose();
        piece.edge.dispose();
      }
      plinth.dispose();
      skin.dispose();
      cap.dispose();
      edge.dispose();
      plinthMaterial.dispose();
    },
  };
}
