import {
  Suspense,
  lazy,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactElement,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { SpaceDimensions } from "@omnitwin/types";
import { GRAND_HALL_RENDER_DIMENSIONS, scaleForRendering } from "../../constants/scale.js";
import { PlannerCanvasBoundary } from "../PlannerCanvasBoundary.js";
import type { AdaptiveResolutionOptions } from "../AdaptiveResolution.js";
import { CameraRig } from "../CameraRig.js";
import { GrandHallRoom } from "../GrandHallRoom.js";
import { RoomMesh, type RoomMeshDetail } from "./RoomMesh.js";
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
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { useHistoricalRuntimeStatusStore } from "../../stores/historical-runtime-status-store.js";
import {
  useLayoutTimelinePreviewStore,
  type LayoutTimelinePreviewSessionMode,
} from "../../stores/layout-timeline-preview-store.js";
import { computeBoundingBox, resolveRoomGeometry } from "../../data/room-geometries.js";
import { useChunkArrivals } from "../../hooks/use-chunk-arrivals.js";
import { useRoomRuntimeSplat } from "../../hooks/use-room-runtime-splat.js";
import { shouldRenderPlannerMotionOverlays } from "../../lib/planner-render-policy.js";
import { inkTargetOpacity, roomResolvePhase } from "../../lib/room-resolve-model.js";
import { CockpitSplatLayer } from "./CockpitSplatLayer.js";
import { InkArchitectureLayer } from "./InkArchitectureLayer.js";
import { CockpitSceneOverlays } from "./CockpitSceneOverlays.js";
import { CockpitEvidenceBeam } from "./CockpitEvidenceBeam.js";
import { CockpitCameraFocus } from "./CockpitCameraFocus.js";
import { CockpitPlanningCamera } from "./CockpitPlanningCamera.js";
import { TimelinePreviewFurniture } from "./TimelinePreviewFurniture.js";
import { SAVED_LAYOUT_FURNITURE_GROUP } from "../../lib/layout-timeline-capture.js";
import {
  retainFrozenLayoutRoomModel,
  type FrozenLayoutRoomModel,
} from "../../lib/frozen-layout-room.js";
import {
  shouldUseSyntheticGrandHallStandIn,
} from "../../lib/synthetic-grand-hall-stand-in.js";

const LazySparkRendererHost = lazy(async () => {
  const module = await import("../scene/SparkSplatLayer.js");
  return { default: module.SparkRendererHost };
});

const LazyHistoricalRuntimeLayer = lazy(async () => {
  const module = await import("./HistoricalRuntimeLayer.js");
  return { default: module.HistoricalRuntimeLayer };
});

const PlannerRoomMesh = memo(RoomMesh);

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

export function plannerRoomDetailForViewportWidth(viewportWidth: number): RoomMeshDetail {
  return viewportWidth > LEAN_PLANNER_DPR_MAX_VIEWPORT_WIDTH ? "detailed" : "lean";
}

/** Timeline playback releases the live capture so it cannot consume a third GPU budget or flash stale. */
export function shouldMountLiveRuntimeSplat(
  hasAsset: boolean,
  timelinePreviewActive: boolean,
): boolean {
  return hasAsset && !timelinePreviewActive;
}

/** Once requested, the one Spark renderer lives until its owning Canvas unmounts. */
export function plannerRuntimeRendererRequested(
  previouslyRequested: boolean,
  hasLiveRuntime: boolean,
  hasHistoricalRuntime: boolean,
): boolean {
  return previouslyRequested || hasLiveRuntime || hasHistoricalRuntime;
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
  timelinePreviewActive,
}: {
  readonly renderSceneOverlays: boolean;
  readonly timelinePreviewActive: boolean;
}): ReactElement | null {
  const cameraInteractionActive = useCockpitStore((state) => state.cameraInteractionActive);
  if (timelinePreviewActive || !shouldRenderPlannerMotionOverlays(cameraInteractionActive)) return null;

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
  asynchronous,
}: {
  readonly signature: string;
  readonly asynchronous: boolean;
}): null {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    let cancelled = false;

    const warmScenePrograms = async (): Promise<void> => {
      invalidate();
      // Timeline preview materials are harvested after mount and may be
      // replaced while a transition settles. Three's asynchronous compiler
      // polls those material programs after the render tree has changed,
      // which can dereference a disposed currentProgram. Compile the dynamic
      // presentation lens synchronously; keep the non-blocking warm-up for
      // the stable editable scene.
      if (!asynchronous) {
        gl.compile(scene, camera);
        if (!cancelled) invalidate();
        return;
      }
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
  }, [asynchronous, camera, gl, invalidate, scene, signature]);

  return null;
}

