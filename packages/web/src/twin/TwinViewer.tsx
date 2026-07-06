import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactElement,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Euler, PerspectiveCamera } from "three";
import type { TwinManifest, TwinScanNode } from "@omnitwin/types";
import { DollhouseStage, preloadDollhouse } from "./DollhouseStage.js";
import { NavMarkers } from "./NavMarkers.js";
import { TravelControls } from "./TravelControls.js";
import { PanoStage } from "./PanoStage.js";
import { e57PointToThree, e57QuatToThree } from "./twin-basis.js";
import {
  TWIN_DISCLOSURE,
  TWIN_MODE_DOLLHOUSE_LABEL,
  TWIN_MODE_GROUP_LABEL,
  TWIN_MODE_PLAN_LABEL,
  TWIN_MODE_WALK_LABEL,
  TWIN_SURFACE_LABEL,
  TWIN_VIEWER_ROLE,
  twinNodeLabel,
  twinViewerLabel,
  twinViewpointAnnouncement,
} from "./twin-copy.js";
import { TwinCoachHint } from "./TwinCoachHint.js";
import { TwinMinimap } from "./TwinMinimap.js";
import { TwinViewerControls } from "./TwinViewerControls.js";
import { useDive, type DiveDirection } from "./useDive.js";
import { useTwinMode, type TwinMode } from "./useTwinMode.js";
import { useTwinPrefetch } from "./useTwinPrefetch.js";
import { useTwinWalk } from "./useTwinWalk.js";
import { lookStateFromCamera, WalkControls } from "./WalkControls.js";

// -----------------------------------------------------------------------------
// TwinViewer — the walkable pano viewer (Twin Phase 1, Task 9).
//
// Composes the demand-frameloop Canvas: WalkControls (look/zoom springs), one
// PanoStage per live node — the current node fading out (1 − progress) and
// the hop target fading in (progress), keyed by node id so the settled
// target's textures survive the swap — plus the gold NavMarkers (hidden while
// a hop is in flight) and a CameraDolly that lerps the camera between the two
// node positions each frame from a ref, never React state.
//
// Outside the Canvas live the HUD pieces: the node label, the claim-safe
// disclosure line, and the TwinMinimap (Task 10) — its view cone follows the
// camera through YawProbe, a useFrame observer that lifts yaw into React
// state at most ~10 Hz and only when it moves more than 0.05 rad.
//
// Phase 2 (Task 5) adds the mode machine: a segmented control (top-right,
// only when the bundle carries a mesh) switches walk ⇄ dollhouse ⇄ plan.
// Walk renders the Phase-1 content unchanged; the mesh modes render
// DollhouseStage under OrbitControls (target = node-extent centroid). Plan
// mode currently shares the dollhouse stage with an overhead vantage — the
// true orthographic floorplan with per-floor slicing is the plan's Task 7.
// The minimap shows in walk mode only.
//
// Plan: docs/superpowers/plans/2026-07-02-twin-phase1-walk.md (Tasks 9–10)
// and …/2026-07-02-twin-phase2-dollhouse.md (Tasks 4–5).
// -----------------------------------------------------------------------------

interface DollyState {
  from: readonly [number, number, number];
  to: readonly [number, number, number];
  progress: number;
  /** Yaw (three YXZ) to face while travelling; null outside hops. */
  travelYaw: number | null;
  /** Changes per hop so the dolly captures a fresh start orientation. */
  hopKey: string;
}

/** Shortest signed angular distance a→b (radians). */
function shortestYawDelta(a: number, b: number): number {
  const raw = (b - a) % (Math.PI * 2);
  if (raw > Math.PI) {
    return raw - Math.PI * 2;
  }
  if (raw < -Math.PI) {
    return raw + Math.PI * 2;
  }
  return raw;
}

/** Scratch Euler for the dolly's travel turn — no per-frame allocation. */
const dollyEuler = new Euler(0, 0, 0, "YXZ");

