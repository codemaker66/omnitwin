import { type BufferGeometry, Matrix4 } from "three";
import {
  cushion,
  post,
  roundedOutline,
  tube,
  type Vec2,
  type Vec3,
} from "./crafted-geometry.js";
import type { CraftedPart } from "./crafted-model.js";

// ---------------------------------------------------------------------------
// Crafted banquet chairs
//
// After the Burgess Turini 18/3 Blake supplied: a stacking banquet chair whose
// rear legs and back frame are one bent steel tube, lacquered mahogany red;
// front legs that bend back into the seat rails; a domed seat cushion with a
// rolled edge; and a reclined, gently curved back cushion with a handle slot.
// Drawn to the catalogue's width, depth and height, facing -Z (the planner's
// seated forward axis, so saved poses face their tables).
// ---------------------------------------------------------------------------

export interface ChairSize {
  readonly width: number;
  readonly depth: number;
  readonly height: number;
}

export type ChairFabric = "velvet-coral" | "check-coral";

const TUBE = 0.0105;
const GLIDE = 0.0125;
const RECLINE = (12 * Math.PI) / 180;
/** How much the back's edges come forward: metres per metre squared across it. */
const BACK_CURVE = 0.3;

/** Samples a closed, counter-clockwise outline and gives each sample its outward normal. */
function sampledOutline(points: readonly Vec2[]): { points: Vec2[]; normals: Vec2[] } {
  const normals: Vec2[] = points.map((_, index) => {
    const previous = points[(index - 1 + points.length) % points.length] ?? [0, 0];
    const next = points[(index + 1) % points.length] ?? [0, 0];
    const ta = next[0] - previous[0];
    const tb = next[1] - previous[1];
    const length = Math.hypot(ta, tb) || 1;
    return [tb / length, -ta / length];
  });
  return { points: [...points], normals };
}

/**
 * The back cushion's outline: rounded lower corners, straight sides and an
 * arched top dipped at its centre, which leaves the hand-hold between the
 * cushion and the frame's top rail.
 */
function backOutline(width: number, height: number, rise: number, notch: number): { points: Vec2[]; normals: Vec2[] } {
  const half = width / 2;
  const corner = 0.035;
  const points: Vec2[] = [];
  // Bottom edge, left to right.
  for (let i = 0; i <= 8; i += 1) points.push([-half + corner + (i / 8) * (width - 2 * corner), 0]);
  // Bottom-right corner.
  for (let i = 1; i < 6; i += 1) {
    const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2);
    points.push([half - corner + Math.cos(a) * corner, corner + Math.sin(a) * corner]);
  }
  // Right side, up to where the arch starts.
  const shoulder = height - rise;
  for (let i = 0; i <= 6; i += 1) points.push([half, corner + (i / 6) * (shoulder - corner)]);
  // The arch: a smooth curve over the top, steepest at the shoulders.
  const notchHalfWidth = 0.068;
  for (let i = 1; i < 30; i += 1) {
    const t = i / 30;
    const x = half * Math.cos(t * Math.PI);
    const k = Math.max(0, 1 - (x / notchHalfWidth) ** 2);
    const y = shoulder + rise * Math.sin(t * Math.PI) - notch * k * k;
    points.push([x, y]);
  }
  // Left side, down.
  for (let i = 0; i <= 6; i += 1) points.push([-half, shoulder - (i / 6) * (shoulder - corner)]);
  // Bottom-left corner.
  for (let i = 1; i < 6; i += 1) {
    const a = Math.PI + (i / 6) * (Math.PI / 2);
    points.push([-half + corner + Math.cos(a) * corner, corner + Math.sin(a) * corner]);
  }
  return sampledOutline(points);
}

function transformed(geometry: BufferGeometry, matrix: Matrix4): BufferGeometry {
  geometry.applyMatrix4(matrix);
  return geometry;
}

