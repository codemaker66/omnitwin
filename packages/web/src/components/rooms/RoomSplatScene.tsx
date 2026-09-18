import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { NativeCanvas as Canvas } from "../scene/NativeCanvas.js";
import type { RootState } from "@react-three/fiber";
import type { NativeCurrentViewCapture } from "../../lib/native-current-view-capture.js";
import {
  NativeSplatRendererMount,
  NativeSplatLayer,
  type NativeSplatErrorEvent,
  type NativeSplatLoadEvent,
} from "../scene/NativeSplatLayer.js";
import { roomSplatBundle, roomSplatLadder, walkPoseForBundle } from "../../data/room-splat-bundles.js";
import { RoomClipBox } from "./RoomClipBox.js";
import { InteriorCamera } from "./InteriorCamera.js";
import { useSplatRuntimeProfile } from "../../hooks/use-splat-runtime-profile.js";
import { settledPixelRatio } from "../../lib/splat-runtime-profile.js";
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
  /** Every detail tile failed or decoded and reached a real draw. */
  readonly complete: boolean;
  /** Something of the room is on screen — the coarse first view counts. */
  readonly firstView: boolean;
}

declare global {
  interface Window {
    /** Development-only, complete-room poster readback from the live camera. */
    __roomPosterCapture?: () => Promise<NativeCurrentViewCapture>;
  }
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
 * The deadline is a guard against a stuck fetch, not a tuning knob. The native renderer
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
  /** A coarse tile has reached a real draw, so a first room view exists. */
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
   * Expose a development-only current-view poster capture on the live device.
   * Neither native backend requires a preserved presented drawing buffer.
   */
  readonly captureReadback?: boolean;
}

