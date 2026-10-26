import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Box3, type BufferGeometry, Layers, type Material, Mesh, type Object3D, Texture } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CANONICAL_ASSETS, type CanonicalAsset } from "@omnitwin/types";
import {
  CRAFTED_FURNITURE_SLUGS,
  CRAFTED_PREVIEW_VERSION,
  craftedFurniturePreviewUrl,
  isCraftedFurnitureSlug,
  type CraftedFurnitureSlug,
} from "../../../../lib/crafted-furniture.js";
import { materialAppearanceSignature } from "../../../../lib/furniture-instancing.js";
import { disposeVariant, harvestVariant } from "../../../editor/InstancedFurnitureLayer.js";
import { HALL_SUN_CASTER_LAYER } from "../../../grand-hall/hall-sun.js";
import { aoBox, aoRod, occlude } from "../crafted-ao.js";
import { craftedDetail, setCraftedDetailLevel } from "../crafted-detail.js";
import { lathe, roundedBox } from "../crafted-geometry.js";
import { craftedMaterial } from "../crafted-materials.js";
import { instantiateCraftedModel, mergeCraftedParts } from "../crafted-model.js";
import { clearCraftedGeometryCache, createCraftedFurniture } from "../crafted-registry.js";
import { casterGeometry } from "../crafted-shadow.js";
import { damaskFigure, damaskFigureField } from "../crafted-textures.js";

function assetFor(slug: string): CanonicalAsset {
  const asset = CANONICAL_ASSETS.find((candidate) => candidate.slug === slug);
  if (asset === undefined) throw new Error(`No catalogue asset for ${slug}`);
  return asset;
}

function build(slug: CraftedFurnitureSlug): ReturnType<typeof createCraftedFurniture> {
  const asset = assetFor(slug);
  return createCraftedFurniture({ slug, width: asset.widthM, depth: asset.depthM, height: asset.heightM });
}

function meshesOf(root: Object3D): Mesh[] {
  const meshes: Mesh[] = [];
  root.traverse((object) => { if (object instanceof Mesh) meshes.push(object); });
  return meshes;
}

function materialsOf(mesh: Mesh): Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function trianglesOf(geometry: BufferGeometry): number {
  return (geometry.index?.count ?? geometry.getAttribute("position").count) / 3;
}

function isCaster(mesh: Mesh): boolean {
  return materialsOf(mesh).some((material) => material.name === "crafted:shadow-caster" || material.name === "crafted:shadow-sheet");
}

/** Signed volume of a closed indexed surface: positive when its faces point out. */
function signedVolume(geometry: BufferGeometry): number {
  const position = geometry.getAttribute("position");
  const index = geometry.index;
  if (index === null) throw new Error("expected an indexed surface");
  let total = 0;
  for (let i = 0; i < index.count; i += 3) {
    const [a, b, c] = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    total += (position.getX(a) * (position.getY(b) * position.getZ(c) - position.getZ(b) * position.getY(c))
      - position.getY(a) * (position.getX(b) * position.getZ(c) - position.getZ(b) * position.getX(c))
      + position.getZ(a) * (position.getX(b) * position.getY(c) - position.getY(b) * position.getX(c))) / 6;
  }
  return total;
}

/**
 * How far past its catalogue footprint each piece may draw, in metres. Cloth
 * crests, corner cascades and the ceremony table's falls stand a little
 * proud of the table they dress; everything else stays inside.
 */
const DRAPE_ALLOWANCE: Partial<Record<CraftedFurnitureSlug, number>> = {
  "round-table-6ft-white": 0.02,
  "round-table-6ft-black": 0.02,
  "cake-cutting-table": 0.03,
  "trestle-4ft-white": 0.042,
  "trestle-4ft-black": 0.042,
  "trestle-6ft-white": 0.042,
  "trestle-6ft-black": 0.042,
  "ceremony-table": 0.055,
  "round-cafe-table-white": 0.035,
  "square-cafe-table-white": 0.045,
  // The stage skirt's pleats stand just proud of the deck.
  "platform": 0.008,
};

const CHAIRS: ReadonlySet<string> = new Set(["chiavari-chair", "burgess-turini-18-3", "checked-banquet-chair", "gallery-chair-red-gold", "pink-chair", "banquet-chair"]);