function useLiveRoomDimensions(): SpaceDimensions {
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

/**
 * Shader programs do not change merely because a frozen preview moves from a
 * keyframe into a transition or settles again. Keeping one active-preview
 * warm-up identity prevents synchronous gl.compile calls from landing on the
 * two busiest frames of a high-cardinality morph.
 */
export function plannerSceneWarmupMode(
  mode: LayoutTimelinePreviewSessionMode,
): "live" | "timeline-preview" {
  return mode === "inactive" ? "live" : "timeline-preview";
}

/**
 * Publishes a production render-readiness signal for the frozen timeline
 * scene. A timeline response becoming visible in the dock only proves that
 * React has committed the controls; it does not prove that R3F has uploaded
 * the selected snapshot's instance matrices and drawn them. This probe waits
 * for that demand-rendered frame, then publishes readiness on the following
 * browser frame so diagnostics and automation never measure scene setup as
 * steady-state interaction work.
 */
function TimelinePreviewRenderReadiness({
  renderPhase,
  renderRevision,
  roomEnvelopeKey,
  runtimePresentationReady,
}: {
  readonly renderPhase: "keyframe" | "transition" | null;
  readonly renderRevision: number;
  readonly roomEnvelopeKey: string | null;
  readonly runtimePresentationReady: boolean;
}): null {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const generationRef = useRef(0);
  const renderedGenerationRef = useRef<number | null>(null);
  const completionFrameRef = useRef<number | null>(null);

  const canvasHost = useCallback((): HTMLElement | null => (
    gl.domElement.closest<HTMLElement>(".planner-scene-canvas-host")
  ), [gl]);

  const cancelCompletionFrame = useCallback((): void => {
    if (completionFrameRef.current === null) return;
    window.cancelAnimationFrame(completionFrameRef.current);
    completionFrameRef.current = null;
  }, []);

  useLayoutEffect(() => {
    generationRef.current += 1;
    renderedGenerationRef.current = null;
    cancelCompletionFrame();
    canvasHost()?.setAttribute("data-timeline-preview-render-ready", "false");
    if (renderPhase !== null && runtimePresentationReady) invalidate();
    return cancelCompletionFrame;
  }, [
    cancelCompletionFrame,
    canvasHost,
    invalidate,
    renderPhase,
    renderRevision,
    roomEnvelopeKey,
    runtimePresentationReady,
  ]);

  useFrame(() => {
    if (
      renderPhase === null ||
      !runtimePresentationReady ||
      completionFrameRef.current !== null
    ) return;
    const generation = generationRef.current;
    if (renderedGenerationRef.current === generation) return;
    completionFrameRef.current = window.requestAnimationFrame(() => {
      completionFrameRef.current = null;
      if (generationRef.current !== generation) return;
      renderedGenerationRef.current = generation;
      canvasHost()?.setAttribute("data-timeline-preview-render-ready", "true");
    });
  });

  return null;
}

/**
 * The live editable planner scene — the single R3F canvas plus every editing
 * system (room geometry, furniture, selection, markup, circulation, camera).
 * Extracted from App so the planner cockpit can host it in its stage cell.
 */
export function PlannerScene(): ReactElement {
  const space = useEditorStore((s) => s.space);
  const liveDimensions = useLiveRoomDimensions();
  const viewportWidth = usePlannerViewportWidth();
  const canvasDpr = useMemo(() => plannerCanvasDprForViewportWidth(viewportWidth), [viewportWidth]);
  const canvasGl = useMemo(() => plannerCanvasGlForViewportWidth(viewportWidth), [viewportWidth]);
  const smoothCameraControls = shouldUseSmoothPlannerControls(viewportWidth);
  const renderSceneOverlays = shouldRenderPlannerSceneOverlays(viewportWidth);
  const roomDetail = plannerRoomDetailForViewportWidth(viewportWidth);
  // Memoized like useRoomDimensions above: the generic floorPlanOutline path
  // allocates a fresh wallPolygon per call, and this component re-renders on
  // every chunk arrival — an unmemoized call would thrash the ink layer's
  // geometry memo during the develop window (reviewer MEDIUM finding).
  const liveRoomGeometry = useMemo(
    () => (space !== null ? resolveRoomGeometry(space) : null),
    [space],
  );
  const timelinePreviewMode = useLayoutTimelinePreviewStore((state) => state.mode);
  const activeTimelineFrame = useLayoutTimelinePreviewStore((state) => state.activeFrame);
  const activeVenueRuntime = useLayoutTimelinePreviewStore((state) => state.activeVenueRuntime);
  const timelineRenderRevision = useLayoutTimelinePreviewStore((state) => state.renderRevision);
  const historicalRuntimeState = useHistoricalRuntimeStatusStore((state) => state.state);
  const historicalRuntimeBindingId = useHistoricalRuntimeStatusStore((state) => state.bindingId);
  const timelinePreviewActive = timelinePreviewMode !== "inactive";
  const authoritativeFrozenPreview = timelinePreviewMode === "keyframe"
    || timelinePreviewMode === "transition";
  const expectedHistoricalRuntime = authoritativeFrozenPreview &&
    activeTimelineFrame?.historicalRuntime?.state === "available"
    ? activeTimelineFrame.historicalRuntime.binding
    : null;
  const historicalRuntimeTerminal = historicalRuntimeState === "ready" ||
    historicalRuntimeState === "error" ||
    historicalRuntimeState === "unavailable";
  const runtimePresentationReady = expectedHistoricalRuntime === null ||
    (historicalRuntimeBindingId === expectedHistoricalRuntime.bindingId && historicalRuntimeTerminal);
  const frozenRoomRef = useRef<FrozenLayoutRoomModel | null>(null);
  const frozenRoom = retainFrozenLayoutRoomModel(
    frozenRoomRef.current,
    activeVenueRuntime,
  );
  frozenRoomRef.current = frozenRoom;
  // An authoritative saved-layout preview must never fall back to the current
  // room shell. The store only enters keyframe/transition with venueRuntime,
  // but null still fails closed here if that invariant is ever violated.
  const roomGeometry = authoritativeFrozenPreview
    ? frozenRoom?.geometry ?? null
    : timelinePreviewActive ? null : liveRoomGeometry;
  const dimensions = frozenRoom?.renderDimensions ?? liveDimensions;
  const furnitureOffset = frozenRoom?.furnitureOffset ?? [0, 0, 0] as const;

  useEffect(() => {
    if (!timelinePreviewActive) return;
    const cockpit = useCockpitStore.getState();
    cockpit.clearBeam();
    cockpit.clearFocus();
    cockpit.setLayersOpen(false);
  }, [timelinePreviewActive]);

  // Mesh ↔ Splat ↔ Hybrid: the procedural room stays visible unless a measured
  // splat is mounted AND the user has switched to pure Splat. The splat fades
  // in over the mesh (Hybrid / first load) — the captured room melting in.
  const layerMode = useCockpitStore((s) => s.layerMode);
  const { splatUrls, transform, hasAsset, status: splatStatus } = useRoomRuntimeSplat();
  const syntheticTimelineStandIn = shouldUseSyntheticGrandHallStandIn({
    mode: timelinePreviewMode,
    venueRuntime: activeVenueRuntime,
    hasExactHistoricalRuntime: expectedHistoricalRuntime !== null,
  });
  const syntheticLiveStandIn = !timelinePreviewActive
    && !hasAsset
    && (space?.slug === "grand-hall" || space?.name === "Grand Hall");
  const syntheticGrandHallStandIn = syntheticTimelineStandIn || syntheticLiveStandIn;
  const roomVariant = syntheticGrandHallStandIn
    ? "grand-hall-synthetic"
    : authoritativeFrozenPreview
      ? "generic"
      : space?.name === "Grand Hall" ? "grand-hall" : "generic";
  const roomPresentationSource = syntheticGrandHallStandIn
    ? "synthetic-stand-in"
    : expectedHistoricalRuntime !== null
      ? "historical-capture"
      : !timelinePreviewActive && hasAsset
        ? "current-runtime"
        : roomGeometry !== null
          ? "procedural-shell"
          : "none";
  const runtimeRendererRequestedRef = useRef(false);
  runtimeRendererRequestedRef.current = plannerRuntimeRendererRequested(
    runtimeRendererRequestedRef.current,
    hasAsset,
    expectedHistoricalRuntime !== null,
  );
  const runtimeRendererRequested = runtimeRendererRequestedRef.current;
  const meshVisible = authoritativeFrozenPreview
    || (!timelinePreviewActive && (!hasAsset || layerMode !== "splat"));
  const splatActive = hasAsset && layerMode !== "mesh";

  useLayoutEffect(() => {
    const statusStore = useHistoricalRuntimeStatusStore.getState();
    if (expectedHistoricalRuntime !== null) {
      if (statusStore.bindingId !== expectedHistoricalRuntime.bindingId) {
        statusStore.publish({
          state: "loading",
          bindingId: expectedHistoricalRuntime.bindingId,
          message: "Loading the exact historical room capture…",
        });
      }
      return;
    }
    if (!timelinePreviewActive) {
      statusStore.publish({ state: "inactive", bindingId: null, message: null });
      return;
    }
    const descriptor = activeTimelineFrame?.historicalRuntime ?? null;
    statusStore.publish(descriptor?.state === "unavailable"
      ? {
          state: "unavailable",
          bindingId: descriptor.binding?.bindingId ?? null,
          message: descriptor.message,
        }
      : {
          state: "unavailable",
          bindingId: null,
          message: "No exact historical room capture is bound to this timeline frame.",
        });
  }, [activeTimelineFrame?.historicalRuntime, expectedHistoricalRuntime, timelinePreviewActive]);

  // CARD A2 — "the room resolves": count chunk arrivals, derive the resolve
  // phase, and publish it for the quiet caption + the stage's honesty
  // attribute. The arrival set resets when the room's chunk list changes
  // (the hook rebuilds the array each render, so key on its joined value).
  const arrivals = useChunkArrivals(splatUrls.join("|"));
  const totalChunks = splatUrls.length;
  const loadedChunks = Math.min(arrivals.loadedCount, totalChunks);
  const failedChunks = Math.min(arrivals.failedCount, totalChunks - loadedChunks);
  const resolvePhase = roomResolvePhase({ splatStatus, hasAsset, totalChunks, loadedChunks, failedChunks });
  useEffect(() => {
    useCockpitStore.getState().setRoomResolve({ phase: resolvePhase, loadedChunks, totalChunks });
  }, [loadedChunks, resolvePhase, totalChunks]);
  // Ink recedes only where captured chunks actually arrived — it honestly
  // persists over any region whose chunk failed.
  const inkOpacity = inkTargetOpacity({ splatActive, loadedChunks, totalChunks });
  const cameraInteractionClearTimer = useRef<number | null>(null);
  const sceneWarmupSignature = [
    space?.id ?? "fallback-grand-hall",
    roomVariant,
    layerMode,
    String(hasAsset),
    plannerSceneWarmupMode(timelinePreviewMode),
    frozenRoom?.envelopeKey ?? "live-envelope",
    activeVenueRuntime?.runtimeVenueManifestDigest ?? "no-frozen-manifest",
    activeVenueRuntime?.runtimePackageId ?? "no-frozen-package",
  ].join(":");

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
    <PlannerCanvasBoundary>
      <div
        className="planner-scene-canvas-host"
        data-room-authority={authoritativeFrozenPreview ? "frozen" : timelinePreviewActive ? "unavailable" : "live"}
        data-room-presentation-source={roomPresentationSource}
        data-synthetic-grand-hall-stand-in={String(syntheticGrandHallStandIn)}
        data-room-envelope-key={frozenRoom?.envelopeKey}
        data-room-render-dimensions={`${String(dimensions.width)},${String(dimensions.length)},${String(dimensions.height)}`}
        data-room-furniture-offset={furnitureOffset.join(",")}
        data-current-splat-suppressed={String(timelinePreviewActive)}
        data-historical-runtime-state={historicalRuntimeState}
        data-historical-runtime-binding-id={historicalRuntimeBindingId ?? undefined}
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
          <color attach="background" args={[syntheticGrandHallStandIn ? "#080d12" : "#eee9de"]} />
          <fog
            attach="fog"
            args={syntheticGrandHallStandIn ? ["#0b1118", 48, 126] : ["#efe9dc", 54, 138]}
          />
          <SceneProvider />
          {runtimeRendererRequested && (
            <Suspense fallback={null}>
              <LazySparkRendererHost />
            </Suspense>
          )}
          {expectedHistoricalRuntime !== null && (
            <Suspense fallback={null}>
              <LazyHistoricalRuntimeLayer />
            </Suspense>
          )}
          <PlannerScenePrecompiler
            signature={sceneWarmupSignature}
            asynchronous={!timelinePreviewActive}
          />
          <SectionPlane />
          <InvalidateOnToggle />
          {meshVisible && (roomGeometry !== null ? (
            <PlannerRoomMesh geometry={roomGeometry} variant={roomVariant} detail={roomDetail} />
          ) : !timelinePreviewActive ? (
            <>
              <AutoWallSelector />
              <GrandHallRoom />
            </>
          ) : null)}
          {roomGeometry !== null && (
            <InkArchitectureLayer
              polygon={roomGeometry.wallPolygon}
              ceilingHeightM={roomGeometry.ceilingHeight}
              targetOpacity={authoritativeFrozenPreview ? 1 : inkOpacity}
              instant={timelinePreviewActive}
            />
          )}
          {shouldMountLiveRuntimeSplat(hasAsset, timelinePreviewActive) && (
            <CockpitSplatLayer
              urls={splatUrls}
              transform={transform}
              active={splatActive}
              includeRendererHost={false}
              onChunkLoaded={arrivals.markLoaded}
              onChunkFailed={arrivals.markFailed}
            />
          )}
          {!timelinePreviewActive && <CockpitCameraFocus />}
          <CockpitPlanningCamera dimensionsOverride={authoritativeFrozenPreview ? dimensions : undefined} />
          <XrayToggle />
          {!timelinePreviewActive && <MeasurementTool />}
          {!timelinePreviewActive && <TapeMeasure />}
          <group name={SAVED_LAYOUT_FURNITURE_GROUP} visible={!timelinePreviewActive}>
            <PlacedFurniture />
          </group>
          <group position={furnitureOffset}>
            <TimelinePreviewFurniture />
          </group>
          <TimelinePreviewRenderReadiness
            renderPhase={authoritativeFrozenPreview ? timelinePreviewMode : null}
            renderRevision={timelineRenderRevision}
            roomEnvelopeKey={frozenRoom?.envelopeKey ?? null}
            runtimePresentationReady={runtimePresentationReady}
          />
          {!timelinePreviewActive && <PlacementGhost />}
          {!timelinePreviewActive && <SelectionSystem />}
          <PlannerMotionOverlayLayers
            renderSceneOverlays={renderSceneOverlays}
            timelinePreviewActive={timelinePreviewActive}
          />
          <CameraRig dimensions={dimensions} smoothControls={smoothCameraControls} />
          {import.meta.env.DEV && <PerfMonitor />}
        </Canvas>
      </div>
    </PlannerCanvasBoundary>
  );
}
