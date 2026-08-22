import type { TwinNavEdge } from "@omnitwin/types";
import type { PublishedRoomSlug } from "../../lib/trades-hall-venue-truth.js";
import { VERIFIED_ROOM_NODES } from "../shell/twin-rooms.js";
import { MAX_USHER_HOPS, shortestRoute } from "../travel-route.js";
import type { TwinLook } from "../twin-look.js";
import { TOUR_BEATS, TOUR_DEFAULT_TITLE, tourCaption, type TourBeat } from "./tour-copy.js";

// -----------------------------------------------------------------------------
// tour-model — the guided tour, as data and pure functions.
//
// Matterport's highlight reel is the single most-used control on a Matterport
// tour, for a reason worth stating: most visitors will not drive. They will
// press play once and judge the building on what they are shown. So this module
// decides what they are shown, and it is deliberately the boring half of the
// feature — no timers, no React, no camera. It answers five questions:
//
//   which stops exist            buildDefaultTour / buildTour
//   what comes next              advanceStop / retreatStop
//   can we get there             stopReachable
//   how do we get there          resolveTourLeg / resolveTourRoute
//   how long will this take      tourDurationMs (+ hopDurationMs)
//
// THE ROOM-IDENTITY RULE, RESTATED HERE BECAUSE THIS IS WHERE IT WOULD BREAK
//
// Every manifest node carries `roomSlug: null`. twin-rooms.ts holds the five
// viewpoints a human validated against ground-truth photography, and returns
// nothing for the other 144. A guided tour is exactly the surface that wants to
// cheat: it is a curated sequence, curation implies knowing what is in each
// frame, and the temptation is to reach for proximity or floor bucket to fill it
// out. Telling a guest they are in the Grand Hall while they look at the Saloon
// is the worst thing this product can do, and a tour says it out loud, in a
// title card, in serif, for six seconds.
//
// So a stop is not constructible from a node id alone. buildTour looks every id
// up in VERIFIED_ROOM_NODES and DROPS the ones that miss — it does not throw,
// does not substitute, does not label it "Unknown room". The stop's slug is the
// looked-up value, never a parameter, and the caption is generated from that
// slug through tour-copy.ts, which has no free-text room-name path at all. The
// result is that there is no expression in this codebase that produces a tour
// stop naming a room the twin cannot verify — and tourNamesOnlyVerifiedRooms()
// is the assertion of that, run over the shipped tour by the suite.
//
// FRAMING IS OPTIONAL, AND THAT IS THE HONEST PART
//
// A stop carries `look: TwinLook | null`. Null means "arrive and leave the
// camera where the walk put it". Only ONE authored camera pose exists anywhere
// in this system — the manifest's `entryLook`, at `entryNodeId` (see
// packages/types/src/twin.ts and TwinViewer's initialLookRef). Nobody has
// recorded which way to face at scan_058, and a plausible-looking `yawDeg: 0`
// would be a made-up claim about what is in frame, aimed at a wall as often as
// at the room. So the default tour ships with no framing except whatever the
// caller passes in `looks`, which is how the venue's authored poses get in once
// they exist — one argument, no code change here.
// -----------------------------------------------------------------------------

/** One stop on the tour. Constructible only through buildTour(), which is what
 *  makes `slug` a looked-up fact rather than a caller's assertion. */
export interface TourStop {
  /** Manifest node id. Handed straight to the walk. */
  readonly nodeId: string;
  /** The verified room this viewpoint stands in. Never inferred, never widened. */
  readonly slug: PublishedRoomSlug;
  /** Where this stop sits in the sequence — derived, never authored. */
  readonly beat: TourBeat;
  /**
   * Authored camera pose, or null to arrive without touching the camera.
   * When present, `look.nodeId === nodeId` is an invariant the builder enforces:
   * a pose belonging to another viewpoint would aim the camera using angles
   * measured somewhere else.
   */
  readonly look: TwinLook | null;
  /** How long to stand here once arrived, in milliseconds. */
  readonly dwellMs: number;
  /** The title card. Generated from `slug` and `beat`; see tour-copy.ts. */
  readonly caption: string;
}

