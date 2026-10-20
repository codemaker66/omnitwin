// ---------------------------------------------------------------------------
// The hall's doors: modelled leaves that swing open in the cutaway
//
// Four doorways (HALL_DOORS): the end door into the Saloon, the main door,
// the fireplace door (all in the door wall) and the fire exit in the
// fireplace wall. Each is a pair of 45 mm leaves hung at the hall face that
// open outward, into the opening's sides, as the 2010 plan's swing arcs and
// the panoramas show (048: the end door's leaves folded back against its
// reveals; 018: the main door's); the end door has a third, single leaf at
// the Saloon face, hinged on the end wall's side and opening into the Saloon.
//
// When a wall is cut (the near walls in the overview, every wall in Plan) its
// doors swing 90 degrees open on a spring, and the doorway reads through the
// wall's whole depth; on a walk they stay shut, as photographed. The swing
// happens in the vertex shader about each leaf's hinge (doorLeafPosition):
// nothing moves on the CPU, and the frame loop runs only while a door moves.
//
// The leaves the wall atlas photographed shut (the end, fireplace and fire
// exit doors) wear those photographs on their hall faces, at the texels of
// their closed position, glossy below the dado's top and matte above it as
// the relief they replace (cut out of the drawn relief: hall-walls.ts
// drawnRelief), so on a walk the doors look as before. The main door stood
// open in the scan, so its leaves are drawn mahogany, as are every leaf's
// edges and back and the Saloon leaf; its panels' sunk margins carry a baked
// occlusion (the photographs hold their own). The joinery (rails, stiles and
// raised and fielded panels, the closers and the fire exit's panic bar) is
// measured on the atlas at 1 cm (20 October 2026; the Saloon leaf from
// panorama 048, the main door's panels as its twins'). Each leaf's face
// plate laps 3 mm behind its jamb and the first leaf of a pair laps over the
// second's edge, so a shut door shows no slit; that leaf trails its pair by
// LEAF_LAG as it swings, as a pair with an astragal must, and open every leaf
// stands 6 mm clear of its lining.
// ---------------------------------------------------------------------------

import type { BufferGeometry } from "three";
import type { Node } from "three/webgpu";
import { Fn, attribute, cos, max, min, normalLocal, positionLocal, positionPrevious, positionWorld, sin, uniform, vec3 } from "three/tsl";
import { HallBuilders, type HallGeometryStats, type HallHinge, type HallMaterialKey } from "./hall-builders.js";
import type { HallSectionUniforms } from "./hall-materials.js";
import { THRESHOLD_HEIGHT } from "./hall-wall-body.js";
import { SPRING_PRESETS, isSpringSettled, stepSpring, type SpringState } from "../../lib/springs.js";
import { HALL_DOORS, HALL_ELEVATION, HALL_OPENINGS, HALL_WALLS, wallPoint, type HallDoor, type HallOpening, type HallWall } from "./hall-spec.js";
import type { V3 } from "./mesh-builder.js";
import { wallMaterial } from "./hall-walls.js";

/** Where the wall's photographs turn from glossy (the dado) to matte (hall-walls.ts isPanelling). */
const PANELLING_TOP = HALL_ELEVATION.dadoTop + 0.02;

/** A leaf's thickness. */
export const LEAF_THICKNESS = 0.045;
/** Its face plate, which laps over the slit at its jamb (and, on a pair's first leaf, the meeting). */
export const LEAF_PLATE = 0.003;
/** From the jamb's line to the leaf's hinge edge: how far it stands clear of its lining once open. */
export const HINGE_CLEARANCE = 0.006;
/** How far the face plate reaches behind the jamb's line, so a shut leaf shows no slit. */
export const JAMB_LAP = 0.003;
/** The joint between a pair's leaves, and how far the first leaf's plate laps over the second. */
export const MEETING_GAP = 0.003;
export const MEETING_LAP = 0.012;
/** The second leaf of a pair stands this far behind the first, so the lap clears its face. */
export const SECOND_LEAF_SET = 0.004;
/** The Saloon leaf's face stands this far inside the wall's far face. */
export const FAR_LEAF_SET = 0.003;
/** A leaf's foot: clear of the oak threshold (THRESHOLD_HEIGHT) by 2.5 mm. */
export const LEAF_FOOT = THRESHOLD_HEIGHT + 0.0025;
/** How far a door opens. */
export const DOOR_OPEN_ANGLE = Math.PI / 2;
/** A wall counts as cut, and its doors open, once its cut lies below this (the walls stand 6.70 m). */
export const DOOR_OPEN_CUT = 6.69;
/** Added to a door's index in an aHinge code on the faces a cut lays across the leaf (its section). */
export const LEAF_CAP_CODE = 4;
/** Added again on the first leaf of a pair, whose face plate laps over the second's edge: it trails (LEAF_LAG). */
export const LEAF_LAG_CODE = 8;
/**
 * How far the lapping leaf of a pair trails its door's angle (radians), as a
 * pair with an astragal must open: the second leaf leads, so the first's lap
 * never sweeps through it, and the first closes last, over it. It catches up
 * at the open angle (leafAngle).
 */
