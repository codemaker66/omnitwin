import { type BufferGeometry, Matrix4, Quaternion, Vector3 } from "three";
import { aoBox, aoRod, CHAIR_FLOOR, occlude, STANDING_FLOOR, type AoBox } from "./crafted-ao.js";
import { craftedDetail } from "./crafted-detail.js";
import { lathe, roundedBox, tube, type Vec3 } from "./crafted-geometry.js";
import type { CraftedMaterialId } from "./crafted-materials.js";
import type { CraftedPart } from "./crafted-model.js";
import { casterGeometry, contactSpots } from "./crafted-shadow.js";

// ---------------------------------------------------------------------------
// The smaller pieces: highchairs, a place setting, a folded cloth
//
// The venue counts its highchairs by colour (five white, one green, one
// blue, two wooden): one restaurant highchair in four finishes, on four
// splayed legs with a footrest, arms and a front bar. A dinner place setting
// is a charger and its plates, folded napkin, cutlery and a tumbler. A
// table cloth on its own is a cloth folded square, ready to dress a table.
// ---------------------------------------------------------------------------

export interface SmallSize {
  readonly width: number;
  readonly depth: number;
  readonly height: number;
}

export type HighchairFinish = "paint-white" | "paint-green" | "paint-blue" | "beech";

const UP = new Vector3(0, 1, 0);

/** A square-section rod with eased edges from `a` to `b`. */
function squareRod(a: Vec3, b: Vec3, thickness: number, segments: number): BufferGeometry {
  const from = new Vector3(...a);
  const to = new Vector3(...b);
  const length = from.distanceTo(to);
  const geometry = roundedBox([thickness, length, thickness], thickness * 0.22, [0, 0, 0], { segments, grain: "y" });
  const turn = new Quaternion().setFromUnitVectors(UP, to.clone().sub(from).normalize());
  geometry.applyMatrix4(new Matrix4().compose(from.clone().add(to).multiplyScalar(0.5), turn, new Vector3(1, 1, 1)));
  return geometry;
}

interface Member {
  readonly tag: string;
  readonly from: Vec3;
  readonly to: Vec3;
  readonly thickness: number;
}

function between(from: Vec3, to: Vec3, t: number): Vec3 {
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
}

/** A restaurant highchair, facing −z: splayed legs, a footrest, a slatted back, arms and a front bar. */
export function highchairParts(size: SmallSize, finish: HighchairFinish): CraftedPart[] {
  const detail = craftedDetail();
  const { width, depth, height } = size;
  const seatY = height * 0.58;
  const seatHalfW = Math.min(0.15, width * 0.3);
  const seatHalfD = Math.min(0.15, depth * 0.28);
  const footX = width / 2 - 0.025;
  const footZ = depth / 2 - 0.025;
  const legs = new Map<string, Member>();
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      const tag = `leg-${String(sx)}${String(sz)}`;
      legs.set(tag, { tag, from: [sx * footX, 0, sz * footZ], to: [sx * seatHalfW, seatY - 0.02, sz * seatHalfD], thickness: 0.026 });
    }
  }
  const leg = (sx: number, sz: number): Member => {
    const found = legs.get(`leg-${String(sx)}${String(sz)}`);
    if (found === undefined) throw new Error("No highchair leg");
    return found;
  };
  const members: Member[] = [...legs.values()];
  // Rails between the legs, low and high, and the footrest in front.
  for (const t of [0.22, 0.55]) {
    for (const sx of [-1, 1] as const) {
      members.push({ tag: `side-${String(sx)}-${String(t)}`, from: between(leg(sx, -1).from, leg(sx, -1).to, t), to: between(leg(sx, 1).from, leg(sx, 1).to, t), thickness: 0.018 });
    }
    members.push({ tag: `back-rail-${String(t)}`, from: between(leg(-1, 1).from, leg(-1, 1).to, t), to: between(leg(1, 1).from, leg(1, 1).to, t), thickness: 0.018 });
  }
  members.push({ tag: "footrest", from: between(leg(-1, -1).from, leg(-1, -1).to, 0.55), to: between(leg(1, -1).from, leg(1, -1).to, 0.55), thickness: 0.03 });
  // The back's posts and slats, the arms and the front bar.
  const backZ = seatHalfD - 0.01;
  const backTop = height - 0.01;
  for (const sx of [-1, 1] as const) {
    members.push({ tag: `post-${String(sx)}`, from: [sx * seatHalfW, seatY, backZ], to: [sx * (seatHalfW - 0.01), backTop, backZ + 0.03], thickness: 0.024 });
    members.push({ tag: `arm-${String(sx)}`, from: [sx * seatHalfW, seatY + 0.17, -seatHalfD + 0.01], to: [sx * seatHalfW, seatY + 0.18, backZ + 0.015], thickness: 0.026 });
    members.push({ tag: `arm-post-${String(sx)}`, from: [sx * seatHalfW, seatY, -seatHalfD + 0.02], to: [sx * seatHalfW, seatY + 0.17, -seatHalfD + 0.01], thickness: 0.02 });
  }
  members.push({ tag: "front-bar", from: [-seatHalfW, seatY + 0.15, -seatHalfD + 0.005], to: [seatHalfW, seatY + 0.15, -seatHalfD + 0.005], thickness: 0.022 });
  members.push({ tag: "top-rail", from: [-seatHalfW + 0.01, backTop - 0.03, backZ + 0.028], to: [seatHalfW - 0.01, backTop - 0.03, backZ + 0.028], thickness: 0.05 });
  for (const x of [-0.06, 0, 0.06]) {
    members.push({ tag: `slat-${String(x)}`, from: [x, seatY + 0.04, backZ + 0.004], to: [x, backTop - 0.05, backZ + 0.026], thickness: 0.016 });
  }
  const seatSize: Vec3 = [seatHalfW * 2 + 0.03, 0.026, seatHalfD * 2 + 0.03];
  const boxes: AoBox[] = [...members.map((m) => aoRod(m.from, m.to, m.thickness, m.tag)), aoBox(seatSize, [0, seatY, 0], "seat")];
  const segments = detail.level === "full" ? 2 : 1;
  const parts: CraftedPart[] = members.map((m) => ({
    material: finish,
    geometry: occlude(squareRod(m.from, m.to, m.thickness, segments), { boxes, self: [m.tag], floor: CHAIR_FLOOR, strength: 0.8 }),
  }));
  parts.push({
    material: finish,
    geometry: occlude(roundedBox(seatSize, 0.008, [0, seatY, 0], { segments: 2, grain: "x" }), { boxes, self: ["seat"], floor: CHAIR_FLOOR, strength: 0.8 }),
  });
  parts.push({ material: "contact", geometry: contactSpots([-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ x: sx * footX, z: sz * footZ, radius: 0.05 })))) });
  parts.push({ material: "shadow-caster", geometry: casterGeometry(boxes, { inset: 0.002, minimum: 0.012 }) });
  return parts;
}