/** An ordered sequence of stops. */
export interface Tour {
  readonly id: string;
  readonly title: string;
  readonly stops: readonly TourStop[];
}

/**
 * How the walk should get to a stop.
 *
 *   stay   already standing there — nothing to travel, framing may still apply
 *   glide  the Usher: hand `hops` to the hop machine one neighbour at a time
 *   jump   one teleport straight to `nodeId`
 *
 * The ladder mirrors TwinViewer's own `usherTo` exactly, because a room reached
 * by the tour must move the same way as a room reached by naming it in the quick
 * rail. Two hand-maintained ladders would drift, and the drift would be visible:
 * one route glides, the identical route cuts.
 */
export type TourTravelMode = "stay" | "glide" | "jump";

export interface TourLeg {
  /** Destination viewpoint. */
  readonly nodeId: string;
  readonly mode: TourTravelMode;
  /** The Usher's queue — node ids EXCLUDING the origin, INCLUDING the target.
   *  Empty for `stay` and for `jump`, which needs no intermediate hops. */
  readonly hops: readonly string[];
  /**
   * Whether the nav graph actually connects origin to destination. False means
   * the leg fell back to a teleport because there is no route — worth knowing
   * separately from `mode`, since a route that is merely too long also jumps.
   */
  readonly reachable: boolean;
  /** The stop's framing, carried through so the caller reads one object. */
  readonly look: TwinLook | null;
}

export interface TourLegOptions {
  /**
   * Skip the glide and teleport. Set under prefers-reduced-motion: a chain of
   * spring-driven hops is exactly the sustained motion the preference asks us
   * not to run, and TwinViewer's `usherTo` already teleports for the same reason.
   */
  readonly instant?: boolean;
  /** Routes longer than this teleport instead. Defaults to MAX_USHER_HOPS so the
   *  tour and the minimap agree on what counts as a marathon. */
  readonly maxGlideHops?: number;
}

export interface TourStepOptions {
  /** Wrap past the ends instead of stopping. Off by default — an unattended
   *  tour that restarts forever is a screensaver, not a tour. */
  readonly loop?: boolean;
}

export interface BuildTourOptions {
  /**
   * Authored camera poses by node id. A pose whose own `nodeId` disagrees with
   * the key is ignored rather than trusted: it was measured somewhere else.
   */
  readonly looks?: Readonly<Record<string, TwinLook>>;
  /** How long to stand at each stop, in ms. */
  readonly dwellMs?: number;
  readonly title?: string;
  readonly id?: string;
}

/**
 * Six seconds at each stop.
 *
 * Long enough to read a one-line title card and let the eye cross the room;
 * short enough that five stops plus travel land under a minute, which is the
 * budget a visitor gives an autoplaying thing before reaching for the controls.
 */
export const DEFAULT_DWELL_MS = 6000;

/**
 * The default tour's order, and the only place it is written.
 *
 * Five viewpoints, four rooms — the entire validated set from twin-rooms.ts, in
 * the order a visitor would actually walk them: received, then through, then the
 * big room from both ends, then the small one. No unvalidated id appears here,
 * and one that crept in would be dropped by buildTour rather than rendered.
 */
export const DEFAULT_TOUR_NODE_ORDER: readonly string[] = [
  "scan_126",
  "scan_058",
  "scan_028",
  "scan_046",
  "scan_105",
];

/**
 * The crossfade value useTwinWalk calls "arrived" (its private HOP_ARRIVE_VALUE).
 *
 * Restated here because it is not exported, and pinned by the suite instead:
 * tour-model.test.ts derives the hop duration from the exported HOP_SPRING and
 * asserts it against this module, so a change to the walk's spring shows up as a
 * failing duration rather than as a tour estimate that quietly drifts.
 */
export const HOP_ARRIVE_VALUE = 0.995;

