// -----------------------------------------------------------------------------
// room-plan — the venue's published capacities, drawn to count.
//
// Pure geometry: given a format and its published capacity, lay out exactly
// that many seats as dots in a 320x200 plate. Theatre and classroom are
// ranked grids (classroom nudges into desk pairs), dinner is rounds of ten,
// reception is a sunflower scatter — deterministic in every case, so the
// same number always draws the same room. The invariant the tests pin:
// dots.length === the published capacity, never an approximation.
// -----------------------------------------------------------------------------

import type { RoomCapacity } from "../../lib/trades-hall-venue-truth.js";

export interface PlanDot {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

export interface PlanTable {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

export interface RoomPlan {
  readonly width: number;
  readonly height: number;
  readonly dots: readonly PlanDot[];
  readonly tables: readonly PlanTable[];
  /** Always dots.length — stated for the caption. */
  readonly count: number;
}

const W = 320;
const H = 200;
const MARGIN = 18;
const INNER_W = W - MARGIN * 2;
const INNER_H = H - MARGIN * 2;

/** Ranked rows, each row centred; classroom nudges columns into pairs. */
function rankedGrid(count: number, paired: boolean): RoomPlan {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count * (INNER_W / INNER_H))));
  const rows = Math.max(1, Math.ceil(count / cols));
  const cellW = INNER_W / cols;
  const cellH = INNER_H / rows;
  const r = Math.min(4.2, Math.min(cellW, cellH) * 0.3);
  const dots: PlanDot[] = [];
  for (let i = 0; i < count; i += 1) {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, count - row * cols);
    const col = i - row * cols;
    const startX = MARGIN + (INNER_W - inRow * cellW) / 2 + cellW / 2;
    const pairNudge = paired ? (col % 2 === 0 ? cellW * 0.12 : -cellW * 0.12) : 0;
    dots.push({
      x: startX + col * cellW + pairNudge,
      y: MARGIN + cellH / 2 + row * cellH,
      r,
    });
  }
  return { width: W, height: H, dots, tables: [], count: dots.length };
}

/** Rounds of ten: full tables, the last takes the remainder. */
function dinnerRounds(count: number): RoomPlan {
  const tableCount = Math.max(1, Math.ceil(count / 10));
  const cols = Math.max(1, Math.ceil(Math.sqrt(tableCount * (INNER_W / INNER_H))));
  const rows = Math.max(1, Math.ceil(tableCount / cols));
  const cellW = INNER_W / cols;
  const cellH = INNER_H / rows;
  const tableR = Math.min(cellW, cellH) * 0.24;
  const seatRing = tableR * 1.5;
  const seatR = Math.max(1.4, tableR * 0.2);
  const tables: PlanTable[] = [];
  const dots: PlanDot[] = [];
  let seated = 0;
  for (let t = 0; t < tableCount; t += 1) {
    const row = Math.floor(t / cols);
    const inRow = Math.min(cols, tableCount - row * cols);
    const col = t - row * cols;
    const startX = MARGIN + (INNER_W - inRow * cellW) / 2 + cellW / 2;
    const cx = startX + col * cellW;
    const cy = MARGIN + cellH / 2 + row * cellH;
    tables.push({ x: cx, y: cy, r: tableR });
    const seatsHere = Math.min(10, count - seated);
    for (let s = 0; s < seatsHere; s += 1) {
      const angle = (s / seatsHere) * Math.PI * 2 - Math.PI / 2 + t * 0.35;
      dots.push({
        x: cx + Math.cos(angle) * seatRing,
        y: cy + Math.sin(angle) * seatRing,
        r: seatR,
      });
    }
    seated += seatsHere;
  }
  return { width: W, height: H, dots, tables, count: dots.length };
}

/** Standing scatter: a golden-angle sunflower squeezed into the plate —
 *  organic to the eye, identical on every render. */
function receptionScatter(count: number): RoomPlan {
  const GOLDEN_ANGLE = 2.399963229728653;
  const cx = W / 2;
  const cy = H / 2;
  const r = count > 150 ? 2.1 : 2.7;
  const dots: PlanDot[] = [];
  for (let i = 0; i < count; i += 1) {
    const radial = Math.sqrt((i + 0.5) / count);
    const angle = i * GOLDEN_ANGLE;
    dots.push({
      x: cx + Math.cos(angle) * radial * (INNER_W / 2) * 0.97,
      y: cy + Math.sin(angle) * radial * (INNER_H / 2) * 0.97,
      r,
    });
  }
  return { width: W, height: H, dots, tables: [], count: dots.length };
}

export function roomPlan(format: keyof RoomCapacity, capacity: number): RoomPlan {
  const count = Math.max(0, Math.round(capacity));
  if (count === 0) return { width: W, height: H, dots: [], tables: [], count: 0 };
  switch (format) {
    case "theatre":
      return rankedGrid(count, false);
    case "classroom":
      return rankedGrid(count, true);
    case "dinner":
      return dinnerRounds(count);
    case "reception":
      return receptionScatter(count);
  }
}
