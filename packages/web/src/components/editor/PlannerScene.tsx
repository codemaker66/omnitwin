import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactElement } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { SpaceDimensions } from "@omnitwin/types";
import { PerspectiveCamera } from "three";
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
import {
  runtimeAssetCameraViewForRoom,
  type RuntimeAssetCameraView,
} from "../../lib/runtime-package-resolution.js";
import { shouldRenderPlannerMotionOverlays } from "../../lib/planner-render-policy.js";
import { inkTargetOpacity, roomResolvePhase } from "../../lib/room-resolve-model.js";
import { CockpitSplatLayer } from "./CockpitSplatLayer.js";
import { InkArchitectureLayer } from "./InkArchitectureLayer.js";
import { CockpitSceneOverlays } from "./CockpitSceneOverlays.js";
import { CockpitEvidenceBeam } from "./CockpitEvidenceBeam.js";
import { CockpitCameraFocus } from "./CockpitCameraFocus.js";
import { CockpitPlanningCamera } from "./CockpitPlanningCamera.js";
import { ExactGrandHallSplatLayer } from "./ExactGrandHallSplatLayer.js";

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
const EXACT_GRAND_HALL_MEMBER_KEY = GRAND_HALL_CAPTURED_SOG_MEMBERS
  .map((member) => member.fileName)
  .join("|");
const EXACT_GRAND_HALL_CAMERA_VIEW = runtimeAssetCameraViewForRoom("grand-hall");

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

