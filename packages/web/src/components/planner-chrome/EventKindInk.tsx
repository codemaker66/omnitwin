import { memo, type ReactElement } from "react";
import type { PlannerEventKind } from "../../stores/planner-event-store.js";

// ---------------------------------------------------------------------------
// The event-kind picker's drawings: each kind's room as the planner sets it,
// seen from above in copper ink (the register's one accent; T-615 retired
// gold). Every stroke has a path length of 1 and an order from 0 (first) to 1
// (last), carried as one of 21 classes (ekp-o0 to ekp-o20, steps of 0.05) that
// event-kind-picker.css turns into --i, so one value per panel, --ekp-ink from
// 0 to 1 on a spring, draws the whole set in: the table first, then its
// chairs, then the room around it.
// ---------------------------------------------------------------------------

interface Stroke {
  readonly d: string;
  readonly order: number;
  readonly faint?: boolean;
}

/** The stroke's order as its class: the nearest twentieth. */
function orderClass(order: number): string {
  return `ekp-o${String(Math.round(Math.min(1, Math.max(0, order)) * 20))}`;
}

const round2 = (value: number): string => value.toFixed(2);

function circle(cx: number, cy: number, r: number): string {
  return `M ${round2(cx - r)} ${round2(cy)} a ${round2(r)} ${round2(r)} 0 1 0 ${round2(2 * r)} 0 a ${round2(r)} ${round2(r)} 0 1 0 ${round2(-2 * r)} 0`;
}

function rect(x: number, y: number, w: number, h: number, r = 0): string {
  if (r === 0) return `M ${round2(x)} ${round2(y)} h ${round2(w)} v ${round2(h)} h ${round2(-w)} Z`;
  const R = round2(r);
  const back = round2(-r);
  return `M ${round2(x + r)} ${round2(y)} h ${round2(w - 2 * r)} a ${R} ${R} 0 0 1 ${R} ${R} v ${round2(h - 2 * r)} a ${R} ${R} 0 0 1 ${back} ${R}`
    + ` h ${round2(-(w - 2 * r))} a ${R} ${R} 0 0 1 ${back} ${back} v ${round2(-(h - 2 * r))} a ${R} ${R} 0 0 1 ${R} ${back} Z`;
}

/**
 * A chair from above: its seat, and its back on the side away from where it
 * faces. (x, y) is the seat's centre; `facing` is the direction the sitter
 * looks, in radians (0 is +x, π/2 is down the drawing).
 */
function chair(x: number, y: number, facing: number, size = 9): string {
  const h = size / 2;
  const cos = Math.cos(facing);
  const sin = Math.sin(facing);
  const at = (u: number, v: number): string => `${round2(x + u * cos - v * sin)} ${round2(y + u * sin + v * cos)}`;
  return `M ${at(-h, -h)} L ${at(h, -h)} L ${at(h, h)} L ${at(-h, h)} Z M ${at(-h - 2.6, -h - 0.4)} L ${at(-h - 2.6, h + 0.4)}`;
}

/** A round table and its chairs, each facing the table, the first at twelve o'clock. */
function roundOf(cx: number, cy: number, r: number, seats: number, from: number, to: number, faint = false, size = 9): Stroke[] {
  const ring = r + size / 2 + 5;
  const strokes: Stroke[] = [{ d: circle(cx, cy, r), order: from, faint }];
  for (let seat = 0; seat < seats; seat += 1) {
    const angle = (seat / seats) * Math.PI * 2 - Math.PI / 2;
    strokes.push({
      d: chair(cx + ring * Math.cos(angle), cy + ring * Math.sin(angle), angle + Math.PI, size),
      order: from + ((to - from) * (seat + 1)) / seats,
      faint,
    });
  }
  return strokes;
}

/** A wedding: the top table along the head of the room, a round of ten, and its neighbours. */
function weddingStrokes(): Stroke[] {
  const strokes: Stroke[] = [{ d: rect(52, 22, 136, 13, 3), order: 0 }];
  for (let seat = 0; seat < 6; seat += 1) strokes.push({ d: chair(67 + seat * 21, 12, Math.PI / 2), order: 0.06 + seat * 0.03 });
  strokes.push(...roundOf(120, 126, 33, 10, 0.3, 0.72));
  strokes.push({ d: circle(120, 126, 26), order: 0.36, faint: true });
  strokes.push(...roundOf(38, 214, 22, 8, 0.76, 0.92, true, 8));
  strokes.push(...roundOf(202, 214, 22, 8, 0.8, 1, true, 8));
  return strokes;
}

/** A corporate event: the lectern on the platform, rows of seats either side of an aisle. */
function corporateStrokes(): Stroke[] {
  const strokes: Stroke[] = [
    { d: rect(34, 12, 172, 26, 2), order: 0, faint: true },
    { d: rect(112, 19, 16, 12, 2), order: 0.1 },
  ];
  const rows = 6;
  const columns = [46, 64, 82, 100, 140, 158, 176, 194];
  for (let row = 0; row < rows; row += 1) {
    const y = 66 + row * 30;
    columns.forEach((x, column) => {
      strokes.push({ d: chair(x, y, -Math.PI / 2), order: 0.18 + row * 0.13 + column * 0.012, faint: row >= 4 });
    });
  }
  return strokes;
}

/** Something else: the hall itself, its fireplace, windows and dome, holding a few loose pieces. */
function otherStrokes(): Stroke[] {
  const strokes: Stroke[] = [
    { d: rect(16, 66, 208, 108, 3), order: 0 },
    { d: "M 16 104 h 8 v 30 h -8", order: 0.14 },
    { d: "M 52 66 a 10 10 0 0 1 20 0 M 110 66 a 10 10 0 0 1 20 0 M 168 66 a 10 10 0 0 1 20 0", order: 0.2, faint: true },
    { d: circle(120, 120, 30), order: 0.28, faint: true },
    { d: "M 196 174 a 16 16 0 0 0 -16 -16", order: 0.34, faint: true },
    { d: circle(62, 96, 6), order: 0.46 },
    { d: circle(96, 150, 6), order: 0.54 },
    { d: circle(150, 98, 6), order: 0.62 },
    { d: rect(140, 136, 50, 12, 2), order: 0.72 },
  ];
  [150, 165, 180].forEach((x, index) => strokes.push({ d: chair(x, 157, -Math.PI / 2, 8), order: 0.8 + index * 0.07 }));
  return strokes;
}

const STROKES: Readonly<Record<PlannerEventKind, readonly Stroke[]>> = {
  wedding: weddingStrokes(),
  corporate: corporateStrokes(),
  other: otherStrokes(),
};

/**
 * One kind's drawing; decorative (the panel's own name says what it is). Each
 * stroke is drawn twice in its turn: a wide, faint pass beneath (the ink's
 * light) and the line itself.
 */
export const EventKindInk = memo(function EventKindInk({ kind }: { readonly kind: PlannerEventKind }): ReactElement {
  const strokes = STROKES[kind];
  const className = (stroke: Stroke, glow: boolean): string =>
    [glow ? "ekp-glow" : "", orderClass(stroke.order), stroke.faint === true ? "is-faint" : ""].filter(Boolean).join(" ");
  return (
    <svg className="ekp-ink" viewBox="0 0 240 240" aria-hidden="true" focusable="false">
      <g>{strokes.map((stroke, index) => <path key={index} d={stroke.d} pathLength={1} className={className(stroke, true)} />)}</g>
      <g>{strokes.map((stroke, index) => <path key={index} d={stroke.d} pathLength={1} className={className(stroke, false)} />)}</g>
    </svg>
  );
});