/** The parts of a banquet chair sized to `size`, upholstered in `fabric`. */
export function banquetChairParts(size: ChairSize, fabric: ChairFabric): CraftedPart[] {
  const { width, depth, height } = size;
  const halfDepth = depth / 2;
  // Frame lines (tube centres), set in so the splayed rear glides stay
  // within the chair's width.
  const footSplay = 0.008;
  const rearSplay = 0.016;
  const xs = width / 2 - GLIDE - rearSplay - 0.001;
  const seatRail = 0.405 * (height / 0.88);
  const seatTop = seatRail + 0.065;
  const frontFootZ = -halfDepth + TUBE + 0.003;
  const frontTopZ = frontFootZ + 0.035;
  const rearFootZ = halfDepth - TUBE - 0.003;
  // Where the rear leg meets the seat rail; the back rises from here.
  const junctionZ = rearFootZ - (seatRail - TUBE) * 0.3;
  const zAt = (y: number): number => junctionZ + (y - seatRail) * Math.tan(RECLINE);
  const topY = height - TUBE;
  const shoulderY = topY - 0.15;

  const parts: CraftedPart[] = [];
  const frame = (points: Vec3[], tension = 0.12): void => {
    parts.push({ material: "frame-lacquer", geometry: tube({ points, radius: TUBE, tension, segmentsPerMetre: 50, radialSegments: 8 }) });
  };

  // Rear legs and back frame: one continuous bent tube, foot to foot.
  const back: Vec3[] = [];
  for (const side of [-1, 1] as const) {
    const leg: Vec3[] = [
      [side * (xs + rearSplay), GLIDE + 0.004, rearFootZ],
      [side * (xs + rearSplay * 0.5), seatRail * 0.5, rearFootZ - (seatRail * 0.5) * 0.3],
      [side * xs, seatRail, junctionZ],
      [side * xs, (seatRail + shoulderY) / 2, zAt((seatRail + shoulderY) / 2)],
      [side * xs, shoulderY, zAt(shoulderY)],
    ];
    if (side === -1) back.push(...leg);
    else back.push(...leg.reverse());
    if (side === -1) {
      // Over the top: an arch rising to the centre, rounded into the uprights.
      const arch: Vec3[] = [];
      for (let i = 1; i < 10; i += 1) {
        const t = i / 10;
        const x = -xs * Math.cos(t * Math.PI);
        const y = shoulderY + (topY - shoulderY) * Math.sin(t * Math.PI);
        arch.push([x, y, zAt(y) + 0.004 * Math.sin(t * Math.PI)]);
      }
      back.push(...arch);
    }
  }
  frame(back, 0.08);

  // Front legs, bending back into the seat side rails.
  for (const side of [-1, 1] as const) {
    frame([
      [side * (xs + footSplay), GLIDE + 0.004, frontFootZ],
      [side * (xs + footSplay * 0.5), seatRail * 0.55, (frontFootZ + frontTopZ) / 2],
      [side * xs, seatRail - 0.03, frontTopZ],
      [side * xs, seatRail - 0.004, frontTopZ + 0.022],
      [side * xs, seatRail, frontTopZ + 0.06],
      // Into the rear leg, so the rail's open end is hidden inside it.
      [side * xs, seatRail, junctionZ],
    ]);
  }
  // Seat cross rails, front and back, under the cushion.
  frame([[-xs, seatRail - 0.012, frontTopZ + 0.03], [xs, seatRail - 0.012, frontTopZ + 0.03]], 0);
  frame([[-xs, seatRail - 0.012, junctionZ - 0.03], [xs, seatRail - 0.012, junctionZ - 0.03]], 0);

  // Glides under the four feet.
  for (const [x, z, splay] of [[-1, frontFootZ, footSplay], [1, frontFootZ, footSplay], [-1, rearFootZ, rearSplay], [1, rearFootZ, rearSplay]] as const) {
    parts.push({ material: "glide", geometry: post([x * (xs + splay), z], 0, GLIDE + 0.006, TUBE * 1.15, TUBE * 1.05) });
  }

  // Seat cushion: wider at the front, domed, with a rolled edge. Its outline
  // runs counter-clockwise in plan (x, z), so the cushion faces up.
  const seatFrontZ = frontFootZ + 0.012;
  const seatBackZ = junctionZ - 0.005;
  const seatFrontHalf = width / 2 - 0.012;
  const seatBackHalf = xs + TUBE * 0.4;
  const seatOutline = roundedOutline(
    [
      [-seatFrontHalf, seatFrontZ],
      [seatFrontHalf, seatFrontZ],
      [seatBackHalf, seatBackZ],
      [-seatBackHalf, seatBackZ],
    ],
    0.05,
    6,
    45,
  );
  const seatThickness = 0.062;
  const seat = cushion({ outline: seatOutline, thickness: seatThickness, dome: 0.012, edge: 0.024, faceRings: 4, undersideRings: 1, edgeSteps: 7 });
  seat.translate(0, seatTop - seatThickness / 2 - 0.006, 0);
  parts.push({ material: fabric, geometry: seat });

  // Back cushion: in the reclined plane, curved to the sitter, with a handle slot.
  const backBottom = seatTop + 0.06;
  const backTop = topY - TUBE * 0.9;
  const backHeight = (backTop - backBottom) / Math.cos(RECLINE);
  // Just inside the uprights, so the frame shows along its sides.
  const backWidth = 2 * xs - 0.004;
  const backThickness = 0.05;
  const backShape = cushion({
    outline: backOutline(backWidth, backHeight, (topY - shoulderY) * 0.95, 0.034),
    thickness: backThickness,
    dome: 0.014,
    edge: 0.018,
    faceRings: 4,
    undersideRings: 2,
    edgeSteps: 7,
  });
  // Curve: the edges come forward to hold the sitter.
  const position = backShape.getAttribute("position");
  for (let index = 0; index < position.count; index += 1) {
    const a = position.getX(index);
    position.setY(index, position.getY(index) + BACK_CURVE * a * a);
  }
  backShape.computeVertexNormals();
  // Stand it up: thickness along -z (domed face to the sitter), height along +y,
  // then recline about the seat line and set it just in front of the frame.
  const stand = new Matrix4().makeRotationX(-Math.PI / 2);
  const recline = new Matrix4().makeRotationX(RECLINE);
  const place = new Matrix4().makeTranslation(0, backBottom, zAt(backBottom) - TUBE * 0.6 - backThickness / 2 + 0.006);
  transformed(backShape, place.multiply(recline).multiply(stand));
  parts.push({ material: fabric, geometry: backShape });

  return parts;
}
