import { useEffect, useLayoutEffect, useState, type ReactElement } from "react";
import { advance as advanceFrame, invalidate } from "@react-three/fiber";
import { TRADES_HALL_GRAND_HALL_DIMENSIONS, type Space } from "@omnitwin/types";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../constants/scale.js";
import { PlannerScene } from "../components/editor/PlannerScene.js";
import { useEditorStore } from "../stores/editor-store.js";
import { openLayoutEventKind } from "../lib/event-kind-record.js";
import { usePlacementStore } from "../stores/placement-store.js";
import { useRoomDimensionsStore } from "../stores/room-dimensions-store.js";
import { useHallViewStore } from "../stores/hall-view-store.js";
import { useCockpitStore } from "../stores/cockpit-store.js";
import { useBookmarkStore } from "../stores/bookmark-store.js";
import { nativeFrameComposer } from "../lib/native-frame-composer.js";
import { getNativeRenderer, nativeDrawingBackend, withNativeComposedFrame, type NativeDrawingBackend } from "../lib/native-renderer.js";
import { nativePrecompileSettled } from "../lib/native-precompile.js";
import { getCatalogueItem, getCatalogueItemBySlug } from "../lib/catalogue.js";
import { usePlannerToolKeys } from "../lib/planner-keymap.js";
import { plannerChromeRequested, setMountedPlannerChrome } from "../lib/planner-chrome-flag.js";
import { ChromeShell } from "../components/planner-chrome/ChromeShell.js";
import { HudFrame } from "../components/planner-hud/HudFrame.js";
import { HudSheets } from "../components/planner-hud/HudSheets.js";
import { Slate } from "../components/planner-chrome/Slate.js";
import { TooltipHost } from "../components/planner-chrome/Tooltip.js";
import { useSelectionStore } from "../stores/selection-store.js";
import { useCatalogueStore } from "../stores/catalogue-store.js";
import { useToolStore } from "../stores/tool-store.js";
import type { HallMoodName } from "../components/grand-hall/hall-mood.js";
import { rememberTradesHallVenue } from "../hooks/use-trades-hall-venue.js";
import { useSurveyedRoomStore } from "../stores/surveyed-room-store.js";
import type { SurveyedRoomStatus } from "../components/surveyed-room/room-status.js";
import { plannerSurveyedRoomAsk, plannerSurveyedRoomEntry } from "../components/surveyed-room/use-planner-surveyed-room.js";
import { plannerLabRoom, plannerLabRoomDimensions } from "./planner-lab-rooms.js";
import "../App.css";

// ---------------------------------------------------------------------------
// Development fixture: the planner's own scene in the Grand Hall with a
// furnished layout and no backend, for looking at the room and measuring its
// frames. It answers the keys as the planner does (its tool keys and Escape
// order), so a keyboard walk can be recorded over the real room. Compiled out
// of production builds with the other fixtures.
//
// `?space=saloon` shows another Trades Hall room instead (planner-lab-rooms.ts),
// and with `&rooms=surveyed&roomsBase=<public folder>&roomsRev=<n>` that room
// as surveyed, from a staged folder:
//   /dev/planner-lab?space=saloon&rooms=surveyed&roomsBase=/rooms/saloon/survey-2026-07-11&roomsRev=1
// ---------------------------------------------------------------------------

const RAD_TO_DEG = 180 / Math.PI;

function isTable(catalogueItemId: string): boolean {
  return getCatalogueItem(catalogueItemId)?.category === "table";
}

function selectTable(index = 0): string | null {
  const placed = usePlacementStore.getState().placedItems;
  const table = placed.filter((item) => isTable(item.catalogueItemId))[index];
  if (table === undefined) return null;
  const group = table.groupId === null ? [table.id] : placed.filter((item) => item.groupId === table.groupId).map((item) => item.id);
  useSelectionStore.getState().selectMultiple(group);
  return table.id;
}

