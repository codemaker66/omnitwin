// -----------------------------------------------------------------------------
// viewbox — the River Gate's drawing space and the arithmetic that keeps the
// tableau, the Lantern and the prop boxes agreeing about where things are.
//
// Every plane of the scene is drawn in one 1600 x 900 viewBox and rendered
// with preserveAspectRatio "xMidYMid slice": the drawing always fills the
// tableau, the sides are sliced away on a 9:16 phone, and the port, the
// lantern and the traveller sit inside the 592..1008 window that survives
// the narrowest crop. Because the manifest's prop boxes and the Lantern's
// lights are normalised to the tableau, not to the drawing, this module
// carries the one projection both need.
//
// Provenance: Pr, drawn by code. No Math.random anywhere in the art: the
// hand-drawn wobble is a fixed hash of the vertex index, identical for
// everyone and on every render.
// -----------------------------------------------------------------------------

export const RIVER_GATE_VIEWBOX = { width: 1600, height: 900 } as const;
export const RIVER_GATE_VIEWBOX_ATTR = `0 0 ${String(RIVER_GATE_VIEWBOX.width)} ${String(RIVER_GATE_VIEWBOX.height)}`;
export const RIVER_GATE_PRESERVE_ASPECT = "xMidYMid slice";

/** The horizon (the far waterline) sits at 58% of the height: the river is the lower 42%. */
export const RIVER_GATE_HORIZON_Y = 522;

export interface ViewBoxPoint {
  readonly x: number;
  readonly y: number;
}

export interface ViewBoxRect extends ViewBoxPoint {
  readonly w: number;
  readonly h: number;
}

/** A point normalised to the tableau, 0..1, y down (the stage's and the Lantern's convention). */
export interface TableauPoint {
  readonly x: number;
  readonly y: number;
}

/** A box in percent of the tableau, the manifest's prop-box convention. */
export interface TableauPercentBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * How "xMidYMid slice" places the drawing inside a tableau of the given
 * size: one uniform scale (the larger of the two ratios) and an offset that
 * centres the overflow. Sizes are in any unit; only their ratio matters.
 */
export function sliceTransform(tableauWidth: number, tableauHeight: number): { readonly scale: number; readonly offsetX: number; readonly offsetY: number } {
  const width = tableauWidth > 0 ? tableauWidth : RIVER_GATE_VIEWBOX.width;
  const height = tableauHeight > 0 ? tableauHeight : RIVER_GATE_VIEWBOX.height;
  const scale = Math.max(width / RIVER_GATE_VIEWBOX.width, height / RIVER_GATE_VIEWBOX.height);
  return {
    scale,
    offsetX: (width - RIVER_GATE_VIEWBOX.width * scale) / 2,
    offsetY: (height - RIVER_GATE_VIEWBOX.height * scale) / 2,
  };
}

/** A drawing point to a normalised tableau point for a tableau of the given size. */
export function viewBoxToTableau(point: ViewBoxPoint, tableauWidth: number, tableauHeight: number): TableauPoint {
  const width = tableauWidth > 0 ? tableauWidth : RIVER_GATE_VIEWBOX.width;
  const height = tableauHeight > 0 ? tableauHeight : RIVER_GATE_VIEWBOX.height;
  const { scale, offsetX, offsetY } = sliceTransform(width, height);
  return {
    x: (offsetX + point.x * scale) / width,
    y: (offsetY + point.y * scale) / height,
  };
}

/**
 * A drawing rect to a percent box of the tableau, clamped to the tableau so
 * a box that is partly sliced away on a phone stays a valid manifest box
 * (the schema forbids negative x and widths under half a percent).
 */
export function viewBoxRectToTableauPercent(rect: ViewBoxRect, tableauWidth: number, tableauHeight: number): TableauPercentBox {
  const topLeft = viewBoxToTableau(rect, tableauWidth, tableauHeight);
  const bottomRight = viewBoxToTableau({ x: rect.x + rect.w, y: rect.y + rect.h }, tableauWidth, tableauHeight);
  const left = Math.max(0, Math.min(1, topLeft.x));
  const top = Math.max(0, Math.min(1, topLeft.y));
  const right = Math.max(0, Math.min(1, bottomRight.x));
  const bottom = Math.max(0, Math.min(1, bottomRight.y));
  return {
    x: left * 100,
    y: top * 100,
    w: Math.max(0.5, (right - left) * 100),
    h: Math.max(0.5, (bottom - top) * 100),
  };
}

