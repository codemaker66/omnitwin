import { readFileSync } from "node:fs";
import path from "node:path";
import { advance, useFrame, useThree, type RootState } from "@react-three/fiber";
import { act } from "@testing-library/react";
import { StrictMode, useEffect, useState, type ReactElement } from "react";
import { Color, Mesh, Raycaster, Texture, Vector3, type BufferGeometry, type Camera, type Object3D } from "three";
import { MeshBasicNodeMaterial, type WebGPURenderer } from "three/webgpu";
import { afterEach, describe, expect, it, vi } from "vitest";
import { replaceStoreRenderer } from "../../../lib/native-renderer.js";
import { intersectSelectable, SELECTION_PICK_IGNORED } from "../../../lib/raycast-gate.js";
import { mountInStubRoot, type StubRoot } from "../../__tests__/stub-r3f-root.js";
import { buildRoomFrame } from "../room-frame.js";
import { buildRoomGeometry } from "../room-geometry.js";
import { parseSurveyRecord } from "../survey-record.js";
import { SurveyedRoomModel, type SurveyedRoomModelProps, type SurveyedRoomPhotoProgress } from "../SurveyedRoomModel.js";
import type { SurveyedRoom } from "../use-surveyed-room.js";

// The photographs decode through createImageBitmap, off the main thread; a
// fake loader stands in for it here and records what it was asked to do.
const recorded = vi.hoisted(() => ({
  loads: [] as { url: string; onLoad: (bitmap: ImageBitmap) => void; onError: () => void }[],
  aborts: 0,
}));

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class FakeImageBitmapLoader {
    setOptions(): this {
      return this;
    }
    load(url: string, onLoad: (bitmap: ImageBitmap) => void, _onProgress: unknown, onError: () => void): void {
      recorded.loads.push({ url, onLoad, onError });
    }
    abort(): this {
      recorded.aborts += 1;
      return this;
    }
  }
  return { ...actual, ImageBitmapLoader: FakeImageBitmapLoader };
});

// The planner's native renderer and its precompile queue, stood in for: off unless a test turns
// them on, as under the stub root, whose renderer is not the planner's.
const native = vi.hoisted(() => ({
  on: false,
  /** The native renderer behind each view's renderer: one stand-in apiece, with a backend to be asked about. */
  behind: new Map<object, { readonly backend: object }>(),
  jobs: [] as { renderer: object; job: (signal: AbortSignal) => Promise<void> }[],
  compiled: [] as object[],
}));

vi.mock("../../../lib/native-renderer.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/native-renderer.js")>()),
  getNativeRenderer: (renderer: object) => {
    if (!native.on) return null;
    const known = native.behind.get(renderer) ?? { backend: {} };
    native.behind.set(renderer, known);
    return known;
  },
}));
vi.mock("../../../lib/native-precompile.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/native-precompile.js")>()),
  requestNativePrecompile: (renderer: object, job: (signal: AbortSignal) => Promise<void>) => {
    native.jobs.push({ renderer, job });
    return Promise.resolve();
  },
}));
vi.mock("../../../lib/native-frame-composer.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/native-frame-composer.js")>()),
  nativeFramePrecompile: (renderer: object) => () => {
    native.compiled.push(renderer);
    return Promise.resolve();
  },
}));

const FIXTURE_TEXT = readFileSync(path.resolve("src/components/surveyed-room/__tests__/fixtures/saloon-survey.fixture.json"), "utf-8");

/** The Saloon as the hook hands it over, here with flat walls and ceiling. */
function saloon(revision = 1): SurveyedRoom {
  const json: unknown = JSON.parse(FIXTURE_TEXT);
  const record = parseSurveyRecord(typeof json === "object" && json !== null ? { ...json, revision } : json);
  const frame = buildRoomFrame(record.room.outline);
  const reliefs = { walls: null, ceiling: null };
  return { entry: { slug: "saloon", base: "/rooms/saloon/survey-2026-07-11", revision }, record, frame, reliefs, geometry: buildRoomGeometry(record, frame, reliefs) };
}

/** A decoded image, with its close() kept apart for assertions. */
function bitmap(): { readonly image: ImageBitmap; readonly close: ReturnType<typeof vi.fn<() => void>> } {
  const close = vi.fn<() => void>();
  return { image: { width: 4, height: 4, close }, close };
}

