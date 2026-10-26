import { Matrix4 } from "three";
import {
  boxProjectUvs,
  gatheredSkirt,
  lathe,
  post,
  rectCloth,
  roundCloth,
  roundedBox,
  tube,
  type Vec3,
} from "./crafted-geometry.js";
import { aoBox, aoRod, occlude, STANDING_FLOOR } from "./crafted-ao.js";
import { craftedDetail } from "./crafted-detail.js";
import { cornerCascades, swag } from "./crafted-drapes.js";
import type { CraftedMaterialId } from "./crafted-materials.js";
import type { CraftedPart } from "./crafted-model.js";
import { poseurCover } from "./crafted-poseur.js";
import { casterCylinder, casterGeometry } from "./crafted-shadow.js";

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

/**
 * The venue's own banqueting linen: its "white" rounds and trestles are
 * ivory damask (its photographs of the Grand Hall at dinner), its black ones
 * spun polyester (16 black 130 in rounds in its inventory).
 */
function banquetLinen(colour: ClothColour): CraftedMaterialId {
  return colour === "white" ? "damask-ivory" : "poly-black";
}

/** Hem height of a floor-length cloth: just clear of the floor. */
const FLOOR_HEM = 0.006;

/**
 * Hem of the venue's black 130 in rounds on a 6 ft table at 30 in: the cloth
 * hangs 29 in, about 2 cm clear of the floor.
 */
const BLACK_ROUND_HEM = 0.021;

/** Folds per metre round a hanging cloth: the venue's rounds hang in fine folds, seven or so a metre. */
const FOLDS_PER_METRE = 7;

/**
 * A hanging cloth's own shading: its fold valleys (the surface lies inside
 * its smoothed self) and the last few centimetres over the floor.
 */
const CLOTH_OCCLUSION = {
  cavity: { passes: 8, perMetre: 7 },
  floor: { strength: 0.45, range: 0.14 },
  floorValue: 0.4,
} as const;

/** A banqueting round in a floor-length cloth, its crests kept clear of the chairs. */
export function clothedRoundParts(size: TableSize, colour: ClothColour, seed = 11): CraftedPart[] {
  const detail = craftedDetail();
  const radius = Math.min(size.width, size.depth) / 2;
  const hem = colour === "black" && radius > 0.8 ? BLACK_ROUND_HEM : FLOOR_HEM;
  const cloth = roundCloth({
    radius,
    top: size.height,
    hem,
    edge: 0.02,
    flare: 0.012,
    folds: Math.max(12, Math.round(radius * 2 * Math.PI * FOLDS_PER_METRE)),
    foldDepth: 0.042,
    inward: 0.72,
    growth: 0.5,
    irregularity: 0.62,
    crease: 0.55,
    hemLift: 0.016,
    hemWave: hem > FLOOR_HEM ? 0.006 : 0,
    seed,
    samplesPerFold: detail.level === "full" ? 10 : 6,
    rows: detail.clothRows,
  });
  const parts: CraftedPart[] = [
    { material: banquetLinen(colour), geometry: occlude(cloth, CLOTH_OCCLUSION) },
    // The sun's shadow: the cloth's fall as one solid, a little inside it.
    { material: "shadow-caster", geometry: casterCylinder(radius + 0.002, radius - 0.004, hem, size.height - 0.004, detail.level === "full" ? 40 : 24) },
  ];
  if (hem > FLOOR_HEM) {
    // A cloth clear of the floor shows the table's feet beneath its hem.
    for (const [x, z] of [[0.55, 0.4], [0.55, -0.4], [-0.55, 0.4], [-0.55, -0.4]] as const) {
      parts.push({
        material: "rubber",
        geometry: occlude(post([x * radius * 1.04, z * radius * 1.1], 0, hem + 0.04, 0.016, 0.013, detail.rodRadial + 3), { floor: STANDING_FLOOR }),
      });
    }
  }
  return parts;
}

