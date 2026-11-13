import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "@testing-library/react";
import { useEffect, useState, type ReactElement } from "react";
import { Color, Mesh, Raycaster, Texture, Vector3, type BufferGeometry, type Object3D } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  }
  return { ...actual, ImageBitmapLoader: FakeImageBitmapLoader };
});

const FIXTURE_TEXT = readFileSync(path.resolve("src/components/surveyed-room/__tests__/fixtures/saloon-survey.fixture.json"), "utf-8");

/** The Saloon as the hook hands it over, here with flat walls and ceiling. */
function saloon(revision = 1): SurveyedRoom {
  const json: unknown = JSON.parse(FIXTURE_TEXT);
  const record = parseSurveyRecord(typeof json === "object" && json !== null ? { ...json, revision } : json);
  const frame = buildRoomFrame(record.room.outline);
  const reliefs = { walls: null, ceiling: null };
  return { entry: { base: "/rooms/saloon/survey-2026-07-11", revision }, record, frame, reliefs, geometry: buildRoomGeometry(record, frame, reliefs) };
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
