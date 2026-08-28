import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import {
  SparkSplatLayer,
  type SparkSplatErrorEvent,
  type SparkSplatLoadEvent,
} from "../scene/SparkSplatLayer.js";
import { roomSplatBundle, roomSplatTileUrls } from "../../data/room-splat-bundles.js";
import { RoomClipBox } from "./RoomClipBox.js";
import {
  runtimeAssetCameraViewForRoom,
  runtimeAssetViewTransformForRoom,
  type TradesHallRuntimeRoomSlug,
} from "../../lib/runtime-package-resolution.js";

// ---------------------------------------------------------------------------
// One captured room, rendered.
//
// Shared by the public walkthrough and the internal captures console so the two
// can never drift apart: the same tiles, the same derived transform, the same
// camera framed from the room's own measured extent.
// ---------------------------------------------------------------------------

export interface RoomSplatProgress {
  /** Tiles that have reported in, loaded or failed. */
  readonly settled: number;
  readonly total: number;
  readonly splats: number;
  readonly failed: number;
  readonly complete: boolean;
}

export interface RoomSplatSceneProps {
  readonly room: TradesHallRuntimeRoomSlug;
  readonly onProgress?: (progress: RoomSplatProgress) => void;
  /**
   * Frame the room from outside, as an object.
   *
   * Only honest because the capture is clipped to the room's measured box —
   * without that, pulling back shows the corridor and stair the operator walked
   * through on the way in.
   */
  readonly dollhouse?: boolean;
  /**
   * Keep the drawing buffer after present so the canvas can be read back with
   * toDataURL. Off by default: it costs memory and blocks some driver fast
   * paths. Used only by the offline poster renderer, because screenshotting a
   * fully loaded splat canvas through the compositor never returns.
   */
  readonly captureReadback?: boolean;
}

/**
 * Streams a room's tiles and reports load progress.
 *
 * Progress is polled out of refs rather than pushed through state on every tile.
 * SparkSplatLayer's load effect is keyed on its handler identities, so a handler
 * that changed identity per tile completion would dispose and refetch every
 * mounted tile — turning a 69 MB room into hundreds of megabytes, and on a slow
 * connection never converging at all.
 * See .claude/gotchas/spark-splat-layer-callback-identity.md.
 */
export function RoomSplatScene({
  room,
  onProgress,
  dollhouse = false,
  captureReadback = false,
}: RoomSplatSceneProps): ReactElement {
  const urls = useMemo(
    () => roomSplatTileUrls(room, import.meta.env.VITE_SPLAT_BASE_URL),
    [room],
  );
  const transform = runtimeAssetViewTransformForRoom(room, "staged");
  const camera = runtimeAssetCameraViewForRoom(room, "staged");
  const extentM = roomSplatBundle(room)?.extentM ?? null;

  // Standing inside frames the room at eye height. The dollhouse view steps
  // outside and looks down at the whole room — which only reads as a room
  // because RoomClipBox has removed the building around it.
  const [width, height, depth] = extentM ?? [0, 0, 0];
  const outside = Math.max(width, depth) * 1.15 + 4;
  const startPosition: [number, number, number] = dollhouse
    ? [outside * 0.62, Math.max(height * 1.5, outside * 0.55), outside * 0.62]
    : [...camera.position] as [number, number, number];
  const startTarget: [number, number, number] = dollhouse
    ? [0, height * 0.45, 0]
    : [...camera.target] as [number, number, number];

  const loadedRef = useRef<Map<string, number>>(new Map());
  const failedRef = useRef<Set<string>>(new Set());

  // The latest callback lives in a ref so the handlers below never change
  // identity, while still calling the current prop.
  const onProgressRef = useRef(onProgress);
  useEffect(() => { onProgressRef.current = onProgress; }, [onProgress]);

  const handleLoad = useCallback((event: SparkSplatLoadEvent) => {
    loadedRef.current.set(event.url, event.splatCount);
  }, []);

  const handleError = useCallback((event: SparkSplatErrorEvent) => {
    failedRef.current.add(event.url);
  }, []);

  useEffect(() => {
    loadedRef.current = new Map();
    failedRef.current = new Set();
    const total = urls.length;

    const timer = setInterval(() => {
      let splats = 0;
      for (const count of loadedRef.current.values()) splats += count;
      const settled = loadedRef.current.size + failedRef.current.size;
      onProgressRef.current?.({
        settled,
        total,
        splats,
        failed: failedRef.current.size,
        complete: total > 0 && settled >= total,
      });
    }, 400);
    return () => { clearInterval(timer); };
  }, [urls]);

  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      gl={{
        powerPreference: "high-performance",
        antialias: false,
        preserveDrawingBuffer: captureReadback,
      }}
      camera={{
        position: startPosition,
        fov: camera.fov,
        near: 0.1,
        far: 500,
      }}
      data-testid="room-splat-scene"
    >
      <ambientLight intensity={1} />
      {extentM !== null && (
        <RoomClipBox
          extentM={extentM}
          // Looking in from outside, keep the walls but take the lid off.
          keepHeightFraction={dollhouse ? 0.72 : 1}
        />
      )}
      {urls.map((url) => (
        <SparkSplatLayer
          key={url}
          url={url}
          position={[...transform.position] as [number, number, number]}
          rotation={[...transform.rotation] as [number, number, number]}
          scale={transform.scale}
          onLoad={handleLoad}
          onError={handleError}
        />
      ))}
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={camera.dampingFactor}
        target={startTarget}
        minDistance={camera.minDistance}
        // Everything beyond the walls is clipped, so pulling back is safe:
        // the far limit is the room's own size, not the capture's.
        maxDistance={dollhouse ? outside * 2.2 : Math.max(camera.maxDistance, outside * 1.6)}
        panSpeed={camera.panSpeed}
        rotateSpeed={camera.rotateSpeed}
        zoomSpeed={camera.zoomSpeed}
        minPolarAngle={camera.minPolarAngle}
        maxPolarAngle={camera.maxPolarAngle}
      />
    </Canvas>
  );
}

/** Convenience hook for pages that just want the latest progress. */
export function useRoomSplatProgress(): [RoomSplatProgress, (p: RoomSplatProgress) => void] {
  const [progress, setProgress] = useState<RoomSplatProgress>({
    settled: 0, total: 0, splats: 0, failed: 0, complete: false,
  });
  const push = useCallback((next: RoomSplatProgress) => { setProgress(next); }, []);
  return [progress, push];
}
