vi.mock("../../scene/NativeCanvas.js", async () => ({ NativeCanvas: (await import("@react-three/fiber")).Canvas }));
import type { ReactNode } from "react";
import { PerspectiveCamera, Scene } from "three";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SplatRuntimeProfile } from "../../../lib/splat-runtime-profile.js";
import { roomSplatLadder } from "../../../data/room-splat-bundles.js";

// The scene is a composition: the canvas, the tiles, the clip box and the
// camera. Each part has its own tests; what this file pins is that the device
// profile reaches the two parts that spend the frame budget, and nothing else.
const recorded = vi.hoisted(() => ({
  layers: [] as Record<string, unknown>[],
  cameras: [] as Record<string, unknown>[],
  hosts: [] as Record<string, unknown>[],
  /** The layers mounted right now, by url, with their latest props. */
  mounted: new Map<string, Record<string, unknown>>(),
  onCreated: undefined as unknown,
  capture: vi.fn(),
}));

vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children, onCreated }: { readonly children?: ReactNode; readonly onCreated?: unknown }) => {
    recorded.onCreated = onCreated;
    return <div data-testid="canvas">{children}</div>;
  },
}));
vi.mock("../../../lib/native-current-view-capture.js", () => ({ captureNativeCurrentView: recorded.capture }));
vi.mock("../../scene/NativeSplatLayer.js", async () => {
  const { useEffect } = await import("react");
  return {
    NativeSplatLayer: (props: Record<string, unknown>) => {
      const url = String(props["url"]);
      recorded.layers.push(props);
      recorded.mounted.set(url, props);
      useEffect(() => () => { recorded.mounted.delete(url); }, [url]);
      return null;
    },
    NativeSplatRendererMount: (props: Record<string, unknown>) => {
      recorded.hosts.push(props);
      return null;
    },
  };
});
vi.mock("../InteriorCamera.js", () => ({
  InteriorCamera: (props: Record<string, unknown>) => {
    recorded.cameras.push(props);
    return null;
  },
}));
vi.mock("../RoomClipBox.js", () => ({ RoomClipBox: () => null }));
// Use the real manifest and budget selection, with an override for the
// multi-tile coarse-level failure regression below.
vi.mock("../../../data/room-splat-bundles.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../data/room-splat-bundles.js")>();
  return {
    ...actual,
    roomSplatLadder: vi.fn(actual.roomSplatLadder),
  };
});

const PROFILE: SplatRuntimeProfile = {
  tier: "high",
  source: "tier",
  minSortIntervalMs: 50,
  maxStdDev: 2.236,
  lod: true,
  lodSplatCount: 1_500_000,
  motionLodSplatCount: 600_000,
  maxSh: 3,
  preferTrees: true,
  motionDpr: 0.5,
  settledDpr: 1.5,
};
vi.mock("../../../hooks/use-splat-runtime-profile.js", () => ({
  useSplatRuntimeProfile: () => PROFILE,
}));

import { RoomSplatScene } from "../RoomSplatScene.js";
import { RoomWalkPage } from "../../../pages/RoomWalkPage.js";

const ROOM = "grand-hall";

/** What the scene has on screen right now. */
function mountedLayers(): Record<string, unknown>[] {
  return [...recorded.mounted.values()];
}

function mountedUrls(): string[] {
  return [...recorded.mounted.keys()];
}

function visibleUrls(): string[] {
  return mountedLayers()
    .filter((layer) => {
      const opacity = layer["opacityFn"];
      return layer["visible"] !== false && (typeof opacity !== "function" || (opacity as () => number)() > 0);
    })
    .map((layer) => String(layer["url"]));
}

function drawLayer(layer: Record<string, unknown>): void {
  (layer["onRendered"] as (url: string) => void)(String(layer["url"]));
}

/** Model successful decode and, unless explicitly deferred, the next GPU draw. */
function loadEveryMountedLayer(rendered = true): void {
  for (const layer of mountedLayers()) {
    const onLoad = layer["onLoad"] as (event: { url: string; splatCount: number }) => void;
    onLoad({ url: String(layer["url"]), splatCount: 1000 });
    if (rendered) drawLayer(layer);
  }
}

/** The complete vendor level selected by the actual device budget. */
const LADDER = roomSplatLadder(ROOM, undefined, false, PROFILE.lodSplatCount);
const SHARP_URLS = new Set(LADDER.sharp.map((source) => source.url));
const SHARP = { test: (url: string): boolean => SHARP_URLS.has(url) };