export const LEAF_LAG = (12 * Math.PI) / 180;

/** Raised and fielded panels: the margin sunk behind the face, the field nearly flush, the bevel between. */
export const PANEL_SINK = 0.01;
export const PANEL_FIELD = 0.002;
export const PANEL_BEVEL = 0.03;
/**
 * A modelled panel's margin, sunk PANEL_SINK, sees only part of the room's
 * light: its baked occlusion falls by this much at the bottom of the sink,
 * shading each bevel from its margin up to its field as the photographed
 * leaves' panels are shaded (the photographs hold their own).
 */
export const PANEL_GROOVE_OCCLUSION = 0.4;

/** A rectangle on a leaf's face, wall-local u and height v. */
export interface LeafRect {
  readonly u0: number;
  readonly u1: number;
  readonly v0: number;
  readonly v1: number;
}

/** A box standing proud of a leaf's face (a closer, a panic bar, a moulding, a finger plate). */
export interface LeafFitting extends LeafRect {
  readonly proud: number;
  /** Its front wears the photograph (the atlas has it); its other faces take `key`. */
  readonly photoFront: boolean;
  readonly key: HallMaterialKey;
}

/** One leaf, shut, in its wall's frame (u along the wall, v up, depth into the room). */
export interface HallDoorLeaf {
  /** Indices in HALL_DOORS, HALL_OPENINGS and HALL_WALLS. */
  readonly door: number;
  readonly opening: number;
  readonly wall: number;
  /** +1: hinged at its lower-u edge (it reaches toward +u); -1: at its upper-u edge. */
  readonly sense: 1 | -1;
  /** The core's two edges: at the hinge, and free. */
  readonly hingeU: number;
  readonly freeU: number;
  /** The face plate's extent along the wall (low, high u). */
  readonly plateU0: number;
  readonly plateU1: number;
  /** Depth of the face toward the hall, and of the other face (negative: behind the wall's plane). */
  readonly face: number;
  readonly back: number;
  readonly foot: number;
  readonly top: number;
  /** The face toward the hall wears the wall atlas's photograph. */
  readonly photographed: boolean;
  /** The Saloon face's leaf (the end door's), which opens into the Saloon. */
  readonly far: boolean;
  readonly panels: readonly LeafRect[];
  readonly fittings: readonly LeafFitting[];
  /** Knobs: (u, v) on the face. */
  readonly knobs: readonly (readonly [number, number])[];
}

/** Rows of panels on the end door's leaves, measured on the atlas (v from, to). */
const THREE_PANEL_ROWS: readonly (readonly [number, number])[] = [[0.195, 0.705], [0.94, 1.705], [1.88, 2.158]];

/**
 * Joinery per doorway, measured on the 4096 wall atlas at 1 cm (u along the
 * wall): each leaf's panel column (first leaf, second leaf), the rows, and
 * the hardware. The end and fireplace doors: three panels a leaf, overhead
 * closers on the top rail (v 2.16-2.24, 4 cm proud in the relief). The fire
 * exit: two panels a leaf (the atlas shows two, not the three first noted)
 * and a panic bar across both at 0.915-0.985 m, 3 cm proud. The main door,
 * open in the scan: its twins' stiles and rows, a knob and a finger plate on
 * each leaf (panorama 018), in mahogany and brass.
 */
interface DoorJoinery {
  readonly columns: readonly [readonly [number, number], readonly [number, number]];
  readonly rows: readonly (readonly [number, number])[];
  readonly closers: readonly [readonly [number, number], readonly [number, number]] | null;
  readonly panicBar: boolean;
  readonly modelledHardware: boolean;
}

/** The main door's panel columns: the end door's stiles (0.09 m at the hinge, 0.11 m at the meeting). */
function mainDoorColumns(): readonly [readonly [number, number], readonly [number, number]] {
  const door = HALL_DOORS.find((entry) => entry.opening === "door-main");
  const opening = HALL_OPENINGS.find((entry) => entry.id === "door-main");
  if (door === undefined || opening === undefined) throw new Error("No main door");
  const u0 = opening.centre - opening.width / 2 + HINGE_CLEARANCE;
  const u1 = opening.centre + opening.width / 2 - HINGE_CLEARANCE;
  return [[u0 + 0.09, door.meeting - MEETING_GAP / 2 - 0.11], [door.meeting + MEETING_GAP / 2 + 0.11, u1 - 0.09]];
}

