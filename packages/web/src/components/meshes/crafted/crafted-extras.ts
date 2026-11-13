import { type BufferGeometry, Matrix4, Quaternion, Vector3 } from "three";
import { aoBox, aoRod, CHAIR_FLOOR, occlude, type AoBox } from "./crafted-ao.js";
import { craftedDetail } from "./crafted-detail.js";
import { roundedBox, type Vec3 } from "./crafted-geometry.js";
import type { CraftedPart } from "./crafted-model.js";
import { casterGeometry, contactSpots } from "./crafted-shadow.js";

// ---------------------------------------------------------------------------
// Highchairs
//
// The venue counts its highchairs by colour (five white, one green, one
// blue, two wooden): one restaurant highchair in four finishes, on four
// splayed legs with a footrest, arms and a front bar. (Table cloths and
// place settings are dressing a table wears, FurnitureProxy's applicators,
// not pieces of their own.)
// ---------------------------------------------------------------------------

export interface HighchairSize {
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
export function highchairParts(size: HighchairSize, finish: HighchairFinish): CraftedPart[] {
  const detail = craftedDetail();
  const { width, depth, height } = size;
  const seatY = height * 0.58;
  const seatHalfW = Math.min(0.15, width * 0.3);
  const seatHalfD = Math.min(0.15, depth * 0.28);
  const footX = width / 2 - 0.03;
  const footZ = depth / 2 - 0.03;
  const legs = new Map<string, Member>();
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      const tag = `leg-${String(sx)}${String(sz)}`;
      // From a little above the floor: a tilted square leg's corner reaches lower than its axis.
      legs.set(tag, { tag, from: [sx * footX, 0.014, sz * footZ], to: [sx * seatHalfW, seatY - 0.02, sz * seatHalfD], thickness: 0.026 });
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