/**
 * One cover laid for dinner, the diner at −z: a gilt-rimmed charger under the
 * dinner plate, the folded napkin on it, the side plate to the left, the
 * cutlery either side and a water tumbler to the right.
 */
export function placeSettingParts(size: SmallSize): CraftedPart[] {
  const radial = craftedDetail().level === "full" ? 48 : 28;
  const { width, depth, height } = size;
  const plate = Math.min(width, depth) * 0.42;
  const plateProfile = (r: number, lift: number): [number, number][] => [
    [0, lift], [r * 0.6, lift], [r * 0.7, lift + 0.004], [r * 0.95, lift + 0.012], [r, lift + 0.014], [r * 0.98, lift + 0.016], [r * 0.7, lift + 0.007], [0, lift + 0.003],
  ];
  const parts: CraftedPart[] = [
    { material: "gilt", geometry: lathe([[0, 0.001], [plate * 1.12, 0.001], [plate * 1.16, 0.006], [plate * 1.1, 0.008], [0, 0.004]], radial) },
    { material: "porcelain", geometry: lathe(plateProfile(plate, 0.006), radial) },
    // The napkin, folded into a long rectangle across the plate.
    { material: "damask-ivory", geometry: roundedBox([plate * 1.1, 0.012, plate * 0.42], 0.005, [0, 0.026, 0], { segments: 2, grain: "x" }) },
  ];
  const side = lathe(plateProfile(plate * 0.5, 0), radial);
  side.translate(-width * 0.36, 0, -depth * 0.2);
  parts.push({ material: "porcelain", geometry: side });
  // Cutlery: forks to the left, knives and a spoon to the right.
  for (const [x, length] of [[-plate * 1.25, 0.19], [-plate * 1.4, 0.18], [plate * 1.25, 0.21], [plate * 1.42, 0.2]] as const) {
    parts.push({ material: "stainless", geometry: roundedBox([0.012, 0.004, length], 0.0015, [x, 0.003, 0], { segments: 1, grain: "z" }) });
  }
  // A water tumbler to the right, above the knives. (The catalogue's 8 cm
  // envelope leaves no room for a stemmed wine glass.)
  const water = lathe([[0, 0], [0.032, 0], [0.036, height * 0.98], [0.0352, height * 0.98], [0.031, 0.004], [0, 0.004]], radial);
  water.translate(width * 0.3, 0, depth * 0.32);
  parts.push({ material: "glass", geometry: water });
  return parts.map((part) => ({ material: part.material, geometry: occlude(part.geometry, {}) }));
}

/** A table cloth on its own: folded square, in a soft stack of its layers, ready to dress a table. */
export function foldedClothParts(size: SmallSize, material: CraftedMaterialId): CraftedPart[] {
  const { width, depth, height } = size;
  const layers = 3;
  const layer = Math.max(0.003, height / layers);
  const parts: CraftedPart[] = [];
  for (let i = 0; i < layers; i += 1) {
    const inset = i * 0.004;
    parts.push({
      material,
      geometry: roundedBox([width - 0.01 - inset, layer, depth - 0.01 - inset], Math.min(layer * 0.48, 0.004), [0, layer * (i + 0.5), 0], { segments: 2, grain: "x" }),
    });
  }
  // The fold's soft roll along one edge.
  parts.push({
    material,
    geometry: tube({ points: [[-(width - 0.012) / 2, height / 2, depth / 2 - 0.006], [(width - 0.012) / 2, height / 2, depth / 2 - 0.006]], radius: height / 2, tension: 0, segmentsPerMetre: 4, radialSegments: 10 }),
  });
  return parts.map((part) => ({ material: part.material, geometry: occlude(part.geometry, { floor: STANDING_FLOOR, strength: 0.4 }) }));
}
