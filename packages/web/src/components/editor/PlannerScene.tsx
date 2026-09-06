import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent, type ReactElement } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import type { SpaceDimensions } from "@omnitwin/types";
import { GRAND_HALL_RENDER_DIMENSIONS, scaleForRendering } from "../../constants/scale.js";
import { PlannerCanvasBoundary } from "../PlannerCanvasBoundary.js";
import { CameraRig } from "../CameraRig.js";
import { InteriorCamera } from "../rooms/InteriorCamera.js";
import { roomSplatBundle, walkPoseForBundle } from "../../data/room-splat-bundles.js";
import { prefersReducedMotion } from "../../lib/reduced-motion.js";
import { GrandHallRoom } from "../GrandHallRoom.js";
import { RoomLighting } from "../RoomLighting.js";
import { FurnitureLightingExperiment } from "./FurnitureLightingExperiment.js";
import { resolveFurnitureLightingExperiment } from "../../lib/furniture-lighting-experiment.js";
import { useLayoutTimelinePreviewStore } from "../../stores/layout-timeline-preview-store.js";
import { RoomMesh } from "./RoomMesh.js";
import { FrozenLayoutRoom } from "./FrozenLayoutRoom.js";
import { FrozenLayoutPreviewCamera } from "./FrozenLayoutPreviewCamera.js";
import { retainFrozenLayoutRoomModel, type FrozenLayoutRoomModel } from "../../lib/frozen-layout-room.js";
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
import { ClearanceRings } from "./ClearanceRings.js";
import { FurnitureMotion } from "./FurnitureMotion.js";
import { MarkupLayer } from "../MarkupLayer.js";
import { SceneProvider } from "../SceneProvider.js";
import { PerfMonitor } from "../PerfMonitor.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { useBookmarkStore } from "../../stores/bookmark-store.js";
import { hasPlannerBookmarkCamera, plannerArrivalKey, plannerArrivalPolicy, plannerInteriorOwnsCamera, plannerInteriorSpawn, plannerKeyboardNavigationEnabled } from "../../lib/planner-room-arrival.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { useToolStore } from "../../stores/tool-store.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useMarkupStore } from "../../stores/markup-store.js";
import { useMeasurementStore } from "../../stores/measurement-store.js";
import { useGuidelineStore } from "../../stores/guideline-store.js";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
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
import { readNativePlannerPixelRatio, serverPlannerPixelRatio, subscribeNativePlannerPixelRatio } from "../../lib/planner-resolution-policy.js";

/**
 * Computes render dimensions from room geometry polygon data.
 * Falls back to Grand Hall dimensions if no space is loaded.
 */
const COMPACT_PLANNER_MAX_VIEWPORT_WIDTH = 1099;
const CAMERA_INTERACTION_SETTLE_MS = 420;

export interface PlannerCanvasGlOptions {
  readonly antialias: boolean;
  readonly powerPreference: "high-performance";
  /** Dev-only capture aid; see plannerCanvasGlOptions. */
  readonly preserveDrawingBuffer: boolean;
}

export function plannerCanvasGlOptions(): PlannerCanvasGlOptions {
  return {
    antialias: true,
    powerPreference: "high-performance",
    // Dev-only capture aid (?capture=1): keep the drawing buffer so evidence
    // harnesses can read the canvas back with toDataURL. A settled demand-loop
    // splat canvas gives the compositor no frames, and page.screenshot waits
    // on one forever — in-page readback is the only capture path that returns
    // (see .claude/gotchas/splat-camera-and-capture.md). Never on in
    // production: the preserved buffer costs a fullscreen copy per frame.
    preserveDrawingBuffer:
      import.meta.env.DEV && new URLSearchParams(window.location.search).has("capture"),
  };
}

export function shouldUseSmoothPlannerControls(viewportWidth: number): boolean {
  return viewportWidth > COMPACT_PLANNER_MAX_VIEWPORT_WIDTH;
}

