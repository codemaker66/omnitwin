import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  NormalBlending,
  Vector3,
  type Group,
  type ShaderMaterial,
} from "three";
import type { AgentTrajectory, DensityHeatmapCell, RouteConflict, SpaceDimensions } from "@omnitwin/types";
import { useCockpitStore, type CockpitBeam } from "../../stores/cockpit-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";
import { useCockpitReplay } from "../../hooks/use-cockpit-replay.js";
import {
  buildFlowRibbonGeometry,
  densityPatchExtent,
  projectReplayPointToFloor,
  sampleTrajectoryAtProgress,
  trajectoryFloorPolyline,
  type ReplayRoomBounds,
  type WorldPoint,
} from "../../lib/cockpit-overlay-projection.js";
import {
  advanceFlowRibbonTime,
  getFlowRibbonMaterial,
  getRadialGlowTexture,
} from "../../lib/cockpit-overlay-materials.js";
import {
  cockpitOverlayLayers,
  conflictSeverityColor,
  densityLevelColor,
  selectDensityCells,
  selectFlowTrajectories,
  selectMoteTrajectories,
  selectRouteConflicts,
  shouldLoadReplay,
} from "../../lib/cockpit-scene-overlay-model.js";

import { annotationSafeArea, placeSceneAnnotations, rectanglesOverlap, type AnnotationMeasure, type AnnotationRect } from "../../lib/cockpit-scene-annotation-layout.js";
import "./CockpitSceneAnnotations.css";

// ---------------------------------------------------------------------------
// CockpitSceneOverlays — world-anchored, camera-tracked planning overlays.
//
// This replaces the dev page's percentage-positioned 2D overlays with real
// R3F geometry that lives *inside* the editable canvas, so it pins to the
// floor and tracks the camera under orbit / pan / zoom. Everything is driven
// by the real guest-flow replay artifact + the loaded room footprint through
// the tested pure mappers; the lens + Layers toggles decide what shows.
//
// SAFE: these are *simulated* planning overlays — human review required. No
// overlay claims a measured route, a certified clearance, or a surveyed
// heritage boundary. The heritage band is an explicit planning guide and the
// lighting probe grid is an explicit placeholder.
// ---------------------------------------------------------------------------

const FLOW_Y = 0.06;
const MOTE_Y = 0.22;
const DENSITY_Y = 0.04;
const CONFLICT_Y = 0.05;
const HERITAGE_Y = 0.05;
const PROBE_Y = 0.04;

const MAX_FLOW_PATHS = 6;
const MAX_MOTES = 10;
const MAX_DENSITY = 8;
const MAX_CONFLICTS = 4;
const DEFAULT_DENSITY_CELL_SIZE_M = 1.5;

const MOTE_SPEED = 0.12; // cycles per second
const MOTE_PHASE = 0.13; // per-mote offset so they don't move in lockstep

const FLOW_RIBBON_HALF_WIDTH = 0.34; // scene units → ~0.68 unit band, soft edges
const DENSITY_PATCH_SCALE = 2.2; // enlarge soft blobs so they pool into a field
const MOTE_SIZE = 0.9; // sprite scale for the firefly glow

const MOTE_COLOR = "#d7f0ff";
const HERITAGE_COLOR = "#c9a84c";
const PROBE_COLOR = "#c9b06b";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function rectOutlineGeometry(halfWidth: number, halfLength: number, y: number): BufferGeometry {
  const corners: WorldPoint[] = [
    [-halfWidth, y, -halfLength],
    [halfWidth, y, -halfLength],
    [halfWidth, y, halfLength],
    [-halfWidth, y, halfLength],
  ];
  const verts: number[] = [];
  for (let i = 0; i < corners.length; i += 1) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    if (a === undefined || b === undefined) continue;
    verts.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(verts, 3));
  return geo;
}

function FlowRibbon({
  points,
  material,
}: {
  readonly points: readonly WorldPoint[];
  readonly material: ShaderMaterial;
}): ReactElement | null {
  const geometry = useMemo(() => {
    const data = buildFlowRibbonGeometry(points, FLOW_RIBBON_HALF_WIDTH);
    if (data.length === 0) return null;
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(data.positions, 3));
    geo.setAttribute("uv", new Float32BufferAttribute(data.uv, 2));
    geo.setAttribute("aDist", new Float32BufferAttribute(data.dist, 1));
    geo.setIndex(new BufferAttribute(data.index, 1));
    return geo;
  }, [points]);
  useEffect(() => () => { geometry?.dispose(); }, [geometry]);
  if (geometry === null) return null;
  return <mesh geometry={geometry} material={material} renderOrder={3} />;
}

