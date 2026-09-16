import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import {
  SparkRendererMount,
  SparkSplatLayer,
} from "../scene/SparkSplatLayer.js";
import { roomSplatBundle, roomSplatLadder, walkPoseForBundle } from "../../data/room-splat-bundles.js";
import { RoomClipBox } from "./RoomClipBox.js";
import { InteriorCamera } from "./InteriorCamera.js";
import { useSplatRuntimeProfile } from "../../hooks/use-splat-runtime-profile.js";
import { useSplatDelivery, type RoomSplatProgress } from "../../hooks/use-splat-delivery.js";
import { settledPixelRatio } from "../../lib/splat-runtime-profile.js";
import {
  runtimeAssetCameraViewForRoom,
  runtimeAssetViewTransformForRoom,
  type TradesHallRuntimeRoomSlug,
} from "../../lib/runtime-package-resolution.js";

export type { RoomSplatProgress } from "../../hooks/use-splat-delivery.js";

// ---------------------------------------------------------------------------
// One captured room, rendered.
//
// The public walkthrough's camera and clip box, with the same delivery ladder
// used by the planner. The internal captures console still owns its own scene.
// ---------------------------------------------------------------------------

/**
 * Watches the drawing context and hands the loss back to the page.
 *
 * A WebGL context can be taken away at any moment — the phone got hot, the
 * tab went to the background, another tab wanted the GPU, the driver reset.
 * Left alone the canvas simply goes black and stays black, because the
 * browser will only ever restore a context whose loss event was
 * `preventDefault`ed; without that call the loss is final and no amount of
 * waiting brings the room back.
 *
 * So: prevent the default, tell the page (which says something calm and
 * offers a reload if nothing comes back), and on restore wake the demand
 * loop, which is otherwise asleep and would draw nothing at all.
 */
function ContextLossGuard({ onLost }: { readonly onLost: (lost: boolean) => void }): ReactElement {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const onLostRef = useRef(onLost);
  useEffect(() => { onLostRef.current = onLost; }, [onLost]);

  useEffect(() => {
    const canvas = gl.domElement;
    const handleLost = (event: Event): void => {
      // Without this the context is gone for good. Everything else here is
      // presentation; this one line is the whole recovery.
      event.preventDefault();
      onLostRef.current(true);
    };
    const handleRestored = (): void => {
      onLostRef.current(false);
      invalidate();
    };
    canvas.addEventListener("webglcontextlost", handleLost);
    canvas.addEventListener("webglcontextrestored", handleRestored);
    return () => {
      canvas.removeEventListener("webglcontextlost", handleLost);
      canvas.removeEventListener("webglcontextrestored", handleRestored);
    };
  }, [gl, invalidate]);

  return <></>;
}

export interface RoomSplatSceneProps {
  readonly room: TradesHallRuntimeRoomSlug;
  readonly onProgress?: (progress: RoomSplatProgress) => void;
  /**
   * The drawing context was taken away (true) or came back (false).
   *
   * The page owns what a visitor is told; the scene only owns the fact.
   */
  readonly onRendererLost?: (lost: boolean) => void;
  /** Kill-order fallback for touch: "tap-only" keeps tap-to-glide alone. */
  readonly touchLocomotion?: "full" | "tap-only";
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
  onRendererLost,
  touchLocomotion = "full",
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

  // What to mount, in two stages plus the sky that outlives both. Each tile is
  // served as its prebuilt, paged tree when the profile wants the tree and the
  // bundle has one, otherwise as the tile itself (which Spark then trees in a
  // worker if the profile asks).
  //
  // The SHARP rung is the best level this device agreed to hold, not always
  // the finest one. INTERIM (T-617): a phone is served the vendor's coarser
  // level — for the Grand Hall, level 4 at 2,945,194 splats in 54,148,124
  // bytes rather than level 5 at 6,019,684 in 106,479,738 — because every
  // XGRIDS level is the WHOLE room at one density, so the coarser one is a
  // complete room and not a partial one. A desktop's budget exceeds the
  // finest level and it is served exactly what it was before.
  const preferTrees = profile.lod && profile.preferTrees;
  const ladder = useMemo(
    () => roomSplatLadder(
      room,
      import.meta.env.VITE_SPLAT_BASE_URL,
      preferTrees,
      profile.lodSplatCount,
    ),
    [room, preferTrees, profile.lodSplatCount],
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

  const delivery = useSplatDelivery(ladder, onProgress);

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
      {onRendererLost !== undefined && <ContextLossGuard onLost={onRendererLost} />}
      {extentM !== null && (
        <RoomClipBox extentM={extentM} keepHeightFraction={1} />
      )}
      {/* One renderer host per scene, owned by no tile: the ladder drops the
          coarse room when the finest level lands, and a host riding on that
          tile would take the renderer away with it. */}
      <SparkRendererMount runtime={profile} lodScaleFn={lodScaleFn} />
      {delivery.mounted.map((source) => (
        <SparkSplatLayer
          key={`${delivery.key}:${source.url}`}
          url={source.url}
          paged={source.tree}
          position={[...transform.position] as [number, number, number]}
          rotation={[...transform.rotation] as [number, number, number]}
          scale={transform.scale}
          runtime={profile}
          includeRendererHost={false}
          lodScaleFn={lodScaleFn}
          onLoad={delivery.onLoad}
          onError={delivery.onError}
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
          touchLocomotion={touchLocomotion}
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