/** A trestle in a floor-length cloth: near-flat sides, cascades at the corners. */
export function clothedTrestleParts(size: TableSize, colour: ClothColour, seed = 5): CraftedPart[] {
  const detail = craftedDetail();
  const cloth = rectCloth({
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
    rows: detail.clothRows,
  });
  return [
    { material: banquetLinen(colour), geometry: occlude(cloth, CLOTH_OCCLUSION) },
    { material: "shadow-caster", geometry: casterGeometry([aoBox([size.width - 0.008, size.height - 0.01, size.depth - 0.008], [0, (size.height - 0.01) / 2 + 0.004, 0])], { inset: 0 }) },
  ];
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
    // Rails end inside the legs and braces they join, so no open tube end shows.
    parts.push(straight([[x, hinge, -legZ], [x, hinge, legZ]], radius * 0.9));
    parts.push(straight([[x, crossY, -legZ], [x, crossY, legZ]], radius * 0.8));
    // The brace, from the cross bar up to the middle of the underside.
    const braceTopX = x - side * Math.min(0.42, size.width * 0.22);
    parts.push(straight([[x, crossY, 0], [braceTopX, hinge - 0.004, 0]], radius * 0.65));
  }
  // The rail the braces lock to, along the middle of the underside.
  const railX = size.width / 2 - inset - Math.min(0.42, size.width * 0.22);
  parts.push(straight([[-railX, underside - 0.012, 0], [railX, underside - 0.012, 0]], radius * 0.7));
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
        // The arm ends inside its glide, which hides the tube's open end.
        points: [at(0.03, 0.092), at(reach * 0.45, 0.088), at(reach * 0.85, 0.06), at(reach, 0.028)],
        radius: 0.014,
        tension: 0.3,
        segmentsPerMetre: 40,
        radialSegments: 10,
      }),
    });
    const [x, , z] = at(reach, 0);
    parts.push({ material: "rubber", geometry: post([x, z], 0, 0.046, 0.021, 0.019) });
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

/**
 * A bare banqueting round: a varnished birch-ply top with a black edge band
 * on two folding steel leg frames, each a pair of legs joined by a bar under
 * the top and a stretcher low down, with rubber feet.
 */
export function bareRoundParts(size: TableSize): CraftedPart[] {
  const detail = craftedDetail();
  const radius = Math.min(size.width, size.depth) / 2;
  const thickness = 0.018;
  const underside = size.height - thickness;
  const legRadius = 0.0125;
  const reach = radius * 0.58;
  const spread = radius * 0.42;
  const frames: Vec3[][] = [];
  const boxes = [aoBox([radius * 2, thickness + 0.02, radius * 2], [0, size.height - (thickness + 0.02) / 2, 0], "top")];
  const parts: CraftedPart[] = [];
  const steel = (geometry: ReturnType<typeof tube>, self: readonly string[]): void => {
    parts.push({ material: "steel-black", geometry: occlude(geometry, { boxes, self, floor: STANDING_FLOOR, strength: 0.8 }) });
  };
  for (const side of [-1, 1] as const) {
    const x = side * reach;
    for (const z of [-spread, spread]) {
      frames.push([[x, underside - 0.012, z], [x * 1.04, 0.03, z * 1.1]]);
      steel(tube({ points: [[x, underside - 0.012, z], [x * 1.04, 0.03, z * 1.1]], radius: legRadius, tension: 0, segmentsPerMetre: 4, radialSegments: detail.rodRadial + 3 }), []);
      parts.push({ material: "rubber", geometry: occlude(post([x * 1.04, z * 1.1], 0, 0.032, legRadius * 1.3, legRadius * 1.2, detail.rodRadial + 3), { floor: STANDING_FLOOR }) });
    }
    // The frame's bar under the top, and its low stretcher.
    steel(tube({ points: [[x, underside - 0.014, -spread], [x, underside - 0.014, spread]], radius: legRadius * 0.85, tension: 0, segmentsPerMetre: 4, radialSegments: detail.rodRadial + 2 }), []);
    steel(tube({ points: [[x * 1.03, 0.2, -spread * 1.07], [x * 1.03, 0.2, spread * 1.07]], radius: legRadius * 0.7, tension: 0, segmentsPerMetre: 4, radialSegments: detail.rodRadial + 2 }), []);
  }
  // The top: its varnished face and underside, and the edge band round it.
  // A cylinder, so the face and the edge keep their own normals; its UVs in metres for the grain.
  const top = boxProjectUvs(post([0, 0], underside, size.height, radius - 0.004, radius - 0.004, detail.level === "full" ? 96 : 56), "x");
  parts.push({ material: "plywood", geometry: occlude(top, { boxes, self: ["top"] }) });
  const band = lathe([[radius - 0.004, size.height - 0.0012], [radius - 0.0005, size.height - 0.003], [radius, size.height - thickness / 2], [radius - 0.0005, underside + 0.002], [radius - 0.004, underside + 0.001]], detail.level === "full" ? 96 : 56);
  parts.push({ material: "steel-black", geometry: occlude(band, { boxes, self: ["top"] }) });
  parts.push({
    material: "shadow-caster",
    geometry: casterGeometry([
      ...frames.map(([a, b]) => aoRod(a ?? [0, 0, 0], b ?? [0, 0, 0], legRadius * 2)),
      { centre: [0, size.height - thickness / 2, 0], axes: [[radius * 0.97, 0, 0], [0, thickness / 2, 0], [0, 0, radius * 0.97]] },
    ], { inset: 0.002, minimum: 0.01 }),
  });
  return parts;
}

