import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { TwinManifest } from "@omnitwin/types";
import {
  stepSpring,
  type SpringConfig,
  type SpringState,
} from "../lib/springs.js";
import {
  appendToGlideRoute,
  buildGlideRoute,
  segmentAlongRoute,
  stopArcForRelease,
  tangentAlongRoute,
  type GlideRoute,
} from "./glide-route.js";
import { prefersReducedMotion } from "./reduced-motion.js";

// -----------------------------------------------------------------------------
// useTwinGlide — continuous, cinematic movement for the twin walkthrough.
//
// The successor to useTwinWalk's hop machine, and a strict superset of its
// contract: currentId / targetId / progress / neighbors / hopTo mean exactly
// what they meant, so every stage (the two-pano crossfade, ParallaxStage, the
// camera dolly) renders a glide with no knowledge that anything changed. What
// changed is BETWEEN the segments: instead of spring-to-1, settle, React
// round-trip, spring again — the cadence that read as "flipping through
// pictures" — one scalar `s` (metres along a route polyline) advances under a
// velocity spring, and segment endpoints + fraction are DERIVED from it each
// frame. Crossing a node commits it and rolls the crossfade forward without a
// single resting frame.
//
// The walk's grammar, preserved deliberately:
// - a TAP travels exactly one node, like the hop it replaces;
// - HOLDING extends the route through the travel cone while it lasts
//   (registerNextPicker — TravelControls owns the camera-relative cone);
// - RELEASING eases out onto the next node ahead, never backward, so stills
//   are always AT a scan centre where the photography is perfect;
// - the minimap/rooms ride (glideAlong) cruises a whole Dijkstra route with
//   no per-hop settles — the Usher finally glides the way it always claimed;
// - the URL gains ONE history entry per journey, written at the stop;
//   back/forward and external edits still swap instantly and cancel motion;
// - reduced motion keeps instant teleports throughout.
//
// `restId` names the node of the last STILL frame — announcements, the room
// dossier and share links speak about where you STAND, not every node the
// glide sweeps through at 1.2 m/s.
//
// Design: docs/handoffs/2026-07-10-chatgpt-implementation-brief.md (TASK 1).
// -----------------------------------------------------------------------------

/** Cruise speed along the route — a camera operator's walking gimbal, not a
 *  sprint (the brief's 1.1–1.3 m/s band). */
export const GLIDE_CRUISE_M_S = 1.2;

/** Velocity spring toward cruise (ζ ≈ 1.03) — ~0.6 s of ease-in, no wobble. */
export const GLIDE_ACCEL_SPRING: SpringConfig = { stiffness: 40, damping: 13 };

/** Arc-position spring for the ease-out onto the stop node (ζ ≈ 1.0). Seeded
 *  with the live cruise velocity, so braking is continuous with the glide. */
export const GLIDE_STOP_SPRING: SpringConfig = { stiffness: 30, damping: 11 };

/** How close to the route's end (metres) the walker asks for an extension —
 *  far enough out that a granted node splices in with no velocity dip. */
export const GLIDE_EXTEND_LOOKAHEAD_M = 2.5;

/** Remaining metres at which an inextensible cruise engages its ease-out. */
const GLIDE_STOP_ENGAGE_M = 1.4;

/** The stop lands when s is within a hair of the node and motion has died. */
const GLIDE_SETTLE_ARC_M = 0.005;
const GLIDE_SETTLE_V_M_S = 0.02;

/** Asks the input layer for the node to extend a held glide with: from the
 *  route's tail, excluding the node the tail was reached from. Null means the
 *  cone found nothing and the glide will ease out at the tail. */
export type GlideNextPicker = (fromId: string, prevId: string | null) => string | null;

