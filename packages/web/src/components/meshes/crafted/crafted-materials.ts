import { Color, DoubleSide, FrontSide, type Material, Vector2 } from "three";
import {
  MeshBasicNodeMaterial,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  type MeshPhysicalNodeMaterialParameters,
  type MeshStandardNodeMaterialParameters,
} from "three/webgpu";
import { attribute, bool } from "three/tsl";
import { noClipPlanes } from "../../SectionPlane.js";
import { craftedTexture } from "./crafted-textures.js";

// ---------------------------------------------------------------------------
// Crafted furniture materials
//
// The palette follows Trades Hall's own furniture and the models Blake
// supplied: the gold Chiavari chairs and their ivory pads, the ivory damask
// on the rounds and the black polyester rounds, mahogany-lacquered banquet
// chair frames with coral velvet or the coral check, white and black linen,
// stretch spandex, polished mahogany with brass for the bar and servery,
// black stage felt, powder-coated steel, plywood and white plastic trestle
// tops, and the black folding divider. Each call returns a fresh material
// owned by the model that asked for it; the maps are shared
// (crafted-textures.ts). Every material is excluded from the section plane,
// like the rest of the furniture.
//
// They are node materials, so each reads the occlusion baked into its
// geometry (crafted-ao.ts) and applies it to its ambient and reflected light.
// The `shadow-caster` material draws nothing on screen: it carries the
// simplified solid a piece casts the sun's and the moon's shadow with
// (discarded in the view, kept in the shadow pass).
// ---------------------------------------------------------------------------

export type CraftedMaterialId =
  | "linen-white"
  | "linen-black"
  | "velvet-coral"
  | "velvet-crimson"
  | "velvet-pink"
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
  | "stainless"
  | "gilt"
  | "pad-ivory"
  | "damask-ivory"
  | "poly-black"
  | "parquet"
  | "deck-phenolic"
  | "aluminium"
  | "screen-white"
  | "screen-glass"
  | "plastic-dark"
  | "paint-white"
  | "paint-green"
  | "paint-blue"
  | "beech"
  | "porcelain"
  | "glass"
  | "contact"
  | "shadow-caster"
  | "shadow-sheet";

/**
 * Cloth hung as a single open sheet. Drawn from the front only, but it casts
 * shadows from both faces: the shadow pass otherwise draws only the faces
 * turned from the light, and a skirt would cast a shadow in broken strips.
 */
const OPEN_SHEETS: ReadonlySet<CraftedMaterialId> = new Set<CraftedMaterialId>([
  "linen-white",
  "linen-black",
  "spandex-black",
  "spandex-white",
  "stage-skirt",
  "damask-ivory",
  "poly-black",
]);

/** Whether parts of this material are a piece's shadow caster rather than what is seen. */
export function isShadowCaster(id: CraftedMaterialId): boolean {
  return id === "shadow-caster" || id === "shadow-sheet";
}

/** Whether parts of this material only shade the floor: never a shadow caster, never lit. */
export function isFloorShade(id: CraftedMaterialId): boolean {
  return id === "contact";
}

/** The same, by a material's palette name, which survives the instancing harvest. */
export function isFloorShadeMaterial(material: Material): boolean {
  return material.name === "crafted:contact";
}

/**
 * The shade under a foot (crafted-shadow.ts contactSpots): an unlit dark
 * spot blended over the floor, drawn after it and never into the depth.
 */
function contactShade(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ color: new Color(0xffffff), map: craftedTexture("contact-spot"), transparent: true, opacity: 0.82 });
  material.name = "crafted:contact";
  material.clippingPlanes = noClipPlanes;
  material.side = FrontSide;
  material.depthWrite = false;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -4;
  material.fog = false;
  return material;
}

/** The occlusion baked into every crafted geometry, 1 where open. */
const BAKED_OCCLUSION = attribute<"float">("ao", "float");