const JOINERY: Readonly<Record<string, DoorJoinery>> = {
  "door-end": { columns: [[1.274, 1.619], [1.848, 2.202]], rows: THREE_PANEL_ROWS, closers: [[1.253, 1.529], [1.934, 2.228]], panicBar: false, modelledHardware: false },
  "door-main": { columns: mainDoorColumns(), rows: THREE_PANEL_ROWS, closers: null, panicBar: false, modelledHardware: true },
  "door-fireplace": { columns: [[18.962, 19.307], [19.536, 19.888]], rows: [[0.195, 0.705], [0.93, 1.7], [1.88, 2.16]], closers: [[18.936, 19.212], [19.617, 19.91]], panicBar: false, modelledHardware: false },
  "door-fire-exit": { columns: [[8.074, 8.47], [8.57, 8.967]], rows: [[0.26, 1.665], [1.76, 1.87]], closers: null, panicBar: true, modelledHardware: false },
};

/** The Saloon leaf (panorama 048): two columns of two panels under and over a projecting lock rail. */
const SALOON_LEAF = { stile: 0.11, muntin: 0.1, rows: [[0.2, 0.8], [1.12, 2.12]], rail: [0.86, 0.98], railProud: 0.025 } as const;

function openingOf(door: HallDoor): { opening: HallOpening; index: number; wall: number } {
  const index = HALL_OPENINGS.findIndex((candidate) => candidate.id === door.opening);
  const opening = HALL_OPENINGS[index];
  if (opening === undefined) throw new Error(`No opening ${door.opening}`);
  const wall = HALL_WALLS.findIndex((candidate) => candidate.id === opening.wall);
  return { opening, index, wall };
}

function panelGrid(columns: readonly (readonly [number, number])[], rowList: readonly (readonly [number, number])[]): LeafRect[] {
  return columns.flatMap(([u0, u1]) => rowList.map(([v0, v1]) => ({ u0, u1, v0, v1 })));
}

/** Every leaf of every door, shut. */
function planLeaves(): HallDoorLeaf[] {
  const leaves: HallDoorLeaf[] = [];
  HALL_DOORS.forEach((door, doorIndex) => {
    const { opening, index, wall } = openingOf(door);
    const joinery = JOINERY[door.opening];
    if (joinery === undefined) throw new Error(`No joinery for ${door.opening}`);
    const u0 = opening.centre - opening.width / 2;
    const u1 = opening.centre + opening.width / 2;
    const meetLow = door.meeting - MEETING_GAP / 2;
    const meetHigh = door.meeting + MEETING_GAP / 2;
    const top = door.leafTop;
    const fittings = (leaf: 0 | 1, lowU: number, highU: number): LeafFitting[] => {
      const out: LeafFitting[] = [];
      const closer = joinery.closers?.[leaf];
      if (closer !== undefined) out.push({ u0: closer[0], u1: closer[1], v0: 2.16, v1: 2.24, proud: 0.04, photoFront: door.photographed, key: "brass" });
      if (joinery.panicBar) out.push({ u0: lowU, u1: highU, v0: 0.915, v1: 0.985, proud: 0.03, photoFront: door.photographed, key: "brass" });
      if (joinery.modelledHardware) {
        // A finger plate beside the meeting, 2 mm proud (the end door's: 7.8 by 46 cm from 0.92 m).
        const [p0, p1] = leaf === 0 ? [door.meeting - 0.09, door.meeting - 0.012] : [door.meeting + 0.02, door.meeting + 0.098];
        out.push({ u0: p0, u1: p1, v0: 0.916, v1: 1.372, proud: 0.002, photoFront: false, key: "brass" });
      }
      return out;
    };
    const knobs = (leaf: 0 | 1): (readonly [number, number])[] => (joinery.modelledHardware ? [[leaf === 0 ? door.meeting - 0.12 : door.meeting + 0.12, 0.83]] : []);
    // The first leaf (lower u): hinged at u0, its plate lapping the jamb and the meeting.
    leaves.push({
      door: doorIndex, opening: index, wall, sense: 1,
      hingeU: u0 + HINGE_CLEARANCE, freeU: meetLow, plateU0: u0 - JAMB_LAP, plateU1: meetHigh + MEETING_LAP,
      face: door.leafFace, back: door.leafFace - LEAF_THICKNESS, foot: LEAF_FOOT, top, photographed: door.photographed, far: false,
      panels: panelGrid([joinery.columns[0]], joinery.rows),
      fittings: fittings(0, u0 + 0.01, meetHigh + MEETING_LAP), knobs: knobs(0),
    });
    // The second leaf: hinged at u1, a few millimetres behind the first so its lap clears.
    const second = door.leafFace - SECOND_LEAF_SET;
    leaves.push({
      door: doorIndex, opening: index, wall, sense: -1,
      hingeU: u1 - HINGE_CLEARANCE, freeU: meetHigh, plateU0: meetHigh, plateU1: u1 + JAMB_LAP,
      face: second, back: second - LEAF_THICKNESS, foot: LEAF_FOOT, top, photographed: door.photographed, far: false,
      panels: panelGrid([joinery.columns[1]], joinery.rows),
      // Its fittings clear the first leaf's lap by 8 mm: the panic bar's end swings 5 mm toward it as the leaf opens.
      fittings: fittings(1, meetHigh + MEETING_LAP + 0.008, u1 - 0.01), knobs: knobs(1),
    });
    if (door.farLeaf !== null) {
      // The Saloon face's single leaf, hinged on the end wall's side (lower u on the door wall).
      const hingeU = u0 + HINGE_CLEARANCE;
      const freeU = u1 - HINGE_CLEARANCE;
      const back = -door.depth + FAR_LEAF_SET;
      const mid = (hingeU + freeU) / 2;
      const columns: (readonly [number, number])[] = [[hingeU + SALOON_LEAF.stile, mid - SALOON_LEAF.muntin / 2], [mid + SALOON_LEAF.muntin / 2, freeU - SALOON_LEAF.stile]];
      leaves.push({
        door: doorIndex, opening: index, wall, sense: 1,
        hingeU, freeU, plateU0: hingeU, plateU1: freeU,
        face: back + LEAF_THICKNESS, back, foot: LEAF_FOOT, top, photographed: false, far: true,
        panels: panelGrid(columns, SALOON_LEAF.rows),
        fittings: [{ u0: hingeU + 0.02, u1: freeU - 0.02, v0: SALOON_LEAF.rail[0], v1: SALOON_LEAF.rail[1], proud: SALOON_LEAF.railProud, photoFront: false, key: "mahoganyDark" }],
        knobs: [[freeU - 0.07, 0.95]],
      });
    }
  });
  return leaves;
}