function FlowPaths({
  trajectories,
  bounds,
  dimensions,
}: {
  readonly trajectories: readonly AgentTrajectory[];
  readonly bounds: ReplayRoomBounds;
  readonly dimensions: SpaceDimensions;
}): ReactElement {
  const invalidate = useThree((state) => state.invalidate);
  const material = getFlowRibbonMaterial();
  const reduced = prefersReducedMotion();

  // One shared uniform animates every ribbon; the geometry never changes per
  // frame, so the whole flow field costs a single uniform write + one redraw.
  useFrame((_state, delta) => {
    if (reduced) return;
    advanceFlowRibbonTime(material, delta);
    invalidate();
  });

  const polylines = useMemo(
    () =>
      trajectories.map((trajectory) => ({
        id: trajectory.agentId,
        points: trajectoryFloorPolyline(trajectory.points, bounds, dimensions, FLOW_Y),
      })),
    [trajectories, bounds, dimensions],
  );

  return (
    <group name="cockpit-flow-paths" renderOrder={3}>
      {polylines.map((polyline) => (
        <FlowRibbon key={polyline.id} points={polyline.points} material={material} />
      ))}
    </group>
  );
}

function AgentMotes({
  trajectories,
  bounds,
  dimensions,
}: {
  readonly trajectories: readonly AgentTrajectory[];
  readonly bounds: ReplayRoomBounds;
  readonly dimensions: SpaceDimensions;
}): ReactElement {
  const invalidate = useThree((state) => state.invalidate);
  const texture = getRadialGlowTexture();
  const groupRef = useRef<Group>(null);
  const progress = useRef(0);
  const reduced = prefersReducedMotion();

  useFrame((_state, delta) => {
    if (reduced) return;
    const group = groupRef.current;
    if (group === null) return;
    progress.current = (progress.current + delta * MOTE_SPEED) % 1;
    group.children.forEach((child, index) => {
      const trajectory = trajectories[index];
      if (trajectory === undefined) return;
      const t = (progress.current + index * MOTE_PHASE) % 1;
      const p = sampleTrajectoryAtProgress(trajectory.points, t, bounds, dimensions, MOTE_Y);
      child.position.set(p[0], p[1], p[2]);
    });
    invalidate();
  });

  return (
    <group ref={groupRef} name="cockpit-agent-motes" renderOrder={4}>
      {trajectories.map((trajectory, index) => {
        const t0 = reduced ? index / Math.max(1, trajectories.length) : (index * MOTE_PHASE) % 1;
        const p = sampleTrajectoryAtProgress(trajectory.points, t0, bounds, dimensions, MOTE_Y);
        return (
          <sprite
            key={trajectory.agentId}
            position={[p[0], p[1], p[2]]}
            scale={[MOTE_SIZE, MOTE_SIZE, MOTE_SIZE]}
            renderOrder={4}
          >
            <spriteMaterial
              map={texture}
              color={MOTE_COLOR}
              transparent
              opacity={0.95}
              blending={NormalBlending}
              depthWrite={false}
              depthTest={false}
            />
          </sprite>
        );
      })}
    </group>
  );
}