function keyState(): LabKeyState {
  const placed = usePlacementStore.getState();
  const selected = useSelectionStore.getState().selectedIds;
  const table = placed.placedItems.find((item) => selected.has(item.id) && isTable(item.catalogueItemId));
  const seats = table === undefined || table.groupId === null ? 0 : placed.placedItems
    .filter((item) => item.groupId === table.groupId && item.id !== table.id).length;
  const tool = useToolStore.getState().activeTool;
  return {
    tool,
    selected: selected.size,
    placing: useCatalogueStore.getState().selectedItemId,
    ghostTurnDeg: Math.round(placed.ghostRotation * RAD_TO_DEG),
    table: table === undefined ? null : {
      x: Math.round(table.x * 1000) / 1000,
      z: Math.round(table.z * 1000) / 1000,
      turnDeg: Math.round(table.rotationY * RAD_TO_DEG),
      seats,
    },
    measuring: tool === "measure",
    drawing: tool === "draw",
  };
}

/** The Grand Hall's row as production stores it: 21.14 × 10.59 × 6.7 m, centred. */
const LAB_HALL = TRADES_HALL_GRAND_HALL_DIMENSIONS;

const LAB_SPACE: Space = {
  id: "00000000-0000-4000-8000-00000000a11b",
  venueId: "00000000-0000-4000-8000-00000000a11a",
  name: "Grand Hall",
  slug: "grand-hall",
  description: null,
  widthM: String(LAB_HALL.width),
  lengthM: String(LAB_HALL.length),
  heightM: String(LAB_HALL.height),
  floorPlanOutline: [
    { x: -LAB_HALL.width / 2, y: -LAB_HALL.length / 2 },
    { x: LAB_HALL.width / 2, y: -LAB_HALL.length / 2 },
    { x: LAB_HALL.width / 2, y: LAB_HALL.length / 2 },
    { x: -LAB_HALL.width / 2, y: LAB_HALL.length / 2 },
  ],
  meshUrl: null,
  thumbnailUrl: null,
  sortOrder: 0,
  createdAt: "2026-10-10T00:00:00.000Z",
  updatedAt: "2026-10-10T00:00:00.000Z",
};

/** Whether a surveyed room has finished arriving: drawn with every photograph in or failed, or unusable. */
function surveySettled(status: SurveyedRoomStatus | null): boolean {
  if (status === null) return false;
  if (status.phase === "failed") return true;
  return status.phase === "ready" && status.photos !== null && status.photos.settled >= status.photos.expected;
}

interface LabFrameStats {
  readonly frames: number;
  readonly meanMs: number;
  readonly p95Ms: number;
  readonly drawCalls: number;
  readonly triangles: number;
}

declare global {
  interface Window {
    __plannerLab?: {
      furnish: (guests: number, tableSlug?: string, chairsPerTable?: number) => number;
      clear: () => void;
      setMood: (mood: HallMoodName) => void;
      /** Glides the planner's camera to a pose (the planner's own transition). */
      pose: (position: readonly [number, number, number], target: readonly [number, number, number]) => void;
      /** Where the camera is and whether a glide is still under way. */
      cameraState: () => { readonly position: readonly number[] | null; readonly gliding: boolean };
      itemCount: () => number;
      /**
       * True once the hall's surfaces have settled and the layout is placed.
       * For a room shown by `?space=`: once its survey, where one is asked
       * for, is drawn with every photograph in or failed, or has failed (the
       * plain shell then stands; `surveyedRoom()` says why).
       */
      ready: () => boolean;
      /** How the room's survey stands, where the lab shows a room as surveyed; null where it shows none. */
      surveyedRoom: () => SurveyedRoomStatus | null;
      /**
       * What draws the planner's frames, read from the view's own renderer
       * (lib/native-renderer.ts): its backend and its GPU. Null until that
       * renderer's backend can draw.
       */
      drawnBy: () => NativeDrawingBackend | null;
      /**
       * Steps the planner's frame loop `frames` times at 60 fps, waiting for the
       * GPU after each: frames advance even while the page is hidden. Each waits
       * first for any precompile hold to lift, as the view's own frames do.
       */
      advance: (frames?: number) => Promise<void>;
      /**
       * Draws `frames` frames back to back while orbiting, each through the
       * pipeline (or plainly) and waited for on the GPU, and reports their times.
       */
      measure: (frames?: number, pipeline?: boolean) => Promise<LabFrameStats>;
      /**
       * GPU time of `frames` frames through the pipeline, from WebGPU timestamp
       * queries around every render pass (milliseconds; null where unsupported).
       */
      measureGpu: (frames?: number) => Promise<{ readonly frames: number; readonly meanMs: number; readonly p95Ms: number } | null>;
      /** Selects the nth table and its chairs, as a click on it would (keyboard walks start here). */
      selectTable: (index?: number) => string | null;
      /** Takes a catalogue piece in hand, as a click on its tile would. */
      pick: (catalogueSlug: string) => void;
      /** What the keys have done: the tool, the selection, the piece in hand and the selected table. */
      keyState: () => LabKeyState;
    };
  }
}

