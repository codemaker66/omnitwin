import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactElement, type ReactNode } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import type { SpaceDimensions, SpatialLayerDescriptorV0 } from "@omnitwin/types";
import { GRAND_HALL_RENDER_DIMENSIONS, scaleForRendering } from "../../constants/scale.js";
import { PlannerCanvasBoundary } from "../PlannerCanvasBoundary.js";
import type { AdaptiveResolutionOptions } from "../AdaptiveResolution.js";
import { CameraRig } from "../CameraRig.js";
import { GrandHallRoom } from "../GrandHallRoom.js";
import { RoomMesh } from "./RoomMesh.js";
import { SectionPlane } from "../SectionPlane.js";
import { InvalidateOnToggle, AutoWallSelector } from "../WallTogglePanel.js";
import { XrayToggle } from "../XrayToggle.js";
import { MeasurementTool } from "../MeasurementTool.js";
import { TapeMeasure } from "../TapeMeasure.js";
import { PlacementGhost } from "../PlacementGhost.js";
import { DiagramLabels } from "../DiagramLabels.js";
import { PlacedFurniture } from "../PlacedFurniture.js";
import { SelectionSystem } from "../SelectionSystem.js";
import { MarqueeSelect } from "../MarqueeSelect.js";
import { SnapGuides } from "../SnapGuides.js";
import { CirculationOverlay } from "../CirculationOverlay.js";
import { MarkupLayer } from "../MarkupLayer.js";
import { SceneProvider } from "../SceneProvider.js";
import { PerfMonitor } from "../PerfMonitor.js";
import { useEditorStore } from "../../stores/editor-store.js";
import {
  serializeExactGrandHallRuntimeKey,
  useCockpitStore,
  type ExactGrandHallRuntimeKey,
} from "../../stores/cockpit-store.js";
import { computeBoundingBox, resolveRoomGeometry } from "../../data/room-geometries.js";
import { useChunkArrivals } from "../../hooks/use-chunk-arrivals.js";
import { useRoomRuntimeSplat } from "../../hooks/use-room-runtime-splat.js";
import {
  resolvePlannerLayerComposition,
  resolvePlannerLayerPolicy,
} from "../../lib/planner-layer-composition.js";
import { GRAND_HALL_CAPTURED_SOG_MEMBERS } from "../../lib/grand-hall-captured-source.js";
import { runtimeAssetCameraViewForRoom } from "../../lib/runtime-package-resolution.js";
import {
  GRAND_HALL_APPEARANCE_LAYER_ID,
  GRAND_HALL_STRUCTURAL_PROXY_LAYER_ID,
  createGrandHallRoomSceneManifest,
} from "../../lib/grand-hall-room-scene.js";
import {
  layerStateForRoomResolve,
  resolveRoomSceneComposition,
  type RoomSceneLayerLoadState,
} from "../../lib/room-scene-composition.js";
import { shouldRenderPlannerMotionOverlays } from "../../lib/planner-render-policy.js";
import { inkTargetOpacity, roomResolvePhase } from "../../lib/room-resolve-model.js";
import { CockpitSplatLayer } from "./CockpitSplatLayer.js";
import { InkArchitectureLayer } from "./InkArchitectureLayer.js";
import { CockpitSceneOverlays } from "./CockpitSceneOverlays.js";
import { CockpitEvidenceBeam } from "./CockpitEvidenceBeam.js";
import { CockpitCameraFocus } from "./CockpitCameraFocus.js";
import { CockpitPlanningCamera } from "./CockpitPlanningCamera.js";
import { ExactGrandHallSplatLayer } from "./ExactGrandHallSplatLayer.js";
import { RoomSceneCompositor } from "../scene/RoomSceneCompositor.js";
import { GrandHallStructuralProxyLayer } from "../scene/GrandHallStructuralProxyLayer.js";
import { GrandHallCapturedCamera } from "../scene/GrandHallCapturedCamera.js";

/**
 * Computes render dimensions from room geometry polygon data.
 * Falls back to Grand Hall dimensions if no space is loaded.
 */
