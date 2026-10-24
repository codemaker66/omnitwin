// ---------------------------------------------------------------------------
// Accio: the Grand Assembly as a summoning.
//
// The room is empty. The hall's five windows take on a light, and out of
// that light, just inside each pane, the pieces come: each is born as a
// point in the window's light and grows to its true size as it leaves the
// reveal, so nothing ever passes through the glass. The rounds come first,
// in waves outward from the top table; each is drawn up and across the hall
// tipped toward the viewer, so it reads as a table and never as a drum, and
// then it is let go above its place and falls the last metres as a leaf
// falls, swinging and rocking, to settle without a sound. Only when a round
// has landed do its chairs come, one window stream at a time, each turning
// into its seat and setting its weight down. The candles light last, table by
// table as each is complete. The camera cranes gently down to a view of the
// whole set room and holds.
//
// Everything moves on springs (engine.ts). Spring parameters are named per
// beat below; the damping ratio is ζ = damping / (2·sqrt(stiffness)).
// ---------------------------------------------------------------------------

import type { SpringConfig } from "../../lib/springs.js";
import { SPRING_PRESETS } from "../../lib/springs.js";
import {
  HALL_GLAZING,
  HALL_OPENINGS,
  HALL_WALLS,
  wallPoint,
} from "../../components/grand-hall/hall-spec.js";
import { pieceRandom, seatsFromAnchor, type AssemblyPiece, type ChoreographyGraph, type ChoreoNode } from "./choreography.js";
import {
  ASSEMBLY_TICK,
  REST,
  createMotion,
  rests,
  tick,
  type CameraKey,
  type DirectionModel,
  type DirectionPlan,
  type PieceMotion,
  type RevealLight,
  type Vec3,
} from "./engine.js";
import { tiltToward } from "./pose-matrix.js";