/** Chairs are placed by the hundred, so they get the tightest budget (what is seen). */
function triangleBudget(slug: CraftedFurnitureSlug): number {
  return CHAIRS.has(slug) ? 10_000 : 30_000;
}

/** What a piece may cast the sun's shadow with: a few hundred triangles a chair, a few thousand a draped table. */
function casterBudget(slug: CraftedFurnitureSlug): number {
  return CHAIRS.has(slug) ? 600 : 3_000;
}

afterEach(() => {
  setCraftedDetailLevel("full");
  clearCraftedGeometryCache();
});

describe("crafted furniture", () => {
  it("draws every supplied model's catalogue item, and only catalogue items", () => {
    const supplied = CANONICAL_ASSETS.filter((asset) => asset.meshUrl !== undefined).map((asset) => asset.slug);
    for (const slug of supplied) expect(isCraftedFurnitureSlug(slug), slug).toBe(true);
    const catalogue = new Set(CANONICAL_ASSETS.map((asset) => asset.slug));
    for (const slug of CRAFTED_FURNITURE_SLUGS) expect(catalogue.has(slug), slug).toBe(true);
    expect(isCraftedFurnitureSlug("not-a-catalogue-piece")).toBe(false);
    expect(isCraftedFurnitureSlug("burgess-turini-18-3")).toBe(true);
  });

  it.each(CRAFTED_FURNITURE_SLUGS)("builds %s as clean, mergeable geometry inside its footprint", (slug) => {
    const asset = assetFor(slug);
    const model = build(slug);
    try {
      const meshes = meshesOf(model.object);
      expect(meshes.length).toBeGreaterThan(0);
      let triangles = 0;
      let casterTriangles = 0;
      for (const mesh of meshes) {
        const geometry = mesh.geometry;
        // Exactly position, normal, uv and the baked occlusion, indexed: what the instancing merge needs.
        expect(Object.keys(geometry.attributes).sort(), mesh.name).toEqual(["ao", "normal", "position", "uv"]);
        expect(geometry.index, mesh.name).not.toBeNull();
        for (const name of ["position", "normal", "uv", "ao"] as const) {
          const values = geometry.getAttribute(name).array;
          expect(Array.from(values).every(Number.isFinite), `${mesh.name} ${name}`).toBe(true);
        }
        const ao = Array.from(geometry.getAttribute("ao").array);
        expect(Math.min(...ao), `${mesh.name} ao`).toBeGreaterThan(0.1);
        expect(Math.max(...ao), `${mesh.name} ao`).toBeLessThanOrEqual(1);
        if (isCaster(mesh)) casterTriangles += trianglesOf(geometry);
        else triangles += trianglesOf(geometry);
        for (const material of materialsOf(mesh)) {
          expect(material.name, mesh.name).toMatch(/^crafted:/u);
          for (const value of Object.values(material)) {
            if (value instanceof Texture) expect(value.name, `${material.name} map`).toMatch(/^crafted:/u);
          }
        }
      }
      expect(triangles).toBeLessThanOrEqual(triangleBudget(slug));
      expect(casterTriangles).toBeLessThanOrEqual(casterBudget(slug));

      // The piece's extent, without the shade its feet leave on the floor
      // (which reaches a few centimetres past them, as a shade does).
      const box = new Box3();
      for (const mesh of meshes) {
        if (mesh.name.endsWith(":contact")) {
          const shade = new Box3().setFromObject(mesh);
          expect(shade.min.x).toBeGreaterThanOrEqual(-asset.widthM / 2 - 0.05);
          expect(shade.max.x).toBeLessThanOrEqual(asset.widthM / 2 + 0.05);
          expect(shade.min.z).toBeGreaterThanOrEqual(-asset.depthM / 2 - 0.05);
          expect(shade.max.z).toBeLessThanOrEqual(asset.depthM / 2 + 0.05);
          continue;
        }
        box.expandByObject(mesh);
      }
      const allowance = (DRAPE_ALLOWANCE[slug] ?? 0) + 0.003;
      expect(box.min.x).toBeGreaterThanOrEqual(-asset.widthM / 2 - allowance);
      expect(box.max.x).toBeLessThanOrEqual(asset.widthM / 2 + allowance);
      expect(box.min.z).toBeGreaterThanOrEqual(-asset.depthM / 2 - allowance);
      expect(box.max.z).toBeLessThanOrEqual(asset.depthM / 2 + allowance);
      expect(box.min.y).toBeGreaterThanOrEqual(-0.001);
      expect(box.max.y).toBeLessThanOrEqual(asset.heightM + 0.005);
      // Each piece stands on the floor and reaches its catalogue height.
      expect(box.min.y).toBeLessThan(0.012);
      expect(box.max.y).toBeGreaterThan(asset.heightM - 0.035);
    } finally {
      model.dispose();
    }
  });

  it.each(["round-table-6ft-white", "round-table-6ft-black"] as const)("keeps %s's cloth clear of the chairs pulled up to it", (slug) => {
    const asset = assetFor(slug);
    const model = build(slug);
    try {
      let reach = 0;
      for (const mesh of meshesOf(model.object)) {
        const position = mesh.geometry.getAttribute("position");
        for (let index = 0; index < position.count; index += 1) {
          reach = Math.max(reach, Math.hypot(position.getX(index), position.getZ(index)));
        }
      }
      // The chair ring (lib/table-group.ts) seats each chair's front 5 cm
      // off the table's edge.
      expect(reach).toBeLessThan(asset.widthM / 2 + 0.035);
    } finally {
      model.dispose();
    }
  });

  it.each(CRAFTED_FURNITURE_SLUGS)("batches %s through the instancing harvest", (slug) => {
    const model = build(slug);
    try {
      const variant = harvestVariant(model.object);
      try {
        expect(variant.groups.length).toBeGreaterThan(0);
        // One merged group per crafted material: nothing falls out of the batch.
        const materials = new Set(meshesOf(model.object).flatMap((mesh) => materialsOf(mesh).map((material) => material.name)));
        expect(variant.groups.length).toBe(materials.size);
        // The batch casts the sun's shadow exactly as the model does.
        for (const group of variant.groups) {
          const shadows = variant.shadowsByKey.get(group.materialKey);
          const source = meshesOf(model.object).find((mesh) => materialAppearanceSignature(mesh.material as Material) === group.materialKey);
          expect(shadows?.castShadow, group.materialKey).toBe(source?.castShadow);
          // and on the same layers: a caster's batch stays out of the view.
          expect(shadows?.layers, group.materialKey).toBe(source?.layers.mask);
        }
      } finally {
        disposeVariant(variant);
      }
    } finally {
      model.dispose();
    }
  });

  it("draws the same piece the same way every time", () => {
    const positions = (): number[][] => {
      clearCraftedGeometryCache();
      const model = build("trestle-6ft-white");
      try {
        return meshesOf(model.object).map((mesh) => Array.from(mesh.geometry.getAttribute("position").array));
      } finally {
        model.dispose();
      }
    };
    expect(positions()).toEqual(positions());
  });

  it("shares one geometry between copies of a piece, each with its own materials", () => {
    clearCraftedGeometryCache();
    const first = build("burgess-turini-18-3");
    const second = build("burgess-turini-18-3");
    try {
      const a = meshesOf(first.object);
      const b = meshesOf(second.object);
      expect(a.map((mesh) => mesh.geometry)).toEqual(b.map((mesh) => mesh.geometry));
      a.forEach((mesh, index) => {
        expect(mesh.geometry).toBe(b[index]?.geometry);
        expect(mesh.material).not.toBe(b[index]?.material);
      });
      // Releasing one copy keeps the geometry the other is drawing.
      let disposed = 0;
      for (const mesh of b) mesh.geometry.addEventListener("dispose", () => { disposed += 1; });
      first.dispose();
      expect(disposed).toBe(0);
    } finally {
      second.dispose();
    }
  });

  it("faces a lathed part outward whichever way its profile is written", () => {
    const climbing: [number, number][] = [[0, 0], [0.05, 0], [0.05, 0.4], [0, 0.4]];
    const falling = [...climbing].reverse();
    const cylinder = Math.PI * 0.05 * 0.05 * 0.4;
    expect(signedVolume(lathe(climbing, 32))).toBeGreaterThan(cylinder * 0.95);
    expect(signedVolume(lathe(falling, 32))).toBeGreaterThan(cylinder * 0.95);
  });

  it("refuses slugs it does not draw and sizes it cannot", () => {
    expect(() => createCraftedFurniture({ slug: "not-a-catalogue-piece", width: 0.5, depth: 0.5, height: 0.01 })).toThrow(/No crafted model/u);
    expect(() => createCraftedFurniture({ slug: "trestle-6ft", width: 0, depth: 0.76, height: 0.74 })).toThrow(/positive dimensions/u);
    expect(() => createCraftedFurniture({ slug: "trestle-6ft", width: Number.NaN, depth: 0.76, height: 0.74 })).toThrow(/positive dimensions/u);
  });

  it.each(CRAFTED_FURNITURE_SLUGS)("ships a rendered preview for %s", (slug) => {
    const url = craftedFurniturePreviewUrl(slug);
    expect(url).toBe(`/models/furniture/${slug}/${CRAFTED_PREVIEW_VERSION}/preview.webp`);
    const file = resolve(import.meta.dirname, "../../../../../public", `.${url ?? ""}`);
    expect(existsSync(file), file).toBe(true);
  });
});

