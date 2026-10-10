import { useEffect, useState, type ReactElement } from "react";
import { advance as advanceFrame, invalidate } from "@react-three/fiber";
import type { Space } from "@omnitwin/types";
import { PlannerScene } from "../components/editor/PlannerScene.js";
import { useEditorStore } from "../stores/editor-store.js";
import { usePlacementStore } from "../stores/placement-store.js";
import { useRoomDimensionsStore } from "../stores/room-dimensions-store.js";
import { useHallViewStore } from "../stores/hall-view-store.js";
import { useCockpitStore } from "../stores/cockpit-store.js";
import { useBookmarkStore } from "../stores/bookmark-store.js";
import { nativeFrameComposer } from "../lib/native-frame-composer.js";
import { getNativeRenderer } from "../lib/native-renderer.js";
import { getCatalogueItemBySlug } from "../lib/catalogue.js";
import type { HallMoodName } from "../components/grand-hall/hall-mood.js";
import "../App.css";

// ---------------------------------------------------------------------------
// Development fixture: the planner's own scene in the Grand Hall with a
// furnished layout and no backend, for looking at the room and measuring its
// frames. Compiled out of production builds with the other fixtures.
// ---------------------------------------------------------------------------

const LAB_SPACE: Space = {
  id: "00000000-0000-4000-8000-00000000a11b",
  venueId: "00000000-0000-4000-8000-00000000a11a",
  name: "Grand Hall",
  slug: "grand-hall",
  description: null,
  widthM: "21",
  lengthM: "10.5",
  heightM: "7",
  floorPlanOutline: [{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 10.5 }, { x: 0, y: 10.5 }],
  meshUrl: null,
  thumbnailUrl: null,
  sortOrder: 0,
  createdAt: "2026-10-10T00:00:00.000Z",
  updatedAt: "2026-10-10T00:00:00.000Z",
};

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
      /** True once the hall's surfaces have settled and the layout is placed. */
      ready: () => boolean;
      /**
       * Steps the planner's frame loop `frames` times at 60 fps, waiting for the
       * GPU after each: frames advance even while the page is hidden.
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
    };
  }
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
    if (composer !== null) composer();
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
      if (composer !== null) composer();
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

  useEffect(() => {
    const requested = Number(new URLSearchParams(window.location.search).get("guests") ?? "160");
    const guests = Number.isFinite(requested) ? Math.max(0, Math.floor(requested)) : 160;
    useEditorStore.setState({ space: LAB_SPACE, configId: "planner-lab" });
    // The drawn hall, not a capture: production keeps captures off.
    useCockpitStore.setState({ layerMode: "mesh" });
    useRoomDimensionsStore.getState().setDimensions({ width: 21, length: 10.5, height: 7 });
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
      ready: () => {
        const surfaces = useHallViewStore.getState().surfaces;
        const settled = surfaces !== null && surfaces.loaded + surfaces.failed >= surfaces.total;
        const placed = guests === 0 || usePlacementStore.getState().placedItems.length > 0;
        return settled && placed && window.__venPerf !== undefined;
      },
      advance: async (frames = 30) => {
        const started = performance.now();
        for (let frame = 0; frame < frames; frame++) {
          // A demand loop draws only what was asked for: ask for every frame.
          invalidate();
          advanceFrame(started + frame * (1000 / 60));
          const device = gpuDevice();
          if (device !== null) await device.queue.onSubmittedWorkDone();
        }
      },
      measure,
      measureGpu,
    };
    const timer = window.setTimeout(() => { if (guests > 0) furnish(guests); }, 500);
    return () => {
      window.clearTimeout(timer);
      delete window.__plannerLab;
    };
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0d0b09", display: "flex" }}>
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, position: "relative" }}>
        {ready && <PlannerScene />}
      </div>
    </div>
  );
}