/**
 * Travel fov breath — the Street-View surge: +4° at mid-hop, back to the
 * departing fov by settle. A pure function of the travel spring's progress
 * (sin π·p), so the breath and the dolly ride the SAME spring and can never
 * drift apart (house rule: springs, never tweens). Under
 * prefers-reduced-motion useTwinWalk teleports instead of springing, so no
 * travelling frame — and therefore no breath — ever runs.
 *
 * The surge is a *single-step* gesture only: on a chained hold-to-walk it is
 * suppressed to zero (finding [28]). A held key fires a fresh hop the instant
 * the last one settles, and a per-hop sin() would strobe the fov ~1.5×/s —
 * seasick, not smooth. So a walk that flows node-to-node keeps a rock-steady
 * fov (Street View / Matterport breathe none while travelling); only a
 * deliberate, isolated click-step gets the surge.
 */
export const HOP_FOV_BREATH_DEG = 4;

/**
 * A hop that begins within this long (ms) of the previous one being active is a
 * chained hold-to-walk step, not a fresh intent — its fov surge is suppressed.
 * The inter-hop gap is one React round-trip (settle → continue-on-settle effect
 * → next hop), tens of ms; 250 ms clears it with margin while a deliberate
 * second click a third of a second later still reads as isolated and surges.
 * Measured on the wall clock, not frame delta: under the demand frameloop no
 * frames render while idle, so a delta accumulator would stop counting.
 */
const HOP_CHAIN_WINDOW_MS = 250;

/**
 * Camera position = lerp(from, to, progress), read from a ref each frame so
 * per-frame motion never re-renders React. While a hop is travelling the
 * dolly also owns orientation (Street View arrival rule: you end up facing
 * the direction you moved) and breathes the fov: WalkControls is disabled
 * during hops and re-adopts the camera's orientation and fov when it
 * re-engages at settle — the settle branch restores the exact pre-hop fov so
 * the handover carries zero residue from the breath.
 */
function CameraDolly({
  dolly,
}: {
  readonly dolly: MutableRefObject<DollyState>;
}): null {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const hopStart = useRef<{
    key: string;
    yaw: number;
    pitch: number;
    fov: number;
    chained: boolean;
  } | null>(null);
  // Wall-clock stamp (ms) of the most recent in-flight hop frame. A fresh hop
  // that begins within HOP_CHAIN_WINDOW_MS of it is a hold-to-walk chain, so its
  // fov surge is suppressed. Seeded −∞ so the first hop of a session surges.
  const lastHopActiveMs = useRef(Number.NEGATIVE_INFINITY);

  useFrame(() => {
    const { from, to, progress, travelYaw, hopKey } = dolly.current;
    const x = from[0] + (to[0] - from[0]) * progress;
    const y = from[1] + (to[1] - from[1]) * progress;
    const z = from[2] + (to[2] - from[2]) * progress;
    if (camera.position.x !== x || camera.position.y !== y || camera.position.z !== z) {
      camera.position.set(x, y, z);
      invalidate();
    }

    if (travelYaw !== null && progress > 0 && progress < 1) {
      const now = performance.now();
      if (hopStart.current === null || hopStart.current.key !== hopKey) {
        dollyEuler.setFromQuaternion(camera.quaternion, "YXZ");
        hopStart.current = {
          key: hopKey,
          yaw: dollyEuler.y,
          pitch: dollyEuler.x,
          fov: camera instanceof PerspectiveCamera ? camera.fov : 75,
          chained: now - lastHopActiveMs.current < HOP_CHAIN_WINDOW_MS,
        };
      }
      lastHopActiveMs.current = now;
      const eased = progress * progress * (3 - 2 * progress); // smoothstep
      const start = hopStart.current;
      const yaw = start.yaw + shortestYawDelta(start.yaw, travelYaw) * eased;
      // Pitch is the visitor's to keep — gazing up at the dome should stay
      // gazing up as you walk. Only yaw eases, toward the heading of travel
      // (finding [26]); the old code leveled pitch to 0 and yanked the view.
      camera.quaternion.setFromEuler(dollyEuler.set(start.pitch, yaw, 0, "YXZ"));
      if (camera instanceof PerspectiveCamera) {
        // Isolated click-step surges; a chained hold-to-walk holds fov steady
        // so the walk glides instead of strobing the zoom (finding [28]).
        const surge = start.chained ? 0 : Math.sin(Math.PI * progress) * HOP_FOV_BREATH_DEG;
        camera.fov = start.fov + surge;
        camera.updateProjectionMatrix();
      }
      invalidate();
    } else if (progress <= 0 || progress >= 1) {
      if (hopStart.current !== null && camera instanceof PerspectiveCamera) {
        camera.fov = hopStart.current.fov;
        camera.updateProjectionMatrix();
        invalidate();
      }
      hopStart.current = null;
    }
  });

  return null;
}

