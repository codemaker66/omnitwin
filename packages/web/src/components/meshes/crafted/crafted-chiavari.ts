import { type BufferGeometry, Matrix4, Quaternion, Vector3 } from "three";
import { aoBox, aoRod, CHAIR_FLOOR, occlude, STANDING_FLOOR, type AoBox } from "./crafted-ao.js";
import { craftedDetail } from "./crafted-detail.js";
import {
  cushion,
  gridSurface,
  lathe,
  post,
  roundedBox,
  roundedOutline,
  tube,
  type Vec2,
  type Vec3,
} from "./crafted-geometry.js";
import type { CraftedPart } from "./crafted-model.js";
import { casterGeometry, contactSpots } from "./crafted-shadow.js";

// ---------------------------------------------------------------------------
// The Chiavari chair
//
// Trades Hall's wedding and dinner chair (200 in the venue's inventory; every
// round in the Grand Hall's own photographs wears them): a gold Chiavari with
// an ivory tie-on pad. Read from the venue's photographs: four bamboo-turned
// legs, the rear pair rising into the back's uprights with a slight recline;
// a top rail over five short spindles, then three ladder rails; a slim seat
// rim; two side stretchers a side and one front and back; a thick ivory pad
// with a piped edge sitting on the rim.
//
// Drawn to the catalogue's width, depth and height, facing −Z (the planner's
// seated forward axis). Every member is one box to the occlusion bake and to
// the shadow caster, so the creases under the seat, round the rails and at
// the feet are baked, and the sun casts the chair's ladder back on the floor.
// ---------------------------------------------------------------------------

export interface ChiavariSize {
  readonly width: number;
  readonly depth: number;
  readonly height: number;
}

/** A turned member: its ends, its radius, and where its bamboo knuckles stand (fractions of its length). */
interface Member {
  readonly tag: string;
  readonly from: Vec3;
  readonly to: Vec3;
  readonly radius: number;
  readonly knuckles: readonly number[];
  /** Thin members (spindles, stretchers) take the rod segment count. */
  readonly thin?: boolean;
}

const UP = new Vector3(0, 1, 0);

/**
 * A bamboo-turned rod from `from` to `to`: straight canes that swell a little
 * between knuckles, each knuckle a raised ring between two shallow grooves.
 * Lathed along y, then turned onto the member's axis.
 */
function bamboo(member: Member, radial: number): BufferGeometry {
  const a = new Vector3(...member.from);
  const b = new Vector3(...member.to);
  const length = a.distanceTo(b);
  const r = member.radius;
  const ring = r * 1.22;
  const groove = r * 0.86;
  const width = Math.min(0.009, length * 0.04);
  const profile: [number, number][] = [[0, 0], [r * 0.97, 0], [r, width * 0.6]];
  const stops = [...member.knuckles].sort((x, y) => x - y).map((f) => f * length);
  let previous = 0;
  for (const at of stops) {
    // The cane swells a touch between knuckles.
    profile.push([r * 1.02, (previous + at) / 2]);
    profile.push([groove, at - width], [ring, at - width * 0.3], [ring, at + width * 0.3], [groove, at + width]);
    previous = at;
  }
  profile.push([r * 1.02, (previous + length) / 2], [r, length - width * 0.6], [r * 0.97, length], [0, length]);
  const geometry = lathe(profile, radial);
  const direction = b.clone().sub(a).normalize();
  const turn = new Quaternion().setFromUnitVectors(UP, direction);
  geometry.applyMatrix4(new Matrix4().compose(a, turn, new Vector3(1, 1, 1)));
  return geometry;
}

/**
 * A band standing round a closed outline in plan (x, z), from `bottom` to
 * `top`, `thickness` thick, its top edge rounded over: the Chiavari's rim.
 */
