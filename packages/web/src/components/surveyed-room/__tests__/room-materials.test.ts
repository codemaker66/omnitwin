import { BufferAttribute, BufferGeometry, Color, FrontSide, Mesh, NearestFilter, PerspectiveCamera, RenderTarget, Scene, type Texture } from "three";
import { lights } from "three/tsl";
import { MeshBasicNodeMaterial, WebGPURenderer, WGSLNodeBuilder, type MRTNode } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { RENDER_PROFILES } from "../../../lib/render-quality.js";
import { plannerSceneOutputs } from "../../scene/PlannerRenderPipeline.js";
import { createRoomMaterials, disposeRoomMaterials, GLASS_ALPHA_SCALE, RoomGradeUniforms, type RoomMaterials } from "../room-materials.js";
import { RoomPhotos } from "../room-photos.js";

// What a GPU would be handed, without one: three r186's own WGSL builder run on
// each material as the renderer runs it (Nodes._createNodeBuilder), for the
// targets the planner draws a room into. It proves the node graphs build and
// shows what they write; it does not prove a device compiles the result.

/** A renderer that never reaches a device: every optional feature absent. */
class DeviceLessRenderer extends WebGPURenderer {
  override hasFeature(): boolean {
    return false;
  }
}

/** A room surface's attributes, as room-buffers.ts lays them out. */
function surface(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(9), 3));
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(9), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(6), 2));
  geometry.setAttribute("aWallNormal", new BufferAttribute(new Float32Array(6), 2));
  return geometry;
}

interface Shader {
  readonly vertex: string;
  readonly fragment: string;
}

/** The WGSL three writes for `material`, drawn into `target` with the renderer's `outputs` set. */
function wgsl(material: MeshBasicNodeMaterial, target: RenderTarget | null, outputs: MRTNode | null): Shader {
  const renderer = new DeviceLessRenderer();
  renderer.setRenderTarget(target);
  renderer.setMRT(outputs);
  const scene = new Scene();
  const mesh = new Mesh(surface(), material);
  scene.add(mesh);
  const builder = new WGSLNodeBuilder(mesh, renderer);
  Object.assign(builder, { scene, material, camera: new PerspectiveCamera(), lightsNode: lights([]), environmentNode: null, fogNode: null, clippingContext: null });
  (builder.context as { material: unknown }).material = material;
  const build: unknown = Reflect.get(builder, "build");
  if (typeof build !== "function") throw new Error("three's node builder has no build()");
  Reflect.apply(build, builder, []);
  const vertex: unknown = Reflect.get(builder, "vertexShader");
  const fragment: unknown = Reflect.get(builder, "fragmentShader");
  if (typeof vertex !== "string" || typeof fragment !== "string") throw new Error("three's node builder wrote no shaders");
  return { vertex, fragment };
}

/** A target with one texture per name, as a pass or a snapshot makes one. */
function targetNamed(...names: string[]): RenderTarget {
  const target = new RenderTarget(4, 4, { count: names.length });
  names.forEach((name, index) => { target.textures[index]!.name = name; });
  return target;
}