/** A spring of natural frequency ω (rad/s) and damping ratio ζ, unit mass. */
export function springOf(omega: number, zeta: number): SpringConfig {
  return { stiffness: omega * omega, damping: 2 * zeta * omega };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

// --- The windows -----------------------------------------------------------

/** One of the hall's windows, in the planner's frame (metres). */
export interface AccioWindow {
  readonly id: string;
  readonly arched: boolean;
  /** Centre of the glazed light along the hall. */
  readonly x: number;
  /** The glass, and the wall's face where the reveal opens into the hall. */
  readonly glassZ: number;
  readonly faceZ: number;
  /** Clear width of the opening at the wall's face. */
  readonly width: number;
  /** Bottom and top of the glazed light. */
  readonly sill: number;
  readonly top: number;
}

/** The five windows, fireplace end first. */
export function accioWindows(): readonly AccioWindow[] {
  const wall = HALL_WALLS.find((candidate) => candidate.id === "window");
  if (wall === undefined) return [];
  const windows: AccioWindow[] = [];
  for (const glazing of HALL_GLAZING) {
    const opening = HALL_OPENINGS.find((candidate) => candidate.id === glazing.opening);
    if (opening === undefined) continue;
    const glass = wallPoint(wall, glazing.centre, 0, glazing.glassDepth);
    const face = wallPoint(wall, glazing.centre, 0, 0);
    windows.push({
      id: glazing.opening,
      arched: opening.kind === "arched-window",
      x: glass[0],
      glassZ: glass[2],
      faceZ: face[2],
      width: opening.width,
      sill: glazing.sill,
      top: glazing.top,
    });
  }
  return windows.sort((a, b) => a.x - b.x);
}

// --- Springs and beats ---------------------------------------------------------

export const ACCIO_SPRINGS = {
  /** Out of the light: a piece grows from a point, critically damped (ω = 8, 99 % in 0.8 s). */
  emerge: springOf(8, 1),
  /** A round drawn across the hall, progress 0 to 1: critically damped, a strong pull that eases. */
  tableTravel: springOf(5, 1),
  /** Drawn up to where it will be let go. */
  tableRise: springOf(4, 1),
  /** Let go, it comes down: critically damped, so it lands softly. */
  tableFall: springOf(8, 1),
  /** The leaf's swing across its fall: under-damped, ζ = 0.4. */
  leafSwing: springOf(6.5, 0.4),
  /** On the floor the swing stops at once: critically damped. */
  leafRest: springOf(14, 1),
  /** A round tipped toward the viewer while aloft, and level again as it comes down. */
  tableTilt: springOf(6, 0.9),
  /** A round's slow turn in the air: critically damped. */
  tableTurn: springOf(5, 1),
  /** A chair's flight across the hall: critically damped. */
  chairTravel: springOf(7.5, 1),
  /** A chair carried at the height it crosses the hall at. */
  chairRise: springOf(6.5, 1),
  /** Set down into its place: critically damped. */
  chairDrop: springOf(14, 1),
  /** A chair turning into its place: ζ = 0.8, about 1.5 % follow-through. */
  pirouette: springOf(8.5, 0.8),
  lean: SPRING_PRESETS.furnitureLean,
  squash: SPRING_PRESETS.furnitureSquash,
  /** A window's light rising and fading: critically damped. */
  windowLight: springOf(6, 1),
} as const;

export const ACCIO_BEATS = {
  /** The first round leaves its window. */
  anchorStart: 0.35,
  /** Rounds leave in wave order this often, seconds. */
  tableCadence: 0.1,
  /** Rounds leave one window at least this far apart, seconds. */
  tableGap: 0.22,
  /** A round's chairs start this long after it lands, seconds. */
  chairAfterLanding: 0.06,
  /** And follow one another round the table this often. */
  chairStagger: 0.04,
  /** Chairs leave one window at least this far apart, seconds. */
  chairGap: 0.058,
  /** A chair does not leave a window this soon after a round has. */
  tableClear: 0.2,
  /** A table's candles start to light this long after its last chair has landed (before, if negative). */
  candlesAfter: -0.35,
  /** A window's light rises this long before its first piece and fades this long after its last. */
  lightLead: 0.4,
  lightTail: 0.1,
  /** A round is let go above its place once this much of its way across is done. */
  tableRelease: 0.85,
  /** A chair is set down once this much is done. */
  chairRelease: 0.82,
} as const;

/** Where in the window's light a piece is born: this far in front of the glass, metres. */
export const ACCIO_BIRTH_DEPTH = 0.18;
/** How small a piece is at birth. */
export const ACCIO_BIRTH_SIZE = 0.06;
/** Margin a piece keeps from the sides of a reveal while it is still inside it, metres. */
export const ACCIO_REVEAL_MARGIN = 0.08;
/** A round is tipped toward the viewer this far as it is drawn in, radians (about 32°). */
const TABLE_TIP = 0.56;
/** The leaf's swing starts at this speed, metres a second... */
const SWING_KICK = 1.15;
/** ...and the round banks into its swing by this much per metre a second, radians. */
const SWING_BANK = 0.26;
/** A piece has landed once it is this close above its place, metres... */
const LANDED = 0.01;
/** ...and this much of its way across is done (a couple of centimetres left). */
const LANDED_PROGRESS = 0.997;
/** Out of the reveal square to the wall: the route's turn lies this far in front of it, metres. */
const EXIT_DEPTH = 1.6;
/** Choosing a window, a metre further along the hall weighs as much as this long a wait, seconds. */
const WINDOW_DISTANCE_COST = 0.04;
/** Consecutive rounds in the waves' order leave at least this far apart, seconds. */
const WAVE_STEP = 0.03;

// --- The camera ------------------------------------------------------------------

/**
 * Landscape: from the fireplace end's corner by the door wall, a little above
 * head height, looking down the hall past the top table. It frames every
 * round and four of the five windows with no chandelier in the middle of the
 * frame (phase2/pose_search2.py), and lies inside the orbit's limits so the
 * planner takes over from it without a jump.
 */
export const ACCIO_CAMERA_LANDSCAPE: readonly CameraKey[] = [
  { at: 0, position: [-10.0, 3.75, 4.45], target: [-4.0, 0.7, -0.9] },
  { at: 0.6, position: [-10.3, 3.2, 4.8], target: [-4.5, 0.0, 0.0] },
];

/** Portrait: down the hall's length from above the east end. */
export const ACCIO_CAMERA_PORTRAIT: readonly CameraKey[] = [
  { at: 0, position: [10.2, 5.4, 0.9], target: [-1.2, 1.0, -0.9] },
  { at: 0.6, position: [10.3, 5.0, 0.6], target: [-1.5, 0.3, -0.5] },
];

/** The camera cranes as a cascade: slow and critically damped, so it is steady. */
const CAMERA_SPRING = springOf(2.6, 1);

// --- Flights -----------------------------------------------------------------------

export interface AccioFlight {
  readonly window: AccioWindow;
  /** Where its base starts (its middle at the birth point). */
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  /** Height its base crosses the hall at before it is let go. */
  readonly cruise: number;
  /** Half its larger plan dimension, metres, for the reveal's growth limit. */
  readonly reach: number;
  /** The route's turn in front of the window: it leaves the reveal square to the wall. */
  readonly turnX: number;
  readonly turnZ: number;
  /** Across the camera's view of its place (unit, horizontal), and the way its swing first goes (±1). */
  readonly acrossX: number;
  readonly acrossZ: number;
  readonly swing: number;
  /** The tip toward the viewer as a rotation vector. */
  readonly tipX: number;
  readonly tipZ: number;
}

function isRound(piece: AssemblyPiece): boolean {
  return piece.role !== "chair";
}

/** The piece's middle, metres above its base: what it grows and tips about. */
function pivotOf(piece: AssemblyPiece): number {
  return piece.height / 2;
}

/** Windows by distance along the hall from x, nearest first; a large piece only through one it can pass. */
function nearestWindows(windows: readonly AccioWindow[], x: number, round: boolean, reach: number): AccioWindow[] {
  const usable = windows.filter((window) => !round || window.width / 2 - ACCIO_REVEAL_MARGIN > reach * 0.55);
  return [...(usable.length > 0 ? usable : windows)].sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x) || a.x - b.x);
}