export const LEAN_PLANNER_DPR_MAX_VIEWPORT_WIDTH = 1099;
export const PHONE_PLANNER_DPR = 0.75;
export const TABLET_PLANNER_DPR = 0.75;
export const DESKTOP_PLANNER_DPR = 0.75;
export const PLANNER_CANVAS_PERFORMANCE = {
  min: 0.25,
  debounce: 180,
} as const;
const CAMERA_INTERACTION_SETTLE_MS = 420;
const EXACT_GRAND_HALL_CAMERA_VIEW = runtimeAssetCameraViewForRoom("grand-hall");

export function exactGrandHallArrivalResetKey(
  runtimeKey: ExactGrandHallRuntimeKey | null,
  attemptNonce: number,
): string {
  const identity = runtimeKey === null
    ? "exact-grand-hall-unresolved"
    : serializeExactGrandHallRuntimeKey(runtimeKey);
  return GRAND_HALL_CAPTURED_SOG_MEMBERS
    .map((member) => `${identity}:${String(attemptNonce)}:${member.fileName}`)
    .join("|");
}

export interface PlannerCanvasGlOptions {
  readonly antialias: boolean;
  readonly powerPreference: "high-performance";
}

export function plannerCanvasDprForViewportWidth(viewportWidth: number): [number, number] {
  if (viewportWidth > 480 && viewportWidth <= LEAN_PLANNER_DPR_MAX_VIEWPORT_WIDTH) {
    return [TABLET_PLANNER_DPR, TABLET_PLANNER_DPR];
  }
  return viewportWidth <= LEAN_PLANNER_DPR_MAX_VIEWPORT_WIDTH
    ? [PHONE_PLANNER_DPR, PHONE_PLANNER_DPR]
    : [DESKTOP_PLANNER_DPR, DESKTOP_PLANNER_DPR];
}

export function plannerCanvasGlForViewportWidth(viewportWidth: number): PlannerCanvasGlOptions {
  return {
    antialias: viewportWidth > LEAN_PLANNER_DPR_MAX_VIEWPORT_WIDTH,
    powerPreference: "high-performance",
  };
}

export function plannerAdaptiveResolutionForViewportWidth(viewportWidth: number): AdaptiveResolutionOptions {
  const [minDpr, maxDpr] = plannerCanvasDprForViewportWidth(viewportWidth);
  return {
    enabled: false,
    minDpr,
    maxDpr,
  };
}

export function shouldUseSmoothPlannerControls(viewportWidth: number): boolean {
  return viewportWidth > LEAN_PLANNER_DPR_MAX_VIEWPORT_WIDTH;
}

export function shouldRenderPlannerSceneOverlays(viewportWidth: number): boolean {
  return viewportWidth > LEAN_PLANNER_DPR_MAX_VIEWPORT_WIDTH;
}

function readViewportWidth(): number {
  return typeof window === "undefined" ? 1440 : window.innerWidth;
}

function usePlannerViewportWidth(): number {
  const [viewportWidth, setViewportWidth] = useState(readViewportWidth);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onResize = (): void => { setViewportWidth(window.innerWidth); };
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); };
  }, []);

  return viewportWidth;
}

function isCameraNavigationPointer(
  event: PointerEvent<HTMLDivElement>,
  capturedOnly: boolean,
): boolean {
  return event.pointerType === "touch"
    || event.button === 1
    || event.button === 2
    || (capturedOnly && event.button === 0);
}

function PlannerMotionOverlayLayers({
  renderSceneOverlays,
}: {
  readonly renderSceneOverlays: boolean;
}): ReactElement | null {
  const cameraInteractionActive = useCockpitStore((state) => state.cameraInteractionActive);
  if (!shouldRenderPlannerMotionOverlays(cameraInteractionActive)) return null;

  return (
    <>
      {renderSceneOverlays && <CockpitSceneOverlays />}
      <CockpitEvidenceBeam />
      <SnapGuides />
      <CirculationOverlay />
      <MarqueeSelect />
      <MarkupLayer />
      <DiagramLabels />
    </>
  );
}

function PlannerScenePrecompiler({
  signature,
}: {
  readonly signature: string;
}): null {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    let cancelled = false;

    const warmScenePrograms = async (): Promise<void> => {
      invalidate();
      try {
        await gl.compileAsync(scene, camera);
      } catch {
        gl.compile(scene, camera);
      }
      if (!cancelled) invalidate();
    };

    void warmScenePrograms();

    return () => {
      cancelled = true;
    };
  }, [camera, gl, invalidate, scene, signature]);

  return null;
}

