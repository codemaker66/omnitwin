import { Matrix4 } from "three";
import {
  gatheredSkirt,
  lathe,
  post,
  rectCloth,
  roundCloth,
  roundedBox,
  tube,
  type Vec3,
} from "./crafted-geometry.js";
import { cornerCascades, swag } from "./crafted-drapes.js";
import type { CraftedMaterialId } from "./crafted-materials.js";
import type { CraftedPart } from "./crafted-model.js";
import { poseurCover } from "./crafted-poseur.js";

// ---------------------------------------------------------------------------
// Crafted tables
//
// After the tables Blake supplied: banqueting rounds and trestles dressed in
// floor-length white or black linen, the cake table, the ceremony table with
// its swags and corner cascades, bare folding trestles (white plastic, or a
// banded wooden top on black legs), café tables on spider bases with shorter
// cloths, and stretch-covered poseur tables. Each is drawn to the catalogue's
// footprint and height. Where chairs pull up, cloth crests stay within a few
// centimetres of the top's edge: the planner seats a chair's front feet 5 cm
// off the table's edge.
// ---------------------------------------------------------------------------

export interface TableSize {
  readonly width: number;
  readonly depth: number;
  readonly height: number;
}

export type ClothColour = "white" | "black";

function linen(colour: ClothColour): CraftedMaterialId {
  return colour === "white" ? "linen-white" : "linen-black";
}

/** Hem height of a floor-length cloth: just clear of the floor. */
const FLOOR_HEM = 0.006;

/** Folds per metre round a hanging cloth, after the supplied rounds. */
const FOLDS_PER_METRE = 7;

/** A banqueting round in a floor-length cloth, its crests kept clear of the chairs. */
export function clothedRoundParts(size: TableSize, colour: ClothColour, seed = 11): CraftedPart[] {
  const radius = Math.min(size.width, size.depth) / 2;
  return [{
    material: linen(colour),
    geometry: roundCloth({
      radius,
      top: size.height,
      hem: FLOOR_HEM,
      edge: 0.02,
      flare: 0.012,
      folds: Math.max(12, Math.round(radius * 2 * Math.PI * FOLDS_PER_METRE)),
      foldDepth: 0.04,
      inward: 0.72,
      growth: 0.5,
      hemLift: 0.016,
      seed,
      samplesPerFold: 10,
      rows: 14,
    }),
  }];
}

/** A trestle in a floor-length cloth: near-flat sides, cascades at the corners. */
export function clothedTrestleParts(size: TableSize, colour: ClothColour, seed = 5): CraftedPart[] {
  return [{
    material: linen(colour),
    geometry: rectCloth({
      width: size.width,
      depth: size.depth,
      top: size.height,
      hem: FLOOR_HEM,
      edge: 0.016,
      cornerDrape: 0.05,
      flare: 0.006,
      sideFolds: 1.4,
      foldDepth: 0.01,
      cornerFolds: 3,
      cornerDepth: 0.022,
      cornerSpread: 0.1,
      cornerFlare: 0.028,
      pool: 0.02,
      hemVariation: 0.004,
      seed,
      rows: 14,
    }),
  }];
}

/** How far below the top the ceremony table's hanging layers are pinned, and how far they take to come away. */
const DRESSING_PINNED = 0.012;
const DRESSING_EMERGE = 0.05;

/**
 * The ceremony table: a top cloth with a short lip, a gathered skirt to the
 * floor, a swag along each long side and a pleated cascade at each corner.
 */
