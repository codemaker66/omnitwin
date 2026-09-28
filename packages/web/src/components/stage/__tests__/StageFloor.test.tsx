import { act } from "@testing-library/react";
import { flushSync } from "@react-three/fiber";
import type { ReactElement } from "react";
import { Texture, TextureLoader, type BufferGeometry, type Mesh, type Object3D } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import type { FloorSkinManifest } from "../../../lib/floor-skin.js";
import { NativeSplatScene } from "../../../lib/native-splat-scene.js";
import type { RuntimeAssetViewTransform } from "../../../lib/runtime-package-resolution.js";
import { mountInStubRoot, type StubRoot } from "../../__tests__/stub-r3f-root.js";
import { StageFloor } from "../StageFloor.js";

// The real component in a real R3F root (a renderer that draws nothing), with
// the network, the texture decoder and the device probe replaced. Every
// geometry and texture the floor creates is recorded with the moment it is
// released, so the tests can say what is drawn and whether it is still alive.
const built = vi.hoisted(() => ({
  geometries: [] as BufferGeometry[],
  textures: [] as Texture[],
  released: new Set<object>(),
  failingTexture: null as string | null,
}));

vi.mock("../../../hooks/use-splat-runtime-profile.js", () => ({ useAssetDeviceTier: () => "high" }));
vi.mock("../../../lib/floor-skin.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/floor-skin.js")>();
  return {
    ...actual,
    floorSkinTileGeometry: (...args: Parameters<typeof actual.floorSkinTileGeometry>): BufferGeometry => {
      const geometry = actual.floorSkinTileGeometry(...args);
      geometry.addEventListener("dispose", () => { built.released.add(geometry); });
      built.geometries.push(geometry);
      return geometry;
    },
  };
});

// A 4 m × 2 m floor in two tiles (the Grand Hall package's shape, smaller).
const MANIFEST: FloorSkinManifest = {
  schema: "venviewer.floor-skin.v1", venue: "trades-hall", room: "grand-hall", frame: "capture",
  provenance: { kind: "measured-photographic", arm: "C", source: "test", built: "2026-09-28T00:00:00Z", inputs: {} },
  grid: { widthPx: 400, heightPx: 200, texelM: 0.01, origin: [0, 0, 1], uAxis: [0, 0.01, 0], vAxis: [0.01, 0, 0] },
  plane: { normal: [0, 0, 1], d: 1 },
  tiles: [{ col0: 0, row0: 0, cols: 200, rows: 200 }, { col0: 200, row0: 0, cols: 200, rows: 200 }],
  tiers: {
    high: { size: 200, files: ["h0.webp", "h1.webp"] },
    medium: { size: 100, files: ["m0.webp", "m1.webp"] },
    low: { size: 50, files: ["l0.webp", "l1.webp"] },
  },
  height: { file: "height.i16", cols: 80, rows: 40, cellPx: 5, unitM: 0.0001, outside: -32768 },
  slab: { file: "slab.u8", width: 8, height: 4, below: 0.15, above: 0.12 },
  colour: { matched: [0.7, 0.6, 0.65] },
  files: {},
};

const IDENTITY: RuntimeAssetViewTransform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, note: "identity" };

interface FloorProps {
  readonly roomSlug: string | null;
  readonly transform: RuntimeAssetViewTransform;
  readonly active: boolean;
}
const useFloorProps = create<FloorProps>()(() => ({ roomSlug: "grand-hall", transform: IDENTITY, active: true }));

/** StageFloor with props from a store, so a test can change them inside the live root. */
function Harness(): ReactElement {
  const props = useFloorProps();
  return <StageFloor roomSlug={props.roomSlug} transform={props.transform} active={props.active} />;
}

let served: unknown = MANIFEST;
const requests: string[] = [];
const reported = vi.fn<(error: unknown) => void>();
let mounted: StubRoot | null = null;

function isMesh(object: Object3D): object is Mesh {
  return (object as Partial<Pick<Mesh, "isMesh">>).isMesh === true;
}

/** The floor tiles in the scene right now. */
function tiles(): Mesh[] {
  const meshes: Mesh[] = [];
  mounted?.scene.traverse((object) => {
    if (isMesh(object) && object.name.startsWith("stage-floor-tile-")) meshes.push(object);
  });
  return meshes;
}

function releasedTilesDrawn(): number {
  return tiles().filter((mesh) => built.released.has(mesh.geometry)).length;
}