interface LabKeyState {
  readonly tool: string;
  readonly selected: number;
  readonly placing: string | null;
  readonly ghostTurnDeg: number;
  readonly table: { readonly x: number; readonly z: number; readonly turnDeg: number; readonly seats: number } | null;
  readonly measuring: boolean;
  readonly drawing: boolean;
}

interface GpuQueue { readonly queue: { onSubmittedWorkDone(): Promise<void> } }

function isGpuQueue(value: unknown): value is GpuQueue {
  return typeof value === "object" && value !== null && "queue" in value;
}

/** The WebGPU device drawing the planner, or null on the WebGL backend. */
function gpuDevice(): GpuQueue | null {
  const perf = window.__venPerf;
  const native = perf === undefined ? null : getNativeRenderer(perf.gl);
  const backend: unknown = native?.backend;
  if (typeof backend !== "object" || backend === null || !("device" in backend)) return null;
  return isGpuQueue(backend.device) ? backend.device : null;
}

/**
 * Lays out rounds of ten for `guests`: the planner's own circulation-safe
 * arrangement up to what it allows, or for larger dinners a dense grid of up
 * to 6 by 3 rounds (180 guests, the hall at a full wedding).
 */
function furnish(guests: number, tableSlug = "round-table-6ft-white", chairsPerTable = 10): number {
  const table = getCatalogueItemBySlug(tableSlug);
  if (table === undefined) return 0;
  const placement = usePlacementStore.getState();
  if (guests <= 100) {
    placement.autoArrangeBanquet(table.id, guests, chairsPerTable);
    return usePlacementStore.getState().placedItems.length;
  }
  placement.clearAll();
  const snap = usePlacementStore.getState().snapEnabled;
  usePlacementStore.setState({ snapEnabled: false });
  const tables = Math.min(18, Math.ceil(guests / chairsPerTable));
  for (let index = 0; index < tables; index++) {
    const column = index % 6;
    const row = Math.floor(index / 6);
    usePlacementStore.getState().placeTableGroup(table.id, -8.1 + column * 3.24, -3.35 + row * 3.35, 0, chairsPerTable);
  }
  usePlacementStore.setState({ snapEnabled: snap });
  return usePlacementStore.getState().placedItems.length;
}

async function measure(frames = 120, pipeline = true): Promise<LabFrameStats> {
  const perf = window.__venPerf;
  if (perf === undefined) throw new Error("The perf bridge is not mounted");
  const { gl, scene, camera } = perf;
  const composer = pipeline ? nativeFrameComposer(gl) : null;
  const device = gpuDevice();
  const times: number[] = [];
  let drawCalls = 0;
  let triangles = 0;
  const radius = Math.hypot(camera.position.x, camera.position.z);
  const height = camera.position.y;
  for (let frame = 0; frame < frames; frame++) {
    const angle = (frame / frames) * Math.PI * 0.5;
    camera.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const started = performance.now();
    // Declared as the view's own frame, as the frame loop draws it
    // (NativeCanvas): the pipeline's scene pass is this frame's main draw only
    // inside withNativeComposedFrame, and the hall's photographs ask which draw
    // they are in (lib/scene-grade.ts sceneOutput).
    if (composer !== null) withNativeComposedFrame(gl, scene, camera, composer);
    else gl.render(scene, camera);
    // A frame is not over until the GPU has finished it.
    if (device !== null) await device.queue.onSubmittedWorkDone();
    times.push(performance.now() - started);
    const info = gl.info.render;
    drawCalls = "drawCalls" in info ? info.drawCalls : info.calls;
    triangles = gl.info.render.triangles;
  }
  const sorted = [...times].sort((a, b) => a - b);
  const mean = times.reduce((sum, value) => sum + value, 0) / Math.max(1, times.length);
  return {
    frames,
    meanMs: Math.round(mean * 100) / 100,
    p95Ms: Math.round((sorted[Math.floor(sorted.length * 0.95)] ?? 0) * 100) / 100,
    drawCalls,
    triangles,
  };
}