export function ceremonyTableParts(size: TableSize): CraftedPart[] {
  // The table is drawn a little inside its footprint, so its swags and
  // cascades stay close to the footprint the planner places it by.
  const width = size.width - 0.06;
  const depth = size.depth - 0.06;
  const height = size.height;
  const parts: CraftedPart[] = [
    {
      material: "linen-white",
      geometry: rectCloth({
        width: width + 0.04,
        depth: depth + 0.04,
        top: height + 0.002,
        hem: height - 0.022,
        edge: 0.01,
        cornerDrape: 0.025,
        flare: 0,
        foldDepth: 0,
        cornerDepth: 0,
        cornerFlare: 0,
        hemVariation: 0,
        rows: 2,
        density: 60,
      }),
    },
    {
      material: "linen-white",
      geometry: gatheredSkirt({
        width,
        depth,
        top: height,
        pinned: DRESSING_PINNED,
        hem: FLOOR_HEM + 0.004,
        spacing: 0.06,
        foldDepth: 0.012,
        emergeOver: DRESSING_EMERGE,
      }),
    },
  ];
  for (const turn of [0, Math.PI]) {
    const drape = swag({
      length: width - 0.04,
      halfDepth: depth / 2,
      top: height,
      pinned: DRESSING_PINNED + 0.004,
      emergeOver: DRESSING_EMERGE,
      sag: height * 0.46,
      endDrop: 0.05,
      standOff: 0.031,
      bulge: 0.03,
      folds: 2.5,
      foldDepth: 0.01,
    });
    if (turn !== 0) drape.applyMatrix4(new Matrix4().makeRotationY(turn));
    parts.push({ material: "linen-white", geometry: drape });
  }
  for (const cascade of cornerCascades({
    width,
    depth,
    top: height,
    pinned: DRESSING_PINNED + 0.006,
    emergeOver: DRESSING_EMERGE,
    hem: 0.02,
    hemRise: 0.07,
    halfWidthTop: 0.045,
    halfWidthHem: 0.13,
    standOff: 0.04,
    pleats: 5,
    pleatDepth: 0.018,
  })) {
    parts.push({ material: "linen-white", geometry: cascade });
  }
  return parts;
}

/**
 * Folding trestle legs: at each end two tube legs drop from a hinge bar and
 * dog-leg outward just above the floor; a cross bar joins them and a brace
 * runs from it up to the middle of the underside.
 */
function trestleLegs(size: TableSize, underside: number, material: CraftedMaterialId): CraftedPart[] {
  const parts: CraftedPart[] = [];
  const radius = 0.0125;
  const inset = Math.min(0.2, size.width * 0.11);
  const legZ = size.depth / 2 - 0.07;
  const kink = 0.035;
  const hinge = underside - 0.016;
  const crossY = 0.3;
  const straight = (points: Vec3[], r: number): CraftedPart => ({
    material,
    geometry: tube({ points, radius: r, tension: 0, segmentsPerMetre: 6, radialSegments: 10 }),
  });
  for (const side of [-1, 1] as const) {
    const x = side * (size.width / 2 - inset);
    const footX = x + side * kink;
    for (const z of [-legZ, legZ]) {
      parts.push({
        material,
        geometry: tube({
          points: [[x, hinge, z], [x, 0.21, z], [x + side * kink * 0.5, 0.15, z], [footX, 0.09, z], [footX, 0.026, z]],
          radius,
          tension: 0.1,
          segmentsPerMetre: 50,
          radialSegments: 10,
        }),
      });
      parts.push({ material: "rubber", geometry: post([footX, z], 0, 0.03, radius * 1.25, radius * 1.15) });
    }
    parts.push(straight([[x, hinge, -legZ - 0.02], [x, hinge, legZ + 0.02]], radius * 0.9));
    parts.push(straight([[x, crossY, -legZ], [x, crossY, legZ]], radius * 0.8));
    // The brace, from the cross bar up to the middle of the underside.
    const braceTopX = x - side * Math.min(0.42, size.width * 0.22);
    parts.push(straight([[x, crossY, 0], [braceTopX, hinge - 0.004, 0]], radius * 0.65));
  }
  // The rail the braces lock to, along the middle of the underside.
  const railX = size.width / 2 - inset - Math.min(0.42, size.width * 0.22);
  parts.push(straight([[-railX - 0.03, underside - 0.012, 0], [railX + 0.03, underside - 0.012, 0]], radius * 0.7));
  return parts;
}

