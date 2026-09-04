import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Canvas } from "@react-three/fiber";
import {
  SparkRendererMount,
  SparkSplatLayer,
  type SparkSplatErrorEvent,
  type SparkSplatLoadEvent,
} from "../scene/SparkSplatLayer.js";
import { roomSplatBundle, roomSplatLadder, walkPoseForBundle } from "../../data/room-splat-bundles.js";
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
  /** Tiles of the FINEST level that have reported in, loaded or failed. */
  readonly settled: number;
  /** Tiles the finest level is made of. The coarse first view is not counted. */
  readonly total: number;
  readonly splats: number;
  /** Failures in the finest level. A coarse tile that never came is not one. */
  readonly failed: number;
  /** The finest level is up: the room is as good as it gets. */
  readonly complete: boolean;
  /** Something of the room is on screen — the coarse first view counts. */
  readonly firstView: boolean;
}

/** How often the scene reports in. */
const PROGRESS_INTERVAL_MS = 400;

/**
 * How long the finest level waits for the coarse view before starting anyway.
 *
 * The wait is what makes the ladder worth having: the coarse tile alone on the
 * wire lands in about three seconds on a 20 Mbps line, where sharing the pipe
 * with the finest level's eleven would take four times that.
 *
 * The deadline is a guard against a stuck fetch, not a tuning knob. Spark
 * reports a tile once it is decoded rather than once its bytes are in, so a
 * shorter deadline looks like a way to overlap the decode with the wire; it is
 * not. Measured at 20 Mbps, eight seconds and fifteen finished within noise of
 * each other (78.5 s both), because the tile settles before either fires. What
 * a short deadline does change is the slow line the ladder exists for: at
 * 5 Mbps it would start eleven competing fetches while the coarse tile is still
 * coming, and delay the very first view it was meant to bring forward.
 */
const COARSE_WAIT_MS = 15_000;

/** Which rung of the ladder the room is standing on. */
type DeliveryStage = "coarse" | "sharpening" | "sharp";

interface Delivery {
  readonly stage: DeliveryStage;
  /** A coarse tile has landed, so the room is already drawn at low density. */
  readonly coarseShowing: boolean;
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
  const transform = runtimeAssetViewTransformForRoom(room, "staged");
  const camera = runtimeAssetCameraViewForRoom(room, "staged");
  const extentM = roomSplatBundle(room)?.extentM ?? null;

  // Where the scanner actually stood, and how far they went. The walk is the
  // only honest answer to both: a person carrying the scanner stayed inside the
  // room, at eye height, in the free space — so standing there cannot be
  // outside, and going no further than they did cannot reach the uncaptured
  // exterior. Rooms whose capture shipped no trajectory fall back to the frame
  // derived from geometry.
  // At a person's eye height, though: the capture records where the SCANNER
  // was, and the Grand Hall's was a 3 m pole.
  const bundle = roomSplatBundle(room);
  // Memoised on the bundle: the camera re-seats the view when its spawn changes,
  // so the spawn must only change when the room does, never per render.
  const pose = useMemo(() => {
    if (bundle === null) return null;
    const walk = walkPoseForBundle(bundle);
    if (walk === null) return null;
    return {
      spawn: { position: [...walk.spawn.position] as [number, number, number], yaw: walk.spawn.yaw },
      bounds: {
        min: [...walk.bounds.min] as [number, number, number],
        max: [...walk.bounds.max] as [number, number, number],
      },
    };
  }, [bundle]);
  const spawn = pose?.spawn ?? null;
  const walkBounds = pose?.bounds ?? null;
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

  // What to mount, in two stages plus the sky that outlives both. Each tile is
  // served as its prebuilt, paged tree when the profile wants the tree and the
  // bundle has one, otherwise as the tile itself (which Spark then trees in a
  // worker if the profile asks).
  const preferTrees = profile.lod && profile.preferTrees;
  const ladder = useMemo(
    () => roomSplatLadder(room, import.meta.env.VITE_SPLAT_BASE_URL, preferTrees),
    [room, preferTrees],
  );

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

  // Which rung the room is on. The poller below drives it: the load handlers
  // must keep their identity, and a handler that set state would change on
  // every tile and make Spark dispose and refetch the room.
  const [delivery, setDelivery] = useState<Delivery>(() => ({
    stage: ladder.coarse.length > 0 ? "coarse" : "sharpening",
    coarseShowing: false,
  }));
  const deliveryRef = useRef(delivery);
  useEffect(() => { deliveryRef.current = delivery; }, [delivery]);
  const ladderRef = useRef(ladder);

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
    // Only a genuinely new ladder re-seats the delivery: setting state on mount
    // would render the scene twice for nothing.
    if (ladderRef.current !== ladder) {
      ladderRef.current = ladder;
      setDelivery({
        stage: ladder.coarse.length > 0 ? "coarse" : "sharpening",
        coarseShowing: false,
      });
    }
    const total = ladder.sharp.length;
    const isSettled = (url: string): boolean =>
      loadedRef.current.has(url) || failedRef.current.has(url);
    let waitedMs = 0;