interface TimestampBackend { trackTimestamp: boolean }

function isTimestampBackend(value: unknown): value is TimestampBackend {
  return typeof value === "object" && value !== null && "trackTimestamp" in value;
}

async function measureGpu(frames = 60): Promise<{ readonly frames: number; readonly meanMs: number; readonly p95Ms: number } | null> {
  const perf = window.__venPerf;
  const native = perf === undefined ? null : getNativeRenderer(perf.gl);
  if (native === null || perf === undefined) return null;
  const backend: unknown = native.backend;
  if (!isTimestampBackend(backend) || !native.hasFeature("timestamp-query")) return null;
  const composer = nativeFrameComposer(native);
  const times: number[] = [];
  backend.trackTimestamp = true;
  try {
    for (let frame = 0; frame < frames; frame++) {
      if (composer !== null) withNativeComposedFrame(native, perf.scene, perf.camera, composer);
      else native.render(perf.scene, perf.camera);
      const duration = await native.resolveTimestampsAsync("render");
      if (typeof duration === "number" && Number.isFinite(duration)) times.push(duration);
    }
  } finally {
    backend.trackTimestamp = false;
  }
  if (times.length === 0) return null;
  const sorted = [...times].sort((a, b) => a - b);
  const mean = times.reduce((sum, value) => sum + value, 0) / times.length;
  return {
    frames: times.length,
    meanMs: Math.round(mean * 1000) / 1000,
    p95Ms: Math.round((sorted[Math.floor(sorted.length * 0.95)] ?? 0) * 1000) / 1000,
  };
}