/** The largest growth the reveal allows at (x, z): a round squeezes through a narrow sash. */
export function accioGrowthLimit(flight: AccioFlight, x: number, z: number): number {
  if (z >= flight.window.faceZ + flight.reach) return 1;
  const room = flight.window.width / 2 - ACCIO_REVEAL_MARGIN - Math.abs(x - flight.window.x);
  return clamp(room / Math.max(0.01, flight.reach), ACCIO_BIRTH_SIZE, 1);
}

export interface AccioOptions {
  /** A portrait view frames the hall down its length. */
  readonly portrait?: boolean;
}

export interface AccioModel extends DirectionModel {
  /** A piece's flight once the plan has chosen its window (null before). */
  flight(id: string): AccioFlight | null;
}

export function accioModel(options: AccioOptions = {}): AccioModel {
  const windows = accioWindows();
  const keys = options.portrait === true ? ACCIO_CAMERA_PORTRAIT : ACCIO_CAMERA_LANDSCAPE;
  const viewer: Vec3 = keys[keys.length - 1]?.position ?? [0, 3, 5];
  /** The window each piece comes through, set by the plan. */
  const sources = new Map<string, AccioWindow>();
  const flights = new Map<string, AccioFlight>();

  const flightFor = (piece: AssemblyPiece, seed: number): AccioFlight => {
    const window = sources.get(piece.id) ?? nearestWindows(windows, piece.x, isRound(piece), piece.radius)[0];
    if (window === undefined) throw new Error("Accio needs the hall's windows");
    const round = isRound(piece);
    const reach = piece.radius;
    // Spread over the middle of the light, clear of the curtains at its sides.
    const room = Math.max(0, window.width / 2 - ACCIO_REVEAL_MARGIN - reach * ACCIO_BIRTH_SIZE);
    const across = (pieceRandom(seed, piece.id, 4) - 0.5) * Math.min(room, window.width * 0.3) * 2;
    const middle = window.sill + (window.top - window.sill) * (0.32 + 0.36 * pieceRandom(seed, piece.id, 5));
    const sx = window.x + across;
    const sz = window.glassZ + ACCIO_BIRTH_DEPTH;
    // A round swings across the camera's view of its place, so its bank never
    // turns its top away from the camera while its tip turns it toward it.
    const viewX = viewer[0] - piece.x;
    const viewZ = viewer[2] - piece.z;
    const view = Math.hypot(viewX, viewZ) || 1;
    const tip = tiltToward(viewX, viewZ, TABLE_TIP);
    return {
      window,
      sx,
      sy: middle - pivotOf(piece),
      sz,
      turnX: sx,
      turnZ: window.faceZ + EXIT_DEPTH,
      cruise: round ? 2.3 + 0.45 * pieceRandom(seed, piece.id, 6) : 1.35 + 0.35 * pieceRandom(seed, piece.id, 6),
      reach,
      acrossX: -viewZ / view,
      acrossZ: viewX / view,
      swing: pieceRandom(seed, piece.id, 7) < 0.5 ? -1 : 1,
      tipX: tip.x,
      tipZ: tip.z,
    };
  };

  const model: AccioModel = {
    clipSeconds: 8,
    timing: {
      anchorStart: ACCIO_BEATS.anchorStart,
      firstWave: ACCIO_BEATS.anchorStart + ACCIO_BEATS.tableCadence,
      waveSpeed: 6,
      waveRing: 3.4,
      jitter: 0,
      chairDelay: 0.5,
      chairStagger: ACCIO_BEATS.chairStagger,
      dressingAfter: 0.5,
      dressingSpeed: 20,
    },
    seatOrder: seatsFromAnchor,
    camera: { keys, lead: CAMERA_SPRING, follow: CAMERA_SPRING },
    light: ACCIO_SPRINGS.windowLight,
    flight: (id) => flights.get(id) ?? null,
    plan(base, pieces) {
      return planAccio(base, pieces, windows, sources, model);
    },
    init(motion, graph) {
      const { piece } = motion;
      const flight = flightFor(piece, graph.seed);
      flights.set(piece.id, flight);
      motion.px = flight.sx;
      motion.py = flight.sy;
      motion.pz = flight.sz;
      motion.alt.value = flight.sy;
      motion.altTarget = flight.cruise;
      motion.grow.value = ACCIO_BIRTH_SIZE;
      motion.phase = 0;
      if (isRound(piece)) {
        motion.pitch.value = 1;
        motion.pitchTarget = 1;
        motion.yaw.value = piece.rotationY + 0.6 * flight.swing;
      } else {
        motion.yaw.value = piece.rotationY + Math.PI * flight.swing;
      }
    },
    step(motion, dt) {
      const flight = flights.get(motion.piece.id);
      if (flight === undefined) return;
      const { piece } = motion;
      const round = isRound(piece);
      tick(motion.travel, 1, round ? ACCIO_SPRINGS.tableTravel : ACCIO_SPRINGS.chairTravel, dt);
      const p = clamp(motion.travel.value, 0, 1);
      if (motion.phase === 0 && p >= (round ? ACCIO_BEATS.tableRelease : ACCIO_BEATS.chairRelease)) {
        // Let go above its place.
        motion.phase = 1;
        motion.altTarget = piece.y;
        if (round) motion.sway.velocity += SWING_KICK * flight.swing;
      }
      let altSpring: SpringConfig;
      if (motion.phase === 0) altSpring = round ? ACCIO_SPRINGS.tableRise : ACCIO_SPRINGS.chairRise;
      else altSpring = round ? ACCIO_SPRINGS.tableFall : ACCIO_SPRINGS.chairDrop;
      tick(motion.alt, motion.altTarget, altSpring, dt);
      if (round) {
        tick(motion.sway, 0, motion.landed ? ACCIO_SPRINGS.leafRest : ACCIO_SPRINGS.leafSwing, dt);
        // Tipped toward the viewer while aloft; it levels as it comes down to the floor.
        const aloft = motion.phase === 0 ? 1 : clamp((motion.alt.value - piece.y - 0.25) / 1.1, 0, 1);
        tick(motion.pitch, motion.pitchTarget * aloft, ACCIO_SPRINGS.tableTilt, dt);
        tick(motion.yaw, piece.rotationY, ACCIO_SPRINGS.tableTurn, dt);
      } else if (p > 0.15) {
        tick(motion.yaw, piece.rotationY, ACCIO_SPRINGS.pirouette, dt);
      }
      // A quadratic route through the turn in front of the window: it leaves
      // the reveal square to the wall, then curves toward its place.
      const a = (1 - p) * (1 - p);
      const b = 2 * p * (1 - p);
      const c = p * p;
      const x = a * flight.sx + b * flight.turnX + c * piece.x + flight.acrossX * motion.sway.value;
      const z = a * flight.sz + b * flight.turnZ + c * piece.z + flight.acrossZ * motion.sway.value;
      const y = motion.alt.value;
      const limit = accioGrowthLimit(flight, x, z);
      tick(motion.grow, limit, ACCIO_SPRINGS.emerge, dt);
      // However the spring lags, never wider than the reveal it is passing.
      if (motion.grow.value > limit) motion.grow.value = limit;
      motion.vx = (x - motion.px) / dt;
      motion.vy = (y - motion.py) / dt;
      motion.vz = (z - motion.pz) / dt;
      motion.px = x;
      motion.py = y;
      motion.pz = z;
      if (!motion.landed) {
        if (!round) {
          // The top trails the pull, as anything drawn along by its base;
          // let go above its place, it rights itself as it is set down.
          const pulled = motion.phase === 0 ? 0.03 : 0;
          motion.leanTargetX = clamp(-motion.vx * pulled, -0.18, 0.18);
          motion.leanTargetZ = clamp(-motion.vz * pulled, -0.18, 0.18);
        }
        if (motion.phase === 1 && y - piece.y < LANDED && p > LANDED_PROGRESS) {
          motion.landed = true;
          motion.leanTargetX = 0;
          motion.leanTargetZ = 0;
          // It sets its weight down.
          motion.squash.velocity -= round ? 0.45 : 0.9;
        }
      }
      tick(motion.leanX, motion.leanTargetX, ACCIO_SPRINGS.lean, dt);
      tick(motion.leanZ, motion.leanTargetZ, ACCIO_SPRINGS.lean, dt);
      tick(motion.squash, 0, ACCIO_SPRINGS.squash, dt);
    },
    pose(motion, out) {
      const { piece } = motion;
      const flight = flights.get(piece.id);
      out.x = motion.px;
      out.y = motion.py;
      out.z = motion.pz;
      out.yaw = motion.yaw.value;
      out.leanX = motion.leanX.value;
      out.leanZ = motion.leanZ.value;
      out.pivot = pivotOf(piece);
      out.grow = clamp(motion.grow.value, 0, 1.02);
      out.squash = motion.squash.value;
      if (flight !== undefined && isRound(piece)) {
        // Tipped toward the viewer, and banked into its swing like a leaf.
        const tip = clamp(motion.pitch.value, -0.2, 1.2);
        const bank = tiltToward(flight.acrossX, flight.acrossZ, motion.sway.velocity * SWING_BANK);
        out.tiltX = flight.tipX * tip + bank.x;
        out.tiltZ = flight.tipZ * tip + bank.z;
      }
      // Its contact shadow gathers as it comes down, wide and faint at first.
      const above = Math.max(0, motion.py - piece.y);
      out.shadow = clamp(1 - above / 1.1, 0, 1) ** 2 * clamp(motion.grow.value, 0, 1);
      out.shadowSpread = 1 + above * 0.5;
    },
    settled(motion) {
      const { piece } = motion;
      if (!motion.landed || !rests(motion.travel, 1, REST.metres / 12)) return false;
      if (!rests(motion.alt, piece.y, REST.metres) || !rests(motion.grow, 1, REST.scale)) return false;
      if (!rests(motion.leanX, 0, REST.radians) || !rests(motion.leanZ, 0, REST.radians) || !rests(motion.squash, 0, REST.scale)) return false;
      if (!rests(motion.yaw, piece.rotationY, REST.radians)) return false;
      if (isRound(piece)) return rests(motion.sway, 0, REST.metres) && rests(motion.pitch, 0, REST.radians / TABLE_TIP);
      return true;
    },
  };
  return model;
}