interface DiveFlight {
  from: readonly [number, number, number];
  to: readonly [number, number, number];
  progress: number;
  fovFrom: number;
  fovTo: number;
  look: readonly [number, number, number];
}

/**
 * The dive's camera path: a quadratic bezier through a raised midpoint (the
 * camera swoops, never sinks), fov easing between the orbit's 50° and the
 * walk's 75°, gaze held on `look`. Reads a ref each frame — no React state.
 */
function DiveCamera({ flight }: { readonly flight: MutableRefObject<DiveFlight> }): null {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);

  useFrame(() => {
    const { from, to, progress, fovFrom, fovTo, look } = flight.current;
    const t = progress;
    const inv = 1 - t;
    const midX = (from[0] + to[0]) / 2;
    const midY = (from[1] + to[1]) / 2 + 2.5;
    const midZ = (from[2] + to[2]) / 2;
    camera.position.set(
      inv * inv * from[0] + 2 * inv * t * midX + t * t * to[0],
      inv * inv * from[1] + 2 * inv * t * midY + t * t * to[1],
      inv * inv * from[2] + 2 * inv * t * midZ + t * t * to[2],
    );
    camera.lookAt(look[0], look[1], look[2]);
    if (camera instanceof PerspectiveCamera) {
      camera.fov = fovFrom + (fovTo - fovFrom) * t;
      camera.updateProjectionMatrix();
    }
    invalidate();
  });

  return null;
}

/** Writes the live camera position into a ref (mesh modes) so a dot click
 *  can start the dive from exactly where the visitor is orbiting. */
function CameraProbe({
  position,
}: {
  readonly position: MutableRefObject<[number, number, number]>;
}): null {
  const camera = useThree((state) => state.camera);
  useFrame(() => {
    position.current[0] = camera.position.x;
    position.current[1] = camera.position.y;
    position.current[2] = camera.position.z;
  });
  return null;
}

/** Minimum yaw movement before the probe reports (radians). */
const YAW_PROBE_MIN_DELTA_RAD = 0.05;
/** Report cadence ceiling — ~10 Hz keeps minimap re-renders negligible. */
const YAW_PROBE_MIN_INTERVAL_MS = 100;

/**
 * Lifts the camera yaw into React state for the minimap's view cone —
 * throttled to ~10 Hz and gated on a 0.05 rad change so look-drags never
 * flood React with renders.
 */
function YawProbe({ onYaw }: { readonly onYaw: (yaw: number) => void }): null {
  const camera = useThree((state) => state.camera);
  const lastRef = useRef<{ yaw: number; at: number }>({ yaw: 0, at: 0 });

  useFrame(() => {
    if (!(camera instanceof PerspectiveCamera)) {
      return;
    }
    const { yaw } = lookStateFromCamera(camera);
    const now = performance.now();
    const last = lastRef.current;
    if (
      Math.abs(yaw - last.yaw) > YAW_PROBE_MIN_DELTA_RAD &&
      now - last.at >= YAW_PROBE_MIN_INTERVAL_MS
    ) {
      lastRef.current = { yaw, at: now };
      onYaw(yaw);
    }
  });

  return null;
}

