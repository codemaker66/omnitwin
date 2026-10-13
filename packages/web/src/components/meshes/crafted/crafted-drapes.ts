import type { BufferGeometry } from "three";
import {
  emergence,
  gridSurface,
  layoutCornerCentres,
  outlineLayout,
  roundedRectPoint,
  type Vec3,
} from "./crafted-geometry.js";

// ---------------------------------------------------------------------------
// Crafted drapery
//
// The dressing on the ceremony table: a swag caught up at the corners of a
// long side, falling in a curve with its folds following the curve, and at
// each corner a cascade of pleats to the floor that hides where the swags
// are caught. Every layer is pinned under the top cloth's lip and comes away
// from the table on one emergence curve (crafted-geometry.ts), each standing
// further out than the layer behind it, so the skirt's folds never show
// through a swag and a swag never shows through a cascade.
// ---------------------------------------------------------------------------

export interface SwagOptions {
  /** Length of the side the swag hangs along (x), centred on zero. */
  readonly length: number;
  /** Half the table's depth: the swag hangs in front of the side at z = -halfDepth. */
  readonly halfDepth: number;
  /** Height of the table top. */
  readonly top: number;
  /** How far below the top the swag is pinned, under the top cloth's lip. */
  readonly pinned: number;
  /** How far below its pins the swag takes to come away from the table. */
  readonly emergeOver: number;
  /** Depth of the swag's curve at its middle. */
  readonly sag: number;
  /** Depth of the swag at its ends, where the cascades cover it. */
  readonly endDrop: number;
  /** How far it stands out once it has come away from the table. */
  readonly standOff: number;
  /** How far its lower edge swings out. */
  readonly bulge: number;
  /** Folds following the curve. */
  readonly folds: number;
  readonly foldDepth: number;
}

/** A swag on the table's -z side; rotate it for the other sides. Normals face out. */
export function swag(options: SwagOptions): BufferGeometry {
  const columns = Math.max(48, Math.round(options.length * 90));
  const rowCount = 16;
  const rows: Vec3[][] = [];
  const uvs: [number, number][][] = [];
  for (let r = 0; r <= rowCount; r += 1) {
    const v = r / rowCount;
    const row: Vec3[] = [];
    const uvRow: [number, number][] = [];
    for (let c = 0; c <= columns; c += 1) {
      const f = c / columns;
      const x = (f - 0.5) * options.length;
      const hang = Math.sin(Math.PI * f);
      const curve = options.endDrop + (options.sag - options.endDrop) * Math.pow(hang, 0.85);
      const below = options.pinned + v * curve;
      const clear = 0.005 + options.standOff * emergence(below, options.pinned, options.emergeOver);
      const fold = options.foldDepth * hang * (1 - Math.cos(2 * Math.PI * v * options.folds)) * 0.5;
      const out = clear + options.bulge * hang * Math.pow(v, 0.8) + fold;
      row.push([x, options.top - below, -(options.halfDepth + out)]);
      uvRow.push([x, below]);
    }
    rows.push(row);
    uvs.push(uvRow);
  }
  return gridSurface(rows, uvs, { flip: true });
}

export interface CascadeOptions {
  readonly width: number;
  readonly depth: number;
  readonly top: number;
  /** How far below the top the cascades are pinned, under the top cloth's lip. */
  readonly pinned: number;
  /** How far below their pins they take to come away from the table. */
  readonly emergeOver: number;
  /** Hem height at a cascade's middle. */
  readonly hem: number;
  /** How much higher the hem is at a cascade's edges. */
  readonly hemRise: number;
  /** Half the cascade's width along the edge, at the top and at the hem. */
  readonly halfWidthTop: number;
  readonly halfWidthHem: number;
  /** How far they stand out once they have come away from the table. */
  readonly standOff: number;
  /** Pleats across a cascade and how far they stand out. */
  readonly pleats: number;
  readonly pleatDepth: number;
}

/** A pleated cascade wrapped round each corner of a rectangular table. */
export function cornerCascades(options: CascadeOptions): BufferGeometry[] {
  const halfW = options.width / 2;
  const halfD = options.depth / 2;
  const radius = 0.03;
  const layout = outlineLayout(halfW, halfD, radius);
  const centres = layoutCornerCentres(layout);
  const columns = options.pleats * 10;
  const rowCount = 14;
  const drop = options.top - options.pinned - options.hem;
  return centres.map((centre) => {
    const rows: Vec3[][] = [];
    const uvs: [number, number][][] = [];
    for (let r = 0; r <= rowCount; r += 1) {
      const t = r / rowCount;
      const halfWidth = options.halfWidthTop + (options.halfWidthHem - options.halfWidthTop) * t;
      const row: Vec3[] = [];
      const uvRow: [number, number][] = [];
      for (let c = 0; c <= columns; c += 1) {
        const g = (c / columns) * 2 - 1;
        const u = centre + g * halfWidth;
        const point = roundedRectPoint(halfW, halfD, radius, u / layout.total, layout);
        // A soft zig-zag: each pleat folds forward, then back.
        const zig = Math.abs(((g + 1) * options.pleats) % 2 - 1);
        const pleat = zig * zig * (3 - 2 * zig);
        const below = options.pinned + t * (drop - options.hemRise * g * g);
        const clear = 0.008 + options.standOff * emergence(below, options.pinned, options.emergeOver);
        // Its edges turn back towards the table, as a pleated fall's edges do.
        const edgeReturn = 0.012 * Math.max(0, Math.min(1, (Math.abs(g) - 0.8) / 0.2)) ** 2;
        const out = clear + 0.012 * t + options.pleatDepth * (0.6 + 0.4 * t) * pleat - edgeReturn;
        row.push([point.x + point.nx * out, options.top - below, point.z + point.nz * out]);
        uvRow.push([g * halfWidth, below]);
      }
      rows.push(row);
      uvs.push(uvRow);
    }
    return gridSurface(rows, uvs, { flip: true });
  });
}