describe("crafted shadows", () => {
  it("casts a piece's sun shadow with its caster alone, which the view never draws", () => {
    const model = build("chiavari-chair");
    try {
      const meshes = meshesOf(model.object);
      const casters = meshes.filter(isCaster);
      expect(casters).toHaveLength(1);
      const view = new Layers();
      const sun = new Layers();
      sun.enable(HALL_SUN_CASTER_LAYER);
      for (const mesh of meshes) {
        const shade = mesh.name.endsWith(":contact");
        expect(mesh.castShadow, mesh.name).toBe(isCaster(mesh));
        expect(mesh.receiveShadow, mesh.name).toBe(!isCaster(mesh) && !shade);
        // The caster lives on the stand-ins' layer: the sun's shadow camera
        // sees it, the view's camera (and its picking) never does.
        expect(mesh.layers.test(view), mesh.name).toBe(!isCaster(mesh));
        expect(mesh.layers.test(sun), mesh.name).toBe(true);
      }
      const material = materialsOf(casters[0] as Mesh)[0] as Material & { maskNode: { isNode?: boolean } | null; maskShadowNode: { isNode?: boolean } | null };
      // Discarded in the view, kept in the shadow pass (three reads maskShadowNode first there).
      expect(material.maskNode?.isNode).toBe(true);
      expect(material.maskShadowNode?.isNode).toBe(true);
      expect(material.colorWrite).toBe(false);
      expect(material.depthWrite).toBe(false);
    } finally {
      model.dispose();
    }
  });

  it.each(["chiavari-chair", "burgess-turini-18-3", "checked-banquet-chair"] as const)("grounds each of %s's feet with a spot of shade under it", (slug) => {
    const model = build(slug);
    try {
      const shade = meshesOf(model.object).find((mesh) => mesh.name.endsWith(":contact"));
      if (shade === undefined) throw new Error("expected the feet's shade");
      // Four quads, flat on the floor, facing up, never casting.
      expect(trianglesOf(shade.geometry)).toBe(8);
      const position = shade.geometry.getAttribute("position");
      const normal = shade.geometry.getAttribute("normal");
      for (let i = 0; i < position.count; i += 1) {
        expect(position.getY(i)).toBeLessThan(0.003);
        expect(normal.getY(i)).toBeCloseTo(1, 5);
      }
      expect(shade.castShadow).toBe(false);
      const material = materialsOf(shade)[0];
      expect(material?.transparent).toBe(true);
      expect(material?.depthWrite).toBe(false);
    } finally {
      model.dispose();
    }
  });

  it("keeps a placement ghost out of the sun's map, and puts the placed piece back in", () => {
    const model = build("chiavari-chair");
    try {
      const caster = meshesOf(model.object).find(isCaster);
      if (caster === undefined) throw new Error("expected a caster");
      const before = materialsOf(caster)[0];
      model.setAppearance(0.5);
      expect(caster.castShadow).toBe(false);
      model.setAppearance(1, "#ff0000");
      expect(caster.castShadow).toBe(false);
      model.setAppearance(1);
      expect(caster.castShadow).toBe(true);
      // The caster's material is never faded or tinted, so a ghost compiles nothing new for it.
      expect(materialsOf(caster)[0]).toBe(before);
      expect(before?.transparent).toBe(false);
    } finally {
      model.dispose();
    }
  });

  it.each(CRAFTED_FURNITURE_SLUGS)("casts %s's sun shadow with a caster of its own", (slug) => {
    const model = build(slug);
    try {
      expect(meshesOf(model.object).some(isCaster)).toBe(true);
    } finally {
      model.dispose();
    }
  });

  it("keeps a piece without a caster casting from what is seen", () => {
    const parts = mergeCraftedParts([{ material: "plastic-white", geometry: roundedBox([0.5, 0.5, 0.5], 0.01, [0, 0.25, 0]) }]);
    const model = instantiateCraftedModel("no-caster", parts);
    try {
      for (const mesh of meshesOf(model.object)) expect(mesh.castShadow, mesh.name).toBe(true);
    } finally {
      model.dispose();
      for (const geometry of parts.values()) geometry.dispose();
    }
  });

  it("builds casters as closed solids facing out, set in from the boxes they stand for", () => {
    const size = 0.2;
    const inset = 0.005;
    const expected = (size - 2 * inset) ** 3;
    expect(signedVolume(casterGeometry([aoBox([size, size, size], [0, 0.5, 0])], { inset }))).toBeCloseTo(expected, 6);
    // A rod's axes are built right-handed either way it runs.
    const rod = casterGeometry([aoRod([0, 0, 0], [0, 0, 0.4], 0.03)], { inset: 0 });
    expect(signedVolume(rod)).toBeCloseTo(0.4 * 0.03 * 0.03, 6);
    // A left-handed box still faces out.
    const mirrored = casterGeometry([{ centre: [0, 0, 0], axes: [[0.1, 0, 0], [0, 0, 0.1], [0, 0.1, 0]] }], { inset: 0 });
    expect(signedVolume(mirrored)).toBeCloseTo(0.008, 6);
    // Thin boxes are thickened to the least the shadow map can hold.
    const thin = casterGeometry([aoBox([0.2, 0.002, 0.2], [0, 0, 0])], { inset: 0, minimum: 0.01 });
    expect(signedVolume(thin)).toBeCloseTo(0.2 * 0.2 * 0.01, 6);
  });
});