/** The inverse of the 16:9 case: a manifest percent box back to drawing units. */
export function tableauPercentToViewBoxRect(box: TableauPercentBox): ViewBoxRect {
  return {
    x: (box.x / 100) * RIVER_GATE_VIEWBOX.width,
    y: (box.y / 100) * RIVER_GATE_VIEWBOX.height,
    w: (box.w / 100) * RIVER_GATE_VIEWBOX.width,
    h: (box.h / 100) * RIVER_GATE_VIEWBOX.height,
  };
}

/**
 * The manifest's prop boxes are authored in percent of the 16:9 drawing.
 * On any other tableau aspect the slice moves them; this remaps one box for
 * the tableau the stage actually has. Pure, so the stage can call it per
 * resize without a listener of its own.
 */
export function riverGatePropBoxFor(box: TableauPercentBox, tableauWidth: number, tableauHeight: number): TableauPercentBox {
  return viewBoxRectToTableauPercent(tableauPercentToViewBoxRect(box), tableauWidth, tableauHeight);
}

/**
 * The deterministic hand: a hash of the vertex index and a salt, in [-1, 1).
 * A sine hash rather than an LCG because it needs no state and gives the
 * same value for the same vertex on every machine; nothing about it is
 * random, which is what the fairness lint requires of the art.
 */
export function handJitter(index: number, salt: number): number {
  const s = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/**
 * Turn an authored polyline into a hand-drawn one: long runs are broken
 * into strokes of about `stride` units so a ridge or a shore is never a
 * ruler line, then every vertex takes a small fixed tremor. Small features
 * (a chimney six units wide) keep their shape because the tremor is well
 * under a unit.
 */
export function handDrawn(points: readonly ViewBoxPoint[], stride = 22, tremor = 0.55, salt = 1): ViewBoxPoint[] {
  const out: ViewBoxPoint[] = [];
  let vertexIndex = 0;
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (point === undefined) continue;
    const previous = i > 0 ? points[i - 1] : undefined;
    if (previous !== undefined) {
      const dx = point.x - previous.x;
      const dy = point.y - previous.y;
      const length = Math.hypot(dx, dy);
      const pieces = Math.floor(length / stride);
      for (let k = 1; k <= pieces; k += 1) {
        const t = k / (pieces + 1);
        vertexIndex += 1;
        out.push({
          x: previous.x + dx * t + handJitter(vertexIndex, salt) * tremor * 0.6,
          y: previous.y + dy * t + handJitter(vertexIndex, salt + 3) * tremor,
        });
      }
    }
    vertexIndex += 1;
    out.push({
      x: point.x + handJitter(vertexIndex, salt) * tremor * 0.6,
      y: point.y + handJitter(vertexIndex, salt + 3) * tremor,
    });
  }
  return out;
}

const fixed = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

/** An open path ("M x y L x y ...") over the points. */
export function polylinePath(points: readonly ViewBoxPoint[]): string {
  let path = "";
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (point === undefined) continue;
    path += `${i === 0 ? "M" : " L"} ${fixed(point.x)} ${fixed(point.y)}`;
  }
  return path;
}

/** The same polyline closed down to a floor line and back, for a filled silhouette. */
export function silhouettePath(points: readonly ViewBoxPoint[], floorY: number): string {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return "";
  return `${polylinePath(points)} L ${fixed(last.x)} ${fixed(floorY)} L ${fixed(first.x)} ${fixed(floorY)} Z`;
}

/** Bytes of authored geometry, for the manifest's honest `bytes` field. */
export function byteLength(...parts: readonly string[]): number {
  const encoder = new TextEncoder();
  return parts.reduce((total, part) => total + encoder.encode(part).length, 0);
}