export interface TwinGlide {
  /** The segment-start node — the hop origin while motion is in flight. */
  readonly currentId: string;
  /** The segment-end node fading in, or null at rest. */
  readonly targetId: string | null;
  /** Segment-level progress STATE: 0 at rest and at every segment commit.
   *  The per-frame fraction lives in progressRef — publishing it through
   *  React state re-rendered the entire viewer at rAF cadence, which
   *  measurement showed was the ride's whole main-thread cost. */
  readonly progress: number;
  /** The live 0→1 fraction through the active segment, written every walker
   *  tick — read inside useFrame by the dolly and the stages, never rendered. */
  readonly progressRef: { readonly current: number };
  /** The node of the last still frame — where the visitor last STOOD. */
  readonly restId: string;
  /** Nav-graph partners of currentId — where the gold rings stand. */
  readonly neighbors: readonly string[];
  /** Nav-graph partners of any node — the extension picker's cone input. */
  readonly neighborsOf: (id: string) => readonly string[];
  /** True while a glide is in flight (same truth as targetId !== null). */
  readonly gliding: boolean;
  /** Horizontal route tangent [x, z] while gliding, else null. A ref — read
   *  per frame by the camera dolly, never through React state. */
  readonly tangentRef: { readonly current: readonly [number, number] | null };
  /** One-segment travel to a neighbour (or anywhere with teleport) — the
   *  compat verb every existing control speaks. */
  readonly hopTo: (id: string, opts?: { readonly teleport?: boolean }) => void;
  /** Cruise a full node path (the Usher). Ignored while already gliding. */
  readonly glideAlong: (nodeIds: readonly string[]) => void;
  /** Hold-to-walk intent: true keeps extending; false eases out to a node. */
  readonly setHeld: (held: boolean) => void;
  /** Wire the camera-owning input layer in; returns the unregister. */
  readonly registerNextPicker: (picker: GlideNextPicker) => () => void;
  /** Land instantly on the release-rule node — for surfaces that must leave
   *  the walk NOW (a mode switch) without abandoning motion mid-segment. */
  readonly settleInstantly: () => void;
}

interface WalkerState {
  route: GlideRoute;
  /** Metres along the route. */
  s: number;
  /** Metres per second along the route. */
  v: number;
  phase: "cruise" | "stopping";
  /** Where this ride ends (arc metres). The route's total while riding; a
   *  release LOWERS it to the release rule's node. The cruise only hands over
   *  to the stop spring inside GLIDE_STOP_ENGAGE_M of it, so braking always
   *  begins from cruise speed — a spring stretched across a whole segment
   *  would peak far above walking pace. */
  stopArc: number;
  /** +1 when the stop is approached from below, −1 from above (a snap-back
   *  to a just-passed node). The landing clamp uses it: the spring's last
   *  half-millimetre may cross the node boundary, and an s that slips onto
   *  the next segment for one frame would remount the crossfade stages. */
  stopDir: 1 | -1;
  /** Index of the segment most recently committed to React state. */
  committedIndex: number;
}