function useRoomDimensions(): SpaceDimensions {
  const space = useEditorStore((s) => s.space);
  return useMemo(() => {
    if (space === null) return GRAND_HALL_RENDER_DIMENSIONS;
    const geom = resolveRoomGeometry(space);
    if (geom !== null) {
      const bbox = computeBoundingBox(geom.wallPolygon);
      return scaleForRendering({ width: bbox.width, length: bbox.depth, height: geom.ceilingHeight });
    }
    return scaleForRendering({
      width: parseFloat(space.widthM),
      length: parseFloat(space.lengthM),
      height: parseFloat(space.heightM),
    });
  }, [space]);
}

export interface ExactGrandHallRuntimeCallbacks {
  readonly onReady: () => void;
  readonly onFailed: () => void;
  readonly onSourceOnlyError: () => void;
  readonly onSourceOnlyRetry: () => void;
}

function sameExactGrandHallRuntimeKey(
  left: ExactGrandHallRuntimeKey | null,
  right: ExactGrandHallRuntimeKey | null,
): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  return left.spaceId === right.spaceId
    && left.venueId === right.venueId
    && left.runtimePackageId === right.runtimePackageId;
}

/**
 * Binds renderer completion to the exact room/package selected by the runtime
 * hook. The store rejects either callback after that key stops being current.
 */
export function useExactGrandHallRuntimeCallbacks(
  key: ExactGrandHallRuntimeKey | null,
  attemptNonce: number,
): ExactGrandHallRuntimeCallbacks {
  const currentAttemptRef = useRef({ key, attemptNonce });
  currentAttemptRef.current = { key, attemptNonce };
  const isCurrentKey = useCallback((): boolean => (
    key !== null
    && sameExactGrandHallRuntimeKey(key, currentAttemptRef.current.key)
  ), [key]);
  const isCurrentAttempt = useCallback((): boolean => (
    isCurrentKey()
    && attemptNonce > 0
    && currentAttemptRef.current.attemptNonce === attemptNonce
  ), [attemptNonce, isCurrentKey]);
  const onReady = useCallback((): void => {
    if (key === null || !isCurrentAttempt()) return;
    useCockpitStore.getState().completeExactGrandHallRuntime(key, attemptNonce, "verified");
  }, [attemptNonce, isCurrentAttempt, key]);
  const onFailed = useCallback((): void => {
    if (key === null || !isCurrentAttempt()) return;
    useCockpitStore.getState().completeExactGrandHallRuntime(key, attemptNonce, "failed");
  }, [attemptNonce, isCurrentAttempt, key]);
  const onSourceOnlyError = useCallback((): void => {
    if (key === null || !isCurrentAttempt()) return;
    useCockpitStore.getState().clearExactGrandHallRuntime(key, attemptNonce);
  }, [attemptNonce, isCurrentAttempt, key]);
  const onSourceOnlyRetry = useCallback((): void => {
    if (key === null || !isCurrentKey()) return;
    const store = useCockpitStore.getState();
    const lifecycle = store.exactGrandHallRuntime;
    if (
      lifecycle !== null
      && (
        !sameExactGrandHallRuntimeKey(lifecycle.key, key)
        || lifecycle.attemptNonce !== attemptNonce
      )
    ) return;
    store.beginExactGrandHallRuntime(key);
  }, [attemptNonce, isCurrentKey, key]);
  return { onReady, onFailed, onSourceOnlyError, onSourceOnlyRetry };
}

/**
 * The live editable planner scene — the single R3F canvas plus every editing
 * system (room geometry, furniture, selection, markup, circulation, camera).
 * Extracted from App so the planner cockpit can host it in its stage cell.
 */