function rimBand(
  outline: { readonly points: readonly Vec2[]; readonly normals: readonly Vec2[] },
  bottom: number,
  top: number,
  thickness: number,
): BufferGeometry {
  const half = thickness / 2;
  // The section: up the outside face, over the rounded top, down the inside,
  // as offsets along the outline's outward normal and heights.
  const section: [number, number][] = [[0, bottom], [0, top - half]];
  for (let step = 1; step < 6; step += 1) {
    const angle = (step / 6) * Math.PI;
    section.push([-half + Math.cos(angle) * half, top - half + Math.sin(angle) * half]);
  }
  section.push([-thickness, top - half], [-thickness, bottom], [0, bottom]);
  const arcs = [0];
  for (let i = 1; i < section.length; i += 1) {
    const a = section[i - 1] ?? [0, 0];
    const b = section[i] ?? [0, 0];
    arcs.push((arcs[i - 1] ?? 0) + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const count = outline.points.length;
  const rows: Vec3[][] = [];
  const uvs: [number, number][][] = [];
  section.forEach(([offset, y], row) => {
    const points: Vec3[] = [];
    const uvRow: [number, number][] = [];
    let along = 0;
    for (let s = 0; s <= count; s += 1) {
      const p = outline.points[s % count] ?? [0, 0];
      const n = outline.normals[s % count] ?? [0, 0];
      if (s > 0) {
        const q = outline.points[s - 1] ?? [0, 0];
        along += Math.hypot(p[0] - q[0], p[1] - q[1]);
      }
      points.push([p[0] + n[0] * offset, y, p[1] + n[1] * offset]);
      uvRow.push([along, arcs[row] ?? 0]);
    }
    rows.push(points);
    uvs.push(uvRow);
  });
  return gridSurface(rows, uvs, { closed: true });
}

/** The parts of a Chiavari chair sized to `size`. */
export function chiavariParts(size: ChiavariSize): CraftedPart[] {
  const detail = craftedDetail();
  const { width, depth, height } = size;
  const halfW = width / 2;
  const halfD = depth / 2;
  const legR = Math.min(0.0135, width * 0.033);
  const footInset = legR + 0.003;
  // Heights, scaled from the 0.92 m chair.
  const k = height / 0.92;
  const seatTop = 0.428 * k;
  const rimHeight = 0.038 * k;
  const rimBottom = seatTop - rimHeight;
  const topY = height - 0.016 * k;

  // Feet at the footprint's corners; the seat's corners a little inside them.
  const frontFoot: Vec2 = [halfW - footInset, -halfD + footInset];
  const rearFoot: Vec2 = [halfW - footInset - 0.012, halfD - footInset];
  const frontSeat: Vec2 = [halfW - footInset - 0.012, -halfD + footInset + 0.024];
  const rearSeat: Vec2 = [halfW - footInset - 0.02, halfD - footInset - 0.07];
  // The back reclines from the seat to the top rail, its uprights drawing
  // in a little as they rise.
  const rearTop: Vec2 = [rearSeat[0] - 0.018, halfD - footInset - 0.002];
  const backAt = (y: number): Vec2 => {
    const t = (y - seatTop) / (topY - seatTop);
    return [rearSeat[0] + (rearTop[0] - rearSeat[0]) * t, rearSeat[1] + (rearTop[1] - rearSeat[1]) * t];
  };

  const members: Member[] = [];
  for (const side of [-1, 1] as const) {
    const s = side < 0 ? "l" : "r";
    members.push({
      tag: `front-${s}`,
      from: [side * frontFoot[0], 0.006, frontFoot[1]],
      to: [side * frontSeat[0], rimBottom + 0.006, frontSeat[1]],
      radius: legR,
      knuckles: [0.3, 0.62],
    });
    members.push({
      tag: `rear-${s}`,
      from: [side * rearFoot[0], 0.006, rearFoot[1]],
      to: [side * rearSeat[0], seatTop, rearSeat[1]],
      radius: legR,
      knuckles: [0.3, 0.62],
    });
    members.push({
      tag: `upright-${s}`,
      from: [side * rearSeat[0], seatTop, rearSeat[1]],
      to: [side * rearTop[0], topY, rearTop[1]],
      radius: legR * 0.96,
      knuckles: [0.24, 0.5, 0.74],
    });
  }

  // The back: a top rail over five spindles, then three ladder rails.
  const rail = (tag: string, y: number, radius: number, bow: number): void => {
    const [x, z] = backAt(y);
    members.push({ tag, from: [-x, y, z + bow], to: [x, y, z + bow], radius, knuckles: [0.5], thin: true });
  };
  const topRailY = topY - 0.022 * k;
  const spindleFoot = topRailY - 0.105 * k;
  rail("rail-top", topRailY, legR * 0.85, 0.004);
  rail("rail-1", spindleFoot, legR * 0.72, 0.002);
  rail("rail-2", spindleFoot - 0.085 * k, legR * 0.72, 0.002);
  rail("rail-3", spindleFoot - 0.17 * k, legR * 0.72, 0.002);
  const [spindleX, zTop] = backAt(topRailY);
  const [, zFoot] = backAt(spindleFoot);
  for (let i = 0; i < 5; i += 1) {
    const f = (i - 2) / 3;
    members.push({
      tag: `spindle-${String(i)}`,
      from: [f * spindleX, spindleFoot, zFoot + 0.002],
      to: [f * spindleX, topRailY, zTop + 0.003],
      radius: legR * 0.48,
      knuckles: [0.5],
      thin: true,
    });
  }

  // Stretchers: two a side, one front and one back, between the legs.
  const along = (member: Member, y: number): Vec3 => {
    const t = (y - member.from[1]) / (member.to[1] - member.from[1]);
    return [
      member.from[0] + (member.to[0] - member.from[0]) * t,
      y,
      member.from[2] + (member.to[2] - member.from[2]) * t,
    ];
  };
  const leg = (tag: string): Member => {
    const found = members.find((member) => member.tag === tag);
    if (found === undefined) throw new Error(`No Chiavari member ${tag}`);
    return found;
  };
  const stretcher = (tag: string, from: Member, to: Member, y: number): void => {
    members.push({ tag, from: along(from, y), to: along(to, y), radius: legR * 0.55, knuckles: [0.5], thin: true });
  };
  for (const s of ["l", "r"] as const) {
    stretcher(`side-${s}0`, leg(`front-${s}`), leg(`rear-${s}`), 0.135 * k);
    stretcher(`side-${s}1`, leg(`front-${s}`), leg(`rear-${s}`), 0.255 * k);
  }
  stretcher("stretcher-front", leg("front-l"), leg("front-r"), 0.195 * k);
  stretcher("stretcher-back", leg("rear-l"), leg("rear-r"), 0.195 * k);

  // The seat: a slim rim round a solid panel, the pad on top. Its outline
  // runs counter-clockwise in plan (x, z), so its faces turn outward.
  const rimOutline = roundedOutline(
    [
      [-frontSeat[0] - legR * 0.4, frontSeat[1] - legR * 0.6],
      [frontSeat[0] + legR * 0.4, frontSeat[1] - legR * 0.6],
      [rearSeat[0] + legR * 0.2, rearSeat[1] + legR * 0.2],
      [-rearSeat[0] - legR * 0.2, rearSeat[1] + legR * 0.2],
    ],
    0.028,
    detail.level === "full" ? 6 : 4,
    detail.level === "full" ? 40 : 24,
  );
  const seatSlab = aoBox(
    [frontSeat[0] * 2 + 0.02, rimHeight + 0.05, rearSeat[1] - frontSeat[1] + 0.02],
    [0, rimBottom + (rimHeight + 0.05) / 2, (frontSeat[1] + rearSeat[1]) / 2],
    "seat",
  );
  const boxes: AoBox[] = [
    ...members.map((member) => aoRod(member.from, member.to, member.radius * 1.8, member.tag)),
    seatSlab,
  ];

  // The spindles are too fine to shade anything but themselves: the bake
  // leaves them out (they still cast the sun's shadow).
  const shading = boxes.filter((box) => box.tag === undefined || !box.tag.startsWith("spindle"));
  const parts: CraftedPart[] = [];
  const gilt = (geometry: BufferGeometry, self: readonly string[]): void => {
    parts.push({ material: "gilt", geometry: occlude(geometry, { boxes: shading, self, floor: CHAIR_FLOOR, strength: 0.85 }) });
  };

  for (const member of members) {
    gilt(bamboo(member, member.thin === true ? detail.rodRadial : detail.radial), [member.tag]);
  }
  // Finials capping the uprights.
  for (const side of [-1, 1] as const) {
    const finial = lathe([[0, 0.012], [legR * 0.55, 0.0105], [legR * 0.95, 0.006], [legR, 0]], detail.radial);
    finial.translate(side * rearTop[0], topY, rearTop[1]);
    gilt(finial, [`upright-${side < 0 ? "l" : "r"}`]);
  }
  // The rim: a band round the seat's outline, its top edge rounded.
  gilt(rimBand(rimOutline, rimBottom, seatTop, 0.011), ["seat"]);
  // The panel inside the rim, seen only from below.
  gilt(
    roundedBox([frontSeat[0] * 2, 0.012, rearSeat[1] - frontSeat[1]], 0.004, [0, rimBottom + 0.01, (frontSeat[1] + rearSeat[1]) / 2], { segments: 1 }),
    ["seat"],
  );

  // Small nylon glides under the feet.
  for (const member of members.filter((m) => m.tag.startsWith("front") || m.tag.startsWith("rear"))) {
    parts.push({
      material: "glide",
      geometry: occlude(post([member.from[0], member.from[2]], 0, 0.007, legR * 0.95, legR * 0.9, detail.rodRadial + 1), { floor: STANDING_FLOOR }),
    });
  }
  // The shade each foot leaves on the boards.
  const feet = members.filter((m) => m.tag.startsWith("front") || m.tag.startsWith("rear"));
  parts.push({ material: "contact", geometry: contactSpots(feet.map((m) => ({ x: m.from[0], z: m.from[2], radius: legR * 3.2 }))) });

  // The pad: ivory leatherette, thick and rounded, its back corners cut in
  // clear of the uprights, piped round its top edge.
  const padInset = legR * 1.4;
  const padOutline = roundedOutline(
    [
      [-frontSeat[0] - 0.004, frontSeat[1] - legR * 0.8],
      [frontSeat[0] + 0.004, frontSeat[1] - legR * 0.8],
      [rearSeat[0] - padInset, rearSeat[1] - 0.004],
      [-rearSeat[0] + padInset, rearSeat[1] - 0.004],
    ],
    0.042,
    detail.level === "full" ? 7 : 5,
    detail.level === "full" ? 36 : 22,
  );
  const padThickness = 0.046 * k;
  const pad = cushion({
    outline: padOutline,
    thickness: padThickness,
    dome: 0.007,
    edge: 0.016,
    faceRings: detail.cushionRings,
    undersideRings: 1,
    edgeSteps: detail.cushionEdge,
  });
  pad.translate(0, seatTop + padThickness / 2 - 0.002, 0);
  const padBoxes = shading.filter((box) => box.tag !== "seat");
  parts.push({ material: "pad-ivory", geometry: occlude(pad, { boxes: padBoxes, strength: 0.8 }) });
  if (detail.level === "full") {
    // The piping, a fine bead where the top panel meets the side.
    const bead = padOutline.points.map(([x, z], i): Vec3 => {
      const normal = padOutline.normals[i] ?? [0, 0];
      return [x - normal[0] * 0.009, seatTop + padThickness - 0.011, z - normal[1] * 0.009];
    });
    parts.push({
      material: "pad-ivory",
      geometry: occlude(tube({ points: bead, radius: 0.0032, closed: true, segmentsPerMetre: 70, radialSegments: 6, tension: 0.5 }), {
        boxes: padBoxes,
        strength: 0.8,
      }),
    });
  }

  // The sun's shadow: the same members as boxes, the seat as one slab. A
  // phone's coarser map gets no spindles, which would only flicker in it.
  parts.push({
    material: "shadow-caster",
    geometry: casterGeometry(
      detail.level === "full" ? boxes : boxes.filter((box) => box.tag === undefined || !box.tag.startsWith("spindle")),
      { inset: 0.002, minimum: detail.level === "full" ? 0.008 : 0.012 },
    ),
  });
  return parts;
}