/**
 * Streams a room's tiles and reports load progress.
 *
 * Progress is polled out of refs to group tile events into readable updates.
 * Decode and actual draw readiness are tracked separately; callbacks can change
 * without restarting NativeSplatLayer's source registration.
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

  // The scene selects complete reconstruction levels within the device budget.
  // Sort cadence and tail radius reach the renderer; pixel ratios reach the
  // camera, which drops resolution while the view moves.
  //
  // The settled ratio is the profile's, NOT the display's. A 1x laptop
  // rendering at 2 and presenting at 1 is supersampling, and on this room it
  // is worth a great deal — the name boards measured 100% sharper, the
  // panelling 75% (2026-09-04) — for no frame rate, because the demand loop
  // draws the settled frame once and sleeps. Only memory bounds it, which is
  // what settledPixelRatio's budget is for.
  const profile = useSplatRuntimeProfile();
  const settledDpr = settledPixelRatio(
    profile.settledDpr,
    typeof window === "undefined" ? 0 : window.innerWidth,
    typeof window === "undefined" ? 0 : window.innerHeight,
  );

  // Native Three draws canonical SOG captures. On constrained tiers, select a
  // complete vendor reconstruction under the settled budget, never random splats.
  const budget = profile.lod ? profile.lodSplatCount : Infinity;
  const ladder = useMemo(
    () => roomSplatLadder(room, import.meta.env.VITE_SPLAT_BASE_URL, false, budget),
    [room, budget],
  );

  // The camera reports motion through a ref. Per-source opacity callbacks below
  // select the complete coarse level once it has decoded and drawn; they retain
  // the detail level if any coarse tile is unavailable. No per-splat LOD is used.
  const movingRef = useRef(false);
  const handleMotionChange = useCallback((moving: boolean) => {
    movingRef.current = moving;
  }, []);
  const lodScaleFn = useCallback(
    () => (movingRef.current ? profile.motionLodSplatCount / profile.lodSplatCount : 1),
    [profile],
  );

  // The poller groups decode/draw events before moving between ladder stages.
  const [delivery, setDelivery] = useState<Delivery>(() => ({
    stage: ladder.coarse.length > 0 ? "coarse" : "sharpening",
    coarseShowing: false,
  }));
  const deliveryRef = useRef(delivery);
  const loadedRef = useRef<Map<string, number>>(new Map());
  const failedRef = useRef<Set<string>>(new Set());
  const drawnRef = useRef<Set<string>>(new Set());
  const motionLevelEnabled = profile.lod && ladder.coarse.length > 0;
  const motionLevelDecoded = useCallback(() => (
    motionLevelEnabled && ladder.coarse.every((source) => loadedRef.current.has(source.url)
      && !failedRef.current.has(source.url))
  ), [ladder.coarse, motionLevelEnabled]);
  const motionLevelAvailable = useCallback(() => (
    motionLevelDecoded() && ladder.coarse.every((source) => drawnRef.current.has(source.url))
  ), [ladder.coarse, motionLevelDecoded]);
  const coarseOpacity = useCallback(() => (
    deliveryRef.current.stage === "sharp" ? (movingRef.current && motionLevelDecoded() ? 1 : 0) : 1
  ), [motionLevelDecoded]);
  const sharpOpacity = useCallback(() => (
    deliveryRef.current.stage === "sharp" && movingRef.current && motionLevelAvailable() ? 0 : 1
  ), [motionLevelAvailable]);

  useEffect(() => { deliveryRef.current = delivery; }, [delivery]);
  const ladderRef = useRef(ladder);

  /** The last report handed out, so an unchanged one is not repeated. */
  const lastReportRef = useRef<RoomSplatProgress | null>(null);
  const captureSource = useRef<Pick<RootState, "scene" | "camera"> | null>(null);
  const handleCreated = useCallback((state: RootState) => { captureSource.current = state; }, []);
  useEffect(() => {
    if (!import.meta.env.DEV || !captureReadback) return;
    const capture = async (): Promise<NativeCurrentViewCapture> => {
      const progress = lastReportRef.current;
      const source = captureSource.current;
      if (source === null || progress?.complete !== true || !progress.firstView || progress.failed > 0) {
        throw new Error("A complete, successfully drawn room is required before poster capture");
      }
      const { captureNativeCurrentView } = await import("../../lib/native-current-view-capture.js");
      return captureNativeCurrentView(source.scene, source.camera);
    };
    window.__roomPosterCapture = capture;
    return () => { if (window.__roomPosterCapture === capture) delete window.__roomPosterCapture; };
  }, [captureReadback]);

  // The latest callback lives in a ref so the handlers below never change
  // identity, while still calling the current prop.
  const onProgressRef = useRef(onProgress);
  useEffect(() => { onProgressRef.current = onProgress; }, [onProgress]);

  const handleLoad = useCallback((event: NativeSplatLoadEvent) => {
    loadedRef.current.set(event.url, event.splatCount);
  }, []);

  const handleError = useCallback((event: NativeSplatErrorEvent) => {
    failedRef.current.add(event.url);
  }, []);

  const handleRendered = useCallback((url: string) => {
    drawnRef.current.add(url);
  }, []);

  useEffect(() => {
    loadedRef.current = new Map();
    failedRef.current = new Set();
    drawnRef.current = new Set();
    lastReportRef.current = null;
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
      const coarseShowing = ladder.coarse.some((source) => drawnRef.current.has(source.url));
      const coarseSettled = ladder.coarse.every((source) => isSettled(source.url));
      const settled = ladder.sharp.filter((source) => isSettled(source.url)).length;
      const failed = ladder.sharp.filter((source) => failedRef.current.has(source.url)).length;
      // Decode completion still leaves merge/upload/compilation outstanding.
      // Failures settle, but every successful detail source must actually draw
      // before the page can remove its loading indicator.
      const complete = total > 0 && settled >= total && ladder.sharp.every((source) => (
        failedRef.current.has(source.url) || drawnRef.current.has(source.url)
      ));
      // The coarse room is cover, not a placeholder — it is the only thing
      // drawing the geometry a missing tile would have drawn. So it is dropped
      // only when every selected detail tile has decoded AND reached a real
      // draw. Compilation or upload may still be pending after decoding.
      const covered = complete && failed === 0;

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

      const report: RoomSplatProgress = {
        settled,
        total,
        splats,
        failed,
        complete,
        // Neither decoding nor the sky alone proves a room is on screen.
        firstView: coarseShowing || ladder.sharp.some((source) => drawnRef.current.has(source.url)),
      };
      // Only say something when there is something to say. A tile whose fetch
      // hangs never loads and never errors, so completion never arrives and
      // this timer runs for the rest of the visit; reporting an unchanged
      // number every 400 ms re-rendered the whole page with it.
      const last = lastReportRef.current;
      const changed = last === null
        || last.settled !== report.settled
        || last.total !== report.total
        || last.splats !== report.splats
        || last.failed !== report.failed
        || last.complete !== report.complete
        || last.firstView !== report.firstView;
      if (changed) {
        lastReportRef.current = report;
        onProgressRef.current?.(report);
      }
      // Pending GPU work keeps the poll alive without repeating an unchanged
      // report. Once draws/failures settle, no more progress work is needed.
      if (complete) clearInterval(timer);
    }, PROGRESS_INTERVAL_MS);
    return () => { clearInterval(timer); };
  }, [ladder]);

  // Keep the complete coarse room during streaming/failure. Constrained tiers
  // retain it for camera motion after detail arrives; the native host caches
  // and globally sorts the active complete level, preserving all its surfaces.
  const mounted = [
    ...ladder.environment,
    ...(delivery.stage === "sharp" && !motionLevelEnabled ? [] : ladder.coarse),
    ...(delivery.stage === "coarse" ? [] : ladder.sharp),
  ];

  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      gl={{
        powerPreference: "high-performance",
        antialias: false,
      }}
      camera={{
        position: startPosition,
        fov: camera.fov,
        near: 0.1,
        far: 500,
      }}
      data-testid="room-splat-scene"
      onCreated={handleCreated}
    >
      <ambientLight intensity={1} />
      {extentM !== null && (
        <RoomClipBox extentM={extentM} keepHeightFraction={1} />
      )}
      {/* One renderer host per scene, owned by no tile: the ladder drops the
          coarse room when the finest level lands, and a host riding on that
          tile would take the renderer away with it. */}
      <NativeSplatRendererMount runtime={profile} lodScaleFn={lodScaleFn} />
      {mounted.map((source) => (
        <NativeSplatLayer
          key={source.url}
          url={source.url}
          residencyGroup={motionLevelEnabled && !source.isEnvironment
            ? (ladder.coarse.some((tile) => tile.url === source.url) ? "motion" : "detail")
            : undefined}
          opacityFn={source.isEnvironment ? undefined
            : (ladder.coarse.some((tile) => tile.url === source.url) ? coarseOpacity : sharpOpacity)}
          position={[...transform.position] as [number, number, number]}
          rotation={[...transform.rotation] as [number, number, number]}
          scale={transform.scale}
          runtime={profile}
          includeRendererHost={false}
          lodScaleFn={lodScaleFn}
          onLoad={handleLoad}
          onError={handleError}
          onRendered={handleRendered}
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
