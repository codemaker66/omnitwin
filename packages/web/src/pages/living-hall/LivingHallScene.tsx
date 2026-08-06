import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  ACESFilmicToneMapping,
  CatmullRomCurve3,
  SRGBColorSpace,
  Vector3,
  type PerspectiveCamera,
} from "three";
import type { ApprovedRoomRuntimePresentationContract } from "@omnitwin/types";
import {
  SparkSplatLayer,
  type SparkSplatErrorEvent,
  type SparkSplatLoadEvent,
} from "../../components/scene/SparkSplatLayer.js";
import type { SparkSplatSource } from "../../components/scene/spark-splat-source.js";
import { DRESSING_SECTION_ID, GoldInkTable } from "./GoldInkTable.js";
import { TurnSheet } from "./TurnSheet.js";
import { YourTable } from "./YourTable.js";
import { CRANE_POSE, craneWeight } from "./crane.js";
import type { DressingEventType } from "./gold-ink.js";
import { useSectionScrollProgress } from "./useSectionScrollProgress.js";
import { tradesHallVenueImages } from "../../lib/trades-hall-room-showcase.js";
import {
  MIN_GAZE_DISTANCE_M,
  RECEPTION_DOLLY_STATIONS,
  type DollyStation,
} from "./reception-dolly-path.js";
import { useLivingHallScroll } from "./useLivingHallScroll.js";
import { RECEPTION_FIXED_FINE_REVIEW_PROFILE } from "./reception-viewer-profile.js";
import { matchesReceptionLivingHallPresentationContract } from
  "./reception-presentation-contract.js";
import type { ReceptionReviewView } from "./reception-review-views.js";
import {
  ReceptionCaptureInvalidator,
  useReceptionCaptureAdapter,
} from "./ReceptionCaptureAdapter.js";
import type { ReceptionCaptureConfiguration } from "./reception-capture-contract.js";

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

interface FixedCameraTelemetry {
  readonly position: readonly number[];
  readonly quaternion: readonly number[];
  readonly worldMatrix: readonly number[];
  readonly viewMatrix: readonly number[];
  readonly projectionMatrix: readonly number[];
}

interface RendererTelemetry {
  readonly effectiveDpr: number;
  readonly outputColorSpace: string;
  readonly toneMapping: number;
  readonly toneMappingExposure: number;
}

function RendererTelemetryProbe({
  onReady,
}: {
  readonly onReady: (telemetry: RendererTelemetry) => void;
}): null {
  const gl = useThree((state) => state.gl);
  const viewportDpr = useThree((state) => state.viewport.dpr);

  useLayoutEffect(() => {
    onReady({
      effectiveDpr: gl.getPixelRatio(),
      outputColorSpace: gl.outputColorSpace,
      toneMapping: gl.toneMapping,
      toneMappingExposure: gl.toneMappingExposure,
    });
  }, [gl, onReady, viewportDpr]);

  return null;
}

function FixedReviewCameraRig({
  view,
  onReady,
}: {
  readonly view: ReceptionReviewView;
  readonly onReady: (telemetry: FixedCameraTelemetry) => void;
}): null {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const invalidate = useThree((state) => state.invalidate);

  useLayoutEffect(() => {
    camera.position.set(...view.camera);
    camera.up.set(...(view.up ?? [0, 1, 0]));
    camera.fov = view.verticalFovDegrees;
    camera.near = view.near;
    camera.far = view.far;
    camera.lookAt(...view.lookAt);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    onReady({
      position: camera.position.toArray(),
      quaternion: camera.quaternion.toArray(),
      worldMatrix: Array.from(camera.matrixWorld.elements),
      viewMatrix: Array.from(camera.matrixWorldInverse.elements),
      projectionMatrix: Array.from(camera.projectionMatrix.elements),
    });
    invalidate();
  }, [camera, invalidate, onReady, view]);

  return null;
}