/**
 * How long one hop takes, in milliseconds, for a unit-mass spring.
 *
 * Not a guess and not a stopwatch reading: the analytic step response of
 *
 *   m·y" + c·y' + k·y = k,   y(0) = 0, y'(0) = 0
 *   ω₀ = √(k/m),  ζ = c/(2√(k·m))
 *
 *   ζ < 1   y(t) = 1 − e^(−ζω₀t)·( cos(ω_d t) + (ζω₀/ω_d)·sin(ω_d t) ),  ω_d = ω₀√(1−ζ²)
 *   ζ = 1   y(t) = 1 − (1 + ω₀t)·e^(−ω₀t)
 *   ζ > 1   y(t) = 1 − e^(−ζω₀t)·( cosh(ω_r t) + (ζω₀/ω_r)·sinh(ω_r t) ), ω_r = ω₀√(ζ²−1)
 *
 * scanned forward at 1 ms — the resolution the answer is wanted in anyway — for
 * the first time the response reaches `target`. A forward scan rather than a
 * bisection because an underdamped spring's response is not monotonic, so the
 * FIRST crossing is the arrival and a bisection would happily return a later one.
 *
 * The walk's own spring (HOP_SPRING: stiffness 120, damping 22, mass 1) is a
 * whisker overdamped — ζ = 1.004 — and settles to 0.995 in a little under 0.7 s.
 * The caller supplies the parameters; this module deliberately does not import
 * them, so the pure model stays free of React, react-spring and the router.
 */
export function hopDurationMs(
  stiffness: number,
  damping: number,
  target: number = HOP_ARRIVE_VALUE,
  mass = 1,
): number {
  if (stiffness <= 0 || mass <= 0 || damping < 0) {
    return 0;
  }
  const omega0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const response = (t: number): number => {
    const decay = Math.exp(-zeta * omega0 * t);
    if (Math.abs(zeta - 1) < 1e-9) {
      return 1 - (1 + omega0 * t) * decay;
    }
    if (zeta < 1) {
      const wd = omega0 * Math.sqrt(1 - zeta * zeta);
      return 1 - decay * (Math.cos(wd * t) + ((zeta * omega0) / wd) * Math.sin(wd * t));
    }
    const wr = omega0 * Math.sqrt(zeta * zeta - 1);
    return 1 - decay * (Math.cosh(wr * t) + ((zeta * omega0) / wr) * Math.sinh(wr * t));
  };
  // Ten seconds is far past any spring this viewer uses; the cap exists so a
  // pathological (k, c) cannot spin here rather than to bound a real answer.
  const LIMIT_MS = 10_000;
  for (let ms = 1; ms <= LIMIT_MS; ms += 1) {
    if (response(ms / 1000) >= target) {
      return ms;
    }
  }
  return LIMIT_MS;
}

/**
 * Which beat a stop sits on, derived from its neighbours in the list.
 *
 * Derived rather than authored so it cannot lie: "again" is emitted if and only
 * if the previous stop is in the same verified room, which is the only condition
 * under which tour-copy's "from elsewhere in the room" is true.
 */
function beatFor(
  position: number,
  total: number,
  previousSlug: PublishedRoomSlug | null,
  slug: PublishedRoomSlug,
): TourBeat {
  if (previousSlug === slug) {
    return "again";
  }
  if (position === 0) {
    return "open";
  }
  return position === total - 1 ? "last" : "onward";
}

/**
 * Build a tour from an ordered list of node ids.
 *
 * Ids whose room twin-rooms.ts has not validated are DROPPED, silently and by
 * design. The alternatives are all worse: throwing turns a data slip into a dead
 * route, and substituting a placeholder puts an unnamed stop in a sequence whose
 * whole promise is that it knows where it is taking you. A dropped stop is a
 * shorter tour; a kept one is a lie with a serif face on it.
 */