function isCameraNavigationPointer(event: PointerEvent<HTMLDivElement>): boolean {
  return event.pointerType === "touch" || event.button === 1 || event.button === 2;
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

/**
 * Source-space inspection camera for captured-only rooms. It deliberately
 * avoids CameraRig's procedural-room dimensions and uses the view derived from
 * the registered runtime asset bounds.
 */
function CapturedSourceCamera({
  view,
  smoothControls,
}: {
  readonly view: RuntimeAssetCameraView;
  readonly smoothControls: boolean;
}): ReactElement {
  const { camera, invalidate } = useThree();

  useEffect(() => {
    camera.position.set(view.position[0], view.position[1], view.position[2]);
    camera.lookAt(view.target[0], view.target[1], view.target[2]);
    if (camera instanceof PerspectiveCamera) {
      camera.fov = view.fov;
      camera.updateProjectionMatrix();
    }
    invalidate();
  }, [camera, invalidate, view]);

  return (
    <OrbitControls
      makeDefault
      regress={smoothControls}
      enableDamping={smoothControls}
      dampingFactor={smoothControls ? view.dampingFactor : 0}
      target={view.target}
      minDistance={view.minDistance}
      maxDistance={view.maxDistance}
      panSpeed={view.panSpeed}
      rotateSpeed={view.rotateSpeed}
      zoomSpeed={view.zoomSpeed}
      minPolarAngle={view.minPolarAngle}
      maxPolarAngle={view.maxPolarAngle}
      onChange={() => { invalidate(); }}
    />
  );
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
): ExactGrandHallRuntimeCallbacks {
  const currentKeyRef = useRef(key);
  currentKeyRef.current = key;
  const isCurrentKey = useCallback((): boolean => (
    key !== null && sameExactGrandHallRuntimeKey(key, currentKeyRef.current)
  ), [key]);
  const onReady = useCallback((): void => {
    if (key === null || !isCurrentKey()) return;
    useCockpitStore.getState().completeExactGrandHallRuntime(key, "verified");
  }, [isCurrentKey, key]);
  const onFailed = useCallback((): void => {
    if (key === null || !isCurrentKey()) return;
    useCockpitStore.getState().completeExactGrandHallRuntime(key, "failed");
  }, [isCurrentKey, key]);
  const onSourceOnlyError = useCallback((): void => {
    if (key === null || !isCurrentKey()) return;
    useCockpitStore.getState().clearExactGrandHallRuntime(key);
  }, [isCurrentKey, key]);
  const onSourceOnlyRetry = useCallback((): void => {
    if (key === null || !isCurrentKey()) return;
    useCockpitStore.getState().beginExactGrandHallRuntime(key);
  }, [isCurrentKey, key]);
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
  // The Grand Hall capture is architecture-authoritative: layer controls may
  // not blend generated room pixels into it, and a missing capture fails
  // closed. Other rooms retain the existing Mesh ↔ Splat ↔ Hybrid policy.
  const layerMode = useCockpitStore((s) => s.layerMode);
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
  const exactGrandHallRuntimeCallbacks = useExactGrandHallRuntimeCallbacks(
    exactGrandHallRuntimeKey,
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
  const exactGrandHall = layerPolicy.kind === "captured-only"
    && delivery === "verified-grand-hall"
    && runtimePackageId !== null;
  const layerComposition = resolvePlannerLayerComposition({
    policy: layerPolicy,
    hasCapturedAsset: hasAsset,
  });
  const splatActive = layerComposition.renderCapturedArchitecture;

  // CARD A2 — "the room resolves": count chunk arrivals, derive the resolve
  // phase, and publish it for the quiet caption + the stage's honesty
  // attribute. The arrival set resets when the room's chunk list changes
  // (the hook rebuilds the array each render, so key on its joined value).
  const arrivals = useChunkArrivals(exactGrandHall ? EXACT_GRAND_HALL_MEMBER_KEY : splatUrls.join("|"));
  const totalChunks = exactGrandHall ? GRAND_HALL_CAPTURED_SOG_MEMBERS.length : splatUrls.length;
  const loadedChunks = Math.min(arrivals.loadedCount, totalChunks);
  const failedChunks = Math.min(arrivals.failedCount, totalChunks - loadedChunks);
  const resolvePhase = exactGrandHall && failedChunks > 0
    ? "fallback"
    : roomResolvePhase({ splatStatus, hasAsset, totalChunks, loadedChunks, failedChunks });
  useEffect(() => {
    useCockpitStore.getState().setRoomResolve({ phase: resolvePhase, loadedChunks, totalChunks });
  }, [loadedChunks, resolvePhase, totalChunks]);
  // Ink recedes only where captured chunks actually arrived — it honestly
  // persists over any region whose chunk failed.
  const inkOpacity = inkTargetOpacity({ splatActive, loadedChunks, totalChunks });
  const cameraInteractionClearTimer = useRef<number | null>(null);
  const sceneWarmupSignature = `${space?.id ?? "unresolved-room"}:${roomVariant}:${layerPolicy.kind}:${layerMode}:${String(hasAsset)}`;

  const clearCameraInteractionTimer = useCallback((): void => {
    if (cameraInteractionClearTimer.current === null) return;
    window.clearTimeout(cameraInteractionClearTimer.current);
    cameraInteractionClearTimer.current = null;
  }, []);

  const markCameraInteractionActive = useCallback((event: PointerEvent<HTMLDivElement>): void => {
    if (!isCameraNavigationPointer(event)) return;
    clearCameraInteractionTimer();
    useCockpitStore.getState().setCameraInteractionActive(true);
  }, [clearCameraInteractionTimer]);

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
          {hasAsset && (
            <group name="captured-room-source">
              {exactGrandHall ? (
                <ExactGrandHallSplatLayer
                  key={exactGrandHallRuntimeKey === null
                    ? "exact-grand-hall-unresolved"
                    : serializeExactGrandHallRuntimeKey(exactGrandHallRuntimeKey)}
                  runtimePackageId={runtimePackageId}
                  transform={transform}
                  active={splatActive}
                  onChunkLoaded={arrivals.markLoaded}
                  onChunkFailed={arrivals.markFailed}
                  onReady={exactGrandHallRuntimeCallbacks.onReady}
                  onFailed={exactGrandHallRuntimeCallbacks.onFailed}
                />
              ) : (
                <CockpitSplatLayer
                  urls={splatUrls}
                  transform={transform}
                  active={splatActive}
                  onChunkLoaded={arrivals.markLoaded}
                  onChunkFailed={arrivals.markFailed}
                />
              )}
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
            <CapturedSourceCamera
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
