import type { ReactNode } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SplatRuntimeProfile } from "../../../lib/splat-runtime-profile.js";
import { roomSplatServedTileCount } from "../../../data/room-splat-bundles.js";

// The scene is a composition: the canvas, the tiles, the clip box and the
// camera. Each part has its own tests; what this file pins is that the device
// profile reaches the two parts that spend the frame budget, and nothing else.
const recorded = vi.hoisted(() => ({
  layers: [] as Record<string, unknown>[],
  cameras: [] as Record<string, unknown>[],
}));

vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { readonly children?: ReactNode }) => (
    <div data-testid="canvas">{children}</div>
  ),
}));
vi.mock("../../scene/SparkSplatLayer.js", () => ({
  SparkSplatLayer: (props: Record<string, unknown>) => {
    recorded.layers.push(props);
    return null;
  },
}));
vi.mock("../InteriorCamera.js", () => ({
  InteriorCamera: (props: Record<string, unknown>) => {
    recorded.cameras.push(props);
    return null;
  },
}));
vi.mock("../RoomClipBox.js", () => ({ RoomClipBox: () => null }));
// The generated manifest carries no prebuilt trees until `lcc2 lod` has run on
// the staging root, so the first served tile is given one here: the scene must
// load it paged and leave the rest as tiles.
vi.mock("../../../data/room-splat-bundles.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../data/room-splat-bundles.js")>();
  return {
    ...actual,
    roomSplatTileSources: (room: string, base: string | undefined, preferTrees: boolean) =>
      actual.roomSplatTileSources(room, base, false).map((source, index) =>
        preferTrees && index === 0
          ? { ...source, url: source.url.replace(/\/([^/]+)\.sog$/u, "/lod/$1-lod.rad"), tree: true }
          : source),
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

function setDevicePixelRatio(value: number): void {
  Object.defineProperty(window, "devicePixelRatio", { value, configurable: true });
}

describe("RoomSplatScene runtime wiring", () => {
  beforeEach(() => {
    recorded.layers.length = 0;
    recorded.cameras.length = 0;
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

  it("gives every served tile the device's runtime profile", () => {
    render(<RoomSplatScene room={ROOM} />);

    expect(recorded.layers).toHaveLength(roomSplatServedTileCount(ROOM));
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

  it("mounts exactly one renderer host for the room, on the first tile", () => {
    render(<RoomSplatScene room={ROOM} />);

    const hosts = recorded.layers.map((layer) => layer["includeRendererHost"]);
    expect(hosts[0]).toBe(true);
    expect(hosts.slice(1).every((host) => host === false)).toBe(true);
  });

  it("loads a tile's prebuilt tree paged when the profile wants the tree, and the plain tile otherwise", () => {
    render(<RoomSplatScene room={ROOM} />);

    expect(recorded.layers[0]?.["url"]).toMatch(/\/lod\/[^/]+-lod\.rad$/u);
    expect(recorded.layers[0]?.["paged"]).toBe(true);
    expect(recorded.layers[1]?.["url"]).toMatch(/\.sog$/u);
    expect(recorded.layers[1]?.["paged"]).toBe(false);
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
});