function DollyRig({
  reducedMotion,
  cameraPolicy,
}: {
  readonly reducedMotion: boolean;
  readonly cameraPolicy: ApprovedRoomRuntimePresentationContract["cameraPolicy"];
}): null {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const progressRef = useLivingHallScroll(useCallback(() => {
    invalidate();
  }, [invalidate]));
  // The crane reads the Dressing act's own progress — same clock as the pen.
  const dressingRef = useSectionScrollProgress(
    DRESSING_SECTION_ID,
    useCallback(() => {
      invalidate();
    }, [invalidate]),
  );
  const tRef = useRef(0);
  const curves = useMemo(() => buildDollyCurves(RECEPTION_DOLLY_STATIONS), []);
  const scratch = useMemo(() => ({ pos: new Vector3(), look: new Vector3() }), []);
  const crane = useMemo(
    () => ({ pos: new Vector3(...CRANE_POSE.position), look: new Vector3(...CRANE_POSE.look) }),
    [],
  );

  useFrame((_state, delta) => {
    const target = progressRef.current;
    const current = tRef.current;
    const next = reducedMotion
      ? target
      : current + (target - current) *
        Math.min(1, delta * cameraPolicy.approachRatePerSecond);
    tRef.current = next;

    sampleDolly(curves, next, scratch);
    // The rising crane: as the floor fills, lift off the dolly toward the
    // probed high vantage, hold, and hand back before the act ends. The
    // weight follows scroll directly (identical under reduced motion), and
    // blending two smooth poses keeps the whole path smooth.
    const w = craneWeight(dressingRef.current);
    if (w > 0) {
      scratch.pos.lerp(crane.pos, w);
      scratch.look.lerp(crane.look, w);
    }
    camera.position.copy(scratch.pos);
    camera.lookAt(scratch.look);

    if (Math.abs(target - next) > cameraPolicy.settleEpsilon) {
      invalidate(); // keep easing until settled, then the loop parks
    }
  });

  return null;
}

interface LivingHallSceneBaseProps {
  /** The already-validated, complete visual composition. The page owns URL
   *  resolution so this renderer cannot reach dev paths or repair packages. */
  readonly reducedMotion: boolean;
  /** The visitor's chosen shape of the evening — programs the pen. */
  readonly eventType: DressingEventType;
  /** The Turn's sandbox: while true the canvas accepts the pointer and the
   *  visitor's table can be moved. */
  readonly sandboxActive: boolean;
  /** Escape from the sandbox — the page returns focus to its button. */
  readonly onSandboxExit: () => void;
  /** Fires once if the scene cannot run (WebGL/tile failure) — the page
   *  reverts to the plain document styling. */
  readonly onSceneFailed?: () => void;
  /** Exact development-review camera. When present, scroll cannot move it. */
  readonly reviewView?: ReceptionReviewView;
  /** Development-only exact-frame capture contract. */
  readonly captureConfiguration?: ReceptionCaptureConfiguration;
  /** Exact server-attested browser presentation values. */
  readonly presentationContract: ApprovedRoomRuntimePresentationContract;
}

export type LivingHallSceneProps = LivingHallSceneBaseProps & (
  | { readonly splatSources: readonly SparkSplatSource[]; readonly splatUrls?: never }
  | { readonly splatUrls: readonly string[]; readonly splatSources?: never }
);