/**
 * A bare poseur: a 60 cm top of white laminate with a chrome edge on a
 * chrome column, over a weighted round foot.
 */
export function barePoseurParts(size: TableSize): CraftedPart[] {
  const detail = craftedDetail();
  const radius = Math.min(size.width, size.depth) / 2;
  const segments = detail.level === "full" ? 64 : 40;
  const thickness = 0.025;
  const footRadius = radius * 0.72;
  const boxes = [aoBox([radius * 2, thickness, radius * 2], [0, size.height - thickness / 2, 0], "top")];
  return [
    {
      material: "plastic-white",
      geometry: occlude(post([0, 0], size.height - thickness, size.height, radius - 0.006, radius - 0.006, segments), { boxes, self: ["top"] }),
    },
    {
      material: "chrome",
      geometry: occlude(lathe([
        [radius - 0.006, size.height - 0.001], [radius, size.height - 0.006], [radius, size.height - thickness + 0.004], [radius - 0.006, size.height - thickness],
      ], segments), { boxes, self: ["top"] }),
    },
    {
      material: "chrome",
      geometry: occlude(lathe([
        [0, size.height - thickness], [0.05, size.height - thickness], [0.05, size.height - thickness - 0.012], [0.03, size.height - thickness - 0.02],
        [0.03, 0.04], [0.042, 0.03], [footRadius, 0.018], [footRadius, 0.004], [footRadius - 0.006, 0], [0, 0],
      ], segments), { boxes, floor: STANDING_FLOOR, strength: 0.8 }),
    },
    {
      material: "shadow-caster",
      geometry: casterGeometry([
        { centre: [0, size.height - thickness / 2, 0], axes: [[radius * 0.95, 0, 0], [0, thickness / 2, 0], [0, 0, radius * 0.95]] },
        aoRod([0, 0.04, 0], [0, size.height - thickness, 0], 0.05),
        { centre: [0, 0.01, 0], axes: [[footRadius * 0.9, 0, 0], [0, 0.009, 0], [0, 0, footRadius * 0.9]] },
      ], { inset: 0.002 }),
    },
  ];
}

/** A poseur table in a stretch cover: a round top on an hourglass that grips four feet. */
export function poseurParts(size: TableSize, colour: ClothColour): CraftedPart[] {
  const radius = Math.min(size.width, size.depth) / 2;
  const waistY = size.height * 0.59;
  const cover = occlude(poseurCover(size), { cavity: { passes: 6, perMetre: 5 }, floor: STANDING_FLOOR, floorValue: 0.4 });
  // The sun's shadow: the top, the column to the waist, and the flare to the feet.
  const caster = casterGeometry([
    { centre: [0, size.height - 0.02, 0], axes: [[radius * 0.97, 0, 0], [0, 0.018, 0], [0, 0, radius * 0.97]] },
    aoRod([0, waistY, 0], [0, size.height - 0.04, 0], radius * 0.62),
    aoRod([0, 0.004, 0], [0, waistY, 0], radius * 0.7),
  ], { inset: 0.004 });
  return [
    { material: colour === "black" ? "spandex-black" : "spandex-white", geometry: cover },
    { material: "shadow-caster", geometry: caster },
  ];
}