export const HALL_DOOR_LEAVES: readonly HallDoorLeaf[] = planLeaves();

/**
 * The hinge a leaf turns about: at its hinge edge, on the face it opens
 * toward (its back), so open it lies against the plane of that edge,
 * HINGE_CLEARANCE inside the jamb.
 */
export function leafHinge(leaf: HallDoorLeaf, cap = false): HallHinge {
  const wall = HALL_WALLS[leaf.wall];
  if (wall === undefined) throw new Error(`No wall ${String(leaf.wall)}`);
  const p = wallPoint(wall, leaf.hingeU, 0, leaf.back);
  return { x: p[0], z: p[2], sense: leaf.sense, code: leaf.door + (cap ? LEAF_CAP_CODE : 0) + (leafLaps(leaf) ? LEAF_LAG_CODE : 0) };
}

/** Whether a leaf's face plate laps over its pair's (the first leaf of a pair). */
export function leafLaps(leaf: HallDoorLeaf): boolean {
  return !leaf.far && leaf.sense === 1;
}

/** An aHinge code's parts: the door (HALL_DOORS index), the section a cut lays on the leaf, the lapping leaf. */
export function decodeHinge(code: number): { readonly door: number; readonly cap: boolean; readonly lag: boolean } {
  const lag = code > LEAF_LAG_CODE - 0.5;
  const rest = lag ? code - LEAF_LAG_CODE : code;
  const cap = rest > LEAF_CAP_CODE - 0.5;
  return { door: Math.round(cap ? rest - LEAF_CAP_CODE : rest), cap, lag };
}

/** A leaf's angle at its door's `angle` (the shader's rule): the lapping leaf trails by LEAF_LAG and is open with it. */
export function leafAngle(angle: number, lag: boolean): number {
  if (!lag) return angle;
  return Math.min(angle, Math.max(0, ((angle - LEAF_LAG) * DOOR_OPEN_ANGLE) / (DOOR_OPEN_ANGLE - LEAF_LAG)));
}

/**
 * A point turned about a hinge by `angle` radians (the shader's rule): about
 * +y by sense x angle. Every wall's (tangent, normal) frame is the window
 * wall's turned about +y, so in each wall's frame this carries a leaf's free
 * edge from along the wall to straight behind it.
 */
export function swingPoint(p: V3, hinge: HallHinge, angle: number): V3 {
  const a = hinge.sense * angle;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dx = p[0] - hinge.x;
  const dz = p[2] - hinge.z;
  return [hinge.x + dx * c + dz * s, p[1], hinge.z - dx * s + dz * c];
}

/** A direction turned as swingPoint turns points. */
export function swingDirection(n: V3, hinge: HallHinge, angle: number): V3 {
  const a = hinge.sense * angle;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [n[0] * c + n[2] * s, n[1], -n[0] * s + n[2] * c];
}

/**
 * Where a leaf's vertex stands for its wall's cut and its door's angle (the
 * shader's rule, doorLeafPosition): turned about its hinge; a cap vertex (the
 * section a cut lays across the leaf) at the cut, and gone (null) unless the
 * cut lies below it and above the floor. Fragments above the cut are
 * discarded (doorLeafMask).
 */