    const timer = setInterval(() => {
      waitedMs += PROGRESS_INTERVAL_MS;
      const coarseShowing = ladder.coarse.some((source) => loadedRef.current.has(source.url));
      const coarseSettled = ladder.coarse.every((source) => isSettled(source.url));
      const settled = ladder.sharp.filter((source) => isSettled(source.url)).length;
      const loaded = ladder.sharp.filter((source) => loadedRef.current.has(source.url)).length;
      const failed = ladder.sharp.filter((source) => failedRef.current.has(source.url)).length;
      // Nothing more is coming. Not the same as: the room is covered.
      const complete = total > 0 && settled >= total;
      // The coarse room is cover, not a placeholder — it is the only thing
      // drawing the geometry a missing tile would have drawn. So it is dropped
      // only when every tile of the finest level actually arrived; one failure
      // and it stays underneath for the rest of the visit, filling the hole.
      const covered = total > 0 && loaded >= total;

      let stage: DeliveryStage = "coarse";
      if (covered) {
        stage = "sharp";
      } else if (
        deliveryRef.current.stage !== "coarse"
        || coarseSettled
        || waitedMs >= COARSE_WAIT_MS
      ) {
        stage = "sharpening";
      }
      // Same values, same object: React bails out rather than re-rendering the
      // scene, which is what keeps the camera in its place.
      setDelivery((previous) => (previous.stage === stage && previous.coarseShowing === coarseShowing
        ? previous
        : { stage, coarseShowing }));

      // What is drawn right now: the sky, plus the coarse room until it is
      // dropped, plus however much of the finest level has arrived.
      const drawn = stage === "coarse"
        ? [...ladder.environment, ...ladder.coarse]
        : stage === "sharp"
          ? [...ladder.environment, ...ladder.sharp]
          : [...ladder.environment, ...ladder.coarse, ...ladder.sharp];
      let splats = 0;
      for (const source of drawn) {
        splats += loadedRef.current.get(source.url) ?? 0;
      }

      onProgressRef.current?.({
        settled,
        total,
        splats,
        failed,
        complete,
        // A tile that failed put nothing on screen, so it is not a first view.
        firstView: coarseShowing || loaded > 0,
      });
      // The last report is the last: a poller that keeps ticking re-renders
      // the page 2.5 times a second for the rest of the visit.
      if (complete) clearInterval(timer);
    }, PROGRESS_INTERVAL_MS);
    return () => { clearInterval(timer); };
  }, [ladder]);

  // What is on screen. Every mounted layer is visible, always: a Spark mesh
  // that loads while invisible renders as unsorted colour blobs when it is
  // revealed, because Spark drives a mesh's level-of-detail tree only while the
  // scene traverses it as visible (measured 2026-09-04; a camera move repairs
  // the tiles one at a time, which is what gave it away). So the finest level's
  // tiles appear as they land, over the coarse room, and the coarse room is
  // dropped only once the last of them is in — the room is whole throughout.
  const mounted = [
    ...ladder.environment,
    ...(delivery.stage === "sharp" ? [] : ladder.coarse),
    ...(delivery.stage === "coarse" ? [] : ladder.sharp),
  ];

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
      {/* One renderer host per scene, owned by no tile: the ladder drops the
          coarse room when the finest level lands, and a host riding on that
          tile would take the renderer away with it. */}
      <SparkRendererMount runtime={profile} lodScaleFn={lodScaleFn} />
      {mounted.map((source) => (
        <SparkSplatLayer
          key={source.url}
          url={source.url}
          paged={source.tree}
          position={[...transform.position] as [number, number, number]}
          rotation={[...transform.rotation] as [number, number, number]}
          scale={transform.scale}
          runtime={profile}
          includeRendererHost={false}
          lodScaleFn={lodScaleFn}
          onLoad={handleLoad}
          onError={handleError}
        />
      ))}
      {spawn !== null && walkBounds !== null && (
        <InteriorCamera
          spawn={spawn}
          bounds={walkBounds}
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
    settled: 0, total: 0, splats: 0, failed: 0, complete: false, firstView: false,
  });
  const push = useCallback((next: RoomSplatProgress) => { setProgress(next); }, []);
  return [progress, push];
}