/** The coarse rung: whatever is mounted that is neither the finest level nor the sky. */
function coarseUrls(): string[] {
  return mountedUrls().filter((url) => !SHARP.test(url) && !url.endsWith("env.sog"));
}

function sharpUrls(): string[] {
  return mountedUrls().filter((url) => SHARP.test(url));
}

function setDevicePixelRatio(value: number): void {
  Object.defineProperty(window, "devicePixelRatio", { value, configurable: true });
}

describe("RoomSplatScene runtime wiring", () => {
  beforeEach(() => {
    recorded.layers.length = 0;
    recorded.cameras.length = 0;
    recorded.hosts.length = 0;
    recorded.mounted.clear();
    if (typeof window.matchMedia !== "function") {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: () => ({ matches: false }),
      });
    }
    setDevicePixelRatio(1);
  });

  afterEach(() => {
    cleanup();
  });

  it("gives every mounted layer the device's runtime profile", () => {
    render(<RoomSplatScene room={ROOM} />);

    expect(recorded.layers.length).toBeGreaterThan(0);
    for (const layer of recorded.layers) {
      expect(layer["runtime"]).toBe(PROFILE);
    }
  });

  it("drives the camera's pixel ratios from the profile", () => {
    render(<RoomSplatScene room={ROOM} />);

    expect(recorded.cameras).toHaveLength(1);
    expect(recorded.cameras[0]?.["motionDpr"]).toBe(0.5);
    expect(recorded.cameras[0]?.["settledDpr"]).toBe(1.5);
  });

  // A coarse display is exactly the one worth supersampling: rendering the
  // settled frame at the profile's ratio and letting a 1x screen present it
  // measured 100% sharper on the name boards (2026-09-04). The frame is drawn
  // once and then the loop sleeps, so it costs memory, not frame rate.
  it("rests at the profile's ratio on a 1x display too, rather than capping at what the screen has", () => {
    setDevicePixelRatio(1);
    render(<RoomSplatScene room={ROOM} />);

    expect(recorded.cameras[0]?.["settledDpr"]).toBe(1.5);
  });

  it("holds the settled buffer inside its budget on a very large canvas", () => {
    Object.defineProperty(window, "innerWidth", { value: 3840, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 2160, configurable: true });
    render(<RoomSplatScene room={ROOM} />);
    Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });

    expect(recorded.cameras[0]?.["settledDpr"]).toBeCloseTo(1, 2);
  });

  it("stands the camera at eye height inside the captured walk, never at the scanner's pole height", () => {
    render(<RoomSplatScene room={ROOM} />);

    const spawn = recorded.cameras[0]?.["spawn"] as { position: [number, number, number] };
    const bounds = recorded.cameras[0]?.["bounds"] as { min: [number, number, number]; max: [number, number, number] };
    expect(spawn.position[1]).toBeLessThan(2);
    expect(spawn.position[1]).toBeGreaterThan(1.2);
    expect(bounds.min[1]).toBeLessThanOrEqual(spawn.position[1]);
    expect(bounds.max[1]).toBeGreaterThanOrEqual(spawn.position[1]);
  });

  // The host used to ride on the first tile. The ladder drops that tile when the
  // finest level lands, and a host mounted on it would take the renderer with it.
  it("mounts exactly one renderer host, owned by no tile", () => {
    render(<RoomSplatScene room={ROOM} />);

    expect(recorded.hosts).toHaveLength(1);
    expect(recorded.hosts[0]?.["runtime"]).toBe(PROFILE);
    expect(recorded.layers.every((layer) => layer["includeRendererHost"] === false)).toBe(true);
  });

  it("loads canonical captures even when a legacy tree preference is set", () => {
    render(<RoomSplatScene room={ROOM} />);

    const coarse = mountedLayers().find((layer) => String(layer["url"]).endsWith("/0_0.sog"));
    expect(coarse).toBeDefined();
    expect(mountedUrls().some((url) => url.endsWith(".rad"))).toBe(false);
    expect(coarse?.["paged"]).toBeUndefined();
    const sky = mountedLayers().find((layer) => String(layer["url"]).endsWith("env.sog"));
    expect(sky?.["paged"]).toBeUndefined();
  });

  it("scales the renderer's budget down to the motion budget while the camera reports motion", () => {
    render(<RoomSplatScene room={ROOM} />);

    const onMotionChange = recorded.cameras[0]?.["onMotionChange"] as (moving: boolean) => void;
    const scaleFns = recorded.layers.map((layer) => layer["lodScaleFn"] as () => number);
    expect(typeof onMotionChange).toBe("function");
    expect(new Set(scaleFns).size).toBe(1);

    const scale = scaleFns[0];
    expect(scale?.()).toBe(1);
    onMotionChange(true);
    expect(scale?.()).toBeCloseTo(600_000 / 1_500_000, 6);
    onMotionChange(false);
    expect(scale?.()).toBe(1);
  });
  it("hands the camera the same spawn and bounds objects across re-renders, so a progress tick cannot re-seat the view", () => {
    const { rerender } = render(<RoomSplatScene room={ROOM} />);
    rerender(<RoomSplatScene room={ROOM} />);

    expect(recorded.cameras.length).toBeGreaterThanOrEqual(2);
    expect(recorded.cameras[1]?.["spawn"]).toBe(recorded.cameras[0]?.["spawn"]);
    expect(recorded.cameras[1]?.["bounds"]).toBe(recorded.cameras[0]?.["bounds"]);
  });
  // The poller re-rendered the page 2.5 times a second for the whole visit
  // (2026-09-04): every tick was a fresh progress object, so the page and the
  // scene re-rendered forever after the room had finished loading.
  it("stops reporting progress once every tile has settled", () => {
    vi.useFakeTimers();
    try {
      const onProgress = vi.fn();
      render(<RoomSplatScene room={ROOM} onProgress={onProgress} />);
      act(() => { loadEveryMountedLayer(); });
      act(() => { vi.advanceTimersByTime(450); });
      act(() => { loadEveryMountedLayer(); });
      act(() => { vi.advanceTimersByTime(450); });
      const complete = onProgress.mock.calls.filter(([report]) => (report as { complete: boolean }).complete);
      expect(complete).toHaveLength(1);

      onProgress.mockClear();
      act(() => { vi.advanceTimersByTime(5000); });
      expect(onProgress).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});


// ---------------------------------------------------------------------------
// The coarse-first ladder (2026-09-04).
//
// The finest level alone left the Grand Hall blank for 17.3 s and unfinished
// for 45.9 s on a 20 Mbps line, while the coarse level is the whole room in one
// 7.2 MB request. So the coarse room goes up first and the finest level
// replaces it whole: two levels on screen at once draw the same surfaces twice
// and haze the room.
// ---------------------------------------------------------------------------
describe("RoomSplatScene coarse-first ladder", () => {
  beforeEach(() => {
    recorded.layers.length = 0;
    recorded.cameras.length = 0;
    recorded.hosts.length = 0;
    recorded.mounted.clear();
    if (typeof window.matchMedia !== "function") {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: () => ({ matches: false }),
      });
    }
    setDevicePixelRatio(1);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows the coarse room and the sky first, and asks for nothing else", () => {
    render(<RoomSplatScene room={ROOM} />);

    const urls = mountedUrls();
    expect(urls).toHaveLength(2);
    expect(urls.some((url) => url.includes("0_0"))).toBe(true);
    expect(urls.some((url) => url.endsWith("env.sog"))).toBe(true);
    expect(sharpUrls()).toHaveLength(0);
    expect(visibleUrls()).toHaveLength(2);
  });

  it("fetches the complete level within the settled budget once the coarse room is up", () => {
    vi.useFakeTimers();
    render(<RoomSplatScene room={ROOM} />);
    act(() => { loadEveryMountedLayer(); });
    act(() => { vi.advanceTimersByTime(450); });

    expect(sharpUrls()).toEqual([
      "/splats/trades-hall/grand-hall/0_2_0_1.sog",
      "/splats/trades-hall/grand-hall/0_5_0_1.sog",
      "/splats/trades-hall/grand-hall/0_6_0_0.sog",
    ]);
    for (const layer of mountedLayers()) {
      expect(layer["visible"]).not.toBe(false);
    }
    expect(visibleUrls().some((url) => url.includes("0_0"))).toBe(true);
  });

  it("swaps whole levels on motion and rest after every selected detail tile lands", () => {
    vi.useFakeTimers();
    render(<RoomSplatScene room={ROOM} />);
    act(() => { loadEveryMountedLayer(); });
    act(() => { vi.advanceTimersByTime(450); });
    act(() => { loadEveryMountedLayer(); });
    act(() => { vi.advanceTimersByTime(450); });

    const environment = LADDER.environment.map((source) => source.url);
    const coarse = LADDER.coarse.map((source) => source.url);
    const detail = LADDER.sharp.map((source) => source.url);
    expect(mountedUrls()).toEqual([...environment, ...coarse, ...detail]);
    expect(visibleUrls()).toEqual([...environment, ...detail]);
    const onMotionChange = recorded.cameras[0]?.["onMotionChange"] as (moving: boolean) => void;
    onMotionChange(true);
    expect(visibleUrls()).toEqual([...environment, ...coarse]);
    onMotionChange(false);
    expect(visibleUrls()).toEqual([...environment, ...detail]);
    expect(mountedUrls()).toEqual([...environment, ...coarse, ...detail]);
  });

  it("exposes poster readback only when requested and waits for the complete actual draw", async () => {
    vi.useFakeTimers();
    try {
      const view = render(<RoomSplatScene room={ROOM} />);
      expect(window.__roomPosterCapture).toBeUndefined();
      view.rerender(<RoomSplatScene room={ROOM} captureReadback />);
      const scene = new Scene();
      const camera = new PerspectiveCamera();
      (recorded.onCreated as (state: { scene: Scene; camera: PerspectiveCamera }) => void)({ scene, camera });
      const capture = window.__roomPosterCapture;
      expect(capture).toBeTypeOf("function");
      if (capture === undefined) throw new Error("Poster capture hook is missing");
      await expect(capture()).rejects.toThrow("successfully drawn room");
      act(() => { loadEveryMountedLayer(); vi.advanceTimersByTime(450); });
      act(() => { loadEveryMountedLayer(false); vi.advanceTimersByTime(450); });
      await expect(capture()).rejects.toThrow("successfully drawn room");
      const result = { width: 1920, height: 1080, dataUrl: "data:image/jpeg;base64,capture" };
      recorded.capture.mockResolvedValueOnce(result);
      act(() => { for (const layer of mountedLayers()) drawLayer(layer); vi.advanceTimersByTime(450); });
      await expect(capture()).resolves.toBe(result);
      expect(recorded.capture).toHaveBeenCalledWith(scene, camera);
      view.unmount();
      expect(window.__roomPosterCapture).toBeUndefined();
    } finally { vi.useRealTimers(); }
  });

  it("rejects poster capture after a detail failure even when progress is complete", async () => {
    vi.useFakeTimers();
    try {
      render(<RoomSplatScene room={ROOM} captureReadback />);
      (recorded.onCreated as (state: { scene: Scene; camera: PerspectiveCamera }) => void)({
        scene: new Scene(), camera: new PerspectiveCamera(),
      });
      act(() => { loadEveryMountedLayer(); vi.advanceTimersByTime(450); });
      act(() => {
        const layers = mountedLayers();
        const failed = layers.find((layer) => SHARP.test(String(layer["url"])));
        if (failed === undefined) throw new Error("No detail layer");
        (failed["onError"] as (event: { url: string }) => void)({ url: String(failed["url"]) });
        for (const layer of layers) {
          if (layer === failed) continue;
          (layer["onLoad"] as (event: { url: string; splatCount: number }) => void)({ url: String(layer["url"]), splatCount: 1000 });
          drawLayer(layer);
        }
        vi.advanceTimersByTime(450);
      });
      const capture = window.__roomPosterCapture;
      if (capture === undefined) throw new Error("Poster capture hook is missing");
      await expect(capture()).rejects.toThrow("successfully drawn room");
    } finally { vi.useRealTimers(); }
  });

  it.each(["failed", "pending"] as const)("keeps sharp detail during motion when the coarse view is %s", (coarseState) => {
    vi.useFakeTimers();
    render(<RoomSplatScene room={ROOM} />);
    if (coarseState === "failed") {
      const coarse = mountedLayers().find((layer) => String(layer["url"]).endsWith("/0_0.sog"));
      (coarse?.["onError"] as (event: { url: string; error: Error }) => void)({
        url: String(coarse?.["url"]), error: new Error("Coarse decode failed"),
      });
    }
    act(() => { vi.advanceTimersByTime(20_000); });
    act(() => {
      for (const layer of mountedLayers().filter((item) => SHARP.test(String(item["url"])))) {
        (layer["onLoad"] as (event: { url: string; splatCount: number }) => void)({
          url: String(layer["url"]), splatCount: 1000,
        });
        drawLayer(layer);
      }
      vi.advanceTimersByTime(450);
    });
    const expected = [...LADDER.environment, ...LADDER.sharp].map((source) => source.url);
    expect(visibleUrls()).toEqual(expected);
    const onMotionChange = recorded.cameras[0]?.["onMotionChange"] as (moving: boolean) => void;
    onMotionChange(true);
    expect(visibleUrls()).toEqual(expected);
  });

  it("requires every coarse tile before replacing completed detail during motion", () => {
    vi.useFakeTimers();
    const secondCoarse = {
      url: "/splats/trades-hall/grand-hall/second-coarse.sog",
      file: "second-coarse.sog", tree: false, isEnvironment: false,
    };
    vi.mocked(roomSplatLadder).mockReturnValueOnce({
      ...LADDER, coarse: [...LADDER.coarse, secondCoarse],
    });
    render(<RoomSplatScene room={ROOM} />);
    act(() => {
      for (const layer of mountedLayers()) {
        const url = String(layer["url"]);
        if (url === secondCoarse.url) continue;
        (layer["onLoad"] as (event: { url: string; splatCount: number }) => void)({ url, splatCount: 1000 });
        drawLayer(layer);
      }
      vi.advanceTimersByTime(20_000);
    });
    act(() => {
      for (const layer of mountedLayers().filter((item) => SHARP.test(String(item["url"])))) {
        (layer["onLoad"] as (event: { url: string; splatCount: number }) => void)({
          url: String(layer["url"]), splatCount: 1000,
        });
        drawLayer(layer);
      }
      vi.advanceTimersByTime(450);
    });
    const onMotionChange = recorded.cameras[0]?.["onMotionChange"] as (moving: boolean) => void;
    onMotionChange(true);
    expect(visibleUrls()).toEqual([...LADDER.environment, ...LADDER.sharp].map((source) => source.url));

    // A late decoded coarse level first draws alongside detail; only its real
    // draw allows detail to yield, even after the progress poller has stopped.
    const late = recorded.mounted.get(secondCoarse.url);
    (late?.["onLoad"] as (event: { url: string; splatCount: number }) => void)({
      url: secondCoarse.url, splatCount: 1000,
    });
    expect(visibleUrls()).toEqual([...LADDER.environment, ...LADDER.coarse, secondCoarse, ...LADDER.sharp].map((source) => source.url));
    if (late === undefined) throw new Error("The retained coarse tile must still be mounted");
    drawLayer(late);
    expect(visibleUrls()).toEqual([...LADDER.environment, ...LADDER.coarse, secondCoarse].map((source) => source.url));
  });

  it("retains coarse cover after all detail decodes until every detail tile has actually drawn", () => {
    vi.useFakeTimers();
    const onProgress = vi.fn();
    render(<RoomSplatScene room={ROOM} onProgress={onProgress} />);
    act(() => { loadEveryMountedLayer(); vi.advanceTimersByTime(450); });
    act(() => { loadEveryMountedLayer(false); vi.advanceTimersByTime(450); });
    expect(onProgress.mock.lastCall?.[0]).toMatchObject({ complete: false, failed: 0 });
    expect(visibleUrls()).toEqual(mountedUrls());
    const detail = mountedLayers().filter((layer) => SHARP.test(String(layer["url"])));
    const [last, ...earlier] = detail;
    if (last === undefined) throw new Error("The selected detail level must not be empty");
    act(() => { earlier.forEach(drawLayer); vi.advanceTimersByTime(450); });
    expect(visibleUrls()).toEqual(mountedUrls());
    onProgress.mockClear();
    act(() => { vi.advanceTimersByTime(4_000); });
    expect(onProgress).not.toHaveBeenCalled();
    act(() => { drawLayer(last); vi.advanceTimersByTime(450); });
    expect(onProgress.mock.lastCall?.[0]).toMatchObject({ complete: true, failed: 0 });
    expect(visibleUrls()).toEqual([...LADDER.environment, ...LADDER.sharp].map((source) => source.url));
    onProgress.mockClear();
    act(() => { vi.advanceTimersByTime(4_000); });
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("keeps the actual walk loading indicator until decoded geometry reaches its first complete draw", () => {
    vi.useFakeTimers();
    render(
      <MemoryRouter initialEntries={["/room/grand-hall"]}>
        <Routes><Route path="/room/:roomSlug" element={<RoomWalkPage />} /></Routes>
      </MemoryRouter>,
    );
    act(() => { loadEveryMountedLayer(false); vi.advanceTimersByTime(450); });
    act(() => { loadEveryMountedLayer(false); vi.advanceTimersByTime(450); });
    expect(screen.getByTestId("walk-loading").textContent).toContain("Streaming the room");
    expect(window.__roomWalk).toMatchObject({ settled: SHARP_URLS.size, complete: false, firstView: false });

    const environment = mountedLayers().find((layer) => String(layer["url"]).endsWith("env.sog"));
    const coarse = mountedLayers().find((layer) => String(layer["url"]).endsWith("/0_0.sog"));
    if (environment === undefined || coarse === undefined) throw new Error("Both first-view sources must be mounted");
    act(() => { drawLayer(environment); vi.advanceTimersByTime(450); });
    expect(screen.getByTestId("walk-loading").textContent).toContain("Streaming the room");
    expect(window.__roomWalk?.firstView).toBe(false);
    act(() => { drawLayer(coarse); vi.advanceTimersByTime(450); });
    expect(screen.getByTestId("walk-loading").textContent).toContain("Sharpening the room");
    expect(window.__roomWalk).toMatchObject({ complete: false, firstView: true });
    act(() => {
      mountedLayers().filter((layer) => SHARP.test(String(layer["url"]))).forEach(drawLayer);
      vi.advanceTimersByTime(450);
    });
    expect(screen.queryByTestId("walk-loading")).toBeNull();
    expect(window.__roomWalk).toMatchObject({ complete: true, firstView: true });
  });

  it("delivers draw readiness to the latest progress callback without replacing load handlers", () => {
    vi.useFakeTimers();
    const previous = vi.fn(), current = vi.fn();
    const view = render(<RoomSplatScene room={ROOM} onProgress={previous} />);
    const source = mountedLayers().find((layer) => String(layer["url"]).endsWith("/0_0.sog"));
    if (source === undefined) throw new Error("Coarse source must be mounted");
    act(() => { loadEveryMountedLayer(false); vi.advanceTimersByTime(450); });
    expect(previous.mock.lastCall?.[0]).toMatchObject({ firstView: false, complete: false });
    view.rerender(<RoomSplatScene room={ROOM} onProgress={current} />);
    const retained = recorded.mounted.get(String(source["url"]));
    expect(retained?.["onLoad"]).toBe(source["onLoad"]);
    expect(retained?.["onRendered"]).toBe(source["onRendered"]);
    previous.mockClear();
    act(() => { drawLayer(source); vi.advanceTimersByTime(450); });
    expect(previous).not.toHaveBeenCalled();
    expect(current.mock.lastCall?.[0]).toMatchObject({ firstView: true, complete: false });
  });

  it("reports the first view as soon as the coarse room is up, and completion only when the finest level is", () => {
    vi.useFakeTimers();
    const onProgress = vi.fn();
    render(<RoomSplatScene room={ROOM} onProgress={onProgress} />);

    act(() => { vi.advanceTimersByTime(450); });
    const before = onProgress.mock.lastCall?.[0] as { firstView: boolean; total: number; complete: boolean };
    expect(before.firstView).toBe(false);
    expect(before.total).toBe(SHARP_URLS.size);
    expect(before.complete).toBe(false);

    act(() => { loadEveryMountedLayer(); });
    act(() => { vi.advanceTimersByTime(450); });
    const afterCoarse = onProgress.mock.lastCall?.[0] as { firstView: boolean; settled: number; complete: boolean };
    expect(afterCoarse.firstView).toBe(true);
    expect(afterCoarse.settled).toBe(0);
    expect(afterCoarse.complete).toBe(false);

    act(() => { loadEveryMountedLayer(); });
    act(() => { vi.advanceTimersByTime(450); });
    const done = onProgress.mock.lastCall?.[0] as { settled: number; complete: boolean; failed: number };
    expect(done.settled).toBe(SHARP_URLS.size);
    expect(done.complete).toBe(true);
    expect(done.failed).toBe(0);
  });

  it("starts the finest level anyway when the coarse tile fails, shows it as it lands, and does not blame the room", () => {
    vi.useFakeTimers();
    const onProgress = vi.fn();
    render(<RoomSplatScene room={ROOM} onProgress={onProgress} />);
    for (const layer of mountedLayers()) {
      const url = String(layer["url"]);
      if (url.includes("0_0")) {
        (layer["onError"] as (e: { url: string; error: Error }) => void)({ url, error: new Error("gone") });
      } else {
        (layer["onLoad"] as (e: { url: string; splatCount: number }) => void)({ url, splatCount: 1 });
      }
    }
    act(() => { vi.advanceTimersByTime(450); });

    expect(sharpUrls()).toHaveLength(SHARP_URLS.size);
    for (const layer of mountedLayers()) {
      expect(layer["visible"]).not.toBe(false);
    }
    const report = onProgress.mock.lastCall?.[0] as { failed: number };
    expect(report.failed).toBe(0);
  });

  it("does not wait forever for a coarse tile that never lands", () => {
    vi.useFakeTimers();
    render(<RoomSplatScene room={ROOM} />);
    expect(sharpUrls()).toHaveLength(0);

    act(() => { vi.advanceTimersByTime(20_000); });

    expect(sharpUrls()).toHaveLength(SHARP_URLS.size);
  });
});

// ---------------------------------------------------------------------------
// What the coarse room is for (found by review, 2026-09-04).
//
// The coarse room is not a placeholder, it is cover: it is the only thing
// drawing the geometry a finest-level tile would have drawn. Dropping it
// because the finest level stopped arriving leaves a hole where a room was.
// ---------------------------------------------------------------------------
describe("RoomSplatScene keeps cover when the finest level fails", () => {
  beforeEach(() => {
    recorded.layers.length = 0;
    recorded.cameras.length = 0;
    recorded.hosts.length = 0;
    recorded.mounted.clear();
    if (typeof window.matchMedia !== "function") {
      Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false }) });
    }
    setDevicePixelRatio(1);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function failEveryMountedSharpTile(): void {
    for (const layer of mountedLayers()) {
      const url = String(layer["url"]);
      if (!SHARP.test(url)) continue;
      (layer["onError"] as (e: { url: string; error: Error }) => void)({ url, error: new Error("gone") });
    }
  }

  it("keeps the coarse room when the whole finest level fails, rather than emptying the canvas", () => {
    vi.useFakeTimers();
    const onProgress = vi.fn();
    render(<RoomSplatScene room={ROOM} onProgress={onProgress} />);
    act(() => { loadEveryMountedLayer(); });
    act(() => { vi.advanceTimersByTime(450); });
    act(() => { failEveryMountedSharpTile(); });
    act(() => { vi.advanceTimersByTime(450); });

    expect(coarseUrls()).toHaveLength(1);
    expect(visibleUrls()).toContain(LADDER.coarse[0]?.url);
    (recorded.cameras[0]?.["onMotionChange"] as (moving: boolean) => void)(true);
    expect(visibleUrls()).toContain(LADDER.coarse[0]?.url);
    const report = onProgress.mock.lastCall?.[0] as { complete: boolean; failed: number };
    expect(report.failed).toBe(SHARP_URLS.size);
    expect(report.complete).toBe(true);
  });

  it("keeps the coarse room when a single finest-level tile fails, so no hole opens where it would have drawn", () => {
    vi.useFakeTimers();
    render(<RoomSplatScene room={ROOM} onProgress={() => undefined} />);
    act(() => { loadEveryMountedLayer(); });
    act(() => { vi.advanceTimersByTime(450); });
    act(() => {
      const sharp = mountedLayers().filter((l) => SHARP.test(String(l["url"])));
      const [first, ...rest] = sharp;
      (first?.["onError"] as (e: { url: string; error: Error }) => void)({ url: String(first?.["url"]), error: new Error("gone") });
      for (const layer of rest) {
        (layer["onLoad"] as (e: { url: string; splatCount: number }) => void)({ url: String(layer["url"]), splatCount: 1000 });
      }
    });
    act(() => { vi.advanceTimersByTime(450); });

    expect(coarseUrls()).toHaveLength(1);
    expect(sharpUrls()).toHaveLength(SHARP_URLS.size);
    expect(visibleUrls()).toEqual(mountedUrls());
    (recorded.cameras[0]?.["onMotionChange"] as (moving: boolean) => void)(true);
    expect(visibleUrls()).toEqual(mountedUrls());
  });

  it("waits for successful detail draws before completing a partially failed level", () => {
    vi.useFakeTimers();
    const onProgress = vi.fn();
    render(<RoomSplatScene room={ROOM} onProgress={onProgress} />);
    act(() => { loadEveryMountedLayer(); vi.advanceTimersByTime(450); });
    const [failed, ...successful] = mountedLayers().filter((layer) => SHARP.test(String(layer["url"])));
    if (failed === undefined) throw new Error("Detail sources must be mounted");
    act(() => {
      (failed["onError"] as (event: { url: string; error: Error }) => void)({
        url: String(failed["url"]), error: new Error("Unavailable detail tile"),
      });
      for (const layer of successful) {
        (layer["onLoad"] as (event: { url: string; splatCount: number }) => void)({
          url: String(layer["url"]), splatCount: 1000,
        });
      }
      vi.advanceTimersByTime(450);
    });
    expect(onProgress.mock.lastCall?.[0]).toMatchObject({ complete: false, failed: 1, settled: SHARP_URLS.size });
    act(() => { successful.forEach(drawLayer); vi.advanceTimersByTime(450); });
    expect(onProgress.mock.lastCall?.[0]).toMatchObject({ complete: true, failed: 1, firstView: true });
    expect(visibleUrls()).toContain(LADDER.coarse[0]?.url);
    onProgress.mockClear();
    act(() => { vi.advanceTimersByTime(4_000); });
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("does not call a failed tile a first view: nothing is on screen yet", () => {
    vi.useFakeTimers();
    const onProgress = vi.fn();
    render(<RoomSplatScene room={ROOM} onProgress={onProgress} />);
    act(() => {
      for (const layer of mountedLayers()) {
        const url = String(layer["url"]);
        (layer["onError"] as (e: { url: string; error: Error }) => void)({ url, error: new Error("gone") });
      }
    });
    act(() => { vi.advanceTimersByTime(450); });
    act(() => { failEveryMountedSharpTile(); });
    act(() => { vi.advanceTimersByTime(450); });

    const report = onProgress.mock.lastCall?.[0] as { firstView: boolean };
    expect(report.firstView).toBe(false);
  });
});

// A tile whose fetch hangs never loads and never errors, so completion never
// arrives and the poller keeps ticking. Before this it also kept REPORTING,
// which re-rendered the page 2.5 times a second for the rest of the visit.
describe("RoomSplatScene when a tile's fetch hangs", () => {
  beforeEach(() => {
    recorded.layers.length = 0;
    recorded.cameras.length = 0;
    recorded.hosts.length = 0;
    recorded.mounted.clear();
    if (typeof window.matchMedia !== "function") {
      Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false }) });
    }
    setDevicePixelRatio(1);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("says nothing new while nothing changes, so the page stops re-rendering", () => {
    vi.useFakeTimers();
    const onProgress = vi.fn();
    render(<RoomSplatScene room={ROOM} onProgress={onProgress} />);
    act(() => { loadEveryMountedLayer(); });
    act(() => { vi.advanceTimersByTime(450); });
    act(() => {
      // All except one detail tile land; the remaining fetch hangs.
      const sharp = mountedLayers().filter((l) => SHARP.test(String(l["url"])));
      for (const layer of sharp.slice(1)) {
        (layer["onLoad"] as (e: { url: string; splatCount: number }) => void)({ url: String(layer["url"]), splatCount: 1000 });
      }
    });
    act(() => { vi.advanceTimersByTime(450); });

    const settled = onProgress.mock.lastCall?.[0] as { settled: number; complete: boolean };
    expect(settled.settled).toBe(SHARP_URLS.size - 1);
    expect(settled.complete).toBe(false);

    onProgress.mockClear();
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("still reports the moment the straggler arrives and draws", () => {
    vi.useFakeTimers();
    const onProgress = vi.fn();
    render(<RoomSplatScene room={ROOM} onProgress={onProgress} />);
    act(() => { loadEveryMountedLayer(); });
    act(() => { vi.advanceTimersByTime(450); });
    act(() => {
      const sharp = mountedLayers().filter((l) => SHARP.test(String(l["url"])));
      for (const layer of sharp.slice(1)) {
        (layer["onLoad"] as (e: { url: string; splatCount: number }) => void)({ url: String(layer["url"]), splatCount: 1000 });
        drawLayer(layer);
      }
    });
    act(() => { vi.advanceTimersByTime(10_000); });
    onProgress.mockClear();

    act(() => {
      const straggler = mountedLayers().filter((l) => SHARP.test(String(l["url"])))[0];
      (straggler?.["onLoad"] as (e: { url: string; splatCount: number }) => void)({ url: String(straggler?.["url"]), splatCount: 1000 });
      if (straggler === undefined) throw new Error("The final detail source must remain mounted");
      drawLayer(straggler);
    });
    act(() => { vi.advanceTimersByTime(450); });

    const done = onProgress.mock.lastCall?.[0] as { settled: number; complete: boolean };
    expect(done.settled).toBe(SHARP_URLS.size);
    expect(done.complete).toBe(true);
  });
});