/** A bare folding trestle: a blow-moulded white top on grey legs, or a banded wooden top on black. */
export function bareTrestleParts(size: TableSize, top: "plastic" | "wood"): CraftedPart[] {
  if (top === "plastic") {
    const thickness = 0.045;
    return [
      {
        material: "plastic-white",
        geometry: roundedBox([size.width, thickness, size.depth], 0.018, [0, size.height - thickness / 2, 0], { segments: 3 }),
      },
      ...trestleLegs(size, size.height - thickness, "steel-grey"),
    ];
  }
  const thickness = 0.02;
  return [
    {
      material: "plywood",
      geometry: roundedBox([size.width - 0.006, thickness, size.depth - 0.006], 0.003, [0, size.height - thickness / 2, 0], { segments: 1, grain: "x" }),
    },
    // A black edge band round the plywood: 3 mm proud of its edges, its top
    // a millimetre under the plywood's face.
    {
      material: "steel-black",
      geometry: roundedBox([size.width, thickness - 0.002, size.depth], 0.004, [0, size.height - 0.001 - (thickness - 0.002) / 2, 0], { segments: 2 }),
    },
    ...trestleLegs(size, size.height - thickness, "steel-black"),
  ];
}

/** A café table's base: a column on four arched cast arms with glides. */
function spiderBase(columnTop: number, reach: number): CraftedPart[] {
  const parts: CraftedPart[] = [
    {
      material: "steel-black",
      geometry: lathe([
        [0, columnTop],
        [0.032, columnTop],
        [0.032, 0.13],
        [0.042, 0.115],
        [0.055, 0.1],
        [0.055, 0.075],
        [0, 0.075],
      ], 24),
    },
  ];
  for (let i = 0; i < 4; i += 1) {
    const angle = (i * Math.PI) / 2 + Math.PI / 4;
    const at = (r: number, y: number): Vec3 => [Math.cos(angle) * r, y, Math.sin(angle) * r];
    parts.push({
      material: "steel-black",
      geometry: tube({
        points: [at(0.03, 0.092), at(reach * 0.45, 0.088), at(reach * 0.85, 0.06), at(reach, 0.034)],
        radius: 0.014,
        tension: 0.3,
        segmentsPerMetre: 40,
        radialSegments: 10,
      }),
    });
    const [x, , z] = at(reach, 0);
    parts.push({ material: "rubber", geometry: post([x, z], 0, 0.034, 0.02, 0.018) });
  }
  return parts;
}

/** A round café table in a cloth that falls two thirds of the way to the floor. */
export function roundCafeParts(size: TableSize, seed = 17): CraftedPart[] {
  const radius = Math.min(size.width, size.depth) / 2;
  const hem = size.height * 0.3;
  return [
    {
      material: "linen-white",
      geometry: roundCloth({
        radius,
        top: size.height,
        hem,
        edge: 0.018,
        flare: 0.012,
        folds: Math.max(12, Math.round(radius * 2 * Math.PI * 6)),
        foldDepth: 0.045,
        inward: 0.55,
        growth: 0.5,
        hemLift: 0.02,
        hemWave: 0.012,
        seed,
        samplesPerFold: 10,
        rows: 12,
      }),
    },
    ...spiderBase(hem + 0.05, Math.min(0.3, radius * 0.7)),
  ];
}

/** A square café table in a square cloth whose corners fall below its sides. */
export function squareCafeParts(size: TableSize, seed = 23): CraftedPart[] {
  const hem = size.height * 0.5;
  return [
    {
      material: "linen-white",
      geometry: rectCloth({
        width: size.width,
        depth: size.depth,
        top: size.height,
        hem,
        edge: 0.016,
        cornerDrape: 0.08,
        flare: 0.014,
        sideFolds: 2.2,
        foldDepth: 0.012,
        cornerFolds: 2,
        cornerDepth: 0.026,
        cornerSpread: 0.12,
        cornerFlare: 0.022,
        cornerDrop: hem * 0.45,
        hemVariation: 0.006,
        seed,
        rows: 12,
      }),
    },
    ...spiderBase(hem - 0.02, Math.min(0.32, Math.min(size.width, size.depth) * 0.3)),
  ];
}

/** A poseur table in a stretch cover: a round top on an hourglass that grips four feet. */
export function poseurParts(size: TableSize, colour: ClothColour): CraftedPart[] {
  return [{ material: colour === "black" ? "spandex-black" : "spandex-white", geometry: poseurCover(size) }];
}