/** Lets every pending fetch, texture load, state update and effect settle. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 10; turn += 1) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", (url: string): Promise<Response> => {
    requests.push(url);
    if (url.endsWith("/floor-skin.json")) return Promise.resolve(new Response(JSON.stringify(served)));
    if (url.endsWith("/height.i16")) return Promise.resolve(new Response(new Int16Array(80 * 40).buffer));
    if (url.endsWith("/slab.u8")) return Promise.resolve(new Response(new Uint8Array(8 * 4).fill(255)));
    return Promise.resolve(new Response(null, { status: 404 }));
  });
  vi.stubGlobal("reportError", reported);
  vi.spyOn(TextureLoader.prototype, "loadAsync").mockImplementation((url: string) => {
    if (built.failingTexture !== null && url.endsWith(built.failingTexture)) {
      return Promise.reject(new Error(`No texture at ${url}`));
    }
    const texture = new Texture<HTMLImageElement>();
    texture.addEventListener("dispose", () => { built.released.add(texture); });
    built.textures.push(texture);
    return Promise.resolve(texture);
  });
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  useFloorProps.setState({ roomSlug: "grand-hall", transform: IDENTITY, active: true });
  built.geometries.length = 0;
  built.textures.length = 0;
  built.released.clear();
  built.failingTexture = null;
  served = MANIFEST;
  requests.length = 0;
  reported.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("StageFloor load lifecycle (T-639)", () => {
  it("draws a fresh load after leaving the room and coming back, never the floor it released", async () => {
    mounted = mountInStubRoot(<Harness />);
    await settle();
    const first = tiles().map((mesh) => mesh.geometry);
    expect(first).toHaveLength(2);
    expect(releasedTilesDrawn()).toBe(0);

    // Another room (or the planner flipping to a registered package): the
    // floor is released with nothing left to show it.
    act(() => { useFloorProps.setState({ roomSlug: null }); });
    await settle();
    expect(tiles()).toHaveLength(0);
    expect(first.every((geometry) => built.released.has(geometry))).toBe(true);
    expect(built.textures.every((texture) => built.released.has(texture))).toBe(true);

    // Back to the same room: the same load key as the released floor.
    act(() => { useFloorProps.setState({ roomSlug: "grand-hall" }); });
    expect(releasedTilesDrawn(), "a released floor was handed back to three").toBe(0);
    await settle();
    const second = tiles().map((mesh) => mesh.geometry);
    expect(second).toHaveLength(2);
    expect(second.some((geometry) => first.includes(geometry))).toBe(false);
    expect(releasedTilesDrawn()).toBe(0);
    expect(reported).not.toHaveBeenCalled();
  });

  it("never draws a released floor, even when the way back renders before the release reaches state", async () => {
    mounted = mountInStubRoot(<Harness />);
    await settle();
    expect(tiles()).toHaveLength(2);

    act(() => {
      // Store updates render at sync priority; the release's state update is
      // made during passive effects, at default priority, so this sync render
      // back to the same room runs before it is applied.
      flushSync(() => { useFloorProps.setState({ roomSlug: null }); });
      flushSync(() => { useFloorProps.setState({ roomSlug: "grand-hall" }); });
      expect(releasedTilesDrawn(), "a released floor was handed back to three").toBe(0);
    });
    await settle();
    expect(tiles()).toHaveLength(2);
    expect(releasedTilesDrawn()).toBe(0);
  });

  it("releases every tile that did load when another tile fails", async () => {
    built.failingTexture = "/h1.webp";
    mounted = mountInStubRoot(<Harness />);
    await settle();
    expect(reported).toHaveBeenCalledOnce();
    expect(tiles()).toHaveLength(0);
    expect(built.textures).toHaveLength(1);
    expect(built.textures.every((texture) => built.released.has(texture))).toBe(true);
    expect(built.geometries.every((geometry) => built.released.has(geometry))).toBe(true);
  });

  it.each([
    ["another venue", { venue: "elsewhere" }],
    ["another room", { room: "saloon" }],
  ])("refuses a package built for %s, before loading any texture", async (_label, override) => {
    served = { ...MANIFEST, ...override };
    mounted = mountInStubRoot(<Harness />);
    await settle();
    expect(reported).toHaveBeenCalledOnce();
    expect(built.textures).toHaveLength(0);
    expect(tiles()).toHaveLength(0);
  });

  it("fetches nothing where Gaussian splats may not run", async () => {
    vi.stubEnv("DEV", false);
    mounted = mountInStubRoot(<Harness />);
    await settle();
    expect(requests).toEqual([]);
    expect(tiles()).toHaveLength(0);
  });
});

describe("StageFloor slab exclusion (T-639)", () => {
  function cuts(set: { readonly mock: { readonly calls: readonly (readonly unknown[])[] } }): number {
    return set.mock.calls.filter((call) => call[1] !== null).length;
  }

  it("keeps the cut through a re-render with an equal transform, and re-cuts when the floor moves", async () => {
    const set = vi.spyOn(NativeSplatScene.prototype, "setExclusion");
    const clear = vi.spyOn(NativeSplatScene.prototype, "clearExclusion");
    mounted = mountInStubRoot(<Harness />);
    await settle();
    expect(cuts(set)).toBe(1);

    // A caller rebuilding an equal transform each render (the walk's progress
    // ticks did) must not clear and re-cut the mask.
    act(() => { useFloorProps.setState({ transform: { ...IDENTITY, position: [0, 0, 0] } }); });
    await settle();
    expect(cuts(set)).toBe(1);
    expect(clear).not.toHaveBeenCalled();

    act(() => { useFloorProps.setState({ transform: { ...IDENTITY, position: [1, 0, 0] } }); });
    await settle();
    expect(cuts(set)).toBe(2);
    expect(clear).toHaveBeenCalledOnce();
  });
});
