// ---------------------------------------------------------------------------
// The cutaway's section: the walls as a model maker would cut them
//
// When the planner looks in from above, the walls nearest the camera are cut
// down (GrandHallModel's cutaway). The scanned walls are single surfaces, so
// a cut alone would leave them paper-thin and let the camera see the room
// through their backs. Each wall therefore has a body: an outer skin from the
// floor to the cut, a section cap across its thickness with a fine gilt edge
// on the room side, and the whole room stands in a plinth. The cap and skin
// follow each wall's eased cut height every frame by scale alone.
//
// The plinth is a ring round the floor, never a slab under it. A slab a
// millimetre under the oak lost the depth test to it at scattered pixels
// (depth24 with near 0.1 and far 900 leaves only a few depth steps per
// millimetre at 20-30 m), which showed as black specks across the floor
// whenever the camera moved. Its top, at the floor's own level, covers only
// what lies outside the floor: the band under the walls' bodies, which is
// also the floor of the door recesses and the firebox. Its inner edge repeats
// the floor's own edge vertices, so the two meet without a crack, and a strip
// two centimetres down reaches under the floor's edge in case one opens.
// ---------------------------------------------------------------------------

import { BoxGeometry, Color, PlaneGeometry, type BufferGeometry, type Material } from "three";
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from "three/webgpu";
import { color, mix, positionWorld, smoothstep, vec3 } from "three/tsl";
import { MeshBuilder, type V3 } from "./mesh-builder.js";
import { HALL_HALF_LENGTH, HALL_HALF_WIDTH, HALL_WALLS, type HallWall } from "./hall-spec.js";

/** Thickness of the walls' bodies behind their scanned faces, metres. */
export const SECTION_THICKNESS = 0.62;
/** How far the cap reaches into the room over the scanned relief, metres. */
const CAP_OVERHANG = 0.09;
/** Height of the cap's slab and of the gilt edge, metres. */
const CAP_HEIGHT = 0.035;
const EDGE_SIZE = 0.012;
/** How far the plinth's outer faces reach below the floor, metres. */
export const PLINTH_DEPTH = 0.42;
/**
 * The strip under the floor's edge: how far it reaches in from the edge (and
 * out under the ring's top) and how far below the floor it lies. Two
 * centimetres is many depth steps at any distance the planner allows, where
 * the old slab's millimetre was a few.
 */
export const PLINTH_UNDERLAP = { reach: 0.05, drop: 0.02 } as const;
/**
 * The floor's grid cell (hall-geometry.ts, buildFloor), whose edge vertices
 * the ring repeats. The section's tests hold the two together.
 */
const FLOOR_CELL = 0.25;

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

const UP: V3 = [0, 1, 0];

/**
 * A point of the floor's grid, computed as the floor's own builder computes
 * it (MeshBuilder.quad over the corners quadFacing hands it, `s` across the
 * hall and `t` along it), so the ring's inner edge lands on the floor's edge
 * vertices exactly and no T-junction crack can open between them.
 */
function floorGridPoint(s: number, t: number): V3 {
  const p0: V3 = [-HALL_HALF_LENGTH, 0, -HALL_HALF_WIDTH];
  const p1: V3 = [-HALL_HALF_LENGTH, 0, HALL_HALF_WIDTH];
  const p2: V3 = [HALL_HALF_LENGTH, 0, HALL_HALF_WIDTH];
  const p3: V3 = [HALL_HALF_LENGTH, 0, -HALL_HALF_WIDTH];
  const at = (k: 0 | 1 | 2): number => (1 - t) * ((1 - s) * p0[k] + s * p1[k]) + t * ((1 - s) * p3[k] + s * p2[k]);
  return [at(0), at(1), at(2)];
}

/** The floor's edge vertices along one edge: `fixed` holds s or t at 0 or 1 while the other runs. */
function floorEdge(along: "x" | "z", fixed: 0 | 1): V3[] {
  const cells = Math.max(1, Math.ceil((along === "x" ? HALL_HALF_LENGTH : HALL_HALF_WIDTH) * 2 / FLOOR_CELL));
  const points: V3[] = [];
  for (let i = 0; i <= cells; i++) {
    const run = i / cells;
    points.push(along === "x" ? floorGridPoint(fixed, run) : floorGridPoint(run, fixed));
  }
  return points;
}