export function PlannerLabPage(): ReactElement {
  const [ready, setReady] = useState(false);
  const [chrome] = useState(() => plannerChromeRequested(window.location.search));
  // As the planner's own page does: the scene asks which chrome is mounted.
  useLayoutEffect(() => {
    setMountedPlannerChrome(chrome);
    return () => { setMountedPlannerChrome(null); };
  }, [chrome]);
  usePlannerToolKeys();

  useEffect(() => {
    const search = window.location.search;
    // Another Trades Hall room by `?space=` (planner-lab-rooms.ts); without one the lab is the Grand Hall, as ever.
    // Such a room opens empty unless `guests` says otherwise: the hall's dinner would not stand in it.
    const otherRoom = plannerLabRoom(search);
    const requested = Number(new URLSearchParams(search).get("guests") ?? (otherRoom === null ? "160" : "0"));
    const guests = Number.isFinite(requested) ? Math.max(0, Math.floor(requested)) : 160;
    // The lab answers for its made-up venue, which no API could: its other rooms are Trades Hall's.
    if (otherRoom !== null) rememberTradesHallVenue(otherRoom.venueId, true);
    useEditorStore.setState({ space: otherRoom ?? LAB_SPACE, configId: "planner-lab" });
    // The first screen asks only a layout whose record has been read, as the page's own load reads it. The lab's
    // made-up layout is read as a guest's new draft.
    openLayoutEventKind({ configId: "planner-lab", isPublicPreview: true, search, metadata: null, floorEmptyAtOpen: usePlacementStore.getState().placedItems.length === 0 });
    // The drawn hall, not a capture: production keeps captures off.
    useCockpitStore.setState({ layerMode: "mesh" });
    // The room the planner sizes from the Grand Hall's geometry (pinned equal
    // to roomGeometries["Grand Hall"] in constants/__tests__/scale.test.ts).
    useRoomDimensionsStore.getState().setDimensions(otherRoom === null ? GRAND_HALL_RENDER_DIMENSIONS : plannerLabRoomDimensions(otherRoom));
    // Whether that room is to be drawn as surveyed here: its survey must then have settled before the lab is ready.
    const surveyAsked = otherRoom !== null
      && plannerSurveyedRoomEntry(plannerSurveyedRoomAsk(search, import.meta.env.DEV), otherRoom.slug) !== null;
    setReady(true);
    window.__plannerLab = {
      furnish,
      clear: () => { usePlacementStore.getState().clearAll(); },
      setMood: (mood) => { useHallViewStore.getState().setMood(mood); },
      pose: (position, target) => {
        const camera = window.__venPerf?.camera;
        const from: [number, number, number] = camera === undefined ? [...position] : [camera.position.x, camera.position.y, camera.position.z];
        useBookmarkStore.getState().startTransition(
          { id: `planner-lab-${String(Date.now())}`, name: "Lab", position: [...position], target: [...target], kind: "default" },
          from,
          [...target],
        );
        // The rig glides inside the frame loop, which draws only on request.
        invalidate();
      },
      cameraState: () => {
        const camera = window.__venPerf?.camera;
        return {
          position: camera === undefined ? null : [camera.position.x, camera.position.y, camera.position.z],
          gliding: useBookmarkStore.getState().transition !== null,
        };
      },
      itemCount: () => usePlacementStore.getState().placedItems.length,
      surveyedRoom: () => useSurveyedRoomStore.getState().status,
      drawnBy: () => nativeDrawingBackend(window.__venPerf?.gl ?? null),
      ready: () => {
        const surfaces = useHallViewStore.getState().surfaces;
        const settled = otherRoom === null
          ? surfaces !== null && surfaces.loaded + surfaces.failed >= surfaces.total
          : !surveyAsked || surveySettled(useSurveyedRoomStore.getState().status);
        const placed = guests === 0 || usePlacementStore.getState().placedItems.length > 0;
        return settled && placed && window.__venPerf !== undefined;
      },
      advance: async (frames = 30) => {
        const started = performance.now();
        for (let frame = 0; frame < frames; frame++) {
          // R3F's advance draws through the view's precompile hold, with the
          // job's target and MRT still set (lib/native-precompile.ts): driven
          // so, 25 pipelines failed on WebGPU (4 Nov 2026).
          const native = window.__venPerf === undefined ? null : getNativeRenderer(window.__venPerf.gl);
          if (native !== null) await nativePrecompileSettled(native);
          // A demand loop draws only what was asked for: ask for every frame.
          invalidate();
          advanceFrame(started + frame * (1000 / 60));
          const device = gpuDevice();
          if (device !== null) await device.queue.onSubmittedWorkDone();
        }
      },
      measure,
      measureGpu,
      selectTable,
      pick: (catalogueSlug) => {
        const item = getCatalogueItemBySlug(catalogueSlug);
        if (item !== undefined) useCatalogueStore.getState().selectItem(item.id);
      },
      keyState,
    };
    const timer = window.setTimeout(() => { if (guests > 0) furnish(guests); }, 500);
    return () => {
      window.clearTimeout(timer);
      delete window.__plannerLab;
    };
  }, []);

  // `?chrome=v2`: the scene under the new chrome's zones, as the planner shows it (T-671).
  if (chrome === "v2") return <ChromeShell room={ready ? <PlannerScene /> : null} />;

  // `?chrome=hud`: the scene under the HUD (13 Nov 2026), with a stand-in plaque and no backend.
  // `&plaque=slate` mounts the planner's own slate instead, to see it dressed for the top bar.
  if (chrome === "hud") {
    const slate = new URLSearchParams(window.location.search).get("plaque") === "slate";
    return (
      <HudFrame
        room={ready ? <div className="venviewer-planner-shell hud-lab-room"><PlannerScene /></div> : null}
        plaque={slate ? (
          <div className="pc-root hud-plaque">
            <Slate />
            <TooltipHost />
          </div>
        ) : (
          <div className="hud-lab-plaque">
            <span className="hud-lab-plaque__title">The Morrison Wedding</span>
            <span className="hud-lab-plaque__line"><span>Sat 13 Feb 2027</span><span>Grand Hall</span><span>Sample</span></span>
          </div>
        )}
        eventGuests={null}
        sheets={<HudSheets />}
      />
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0d0b09", display: "flex" }}>
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, position: "relative" }}>
        {ready && <PlannerScene />}
      </div>
    </div>
  );
}