export function leafVertex(p: V3, hinge: HallHinge, cut: number, angle: number): V3 | null {
  const { cap, lag } = decodeHinge(hinge.code);
  if (cap && (cut >= p[1] - 1e-4 || cut <= 0.01)) return null;
  return swingPoint(cap ? [p[0], cut, p[2]] : p, hinge, leafAngle(angle, lag));
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

type Facing = "room" | "away" | "low" | "high" | "up" | "down";

/** Writes one leaf's faces in its wall's frame. */
class LeafWriter {
  private readonly wall: HallWall;

  constructor(private readonly hb: HallBuilders, leaf: HallDoorLeaf) {
    const wall = HALL_WALLS[leaf.wall];
    if (wall === undefined) throw new Error(`No wall ${String(leaf.wall)}`);
    this.wall = wall;
  }

  private direction(facing: Facing): V3 {
    const { normal, tangent } = this.wall;
    switch (facing) {
      case "room": return [normal[0], 0, normal[2]];
      case "away": return [-normal[0], 0, -normal[2]];
      case "low": return [-tangent[0], 0, -tangent[2]];
      case "high": return [tangent[0], 0, tangent[2]];
      case "up": return [0, 1, 0];
      case "down": return [0, -1, 0];
    }
  }

  /**
   * An axis-aligned rectangle in the wall's frame: across u (a) and v (b) at
   * a depth ("room", "away"), across depth (a) and v (b) at a u ("low",
   * "high"), or across u (a) and depth (b) at a height ("up", "down"). Its uv
   * is metres across it (the wood's grain; photographs take aAtlas).
   */
  rect(key: HallMaterialKey, facing: Facing, a0: number, a1: number, b0: number, b1: number, at: number): void {
    if (Math.abs(a1 - a0) < 1e-6 || Math.abs(b1 - b0) < 1e-6) return;
    const P = (a: number, b: number): V3 => {
      if (facing === "room" || facing === "away") return wallPoint(this.wall, a, b, at);
      if (facing === "low" || facing === "high") return wallPoint(this.wall, at, b, a);
      return wallPoint(this.wall, a, at, b);
    };
    this.hb.get(key).quadFacing(P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b1), [a0, b0], [a1, b0], [a1, b1], [a0, b1], this.direction(facing));
  }

  /** A quad from four wall-frame (u, v, depth) corners, facing along a wall-frame (u, v, depth) direction. */
  quad(key: HallMaterialKey, corners: readonly (readonly [number, number, number])[], facing: readonly [number, number, number]): void {
    const [a, b, c, d] = corners.map(([u, v, depth]) => wallPoint(this.wall, u, v, depth));
    const [ua, ub, uc, ud] = corners.map(([u, v]): [number, number] => [u, v]);
    if (a === undefined || b === undefined || c === undefined || d === undefined) return;
    if (ua === undefined || ub === undefined || uc === undefined || ud === undefined) return;
    const { normal, tangent } = this.wall;
    const world: V3 = [tangent[0] * facing[0] + normal[0] * facing[2], facing[1], tangent[2] * facing[0] + normal[2] * facing[2]];
    this.hb.get(key).quadFacing(a, b, c, d, ua, ub, uc, ud, world);
  }

  /** Runs `emit` with each vertex's baked occlusion falling with its depth behind `face` (a panel's sunk margin). */
  grooves(face: number, emit: () => void): void {
    const { origin, normal } = this.wall;
    this.hb.withOcclusion((p) => {
      const depth = (p[0] - origin[0]) * normal[0] + (p[2] - origin[2]) * normal[2];
      return 1 - PANEL_GROOVE_OCCLUSION * Math.min(1, Math.max(0, (face - depth) / PANEL_SINK));
    }, emit);
  }

  /** A round knob on the face, its back sunk a few millimetres into it. */
  knob(u: number, v: number, depth: number, radius: number): void {
    this.hb.get("brass").lathe(wallPoint(this.wall, u, v, depth), [[0, -radius], [radius * 0.85, -radius * 0.85], [radius, 0], [radius * 0.85, radius * 0.85], [0, radius]], 10);
  }
}

/** Sorted unique values. */
function breakpoints(values: readonly number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const value of sorted) if (out.length === 0 || value - (out[out.length - 1] ?? 0) > 1e-6) out.push(value);
  return out;
}

/**
 * The face toward the hall: its plate's whole extent less its panels, which
 * are raised and fielded. `key` gives each part's material by its height (a
 * photographed leaf's face is glossy where the wall's is, below the dado's
 * top, and matte above it, as its relief was, so a walk sees it as before).
 */