function loadFor(name: string): { onLoad: (bitmap: ImageBitmap) => void; onError: () => void } {
  const entry = recorded.loads.find((load) => load.url.includes(name));
  if (entry === undefined) throw new Error(`no load for ${name}`);
  return entry;
}

/** The files asked for, without their folder. */
function filesAsked(): string[] {
  return recorded.loads.map((load) => load.url.split("/").pop() ?? "");
}

const SURFACES = ["walls", "ceiling", "floor"] as const;
type Surface = (typeof SURFACES)[number];

interface Drawn {
  readonly mesh: Mesh;
  readonly geometry: BufferGeometry;
  readonly material: MeshBasicNodeMaterial;
}

// instanceof narrows three's generic classes to `any` parameters; these keep their defaults.
function isMesh(object: Object3D | undefined): object is Mesh {
  return object instanceof Mesh;
}

function isTexture(value: unknown): value is Texture {
  return value instanceof Texture;
}

function drawn(scene: Object3D, surface: Surface): Drawn {
  const mesh = scene.getObjectByName(`surveyed-room-${surface}`);
  if (!isMesh(mesh)) throw new Error(`the ${surface} are not drawn`);
  const material: unknown = mesh.material;
  if (!(material instanceof MeshBasicNodeMaterial)) throw new Error(`the ${surface} have no node material`);
  return { mesh, geometry: mesh.geometry, material };
}

/** What a surface's material samples: its photograph, or its placeholder. */
function sampled(scene: Object3D, surface: Surface): Texture {
  const found: Texture[] = [];
  drawn(scene, surface).material.colorNode?.traverse((node) => {
    if (!("isTextureNode" in node) || node.isTextureNode !== true || !("value" in node)) return;
    const value: unknown = node.value;
    if (isTexture(value)) found.push(value);
  });
  const [first] = found;
  if (first === undefined) throw new Error(`the ${surface} sample no texture`);
  return first;
}

/** The numbers and colours (linear r, g, b) a surface's colour reads from uniforms. */
function uniformValues(scene: Object3D, surface: Surface): { readonly numbers: number[]; readonly colours: string[] } {
  const numbers = new Set<number>();
  const colours = new Set<string>();
  drawn(scene, surface).material.colorNode?.traverse((node) => {
    if (!("isUniformNode" in node) || node.isUniformNode !== true || !("value" in node)) return;
    const value: unknown = node.value;
    if (typeof value === "number") numbers.add(value);
    if (value instanceof Color) colours.add(value.toArray().join(" "));
  });
  return { numbers: [...numbers].sort((a, b) => a - b), colours: [...colours] };
}

interface Disposable {
  addEventListener(type: "dispose", listener: () => void): void;
}

/** Counts each time one of the named objects is disposed. */
function watchDisposal(objects: Readonly<Record<string, Disposable>>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [name, object] of Object.entries(objects)) {
    counts[name] = 0;
    object.addEventListener("dispose", () => { counts[name] = (counts[name] ?? 0) + 1; });
  }
  return counts;
}

/** Every geometry and material the room draws with now. */
function resources(scene: Object3D): Record<string, Disposable> {
  const out: Record<string, Disposable> = {};
  for (const surface of SURFACES) {
    const { geometry, material } = drawn(scene, surface);
    out[`${surface} geometry`] = geometry;
    out[`${surface} material`] = material;
  }
  return out;
}

let mounted: StubRoot | null = null;
let setProps: (props: SurveyedRoomModelProps) => void = () => undefined;

/** The model under props a test can change. */
function Harness({ initial }: { readonly initial: SurveyedRoomModelProps }): ReactElement {
  const [props, set] = useState(initial);
  useEffect(() => { setProps = set; }, []);
  return <SurveyedRoomModel {...props} />;
}

function mount(props: SurveyedRoomModelProps): Object3D {
  mounted = mountInStubRoot(<Harness initial={props} />);
  return mounted.scene;
}

function unmount(): void {
  mounted?.unmount();
  mounted = null;
}