function finish<T extends MeshStandardNodeMaterial>(id: CraftedMaterialId, material: T): T {
  material.name = `crafted:${id}`;
  material.clippingPlanes = noClipPlanes;
  material.side = FrontSide;
  if (OPEN_SHEETS.has(id)) material.shadowSide = DoubleSide;
  material.aoNode = BAKED_OCCLUSION;
  return material;
}

function standard(id: CraftedMaterialId, parameters: MeshStandardNodeMaterialParameters): MeshStandardNodeMaterial {
  return finish(id, new MeshStandardNodeMaterial(parameters));
}

function physical(id: CraftedMaterialId, parameters: MeshPhysicalNodeMaterialParameters): MeshPhysicalNodeMaterial {
  return finish(id, new MeshPhysicalNodeMaterial(parameters));
}

/**
 * The shadow caster: discarded wherever the view draws it, drawn whole into
 * the sun's map. Its solids are closed, so the shadow pass draws their back
 * faces, which keeps the acne off the surfaces they stand inside.
 */
function shadowCaster(sheet = false): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ color: new Color(0x000000) });
  material.name = sheet ? "crafted:shadow-sheet" : "crafted:shadow-caster";
  material.clippingPlanes = noClipPlanes;
  // A solid's back faces cast; an open sheet (a drape's inset copy) casts from both.
  material.side = FrontSide;
  if (sheet) material.shadowSide = DoubleSide;
  material.maskNode = bool(false);
  material.maskShadowNode = bool(true);
  // Belt and braces: should the view ever keep a fragment, it writes nothing.
  material.colorWrite = false;
  material.depthWrite = false;
  return material;
}