function buildFace(w: LeafWriter, leaf: HallDoorLeaf, key: (v: number) => HallMaterialKey): void {
  const us = breakpoints([leaf.plateU0, leaf.plateU1, ...leaf.panels.flatMap((p) => [p.u0, p.u1])]);
  const glossTop = PANELLING_TOP > leaf.foot && PANELLING_TOP < leaf.top ? [PANELLING_TOP] : [];
  const vs = breakpoints([leaf.foot, leaf.top, ...glossTop, ...leaf.panels.flatMap((p) => [p.v0, p.v1])]);
  for (let i = 0; i + 1 < us.length; i++) {
    for (let j = 0; j + 1 < vs.length; j++) {
      const u0 = us[i] ?? 0;
      const u1 = us[i + 1] ?? 0;
      const v0 = vs[j] ?? 0;
      const v1 = vs[j + 1] ?? 0;
      const mu = (u0 + u1) / 2;
      const mv = (v0 + v1) / 2;
      if (leaf.panels.some((p) => mu > p.u0 && mu < p.u1 && mv > p.v0 && mv < p.v1)) continue;
      w.rect(key(mv), "room", u0, u1, v0, v1, leaf.face);
    }
  }
  for (const panel of leaf.panels) {
    const build = (): void => { buildPanel(w, leaf.face, panel, key((panel.v0 + panel.v1) / 2)); };
    if (leaf.photographed) build();
    else w.grooves(leaf.face, build);
  }
}

/** A raised and fielded panel: its margin sunk PANEL_SINK, rising over PANEL_BEVEL to a field PANEL_FIELD behind the face. */
function buildPanel(w: LeafWriter, face: number, p: LeafRect, key: HallMaterialKey): void {
  const sunk = face - PANEL_SINK;
  const field = face - PANEL_FIELD;
  const b = Math.min(PANEL_BEVEL, (p.u1 - p.u0) / 3, (p.v1 - p.v0) / 3);
  const f = { u0: p.u0 + b, u1: p.u1 - b, v0: p.v0 + b, v1: p.v1 - b };
  // The stiles' and rails' inner edges, down to the margin.
  w.rect(key, "high", sunk, face, p.v0, p.v1, p.u0);
  w.rect(key, "low", sunk, face, p.v0, p.v1, p.u1);
  w.rect(key, "up", p.u0, p.u1, sunk, face, p.v0);
  w.rect(key, "down", p.u0, p.u1, sunk, face, p.v1);
  // The bevels, each leaning toward its own edge, and the field.
  const rise = field - sunk;
  const lean = (du: number, dv: number): [number, number, number] => {
    const l = Math.hypot(du * rise, dv * rise, b);
    return [(du * rise) / l, (dv * rise) / l, b / l];
  };
  w.quad(key, [[p.u0, p.v0, sunk], [p.u1, p.v0, sunk], [f.u1, f.v0, field], [f.u0, f.v0, field]], lean(0, -1));
  w.quad(key, [[f.u0, f.v1, field], [f.u1, f.v1, field], [p.u1, p.v1, sunk], [p.u0, p.v1, sunk]], lean(0, 1));
  w.quad(key, [[p.u0, p.v0, sunk], [f.u0, f.v0, field], [f.u0, f.v1, field], [p.u0, p.v1, sunk]], lean(-1, 0));
  w.quad(key, [[f.u1, f.v0, field], [p.u1, p.v0, sunk], [p.u1, p.v1, sunk], [f.u1, f.v1, field]], lean(1, 0));
  w.rect(key, "room", f.u0, f.u1, f.v0, f.v1, field);
}

/** A fitting's sides (its front is written with the face it belongs to). */
function buildFittingSides(w: LeafWriter, face: number, fitting: LeafFitting): void {
  const front = face + fitting.proud;
  w.rect(fitting.key, "up", fitting.u0, fitting.u1, face, front, fitting.v1);
  w.rect(fitting.key, "down", fitting.u0, fitting.u1, face, front, fitting.v0);
  w.rect(fitting.key, "low", face, front, fitting.v0, fitting.v1, fitting.u0);
  w.rect(fitting.key, "high", face, front, fitting.v0, fitting.v1, fitting.u1);
}

