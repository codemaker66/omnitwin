import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { TwinManifest } from "@omnitwin/types";
import {
  stepSpring,
  type SpringConfig,
  type SpringState,
} from "../lib/springs.js";
import { prefersReducedMotion } from "./reduced-motion.js";

// -----------------------------------------------------------------------------
// useTwinWalk — the hop state machine for the twin walkthrough.
//
// One spring (house rule: springs, never tweens) drives `progress` 0→1 over a
// requestAnimationFrame loop while a hop is in flight; TwinViewer reads it to
// crossfade the two PanoStages and dolly the camera. State updates stay at
// rAF cadence — the Canvas consumers receive them as plain props.
//
// The URL (?node=scan_NNN) is the walk's source of truth for navigation
// history: a settled hop (and a teleport) pushes one entry, so back/forward
// walk the visited nodes; an external param change (back button, hand-edited
// URL) swaps nodes instantly with no spring. The origin's entry is never
// replaced mid-hop — replacing it would clobber the node the visitor came
// from and break walking backward.
//
// Plan: docs/superpowers/plans/2026-07-02-twin-phase1-walk.md (Task 9).
// -----------------------------------------------------------------------------

/**
 * Hop spring — a smooth, slightly-overdamped glide (~0.65 s of visible motion)
 * so travel reads as gliding forward through the room, not a cut, yet stays
 * brisk enough that hold-to-walk chains these glides into continuous, flowing
 * game-feel movement. ζ≈1.0 (no wobble). The camera dolly, the two-pano
 * crossfade and the fov breath all ride this one spring.
 */
export const HOP_SPRING: SpringConfig = { stiffness: 120, damping: 22 };

/**
 * Arrive when the crossfade is VISUALLY complete, not when the spring is
 * mathematically settled. `isSpringSettled`'s 0.001 epsilon grinds a long
 * invisible tail (0.99→0.999) — dead time that also blocks the next glide, so
 * a held key can't chain. At 0.995 the target pano is fully opaque and the
 * camera has effectively arrived; ending here makes hops crisp and hold-to-
 * walk flow. Safe because the spring is overdamped (monotonic, no overshoot).
 */
const HOP_ARRIVE_VALUE = 0.995;

export interface TwinWalk {
  /** The node you are standing on (the hop origin while one is in flight). */
  readonly currentId: string;
  /** The node being hopped to, or null when at rest. */
  readonly targetId: string | null;
  /** 0→1 crossfade/dolly progress; 0 whenever no hop is in flight. */
  readonly progress: number;
  /** Nav-graph partners of the current node — where the gold rings stand. */
  readonly neighbors: readonly string[];
  /**
   * Walk to a node. Ids that are neither nav-graph neighbors of the current
   * node nor requested with `teleport: true` (the minimap's mode) are
   * silently ignored, as are unknown ids and hops issued mid-hop.
   */
  readonly hopTo: (id: string, opts?: { readonly teleport?: boolean }) => void;
}

export function useTwinWalk(manifest: TwinManifest): TwinWalk {
  const [searchParams, setSearchParams] = useSearchParams();

  const nodeIds = useMemo(
    () => new Set(manifest.nodes.map((node) => node.id)),
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
    // The manifest's hero viewpoint opens the walk when the URL names no node.
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

  // Refs mirror the walk position for the rAF loop and event-time reads —
  // hopTo must see the live values, not a stale render's closure.
  const currentIdRef = useRef(currentId);
  const targetIdRef = useRef<string | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const cancelHopLoop = useCallback(() => {
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

  /** Land on a node: end any hop, swap state, optionally write the URL. */
  const arriveAt = useCallback(
    (id: string, write: "push" | "replace" | "none") => {
      cancelHopLoop();
      currentIdRef.current = id;
      targetIdRef.current = null;
      setCurrentId(id);
      setTargetId(null);
      setProgress(0);
      if (write !== "none") {
        writeNodeParam(id, write);
      }
    },
    [cancelHopLoop, writeNodeParam],
  );

  const hopTo = useCallback(
    (id: string, opts?: { readonly teleport?: boolean }) => {
      const teleport = opts?.teleport === true;
      if (!nodeIds.has(id) || id === currentIdRef.current) {
        return;
      }
      if (targetIdRef.current !== null) {
        // A hop is already in flight; only a teleport may cut across it.
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

      targetIdRef.current = id;
      setTargetId(id);
      setProgress(0);

      const spring: SpringState = { value: 0, velocity: 0 };
      let lastTimestamp: number | null = null;
      const tick = (timestamp: number): void => {
        const dtSeconds =
          lastTimestamp === null ? 1 / 60 : Math.max((timestamp - lastTimestamp) / 1000, 0);
        lastTimestamp = timestamp;
        stepSpring(spring, 1, dtSeconds, HOP_SPRING);
        if (spring.value >= HOP_ARRIVE_VALUE) {
          rafIdRef.current = null;
          arriveAt(id, "push");
          return;
        }
        setProgress(Math.min(Math.max(spring.value, 0), 1));
        rafIdRef.current = requestAnimationFrame(tick);
      };
      rafIdRef.current = requestAnimationFrame(tick);
    },
    [adjacency, arriveAt, nodeIds],
  );

  // URL → walk. A valid external param change (back/forward, hand-edited URL)
  // is an instant, springless swap; a missing or unknown param is
  // canonicalised back to the node underfoot without adding history.
  useEffect(() => {
    const param = searchParams.get("node");
    if (param !== null && nodeIds.has(param)) {
      if (param !== currentIdRef.current) {
        arriveAt(param, "none");
      }
      return;
    }
    writeNodeParam(currentIdRef.current, "replace");
  }, [searchParams, nodeIds, arriveAt, writeNodeParam]);

  // Never leave a frame loop running after unmount.
  useEffect(() => cancelHopLoop, [cancelHopLoop]);

  const neighbors = useMemo(
    () => adjacency.get(currentId) ?? [],
    [adjacency, currentId],
  );

  return { currentId, targetId, progress, neighbors, hopTo };
}
