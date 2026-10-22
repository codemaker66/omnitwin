// ---------------------------------------------------------------------------
// The three Grand Assembly directions, as spring models over the same graph.
//
//   Accio       conjured: pieces fly in through the hall's five windows, out
//               of the night, on high arcs; rounds arrive as folded linen that
//               falls open over the table it becomes; chairs turn into their
//               places; candles light last. The camera pushes in and rests.
//   Procession  an invisible household sets the hall: pieces come in through
//               the three real doors in files, rounds rolled on edge as staff
//               carry them, chairs carried upright; each goes down its aisle,
//               round its table, turns to face it and is set down. The camera
//               follows the work from the fireplace door to the main door.
//   Unfolding   the architect's reveal: the usable floor and the main aisle
//               are traced in gold, every footprint is drawn in a ripple from
//               the top table, and each piece rises out of its own footprint,
//               gilded, and settles; the camera cranes from the plan to the
//               room.
//
// Spring parameters are named per beat below and repeated in each study's
// README. Damping ratio ζ = damping / (2·sqrt(stiffness)) (unit mass).
// ---------------------------------------------------------------------------

import type { SpringConfig } from "../../lib/springs.js";
import { SPRING_PRESETS } from "../../lib/springs.js";
import { HALL_HALF_WIDTH, HALL_OPENINGS, HALL_WALLS, type HallOpening } from "../../components/grand-hall/hall-spec.js";
import {
  angularDistance,
  chooseAnchor,
  pieceRandom,
  type AssemblyDirection,
  type AssemblyPiece,
  type SeatOrder,
  type TableSchedule,
} from "./choreography.js";
import { REST, rests, tick, type DirectionModel, type PiecePose } from "./engine.js";