describe("crafted occlusion", () => {
  it("darkens a face by the box in front of it, exactly as Lambert's formula gives", () => {
    // A point facing up under the centre of a 2 x 2 square at height 1: the
    // square's form factor is 0.5527 (the classic coaxial square result).
    const probe = roundedBox([0.02, 0.02, 0.02], 0.001);
    const position = probe.getAttribute("position");
    const normal = probe.getAttribute("normal");
    for (let i = 0; i < position.count; i += 1) {
      position.setXYZ(i, 0, 0, 0);
      normal.setXYZ(i, 0, 1, 0);
    }
    occlude(probe, { boxes: [aoBox([2, 0.001, 2], [0, 1, 0])], floorValue: 0 });
    expect(1 - probe.getAttribute("ao").getX(0)).toBeCloseTo(0.5527, 2);
  });

  it("bakes the Chiavari's creases: dark under the seat and at the feet, open on the pad", () => {
    const model = build("chiavari-chair");
    try {
      const meshes = meshesOf(model.object);
      const gilt = meshes.find((mesh) => mesh.name.endsWith(":gilt"));
      const pad = meshes.find((mesh) => mesh.name.endsWith(":pad-ivory"));
      if (gilt === undefined || pad === undefined) throw new Error("expected gilt and pad meshes");
      const average = (mesh: Mesh, keep: (y: number, ny: number) => boolean): number => {
        const position = mesh.geometry.getAttribute("position");
        const normal = mesh.geometry.getAttribute("normal");
        const ao = mesh.geometry.getAttribute("ao");
        let sum = 0;
        let count = 0;
        for (let i = 0; i < position.count; i += 1) {
          if (!keep(position.getY(i), normal.getY(i))) continue;
          sum += ao.getX(i);
          count += 1;
        }
        if (count === 0) throw new Error("no vertices selected");
        return sum / count;
      };
      const feet = average(gilt, (y) => y < 0.03);
      const midLeg = average(gilt, (y) => y > 0.15 && y < 0.2);
      const underSeat = average(gilt, (y, ny) => y > 0.36 && y < 0.4 && ny < -0.8);
      const padTop = average(pad, (y, ny) => y > 0.46 && ny > 0.9);
      expect(feet).toBeLessThan(midLeg);
      expect(underSeat).toBeLessThan(0.75);
      expect(padTop).toBeGreaterThan(0.85);
    } finally {
      model.dispose();
    }
  });
});