/** Orbit tilt limit for the dollhouse — never under the floor plane. */
const DOLLHOUSE_MAX_POLAR_RAD = (85 * Math.PI) / 180;
/** Plan-mode interim tilt limit — keeps the vantage overhead until Task 7. */
const PLAN_MAX_POLAR_RAD = (30 * Math.PI) / 180;
/** Never let the orbit camera dolly closer than this (metres). */
const ORBIT_MIN_DISTANCE_M = 2;
/** Smallest orbit radius — tiny bundles still get a readable dollhouse. */
const ORBIT_MIN_RADIUS_M = 4;

interface NodeExtent {
  readonly center: [number, number, number];
  readonly radius: number;
}

/** Centroid + bounding radius of the node poses in three space. */
function nodeExtent(nodes: readonly TwinScanNode[]): NodeExtent {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const node of nodes) {
    const [x, y, z] = e57PointToThree(node.pose.t);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  if (!Number.isFinite(minX)) {
    return { center: [0, 0, 0], radius: ORBIT_MIN_RADIUS_M };
  }
  const radius =
    Math.max(maxX - minX, maxY - minY, maxZ - minZ, ORBIT_MIN_RADIUS_M * 2) / 2;
  return {
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    radius,
  };
}

/**
 * Orbit rig for the mesh modes: boots the camera to a vantage on mode entry
 * (three-quarter for dollhouse, overhead for plan), then hands control to
 * drei's OrbitControls around the node-extent centroid. The demand loop is
 * woken by the house `onChange={() => { invalidate(); }}` pattern.
 */
function MeshOrbitRig({
  mode,
  extent,
  enabled,
}: {
  readonly mode: TwinMode;
  readonly extent: NodeExtent;
  /** False while a dive flight owns the camera. */
  readonly enabled: boolean;
}): ReactElement {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    if (!enabled) {
      return; // the DiveCamera owns the camera; it lands ON the boot vantage
    }
    const [cx, cy, cz] = extent.center;
    if (mode === "plan") {
      // Slight z lean keeps the up-vector defined when looking straight down.
      camera.position.set(cx, cy + extent.radius * 2.4, cz + 0.01);
    } else {
      camera.position.set(
        cx + extent.radius * 1.15,
        cy + extent.radius * 0.95,
        cz + extent.radius * 1.15,
      );
    }
    camera.lookAt(cx, cy, cz);
    invalidate();
  }, [mode, camera, extent, invalidate, enabled]);

  return (
    <OrbitControls
      makeDefault
      enabled={enabled}
      enableDamping
      target={extent.center}
      maxPolarAngle={mode === "plan" ? PLAN_MAX_POLAR_RAD : DOLLHOUSE_MAX_POLAR_RAD}
      minDistance={ORBIT_MIN_DISTANCE_M}
      maxDistance={extent.radius * 5}
      onChange={() => {
        invalidate();
      }}
    />
  );
}

/** The dollhouse-mode boot vantage — also the surfacing flight's destination,
 *  so the rig's re-boot after a dive up is a visual no-op. */
function orbitVantage(extent: NodeExtent): [number, number, number] {
  return [
    extent.center[0] + extent.radius * 1.15,
    extent.center[1] + extent.radius * 0.95,
    extent.center[2] + extent.radius * 1.15,
  ];
}

const TWIN_MODE_OPTIONS: readonly { readonly id: TwinMode; readonly label: string }[] = [
  { id: "walk", label: TWIN_MODE_WALK_LABEL },
  { id: "dollhouse", label: TWIN_MODE_DOLLHOUSE_LABEL },
  { id: "plan", label: TWIN_MODE_PLAN_LABEL },
];

/**
 * The segmented view-mode control (WAI-ARIA radio group): click or arrow-key
 * between Walk / Dollhouse / Plan. Roving tabindex — the active segment is
 * the group's single tab stop, arrows move both selection and focus.
 */