export function shouldRenderPlannerSceneOverlays(viewportWidth: number): boolean {
  return viewportWidth > COMPACT_PLANNER_MAX_VIEWPORT_WIDTH;
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

declare global {
  interface Window {
    __walkDebug?: {
      walkMode: boolean;
      roomSlug: string | null;
      hasAsset: boolean;
      hasWalkData: boolean;
    };
    __setWalkMode?: (value: boolean) => void;
    __plannerHands?: {
      placeTable: (x: number, z: number) => string | null;
      select: (id: string) => void;
      activeTool: () => string;
    };
  }
}

function isCameraNavigationPointer(event: PointerEvent<HTMLDivElement>): boolean {
  return event.pointerType === "touch" || event.button === 1 || event.button === 2;
}

function plannerTouchLookEnabled(): boolean {
  return !useMarkupStore.getState().active && useCatalogueStore.getState().selectedItemId === null
    && !useMeasurementStore.getState().active && !useGuidelineStore.getState().active;
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
      <ClearanceRings />
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

/** How long after the last wheel tick the camera counts as still driving —
 *  long enough to cover the rig's inertial zoom coast. */
const WHEEL_INTERACTION_SETTLE_MS = 450;

/**
 * The live editable planner scene — the single R3F canvas plus every editing
 * system (room geometry, furniture, selection, markup, circulation, camera).
 * Extracted from App so the planner cockpit can host it in its stage cell.
 */
export function PlannerScene(): ReactElement {
  const space = useEditorStore((s) => s.space);
  const timelinePreviewActive = useLayoutTimelinePreviewStore((state) => state.mode !== "inactive");
  const previewRuntime = useLayoutTimelinePreviewStore((state) => state.activeVenueRuntime);
  const frozenRoomRef = useRef<FrozenLayoutRoomModel | null>(null);
  const frozenRoom = useMemo(() => {
    frozenRoomRef.current = retainFrozenLayoutRoomModel(frozenRoomRef.current, timelinePreviewActive ? previewRuntime : null);
    return frozenRoomRef.current;
  }, [previewRuntime, timelinePreviewActive]);
  const dimensions = useRoomDimensions();
  const configId = useEditorStore((s) => s.configId);
  const arrivalKey = plannerArrivalKey(configId, space?.id ?? null);
  const viewportWidth = usePlannerViewportWidth();
  const canvasDpr = useSyncExternalStore(subscribeNativePlannerPixelRatio, readNativePlannerPixelRatio, serverPlannerPixelRatio);
  const canvasGl = useMemo(plannerCanvasGlOptions, []);
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
  const roomVariant = space?.name === "Grand Hall" ? "grand-hall" : "generic";

  // Captured interior keeps the procedural shell out of the source image.
  // Explicit Mesh/Hybrid choices and unavailable captures retain the shell.
  const layerMode = useCockpitStore((s) => s.layerMode);
  const { splatUrls, transform, hasAsset, status: splatStatus, roomSlug, source: captureSource } = useRoomRuntimeSplat();

  // Walk mode — stand in the captured room at eye level. Available only when
  // the mounted capture carries walk data (where the scanner stood and how far
  // it went); a capture without it has no honest spawn point, so the toggle
  // stays off rather than guessing one.
  const walkMode = useCockpitStore((s) => s.walkMode);
  const walkBundle = useMemo(
    () => (roomSlug !== null ? roomSplatBundle(roomSlug) : null),
    [roomSlug],
  );
  const walkData = useMemo(() => {
    // Retain the captured walk bounds. The Grand Hall has an authored arrival
    // within those bounds; other rooms keep the scanner-derived starting point.
    const pose = walkBundle === null ? null : walkPoseForBundle(walkBundle);
    if (!hasAsset || pose === null) return null;
    const { bounds: walkBounds } = pose;
    return {
      spawn: plannerInteriorSpawn(roomSlug, pose),
      bounds: {
        min: [...walkBounds.min] as [number, number, number],
        max: [...walkBounds.max] as [number, number, number],
      },
      roomHeightM: walkBundle?.extentM[1],
    };
  }, [hasAsset, walkBundle, roomSlug]);

  useEffect(() => {
    const initial = useCockpitStore.getState();
    if (initial.walkMode || initial.layerMode !== "hybrid" || initial.activeMode !== "design"
      || initial.focusRequest !== null || initial.cameraInteractionActive || hasPlannerBookmarkCamera()) {
      plannerArrivalPolicy.choose(arrivalKey);
    }
    const unsubscribeCockpit = useCockpitStore.subscribe((state, previous) => {
      if (state.walkMode !== previous.walkMode || state.layerMode !== previous.layerMode
        || state.activeMode !== previous.activeMode
        || state.focusRequest !== previous.focusRequest
        || (state.cameraInteractionActive && !previous.cameraInteractionActive)) {
        plannerArrivalPolicy.choose(arrivalKey);
      }
    });
    const unsubscribeBookmarks = useBookmarkStore.subscribe(() => {
      if (useLayoutTimelinePreviewStore.getState().mode !== "inactive") return;
      if (!hasPlannerBookmarkCamera()) return;
      plannerArrivalPolicy.choose(arrivalKey);
      // Ordinary bookmarks and tours must exit the interior owner too, not
      // only saved human POVs. The synchronous guard also covers this frame.
      if (useCockpitStore.getState().walkMode) useCockpitStore.getState().setWalkMode(false);
    });
    return () => { unsubscribeCockpit(); unsubscribeBookmarks(); };
  }, [arrivalKey]);

  useEffect(() => {
    if (timelinePreviewActive) return;
    if (!plannerArrivalPolicy.claim(arrivalKey, roomSlug === "grand-hall" && walkData !== null)) return;
    useCockpitStore.setState({ layerMode: "splat", walkMode: true });
  }, [arrivalKey, roomSlug, timelinePreviewActive, walkData]);
  // If the room changes to one with no walk data, the mode cannot stand.
  useEffect(() => {
    if (walkMode && walkData === null) useCockpitStore.getState().setWalkMode(false);
  }, [walkMode, walkData]);

  // DEV bridge for the walk mount conditions — the e2e reads this to say WHICH
  // gate refused, instead of inferring it from a silent camera. __setWalkMode
  // lets a probe flip the mode without a click, isolating input handling from
  // the mount path.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__walkDebug = {
      walkMode,
      roomSlug,
      hasAsset,
      hasWalkData: walkData !== null,
    };
    window.__setWalkMode = (value: boolean) => { useCockpitStore.getState().setWalkMode(value); };
    // __plannerHands: deterministic furniture setup for the tool-pill e2e —
    // placing through the catalogue UI would couple the pill's evidence to
    // drawer choreography. placeTable corrects position after placeItem so a
    // probe can stage exact planning gaps regardless of grid snap.
    window.__plannerHands = {
      placeTable: (x: number, z: number): string | null => {
        const table = getCatalogueItemBySlug("round-table-6ft");
        if (table === undefined) return null;
        const placement = usePlacementStore.getState();
        placement.placeItem(table.id, x, z);
        const items = usePlacementStore.getState().placedItems;
        const placed = items[items.length - 1];
        if (placed === undefined) return null;
        // Exact staging: placeItem/moveItem both grid-snap AND magnetise to
        // nearby furniture (alignment snap pulled a 0.60 m test gap shut).
        // A probe needs the coordinates it asked for, verbatim.
        usePlacementStore.setState({
          placedItems: usePlacementStore.getState().placedItems.map((item) =>
            item.id === placed.id ? { ...item, x, z } : item),
        });
        return placed.id;
      },
      select: (id: string) => { useSelectionStore.getState().select(id); },
      activeTool: () => useToolStore.getState().activeTool,
    };
  }, [walkMode, roomSlug, hasAsset, walkData]);

  // DEV bisect flag: ?walkNoCam=1 keeps walk mode's state transitions (the
  // CameraRig yield included) but skips mounting InteriorCamera, so a hang can
  // be attributed to one side or the other.
  const walkCameraDisabled = import.meta.env.DEV
    && new URLSearchParams(window.location.search).has("walkNoCam");

  // CARD A2 — "the room resolves": count chunk arrivals, derive the resolve
  // phase, and publish it for the quiet caption + the stage's honesty
  // attribute. The arrival set resets when the room's chunk list changes
  // (the hook rebuilds the array each render, so key on its joined value).
  const arrivals = useChunkArrivals(splatUrls.join("|"));
  const totalChunks = splatUrls.length;
  const loadedChunks = Math.min(arrivals.loadedCount, totalChunks);
  const failedChunks = Math.min(arrivals.failedCount, totalChunks - loadedChunks);
  const captureFailed = totalChunks > 0 && failedChunks === totalChunks;
  const meshVisible = !timelinePreviewActive && (!hasAsset || captureFailed || layerMode !== "splat");
  const splatActive = !timelinePreviewActive && hasAsset && !captureFailed && layerMode !== "mesh";
  const furnitureLighting = resolveFurnitureLightingExperiment({
    search: typeof window === "undefined" ? "" : window.location.search,
    development: import.meta.env.DEV,
    roomSlug,
    layerMode,
    splatActive,
    timelinePreviewActive,
  });
  const resolvePhase = roomResolvePhase({ splatStatus, hasAsset: hasAsset && !captureFailed, totalChunks, loadedChunks, failedChunks });
  useEffect(() => {
    if (captureFailed && walkMode) useCockpitStore.getState().setWalkMode(false);
  }, [captureFailed, walkMode]);
  useEffect(() => {
    useCockpitStore.getState().setRoomResolve({ phase: resolvePhase, loadedChunks, totalChunks });
  }, [loadedChunks, resolvePhase, totalChunks]);
  // Ink recedes only where captured chunks actually arrived — it honestly
  // persists over any region whose chunk failed.
  const inkOpacity = inkTargetOpacity({ splatActive, loadedChunks, totalChunks });
  useEffect(() => {
    const source = {
      configId, spaceId: space?.id ?? null, layerMode,
      captureSource: hasAsset && splatActive ? captureSource : "none" as const,
      loadedChunks: timelinePreviewActive ? 0 : loadedChunks,
      totalChunks: timelinePreviewActive ? 0 : totalChunks,
      proceduralGeometryVisible: timelinePreviewActive ? frozenRoom !== null : meshVisible || (roomGeometry !== null && inkOpacity > 0),
    };
    useCockpitStore.getState().setSceneSource(source);
    // A previous canvas must not withdraw a newer canvas's evidence.
    return () => { useCockpitStore.getState().clearSceneSource(source); };
  }, [captureSource, configId, frozenRoom, hasAsset, inkOpacity, layerMode, loadedChunks, meshVisible, roomGeometry, space?.id, splatActive, timelinePreviewActive, totalChunks]);
  const cameraInteractionClearTimer = useRef<number | null>(null);
  const sceneWarmupSignature = timelinePreviewActive
    ? `frozen:${frozenRoom?.envelopeKey ?? "unavailable"}`
    : `${space?.id ?? "fallback-grand-hall"}:${roomVariant}:${layerMode}:${String(hasAsset)}`;

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

  // Pointer capture below never sees wheel zoom — the sort-heaviest
  // interaction of all — so the wheel marks interaction itself, with a settle
  // window sized to the rig's inertial coast.
  const markWheelInteraction = useCallback((): void => {
    clearCameraInteractionTimer();
    useCockpitStore.getState().setCameraInteractionActive(true);
    cameraInteractionClearTimer.current = window.setTimeout(() => {
      cameraInteractionClearTimer.current = null;
      useCockpitStore.getState().setCameraInteractionActive(false);
    }, WHEEL_INTERACTION_SETTLE_MS);
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
        onPointerDownCapture={markCameraInteractionActive}
        onWheelCapture={markWheelInteraction}
        onPointerUpCapture={markCameraInteractionSettling}
        onPointerCancelCapture={markCameraInteractionSettling}
        onPointerLeave={markCameraInteractionSettling}
      >
        <Canvas
          shadows={furnitureLighting === "panorama-shadow" ? "percentage" : false}
          frameloop="demand"
          dpr={canvasDpr}
          gl={canvasGl}
          camera={{ fov: 55, near: 0.1, far: 200 }}
          style={{ width: "100%", height: "100%" }}
        >
          <color attach="background" args={["#eee9de"]} />
          {!timelinePreviewActive && <fog attach="fog" args={["#efe9dc", 54, 138]} />}
          <SceneProvider />
          <PlannerScenePrecompiler signature={sceneWarmupSignature} />
          {!timelinePreviewActive && <SectionPlane />}
          {!timelinePreviewActive && <InvalidateOnToggle />}
          {/* Furniture needs scene lighting even when the captured layer hides
              the procedural shell or camera motion selects its lean version. */}
          {furnitureLighting === "baseline" ? (
            <RoomLighting variant={!timelinePreviewActive && roomGeometry === null ? "grand-hall" : "polygon"} />
          ) : (
            <FurnitureLightingExperiment shadows={furnitureLighting === "panorama-shadow"} />
          )}
          {meshVisible && (roomGeometry !== null ? (
            <RoomMesh geometry={roomGeometry} variant={roomVariant} includeLighting={false} />
          ) : (
            <>
              <AutoWallSelector />
              <GrandHallRoom includeLighting={false} />
            </>
          ))}
          {timelinePreviewActive && frozenRoom !== null && <FrozenLayoutRoom room={frozenRoom} />}
          {!timelinePreviewActive && roomGeometry !== null && (
            <InkArchitectureLayer
              polygon={roomGeometry.wallPolygon}
              ceilingHeightM={roomGeometry.ceilingHeight}
              targetOpacity={inkOpacity}
            />
          )}
          {hasAsset && (
            // Keep decoded meshes and their renderer host, but hide the whole
            // capture immediately: a layer dissolve would leak today's room
            // behind an immutable historical plan for several frames.
            <group name="live-room-capture" visible={!timelinePreviewActive}>
              <CockpitSplatLayer
                urls={splatUrls}
                transform={transform}
                active={splatActive}
                onChunkLoaded={arrivals.markLoaded}
                onChunkFailed={arrivals.markFailed}
              />
            </group>
          )}
          {!timelinePreviewActive && <>
            <CockpitCameraFocus />
            <CockpitPlanningCamera />
            <XrayToggle />
            <MeasurementTool />
            <TapeMeasure />
            <PlacementGhost />
            <SelectionSystem />
            <FurnitureMotion />
            <PlannerMotionOverlayLayers renderSceneOverlays={renderSceneOverlays} />
          </>}
          <group name="planner-furniture-frame" position={timelinePreviewActive && frozenRoom !== null ? [...frozenRoom.furnitureOffset] : [0, 0, 0]}>
            <PlacedFurniture />
          </group>
          <CameraRig dimensions={dimensions} smoothControls={smoothCameraControls} suspended={timelinePreviewActive} />
          {walkMode && walkData !== null && !walkCameraDisabled && !captureFailed && (
            <InteriorCamera
              key={roomSlug ?? "walk"}
              spawn={walkData.spawn}
              bounds={walkData.bounds}
              roomHeightM={walkData.roomHeightM}
              inputPolicy="planner"
              ownsCamera={plannerInteriorOwnsCamera}
              touchLookEnabled={plannerTouchLookEnabled}
              keyboardNavigationEnabled={plannerKeyboardNavigationEnabled}
              reducedMotion={prefersReducedMotion()}
              // Canvas owns native resolution from its first frame. Switching
              // camera modes must not resize or restore an older drawing buffer.
              managePixelRatio={false}
            />
          )}
          <FrozenLayoutPreviewCamera active={timelinePreviewActive} room={frozenRoom} />
          {import.meta.env.DEV && <PerfMonitor />}
        </Canvas>
      </div>
    </PlannerCanvasBoundary>
  );
}