/** One leaf: its face, the edges and back of its slab, its top, the section a cut lays on it, and its fittings. */
function buildLeaf(hb: HallBuilders, leaf: HallDoorLeaf): void {
  const w = new LeafWriter(hb, leaf);
  const wood: HallMaterialKey = "mahoganyDark";
  const photo = (v: number): HallMaterialKey => (leaf.photographed ? wallMaterial(v) : wood);
  const coreLow = Math.min(leaf.hingeU, leaf.freeU);
  const coreHigh = Math.max(leaf.hingeU, leaf.freeU);
  const plateBack = leaf.face - LEAF_PLATE;
  const { foot, top } = leaf;
  hb.withRole(leaf.photographed ? "wall" : "detail", () => {
    buildFace(w, leaf, photo);
    for (const fitting of leaf.fittings.filter((entry) => entry.photoFront)) {
      w.rect(photo((fitting.v0 + fitting.v1) / 2), "room", fitting.u0, fitting.u1, fitting.v0, fitting.v1, leaf.face + fitting.proud);
    }
  });
  hb.withRole("detail", () => {
    // The plate's ends, and its underside where it laps past the core.
    w.rect(wood, "low", plateBack, leaf.face, foot, top, leaf.plateU0);
    w.rect(wood, "high", plateBack, leaf.face, foot, top, leaf.plateU1);
    if (leaf.plateU0 < coreLow - 1e-6) w.rect(wood, "away", leaf.plateU0, coreLow, foot, top, plateBack);
    if (leaf.plateU1 > coreHigh + 1e-6) w.rect(wood, "away", coreHigh, leaf.plateU1, foot, top, plateBack);
    // The core's edges behind the plate, and its back.
    w.rect(wood, "low", leaf.back, plateBack, foot, top, coreLow);
    w.rect(wood, "high", leaf.back, plateBack, foot, top, coreHigh);
    w.rect(wood, "away", coreLow, coreHigh, foot, top, leaf.back);
    // The top: the plate's and the core's.
    w.rect(wood, "up", leaf.plateU0, leaf.plateU1, plateBack, leaf.face, top);
    w.rect(wood, "up", coreLow, coreHigh, leaf.back, plateBack, top);
    for (const fitting of leaf.fittings) {
      if (!fitting.photoFront) w.rect(fitting.key, "room", fitting.u0, fitting.u1, fitting.v0, fitting.v1, leaf.face + fitting.proud);
      buildFittingSides(w, leaf.face, fitting);
    }
    for (const [u, v] of leaf.knobs) w.knob(u, v, leaf.face + 0.022, 0.026);
  });
  // The section a cut lays across the leaf: its top's outline, moved to the cut in the shader.
  hb.withHinge(leafHinge(leaf, true), () => {
    hb.withRole("detail", () => {
      w.rect(wood, "up", leaf.plateU0, leaf.plateU1, plateBack, leaf.face, top);
      w.rect(wood, "up", coreLow, coreHigh, leaf.back, plateBack, top);
    });
  });
}

/** Every door's leaves, shut, into `hb` (which must carry hinges: `{ hinge: true }`). */
export function buildDoorLeaves(hb: HallBuilders): void {
  for (const leaf of HALL_DOOR_LEAVES) {
    hb.onWall(leaf.wall, () => {
      hb.withOpening(leaf.opening, () => {
        hb.withHinge(leafHinge(leaf), () => { buildLeaf(hb, leaf); });
      });
    });
  }
}

export interface HallDoorGeometry {
  readonly geometries: ReadonlyMap<HallMaterialKey, BufferGeometry>;
  readonly stats: HallGeometryStats;
}

/** The leaves as one geometry per material. */
export function buildHallDoorGeometry(): HallDoorGeometry {
  const hb = new HallBuilders({ hinge: true });
  buildDoorLeaves(hb);
  return hb.build();
}

let cachedDoors: HallDoorGeometry | null = null;

/** The leaves, built on first use and shared by every canvas: they never change (the shader swings them). */
export function hallDoorGeometry(): HallDoorGeometry {
  cachedDoors ??= buildHallDoorGeometry();
  return cachedDoors;
}

// ---------------------------------------------------------------------------
// The swing
// ---------------------------------------------------------------------------

/** HALL_WALLS index of each door's wall, in HALL_DOORS order. */
export const DOOR_WALLS: readonly number[] = HALL_DOORS.map((door) => openingOf(door).wall);

/** Where a door is headed: open while its wall is cut (never on a walk), shut otherwise. */
export function doorTarget(cut: number, walk: boolean): number {
  return !walk && cut < DOOR_OPEN_CUT ? DOOR_OPEN_ANGLE : 0;
}

/**
 * Each door's angle on its spring (SPRING_PRESETS.doorSwing), stepped from
 * its wall's cut. Under reduced motion a door is at its target in the frame
 * its target changes.
 */
export class DoorSwing {
  readonly springs: SpringState[] = HALL_DOORS.map(() => ({ value: 0, velocity: 0 }));

  /**
   * Advances every door by `delta` seconds toward its target; returns whether
   * any still moves. `reducedMotion` is asked only while a door is away from
   * its target.
   */
  step(cuts: readonly number[], walk: boolean, delta: number, reducedMotion: () => boolean): boolean {
    let moving = false;
    let reduced: boolean | null = null;
    this.springs.forEach((spring, door) => {
      const target = doorTarget(cuts[DOOR_WALLS[door] ?? -1] ?? Number.POSITIVE_INFINITY, walk);
      if (spring.value === target && spring.velocity === 0) return;
      reduced ??= reducedMotion();
      if (reduced) {
        spring.value = target;
        spring.velocity = 0;
        return;
      }
      stepSpring(spring, target, delta, SPRING_PRESETS.doorSwing);
      if (isSpringSettled(spring, target)) {
        spring.value = target;
        spring.velocity = 0;
        return;
      }
      moving = true;
    });
    return moving;
  }

  angle(door: number): number {
    return this.springs[door]?.value ?? 0;
  }
}

/** The doors' angles in the shader (HALL_DOORS order): this frame's, and the last drawn frame's for the motion vectors. */
export class DoorSwingUniforms {
  readonly angles = HALL_DOORS.map(() => uniform(0));
  readonly previous = HALL_DOORS.map(() => uniform(0));