function TwinModeControl({
  mode,
  setMode,
  onWarmMesh,
}: {
  readonly mode: TwinMode;
  readonly setMode: (mode: TwinMode) => void;
  /** Fired on hover/focus of the control — intent to view the mesh. */
  readonly onWarmMesh?: () => void;
}): ReactElement {
  const buttonsRef = useRef(new Map<TwinMode, HTMLButtonElement | null>());

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) {
      return;
    }
    event.preventDefault();
    const index = TWIN_MODE_OPTIONS.findIndex((option) => option.id === mode);
    const next =
      TWIN_MODE_OPTIONS[(index + step + TWIN_MODE_OPTIONS.length) % TWIN_MODE_OPTIONS.length];
    if (next !== undefined) {
      setMode(next.id);
      buttonsRef.current.get(next.id)?.focus();
    }
  };

  return (
    <div
      className="vv-twin-mode"
      role="radiogroup"
      aria-label={TWIN_MODE_GROUP_LABEL}
      data-testid="twin-mode-control"
      onKeyDown={onKeyDown}
      onPointerEnter={onWarmMesh}
      onFocus={onWarmMesh}
    >
      {TWIN_MODE_OPTIONS.map(({ id, label }) => (
        <button
          key={id}
          ref={(element) => {
            buttonsRef.current.set(id, element);
          }}
          type="button"
          role="radio"
          aria-checked={mode === id}
          tabIndex={mode === id ? 0 : -1}
          className={
            mode === id ? "vv-twin-mode-option vv-twin-mode-option--active" : "vv-twin-mode-option"
          }
          onClick={() => {
            setMode(id);
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * The initial-load shimmer's phases: "loading" while the FIRST node streams
 * toward its base tier, "fading" while the hairline fades out, "done" once
 * unmounted. Hops never re-arm it — the shimmer belongs to the opening
 * moment only.
 */
export type TwinShimmerPhase = "loading" | "fading" | "done";

/** Milliseconds the fading shimmer stays mounted for its CSS fade. */
export const SHIMMER_FADE_MS = 450;

/**
 * Pure transition for the shimmer: a base-tier arrival on the initial node
 * ends it, as does ANY tier report from a different node (the visitor walked
 * on — the opening moment is over). Preview tiers on the initial node keep
 * it shimmering. Exported for unit tests.
 */
export function shimmerPhaseAfterTier(
  phase: TwinShimmerPhase,
  reportedNodeId: string,
  initialNodeId: string,
  tier: "preview" | "base",
): TwinShimmerPhase {
  if (phase !== "loading") {
    return phase;
  }
  if (reportedNodeId !== initialNodeId) {
    return "fading";
  }
  return tier === "base" ? "fading" : phase;
}

export interface TwinViewerProps {
  readonly manifest: TwinManifest;
  /** Bundle base URL including the venue segment, e.g. `/twin/trades-hall`. */
  readonly assetBase: string;
}

export function TwinViewer({ manifest, assetBase }: TwinViewerProps): ReactElement | null {
  const walk = useTwinWalk(manifest);
  const hasMesh = manifest.mesh !== undefined;
  const { mode, setMode } = useTwinMode(hasMesh);
  const [yaw, setYaw] = useState(0);
  // The element the fullscreen button takes fullscreen — the viewer root, so
  // the canvas AND the HUD stay inside the fullscreen surface.
  const viewerRef = useRef<HTMLDivElement>(null);
  // Dollhouse warm gating (finding [33]): only desktops with memory headroom
  // pay the ~7 MB glb speculatively; everyone else waits for intent so a
  // walk-only mobile visitor never downloads it.
  const [warmMesh, setWarmMesh] = useState(false);
  const desktopCanWarm = useMemo(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    const mem = (navigator as { deviceMemory?: number }).deviceMemory;
    return (mem === undefined || mem >= 4) && window.matchMedia("(pointer: fine)").matches;
  }, []);

  // The opening: the canvas holds black until the first pano texture is on
  // stage, then fades in (CSS, ~500 ms; reduced motion cuts straight in).
  // The shimmer under the node label runs for the initial node's stream only.
  const [stageLive, setStageLive] = useState(false);
  const [shimmerPhase, setShimmerPhase] = useState<TwinShimmerPhase>("loading");
  const initialNodeIdRef = useRef(walk.currentId);

  const onPanoTier = useCallback((nodeId: string, tier: "preview" | "base") => {
    setStageLive(true);
    setShimmerPhase((phase) =>
      shimmerPhaseAfterTier(phase, nodeId, initialNodeIdRef.current, tier),
    );
  }, []);

  // Mesh modes paint their own stage — never hold the canvas dark for them
  // (?mode=dollhouse deep links mount without any pano tier report).
  useEffect(() => {
    if (mode !== "walk") {
      setStageLive(true);
      // No pano tier ever reports in a mesh mode, so the opening shimmer would
      // spin forever (finding [21]); retire it the same way walking off the
      // initial node does — advance loading → fading and let it play out.
      setShimmerPhase((phase) => (phase === "loading" ? "fading" : phase));
    }
  }, [mode]);

  // Walking off the initial node ends the opening even without a base tier
  // (teleports and reduced-motion swaps land with no travelling report).
  useEffect(() => {
    if (walk.currentId !== initialNodeIdRef.current) {
      setShimmerPhase((phase) => (phase === "loading" ? "fading" : phase));
    }
  }, [walk.currentId]);

  // The fading shimmer unmounts once its CSS fade has played out.
  useEffect(() => {
    if (shimmerPhase !== "fading") {
      return;
    }
    const timer = window.setTimeout(() => {
      setShimmerPhase("done");
    }, SHIMMER_FADE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [shimmerPhase]);

  // Hop smoothness: neighbours' full panos are cache-warmed while the
  // visitor lingers, so travel sharpens from disk, not the network.
  useTwinPrefetch(manifest.imagery === "equirect" ? walk.neighbors : [], assetBase);

  // The dive (Phase 2, Task 6): down = dollhouse → node (arrive lands the
  // walk there); up = surfacing (mode already dollhouse; flight ends on the
  // orbit boot vantage so the rig re-boot is a visual no-op).
  const dive = useDive({
    onArrive: (nodeId, direction: DiveDirection) => {
      if (direction === "down") {
        walk.hopTo(nodeId, { teleport: true });
        setMode("walk");
      }
    },
  });
  const orbitPosRef = useRef<[number, number, number]>([0, 0, 0]);
  const flightRef = useRef<DiveFlight>({
    from: [0, 0, 0],
    to: [0, 0, 0],
    progress: 0,
    fovFrom: 50,
    fovTo: 75,
    look: [0, 0, 0],
  });

  const meshUrl = manifest.mesh === undefined ? null : `${assetBase}/${manifest.mesh.path}`;
  const extent = useMemo(() => nodeExtent(manifest.nodes), [manifest]);

  // Warm the dollhouse so a Surface dive never flies through an unloaded void.
  // Intent (a hover/focus on the mesh affordances) warms immediately; a capable
  // desktop also warms speculatively after a beat so its dive is always instant
  // — but a mobile / low-memory walk-only visitor never pays the 7 MB unless
  // they reach for the mesh (finding [33]). The walk's own first paint still
  // never competes with the fetch (the 2.5 s delay).
  useEffect(() => {
    if (meshUrl === null || !(desktopCanWarm || warmMesh)) {
      return;
    }
    const timer = window.setTimeout(
      () => {
        preloadDollhouse(meshUrl);
      },
      warmMesh ? 0 : 2500,
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [meshUrl, desktopCanWarm, warmMesh]);

  const nodesById = useMemo(
    () => new Map<string, TwinScanNode>(manifest.nodes.map((node) => [node.id, node])),
    [manifest],
  );

  const currentNode = nodesById.get(walk.currentId);
  const targetNode = walk.targetId === null ? undefined : nodesById.get(walk.targetId);
  const hopping = targetNode !== undefined;
  const diveNode = dive.target === null ? undefined : nodesById.get(dive.target);

  // Refresh the flight ref after every commit; DiveCamera reads it per frame.
  useEffect(() => {
    if (diveNode === undefined) {
      return;
    }
    const nodePos = e57PointToThree(diveNode.pose.t);
    const flight = flightRef.current;
    flight.progress = dive.progress;
    flight.from = dive.from;
    if (dive.direction === "down") {
      flight.to = nodePos;
      flight.fovFrom = 50;
      flight.fovTo = 75;
      // Gaze: through the destination, extended along the flight's horizontal
      // direction so arrival looks INTO the room, not at a point underfoot.
      flight.look = [
        nodePos[0] + (nodePos[0] - dive.from[0]) * 0.35,
        nodePos[1],
        nodePos[2] + (nodePos[2] - dive.from[2]) * 0.35,
      ];
    } else {
      flight.to = orbitVantage(extent);
      flight.fovFrom = 75;
      flight.fovTo = 50;
      flight.look = extent.center;
    }
  });

  // The dolly ref is refreshed after every commit; CameraDolly's useFrame
  // reads it on the next painted frame.
  const dollyRef = useRef<DollyState>({
    from: [0, 0, 0],
    to: [0, 0, 0],
    progress: 0,
    travelYaw: null,
    hopKey: "",
  });
  useEffect(() => {
    if (currentNode === undefined) {
      return;
    }
    const from = e57PointToThree(currentNode.pose.t);
    dollyRef.current.from = from;
    if (targetNode === undefined) {
      dollyRef.current.to = from;
      dollyRef.current.progress = 0;
      dollyRef.current.travelYaw = null;
      dollyRef.current.hopKey = "";
    } else {
      const to = e57PointToThree(targetNode.pose.t);
      dollyRef.current.to = to;
      dollyRef.current.progress = walk.progress;
      // three YXZ yaw facing the horizontal travel direction (-Z forward).
      dollyRef.current.travelYaw = Math.atan2(-(to[0] - from[0]), -(to[2] - from[2]));
      dollyRef.current.hopKey = `${currentNode.id}->${targetNode.id}`;
    }
  });

  if (currentNode === undefined) {
    // Unreachable in practice: the walk only yields ids from this manifest.
    return null;
  }

  const stages: { node: TwinScanNode; opacity: number }[] = [
    { node: currentNode, opacity: hopping ? 1 - walk.progress : 1 },
  ];
  if (targetNode !== undefined) {
    stages.push({ node: targetNode, opacity: walk.progress });
  }

  return (
    <div
      ref={viewerRef}
      className={stageLive ? "vv-twin-viewer vv-twin-viewer--live" : "vv-twin-viewer"}
      // Named, described interactive region so a screen-reader user meets a
      // real walkthrough — not an anonymous <canvas> (finding [12]). WASD /
      // arrow travel already works by keyboard, which the application role
      // signals; keyboard look/zoom is the remaining gap (finding [9]).
      role="application"
      aria-label={twinViewerLabel(manifest.name)}
      aria-roledescription={TWIN_VIEWER_ROLE}
    >
      {/* Polite arrival announcement — where the walk just moved to (finding
          [10]). Keyed span so identical text still re-announces on revisit. */}
      <p className="vv-sr-only" aria-live="polite" data-testid="twin-live-region">
        {twinViewpointAnnouncement(walk.currentId, manifest.nodes.length)}
      </p>
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ powerPreference: "high-performance" }}
        camera={{ fov: 75, near: 0.1, far: 200 }}
      >
        {mode === "walk" ? (
          <>
            <WalkControls enabled={!hopping} />
            <CameraDolly dolly={dollyRef} />
            <TravelControls
              enabled
              hopping={hopping}
              currentNode={currentNode}
              neighbors={walk.neighbors}
              nodesById={nodesById}
              onTravel={(id) => {
                walk.hopTo(id);
              }}
            />
            {stages.map(({ node, opacity }) => (
              <PanoStage
                key={node.id}
                nodeId={node.id}
                position={e57PointToThree(node.pose.t)}
                quaternion={e57QuatToThree(node.pose.q)}
                assetBase={assetBase}
                opacity={opacity}
                imagery={manifest.imagery}
                onTier={onPanoTier}
              />
            ))}
            {!hopping && (
              <NavMarkers neighbors={walk.neighbors} nodesById={nodesById} onHop={walk.hopTo} />
            )}
            <YawProbe onYaw={setYaw} />
          </>
        ) : (
          meshUrl !== null && (
            <>
              <Suspense fallback={null}>
                <DollhouseStage
                  meshUrl={meshUrl}
                  nodes={manifest.nodes}
                  currentId={walk.currentId}
                  onDive={(id) => {
                    dive.dive(id, {
                      position: [...orbitPosRef.current],
                      direction: "down",
                    });
                  }}
                />
              </Suspense>
              <MeshOrbitRig mode={mode} extent={extent} enabled={!dive.diving} />
              <CameraProbe position={orbitPosRef} />
              {dive.diving && <DiveCamera flight={flightRef} />}
              {/* The dive's crossfade: descending, the target pano closes in
                  late (the camera flies through the real mesh interior);
                  surfacing, the departed pano releases early. */}
              {diveNode !== undefined && dive.direction === "down" && dive.progress > 0.45 && (
                <PanoStage
                  nodeId={diveNode.id}
                  position={e57PointToThree(diveNode.pose.t)}
                  quaternion={e57QuatToThree(diveNode.pose.q)}
                  assetBase={assetBase}
                  opacity={(dive.progress - 0.45) / 0.55}
                  imagery={manifest.imagery}
                />
              )}
              {diveNode !== undefined && dive.direction === "up" && dive.progress < 0.55 && (
                <PanoStage
                  nodeId={diveNode.id}
                  position={e57PointToThree(diveNode.pose.t)}
                  quaternion={e57QuatToThree(diveNode.pose.q)}
                  assetBase={assetBase}
                  opacity={1 - dive.progress / 0.55}
                  imagery={manifest.imagery}
                />
              )}
            </>
          )
        )}
      </Canvas>

      <div className="vv-twin-node-label" data-testid="twin-node-label">
        {/* Keyed span: node changes remount the text through a 200 ms fade. */}
        <span key={walk.currentId} className="vv-twin-node-label-text">
          {twinNodeLabel(walk.currentId, manifest.name)}
        </span>
        {shimmerPhase !== "done" && (
          <span
            aria-hidden
            data-testid="twin-load-shimmer"
            className={
              shimmerPhase === "fading"
                ? "vv-twin-load-shimmer vv-twin-load-shimmer--out"
                : "vv-twin-load-shimmer"
            }
          />
        )}
      </div>
      {hasMesh && (
        <TwinModeControl
          mode={mode}
          setMode={setMode}
          // Reaching for the view-mode switch is intent to see the mesh — warm
          // the dollhouse now so the switch/dive is instant (finding [33]).
          onWarmMesh={() => {
            setWarmMesh(true);
          }}
        />
      )}
      {hasMesh && mode === "walk" && !hopping && (
        <button
          type="button"
          className="vv-twin-surface"
          onPointerEnter={() => {
            setWarmMesh(true);
          }}
          onFocus={() => {
            setWarmMesh(true);
          }}
          onClick={() => {
            // Surfacing: same flight, reversed — the mode flips first so the
            // mesh is on stage, then the spring carries the camera up to the
            // orbit vantage while the pano releases.
            const position = e57PointToThree(currentNode.pose.t);
            setMode("dollhouse");
            dive.dive(walk.currentId, { position, direction: "up" });
          }}
        >
          {TWIN_SURFACE_LABEL} <span aria-hidden>↑</span>
        </button>
      )}
      <TwinViewerControls
        venueSlug={manifest.venueSlug}
        venueName={manifest.name}
        viewerRef={viewerRef}
      />
      <p className="vv-twin-disclosure vv-twin-viewer-disclosure">{TWIN_DISCLOSURE}</p>
      {mode === "walk" && <TwinCoachHint />}
      {mode === "walk" && (
        <TwinMinimap
          nodes={manifest.nodes}
          currentId={walk.currentId}
          yaw={yaw}
          onSelect={(id) => {
            walk.hopTo(id, { teleport: true });
          }}
        />
      )}
    </div>
  );
}