export function PlannerScene(): ReactElement {
  const space = useEditorStore((s) => s.space);
  const dimensions = useRoomDimensions();
  const viewportWidth = usePlannerViewportWidth();
  const canvasDpr = useMemo(() => plannerCanvasDprForViewportWidth(viewportWidth), [viewportWidth]);
  const canvasGl = useMemo(() => plannerCanvasGlForViewportWidth(viewportWidth), [viewportWidth]);
  const smoothCameraControls = shouldUseSmoothPlannerControls(viewportWidth);
  const renderSceneOverlays = shouldRenderPlannerSceneOverlays(viewportWidth);
  // Memoized like useRoomDimensions above: the generic floorPlanOutline path
  // allocates a fresh wallPolygon per call, and this component re-renders on
  // every chunk arrival — an unmemoized call would thrash the ink layer's
  // geometry memo during the develop window (reviewer MEDIUM finding).
  const roomGeometry = useMemo(
    () => (space !== null ? resolveRoomGeometry(space) : null),
    [space],
  );
  // The Grand Hall capture is appearance-authoritative: layer controls may
  // not blend generated room pixels into it, and a missing capture fails
  // closed. Other rooms retain the existing Mesh ↔ Splat ↔ Hybrid policy.
  const layerMode = useCockpitStore((s) => s.layerMode);
  const grandHallPresentation = useCockpitStore((s) => s.grandHallPresentation);
  const grandHallCameraMode = useCockpitStore((s) => s.grandHallCameraMode);
  const exactGrandHallLifecycle = useCockpitStore((s) => s.exactGrandHallRuntime);
  const exactGrandHallAttemptNonce = useCockpitStore((s) => s.exactGrandHallAttemptNonce);
  const {
    splatUrls,
    transform,
    hasAsset,
    status: splatStatus,
    delivery,
    runtimePackageId,
    exactGrandHallRuntimeKey,
    roomIdentity,
  } = useRoomRuntimeSplat();
  const currentExactAttemptNonce = exactGrandHallRuntimeKey !== null
    && exactGrandHallLifecycle !== null
    && sameExactGrandHallRuntimeKey(exactGrandHallRuntimeKey, exactGrandHallLifecycle.key)
    ? exactGrandHallLifecycle.attemptNonce
    : 0;
  const exactGrandHallRuntimeCallbacks = useExactGrandHallRuntimeCallbacks(
    exactGrandHallRuntimeKey,
    currentExactAttemptNonce,
  );
  const layerPolicy = resolvePlannerLayerPolicy({
    currentRoom: space === null
      ? null
      : {
        spaceId: space.id,
        venueId: space.venueId,
        roomSlug: space.slug,
      },
    roomIdentity,
    requestedMode: layerMode,
  });
  const roomVariant = layerPolicy.kind === "captured-only" ? "grand-hall" : "generic";
  const exactGrandHallRuntimePackageId = layerPolicy.kind === "captured-only"
    && delivery === "verified-grand-hall"
    ? runtimePackageId
    : null;
  const exactGrandHall = exactGrandHallRuntimePackageId !== null;
  const layerComposition = resolvePlannerLayerComposition({
    policy: layerPolicy,
    hasCapturedAsset: hasAsset,
  });
  const splatActive = layerComposition.renderCapturedArchitecture;

  // CARD A2 — "the room resolves": count chunk arrivals, derive the resolve
  // phase, and publish it for the quiet caption + the stage's honesty
  // attribute. The arrival set resets when the room's chunk list changes
  // (the hook rebuilds the array each render, so key on its joined value).
  const exactArrivalResetKey = useMemo(
    () => exactGrandHallArrivalResetKey(exactGrandHallRuntimeKey, exactGrandHallAttemptNonce),
    [exactGrandHallAttemptNonce, exactGrandHallRuntimeKey],
  );
  const arrivals = useChunkArrivals(exactGrandHall ? exactArrivalResetKey : splatUrls.join("|"));
  const totalChunks = exactGrandHall ? GRAND_HALL_CAPTURED_SOG_MEMBERS.length : splatUrls.length;
  const loadedChunks = Math.min(arrivals.loadedCount, totalChunks);
  const failedChunks = Math.min(arrivals.failedCount, totalChunks - loadedChunks);
  const roomSceneManifest = useMemo(() => {
    if (exactGrandHallRuntimePackageId === null) return null;
    return createGrandHallRoomSceneManifest(exactGrandHallRuntimePackageId);
  }, [exactGrandHallRuntimePackageId]);
  const exactRuntimeStatus = exactGrandHallLifecycle !== null
    && exactGrandHallRuntimeKey !== null
    && sameExactGrandHallRuntimeKey(exactGrandHallLifecycle.key, exactGrandHallRuntimeKey)
    ? exactGrandHallLifecycle.status
    : "pending";
  const roomSceneLayerStates = useMemo<Readonly<Record<string, RoomSceneLayerLoadState>>>(() => ({
    [GRAND_HALL_APPEARANCE_LAYER_ID]: exactRuntimeStatus === "verified"
      ? { status: "ready", loadedUnits: totalChunks, totalUnits: totalChunks }
      : exactRuntimeStatus === "failed" || failedChunks > 0
        ? { status: "failed", loadedUnits: loadedChunks, totalUnits: totalChunks }
        : { status: "loading", loadedUnits: loadedChunks, totalUnits: totalChunks },
    [GRAND_HALL_STRUCTURAL_PROXY_LAYER_ID]: {
      status: "ready",
      loadedUnits: 1,
      totalUnits: 1,
    },
  }), [exactRuntimeStatus, failedChunks, loadedChunks, totalChunks]);
  const roomSceneComposition = useMemo(() => (
    roomSceneManifest === null
      ? null
      : resolveRoomSceneComposition(roomSceneManifest, {
        presentation: grandHallPresentation,
        layerStates: roomSceneLayerStates,
      })
  ), [grandHallPresentation, roomSceneLayerStates, roomSceneManifest]);
  const exactResolveInput = roomSceneComposition === null
    ? null
    : layerStateForRoomResolve(roomSceneComposition.activeLoadState);
  const resolvePhase = exactGrandHall && roomSceneComposition?.activeLoadState.status === "failed"
    ? "fallback"
    : exactGrandHall && exactResolveInput !== null
      ? roomResolvePhase(exactResolveInput)
      : roomResolvePhase({ splatStatus, hasAsset, totalChunks, loadedChunks, failedChunks });
  const resolveLoadedChunks = exactResolveInput?.loadedChunks ?? loadedChunks;
  const resolveTotalChunks = exactResolveInput?.totalChunks ?? totalChunks;
  useEffect(() => {
    useCockpitStore.getState().setRoomResolve({
      phase: resolvePhase,
      loadedChunks: resolveLoadedChunks,
      totalChunks: resolveTotalChunks,
    });
  }, [resolveLoadedChunks, resolvePhase, resolveTotalChunks]);
  // Ink recedes only where captured chunks actually arrived — it honestly
  // persists over any region whose chunk failed.
  const inkOpacity = inkTargetOpacity({ splatActive, loadedChunks, totalChunks });
  const cameraInteractionClearTimer = useRef<number | null>(null);
  const sceneWarmupSignature = `${space?.id ?? "unresolved-room"}:${roomVariant}:${layerPolicy.kind}:${layerMode}:${grandHallPresentation}:${grandHallCameraMode}:${String(hasAsset)}`;

  const clearCameraInteractionTimer = useCallback((): void => {
    if (cameraInteractionClearTimer.current === null) return;
    window.clearTimeout(cameraInteractionClearTimer.current);
    cameraInteractionClearTimer.current = null;
  }, []);

  const markCameraInteractionActive = useCallback((event: PointerEvent<HTMLDivElement>): void => {
    if (!isCameraNavigationPointer(event, layerPolicy.kind === "captured-only")) return;
    clearCameraInteractionTimer();
    useCockpitStore.getState().setCameraInteractionActive(true);
  }, [clearCameraInteractionTimer, layerPolicy.kind]);

  const markCameraInteractionSettling = useCallback((): void => {
    clearCameraInteractionTimer();
    cameraInteractionClearTimer.current = window.setTimeout(() => {
      cameraInteractionClearTimer.current = null;
      useCockpitStore.getState().setCameraInteractionActive(false);
    }, CAMERA_INTERACTION_SETTLE_MS);
  }, [clearCameraInteractionTimer]);

  useEffect(() => () => {
    clearCameraInteractionTimer();
    useCockpitStore.getState().setCameraInteractionActive(false);
  }, [clearCameraInteractionTimer]);

  const renderGrandHallLayer = useCallback((layer: SpatialLayerDescriptorV0): ReactNode => {
    if (layer.id === GRAND_HALL_APPEARANCE_LAYER_ID && exactGrandHallRuntimePackageId !== null) {
      return (
        <ExactGrandHallSplatLayer
          key={exactGrandHallRuntimeKey === null
            ? "exact-grand-hall-unresolved"
            : serializeExactGrandHallRuntimeKey(exactGrandHallRuntimeKey)}
          runtimePackageId={exactGrandHallRuntimePackageId}
          transform={transform}
          active={splatActive && grandHallPresentation === "appearance"}
          onChunkLoaded={arrivals.markLoaded}
          onChunkFailed={arrivals.markFailed}
          onReady={exactGrandHallRuntimeCallbacks.onReady}
          onFailed={exactGrandHallRuntimeCallbacks.onFailed}
        />
      );
    }
    if (layer.id === GRAND_HALL_STRUCTURAL_PROXY_LAYER_ID) {
      return <GrandHallStructuralProxyLayer />;
    }
    return null;
  }, [
    arrivals.markFailed,
    arrivals.markLoaded,
    exactGrandHallRuntimeCallbacks.onFailed,
    exactGrandHallRuntimeCallbacks.onReady,
    exactGrandHallRuntimeKey,
    grandHallPresentation,
    exactGrandHallRuntimePackageId,
    splatActive,
    transform,
  ]);

  return (
    <PlannerCanvasBoundary
      sourceOnly={layerPolicy.kind !== "configurable"}
      onSourceOnlyError={exactGrandHallRuntimeCallbacks.onSourceOnlyError}
      onSourceOnlyRetry={exactGrandHallRuntimeCallbacks.onSourceOnlyRetry}
    >
      <div
        className="planner-scene-canvas-host"
        onPointerDownCapture={markCameraInteractionActive}
        onPointerUpCapture={markCameraInteractionSettling}
        onPointerCancelCapture={markCameraInteractionSettling}
        onPointerLeave={markCameraInteractionSettling}
      >
        <Canvas
          frameloop="demand"
          dpr={canvasDpr}
          performance={PLANNER_CANVAS_PERFORMANCE}
          gl={canvasGl}
          camera={{ fov: 55, near: 0.1, far: 200 }}
          style={{ width: "100%", height: "100%" }}
        >
          <color attach="background" args={["#eee9de"]} />
          {layerPolicy.kind === "configurable" && (
            <fog attach="fog" args={["#efe9dc", 54, 138]} />
          )}
          <SceneProvider />
          <PlannerScenePrecompiler signature={sceneWarmupSignature} />
          {layerPolicy.kind === "configurable" && (
            <>
              <SectionPlane />
              <InvalidateOnToggle />
            </>
          )}
          {layerComposition.renderProceduralArchitecture && (roomGeometry !== null ? (
            <RoomMesh geometry={roomGeometry} variant={roomVariant} />
          ) : (
            <>
              <AutoWallSelector />
              <GrandHallRoom />
            </>
          ))}
          {layerComposition.renderArchitecturalInk && roomGeometry !== null && (
            <InkArchitectureLayer
              polygon={roomGeometry.wallPolygon}
              ceilingHeightM={roomGeometry.ceilingHeight}
              targetOpacity={inkOpacity}
            />
          )}
          {roomSceneManifest !== null && roomSceneComposition !== null ? (
            <RoomSceneCompositor
              manifest={roomSceneManifest}
              composition={roomSceneComposition}
              renderLayer={renderGrandHallLayer}
            />
          ) : hasAsset && (
            <group name="captured-room-source">
              <CockpitSplatLayer
                urls={splatUrls}
                transform={transform}
                active={splatActive}
                onChunkLoaded={arrivals.markLoaded}
                onChunkFailed={arrivals.markFailed}
              />
            </group>
          )}
          {layerPolicy.kind === "configurable" && (
            <>
              <CockpitCameraFocus />
              <CockpitPlanningCamera />
            </>
          )}
          {layerPolicy.kind === "configurable" && <XrayToggle />}
          {layerComposition.renderPlanningOverlays && (
            <group name="planning-overlays">
              <MeasurementTool />
              <TapeMeasure />
              <PlacedFurniture />
              <PlacementGhost />
              <SelectionSystem />
              <PlannerMotionOverlayLayers renderSceneOverlays={renderSceneOverlays} />
            </group>
          )}
          {layerPolicy.kind === "captured-only" ? (
            <GrandHallCapturedCamera
              mode={grandHallCameraMode}
              view={EXACT_GRAND_HALL_CAMERA_VIEW}
              smoothControls={smoothCameraControls}
            />
          ) : layerPolicy.kind === "configurable" ? (
            <CameraRig dimensions={dimensions} smoothControls={smoothCameraControls} />
          ) : null}
          {import.meta.env.DEV && <PerfMonitor />}
        </Canvas>
      </div>
    </PlannerCanvasBoundary>
  );
}
