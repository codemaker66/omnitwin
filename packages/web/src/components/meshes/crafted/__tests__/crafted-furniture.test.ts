import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Box3, type BufferGeometry, type Material, Mesh, type Object3D, Texture } from "three";
import { describe, expect, it } from "vitest";
import { CANONICAL_ASSETS, type CanonicalAsset } from "@omnitwin/types";
import {
  CRAFTED_FURNITURE_SLUGS,
  craftedFurniturePreviewUrl,
  isCraftedFurnitureSlug,
  type CraftedFurnitureSlug,
} from "../../../../lib/crafted-furniture.js";
import { disposeVariant, harvestVariant } from "../../../editor/InstancedFurnitureLayer.js";
import { lathe } from "../crafted-geometry.js";
import { clearCraftedGeometryCache, createCraftedFurniture } from "../crafted-registry.js";

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

/** Chairs are placed by the hundred, so they get the tightest budget. */
function triangleBudget(slug: CraftedFurnitureSlug): number {
  return slug === "burgess-turini-18-3" || slug === "checked-banquet-chair" ? 10_000 : 30_000;
}

describe("crafted furniture", () => {
  it("draws every supplied model's catalogue item and nothing else", () => {
    const supplied = CANONICAL_ASSETS.filter((asset) => asset.meshUrl !== undefined).map((asset) => asset.slug);
    expect([...CRAFTED_FURNITURE_SLUGS].sort()).toEqual([...supplied].sort());
    expect(isCraftedFurnitureSlug("round-table-6ft")).toBe(false);
    expect(isCraftedFurnitureSlug("burgess-turini-18-3")).toBe(true);
  });

  it.each(CRAFTED_FURNITURE_SLUGS)("builds %s as clean, mergeable geometry inside its footprint", (slug) => {
    const asset = assetFor(slug);
    const model = build(slug);
    try {
      const meshes = meshesOf(model.object);
      expect(meshes.length).toBeGreaterThan(0);
      let triangles = 0;
      for (const mesh of meshes) {
        const geometry = mesh.geometry;
        // Exactly position, normal and uv, indexed: what the instancing merge needs.
        expect(Object.keys(geometry.attributes).sort(), mesh.name).toEqual(["normal", "position", "uv"]);
        expect(geometry.index, mesh.name).not.toBeNull();
        for (const name of ["position", "normal", "uv"] as const) {
          const values = geometry.getAttribute(name).array;
          expect(Array.from(values).every(Number.isFinite), `${mesh.name} ${name}`).toBe(true);
        }
        triangles += trianglesOf(geometry);
        for (const material of materialsOf(mesh)) {
          expect(material.name, mesh.name).toMatch(/^crafted:/u);
          for (const value of Object.values(material)) {
            if (value instanceof Texture) expect(value.name, `${material.name} map`).toMatch(/^crafted:/u);
          }
        }
      }
      expect(triangles).toBeLessThanOrEqual(triangleBudget(slug));

      const box = new Box3().setFromObject(model.object);
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
    // Signed volume of a closed surface: positive when its faces point out.
    const volume = (geometry: ReturnType<typeof lathe>): number => {
      const position = geometry.getAttribute("position");
      const index = geometry.index;
      if (index === null) throw new Error("lathe should be indexed");
      let total = 0;
      for (let i = 0; i < index.count; i += 3) {
        const [a, b, c] = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
        total += (position.getX(a) * (position.getY(b) * position.getZ(c) - position.getZ(b) * position.getY(c))
          - position.getY(a) * (position.getX(b) * position.getZ(c) - position.getZ(b) * position.getX(c))
          + position.getZ(a) * (position.getX(b) * position.getY(c) - position.getY(b) * position.getX(c))) / 6;
      }
      return total;
    };
    const climbing: [number, number][] = [[0, 0], [0.05, 0], [0.05, 0.4], [0, 0.4]];
    const falling = [...climbing].reverse();
    const cylinder = Math.PI * 0.05 * 0.05 * 0.4;
    expect(volume(lathe(climbing, 32))).toBeGreaterThan(cylinder * 0.95);
    expect(volume(lathe(falling, 32))).toBeGreaterThan(cylinder * 0.95);
  });

  it("refuses slugs it does not draw and sizes it cannot", () => {
    expect(() => createCraftedFurniture({ slug: "round-table-6ft", width: 1.83, depth: 1.83, height: 0.76 })).toThrow(/No crafted model/u);
    expect(() => createCraftedFurniture({ slug: "trestle-6ft", width: 0, depth: 0.76, height: 0.74 })).toThrow(/positive dimensions/u);
    expect(() => createCraftedFurniture({ slug: "trestle-6ft", width: Number.NaN, depth: 0.76, height: 0.74 })).toThrow(/positive dimensions/u);
  });

  it.each(CRAFTED_FURNITURE_SLUGS)("ships a rendered preview for %s", (slug) => {
    const url = craftedFurniturePreviewUrl(slug);
    expect(url).toBe(`/models/furniture/${slug}/crafted-v2/preview.webp`);
    const file = resolve(import.meta.dirname, "../../../../../public", `.${url ?? ""}`);
    expect(existsSync(file), file).toBe(true);
  });
});
