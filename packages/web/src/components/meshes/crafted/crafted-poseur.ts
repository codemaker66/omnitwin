import type { BufferGeometry } from "three";
import { gridSurface, type Vec3 } from "./crafted-geometry.js";

// ---------------------------------------------------------------------------
// Crafted poseur cover
//
// A stretch cover on a folding poseur table, after the supplied poseurs: the
// fabric lies flat on the round top and wraps its edge in a band, sweeps in
// beneath it to a waist about half way down, then widens over the four
// folding legs into a pocket on each foot, drawn up between them in a shallow
// arch. The sweep under the top leaves it nearly flat and reaches the waist
// upright, so the two halves meet without a crease.
// ---------------------------------------------------------------------------

export interface PoseurSize {
  readonly width: number;
  readonly depth: number;
  readonly height: number;
}

/**
 * A quarter superellipse from (0, 0) to (1, 1): upright where it leaves the
 * waist, flat where it reaches the rim. `m` near 1 is a cone, 2 an ellipse.
 */
function sweep(u: number, m: number): number {
  const k = Math.max(0, Math.min(1, u));
  return 1 - Math.pow(1 - Math.pow(k, m), 1 / m);
}

/** The cover of a poseur table sized to `size`; normals face out. */
export function poseurCover(size: PoseurSize): BufferGeometry {
  const radius = Math.min(size.width, size.depth) / 2;
  const top = size.height;
  // The fabric over the top's edge: a rounded band.
  const roll = 0.012;
  const band = 0.014;
  const waist = radius * 0.43;
  const waistY = top * 0.5;
  // The feet reach almost to the top's edge, as a stable base must.
  const footReach = radius * 0.95;
  // Between the feet the hem rises in an arch and draws in to a straight line.
  const arch = 0.08;
  const draw = 0.74;
  const segments = 128;

  interface Ring {
    readonly radiusAt: (lobe: number) => number;
    readonly yAt: (lobe: number) => number;
  }
  const fixed = (r: number, y: number): Ring => ({ radiusAt: () => r, yAt: () => y });
  const rings: Ring[] = [];
  // The top, from the centre out to where the fabric rolls over the edge.
  const topRings = 4;
  for (let i = 0; i <= topRings; i += 1) rings.push(fixed((radius - roll) * Math.sqrt(i / topRings), top));
  // Over the edge, down the band, and round under the top.
  const rollSteps = 4;
  for (let i = 1; i <= rollSteps; i += 1) {
    const a = (i / rollSteps) * (Math.PI / 2);
    rings.push(fixed(radius - roll + Math.sin(a) * roll, top - roll + Math.cos(a) * roll));
  }
  rings.push(fixed(radius, top - roll - band));
  for (let i = 1; i <= rollSteps; i += 1) {
    const a = (i / rollSteps) * (Math.PI / 2);
    rings.push(fixed(radius - roll + Math.cos(a) * roll, top - roll - band - Math.sin(a) * roll));
  }
  // Beneath the top to the waist.
  const underside = top - 2 * roll - band;
  const rim = radius - roll;
  const upperRows = 18;
  for (let i = 1; i <= upperRows; i += 1) {
    // Rows bunch towards the rim, where the sweep turns fastest.
    const s = Math.pow(i / upperRows, 1.6);
    const y = underside + (waistY - underside) * s;
    rings.push(fixed(waist + (rim - waist) * sweep(1 - s, 1.8), y));
  }
  // From the waist down to the hem, opening into a pocket over each foot.
  const lowerRows = 22;
  for (let i = 1; i <= lowerRows; i += 1) {
    const t = i / lowerRows;
    const widen = 0.55 * Math.pow(t, 1.4) + 0.45 * Math.pow(t, 7);
    rings.push({
      radiusAt: (lobe) => waist + (footReach * (draw + (1 - draw) * lobe) - waist) * widen,
      yAt: (lobe) => {
        const hemY = 0.004 + arch * Math.pow(1 - lobe, 1.2);
        return waistY + (hemY - waistY) * t;
      },
    });
  }

  const rows: Vec3[][] = [];
  const uvs: [number, number][][] = [];
  let arc = 0;
  let previous: { readonly r: number; readonly y: number } | null = null;
  for (const ring of rings) {
    // UV v follows the profile's length along a foot's line.
    const r0 = ring.radiusAt(1);
    const y0 = ring.yAt(1);
    if (previous !== null) arc += Math.hypot(r0 - previous.r, y0 - previous.y);
    previous = { r: r0, y: y0 };
    const row: Vec3[] = [];
    const uvRow: [number, number][] = [];
    for (let s = 0; s <= segments; s += 1) {
      const phase = (s / segments) * Math.PI * 2;
      // Feet on the diagonals; 1 over a foot, 0 midway between two.
      const lobe = Math.cos(2 * (phase - Math.PI / 4)) ** 2;
      const r = ring.radiusAt(lobe);
      row.push([Math.cos(phase) * r, ring.yAt(lobe), Math.sin(phase) * r]);
      uvRow.push([phase * radius, arc]);
    }
    rows.push(row);
    uvs.push(uvRow);
  }
  return gridSurface(rows, uvs, { closed: true, flip: true });
}