/** A fresh material of the crafted palette. */
export function craftedMaterial(id: CraftedMaterialId): Material {
  switch (id) {
    case "shadow-caster":
      return shadowCaster();
    case "shadow-sheet":
      return shadowCaster(true);
    case "contact":
      return contactShade();
    case "gilt":
      // The Chiavari's gold: champagne metallic paint over resin, satin, with
      // a thin lacquer that keeps a soft highlight on every turned knuckle.
      return physical(id, {
        color: new Color(0xe2cd9f),
        metalness: 0.86,
        roughness: 1,
        roughnessMap: craftedTexture("gilt-roughness"),
        clearcoat: 0.3,
        clearcoatRoughness: 0.28,
      });
    case "pad-ivory":
      // The Chiavari's tie-on seat pad: ivory leatherette with a soft sheen.
      return physical(id, {
        color: new Color(0xf0ece3),
        roughness: 0.5,
        normalMap: craftedTexture("leather-normal"),
        normalScale: new Vector2(0.25, 0.25),
        clearcoat: 0.2,
        clearcoatRoughness: 0.42,
        sheen: 0.25,
        sheenRoughness: 0.5,
        sheenColor: new Color(0xfff6e6),
      });
    case "damask-ivory":
      // The rounds' floor-length ivory damask: a satin figure on a matt
      // twill ground, tone on tone, with a warm sheen at grazing angles.
      return physical(id, {
        color: new Color(0xffffff),
        map: craftedTexture("damask-colour"),
        roughness: 1,
        roughnessMap: craftedTexture("damask-roughness"),
        normalMap: craftedTexture("linen-normal"),
        normalScale: new Vector2(0.18, 0.18),
        sheen: 0.45,
        sheenRoughness: 0.42,
        sheenColor: new Color(0xfff4e2),
      });
    case "poly-black":
      // The venue's 130 in black rounds: spun polyester, near black, with a
      // cool sheen along every fold.
      return physical(id, {
        color: new Color(0x161617),
        roughness: 0.7,
        normalMap: craftedTexture("linen-normal"),
        normalScale: new Vector2(0.3, 0.3),
        sheen: 0.7,
        sheenRoughness: 0.38,
        sheenColor: new Color(0x6a6b70),
      });
    case "parquet":
      // A hire dance floor's oak parquet under a hard gloss lacquer: the
      // strips' own sheen, and a mirror-bright coat over them.
      return physical(id, {
        color: new Color(0xffffff),
        map: craftedTexture("parquet-colour"),
        normalMap: craftedTexture("parquet-normal"),
        normalScale: new Vector2(0.5, 0.5),
        roughness: 0.42,
        clearcoat: 0.85,
        clearcoatRoughness: 0.08,
      });
    case "deck-phenolic":
      // A staging deck's black phenolic birch face, its hexagon tread catching the light.
      return physical(id, {
        color: new Color(0x2a2522),
        roughness: 0.62,
        normalMap: craftedTexture("hex-deck-normal"),
        normalScale: new Vector2(0.55, 0.55),
        clearcoat: 0.25,
        clearcoatRoughness: 0.45,
      });
    case "paint-white":
    case "paint-green":
    case "paint-blue": {
      // The highchairs' satin enamel.
      const colour = id === "paint-white" ? 0xf2f1ec : id === "paint-green" ? 0x4c6b4a : 0x3f5d7d;
      return physical(id, { color: new Color(colour), roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.3 });
    }
    case "beech":
      // Lacquered beech: the wooden highchair.
      return physical(id, { color: new Color(0xf6e3c8), map: craftedTexture("plywood-grain"), roughness: 0.45, clearcoat: 0.4, clearcoatRoughness: 0.25 });
    case "porcelain":
      // White bone china: a soft glaze with a bright highlight.
      return physical(id, { color: new Color(0xf7f6f2), roughness: 0.18, clearcoat: 0.8, clearcoatRoughness: 0.06 });
    case "glass":
      // Clear glass, drawn as a faint, bright skin (no refraction: a hall of them stays cheap).
      return physical(id, { color: new Color(0xeef3f4), roughness: 0.04, metalness: 0, transparent: true, opacity: 0.22, clearcoat: 1, clearcoatRoughness: 0.02 });
    case "screen-white":
      // A projection face: matt, near white, no sheen to hot-spot.
      return standard(id, { color: new Color(0xf1f1ee), roughness: 0.92, metalness: 0 });
    case "screen-glass":
      // A switched-off panel or a lens: black glass with a sharp reflection.
      return physical(id, { color: new Color(0x050607), roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03 });
    case "plastic-dark":
      // AV kit's charcoal housings, softly satin.
      return standard(id, { color: new Color(0x26272a), roughness: 0.55, metalness: 0 });
    case "aluminium":
      // Extruded edge trim: brushed, a soft metal highlight.
      return standard(id, { color: new Color(0xc7c9cb), metalness: 1, roughness: 0.36 });
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
    case "velvet-crimson":
      // The gallery chair's and the plain banquet chair's red velvet.
      return physical(id, {
        color: new Color(0xa3221b),
        roughness: 0.88,
        normalMap: craftedTexture("velvet-normal"),
        normalScale: new Vector2(0.3, 0.3),
        sheen: 0.9,
        sheenRoughness: 0.3,
        sheenColor: new Color(0xff6450),
      });
    case "velvet-pink":
      // The pink chair's salmon velvet, as on Blake's supplied model.
      return physical(id, {
        color: new Color(0xd98a78),
        roughness: 0.88,
        normalMap: craftedTexture("velvet-normal"),
        normalScale: new Vector2(0.3, 0.3),
        sheen: 0.85,
        sheenRoughness: 0.32,
        sheenColor: new Color(0xffc2b0),
      });
    case "check-coral":
      return physical(id, {
        color: new Color(0xffffff),
        map: craftedTexture("check-fabric"),
        roughness: 0.84,
        normalMap: craftedTexture("velvet-normal"),
        normalScale: new Vector2(0.15, 0.15),
        sheen: 0.5,
        sheenRoughness: 0.4,
        sheenColor: new Color(0xff5a44),
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
