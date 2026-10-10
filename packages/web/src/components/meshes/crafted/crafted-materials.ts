import {
  Color,
  FrontSide,
  type Material,
  MeshPhysicalMaterial,
  type MeshPhysicalMaterialParameters,
  MeshStandardMaterial,
  type MeshStandardMaterialParameters,
  Vector2,
} from "three";
import { noClipPlanes } from "../../SectionPlane.js";
import { craftedTexture } from "./crafted-textures.js";

// ---------------------------------------------------------------------------
// Crafted furniture materials
//
// The palette follows the furniture Blake supplied: mahogany-lacquered banquet
// chair frames with coral velvet or the coral check, white and black linen,
// stretch spandex, polished mahogany with brass for the bar and servery, black
// stage felt, powder-coated steel, plywood and white plastic trestle tops, and
// the black folding divider. Each call returns a fresh material owned by the
// model that asked for it; the maps are shared (crafted-textures.ts). Every
// material is excluded from the section plane, like the rest of the furniture.
// ---------------------------------------------------------------------------

export type CraftedMaterialId =
  | "linen-white"
  | "linen-black"
  | "velvet-coral"
  | "check-coral"
  | "frame-lacquer"
  | "glide"
  | "mahogany"
  | "mahogany-top"
  | "mahogany-dark"
  | "brass"
  | "brass-grille"
  | "steel-black"
  | "steel-grey"
  | "chrome"
  | "plastic-white"
  | "plywood"
  | "stage-felt"
  | "stage-skirt"
  | "spandex-black"
  | "spandex-white"
  | "divider-fabric"
  | "rubber"
  | "stainless";

function finish<T extends Material>(id: CraftedMaterialId, material: T): T {
  material.name = `crafted:${id}`;
  material.clippingPlanes = noClipPlanes;
  material.side = FrontSide;
  return material;
}

function standard(id: CraftedMaterialId, parameters: MeshStandardMaterialParameters): MeshStandardMaterial {
  return finish(id, new MeshStandardMaterial(parameters));
}

function physical(id: CraftedMaterialId, parameters: MeshPhysicalMaterialParameters): MeshPhysicalMaterial {
  return finish(id, new MeshPhysicalMaterial(parameters));
}

/** A fresh material of the crafted palette. */
export function craftedMaterial(id: CraftedMaterialId): Material {
  switch (id) {
    case "linen-white":
      return physical(id, {
        color: new Color(0xe6e7e8),
        roughness: 0.82,
        normalMap: craftedTexture("linen-normal"),
        normalScale: new Vector2(0.35, 0.35),
        sheen: 0.35,
        sheenRoughness: 0.6,
        sheenColor: new Color(0xffffff),
      });
    case "linen-black":
      return physical(id, {
        color: new Color(0x1a1919),
        roughness: 0.78,
        normalMap: craftedTexture("linen-normal"),
        normalScale: new Vector2(0.4, 0.4),
        sheen: 0.6,
        sheenRoughness: 0.45,
        sheenColor: new Color(0x6b6a6a),
      });
    case "velvet-coral":
      return physical(id, {
        color: new Color(0xcf4a2c),
        roughness: 0.88,
        normalMap: craftedTexture("velvet-normal"),
        normalScale: new Vector2(0.3, 0.3),
        sheen: 0.85,
        sheenRoughness: 0.32,
        sheenColor: new Color(0xff8c66),
      });
    case "check-coral":
      return physical(id, {
        color: new Color(0xffffff),
        map: craftedTexture("check-fabric"),
        roughness: 0.84,
        normalMap: craftedTexture("velvet-normal"),
        normalScale: new Vector2(0.15, 0.15),
        sheen: 0.45,
        sheenRoughness: 0.4,
        sheenColor: new Color(0xff8a5c),
      });
    case "frame-lacquer":
      return physical(id, {
        color: new Color(0x4a1610),
        metalness: 0.55,
        roughness: 0.32,
        clearcoat: 0.8,
        clearcoatRoughness: 0.18,
      });
    case "glide":
      return standard(id, { color: new Color(0x141414), roughness: 0.6, metalness: 0 });
    case "mahogany":
      return physical(id, {
        color: new Color(0xffffff),
        map: craftedTexture("mahogany-grain"),
        roughness: 0.42,
        clearcoat: 0.6,
        clearcoatRoughness: 0.22,
      });
    case "mahogany-dark":
      return physical(id, {
        color: new Color(0x6e5a54),
        map: craftedTexture("mahogany-grain"),
        roughness: 0.45,
        clearcoat: 0.55,
        clearcoatRoughness: 0.25,
      });
    case "mahogany-top":
      return physical(id, {
        color: new Color(0xc49a8a),
        map: craftedTexture("mahogany-grain"),
        roughness: 0.38,
        clearcoat: 0.45,
        clearcoatRoughness: 0.22,
      });
    case "brass":
      return standard(id, { color: new Color(0xc9a24f), metalness: 1, roughness: 0.32 });
    case "brass-grille":
      return standard(id, { color: new Color(0xffffff), map: craftedTexture("brass-lattice"), metalness: 0.55, roughness: 0.38 });
    case "steel-black":
      return standard(id, { color: new Color(0x1c1c1e), metalness: 0.6, roughness: 0.42 });
    case "steel-grey":
      return standard(id, { color: new Color(0xa9abad), metalness: 0.7, roughness: 0.38 });
    case "chrome":
      return standard(id, { color: new Color(0xd8d8d8), metalness: 1, roughness: 0.16 });
    case "plastic-white":
      return standard(id, { color: new Color(0xeeeeea), roughness: 0.48, metalness: 0 });
    case "plywood":
      return physical(id, {
        color: new Color(0xffffff),
        map: craftedTexture("plywood-grain"),
        roughness: 0.5,
        clearcoat: 0.35,
        clearcoatRoughness: 0.3,
      });
    case "stage-felt":
      return standard(id, {
        color: new Color(0x1d1d1f),
        roughness: 0.96,
        normalMap: craftedTexture("felt-normal"),
        normalScale: new Vector2(0.6, 0.6),
      });
    case "stage-skirt":
      return physical(id, {
        color: new Color(0x111112),
        roughness: 0.8,
        sheen: 0.5,
        sheenRoughness: 0.5,
        sheenColor: new Color(0x3a3a3c),
      });
    case "spandex-black":
      return physical(id, {
        color: new Color(0x141415),
        roughness: 0.55,
        sheen: 0.8,
        sheenRoughness: 0.35,
        sheenColor: new Color(0x5c5c60),
      });
    case "spandex-white":
      return physical(id, {
        color: new Color(0xf4f3ef),
        roughness: 0.6,
        sheen: 0.4,
        sheenRoughness: 0.4,
        sheenColor: new Color(0xffffff),
      });
    case "divider-fabric":
      return physical(id, {
        color: new Color(0x1f1f21),
        roughness: 0.8,
        normalMap: craftedTexture("felt-normal"),
        normalScale: new Vector2(0.3, 0.3),
        sheen: 0.45,
        sheenRoughness: 0.5,
        sheenColor: new Color(0x55555a),
      });
    case "rubber":
      return standard(id, { color: new Color(0x101010), roughness: 0.85, metalness: 0 });
    case "stainless":
      return standard(id, { color: new Color(0xc4c6c8), metalness: 0.9, roughness: 0.28 });
  }
}
