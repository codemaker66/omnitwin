import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { CatmullRomCurve3, Vector3 } from "three";
import {
  SparkSplatLayer,
  type SparkSplatErrorEvent,
} from "../../components/scene/SparkSplatLayer.js";
import { GoldInkTable } from "./GoldInkTable.js";
import { tradesHallVenueImages } from "../../lib/trades-hall-room-showcase.js";
import {
  MIN_GAZE_DISTANCE_M,
  RECEPTION_DOLLY_STATIONS,
  RECEPTION_TILE_MANIFEST,
  receptionTileUrls,
  type DollyStation,
} from "./reception-dolly-path.js";
import { useLivingHallScroll } from "./useLivingHallScroll.js";

// -----------------------------------------------------------------------------
// LivingHallScene — the real room behind the document.
//
// A fixed, pointer-transparent canvas renders the Reception Room capture while
// the semantic document scrolls over it. Native scroll is the only input: the
// camera eases along an authored Catmull-Rom dolly through verified capture
// viewpoints (reception-dolly-path.ts). Reduced motion pins the camera to the
// scroll position directly — the lag is the motion, never the movement itself
// (feedback_reduced_motion_pointer). Until every tile has arrived, the page
// shows the room's photograph; the room then sharpens in place. If WebGL or
// any tile fails, the poster and the document simply remain — Tier C is not a
// fallback, it is the same page.
// -----------------------------------------------------------------------------

/** A gaze almost touching its own camera reads as nose-to-the-wall; extend it
 *  along its own direction to a minimum comfortable distance. Exported for
 *  tests. */
export function extendShortGaze(
  position: Vector3,
  look: Vector3,
  minDistance: number = MIN_GAZE_DISTANCE_M,
): Vector3 {
  const direction = look.clone().sub(position);
  const length = direction.length();
  if (length === 0) return look.clone().add(new Vector3(0, 0, minDistance));
  if (length >= minDistance) return look;
  return position.clone().add(direction.multiplyScalar(minDistance / length));
}

/** Position + gaze curves through the authored stations. Exported for tests. */
export function buildDollyCurves(stations: readonly DollyStation[]): {
  readonly positions: CatmullRomCurve3;
  readonly looks: CatmullRomCurve3;
} {
  const positionPoints = stations.map((s) => new Vector3(...s.position));
  const lookPoints = stations.map((s, i) =>
    extendShortGaze(positionPoints[i] ?? new Vector3(), new Vector3(...s.look)),
  );
  return {
    positions: new CatmullRomCurve3(positionPoints, false, "centripetal"),
    looks: new CatmullRomCurve3(lookPoints, false, "centripetal"),
  };
}

/** Sample the dolly at t with the gaze-comfort guard applied. The curves are
 *  interpolated independently, so between stations they can converge — the
 *  guard holds the invariant for any station data. Exported for tests. */
export function sampleDolly(
  curves: ReturnType<typeof buildDollyCurves>,
  t: number,
  out: { pos: Vector3; look: Vector3 },
): void {
  curves.positions.getPoint(t, out.pos);
  curves.looks.getPoint(t, out.look);
  out.look.copy(extendShortGaze(out.pos, out.look));
}

/** How briskly the eased camera approaches the scroll target per second. */
const DOLLY_APPROACH_RATE = 2.6;
const SETTLE_EPSILON = 0.0004;

function DollyRig({ reducedMotion }: { readonly reducedMotion: boolean }): null {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const progressRef = useLivingHallScroll(useCallback(() => {
    invalidate();
  }, [invalidate]));
  const tRef = useRef(0);
  const curves = useMemo(() => buildDollyCurves(RECEPTION_DOLLY_STATIONS), []);
  const scratch = useMemo(() => ({ pos: new Vector3(), look: new Vector3() }), []);

  useFrame((_state, delta) => {
    const target = progressRef.current;
    const current = tRef.current;
    const next = reducedMotion
      ? target
      : current + (target - current) * Math.min(1, delta * DOLLY_APPROACH_RATE);
    tRef.current = next;

    sampleDolly(curves, next, scratch);
    camera.position.copy(scratch.pos);
    camera.lookAt(scratch.look);

    if (Math.abs(target - next) > SETTLE_EPSILON) {
      invalidate(); // keep easing until settled, then the loop parks
    }
  });

  return null;
}

export interface LivingHallSceneProps {
  readonly reducedMotion: boolean;
  /** Fires once if the scene cannot run (WebGL/tile failure) — the page
   *  reverts to the plain document styling. */
  readonly onSceneFailed?: () => void;
}

export function LivingHallScene({ reducedMotion, onSceneFailed }: LivingHallSceneProps): ReactElement {
  const [loadedTiles, setLoadedTiles] = useState(0);
  const [failed, setFailed] = useState(false);
  const urls = useMemo(() => receptionTileUrls(), []);
  const allLoaded = loadedTiles >= RECEPTION_TILE_MANIFEST.length;

  const handleLoad = useCallback(() => {
    setLoadedTiles((n) => n + 1);
  }, []);

  const handleError = useCallback((_event: SparkSplatErrorEvent) => {
    // One missing tile means an incomplete room — honest failure, keep the
    // photograph. (Dev without staged assets and prod before R2 land here;
    // observable via data-scene-state="failed".)
    setFailed(true);
    onSceneFailed?.();
  }, [onSceneFailed]);

  const station0 = RECEPTION_DOLLY_STATIONS[0];

  return (
    <div className="lh-scene" aria-hidden data-scene-state={failed ? "failed" : allLoaded ? "live" : "loading"}>
      {!failed && (
        <Canvas
          frameloop="demand"
          dpr={[1, 2]}
          camera={{
            fov: 62,
            near: 0.05,
            far: 150,
            position: station0 ? [...station0.position] : [0, 0, 0],
          }}
          gl={{ antialias: false, powerPreference: "high-performance" }}
        >
          <group rotation={[-Math.PI / 2, 0, 0]}>
            {urls.map((url, index) => (
              <SparkSplatLayer
                key={url}
                url={url}
                includeRendererHost={index === 0}
                onLoad={handleLoad}
                onError={handleError}
              />
            ))}
          </group>
          {/* The pen draws in world space (Y-up) — outside the Z-up group.
              Ink only exists once the room is real (all tiles arrived). */}
          {allLoaded && <GoldInkTable />}
          <DollyRig reducedMotion={reducedMotion} />
        </Canvas>
      )}
      {/* The room's photograph holds the frame until the capture has fully
          arrived — the page never says "loading"; the room sharpens. */}
      <img
        className={`lh-scene-poster${allLoaded && !failed ? " is-sharpened" : ""}`}
        src={tradesHallVenueImages.receptionRoom}
        alt=""
        decoding="async"
      />
    </div>
  );
}