  /** Sets this frame's angles, keeping the last frame's for the motion vectors. */
  set(angleOf: (door: number) => number): void {
    this.angles.forEach((node, door) => {
      const before = this.previous[door];
      if (before !== undefined) before.value = node.value;
      node.value = angleOf(door);
    });
  }

  /** Shuts every door at once, with no motion (the room's captured reflections); returns the angles to restore. */
  shut(): number[] {
    const was = this.angles.map((node) => node.value);
    for (const node of [...this.angles, ...this.previous]) node.value = 0;
    return was;
  }

  /** Puts back angles `shut` returned, still. */
  restore(angles: readonly number[]): void {
    this.angles.forEach((node, door) => {
      const value = angles[door] ?? 0;
      node.value = value;
      const before = this.previous[door];
      if (before !== undefined) before.value = value;
    });
  }

  /** This frame's angles. */
  values(): number[] {
    return this.angles.map((node) => node.value);
  }
}

/** A leaf vertex's wall's cut (HALL_WALLS order). */
export function doorLeafCut(section: HallSectionUniforms): Node<"float"> {
  const wall = attribute("aWall", "float");
  const [c0, c1, c2, c3] = section.cuts;
  return wall.lessThan(0.5).select(c0, wall.lessThan(1.5).select(c1, wall.lessThan(2.5).select(c2, c3)));
}

/** Whether a node builder is drawing the motion vectors (three's skinning asks the same). */
function drawsMotion(builder: object): boolean {
  if (!("needsPreviousData" in builder)) return false;
  const probe: unknown = builder.needsPreviousData;
  if (typeof probe !== "function") return false;
  const answer: unknown = Reflect.apply(probe, builder, []);
  return answer === true;
}

/**
 * The leaves' vertex rule (leafVertex mirrors it): every vertex turned about
 * its hinge by its door's angle, its normal with it; a cap vertex laid at
 * the cut, or collapsed far below the floor while the cut is above it. The
 * last drawn frame's angle feeds the motion vectors, so the temporal resolve
 * follows a swinging leaf and sees a still one as still.
 */
export function doorLeafPosition(section: HallSectionUniforms, swing: DoorSwingUniforms): Node<"vec3"> {
  const hinge = attribute("aHinge", "vec4");
  const code = hinge.w;
  const lagged = code.greaterThan(LEAF_LAG_CODE - 0.5);
  const rest = lagged.select(code.sub(LEAF_LAG_CODE), code);
  const cap = rest.greaterThan(LEAF_CAP_CODE - 0.5);
  const door = cap.select(rest.sub(LEAF_CAP_CODE), rest);
  // The lapping leaf trails its door's angle (leafAngle).
  const trail = (phi: Node<"float">): Node<"float"> => lagged.select(min(phi, max(phi.sub(LEAF_LAG).mul(DOOR_OPEN_ANGLE / (DOOR_OPEN_ANGLE - LEAF_LAG)), 0)), phi);
  const pick = (values: readonly Node<"float">[]): Node<"float"> => {
    const [a0, a1, a2, a3] = values;
    if (a0 === undefined || a1 === undefined || a2 === undefined || a3 === undefined) throw new Error("The hall has four doors");
    return door.lessThan(0.5).select(a0, door.lessThan(1.5).select(a1, door.lessThan(2.5).select(a2, a3)));
  };
  const angle = trail(pick(swing.angles));
  const before = trail(pick(swing.previous));
  const cut = doorLeafCut(section);
  const y = positionLocal.y;
  const hidden = cap.and(cut.greaterThanEqual(y.sub(1e-4)).or(cut.lessThanEqual(0.01)));
  const placed = vec3(positionLocal.x, cap.select(cut, y), positionLocal.z);
  const turned = (p: Node<"vec3">, phi: Node<"float">): Node<"vec3"> => {
    const a = hinge.z.mul(phi);
    const c = cos(a);
    const s = sin(a);
    const dx = p.x.sub(hinge.x);
    const dz = p.z.sub(hinge.y);
    return vec3(hinge.x.add(dx.mul(c)).add(dz.mul(s)), p.y, hinge.y.sub(dx.mul(s)).add(dz.mul(c)));
  };
  const far = vec3(0, -50, 0);
  return Fn((builder) => {
    const a = hinge.z.mul(angle);
    const c = cos(a);
    const s = sin(a);
    const n = normalLocal;
    normalLocal.assign(vec3(n.x.mul(c).add(n.z.mul(s)), n.y, n.x.negate().mul(s).add(n.z.mul(c))));
    if (drawsMotion(builder)) positionPrevious.assign(hidden.select(far, turned(placed, before)));
    return hidden.select(far, turned(placed, angle));
  })();
}

/** The leaves' fragments stand at or below their wall's cut (a cap lies on it). */
export function doorLeafMask(section: HallSectionUniforms): Node<"bool"> {
  return positionWorld.y.lessThanEqual(doorLeafCut(section).add(0.0015));
}