/** The vertex stage's inputs: the attributes the shader reads from the geometry. */
function attributesRead(shader: Shader): string[] {
  const signature = /fn main\(([^{]*)\{/.exec(shader.vertex)?.[1] ?? "";
  return [...signature.matchAll(/@location\( \d+ \) (\w+) :/g)].map((match) => match[1] ?? "").sort();
}

/** How many colour attachments the fragment stage writes. */
function outputsWritten(shader: Shader): number {
  const struct = /struct Output\w+ \{([^}]*)\}/.exec(shader.fragment)?.[1] ?? "";
  return [...struct.matchAll(/@location/g)].length;
}

const KINDS = ["walls", "ceiling", "floor"] as const;

function room(): { readonly photos: RoomPhotos; readonly grade: RoomGradeUniforms; readonly materials: RoomMaterials } {
  const photos = new RoomPhotos();
  const grade = new RoomGradeUniforms();
  return { photos, grade, materials: createRoomMaterials(photos, grade) };
}

/** A texture node as these tests read it: the image it samples, and its bias. */
interface TextureRead {
  value: Texture;
  readonly biasNode: unknown;
}

function isTextureRead(node: object): node is TextureRead {
  return "isTextureNode" in node && node.isTextureNode === true && "value" in node && "biasNode" in node;
}

/** The texture nodes a material's colour reads, each once however often the colour uses it. */
function texturesRead(material: MeshBasicNodeMaterial): TextureRead[] {
  const found = new Set<TextureRead>();
  material.colorNode?.traverse((node) => { if (isTextureRead(node)) found.add(node); });
  return [...found];
}

describe("a surveyed room's materials", () => {
  it("are unlit, opaque and drawn front faces only, with no outputs of their own", () => {
    const { photos, materials } = room();
    for (const kind of KINDS) {
      const material = materials[kind];
      expect(material).toBeInstanceOf(MeshBasicNodeMaterial);
      expect(material.name).toBe(`surveyed-room-${kind}`);
      expect(material.side).toBe(FrontSide);
      expect(material.fog).toBe(false);
      expect(material.transparent).toBe(false);
      // The scene pass's own outputs are theirs, as for the Grand Hall's photographed walls.
      expect(material.mrtNode).toBeNull();
      expect(material.colorNode).not.toBeNull();
    }
    disposeRoomMaterials(materials);
    photos.dispose();
  });

  it("each read their own photograph, the walls and ceiling through a biased sample", () => {
    const { photos, materials } = room();
    const images = KINDS.map((kind) => new Set(texturesRead(materials[kind]).map((node) => node.value)));
    // One image a material, and a different one each.
    expect(images.map((set) => set.size)).toEqual([1, 1, 1]);
    expect(new Set(images.flatMap((set) => [...set])).size).toBe(3);
    const biased = (kind: (typeof KINDS)[number]): boolean => texturesRead(materials[kind]).some((node) => node.biasNode !== null);
    expect(biased("walls")).toBe(true);
    expect(biased("ceiling")).toBe(true);
    expect(biased("floor")).toBe(false);
    photos.dispose();
  });

  it("free their GPU programs when disposed", () => {
    const { photos, materials } = room();
    const freed: string[] = [];
    for (const kind of KINDS) materials[kind].addEventListener("dispose", () => { freed.push(kind); });
    disposeRoomMaterials(materials);
    expect(freed).toEqual(["walls", "ceiling", "floor"]);
    photos.dispose();
  });
});

describe("a surveyed room's grade", () => {
  it("starts as photographed, and sets only what it is given", () => {
    const grade = new RoomGradeUniforms();
    expect(grade.exposure.value).toBe(1);
    expect(grade.tint.value.toArray()).toEqual([1, 1, 1]);
    expect(grade.glow.value).toBe(1);
    const tint = grade.tint.value;
    grade.set({ exposure: 0.6 });
    expect(grade.exposure.value).toBe(0.6);
    expect(grade.glow.value).toBe(1);
    grade.set({ tint: new Color(1, 0.5, 0.25), glow: 2.5 });
    expect(grade.exposure.value).toBe(0.6);
    expect(grade.glow.value).toBe(2.5);
    // The uniform's own colour is changed in place: the materials keep reading it.
    expect(grade.tint.value).toBe(tint);
    expect(grade.tint.value.toArray()).toEqual([1, 0.5, 0.25]);
  });

  it("reads the atlas's alpha as the tools write it: 255 less 127 for glass", () => {
    const alpha = (glass: number): number => (255 - 127 * glass) / 255;
    expect((1 - alpha(1)) * GLASS_ALPHA_SCALE).toBeCloseTo(1, 12);
    expect((1 - alpha(0.5)) * GLASS_ALPHA_SCALE).toBeCloseTo(0.5, 12);
    expect((1 - alpha(0)) * GLASS_ALPHA_SCALE).toBe(0);
  });
});

describe("the shaders three writes for a surveyed room (no device)", () => {
  const canvas = { target: null, outputs: null };
  // The planner's scene pass on a desktop: colour, normals for occlusion, motion for the temporal resolve.
  const desktopPass = { target: targetNamed("output", "normal", "velocity"), outputs: plannerSceneOutputs(RENDER_PROFILES.desktop) };
  // On a tablet: colour and normals.
  const tabletPass = { target: targetNamed("output", "normal"), outputs: plannerSceneOutputs(RENDER_PROFILES.tablet) };
  // A plan or current-view snapshot: one unnamed texture, the renderer's outputs cleared.
  const snapshot = { target: targetNamed(""), outputs: null };

  it("draw each surface plainly to the canvas: one colour, from the photograph and the grade", () => {
    const { photos, materials } = room();
    const walls = wgsl(materials.walls, canvas.target, canvas.outputs);
    expect(outputsWritten(walls)).toBe(1);
    expect(attributesRead(walls)).toEqual(["aWallNormal", "position", "uv"]);
    // One biased sample of the atlas, its level from the face's direction.
    expect(walls.fragment.match(/textureSample\w*\(/g)).toEqual(["textureSampleBias("]);
    expect(walls.fragment).toContain("dpdx( v_positionWorld )");
    // Glass, from the atlas's alpha, takes the glow in place of the room's exposure and tint.
    expect(walls.fragment).toContain(`( 1.0 - nodeVar1.w ) * ${String(GLASS_ALPHA_SCALE)}`);

    const ceiling = wgsl(materials.ceiling, canvas.target, canvas.outputs);
    expect(outputsWritten(ceiling)).toBe(1);
    expect(attributesRead(ceiling)).toEqual(["position", "uv"]);
    expect(ceiling.fragment.match(/textureSample\w*\(/g)).toEqual(["textureSampleBias("]);

    const floor = wgsl(materials.floor, canvas.target, canvas.outputs);
    expect(outputsWritten(floor)).toBe(1);
    expect(attributesRead(floor)).toEqual(["position", "uv"]);
    expect(floor.fragment.match(/textureSample\w*\(/g)).toEqual(["textureSample("]);
    photos.dispose();
  });

  it("write the planner's scene pass in full: colour, the view normal with an occlusion weight of 1, and motion", () => {
    expect(desktopPass.outputs).not.toBeNull();
    const { photos, materials } = room();
    for (const kind of KINDS) {
      const shader = wgsl(materials[kind], desktopPass.target, desktopPass.outputs);
      expect(outputsWritten(shader), kind).toBe(3);
      // The pass's normal output, from the geometry's own normals: they must be there.
      expect(attributesRead(shader), kind).toContain("normal");
      expect(shader.fragment, kind).toContain("( ( normalView * vec3<f32>( 0.5 ) ) + vec3<f32>( 0.5 ) ), 1.0 )");
      expect(shader.fragment, kind).toMatch(/output\.m0 = /);
      expect(shader.fragment, kind).toMatch(/output\.m1 = /);
      expect(shader.fragment, kind).toMatch(/output\.m2 = /);
      // Colour and normal only where the pass keeps no motion (a tablet).
      expect(outputsWritten(wgsl(materials[kind], tabletPass.target, tabletPass.outputs)), kind).toBe(2);
    }
    photos.dispose();
  });

  it("write their colour alone into a snapshot's unnamed target", () => {
    const { photos, materials } = room();
    for (const kind of KINDS) {
      const shader = wgsl(materials[kind], snapshot.target, snapshot.outputs);
      expect(outputsWritten(shader), kind).toBe(1);
      expect(shader.fragment, kind).toContain("output.color = ");
    }
    photos.dispose();
  });

  it("are the same text for every room, so rooms share their pipelines", () => {
    const one = room();
    const other = room();
    other.grade.set({ exposure: 0.4, tint: new Color(1, 0.8, 0.6), glow: 3 });
    for (const { target, outputs } of [canvas, desktopPass, tabletPass, snapshot]) {
      for (const kind of KINDS) {
        expect(wgsl(other.materials[kind], target, outputs), kind).toEqual(wgsl(one.materials[kind], target, outputs));
      }
    }
    one.photos.dispose();
    other.photos.dispose();
  });

  it("do not change when a photograph replaces its placeholder, which a nearest-filtered placeholder would break", () => {
    const { photos, materials } = room();
    const before = wgsl(materials.walls, desktopPass.target, desktopPass.outputs);
    expect(before.fragment).toContain("nodeUniform0_sampler");
    const [atlas] = texturesRead(materials.walls);
    if (atlas === undefined) throw new Error("the walls read no texture");
    // As a decoded photograph is: filtered, with mips.
    const placeholder = atlas.value;
    const photograph = placeholder.clone();
    photograph.generateMipmaps = true;
    atlas.value = photograph;
    expect(wgsl(materials.walls, desktopPass.target, desktopPass.outputs)).toEqual(before);
    // The trap hall-photos.ts records: three binds a nearest-filtered texture without a sampler.
    const unfiltered = placeholder.clone();
    unfiltered.magFilter = NearestFilter;
    unfiltered.minFilter = NearestFilter;
    atlas.value = unfiltered;
    expect(wgsl(materials.walls, desktopPass.target, desktopPass.outputs).fragment).not.toEqual(before.fragment);
    photos.dispose();
  });
});