afterEach(() => {
  unmount();
  recorded.loads.length = 0;
  recorded.aborts = 0;
  native.on = false;
  native.behind.clear();
  native.jobs.length = 0;
  native.compiled.length = 0;
});

describe("SurveyedRoomModel", () => {
  it("draws the room as three meshes: walls, ceiling and floor, each with its own geometry and material", () => {
    const room = saloon();
    const scene = mount({ room, photoQuality: 1 });
    const walls = drawn(scene, "walls");
    expect(walls.geometry.getAttribute("position").array).toBe(room.geometry.walls.positions);
    expect(walls.geometry.getAttribute("normal").array).toBe(room.geometry.walls.normals);
    expect(walls.geometry.getAttribute("uv").array).toBe(room.geometry.walls.uvs);
    expect(walls.geometry.getAttribute("aWallNormal").array).toBe(room.geometry.walls.wallNormals);
    expect(walls.geometry.getIndex()?.count).toBe(12 * 6);
    expect(walls.geometry.boundingSphere).not.toBeNull();
    expect(drawn(scene, "ceiling").geometry.getAttribute("position").array).toBe(room.geometry.ceiling.positions);
    expect(drawn(scene, "floor").geometry.getIndex()?.count).toBe(30);
    for (const surface of SURFACES) {
      const { mesh, material } = drawn(scene, surface);
      expect(material.name).toBe(`surveyed-room-${surface}`);
      // The room surrounds the camera: nothing is gained by culling it.
      expect(mesh.frustumCulled).toBe(false);
    }
  });

  it("keeps the room out of the selection pick while a measuring ray still meets its walls", () => {
    const scene = mount({ room: saloon(), photoQuality: 1 });
    const marked = (object: Object3D | undefined): unknown => object?.userData[SELECTION_PICK_IGNORED];
    expect(marked(scene.getObjectByName("surveyed-room"))).toBe(true);
    for (const surface of SURFACES) expect(marked(drawn(scene, surface).mesh)).toBe(true);
    scene.updateMatrixWorld(true);
    // From the middle of the room towards the fireplace wall, at z = 3.739.
    const raycaster = new Raycaster(new Vector3(0, 1.5, 0), new Vector3(0, 0, 1));
    const hits = raycaster.intersectObject(scene, true);
    expect(hits[0]?.object.name).toBe("surveyed-room-walls");
    expect(hits[0]?.distance).toBeCloseTo(3.739, 3);
    expect(intersectSelectable(raycaster, [scene])).toEqual([]);
    // Looking back from outside that wall, its back is no surface: the ray meets the window wall across the room.
    const outside = new Raycaster(new Vector3(0, 1.5, 9), new Vector3(0, 0, -1));
    expect(outside.intersectObject(scene, true)[0]?.distance).toBeCloseTo(9 + 3.734, 3);
  });

  it("counts its photographs in as they arrive or fail, and names the ones that failed", () => {
    const progress: SurveyedRoomPhotoProgress[] = [];
    const scene = mount({ room: saloon(), photoQuality: 1, onPhotoProgress: (step) => { progress.push(step); } });
    expect(recorded.loads.map((load) => load.url)).toEqual([
      "/rooms/saloon/survey-2026-07-11/walls-4096.webp?r=1",
      "/rooms/saloon/survey-2026-07-11/ceiling-1829.webp?r=1",
      "/rooms/saloon/survey-2026-07-11/floor-1463.webp?r=1",
    ]);
    expect(progress).toEqual([{ expected: 3, settled: 0, failed: [] }]);
    const placeholder = sampled(scene, "walls");

    const walls = bitmap();
    act(() => { loadFor("walls-4096").onLoad(walls.image); });
    expect(progress.at(-1)).toEqual({ expected: 3, settled: 1, failed: [] });
    expect(sampled(scene, "walls").image).toBe(walls.image);
    expect(sampled(scene, "walls")).not.toBe(placeholder);

    act(() => { loadFor("floor-1463").onError(); });
    expect(progress.at(-1)).toEqual({ expected: 3, settled: 2, failed: ["floor-1463.webp"] });
    act(() => { loadFor("ceiling-1829").onLoad(bitmap().image); });
    expect(progress.at(-1)).toEqual({ expected: 3, settled: 3, failed: ["floor-1463.webp"] });
    expect(progress).toHaveLength(4);
  });

  it("takes the next size down at half quality, and the device's own size when not told", () => {
    mount({ room: saloon(), photoQuality: 0.5 });
    expect(filesAsked()).toEqual(["walls-2048.webp?r=1", "ceiling-915.webp?r=1", "floor-732.webp?r=1"]);
    unmount();
    recorded.loads.length = 0;
    // The test's browser is a computer: the largest.
    mount({ room: saloon() });
    expect(filesAsked()).toEqual(["walls-4096.webp?r=1", "ceiling-1829.webp?r=1", "floor-1463.webp?r=1"]);
  });

  it("does not fetch its photographs again for a new callback, and tells the latest one", () => {
    const first: SurveyedRoomPhotoProgress[] = [];
    const second: SurveyedRoomPhotoProgress[] = [];
    const room = saloon();
    mount({ room, photoQuality: 1, onPhotoProgress: (step) => { first.push(step); } });
    act(() => { setProps({ room, photoQuality: 1, onPhotoProgress: (step) => { second.push(step); } }); });
    expect(recorded.loads).toHaveLength(3);
    act(() => { loadFor("walls-4096").onLoad(bitmap().image); });
    expect(first).toEqual([{ expected: 3, settled: 0, failed: [] }]);
    expect(second).toEqual([{ expected: 3, settled: 1, failed: [] }]);
  });

  it("grades the room through its materials' uniforms, as photographed until told otherwise", () => {
    const room = saloon();
    const scene = mount({ room, photoQuality: 1 });
    // Exposure and glow at 1, tint white.
    expect(uniformValues(scene, "walls")).toEqual({ numbers: [1], colours: ["1 1 1"] });
    act(() => { setProps({ room, photoQuality: 1, grade: { exposure: 0.5, glow: 2.25, tint: new Color(1, 0.5, 0) } }); });
    expect(uniformValues(scene, "walls")).toEqual({ numbers: [0.5, 2.25], colours: ["1 0.5 0"] });
    // The ceiling and floor take the exposure and tint; only the walls have glass to glow.
    expect(uniformValues(scene, "ceiling")).toEqual({ numbers: [0.5], colours: ["1 0.5 0"] });
    expect(uniformValues(scene, "floor")).toEqual({ numbers: [0.5], colours: ["1 0.5 0"] });
    act(() => { setProps({ room, photoQuality: 1 }); });
    expect(uniformValues(scene, "walls")).toEqual({ numbers: [1], colours: ["1 1 1"] });
  });

  it("frees every geometry, material, texture and bitmap when it unmounts, once each, and says nothing after", () => {
    const progress: SurveyedRoomPhotoProgress[] = [];
    const scene = mount({ room: saloon(), photoQuality: 1, onPhotoProgress: (step) => { progress.push(step); } });
    const kept = bitmap();
    act(() => { loadFor("walls-4096").onLoad(kept.image); });
    const counts = watchDisposal({
      ...resources(scene),
      "walls photograph": sampled(scene, "walls"),
      "ceiling placeholder": sampled(scene, "ceiling"),
      "floor placeholder": sampled(scene, "floor"),
    });
    const told = progress.length;

    unmount();
    expect(counts).toEqual({
      "walls geometry": 1, "ceiling geometry": 1, "floor geometry": 1,
      "walls material": 1, "ceiling material": 1, "floor material": 1,
      "walls photograph": 1, "ceiling placeholder": 1, "floor placeholder": 1,
    });
    expect(kept.close).toHaveBeenCalledTimes(1);
    // A photograph still in flight is closed as it lands, and nobody is told.
    const late = bitmap();
    loadFor("ceiling-1829").onLoad(late.image);
    expect(late.close).toHaveBeenCalledTimes(1);
    loadFor("floor-1463").onError();
    expect(progress).toHaveLength(told);
  });

  it("still takes its photographs when React rehearses its effects' cleanup (StrictMode)", () => {
    const progress: SurveyedRoomPhotoProgress[] = [];
    mounted = mountInStubRoot(
      <StrictMode><SurveyedRoomModel room={saloon()} photoQuality={1} onPhotoProgress={(step) => { progress.push(step); }} /></StrictMode>,
    );
    const scene = mounted.scene;
    // The effects ran, were cleaned up and ran again on the same memoised photographs: asked for twice, the first asking stopped.
    expect(recorded.loads).toHaveLength(6);
    expect(recorded.aborts).toBeGreaterThanOrEqual(1);
    const [rehearsed, kept] = recorded.loads.filter((load) => load.url.includes("walls-4096"));
    if (rehearsed === undefined || kept === undefined) throw new Error("the walls were not asked for twice");
    const stale = bitmap();
    act(() => { rehearsed.onLoad(stale.image); });
    expect(stale.close).toHaveBeenCalledTimes(1);
    const walls = bitmap();
    act(() => { kept.onLoad(walls.image); });
    expect(walls.close).not.toHaveBeenCalled();
    expect(sampled(scene, "walls").image).toBe(walls.image);
    expect(progress.at(-1)).toEqual({ expected: 3, settled: 1, failed: [] });
  });

  /** The view's camera and store setter, for a test that moves the camera and draws frames. */
  interface ViewHandle { camera: Camera | null; set: RootState["set"] | null }
  function View({ into }: { readonly into: ViewHandle }): null {
    into.camera = useThree((state) => state.camera);
    into.set = useThree((state) => state.set);
    return null;
  }

  it("takes away the walls the camera is behind and the ceiling from above, each frame before it is drawn", () => {
    const view: ViewHandle = { camera: null, set: null };
    mounted = mountInStubRoot(<><View into={view} /><SurveyedRoomModel room={saloon()} photoQuality={1} /></>);
    const scene = mounted.scene;
    const walls = drawn(scene, "walls").geometry;
    const ceiling = drawn(scene, "ceiling").geometry;
    // Twelve flat walls of two triangles each.
    expect(walls.drawRange.count).toBe(72);
    // Inside, under the ceiling: all of it.
    view.camera?.position.set(0, 1.6, 0);
    act(() => { advance(1); });
    expect(walls.drawRange.count).toBe(72);
    expect(ceiling.drawRange.count).toBe(Infinity);
    // Outside the fireplace side and above: that side's five walls and the ceiling are not drawn.
    view.camera?.position.set(0, 9, 15);
    act(() => { advance(2); });
    expect(walls.drawRange.count).toBe(7 * 6);
    expect(ceiling.drawRange.count).toBe(0);
    // A ray from out there looking in passes where the fireplace wall stood and meets the window wall across the room.
    scene.updateMatrixWorld(true);
    const lookingIn = new Raycaster(new Vector3(0, 1.5, 9), new Vector3(0, 0, -1));
    expect(lookingIn.intersectObject(scene, true)[0]?.distance).toBeCloseTo(9 + 3.734, 3);
    // Back inside: every wall and the ceiling again.
    view.camera?.position.set(0, 1.6, 0);
    act(() => { advance(3); });
    expect(walls.drawRange.count).toBe(72);
    expect(ceiling.drawRange.count).toBe(Infinity);
  });

  it("asks for one more frame when the camera is moved after the room's turn in a frame, and then rests", () => {
    const view: ViewHandle = { camera: null, set: null };
    const moves: (readonly [number, number, number])[] = [];
    // Mounted after the room, so its turn in each frame comes after the room's: a camera owner that moves late.
    function LateMover(): null {
      useFrame(({ camera }) => {
        const next = moves.shift();
        if (next !== undefined) camera.position.set(...next);
      });
      return null;
    }
    mounted = mountInStubRoot(<><View into={view} /><SurveyedRoomModel room={saloon()} photoQuality={1} /><LateMover /></>);
    const walls = drawn(mounted.scene, "walls").geometry;
    const invalidate = vi.fn();
    act(() => { view.set?.({ invalidate }); });
    view.camera?.position.set(0, 1.6, 0);
    act(() => { advance(1); });
    invalidate.mockClear();
    // The mover takes the camera out beyond the +x end once the room has had its turn: this frame is drawn with every wall.
    moves.push([15, 1.6, 0]);
    act(() => { advance(2); });
    expect(walls.drawRange.count).toBe(72);
    expect(invalidate).toHaveBeenCalledTimes(1);
    // The frame it asked for: the camera is where it was left, the room catches up (three walls turned from it go), and it rests.
    act(() => { advance(3); });
    expect(walls.drawRange.count).toBe(9 * 6);
    expect(invalidate).toHaveBeenCalledTimes(1);
    act(() => { advance(4); });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("has its pipelines compiled ahead for the planner's scene pass, and again for a renderer that replaces the first", async () => {
    const view: { set: RootState["set"] | null; gl: object | null } = { set: null, gl: null };
    function Probe(): null {
      view.set = useThree((state) => state.set);
      view.gl = useThree((state) => state.gl);
      return null;
    }
    native.on = true;
    mounted = mountInStubRoot(<><Probe /><SurveyedRoomModel room={saloon()} photoQuality={1} /></>);
    // One job, queued for the view's renderer; run, it compiles that renderer's scene pass.
    const first = view.gl === null ? undefined : native.behind.get(view.gl);
    expect(first).toBeDefined();
    expect(native.jobs.map((entry) => entry.renderer)).toEqual([first]);
    await native.jobs[0]?.job(new AbortController().signal);
    expect(native.compiled).toEqual([first]);

    // The device is lost and a fresh renderer takes the canvas, handed to the store as NativeCanvas hands it
    // (lib/native-renderer.ts replaceStoreRenderer): compiled for again. A stand-in: only its identity is read.
    const replacement: object = { domElement: document.createElement("canvas"), render: () => undefined };
    act(() => { if (view.set !== null) replaceStoreRenderer({ set: view.set }, replacement as WebGPURenderer); });
    const second = native.behind.get(replacement);
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(native.jobs.map((entry) => entry.renderer)).toEqual([first, second]);
    // The first renderer's job, were it still waiting, would now do nothing: its effect has gone.
    await native.jobs[0]?.job(new AbortController().signal);
    expect(native.compiled).toEqual([first]);
    await native.jobs[1]?.job(new AbortController().signal);
    expect(native.compiled).toEqual([first, second]);

    // A job still queued when the room unmounts compiles nothing, and one whose signal has aborted neither.
    native.compiled.length = 0;
    unmount();
    await native.jobs[1]?.job(new AbortController().signal);
    expect(native.compiled).toEqual([]);
  });

  it("queues no compile where the view's renderer is not the planner's native one", () => {
    mount({ room: saloon(), photoQuality: 1 });
    expect(native.jobs).toEqual([]);
  });

  it("frees one room's resources and loads the next room's when the room changes", () => {
    const scene = mount({ room: saloon(1), photoQuality: 1 });
    const kept = bitmap();
    act(() => { loadFor("walls-4096").onLoad(kept.image); });
    const before = resources(scene);
    const counts = watchDisposal({ ...before, "walls photograph": sampled(scene, "walls") });
    recorded.loads.length = 0;

    const second = saloon(2);
    act(() => { setProps({ room: second, photoQuality: 1 }); });
    expect(Object.values(counts)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(kept.close).toHaveBeenCalledTimes(1);
    expect(filesAsked()).toEqual(["walls-4096.webp?r=2", "ceiling-1829.webp?r=2", "floor-1463.webp?r=2"]);
    // The meshes now wear the second room's own geometry and materials, on its placeholders.
    const after = resources(scene);
    for (const name of Object.keys(before)) expect(after[name], name).not.toBe(before[name]);
    expect(drawn(scene, "walls").geometry.getAttribute("position").array).toBe(second.geometry.walls.positions);
    expect(sampled(scene, "walls").image).not.toBe(kept.image);
  });

  it("loads the other size of its photographs when the quality changes, freeing the first", () => {
    const room = saloon();
    const scene = mount({ room, photoQuality: 1 });
    const kept = bitmap();
    act(() => { loadFor("walls-4096").onLoad(kept.image); });
    const geometry = drawn(scene, "walls").geometry;
    recorded.loads.length = 0;
    act(() => { setProps({ room, photoQuality: 0.5 }); });
    expect(kept.close).toHaveBeenCalledTimes(1);
    expect(filesAsked()).toEqual(["walls-2048.webp?r=1", "ceiling-915.webp?r=1", "floor-732.webp?r=1"]);
    // The room is the same: its geometry stays.
    expect(drawn(scene, "walls").geometry).toBe(geometry);
  });
});
