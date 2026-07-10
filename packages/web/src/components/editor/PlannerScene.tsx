import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactElement } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import type { SpaceDimensions } from "@omnitwin/types";
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
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { computeBoundingBox, resolveRoomGeometry } from "../../data/room-geometries.js";
import { useRoomRuntimeSplat } from "../../hooks/use-room-runtime-splat.js";
import { shouldRenderPlannerMotionOverlays } from "../../lib/planner-render-policy.js";
import { CockpitSplatLayer } from "./CockpitSplatLayer.js";
import { CockpitSceneOverlays } from "./CockpitSceneOverlays.js";
import { CockpitEvidenceBeam } from "./CockpitEvidenceBeam.js";
import { CockpitCameraFocus } from "./CockpitCameraFocus.js";
import { CockpitPlanningCamera } from "./CockpitPlanningCamera.js";

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
  const roomGeometry = space !== null ? resolveRoomGeometry(space) : null;
  const roomVariant = space?.name === "Grand Hall" ? "grand-hall" : "generic";

  // Mesh ↔ Splat ↔ Hybrid: the procedural room stays visible unless a measured
  // splat is mounted AND the user has switched to pure Splat. The splat fades
  // in over the mesh (Hybrid / first load) — the captured room melting in.
  const layerMode = useCockpitStore((s) => s.layerMode);
  const { splatUrls, transform, hasAsset } = useRoomRuntimeSplat();
  const meshVisible = !hasAsset || layerMode !== "splat";
  const splatActive = hasAsset && layerMode !== "mesh";
  const cameraInteractionClearTimer = useRef<number | null>(null);
  const sceneWarmupSignature = `${space?.id ?? "fallback-grand-hall"}:${roomVariant}:${layerMode}:${String(hasAsset)}`;

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
          <fog attach="fog" args={["#efe9dc", 54, 138]} />
          <SceneProvider />
          <PlannerScenePrecompiler signature={sceneWarmupSignature} />
          <SectionPlane />
          <InvalidateOnToggle />
          {meshVisible && (roomGeometry !== null ? (
            <RoomMesh geometry={roomGeometry} variant={roomVariant} />
          ) : (
            <>
              <AutoWallSelector />
              <GrandHallRoom />
            </>
          ))}
          {hasAsset && (
            <CockpitSplatLayer urls={splatUrls} transform={transform} active={splatActive} />
          )}
          <CockpitCameraFocus />
          <CockpitPlanningCamera />
          <XrayToggle />
          <MeasurementTool />
          <TapeMeasure />
          <PlacedFurniture />
          <PlacementGhost />
          <SelectionSystem />
          <PlannerMotionOverlayLayers renderSceneOverlays={renderSceneOverlays} />
          <CameraRig dimensions={dimensions} smoothControls={smoothCameraControls} />
          {import.meta.env.DEV && <PerfMonitor />}
        </Canvas>
      </div>
    </PlannerCanvasBoundary>
  );
}