export function useTwinGlide(manifest: TwinManifest): TwinGlide {
  const [searchParams, setSearchParams] = useSearchParams();

  const nodeIds = useMemo(
    () => new Set(manifest.nodes.map((node) => node.id)),
    [manifest],
  );

  const nodesById = useMemo(
    () => new Map(manifest.nodes.map((node) => [node.id, node])),
    [manifest],
  );

  /** Undirected adjacency — every edge contributes both directions. */
  const adjacency = useMemo(() => {
    const map = new Map<string, string[]>();
    const link = (from: string, to: string): void => {
      const list = map.get(from);
      if (list === undefined) {
        map.set(from, [to]);
      } else {
        list.push(to);
      }
    };
    for (const edge of manifest.edges) {
      link(edge.a, edge.b);
      link(edge.b, edge.a);
    }
    return map;
  }, [manifest]);

  const fallbackId = useMemo(() => {
    const entry = manifest.entryNodeId;
    if (entry !== undefined && nodeIds.has(entry)) {
      return entry;
    }
    if (nodeIds.has("scan_000")) {
      return "scan_000";
    }
    return manifest.nodes[0]?.id ?? "scan_000";
  }, [manifest, nodeIds]);

  const [currentId, setCurrentId] = useState<string>(() => {
    const param = searchParams.get("node");
    return param !== null && nodeIds.has(param) ? param : fallbackId;
  });
  const [targetId, setTargetId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [restId, setRestId] = useState(currentId);

  // Refs mirror the walk position for the rAF loop and event-time reads.
  const currentIdRef = useRef(currentId);
  const restIdRef = useRef(currentId);
  const progressRef = useRef(0);
  const walkerRef = useRef<WalkerState | null>(null);
  const heldRef = useRef(false);
  const pickerRef = useRef<GlideNextPicker | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const tangentRef = useRef<readonly [number, number] | null>(null);

  const cancelLoop = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  /** Set ?node= while preserving any other params the page carries. */
  const writeNodeParam = useCallback(
    (id: string, mode: "push" | "replace") => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.set("node", id);
          return next;
        },
        { replace: mode === "replace" },
      );
    },
    [setSearchParams],
  );

  /** Land on a node: end any glide, swap state, optionally write the URL. */
  const arriveAt = useCallback(
    (id: string, write: "push" | "replace" | "none") => {
      cancelLoop();
      walkerRef.current = null;
      tangentRef.current = null;
      progressRef.current = 0;
      currentIdRef.current = id;
      restIdRef.current = id;
      setCurrentId(id);
      setTargetId(null);
      setProgress(0);
      setRestId(id);
      if (write !== "none") {
        writeNodeParam(id, write);
      }
    },
    [cancelLoop, writeNodeParam],
  );

  /** One walker frame: advance s, extend or engage the stop, commit the
   *  derived segment to React state, land when the stop settles. */
  const tick = useCallback(
    (dtSeconds: number): void => {
      const walker = walkerRef.current;
      if (walker === null) {
        return;
      }
      const dt = Math.min(Math.max(dtSeconds, 0), 0.25);

      if (walker.phase === "cruise") {
        // Velocity toward cruise speed, then distance under it.
        const v: SpringState = { value: walker.v, velocity: 0 };
        stepSpring(v, GLIDE_CRUISE_M_S, dt, GLIDE_ACCEL_SPRING);
        walker.v = v.value;
        walker.s += walker.v * dt;

        // A held key keeps asking the cone for more route before it runs out;
        // a granted node also moves the ride's end out with it.
        if (
          heldRef.current &&
          pickerRef.current !== null &&
          walker.route.total - walker.s < GLIDE_EXTEND_LOOKAHEAD_M
        ) {
          const tailIndex = walker.route.nodeIds.length - 1;
          const tail = walker.route.nodeIds[tailIndex];
          const prev = walker.route.nodeIds[tailIndex - 1] ?? null;
          if (tail !== undefined) {
            const next = pickerRef.current(tail, prev);
            if (next !== null) {
              const extended = appendToGlideRoute(walker.route, next, nodesById);
              if (extended !== null) {
                walker.route = extended;
                walker.stopArc = extended.total;
              }
            }
          }
        }

        // Inside the engage window of the ride's end: hand over to the stop
        // spring, seeded with the live cruise velocity. A snap-back stop
        // (release just past a node) has a NEGATIVE window and engages at
        // once.
        if (walker.stopArc - walker.s < GLIDE_STOP_ENGAGE_M) {
          walker.phase = "stopping";
          walker.stopDir = walker.stopArc >= walker.s ? 1 : -1;
        }
      } else {
        const s: SpringState = { value: walker.s, velocity: walker.v };
        stepSpring(s, walker.stopArc, dt, GLIDE_STOP_SPRING);
        // The landing clamp: never let the spring's tail cross the node — a
        // one-frame trespass onto the next segment would remount the stages.
        walker.s =
          walker.stopDir === 1
            ? Math.min(s.value, walker.stopArc)
            : Math.max(s.value, walker.stopArc);
        walker.v = s.velocity;
        if (
          Math.abs(walker.s - walker.stopArc) < GLIDE_SETTLE_ARC_M &&
          Math.abs(walker.v) < GLIDE_SETTLE_V_M_S
        ) {
          const segment = segmentAlongRoute(walker.route, walker.stopArc);
          const landed = segment.frac >= 0.5 ? segment.toId : segment.fromId;
          arriveAt(landed, "push");
          return;
        }
      }

      const segment = segmentAlongRoute(walker.route, walker.s);
      tangentRef.current = tangentAlongRoute(walker.route, walker.s);
      progressRef.current = Math.min(Math.max(segment.frac, 0), 1);
      if (segment.index !== walker.committedIndex) {
        // The ONLY React work in a moving frame, and only on node crossings
        // (~0.6/s at cruise): roll the crossfade's endpoints forward.
        walker.committedIndex = segment.index;
        currentIdRef.current = segment.fromId;
        setCurrentId(segment.fromId);
        setTargetId(segment.toId);
        setProgress(0);
      }
    },
    [arriveAt, nodesById],
  );

  const startLoop = useCallback((): void => {
    cancelLoop();
    let lastTimestamp: number | null = null;
    const frame = (timestamp: number): void => {
      const dtSeconds =
        lastTimestamp === null ? 1 / 60 : Math.max((timestamp - lastTimestamp) / 1000, 0);
      lastTimestamp = timestamp;
      tick(dtSeconds);
      if (walkerRef.current !== null) {
        rafIdRef.current = requestAnimationFrame(frame);
      } else {
        rafIdRef.current = null;
      }
    };
    rafIdRef.current = requestAnimationFrame(frame);
  }, [cancelLoop, tick]);

  /** Begin a glide over the given node path (which starts at currentId). */
  const startGlide = useCallback(
    (path: readonly string[]): void => {
      const route = buildGlideRoute(path, nodesById);
      if (route === null) {
        return;
      }
      const firstSegment = segmentAlongRoute(route, 0);
      walkerRef.current = {
        route,
        s: 0,
        v: 0,
        phase: "cruise",
        stopArc: route.total,
        stopDir: 1,
        committedIndex: 0,
      };
      tangentRef.current = tangentAlongRoute(route, 0);
      progressRef.current = 0;
      setTargetId(firstSegment.toId);
      setProgress(0);
      startLoop();
    },
    [nodesById, startLoop],
  );

  const hopTo = useCallback(
    (id: string, opts?: { readonly teleport?: boolean }) => {
      const teleport = opts?.teleport === true;
      if (!nodeIds.has(id) || id === currentIdRef.current) {
        return;
      }
      if (walkerRef.current !== null) {
        // A glide is in flight; only a teleport may cut across it.
        if (!teleport) {
          return;
        }
      } else if (!teleport) {
        const neighborsOfCurrent = adjacency.get(currentIdRef.current) ?? [];
        if (!neighborsOfCurrent.includes(id)) {
          return;
        }
      }

      if (teleport || prefersReducedMotion()) {
        arriveAt(id, "push");
        return;
      }

      startGlide([currentIdRef.current, id]);
    },
    [adjacency, arriveAt, nodeIds, startGlide],
  );

  const glideAlong = useCallback(
    (path: readonly string[]) => {
      if (walkerRef.current !== null) {
        return; // the caller decides how to interrupt (today: teleport)
      }
      const full =
        path[0] === currentIdRef.current ? path : [currentIdRef.current, ...path];
      const destination = full[full.length - 1];
      if (destination === undefined || !full.every((id) => nodeIds.has(id))) {
        return;
      }
      if (destination === currentIdRef.current) {
        return;
      }
      if (prefersReducedMotion()) {
        arriveAt(destination, "push");
        return;
      }
      startGlide(full);
    },
    [arriveAt, nodeIds, startGlide],
  );

  const setHeld = useCallback((held: boolean) => {
    heldRef.current = held;
    const walker = walkerRef.current;
    if (walker === null || walker.phase !== "cruise") {
      return;
    }
    if (held) {
      // A re-press before the ease-out engaged un-shortens the ride: the
      // remaining route is back on the table, and extension grows it again.
      walker.stopArc = walker.route.total;
      return;
    }
    // Lower the ride's end to the release rule's node; the cruise carries
    // on and the tick's engage window hands over to the stop spring —
    // immediately for a snap-back, a beat later for a node still ahead.
    walker.stopArc = stopArcForRelease(walker.route, walker.s);
  }, []);

  const registerNextPicker = useCallback((picker: GlideNextPicker) => {
    pickerRef.current = picker;
    return () => {
      if (pickerRef.current === picker) {
        pickerRef.current = null;
      }
    };
  }, []);

  const settleInstantly = useCallback(() => {
    const walker = walkerRef.current;
    if (walker === null) {
      return;
    }
    const arc =
      walker.phase === "stopping"
        ? walker.stopArc
        : stopArcForRelease(walker.route, walker.s);
    const segment = segmentAlongRoute(walker.route, arc);
    arriveAt(segment.frac >= 0.5 ? segment.toId : segment.fromId, "push");
  }, [arriveAt]);

  // URL → walk. A valid external param change (back/forward, hand-edited URL)
  // is an instant, springless swap that cancels any glide; a missing or
  // unknown param is canonicalised back to the resting node without history.
  useEffect(() => {
    const param = searchParams.get("node");
    if (param !== null && nodeIds.has(param)) {
      if (param !== currentIdRef.current) {
        arriveAt(param, "none");
      }
      return;
    }
    writeNodeParam(restIdRef.current, "replace");
  }, [searchParams, nodeIds, arriveAt, writeNodeParam]);

  // Never leave a frame loop running after unmount.
  useEffect(() => cancelLoop, [cancelLoop]);

  const neighbors = useMemo(
    () => adjacency.get(currentId) ?? [],
    [adjacency, currentId],
  );

  const neighborsOf = useCallback(
    (id: string): readonly string[] => adjacency.get(id) ?? [],
    [adjacency],
  );

  // Memoized: consumers put the whole object in dependency arrays ("re-run
  // when the walk changed"), and a fresh literal per render would turn those
  // into run-every-render (review finding). Identity now changes exactly when
  // a field does.
  return useMemo(
    () => ({
      currentId,
      targetId,
      progress,
      progressRef,
      restId,
      neighbors,
      neighborsOf,
      gliding: targetId !== null,
      tangentRef,
      hopTo,
      glideAlong,
      setHeld,
      registerNextPicker,
      settleInstantly,
    }),
    [
      currentId,
      targetId,
      progress,
      restId,
      neighbors,
      neighborsOf,
      hopTo,
      glideAlong,
      setHeld,
      registerNextPicker,
      settleInstantly,
    ],
  );
}
