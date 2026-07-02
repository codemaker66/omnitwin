import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactElement,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerspectiveCamera } from "three";
import type { TwinManifest, TwinScanNode } from "@omnitwin/types";
import { NavMarkers } from "./NavMarkers.js";
import { PanoStage } from "./PanoStage.js";
import { e57PointToThree, e57QuatToThree } from "./twin-basis.js";
import { TWIN_DISCLOSURE, twinNodeLabel } from "./twin-copy.js";
import { TwinMinimap } from "./TwinMinimap.js";
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
// Plan: docs/superpowers/plans/2026-07-02-twin-phase1-walk.md (Tasks 9–10).
// -----------------------------------------------------------------------------

interface DollyState {
  from: readonly [number, number, number];
  to: readonly [number, number, number];
  progress: number;
}

/**
 * Camera position = lerp(from, to, progress), read from a ref each frame so
 * per-frame motion never re-renders React. The demand loop keeps painting
 * because every hop progress step already invalidates via PanoStage opacity.
 */
function CameraDolly({
  dolly,
}: {
  readonly dolly: MutableRefObject<DollyState>;
}): null {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);

  useFrame(() => {
    const { from, to, progress } = dolly.current;
    const x = from[0] + (to[0] - from[0]) * progress;
    const y = from[1] + (to[1] - from[1]) * progress;
    const z = from[2] + (to[2] - from[2]) * progress;
    if (camera.position.x !== x || camera.position.y !== y || camera.position.z !== z) {
      camera.position.set(x, y, z);
      invalidate();
    }
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

export interface TwinViewerProps {
  readonly manifest: TwinManifest;
  /** Bundle base URL including the venue segment, e.g. `/twin/trades-hall`. */
  readonly assetBase: string;
}

export function TwinViewer({ manifest, assetBase }: TwinViewerProps): ReactElement | null {
  const walk = useTwinWalk(manifest);
  const [yaw, setYaw] = useState(0);

  const nodesById = useMemo(
    () => new Map<string, TwinScanNode>(manifest.nodes.map((node) => [node.id, node])),
    [manifest],
  );

  const currentNode = nodesById.get(walk.currentId);
  const targetNode = walk.targetId === null ? undefined : nodesById.get(walk.targetId);
  const hopping = targetNode !== undefined;

  // The dolly ref is refreshed after every commit; CameraDolly's useFrame
  // reads it on the next painted frame.
  const dollyRef = useRef<DollyState>({ from: [0, 0, 0], to: [0, 0, 0], progress: 0 });
  useEffect(() => {
    if (currentNode === undefined) {
      return;
    }
    const from = e57PointToThree(currentNode.pose.t);
    dollyRef.current.from = from;
    dollyRef.current.to = targetNode === undefined ? from : e57PointToThree(targetNode.pose.t);
    dollyRef.current.progress = targetNode === undefined ? 0 : walk.progress;
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
    <div className="vv-twin-viewer">
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ powerPreference: "high-performance" }}
        camera={{ fov: 75, near: 0.1, far: 200 }}
      >
        <WalkControls enabled />
        <CameraDolly dolly={dollyRef} />
        {stages.map(({ node, opacity }) => (
          <PanoStage
            key={node.id}
            nodeId={node.id}
            position={e57PointToThree(node.pose.t)}
            quaternion={e57QuatToThree(node.pose.q)}
            assetBase={assetBase}
            opacity={opacity}
          />
        ))}
        {!hopping && (
          <NavMarkers neighbors={walk.neighbors} nodesById={nodesById} onHop={walk.hopTo} />
        )}
        <YawProbe onYaw={setYaw} />
      </Canvas>

      <div className="vv-twin-node-label" data-testid="twin-node-label">
        {twinNodeLabel(walk.currentId, manifest.name)}
      </div>
      <p className="vv-twin-disclosure vv-twin-viewer-disclosure">{TWIN_DISCLOSURE}</p>
      <TwinMinimap
        nodes={manifest.nodes}
        currentId={walk.currentId}
        yaw={yaw}
        onSelect={(id) => {
          walk.hopTo(id, { teleport: true });
        }}
      />
    </div>
  );
}