function DensityPatches({
  cells,
  cellSizeM,
  bounds,
  dimensions,
}: {
  readonly cells: readonly DensityHeatmapCell[];
  readonly cellSizeM: number;
  readonly bounds: ReplayRoomBounds;
  readonly dimensions: SpaceDimensions;
}): ReactElement {
  const texture = getRadialGlowTexture();
  const { sizeX, sizeZ } = densityPatchExtent(cellSizeM, bounds, dimensions);
  // Enlarge each soft radial blob so neighbouring cells overlap into one
  // continuous field of warm light instead of reading as discrete tiles.
  const patchX = sizeX * DENSITY_PATCH_SCALE;
  const patchZ = sizeZ * DENSITY_PATCH_SCALE;
  return (
    <group name="cockpit-density" renderOrder={2}>
      {cells.map((cell) => {
        const [x, , z] = projectReplayPointToFloor(cell, bounds, dimensions, DENSITY_Y);
        return (
          <mesh
            key={`${String(cell.x)}:${String(cell.y)}:${String(cell.count)}`}
            position={[x, DENSITY_Y, z]}
            rotation={[-Math.PI / 2, 0, 0]}
            renderOrder={2}
          >
            <planeGeometry args={[patchX, patchZ]} />
            <meshBasicMaterial
              map={texture}
              color={densityLevelColor(cell.level)}
              transparent
              opacity={cell.level === "high" ? 0.62 : 0.42}
              blending={NormalBlending}
              depthWrite={false}
              side={DoubleSide}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function RouteConflictMarker({
  conflict,
  bounds,
  dimensions,
}: {
  readonly conflict: RouteConflict;
  readonly bounds: ReplayRoomBounds;
  readonly dimensions: SpaceDimensions;
}): ReactElement {
  const [x, , z] = projectReplayPointToFloor(conflict.point, bounds, dimensions, CONFLICT_Y);
  const color = conflictSeverityColor(conflict.severity);

  return (
    <group position={[x, CONFLICT_Y, z]} renderOrder={5}>
      {/* Floor ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}>
        <ringGeometry args={[0.5, 0.66, 28]} />
        <meshBasicMaterial color={color} transparent opacity={0.85} depthWrite={false} side={DoubleSide} />
      </mesh>
      {/* The screen annotation owns the accessible disclosure for this pin. */}
      <mesh
        position={[0, 0.5, 0]}
        renderOrder={5}
      >
        <sphereGeometry args={[0.16, 12, 12]} />
        <meshBasicMaterial color={color} depthWrite={false} />
      </mesh>

    </group>
  );
}

function HeritageBufferBand({ dimensions }: { readonly dimensions: SpaceDimensions }): ReactElement {
  // Honest planning guide: a band inset from the room perimeter where it is
  // wise to keep furniture clear of walls / protected features. It is NOT a
  // surveyed heritage boundary — the label says so.
  const inset = 1.2;
  const halfWidth = Math.max(0.5, dimensions.width / 2 - inset);
  const halfLength = Math.max(0.5, dimensions.length / 2 - inset);
  const geometry = useMemo(
    () => rectOutlineGeometry(halfWidth, halfLength, HERITAGE_Y),
    [halfWidth, halfLength],
  );
  useEffect(() => () => { geometry.dispose(); }, [geometry]);
  return (
    <group name="cockpit-heritage" renderOrder={3}>
      <lineSegments geometry={geometry} renderOrder={3}>
        <lineBasicMaterial color={HERITAGE_COLOR} transparent opacity={0.5} depthTest={false} />
      </lineSegments>

    </group>
  );
}

function LightingProbeGrid({ dimensions }: { readonly dimensions: SpaceDimensions }): ReactElement {
  // Explicit placeholder: a regular probe grid, not measured photometrics.
  const cols = 3;
  const rows = 2;
  const halfWidth = dimensions.width / 2;
  const halfLength = dimensions.length / 2;
  const probes: WorldPoint[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x = -halfWidth * 0.6 + (c / (cols - 1)) * halfWidth * 1.2;
      const z = -halfLength * 0.6 + (r / (rows - 1)) * halfLength * 1.2;
      probes.push([x, PROBE_Y, z]);
    }
  }
  return (
    <group name="cockpit-lighting-probes" renderOrder={3}>
      {probes.map((p, index) => (
        <mesh key={`probe-${String(index)}`} position={[p[0], PROBE_Y, p[2]]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
          <ringGeometry args={[0.28, 0.36, 20]} />
          <meshBasicMaterial color={PROBE_COLOR} transparent opacity={0.5} depthWrite={false} side={DoubleSide} />
        </mesh>
      ))}

    </group>
  );
}

interface SceneAnnotation {
  readonly id: string;
  readonly caption: string;
  readonly detail: string;
  readonly color: string;
  readonly priority: number;
  readonly anchor: WorldPoint;
  readonly beamAnchor: WorldPoint;
  readonly tone: CockpitBeam["tone"];
}
const HTML_ORIGIN = (): number[] => [0, 0];
// This is a screen layout owner, not a world object to hide behind the camera.
const KEEP_SCREEN_LAYER_VISIBLE = (): undefined => undefined;
const BLOCKING_UI = [
  ".reference-left-dock", ".reference-inspector-dock", ".lens-panel", ".cockpit-truth",
  ".planner-tool-pill", ".reference-more-tools", ".reference-extra-tools", ".planner-command-deck",
  "[data-testid='mobile-planner-topbar']", ".mobile-planner-dock", ".planner-status-header",
  "[data-floating-widget-id]", "[aria-label='Room view']", "[aria-label='View mode']",
  ".mobile-planner-utilities > *", "[data-testid='truth-mode-popover']",
  "[aria-label='Room layout timeline']", "[data-testid='cockpit-bottom']", ".client-event-dock", ".room-resolve-caption",
].join(", ");
const MODAL_UI = "[role='dialog'][aria-modal='true'], dialog[open]";

function hasVisibleBounds(element: Element): boolean {
  // Resolve captions retain their text and box while their success state fades.
  if (element.matches(".room-resolve-caption") && element.getAttribute("data-visible") !== "true") return false;
  const box = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility !== "hidden";
}

// Mobile chrome is a sibling of the cockpit; floating View controls portal to
// the body. Use the same explicit, canvas-intersecting set for layout and resize
// observation so neither owner can silently fall outside the measured shell.
function visibleCanvasBlockers(canvas: HTMLCanvasElement): HTMLElement[] {
  const canvasBox = canvas.getBoundingClientRect();
  return [...canvas.ownerDocument.querySelectorAll<HTMLElement>(BLOCKING_UI)]
    .filter((element) => hasVisibleBounds(element) && rectanglesOverlap(canvasBox, element.getBoundingClientRect()));
}

function SceneAnnotations({ annotations }: { readonly annotations: readonly SceneAnnotation[] }): ReactElement {
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const annotationId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLDivElement>());
  const lines = useRef(new Map<string, SVGLineElement>());
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const dirty = useRef(true);
  const lastCamera = useRef("");
  const covered = useRef(false);
  const projected = useMemo(() => new Vector3(), []);
  const cameraPoint = useMemo(() => new Vector3(), []);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const ownedBeam = useRef<CockpitBeam | null>(null);
  const clearOwnedBeam = useCallback(() => {
    const own = ownedBeam.current;
    if (own !== null && useCockpitStore.getState().beam === own) useCockpitStore.getState().clearBeam();
    ownedBeam.current = null;
  }, []);
  const raiseBeam = (annotation: SceneAnnotation): void => {
    const beam: CockpitBeam = { anchor: annotation.beamAnchor, label: `${annotation.caption}. ${annotation.detail}`, tone: annotation.tone, showLabel: false };
    ownedBeam.current = beam;
    useCockpitStore.getState().setBeam(beam);
  };
  const dismiss = (): void => {
    const previous = selectedRef.current;
    selectedRef.current = null;
    setSelected(null);
    if (previous !== null) buttons.current.get(previous)?.focus();
    clearOwnedBeam();
    dirty.current = true;
    invalidate();
  };

  useEffect(() => {
    selectedRef.current = null;
    setSelected(null);
    dirty.current = true;
    invalidate();
    return clearOwnedBeam;
  }, [annotations, clearOwnedBeam, invalidate]);

  useEffect(() => {
    const shell = canvas.closest(".reference-viewer, .cockpit-shell") ?? canvas.parentElement;
    const markDirty = (): void => { dirty.current = true; invalidate(); };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(markDirty);
    const observeBounds = (): void => {
      observer?.disconnect();
      if (shell !== null) observer?.observe(shell);
      visibleCanvasBlockers(canvas).forEach((element) => { observer?.observe(element); });
      canvas.ownerDocument.querySelectorAll(MODAL_UI).forEach((element) => { observer?.observe(element); });
      cards.current.forEach((element) => { observer?.observe(element); });
      markDirty();
    };
    observeBounds();
    // Portalled dialogs and translated docks can change without resizing.
    // Ignore our own layout writes, which otherwise create a perpetual loop.
    const membership = new MutationObserver((records) => {
      const relevant = records.some((record) => {
        if (rootRef.current?.contains(record.target) === true) return false;
        if (record.type === "childList") return true;
        return record.target instanceof Element
          && (record.target.closest(`${BLOCKING_UI}, ${MODAL_UI}`) !== null
            || record.target.querySelector(MODAL_UI) !== null);
      });
      if (relevant) observeBounds();
    });
    membership.observe(canvas.ownerDocument.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["style", "class", "hidden", "open", "aria-hidden", "data-visible"],
    });
    window.addEventListener("resize", markDirty);
    window.addEventListener("scroll", markDirty, true);
    return () => {
      observer?.disconnect();
      membership.disconnect();
      window.removeEventListener("resize", markDirty);
      window.removeEventListener("scroll", markDirty, true);
    };
  }, [canvas, annotations, invalidate]);

  useFrame(() => {
    const root = rootRef.current, viewport = viewportRef.current, content = cardsRef.current;
    if (root === null || viewport === null || content === null) return;
    camera.updateMatrixWorld();
    const signature = `${camera.matrixWorld.elements.join(",")}/${camera.projectionMatrix.elements.join(",")}/${String(size.width)}/${String(size.height)}`;
    if (!dirty.current && lastCamera.current === signature) return;
    dirty.current = false;
    lastCamera.current = signature;
    const canvasBox = canvas.getBoundingClientRect();
    const obstacles: AnnotationRect[] = visibleCanvasBlockers(canvas).map((element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x - canvasBox.x, y: box.y - canvasBox.y, width: box.width, height: box.height };
    });
    const modalOpen = [...canvas.ownerDocument.querySelectorAll(MODAL_UI)].some(hasVisibleBounds);
    const area = modalOpen ? null : annotationSafeArea({ x: 0, y: 0, width: size.width, height: size.height }, obstacles);
    // A covering surface owns the screen/focus until it closes. The records
    // remain mounted and the observer restores their spatial display afterwards.
    root.style.visibility = area === null ? "hidden" : "visible";
    root.setAttribute("aria-hidden", String(area === null));
    root.toggleAttribute("inert", area === null);
    if (area === null) { covered.current = true; clearOwnedBeam(); return; }
    if (covered.current) {
      covered.current = false;
      const active = annotations.find((annotation) => annotation.id === selectedRef.current);
      if (active !== undefined && useCockpitStore.getState().beam === null) raiseBeam(active);
    }
    const width = Math.min(244, area.width);
    const anchors = new Map<string, { x: number; y: number; visible: boolean }>();
    cards.current.forEach((element) => { element.style.width = `${String(width)}px`; });
    const measure = (cardWidth: number): AnnotationMeasure[] => annotations.map((annotation) => {
      projected.set(...annotation.anchor).project(camera);
      cameraPoint.set(...annotation.anchor).applyMatrix4(camera.matrixWorldInverse);
      const visible = cameraPoint.z < 0 && projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1;
      const x = (projected.x + 1) * size.width / 2, y = (1 - projected.y) * size.height / 2;
      anchors.set(annotation.id, { x, y, visible });
      const card = cards.current.get(annotation.id);
      const location = card?.querySelector<HTMLElement>(".scene-annotations__location");
      if (location !== null && location !== undefined) location.hidden = visible;
      return { id: annotation.id, priority: annotation.priority, x: visible ? x : area.x + area.width / 2, y: visible ? y : area.y + area.height / 2, width: cardWidth, height: Math.max(44, card?.getBoundingClientRect().height ?? 44) };
    });
    let layout = placeSceneAnnotations(measure(width), area);
    root.dataset["layout"] = layout.mode;
    if (layout.mode === "list") {
      Object.assign(viewport.style, { left: `${String(area.x)}px`, top: `${String(area.y)}px`, width: `${String(width)}px`, height: `${String(area.height)}px` });
      // The native scrollbar consumes real inline space on Windows. Re-measure
      // wrapped cards after the list has its actual inner width, not the shell width.
      const innerWidth = viewport.clientWidth;
      if (innerWidth > 0) {
        cards.current.forEach((element) => { element.style.width = `${String(innerWidth)}px`; });
        const headingHeight = viewport.querySelector(".scene-annotations__list-label")?.getBoundingClientRect().height ?? 0;
        layout = placeSceneAnnotations(measure(innerWidth), {
          ...area, width: innerWidth, height: Math.max(1, area.height - headingHeight),
        });
      }
      content.style.height = `${String(layout.contentHeight)}px`;
    } else {
      Object.assign(viewport.style, { left: "0px", top: "0px", width: `${String(size.width)}px`, height: `${String(size.height)}px` });
      content.style.height = "0px";
    }
    layout.placements.forEach((placement) => {
      const card = cards.current.get(placement.id), line = lines.current.get(placement.id), anchor = anchors.get(placement.id);
      if (card !== undefined) card.style.transform = `translate(${String(placement.x)}px, ${String(placement.y)}px)`;
      if (line === undefined || anchor === undefined) return;
      line.style.display = layout.mode === "packed" && anchor.visible ? "" : "none";
      line.setAttribute("x1", String(anchor.x)); line.setAttribute("y1", String(anchor.y));
      line.setAttribute("x2", String(Math.max(placement.x, Math.min(anchor.x, placement.x + placement.width))));
      line.setAttribute("y2", String(Math.max(placement.y, Math.min(anchor.y, placement.y + placement.height))));
    });
  });

  return <Html calculatePosition={HTML_ORIGIN} onOcclude={KEEP_SCREEN_LAYER_VISIBLE} zIndexRange={[18, 18]}>
    <div ref={rootRef} className="scene-annotations" style={{ width: size.width, height: size.height }} data-layout="packed"
      onPointerDown={(event) => { event.stopPropagation(); }}
      onKeyUp={(event) => { event.stopPropagation(); }}
      onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); dismiss(); } }}>
      <svg className="scene-annotations__leaders" width={size.width} height={size.height} aria-hidden="true">
        {annotations.map((annotation) => <line key={annotation.id} stroke={annotation.color} ref={(element) => { if (element === null) lines.current.delete(annotation.id); else lines.current.set(annotation.id, element); }} />)}
      </svg>
      <div ref={viewportRef} className="scene-annotations__viewport" role="region" aria-label="Scene planning annotations" tabIndex={0}>
        <p className="scene-annotations__list-label">{annotations.length} planning annotations · scroll for all</p>
        <div ref={cardsRef} className="scene-annotations__cards">
          {annotations.map((annotation) => <div key={annotation.id} className="scene-annotations__card" style={{ "--annotation-color": annotation.color } as CSSProperties}
            ref={(element) => { if (element === null) cards.current.delete(annotation.id); else cards.current.set(annotation.id, element); dirty.current = true; }}>
            <button type="button" className="scene-annotations__button" aria-label={`${annotation.caption}. ${annotation.detail}`} aria-expanded={selected === annotation.id} aria-controls={selected === annotation.id ? `${annotationId}-${annotation.id}` : undefined}
              ref={(element) => { if (element === null) buttons.current.delete(annotation.id); else buttons.current.set(annotation.id, element); }}
              onMouseEnter={() => { if (selectedRef.current === null) raiseBeam(annotation); }}
              onMouseLeave={(event) => { if (selectedRef.current === null && document.activeElement !== event.currentTarget) clearOwnedBeam(); }}
              onFocus={() => { if (selectedRef.current === null) raiseBeam(annotation); }}
              onBlur={() => { if (selectedRef.current === null) clearOwnedBeam(); }}
              onClick={() => { selectedRef.current = annotation.id; setSelected(annotation.id); raiseBeam(annotation); dirty.current = true; invalidate(); }}>
              {annotation.caption}<span className="scene-annotations__location" hidden>Outside current view</span>
            </button>
            {selected === annotation.id && <>
              <p id={`${annotationId}-${annotation.id}`} className="scene-annotations__detail">{annotation.detail}</p>
              <button type="button" className="scene-annotations__dismiss" onClick={dismiss}>Dismiss annotation details</button>
            </>}
          </div>)}
        </div>
      </div>
    </div>
  </Html>;
}