export function buildTour(nodeIds: readonly string[], options: BuildTourOptions = {}): Tour {
  const dwellMs = options.dwellMs ?? DEFAULT_DWELL_MS;
  const looks = options.looks;
  const verified: { nodeId: string; slug: PublishedRoomSlug }[] = [];
  for (const nodeId of nodeIds) {
    const slug = VERIFIED_ROOM_NODES[nodeId];
    if (slug !== undefined) {
      verified.push({ nodeId, slug });
    }
  }

  const stops: TourStop[] = verified.map(({ nodeId, slug }, position) => {
    const previous = verified[position - 1];
    const beat = beatFor(position, verified.length, previous?.slug ?? null, slug);
    const authored = looks?.[nodeId];
    // A pose that names a different viewpoint was measured from somewhere else;
    // applying it here would aim the camera with another room's angles.
    const look = authored !== undefined && authored.nodeId === nodeId ? authored : null;
    return { nodeId, slug, beat, look, dwellMs, caption: tourCaption(beat, slug) };
  });

  return {
    id: options.id ?? "default",
    title: options.title ?? TOUR_DEFAULT_TITLE,
    stops,
  };
}

/** The shipped tour: the five validated viewpoints, in walking order. */
export function buildDefaultTour(options: BuildTourOptions = {}): Tour {
  return buildTour(DEFAULT_TOUR_NODE_ORDER, options);
}

/** True when `index` addresses a real stop. */
function inRange(tour: Tour, index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < tour.stops.length;
}

/**
 * The stop after `index`, or null at the end of a non-looping tour.
 *
 * An out-of-range or non-integer index enters at the FIRST stop rather than
 * returning null. That is the wrapping rule for the case that actually happens —
 * a host starting the tour from "nowhere" (-1, or a stale index into a tour that
 * has since been rebuilt shorter) — and null there would read as "the tour is
 * over" before it began.
 */
export function advanceStop(
  tour: Tour,
  index: number,
  options: TourStepOptions = {},
): number | null {
  if (tour.stops.length === 0) {
    return null;
  }
  if (!inRange(tour, index)) {
    return 0;
  }
  if (index < tour.stops.length - 1) {
    return index + 1;
  }
  return options.loop === true ? 0 : null;
}

/** The stop before `index`, or null at the start of a non-looping tour. An
 *  out-of-range index enters at the LAST stop, the mirror of advanceStop. */
export function retreatStop(
  tour: Tour,
  index: number,
  options: TourStepOptions = {},
): number | null {
  if (tour.stops.length === 0) {
    return null;
  }
  if (!inRange(tour, index)) {
    return tour.stops.length - 1;
  }
  if (index > 0) {
    return index - 1;
  }
  return options.loop === true ? tour.stops.length - 1 : null;
}

/** Where in the tour a viewpoint sits, or null when it is not a stop. Lets a
 *  host re-sync the tour when the visitor walks to a stop under their own steam
 *  instead of leaving the caption naming the room they have left. */
export function stopIndexAtNode(tour: Tour, nodeId: string): number | null {
  const index = tour.stops.findIndex((stop) => stop.nodeId === nodeId);
  return index === -1 ? null : index;
}

/**
 * Whether the walk can actually reach a stop over the nav graph.
 *
 * Standing on it counts as reachable. Everything else asks travel-route.ts,
 * because the nav graph is the only thing that knows whether two viewpoints are
 * connected — a tour stop in a wing whose edges never made it into the manifest
 * is unreachable however close it looks on the minimap.
 */
export function stopReachable(
  tour: Tour,
  fromNodeId: string,
  index: number,
  edges: readonly TwinNavEdge[],
): boolean {
  const stop = tour.stops[index];
  if (stop === undefined) {
    return false;
  }
  if (stop.nodeId === fromNodeId) {
    return true;
  }
  return shortestRoute(fromNodeId, stop.nodeId, edges) !== null;
}

/**
 * How to get from `fromNodeId` to one stop.
 *
 * The fallback ladder is TwinViewer's `usherTo`, restated as a value so it can
 * be tested without a camera: reduced motion teleports, an unreachable or
 * marathon route teleports, everything else glides the real corridor.
 */