/** A spring of natural frequency ω (rad/s) and damping ratio ζ, unit mass. */
export function springOf(omega: number, zeta: number): SpringConfig {
  return { stiffness: omega * omega, damping: 2 * zeta * omega };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** The nearest angle to `near` that is equivalent to `angle`. */
function unwrapNear(angle: number, near: number): number {
  const turn = Math.PI * 2;
  return angle + Math.round((near - angle) / turn) * turn;
}

/** Facing for a chair travelling along (dx, dz): a chair at rotationY 0 faces -z. */
function headingOf(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

// --- The hall's openings, in the planner's frame ----------------------------

export interface HallOpeningPlace {
  readonly id: string;
  readonly x: number;
  readonly width: number;
  readonly sill: number;
  readonly head: number;
}

function openingX(opening: HallOpening): number {
  const wall = HALL_WALLS.find((candidate) => candidate.id === opening.wall);
  if (wall === undefined) return 0;
  return wall.origin[0] + wall.tangent[0] * opening.centre;
}

export function hallWindows(): readonly HallOpeningPlace[] {
  return HALL_OPENINGS.filter((opening) => opening.wall === "window")
    .map((opening) => ({ id: opening.id, x: openingX(opening), width: opening.width, sill: opening.sill, head: opening.head }))
    .sort((a, b) => a.x - b.x);
}

export function hallDoors(): readonly HallOpeningPlace[] {
  return HALL_OPENINGS.filter((opening) => opening.kind === "door" && opening.wall === "door")
    .map((opening) => ({ id: opening.id, x: openingX(opening), width: opening.width, sill: opening.sill, head: opening.head }))
    .sort((a, b) => a.x - b.x);
}

// --- Accio ------------------------------------------------------------------

export const ACCIO_SPRINGS = {
  /** A round's flight, progress 0 to 1: critically damped, ω = 4.5 (99 % in 1.5 s). */
  tableFlight: springOf(4.5, 1),
  /** A chair's flight: critically damped, ω = 5.5 (99 % in 1.2 s). */
  chairFlight: springOf(5.5, 1),
  /** A chair turning into its place: ζ = 0.75, about 3 % follow-through. */
  pirouette: springOf(6.5, 0.75),
  /** A round's half turn in the air: critically damped. */
  tableTurn: springOf(4.5, 1),
  /** The cloth's skirt falling to the floor: ζ = 0.9, no visible overshoot. */
  unfurl: springOf(8, 0.9),
  /** The cloth's swell as it opens: ζ = 0.46, one soft billow. */
  billow: springOf(11, 0.46),
  lean: SPRING_PRESETS.furnitureLean,
  squash: SPRING_PRESETS.furnitureSquash,
} as const;

interface AccioFlight {
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  readonly arc: number;
  readonly turns: number;
  /** Straight-line length of the flight, metres. */
  readonly length: number;
}

/** A piece has landed once it is this close to its place (metres); its cloth falls open then. */
const ACCIO_LANDING = 0.03;
/** A round's cloth in flight hangs to this share of its drop. */
const ACCIO_GATHERED = 0.5;
/** A round's cloth starts to fall this far from its place (metres): it opens as the round settles. */
const ACCIO_UNFURL_AT = 0.25;

function accioModel(): DirectionModel {
  const windows = hallWindows();
  const flights = new Map<string, AccioFlight>();
  const wallZ = -HALL_HALF_WIDTH;
  return {
    direction: "accio",
    clipSeconds: 8,
    blueprint: false,
    timing: {
      anchorStart: 0.35,
      firstWave: 0.75,
      waveSpeed: 10,
      waveRing: 3.4,
      jitter: 0.06,
      chairDelay: 0.32,
      chairStagger: 0.045,
      dressingAfter: 0.6,
      dressingSpeed: 20,
    },
    camera: {
      keys: [
        { at: 0, position: [-2.0, 3.2, 3.0], target: [-9.2, 0.9, -0.9] },
        { at: 0.9, position: [8.8, 4.8, 4.3], target: [-4.2, 0.2, -1.2] },
      ],
      lead: springOf(2.7, 1),
      follow: springOf(2.7, 1),
    },
    init(motion, graph) {
      const { piece } = motion;
      const seed = graph.seed;
      // The nearest window, or now and then its neighbour, so the streams braid.
      const ranked = [...windows].sort((a, b) => Math.abs(a.x - piece.x) - Math.abs(b.x - piece.x));
      const pick = pieceRandom(seed, piece.id, 3) < 0.28 ? (ranked[1] ?? ranked[0]) : ranked[0];
      const window = pick ?? { x: 0, width: 2, sill: 1, head: 3.3, id: "none" };
      // Spread over the whole opening, so a table's chairs do not crowd one point of it.
      const across = (pieceRandom(seed, piece.id, 4) - 0.5) * 0.85 * window.width;
      const up = window.sill + (window.head - window.sill) * (0.2 + 0.7 * pieceRandom(seed, piece.id, 5));
      const table = piece.role === "table";
      const sx = window.x + across;
      const sz = wallZ - 0.9;
      const flight: AccioFlight = {
        sx,
        sy: up,
        sz,
        arc: table ? 1.0 + 0.5 * pieceRandom(seed, piece.id, 6) : 0.55 + 0.55 * pieceRandom(seed, piece.id, 6),
        turns: pieceRandom(seed, piece.id, 7) < 0.5 ? -1 : 1,
        length: Math.hypot(piece.x - sx, piece.y - up, piece.z - sz),
      };
      flights.set(piece.id, flight);
      motion.px = flight.sx;
      motion.py = flight.sy;
      motion.pz = flight.sz;
      if (table) {
        // Its cloth gathered up as it flies: half its drop, drawn in a little.
        motion.sy.value = ACCIO_GATHERED;
        motion.syTarget = ACCIO_GATHERED;
        motion.radial.value = 0.9;
        motion.radialTarget = 0.9;
        motion.yaw.value = piece.rotationY + Math.PI * flight.turns;
      } else {
        motion.yaw.value = piece.rotationY + Math.PI * 2 * flight.turns;
      }
    },
    step(motion, dt) {
      const flight = flights.get(motion.piece.id);
      if (flight === undefined) return;
      const { piece } = motion;
      const table = piece.role === "table";
      tick(motion.travel, 1, table ? ACCIO_SPRINGS.tableFlight : ACCIO_SPRINGS.chairFlight, dt);
      const p = clamp(motion.travel.value, 0, 1);
      const x = flight.sx + (piece.x - flight.sx) * p;
      const z = flight.sz + (piece.z - flight.sz) * p;
      const y = flight.sy + (piece.y - flight.sy) * p + flight.arc * 4 * p * (1 - p);
      motion.vx = (x - motion.px) / dt;
      motion.vy = (y - motion.py) / dt;
      motion.vz = (z - motion.pz) / dt;
      motion.px = x;
      motion.py = y;
      motion.pz = z;
      if (!motion.landed) {
        // The top trails the pull, as anything drawn along by its base.
        motion.leanTargetX = clamp(-motion.vx * 0.035, -0.2, 0.2);
        motion.leanTargetZ = clamp(-motion.vz * 0.035, -0.2, 0.2);
        if ((1 - p) * flight.length < (table ? ACCIO_UNFURL_AT : ACCIO_LANDING)) {
          motion.landed = true;
          motion.leanTargetX = 0;
          motion.leanTargetZ = 0;
          if (table) {
            motion.syTarget = 1;
            motion.radialTarget = 1;
          } else {
            motion.squash.velocity -= 0.9;
          }
        }
      }
      tick(motion.leanX, motion.leanTargetX, ACCIO_SPRINGS.lean, dt);
      tick(motion.leanZ, motion.leanTargetZ, ACCIO_SPRINGS.lean, dt);
      tick(motion.squash, 0, ACCIO_SPRINGS.squash, dt);
      if (table) {
        tick(motion.yaw, piece.rotationY, ACCIO_SPRINGS.tableTurn, dt);
        tick(motion.sy, motion.syTarget, ACCIO_SPRINGS.unfurl, dt);
        tick(motion.radial, motion.radialTarget, ACCIO_SPRINGS.billow, dt);
      } else if (p > 0.45) {
        tick(motion.yaw, piece.rotationY, ACCIO_SPRINGS.pirouette, dt);
      }
    },
    pose(motion, out) {
      const { piece } = motion;
      const table = piece.role === "table";
      out.x = motion.px;
      out.y = motion.py;
      out.z = motion.pz;
      out.yaw = motion.yaw.value;
      out.leanX = motion.leanX.value;
      out.leanZ = motion.leanZ.value;
      const above = Math.max(0, motion.py - piece.y);
      // Contact shadow: only as a piece comes within a metre or so of the floor.
      const nearFloor = clamp(1 - above / 1.2, 0, 1) ** 3;
      if (table) {
        out.pivotY = piece.height;
        out.sy = Math.max(0.02, motion.sy.value);
        out.sx = motion.radial.value;
        out.sz = motion.radial.value;
        out.shadow = nearFloor;
      } else {
        out.sy = 1 + motion.squash.value;
        out.sx = 1 - motion.squash.value * 0.5;
        out.sz = out.sx;
        out.shadow = nearFloor;
      }
    },
    settled(motion) {
      const { piece } = motion;
      const flight = flights.get(piece.id);
      const progress = REST.metres / Math.max(1, flight?.length ?? 1);
      if (!motion.landed || !rests(motion.travel, 1, progress)) return false;
      if (!rests(motion.leanX, 0, REST.radians) || !rests(motion.leanZ, 0, REST.radians) || !rests(motion.squash, 0, REST.scale)) return false;
      if (!rests(motion.yaw, piece.rotationY, REST.radians)) return false;
      if (piece.role === "table") return rests(motion.sy, 1, REST.scale) && rests(motion.radial, 1, REST.scale);
      return true;
    },
  };
}

// --- The Procession -----------------------------------------------------------

export const PROCESSION_SPRINGS = {
  /** Following the travel direction while carried: critically damped. */
  heading: springOf(9, 1),
  /** Turning to face its table at its place: ζ = 0.8. */
  face: springOf(7.75, 0.8),
  /** A round's top tipped down from its edge: ζ = 0.65, one rock. */
  tip: springOf(6.3, 0.65),
  /** Its cloth then let fall to the floor: ζ = 0.9. */
  drop: springOf(8, 0.9),
  lean: SPRING_PRESETS.furnitureLean,
  squash: SPRING_PRESETS.furnitureSquash,
} as const;

/** Cascade travel time: the route at about this speed, within these bounds (seconds). */
const PROCESSION_SPEED = 5.5;
const PROCESSION_MIN_TRAVEL = 0.95;
const PROCESSION_MAX_TRAVEL = 1.9;
/** Where the files run along the door wall, and the ring chairs circle their table on. */
const LANE_Z = 4.6;
const OUTSIDE_Z = HALL_HALF_WIDTH + 0.4;
const CHAIR_ORBIT = 1.62;
/** A round is carried on edge with its cloth gathered to this share of its drop. */
const PROCESSION_GATHERED = 0.14;
const CARRY_LEAN = 0.04;
const CARRY_LEAN_MOST = 0.07;
const SET_DOWN_SQUASH = 1.35;
const FILE_START = { fireplace: 0.3, main: 0.45, end: 0.6 } as const;
const GROUP_GAP = 0.45;

interface Route {
  readonly xs: Float64Array;
  readonly zs: Float64Array;
  readonly lengths: Float64Array;
  readonly total: number;
}

function makeRoute(points: readonly (readonly [number, number])[]): Route {
  const xs = new Float64Array(points.length);
  const zs = new Float64Array(points.length);
  const lengths = new Float64Array(points.length);
  let total = 0;
  points.forEach(([x, z], index) => {
    if (index > 0) {
      const previous = points[index - 1];
      if (previous !== undefined) total += Math.hypot(x - previous[0], z - previous[1]);
    }
    xs[index] = x;
    zs[index] = z;
    lengths[index] = total;
  });
  return { xs, zs, lengths, total };
}

/** Position and direction at fraction `p` of the route's length. */
function sampleRoute(route: Route, p: number, out: { x: number; z: number; dx: number; dz: number }): void {
  const at = clamp(p, 0, 1) * route.total;
  let index = 1;
  while (index < route.lengths.length - 1 && (route.lengths[index] ?? 0) < at) index += 1;
  const a = index - 1;
  const l0 = route.lengths[a] ?? 0;
  const l1 = route.lengths[index] ?? l0;
  const t = l1 > l0 ? (at - l0) / (l1 - l0) : 1;
  const x0 = route.xs[a] ?? 0;
  const z0 = route.zs[a] ?? 0;
  const x1 = route.xs[index] ?? x0;
  const z1 = route.zs[index] ?? z0;
  out.x = x0 + (x1 - x0) * t;
  out.z = z0 + (z1 - z0) * t;
  const length = Math.hypot(x1 - x0, z1 - z0);
  if (length > 1e-9) { out.dx = (x1 - x0) / length; out.dz = (z1 - z0) / length; }
}

/** Rounds the corners of a polyline (Chaikin), keeping its two ends. */
function rounded(points: readonly (readonly [number, number])[], passes: number): (readonly [number, number])[] {
  let current = [...points];
  for (let pass = 0; pass < passes; pass++) {
    const next: (readonly [number, number])[] = [];
    const first = current[0];
    if (first !== undefined) next.push(first);
    for (let index = 0; index < current.length - 1; index++) {
      const a = current[index];
      const b = current[index + 1];
      if (a === undefined || b === undefined) continue;
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    const last = current[current.length - 1];
    if (last !== undefined) next.push(last);
    current = next;
  }
  return current;
}

type DoorName = keyof typeof FILE_START;

interface TableAccess {
  readonly door: DoorName;
  readonly doorX: number;
  /** The column the route descends before crossing along the table's row (the table's own column if clear). */
  readonly columnX: number;
  /** Angle (plan, from the table's centre) at which its chairs meet it. */
  readonly entry: number;
}

/** The door a column is served from. */
function doorFor(x: number): DoorName {
  return x < -3.5 ? "fireplace" : x > 3.5 ? "end" : "main";
}

function processionModel(pieces: readonly AssemblyPiece[]): DirectionModel {
  const doors = hallDoors();
  const doorX: Record<DoorName, number> = {
    fireplace: doors[0]?.x ?? -8.87,
    main: doors[1]?.x ?? 0,
    end: doors[2]?.x ?? 8.82,
  };
  const tables = pieces.filter((piece) => piece.role === "table");
  const byId = new Map(pieces.map((piece) => [piece.id, piece]));
  const access = new Map<string, TableAccess>();
  const routes = new Map<string, Route>();
  const travel = new Map<string, { lead: SpringConfig; follow: SpringConfig }>();
  const columns = [...new Set(tables.map((table) => table.x))].sort((a, b) => a - b);

  // Each door's file sets the far row first, so nothing passes a round already
  // set; the top table goes first of all at its door, down its own column, and
  // the round behind it is then reached along the window row from the next one.
  const schedule: TableSchedule = (scheduledTables, anchor) => {
    const files = new Map<DoorName, AssemblyPiece[]>();
    for (const table of scheduledTables) {
      const door = doorFor(table.x);
      const list = files.get(door) ?? [];
      list.push(table);
      files.set(door, list);
    }
    const starts = new Map<string, number>();
    for (const [door, file] of files) {
      // Along a row, the round nearer the door goes first, except in the row
      // by the doors, whose rounds sit on the file's lane: there the farther.
      const doorRow = Math.max(...file.map((table) => table.z));
      const order = [...file].sort((a, b) => {
        if (anchor !== null && a.id === anchor.id) return -1;
        if (anchor !== null && b.id === anchor.id) return 1;
        if (a.z !== b.z) return a.z - b.z;
        const nearer = Math.abs(doorX[door] - a.x) - Math.abs(doorX[door] - b.x);
        return (a.z === doorRow ? -nearer : nearer) || (a.id < b.id ? -1 : 1);
      });
      order.forEach((table, index) => { starts.set(table.id, FILE_START[door] + index * GROUP_GAP); });
    }
    // Routes are decided in start order, against the rounds already set.
    const placed: AssemblyPiece[] = [];
    const inOrder = [...scheduledTables].sort((a, b) => (starts.get(a.id) ?? 0) - (starts.get(b.id) ?? 0) || (a.id < b.id ? -1 : 1));
    for (const table of inOrder) {
      const door = doorFor(table.x);
      // A column is clear down to this row if nothing is set in it on the door side.
      const clearDown = (x: number): boolean => !placed.some((other) => Math.abs(other.x - x) < 0.01 && other.z > table.z - 0.01);
      // Crossing along this row from column x passes no round already set.
      const clearAcross = (from: number): boolean => !placed.some((other) => Math.abs(other.z - table.z) < 0.01
        && other.x > Math.min(from, table.x) - 0.01 && other.x < Math.max(from, table.x) + 0.01);
      let columnX = table.x;
      if (!clearDown(table.x)) {
        const alternatives = columns.filter((x) => x !== table.x).sort((a, b) => Math.abs(a - table.x) - Math.abs(b - table.x));
        columnX = alternatives.find((x) => clearDown(x) && clearAcross(x)) ?? table.x;
      }
      const entry = columnX === table.x ? Math.PI / 2 : (columnX > table.x ? 0 : Math.PI);
      access.set(table.id, { door, doorX: doorX[door], columnX, entry });
      placed.push(table);
    }
    return starts;
  };

  // Chairs fill from the far side of their table back toward where they come in.
  const seatOrder: SeatOrder = (chair, table) => {
    const entry = access.get(table.id)?.entry ?? Math.PI / 2;
    return -angularDistance(Math.atan2(chair.z - table.z, chair.x - table.x), entry);
  };

  const routeFor = (piece: AssemblyPiece): Route => {
    const tableId = piece.role === "table" ? piece.id : piece.tableId;
    const table = tableId === null ? undefined : byId.get(tableId);
    const way = table === undefined ? undefined : access.get(table.id);
    if (table === undefined || way === undefined) {
      return makeRoute([[doorX.main, OUTSIDE_Z], [doorX.main, LANE_Z], [piece.x, LANE_Z], [piece.x, piece.z]]);
    }
    const head: (readonly [number, number])[] = [[way.doorX, OUTSIDE_Z], [way.doorX, LANE_Z], [way.columnX, LANE_Z]];
    if (piece.role === "table") {
      if (way.columnX !== table.x) head.push([way.columnX, table.z]);
      head.push([table.x, table.z]);
      return makeRoute(rounded(head, 3));
    }
    // A chair: to the side of its table it is reached from, round it, then in to its seat.
    if (way.columnX !== table.x) head.push([way.columnX, table.z]);
    head.push([table.x + Math.cos(way.entry) * CHAIR_ORBIT, table.z + Math.sin(way.entry) * CHAIR_ORBIT]);
    const lane = rounded(head, 3);
    const seatAngle = Math.atan2(piece.z - table.z, piece.x - table.x);
    let sweep = seatAngle - way.entry;
    sweep = Math.atan2(Math.sin(sweep), Math.cos(sweep));
    const steps = Math.max(1, Math.ceil(Math.abs(sweep) / 0.12));
    const orbit: (readonly [number, number])[] = [];
    for (let step = 1; step <= steps; step++) {
      const angle = way.entry + (sweep * step) / steps;
      orbit.push([table.x + Math.cos(angle) * CHAIR_ORBIT, table.z + Math.sin(angle) * CHAIR_ORBIT]);
    }
    return makeRoute([...lane, ...orbit, [piece.x, piece.z]]);
  };

  const sample = { x: 0, z: 0, dx: 0, dz: -1 };
  return {
    direction: "procession",
    clipSeconds: 8,
    blueprint: false,
    schedule,
    seatOrder,
    timing: {
      anchorStart: FILE_START.fireplace,
      firstWave: FILE_START.main,
      waveSpeed: 8,
      waveRing: 3.4,
      jitter: 0,
      chairDelay: 0.2,
      chairStagger: 0.035,
      dressingAfter: 1.0,
      dressingSpeed: 22,
    },
    camera: {
      keys: [
        { at: 0, position: [-1.2, 4.3, -4.85], target: [-7.8, 0.9, 4.2] },
        { at: 0.9, position: [-0.2, 4.15, -4.85], target: [-3.0, 0.8, 2.6] },
        { at: 2.0, position: [1.2, 4.7, -4.95], target: [-0.4, 0.5, 2.3] },
      ],
      lead: springOf(3, 1),
      follow: springOf(3.5, 1),
    },
    init(motion) {
      const route = routeFor(motion.piece);
      routes.set(motion.piece.id, route);
      const seconds = clamp(route.total / PROCESSION_SPEED, PROCESSION_MIN_TRAVEL, PROCESSION_MAX_TRAVEL);
      // A cascade of two critically damped springs reaches 99 % at ωt ≈ 10.
      const omega = 10 / seconds;
      travel.set(motion.piece.id, { lead: springOf(omega, 1), follow: springOf(omega, 1) });
      sampleRoute(route, 0, sample);
      motion.px = sample.x;
      motion.pz = sample.z;
      if (motion.piece.role === "table") {
        motion.roll.value = Math.PI / 2;
        motion.rollTarget = Math.PI / 2;
        motion.rollAxisX = sample.dx;
        motion.rollAxisZ = sample.dz;
        motion.sy.value = PROCESSION_GATHERED;
        motion.syTarget = PROCESSION_GATHERED;
      } else {
        motion.yaw.value = headingOf(sample.dx, sample.dz);
        motion.yawTarget = motion.piece.rotationY;
      }
    },
    step(motion, dt) {
      const route = routes.get(motion.piece.id);
      const springs = travel.get(motion.piece.id);
      if (route === undefined || springs === undefined) return;
      const { piece } = motion;
      tick(motion.lead, 1, springs.lead, dt);
      tick(motion.travel, motion.lead.value, springs.follow, dt);
      const p = clamp(motion.travel.value, 0, 1);
      sampleRoute(route, p, sample);
      motion.vx = (sample.x - motion.px) / dt;
      motion.vz = (sample.z - motion.pz) / dt;
      motion.px = sample.x;
      motion.pz = sample.z;
      const arriving = p > 0.9;
      if (piece.role === "table") {
        if (!arriving) {
          motion.rollAxisX = sample.dx;
          motion.rollAxisZ = sample.dz;
        } else {
          motion.rollTarget = 0;
        }
        tick(motion.roll, motion.rollTarget, PROCESSION_SPRINGS.tip, dt);
        if (arriving && !motion.landed && Math.abs(motion.roll.value) < 0.05) {
          // Set down level: the cloth is let fall.
          motion.landed = true;
          motion.syTarget = 1;
        }
        tick(motion.sy, motion.syTarget, PROCESSION_SPRINGS.drop, dt);
        return;
      }
      if (p < 0.86) {
        const heading = unwrapNear(headingOf(sample.dx, sample.dz), motion.yaw.value);
        tick(motion.yaw, heading, PROCESSION_SPRINGS.heading, dt);
      } else {
        if (!motion.released) {
          motion.released = true;
          motion.yawTarget = unwrapNear(piece.rotationY, motion.yaw.value);
        }
        tick(motion.yaw, motion.yawTarget, PROCESSION_SPRINGS.face, dt);
      }
      if (!motion.landed) {
        const speed = Math.hypot(motion.vx, motion.vz);
        const scale = speed * CARRY_LEAN > CARRY_LEAN_MOST ? CARRY_LEAN_MOST / speed : CARRY_LEAN;
        motion.leanTargetX = -motion.vx * scale;
        motion.leanTargetZ = -motion.vz * scale;
        if (p > 0.995) {
          motion.landed = true;
          motion.leanTargetX = 0;
          motion.leanTargetZ = 0;
          motion.squash.velocity -= SET_DOWN_SQUASH;
        }
      }
      tick(motion.leanX, motion.leanTargetX, PROCESSION_SPRINGS.lean, dt);
      tick(motion.leanZ, motion.leanTargetZ, PROCESSION_SPRINGS.lean, dt);
      tick(motion.squash, 0, PROCESSION_SPRINGS.squash, dt);
    },
    pose(motion, out: PiecePose) {
      const { piece } = motion;
      out.x = motion.px;
      out.z = motion.pz;
      if (piece.role === "table") {
        // The gathered top, tipped about its own centre and lifted so its rim
        // never goes through the floor.
        const tau = motion.roll.value;
        const radius = piece.radius + 0.03;
        const drop = Math.max(0.02, motion.sy.value);
        const thickness = piece.height * drop;
        const centre = piece.height - thickness / 2;
        out.pivotY = piece.height;
        out.sy = drop;
        out.roll = tau;
        out.rollAxisX = motion.rollAxisX;
        out.rollAxisZ = motion.rollAxisZ;
        out.rollPivot = centre;
        out.y = piece.y + Math.max(0, radius * Math.abs(Math.sin(tau)) + (thickness / 2) * Math.cos(tau) - centre);
        out.shadow = clamp(motion.sy.value, 0, 1);
      } else {
        out.yaw = motion.yaw.value;
        out.leanX = motion.leanX.value;
        out.leanZ = motion.leanZ.value;
        out.sy = 1 + motion.squash.value;
        out.sx = 1 - motion.squash.value * 0.5;
        out.sz = out.sx;
      }
    },
    settled(motion) {
      const route = routes.get(motion.piece.id);
      const progress = REST.metres / Math.max(1, route?.total ?? 1);
      if (!rests(motion.lead, 1, progress) || !rests(motion.travel, 1, progress)) return false;
      if (motion.piece.role === "table") return motion.landed && rests(motion.roll, 0, REST.radians) && rests(motion.sy, 1, REST.scale);
      return motion.landed && rests(motion.yaw, motion.yawTarget, REST.radians)
        && rests(motion.leanX, 0, REST.radians) && rests(motion.leanZ, 0, REST.radians) && rests(motion.squash, 0, REST.scale);
    },
  };
}

// --- The Unfolding ---------------------------------------------------------------

export const UNFOLDING_SPRINGS = {
  /** A piece rising out of its footprint: ζ = 0.7, about 4.6 % past full height, then settles. */
  extrude: springOf(6.8, 0.7),
  /** The gold leaving it: critically damped. */
  gild: springOf(4.5, 1),
  /** A footprint drawn: critically damped. */
  ringIn: springOf(7.75, 1),
  /** A footprint opening to its true size: ζ = 0.6. */
  ringScale: springOf(9.5, 0.6),
  /** A footprint fading once its piece stands on it: critically damped. */
  ringOut: springOf(4.5, 1),
} as const;

/** A footprint shows this long before its piece rises (seconds). */
export const UNFOLDING_RING_LEAD = 0.55;
const UNFOLDING_GILD_DELAY = 0.25;

function unfoldingModel(): DirectionModel {
  return {
    direction: "unfolding",
    clipSeconds: 8,
    blueprint: true,
    timing: {
      anchorStart: 0.45,
      firstWave: 0.6,
      waveSpeed: 7.5,
      waveRing: 3.4,
      jitter: 0.03,
      chairDelay: 0.1,
      chairStagger: 0.026,
      dressingAfter: 0.6,
      dressingSpeed: 20,
    },
    camera: {
      keys: [
        { at: 0, position: [-9.9, 6.1, -3.6], target: [-5.4, 0.0, 0.9] },
        { at: 1.4, position: [-9.4, 3.7, -4.2], target: [3.0, 0.7, 1.6] },
      ],
      lead: springOf(3, 1),
      follow: springOf(3, 1),
    },
    init(motion) {
      motion.sy.value = 0.012;
      motion.syTarget = 1;
      motion.tint.value = 1;
      motion.tintTarget = 0;
      motion.ring.value = 0;
      motion.ringTarget = 1;
      motion.ringScale.value = 0.86;
    },
    step(motion, dt) {
      tick(motion.ring, motion.ringTarget, motion.ringTarget > 0.5 ? UNFOLDING_SPRINGS.ringIn : UNFOLDING_SPRINGS.ringOut, dt);
      tick(motion.ringScale, 1, UNFOLDING_SPRINGS.ringScale, dt);
      if (motion.elapsed >= UNFOLDING_RING_LEAD) tick(motion.sy, 1, UNFOLDING_SPRINGS.extrude, dt);
      if (motion.elapsed >= UNFOLDING_RING_LEAD + UNFOLDING_GILD_DELAY) tick(motion.tint, 0, UNFOLDING_SPRINGS.gild, dt);
      if (motion.ringTarget > 0.5 && motion.sy.value > 0.92) motion.ringTarget = 0;
    },
    pose(motion, out) {
      out.visible = motion.elapsed >= UNFOLDING_RING_LEAD;
      out.sy = Math.max(0.012, motion.sy.value);
      out.pivotY = 0;
      out.tint = clamp(motion.tint.value, 0, 1);
      out.shadow = clamp(motion.sy.value, 0, 1);
    },
    settled(motion) {
      return motion.elapsed >= UNFOLDING_RING_LEAD && motion.ringTarget < 0.5
        && rests(motion.sy, 1, REST.scale) && rests(motion.tint, 0, REST.light)
        && rests(motion.ring, 0, REST.light) && rests(motion.ringScale, 1, REST.scale);
    },
  };
}

export function directionModel(direction: AssemblyDirection, pieces: readonly AssemblyPiece[]): DirectionModel {
  switch (direction) {
    case "accio": return accioModel();
    case "procession": return processionModel(pieces);
    case "unfolding": return unfoldingModel();
  }
}

/** The anchor the graph will choose, for callers that frame it. */
export function anchorOf(pieces: readonly AssemblyPiece[]): AssemblyPiece | null {
  return chooseAnchor(pieces);
}