export function CockpitSceneOverlays({ renderGeometry = true }: { readonly renderGeometry?: boolean }): ReactElement | null {
  const overlayVisibility = useCockpitStore((state) => state.overlayVisibility);
  const activeMode = useCockpitStore((state) => state.activeMode);
  const cameraInteractionActive = useCockpitStore((state) => state.cameraInteractionActive);
  const dimensions = useRoomDimensionsStore((state) => state.dimensions);
  const invalidate = useThree((state) => state.invalidate);

  const layers = useMemo(
    () => cockpitOverlayLayers(overlayVisibility, activeMode),
    [overlayVisibility, activeMode],
  );
  const replayNeeded = useMemo(
    () => shouldLoadReplay(overlayVisibility, activeMode),
    [overlayVisibility, activeMode],
  );
  const { artifact, bounds } = useCockpitReplay(replayNeeded);

  // Redraw the demand-mode canvas whenever the visible overlay set changes.
  useEffect(() => { invalidate(); }, [layers, artifact, dimensions, invalidate]);

  const flowTrajectories = useMemo(
    () => (artifact === null ? [] : selectFlowTrajectories(artifact.trajectories, MAX_FLOW_PATHS)),
    [artifact],
  );
  const moteTrajectories = useMemo(
    () => (artifact === null ? [] : selectMoteTrajectories(artifact.trajectories, MAX_MOTES)),
    [artifact],
  );
  const densityCells = useMemo(
    () => (artifact === null ? [] : selectDensityCells(artifact.densityHeatmap.cells, MAX_DENSITY)),
    [artifact],
  );
  const densityCellSizeM = artifact?.densityHeatmap.cellSizeM ?? DEFAULT_DENSITY_CELL_SIZE_M;
  const conflicts = useMemo(
    () => (artifact === null ? [] : selectRouteConflicts(artifact.routeConflicts, artifact.routeConflicts.length)),
    [artifact],
  );

  // Keep accessible warnings mounted when compact or moving views omit scene geometry.
  const showGeometry = renderGeometry && !cameraInteractionActive;
  const showReplayLayers = showGeometry && artifact !== null && bounds !== null;
  const annotations = useMemo<readonly SceneAnnotation[]>(() => {
    const result: SceneAnnotation[] = [];
    if (artifact !== null && layers.routeConflicts && bounds !== null) {
      for (const conflict of conflicts) {
        const anchor = projectReplayPointToFloor(conflict.point, bounds, dimensions, CONFLICT_Y);
        result.push({ id: conflict.id, caption: conflict.severity === "review" ? "Simulated \u00b7 review required" : "Simulated \u00b7 attention", detail: conflict.message,
          color: conflictSeverityColor(conflict.severity), priority: conflict.severity === "review" ? 0 : 1,
          anchor: [anchor[0], CONFLICT_Y + 1, anchor[2]], beamAnchor: anchor, tone: conflict.severity === "review" ? "review" : "info" });
      }
    }
    if (layers.heritageBuffer) result.push({ id: "heritage-guide", caption: "Heritage & wall buffer \u00b7 planning guide \u2014 confirm protected features with the venue",
      detail: "This is a planning guide, not a surveyed heritage boundary.", color: HERITAGE_COLOR, priority: 2,
      anchor: [0, 0.9, -Math.max(0.5, dimensions.length / 2 - 1.2)], beamAnchor: [0, HERITAGE_Y, -Math.max(0.5, dimensions.length / 2 - 1.2)], tone: "info" });
    if (layers.lightingProbes) result.push({ id: "lighting-guide", caption: "Lighting probe grid \u00b7 planning placeholder (no measured photometrics)",
      detail: "A regular planning probe grid; no measured photometrics are available.", color: PROBE_COLOR, priority: 2, anchor: [0, 0.7, 0], beamAnchor: [0, PROBE_Y, 0], tone: "info" });
    return result;
  }, [artifact, layers.routeConflicts, layers.heritageBuffer, layers.lightingProbes, conflicts, bounds, dimensions]);
  const anyVisible = layers.flowPaths || layers.agentMotes || layers.densityHeatmap
    || layers.routeConflicts || layers.heritageBuffer || layers.lightingProbes;
  if (!anyVisible) return null;

  return (
    <group name="cockpit-scene-overlays">
      {showReplayLayers && (
        <>
          {layers.densityHeatmap && (
            <DensityPatches
              cells={densityCells}
              cellSizeM={densityCellSizeM}
              bounds={bounds}
              dimensions={dimensions}
            />
          )}
          {layers.flowPaths && (
            <FlowPaths trajectories={flowTrajectories} bounds={bounds} dimensions={dimensions} />
          )}
          {layers.agentMotes && (
            <AgentMotes trajectories={moteTrajectories} bounds={bounds} dimensions={dimensions} />
          )}
          {layers.routeConflicts && conflicts.slice(0, MAX_CONFLICTS).map((conflict) => (
            <RouteConflictMarker
              key={conflict.id}
              conflict={conflict}
              bounds={bounds}
              dimensions={dimensions}
            />
          ))}
        </>
      )}
      {showGeometry && layers.heritageBuffer && <HeritageBufferBand dimensions={dimensions} />}
      {showGeometry && layers.lightingProbes && <LightingProbeGrid dimensions={dimensions} />}
      {annotations.length > 0 && <SceneAnnotations annotations={annotations} />}
    </group>
  );
}