describe("crafted detail", () => {
  it.each([
    ["Google SwiftShader", "lean"],
    ["ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)", "lean"],
    ["llvmpipe (LLVM 17.0.6, 256 bits)", "lean"],
    ["ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0, D3D11)", "full"],
  ] as const)("reads the browser's rasteriser once: %s draws %s", async (gpu, level) => {
    const lost = vi.fn();
    const probe = {
      getExtension: (name: string) => (name === "WEBGL_debug_renderer_info" ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : name === "WEBGL_lose_context" ? { loseContext: lost } : null),
      getParameter: (parameter: number) => (parameter === 0x9246 ? gpu : null),
    };
    const create = document.createElement.bind(document);
    // Only its presence is read: WebGL 2 exists in this browser.
    vi.stubGlobal("WebGL2RenderingContext", {});
    const spy = vi.spyOn(document, "createElement").mockImplementation((tag: string, options?: ElementCreationOptions) => {
      const element = create(tag, options);
      if (tag === "canvas") Object.defineProperty(element, "getContext", { value: () => probe });
      return element;
    });
    try {
      vi.resetModules();
      const fresh = await import("../crafted-detail.js");
      expect(fresh.craftedDetail().level).toBe(level);
      // The probe's context is released at once, and asked only once a page.
      expect(lost).toHaveBeenCalledTimes(1);
      fresh.craftedDetail();
      expect(lost).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("draws a phone's chairs leaner, with the same footprint and a caster still", () => {
    const measure = (level: "full" | "lean"): { seen: number; caster: number; width: number } => {
      setCraftedDetailLevel(level);
      clearCraftedGeometryCache();
      const model = build("chiavari-chair");
      try {
        let seen = 0;
        let caster = 0;
        for (const mesh of meshesOf(model.object)) {
          if (isCaster(mesh)) caster += trianglesOf(mesh.geometry);
          else seen += trianglesOf(mesh.geometry);
        }
        const box = new Box3().setFromObject(model.object);
        return { seen, caster, width: box.max.x - box.min.x };
      } finally {
        model.dispose();
      }
    };
    const full = measure("full");
    const lean = measure("lean");
    expect(craftedDetail().level).toBe("lean");
    expect(lean.seen).toBeLessThan(full.seen * 0.75);
    expect(lean.caster).toBeGreaterThan(0);
    expect(Math.abs(lean.width - full.width)).toBeLessThan(0.004);
  });

  it("keeps the palette's node materials in separate batches", () => {
    const gilt = materialAppearanceSignature(craftedMaterial("gilt"));
    expect(materialAppearanceSignature(craftedMaterial("gilt"))).toBe(gilt);
    expect(materialAppearanceSignature(craftedMaterial("pad-ivory"))).not.toBe(gilt);
    expect(materialAppearanceSignature(craftedMaterial("shadow-caster"))).not.toBe(gilt);
  });
});

describe("crafted textures", () => {
  it("paints the damask's figure from a quarter of its tile, exactly as evaluated everywhere", () => {
    // Mirrored about the vertical and repeated on the half drop: the copy of
    // one quarter must match the figure itself at every pixel.
    const size = 64;
    const field = damaskFigureField(size);
    let worst = 0;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const direct = damaskFigure((x + 0.5) / size, (y + 0.5) / size, 1 / size);
        worst = Math.max(worst, Math.abs((field[y * size + x] ?? Number.NaN) - direct));
      }
    }
    expect(worst).toBeLessThan(1e-6);
    // And the figure is there: some satin, some ground.
    expect(Math.max(...field)).toBeGreaterThan(0.9);
    expect(Math.min(...field)).toBeLessThan(0.1);
  });

  it("skips only the damask's ground: its shapes' bounds clip no figure at the size it is painted", () => {
    const size = 512;
    let worst = 0;
    for (let y = 0; y < size / 2; y += 1) {
      for (let x = 0; x < size / 2; x += 1) {
        const u = (x + 0.5) / size;
        const v = (y + 0.5) / size;
        worst = Math.max(worst, Math.abs(damaskFigure(u, v, 1 / size) - damaskFigure(u, v, 1 / size, false)));
      }
    }
    expect(worst).toBe(0);
  });
});