export function LivingHallScene(props: LivingHallSceneProps): ReactElement {
  const {
    reducedMotion,
    eventType,
    sandboxActive,
    onSandboxExit,
    onSceneFailed,
    reviewView,
    captureConfiguration,
    presentationContract,
  } = props;
  const declaredSources = "splatSources" in props ? props.splatSources : undefined;
  const declaredUrls = "splatUrls" in props ? props.splatUrls : undefined;
  const splatSources = useMemo<readonly SparkSplatSource[]>(() => {
    if (declaredSources !== undefined) return declaredSources;
    return (declaredUrls ?? []).map((url) => ({ kind: "url", id: url, url }));
  }, [declaredSources, declaredUrls]);
  const [loadedSplats, setLoadedSplats] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );
  const [failed, setFailed] = useState(false);
  const [rendererTelemetry, setRendererTelemetry] = useState<RendererTelemetry | null>(null);
  const [cameraTelemetry, setCameraTelemetry] = useState<FixedCameraTelemetry | null>(null);
  const failedRef = useRef(false);
  const presentationAccepted = matchesReceptionLivingHallPresentationContract(
    presentationContract,
  );
  const hasUrls = presentationAccepted && splatSources.length > 0;
  const allLoaded = hasUrls && loadedSplats.size === splatSources.length;
  const loadedSplatCount = useMemo(
    () => Array.from(loadedSplats.values()).reduce((total, count) => total + count, 0),
    [loadedSplats],
  );
  const captureAssetsBySource = useMemo(
    () => new Map(captureConfiguration?.assets.map((asset) => [asset.sourceId, asset]) ?? []),
    [captureConfiguration],
  );
  const activeCaptureConfiguration = captureConfiguration !== undefined
    && allLoaded
    && cameraTelemetry !== null
    && rendererTelemetry !== null
    ? captureConfiguration
    : null;
  const captureAdapter = useReceptionCaptureAdapter(activeCaptureConfiguration);

  const handleLoad = useCallback((event: SparkSplatLoadEvent) => {
    setLoadedSplats((current) => {
      if (current.has(event.url) && current.get(event.url) === event.splatCount) {
        return current;
      }
      const next = new Map(current);
      next.set(event.url, event.splatCount);
      return next;
    });
  }, []);

  const handleCameraReady = useCallback((telemetry: FixedCameraTelemetry) => {
    setCameraTelemetry(telemetry);
  }, []);

  const handleRendererReady = useCallback((telemetry: RendererTelemetry) => {
    setRendererTelemetry((current) => {
      if (
        current?.effectiveDpr === telemetry.effectiveDpr
        && current.outputColorSpace === telemetry.outputColorSpace
        && current.toneMapping === telemetry.toneMapping
        && current.toneMappingExposure === telemetry.toneMappingExposure
      ) {
        return current;
      }
      return telemetry;
    });
  }, []);

  const handleError = useCallback((_event: SparkSplatErrorEvent) => {
    if (failedRef.current) return;
    failedRef.current = true;
    // One missing tile means an incomplete room — honest failure, keep the
    // photograph. (Dev without staged assets and prod before R2 land here;
    // observable via data-scene-state="failed".)
    setFailed(true);
    onSceneFailed?.();
  }, [onSceneFailed]);

  const cameraPolicy = presentationContract.cameraPolicy;
  const groupTransform = presentationContract.groupTransform;
  const initialCameraPosition = reviewView?.camera ?? cameraPolicy.initialPosition;

  return (
    <div
      className={`lh-scene${sandboxActive ? " is-interactive" : ""}`}
      aria-hidden={!sandboxActive}
      data-scene-state={failed || !hasUrls ? "failed" : allLoaded ? "live" : "loading"}
      data-render-profile-id={RECEPTION_FIXED_FINE_REVIEW_PROFILE.id}
      data-presentation-contract-digest={presentationContract.contractDigest}
      data-presentation-route={cameraPolicy.route}
      data-camera-policy-id={cameraPolicy.id}
      data-camera-path-digest={cameraPolicy.pathDigest}
      data-render-profile-digest={presentationContract.rendererProfile.digest}
      data-loaded-source-count={loadedSplats.size}
      data-loaded-splat-count={loadedSplatCount}
      data-effective-dpr={rendererTelemetry?.effectiveDpr}
      data-output-color-space={rendererTelemetry?.outputColorSpace}
      data-tone-mapping={RECEPTION_FIXED_FINE_REVIEW_PROFILE.canvas.toneMapping}
      data-tone-mapping-code={rendererTelemetry?.toneMapping}
      data-tone-mapping-exposure={rendererTelemetry?.toneMappingExposure}
      data-review-view-id={reviewView?.id}
      data-camera-ready={reviewView === undefined ? undefined : cameraTelemetry !== null}
      data-camera-position={cameraTelemetry?.position.join(",")}
      data-camera-quaternion={cameraTelemetry?.quaternion.join(",")}
      data-camera-world-matrix={cameraTelemetry?.worldMatrix.join(",")}
      data-camera-view-matrix={cameraTelemetry?.viewMatrix.join(",")}
      data-camera-projection-matrix={cameraTelemetry?.projectionMatrix.join(",")}
    >
      {!failed && hasUrls && (
        <Canvas
          frameloop="demand"
          dpr={[
            RECEPTION_FIXED_FINE_REVIEW_PROFILE.canvasDpr[0],
            RECEPTION_FIXED_FINE_REVIEW_PROFILE.canvasDpr[1],
          ]}
          camera={{
            fov: reviewView?.verticalFovDegrees ?? cameraPolicy.verticalFovDegrees,
            near: reviewView?.near ?? cameraPolicy.nearPlaneMetres,
            far: reviewView?.far ?? cameraPolicy.farPlaneMetres,
            position: [...initialCameraPosition],
          }}
          gl={{
            antialias: RECEPTION_FIXED_FINE_REVIEW_PROFILE.canvas.antialias,
            alpha: RECEPTION_FIXED_FINE_REVIEW_PROFILE.canvas.alpha,
            premultipliedAlpha:
              RECEPTION_FIXED_FINE_REVIEW_PROFILE.canvas.premultipliedAlpha,
            powerPreference: RECEPTION_FIXED_FINE_REVIEW_PROFILE.canvas.powerPreference,
            outputColorSpace: SRGBColorSpace,
            toneMapping: ACESFilmicToneMapping,
            toneMappingExposure:
              RECEPTION_FIXED_FINE_REVIEW_PROFILE.canvas.toneMappingExposure,
          }}
        >
          <group
            position={[...groupTransform.position]}
            rotation={[...groupTransform.rotationEulerRadians]}
            scale={groupTransform.uniformScale}
          >
            {splatSources.map((source, index) => source.kind === "url" ? (
              <SparkSplatLayer
                key={source.id}
                url={source.url}
                renderProfile={RECEPTION_FIXED_FINE_REVIEW_PROFILE.spark}
                includeRendererHost={index === 0}
                captureIdentity={captureAssetsBySource.get(source.id) === undefined ? undefined : {
                  candidateId: captureConfiguration?.candidateId ?? "",
                  requestPath: captureAssetsBySource.get(source.id)?.requestPath ?? "",
                  sha256: captureAssetsBySource.get(source.id)?.sha256 ?? "",
                  sizeBytes: captureAssetsBySource.get(source.id)?.sizeBytes ?? 0,
                }}
                onPresentedFrame={index === 0 ? captureAdapter.onPresentedFrame : undefined}
                onLoad={handleLoad}
                onError={handleError}
              />
            ) : (
              <SparkSplatLayer
                key={source.id}
                source={source}
                renderProfile={RECEPTION_FIXED_FINE_REVIEW_PROFILE.spark}
                includeRendererHost={index === 0}
                captureIdentity={captureAssetsBySource.get(source.id) === undefined ? undefined : {
                  candidateId: captureConfiguration?.candidateId ?? "",
                  requestPath: captureAssetsBySource.get(source.id)?.requestPath ?? "",
                  sha256: captureAssetsBySource.get(source.id)?.sha256 ?? "",
                  sizeBytes: captureAssetsBySource.get(source.id)?.sizeBytes ?? 0,
                }}
                onPresentedFrame={index === 0 ? captureAdapter.onPresentedFrame : undefined}
                onLoad={handleLoad}
                onError={handleError}
              />
            ))}
          </group>
          {/* The pen draws in world space (Y-up) — outside the Z-up group.
              Ink only exists once the room is real (all tiles arrived). */}
          {allLoaded && reviewView === undefined && <GoldInkTable eventType={eventType} />}
          {allLoaded && reviewView === undefined && <TurnSheet />}
          {allLoaded && reviewView === undefined && (
            <YourTable active={sandboxActive} onExit={onSandboxExit} />
          )}
          {reviewView === undefined ? (
            <DollyRig reducedMotion={reducedMotion} cameraPolicy={cameraPolicy} />
          ) : (
            <FixedReviewCameraRig view={reviewView} onReady={handleCameraReady} />
          )}
          <RendererTelemetryProbe onReady={handleRendererReady} />
          {activeCaptureConfiguration !== null && (
            <ReceptionCaptureInvalidator onReady={captureAdapter.onInvalidatorReady} />
          )}
        </Canvas>
      )}
      {/* The room's photograph holds the frame until the capture has fully
          arrived — the page never says "loading"; the room sharpens. */}
      {captureConfiguration === undefined && (
        <img
          className={`lh-scene-poster${allLoaded && !failed ? " is-sharpened" : ""}`}
          src={tradesHallVenueImages.receptionRoom}
          alt=""
          decoding="async"
        />
      )}
    </div>
  );
}