/** Quads between two polylines of matching stations, each wound to face along `facing`. */
function stripBetween(builder: MeshBuilder, a: readonly V3[], b: readonly V3[], facing: V3): void {
  const uv = (p: V3): readonly [number, number] => (facing[1] !== 0 ? [p[0], p[2]] : [p[0] + p[2], p[1]]);
  for (let i = 0; i + 1 < a.length; i++) {
    const p0 = a[i];
    const p1 = a[i + 1];
    const p2 = b[i + 1];
    const p3 = b[i];
    if (p0 === undefined || p1 === undefined || p2 === undefined || p3 === undefined) continue;
    builder.quadFacing(p0, p1, p2, p3, uv(p0), uv(p1), uv(p2), uv(p3), facing);
  }
}

/** A polyline moved to another height, or another plane across the hall. */
function setAxis(points: readonly V3[], axis: 0 | 1 | 2, value: number): V3[] {
  return points.map((p): V3 => [axis === 0 ? value : p[0], axis === 1 ? value : p[1], axis === 2 ? value : p[2]]);
}

/**
 * The plinth: a ring round the floor whose top lies at the floor's level only
 * outside it, from the room's planes out to the walls' outer faces (their
 * skins, SECTION_THICKNESS behind the planes), with outer faces down to
 * PLINTH_DEPTH and no bottom. Under the floor it has only the underlap, two
 * centimetres down. The walls' outer faces stay inside the city model's
 * cut-out for the hall (|x| <= 11.2, |z| <= 5.95), whose own caps lie at the
 * same level just beyond it, so the ring never meets them either.
 */
export function buildPlinthRing(): BufferGeometry {
  const builder = new MeshBuilder();
  const outerX = HALL_HALF_LENGTH + SECTION_THICKNESS;
  const outerZ = HALL_HALF_WIDTH + SECTION_THICKNESS;

  // The top, in four strips. The long sides run the ring's whole length and
  // take its corners; their inner edges repeat the floor's edge vertices.
  const windowEdge = floorEdge("x", 0);
  const doorEdge = floorEdge("x", 1);
  const fireplaceEdge = floorEdge("z", 0);
  const endEdge = floorEdge("z", 1);
  const longInner = (edge: readonly V3[], z: number): V3[] => [[-outerX, 0, z], ...edge, [outerX, 0, z]];
  const windowInner = longInner(windowEdge, -HALL_HALF_WIDTH);
  const doorInner = longInner(doorEdge, HALL_HALF_WIDTH);
  const windowOuter = setAxis(windowInner, 2, -outerZ);
  const doorOuter = setAxis(doorInner, 2, outerZ);
  const fireplaceOuter = setAxis(fireplaceEdge, 0, -outerX);
  const endOuter = setAxis(endEdge, 0, outerX);
  stripBetween(builder, windowInner, windowOuter, UP);
  stripBetween(builder, doorInner, doorOuter, UP);
  stripBetween(builder, fireplaceEdge, fireplaceOuter, UP);
  stripBetween(builder, endEdge, endOuter, UP);

  // The outer faces, from the top's own outer edges down, so the two share
  // every vertex along the ring's rim.
  const fireplaceRim: V3[] = [[-outerX, 0, -outerZ], ...fireplaceOuter, [-outerX, 0, outerZ]];
  const endRim: V3[] = [[outerX, 0, -outerZ], ...endOuter, [outerX, 0, outerZ]];
  const sides: readonly (readonly [readonly V3[], V3])[] = [
    [windowOuter, [0, 0, -1]],
    [doorOuter, [0, 0, 1]],
    [fireplaceRim, [-1, 0, 0]],
    [endRim, [1, 0, 0]],
  ];
  for (const [rim, outward] of sides) stripBetween(builder, rim, setAxis(rim, 1, -PLINTH_DEPTH), outward);

  // The underlap: a frame two centimetres down, from inside the floor's edge
  // to under the ring's top, so a ray through a crack at the edge, from
  // either side, meets the slab rather than the void.
  const { reach, drop } = PLINTH_UNDERLAP;
  const inX = HALL_HALF_LENGTH - reach;
  const inZ = HALL_HALF_WIDTH - reach;
  const outX = HALL_HALF_LENGTH + reach;
  const outZ = HALL_HALF_WIDTH + reach;
  const y = -drop;
  for (const sign of [-1, 1]) {
    stripBetween(builder, [[-outX, y, sign * inZ], [outX, y, sign * inZ]], [[-outX, y, sign * outZ], [outX, y, sign * outZ]], UP);
    stripBetween(builder, [[sign * inX, y, -inZ], [sign * inX, y, inZ]], [[sign * outX, y, -inZ], [sign * outX, y, inZ]], UP);
  }

  const geometry = builder.build();
  geometry.name = "grand-hall-plinth-ring";
  return geometry;
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

  const plinth = buildPlinthRing();

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