export function resolveTourLeg(
  fromNodeId: string,
  stop: TourStop,
  edges: readonly TwinNavEdge[],
  options: TourLegOptions = {},
): TourLeg {
  if (fromNodeId === stop.nodeId) {
    return { nodeId: stop.nodeId, mode: "stay", hops: [], reachable: true, look: stop.look };
  }

  const maxGlideHops = options.maxGlideHops ?? MAX_USHER_HOPS;
  const route = shortestRoute(fromNodeId, stop.nodeId, edges);
  const reachable = route !== null;

  if (
    options.instant === true ||
    route === null ||
    route.length === 0 ||
    route.length > maxGlideHops
  ) {
    return { nodeId: stop.nodeId, mode: "jump", hops: [], reachable, look: stop.look };
  }
  return { nodeId: stop.nodeId, mode: "glide", hops: route, reachable: true, look: stop.look };
}

/**
 * The whole tour resolved to the hop sequence it will actually walk, one leg per
 * stop, chained — each leg departs from the previous stop, not from the start.
 *
 * This is what makes the duration estimate honest and what lets a host prefetch
 * panos along the route. It is a pure projection: nothing here moves anything.
 */
export function resolveTourRoute(
  tour: Tour,
  startNodeId: string,
  edges: readonly TwinNavEdge[],
  options: TourLegOptions = {},
): readonly TourLeg[] {
  const legs: TourLeg[] = [];
  let from = startNodeId;
  for (const stop of tour.stops) {
    const leg = resolveTourLeg(from, stop, edges, options);
    legs.push(leg);
    from = stop.nodeId;
  }
  return legs;
}

export interface TourDurationOptions extends TourLegOptions {
  /**
   * Milliseconds for one hop. Required, and deliberately so: this module does
   * not know the viewer's spring and will not invent one. Callers derive it with
   * hopDurationMs(HOP_SPRING.stiffness, HOP_SPRING.damping).
   */
  readonly hopMs: number;
}

/**
 * Roughly how long the tour takes end to end: every dwell, plus the travel
 * between stops. A teleport still costs one crossfade, so a jump is charged one
 * hop rather than nothing.
 *
 * "Roughly" is load-bearing — it excludes tile loading, which depends on the
 * visitor's connection, so the figure is only ever rendered with "about".
 */
export function tourDurationMs(
  tour: Tour,
  startNodeId: string,
  edges: readonly TwinNavEdge[],
  options: TourDurationOptions,
): number {
  const legs = resolveTourRoute(tour, startNodeId, edges, options);
  const travel = legs.reduce((total, leg) => {
    if (leg.mode === "stay") {
      return total;
    }
    return total + (leg.mode === "jump" ? options.hopMs : leg.hops.length * options.hopMs);
  }, 0);
  const dwell = tour.stops.reduce((total, stop) => total + stop.dwellMs, 0);
  return dwell + travel;
}

/**
 * The gate: does this tour claim only rooms the twin can verify?
 *
 * Two conditions, and both matter. Every stop's slug must be the value
 * VERIFIED_ROOM_NODES returns for its own node id — so a stop cannot carry a
 * room bound to a different viewpoint. And every caption must be exactly one of
 * the four sentences tour-copy generates for THAT slug — so a hand-written
 * caption, or one naming another room, fails even though the slug is correct.
 *
 * Exported rather than left inside the suite because it is a runtime invariant a
 * host can assert over a tour assembled from configuration, not only over the
 * one this module ships.
 */
export function tourNamesOnlyVerifiedRooms(tour: Tour): boolean {
  return tour.stops.every((stop) => {
    if (VERIFIED_ROOM_NODES[stop.nodeId] !== stop.slug) {
      return false;
    }
    return TOUR_BEATS.some((beat) => tourCaption(beat, stop.slug) === stop.caption);
  });
}
