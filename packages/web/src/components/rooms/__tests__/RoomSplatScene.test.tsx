import type { ReactNode } from "react";
import { act, cleanup, render } from "@testing-library/react";
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
}));

vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { readonly children?: ReactNode }) => (
    <div data-testid="canvas">{children}</div>
  ),
}));
vi.mock("../../scene/SparkSplatLayer.js", async () => {
  const { useEffect } = await import("react");
  return {
    SparkSplatLayer: (props: Record<string, unknown>) => {
      const url = String(props["url"]);
      recorded.layers.push(props);
      recorded.mounted.set(url, props);
      useEffect(() => () => { recorded.mounted.delete(url); }, [url]);
      return null;
    },
    SparkRendererMount: (props: Record<string, unknown>) => {
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
// The generated manifest carries no prebuilt trees until `lcc2 lod` has run on
// the staging root, so the coarse tile is given one here: the scene must load
// it paged and leave the rest as tiles.
vi.mock("../../../data/room-splat-bundles.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../data/room-splat-bundles.js")>();
  return {
    ...actual,
    roomSplatLadder: (room: string, base: string | undefined, preferTrees: boolean) => {
      const ladder = actual.roomSplatLadder(room, base, false);
      if (!preferTrees) return ladder;
      return {
        ...ladder,
        coarse: ladder.coarse.map((source) => ({
          ...source,
          url: source.url.replace(/\/([^/]+)\.sog$/u, "/lod/$1-lod.rad"),
          tree: true,
        })),
      };
    },
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
    .filter((layer) => layer["visible"] !== false)
    .map((layer) => String(layer["url"]));
}

/** Report every mounted layer as loaded, the way Spark does when one lands. */
function loadEveryMountedLayer(): void {
  for (const layer of mountedLayers()) {
    const onLoad = layer["onLoad"] as (event: { url: string; splatCount: number }) => void;
    onLoad({ url: String(layer["url"]), splatCount: 1000 });
  }
}

/** The finest level, taken from the ladder itself rather than guessed at by name. */
const LADDER = roomSplatLadder(ROOM, undefined, false);
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

  it("drives the camera's pixel ratios from the profile, with the device's own ratio as the ceiling", () => {
    render(<RoomSplatScene room={ROOM} />);

    expect(recorded.cameras).toHaveLength(1);
    expect(recorded.cameras[0]?.["motionDpr"]).toBe(0.5);
    expect(recorded.cameras[0]?.["settledDpr"]).toBe(1);
  });

  it("lets a sharper device rest at the profile's settled ratio", () => {
    setDevicePixelRatio(2);
    render(<RoomSplatScene room={ROOM} />);

    expect(recorded.cameras[0]?.["settledDpr"]).toBe(1.5);
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

  it("loads a tile's prebuilt tree paged when the profile wants the tree, and the plain tile otherwise", () => {
    render(<RoomSplatScene room={ROOM} />);

    const coarse = mountedLayers().find((layer) => String(layer["url"]).includes("/lod/"));
    expect(coarse?.["paged"]).toBe(true);
    const sky = mountedLayers().find((layer) => String(layer["url"]).endsWith("env.sog"));
    expect(sky?.["paged"]).toBe(false);
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

  // Measured 2026-09-04: a Spark mesh that loads while invisible and is revealed
  // later renders as unsorted colour blobs, because Spark only drives the
  // level-of-detail tree of generators the scene traverses as VISIBLE, and a
  // camera move repairs the tiles one at a time. So the finest level shows each
  // tile as it lands, over the coarse room, which keeps the room whole
  // throughout. See .claude/gotchas/spark-invisible-splat-load.md.
  it("fetches the finest level once the coarse room is up, and shows each tile as it lands over the coarse room", () => {
    vi.useFakeTimers();
    render(<RoomSplatScene room={ROOM} />);
    act(() => { loadEveryMountedLayer(); });
    act(() => { vi.advanceTimersByTime(450); });

    expect(sharpUrls()).toHaveLength(11);
    for (const layer of mountedLayers()) {
      expect(layer["visible"]).not.toBe(false);
    }
    expect(visibleUrls().some((url) => url.includes("0_0"))).toBe(true);
  });

  it("swaps to the finest level and drops the coarse room when its last tile lands", () => {
    vi.useFakeTimers();
    render(<RoomSplatScene room={ROOM} />);
    act(() => { loadEveryMountedLayer(); });
    act(() => { vi.advanceTimersByTime(450); });
    act(() => { loadEveryMountedLayer(); });
    act(() => { vi.advanceTimersByTime(450); });

    expect(sharpUrls()).toHaveLength(11);
    const notSharpOrSky = mountedUrls()
      .filter((url) => !SHARP.test(url) && !url.endsWith("env.sog"));
    expect(notSharpOrSky).toEqual([]);
    expect(mountedUrls().some((url) => url.endsWith("env.sog"))).toBe(true);
    for (const layer of mountedLayers()) expect(layer["visible"]).not.toBe(false);
  });

  it("reports the first view as soon as the coarse room is up, and completion only when the finest level is", () => {
    vi.useFakeTimers();
    const onProgress = vi.fn();
    render(<RoomSplatScene room={ROOM} onProgress={onProgress} />);

    act(() => { vi.advanceTimersByTime(450); });
    const before = onProgress.mock.lastCall?.[0] as { firstView: boolean; total: number; complete: boolean };
    expect(before.firstView).toBe(false);
    expect(before.total).toBe(11);
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
    expect(done.settled).toBe(11);
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

    expect(sharpUrls()).toHaveLength(11);
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

    expect(sharpUrls()).toHaveLength(11);
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
    const report = onProgress.mock.lastCall?.[0] as { complete: boolean; failed: number };
    expect(report.failed).toBe(11);
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
    expect(sharpUrls()).toHaveLength(11);
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
