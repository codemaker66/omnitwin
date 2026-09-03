import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Canvas } from "@react-three/fiber";
import {
  SparkSplatLayer,
  type SparkSplatErrorEvent,
  type SparkSplatLoadEvent,
} from "../scene/SparkSplatLayer.js";
import { roomSplatBundle, roomSplatTileUrls } from "../../data/room-splat-bundles.js";
import { RoomClipBox } from "./RoomClipBox.js";
import { InteriorCamera } from "./InteriorCamera.js";
import { useSplatRuntimeProfile } from "../../hooks/use-splat-runtime-profile.js";
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
  captureReadback = false,
}: RoomSplatSceneProps): ReactElement {
  const urls = useMemo(
    () => roomSplatTileUrls(room, import.meta.env.VITE_SPLAT_BASE_URL),
    [room],
  );
  const transform = runtimeAssetViewTransformForRoom(room, "staged");
  const camera = runtimeAssetCameraViewForRoom(room, "staged");
  const extentM = roomSplatBundle(room)?.extentM ?? null;

  // Where the scanner actually stood, and how far they went. The walk is the
  // only honest answer to both: a person carrying the scanner stayed inside the
  // room, at eye height, in the free space — so standing there cannot be
  // outside, and going no further than they did cannot reach the uncaptured
  // exterior. Rooms whose capture shipped no trajectory fall back to the frame
  // derived from geometry.
  const bundle = roomSplatBundle(room);
  const spawn = bundle?.spawn ?? null;
  const walkBounds = bundle?.bounds ?? null;
  const startPosition: [number, number, number] = spawn === null
    ? [...camera.position] as [number, number, number]
    : [...spawn.position] as [number, number, number];

  const prefersReducedMotion = useMemo(
    () => typeof window !== "undefined"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  // How hard this device may work: sort cadence, tail radius and the
  // level-of-detail budget go to the renderer; the pixel ratios go to the
  // camera, which drops resolution while the view moves. The settled ratio is
  // a cap, never an upscale: a 1x display rests at 1 whatever the profile says.
  const profile = useSplatRuntimeProfile();
  const deviceDpr = typeof window === "undefined" ? 1 : window.devicePixelRatio;
  const settledDpr = Math.min(deviceDpr, profile.settledDpr);

  // The motion budget. The camera says when the view is moving; the renderer
  // host polls this each frame and scales the level-of-detail budget down to
  // the profile's motion budget while it is. Refs and stable callbacks, so
  // neither the camera nor the tiles ever re-render for a flag that flips on
  // every drag.
  const movingRef = useRef(false);
  const handleMotionChange = useCallback((moving: boolean) => {
    movingRef.current = moving;
  }, []);
  const lodScaleFn = useCallback(
    () => (movingRef.current ? profile.motionLodSplatCount / profile.lodSplatCount : 1),
    [profile],
  );

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
        <RoomClipBox extentM={extentM} keepHeightFraction={1} />
      )}
      {urls.map((url, index) => (
        <SparkSplatLayer
          key={url}
          url={url}
          position={[...transform.position] as [number, number, number]}
          rotation={[...transform.rotation] as [number, number, number]}
          scale={transform.scale}
          runtime={profile}
          // One renderer host per scene, as every other mount does. Each host
          // is a SparkRenderer of its own, and a room is one scene.
          includeRendererHost={index === 0}
          lodScaleFn={lodScaleFn}
          onLoad={handleLoad}
          onError={handleError}
        />
      ))}
      {spawn !== null && walkBounds !== null && (
        <InteriorCamera
          spawn={{ position: [...spawn.position] as [number, number, number], yaw: spawn.yaw }}
          bounds={{
            min: [...walkBounds.min] as [number, number, number],
            max: [...walkBounds.max] as [number, number, number],
          }}
          roomHeightM={extentM?.[1]}
          reducedMotion={prefersReducedMotion}
          motionDpr={profile.motionDpr}
          settledDpr={settledDpr}
          onMotionChange={handleMotionChange}
        />
      )}
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
