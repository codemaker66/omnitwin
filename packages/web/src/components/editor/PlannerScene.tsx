import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Canvas } from "@react-three/fiber";
import type { SpaceDimensions } from "@omnitwin/types";
import { GRAND_HALL_RENDER_DIMENSIONS, scaleForRendering } from "../../constants/scale.js";
import { PlannerCanvasBoundary } from "../PlannerCanvasBoundary.js";
import { AdaptiveResolution, type AdaptiveResolutionOptions } from "../AdaptiveResolution.js";
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
export const TABLET_PLANNER_DPR = 0.75;
export const DESKTOP_PLANNER_DPR = 1;
export const DESKTOP_PLANNER_INTERACTION_MIN_DPR = 0.5;
export const PLANNER_CANVAS_PERFORMANCE = {
  min: 0.25,
  debounce: 180,
} as const;

export interface PlannerCanvasGlOptions {
  readonly antialias: boolean;
  readonly powerPreference: "high-performance";
}

export function plannerCanvasDprForViewportWidth(viewportWidth: number): [number, number] {
  if (viewportWidth > 480 && viewportWidth <= LEAN_PLANNER_DPR_MAX_VIEWPORT_WIDTH) {
    return [TABLET_PLANNER_DPR, TABLET_PLANNER_DPR];
  }
  return viewportWidth <= LEAN_PLANNER_DPR_MAX_VIEWPORT_WIDTH
    ? [1, 1]
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
    enabled: viewportWidth > LEAN_PLANNER_DPR_MAX_VIEWPORT_WIDTH,
    minDpr: viewportWidth > LEAN_PLANNER_DPR_MAX_VIEWPORT_WIDTH
      ? DESKTOP_PLANNER_INTERACTION_MIN_DPR
      : minDpr,
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
  const adaptiveResolution = useMemo(
    () => plannerAdaptiveResolutionForViewportWidth(viewportWidth),
    [viewportWidth],
  );
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

  return (
    <PlannerCanvasBoundary>
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
        {renderSceneOverlays && <CockpitSceneOverlays />}
        <CockpitEvidenceBeam />
        <CockpitCameraFocus />
        <CockpitPlanningCamera />
        <XrayToggle />
        <MeasurementTool />
        <TapeMeasure />
        <PlacedFurniture />
        <PlacementGhost />
        <SelectionSystem />
        <SnapGuides />
        <CirculationOverlay />
        <MarqueeSelect />
        <MarkupLayer />
        <DiagramLabels />
        <CameraRig dimensions={dimensions} smoothControls={smoothCameraControls} />
        {adaptiveResolution.enabled === true && (
          <AdaptiveResolution minDpr={adaptiveResolution.minDpr} maxDpr={adaptiveResolution.maxDpr} />
        )}
        {import.meta.env.DEV && <PerfMonitor />}
      </Canvas>
    </PlannerCanvasBoundary>
  );
}