// --- The plan -------------------------------------------------------------------------

/** Seconds from a piece's start until it lands, found by flying it on its own springs. */
function landingAfter(piece: AssemblyPiece, model: DirectionModel, graph: ChoreographyGraph): number {
  const motion: PieceMotion = createMotion(piece, 0);
  model.init(motion, graph);
  motion.started = true;
  for (let ticks = 1; ticks <= 20 * 240; ticks++) {
    motion.elapsed += ASSEMBLY_TICK;
    model.step(motion, ASSEMBLY_TICK);
    if (motion.landed) return ticks * ASSEMBLY_TICK;
  }
  return 20;
}

interface Stream {
  /** The last piece of any kind, and the last round, to leave this window. */
  last: number;
  lastRound: number;
  first: number;
}

function planAccio(
  base: ChoreographyGraph,
  pieces: readonly AssemblyPiece[],
  windows: readonly AccioWindow[],
  sources: Map<string, AccioWindow>,
  model: DirectionModel,
): DirectionPlan {
  const byId = new Map(pieces.map((piece) => [piece.id, piece]));
  const streams = new Map<string, Stream>(windows.map((window) => [window.id, {
    last: Number.NEGATIVE_INFINITY, lastRound: Number.NEGATIVE_INFINITY, first: Number.POSITIVE_INFINITY,
  }]));
  const emit = (window: AccioWindow, start: number, round: boolean): void => {
    const stream = streams.get(window.id);
    if (stream === undefined) return;
    stream.last = Math.max(stream.last, start);
    if (round) stream.lastRound = Math.max(stream.lastRound, start);
    stream.first = Math.min(stream.first, start);
  };
  const starts = new Map<string, number>();
  const landings = new Map<string, number>();
  const fly = (piece: AssemblyPiece, window: AccioWindow, start: number): void => {
    sources.set(piece.id, window);
    starts.set(piece.id, start);
    emit(window, start, isRound(piece));
    landings.set(piece.id, start + landingAfter(piece, model, base));
  };

  // Rounds and other large pieces in the waves' order at a steady cadence,
  // never before a round nearer the top table, each through whichever of its
  // two nearest windows (that it can pass) is free soonest, a far one weighed
  // by its longer flight, and never on the heels of the last round through it.
  const rounds = base.nodes
    .map((node) => byId.get(node.pieceId))
    .filter((piece): piece is AssemblyPiece => piece !== undefined && isRound(piece));
  let previous = Number.NEGATIVE_INFINITY;
  rounds.forEach((piece, rank) => {
    const wanted = Math.max(ACCIO_BEATS.anchorStart + rank * ACCIO_BEATS.tableCadence, previous + WAVE_STEP);
    let best: { readonly window: AccioWindow; readonly start: number; readonly cost: number } | null = null;
    for (const window of nearestWindows(windows, piece.x, true, piece.radius).slice(0, 2)) {
      const start = Math.max(wanted, (streams.get(window.id)?.lastRound ?? Number.NEGATIVE_INFINITY) + ACCIO_BEATS.tableGap);
      const cost = start + WINDOW_DISTANCE_COST * Math.abs(window.x - piece.x);
      if (best === null || cost < best.cost - 1e-9) best = { window, start, cost };
    }
    if (best === null) return;
    previous = best.start;
    fly(piece, best.window, best.start);
  });

  // Chairs: a table's only once it has landed, round it from the top table's
  // side; each through whichever of its two nearest windows is free soonest,
  // spaced along that window's stream. A chair without a table keeps its wave.
  const anchor = base.anchorId === null ? null : byId.get(base.anchorId) ?? null;
  const chairsByTable = new Map<string, AssemblyPiece[]>();
  const wanted: { readonly piece: AssemblyPiece; readonly at: number }[] = [];
  for (const piece of pieces) {
    if (piece.role !== "chair") continue;
    const table = piece.tableId === null ? undefined : byId.get(piece.tableId);
    if (table === undefined || !landings.has(table.id)) {
      wanted.push({ piece, at: base.byPiece.get(piece.id)?.start ?? ACCIO_BEATS.anchorStart });
      continue;
    }
    const list = chairsByTable.get(table.id) ?? [];
    list.push(piece);
    chairsByTable.set(table.id, list);
  }
  for (const [tableId, chairs] of chairsByTable) {
    const table = byId.get(tableId);
    const landed = landings.get(tableId);
    if (table === undefined || landed === undefined) continue;
    const ordered = [...chairs].sort((a, b) => seatsFromAnchor(a, table, anchor) - seatsFromAnchor(b, table, anchor)
      || a.seat - b.seat || (a.id < b.id ? -1 : 1));
    ordered.forEach((chair, index) => {
      wanted.push({ piece: chair, at: landed + ACCIO_BEATS.chairAfterLanding + index * ACCIO_BEATS.chairStagger });
    });
  }
  wanted.sort((a, b) => a.at - b.at || (a.piece.id < b.piece.id ? -1 : 1));
  for (const { piece, at } of wanted) {
    // Whichever of its three nearest windows lets it leave soonest, a far one
    // weighed by its longer flight: a busy end of the hall borrows a quiet window.
    let best: { readonly window: AccioWindow; readonly start: number; readonly cost: number } | null = null;
    for (const window of nearestWindows(windows, piece.x, false, piece.radius).slice(0, 3)) {
      const stream = streams.get(window.id);
      const start = Math.max(at,
        (stream?.last ?? Number.NEGATIVE_INFINITY) + ACCIO_BEATS.chairGap,
        (stream?.lastRound ?? Number.NEGATIVE_INFINITY) + ACCIO_BEATS.tableClear);
      const cost = start + WINDOW_DISTANCE_COST * Math.abs(window.x - piece.x);
      if (best === null || cost < best.cost - 1e-9) best = { window, start, cost };
    }
    if (best !== null) fly(piece, best.window, best.start);
  }

  // The candles on each table once its last chair is down.
  const dressing = new Map<string, number>();
  for (const piece of rounds) {
    if (piece.role !== "table") continue;
    const own = chairsByTable.get(piece.id) ?? [];
    const tableDown = landings.get(piece.id) ?? 0;
    const lastChair = Math.max(tableDown, ...own.map((chair) => landings.get(chair.id) ?? 0));
    // Never before the table itself is down.
    dressing.set(piece.id, Math.max(tableDown, lastChair + ACCIO_BEATS.candlesAfter));
  }

  const nodes: ChoreoNode[] = base.nodes.map((node) => ({ ...node, start: starts.get(node.pieceId) ?? node.start }));
  nodes.sort((a, b) => a.start - b.start || (a.pieceId < b.pieceId ? -1 : 1));
  const lights: RevealLight[] = [];
  for (const window of windows) {
    const stream = streams.get(window.id);
    if (stream === undefined || !Number.isFinite(stream.first)) continue;
    lights.push({ id: window.id, on: Math.max(0, stream.first - ACCIO_BEATS.lightLead), off: stream.last + ACCIO_BEATS.lightTail });
  }
  return {
    graph: { ...base, nodes, byPiece: new Map(nodes.map((node) => [node.pieceId, node])), dressing },
    lights,
  };
}
