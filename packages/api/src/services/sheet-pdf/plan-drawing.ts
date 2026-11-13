import type { HallkeeperFloorPlan } from "@omnitwin/types";
import { projectHallkeeperFloorPlan, type PlanViewport } from "../hallkeeper-floor-plan.js";
import { INK, TYPE, drawLine, textWidth, type Doc, type TextStyle } from "./style.js";

// ---------------------------------------------------------------------------
// The room drawn from the layout's frozen catalogue footprints: one uniform
// scale, looking down, North at the top as the zone names have it. The
// planner's table names sit on their tables (or beside a piece too narrow
// for its name), and a piece that carries a planner's note wears the copper
// number its note has under its setup line.
// ---------------------------------------------------------------------------

/** Space kept round the room for the wall names. */
export const WALL_BAND = 14;

const WALL_STYLE: TextStyle = { face: "Inter-Medium", size: 6.4, color: INK.quiet, tracking: 0.6, upper: true };

interface PieceStyle { readonly fill: string; readonly stroke: string; readonly weight: number }

function pieceStyle(category: string): PieceStyle {
  if (category === "chair") return { fill: "#ffffff", stroke: INK.chairLine, weight: 0.35 };
  if (category === "table") return { fill: INK.tableFill, stroke: INK.secondary, weight: 0.55 };
  if (category === "stage") return { fill: INK.stageFill, stroke: INK.edge, weight: 0.4 };
  return { fill: "#ffffff", stroke: INK.secondary, weight: 0.55 };
}

/** "Table 5" prints as "5"; any other name prints as written. */
export function planLabel(label: string): string {
  const numbered = /^table\s+(\S+)$/iu.exec(label.trim());
  return numbered?.[1] ?? label.trim();
}

export function drawMarker(doc: Doc, number: number, cx: number, cy: number, radius = 4.8): void {
  doc.save().circle(cx, cy, radius).lineWidth(0.8).fillAndStroke("#ffffff", INK.accent).restore();
  const style: TextStyle = { face: "Inter-SemiBold", size: radius * 1.25, color: INK.accent, tnum: true };
  const text = String(number);
  drawLine(doc, style, text, cx - textWidth(doc, style, text) / 2, cy - radius * 0.62);
}

function tracePath(doc: Doc, points: readonly { readonly x: number; readonly y: number }[]): void {
  for (const [index, point] of points.entries()) {
    if (index === 0) doc.moveTo(point.x, point.y);
    else doc.lineTo(point.x, point.y);
  }
  doc.closePath();
}

/** How far a care ring reaches beyond its table's own edge: past the chairs set round it. */
const RING_REACH_M = 0.7;

/** A planner's name too wide for its piece, set beside it instead: one size, on clear floor. */
const BESIDE_STYLE: TextStyle = { face: "Inter-SemiBold", size: 7, color: INK.primary };
/** The space between a piece and a name set beside it. */
const BESIDE_GAP = 1.5;
/** The least floor a name set beside its piece keeps from every other piece, number and name: twice its gap to its own, so it reads as its own piece's. */
const BESIDE_CLEAR = 3;
/** A note's copper number on the plan. */
const MARKER_R = 4.8;

interface Rect { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }

type PlanDrawing = ReturnType<typeof projectHallkeeperFloorPlan>;
type PlanPiece = PlanDrawing["objects"][number];
const NONE: ReadonlySet<PlanPiece> = new Set();

/** A planner's name as it prints: its words, style and place, and the backing under it. */
interface PlanName { readonly text: string; readonly style: TextStyle; readonly x: number; readonly y: number; readonly backing: string; readonly rect: Rect }

function grown(rect: Rect, by: number): Rect {
  return { left: rect.left - by, top: rect.top - by, right: rect.right + by, bottom: rect.bottom + by };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.right - 0.1 && b.left < a.right - 0.1 && a.top < b.bottom - 0.1 && b.top < a.bottom - 0.1;
}

/** The page area a piece covers: its corners' box, or its circle's for a round piece. */
function extentOf(piece: PlanPiece): Rect {
  if (piece.object.collisionType === "cylinder") {
    const reach = Math.max(piece.width, piece.depth) / 2;
    return { left: piece.center.x - reach, top: piece.center.y - reach, right: piece.center.x + reach, bottom: piece.center.y + reach };
  }
  const xs = piece.corners.map((point) => point.x);
  const ys = piece.corners.map((point) => point.y);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

/** Where a note's copper number sits on its piece. */
function markerSpot(piece: PlanPiece): { readonly x: number; readonly y: number } {
  return { x: piece.center.x + piece.width * 0.36 + 2, y: piece.center.y - piece.depth * 0.36 - 2 };
}

/**
 * The row a box piece stands in across the page, end to end with pieces of
 * its kind and depth that carry no name of their own (a top table's trestles),
 * or null for a round piece, an upright row or a piece standing alone.
 */
function rowAround(piece: PlanPiece, pieces: readonly PlanPiece[]): { readonly extent: Rect; readonly members: ReadonlySet<PlanPiece> } | null {
  if (piece.object.collisionType === "cylinder") return null;
  let extent = extentOf(piece);
  if (extent.right - extent.left < extent.bottom - extent.top) return null;
  const members = new Set<PlanPiece>([piece]);
  for (let grown = true; grown;) {
    grown = false;
    for (const other of pieces) {
      if (members.has(other) || other.object.category !== piece.object.category || other.object.collisionType === "cylinder") continue;
      if ((other.object.label?.trim() ?? "").length > 0) continue;
      const own = extentOf(other);
      const inLine = Math.abs(own.top - extent.top) < 1 && Math.abs(own.bottom - extent.bottom) < 1;
      const touching = own.left <= extent.right + 2 && own.right >= extent.left - 2;
      if (!inLine || !touching) continue;
      extent = { ...extent, left: Math.min(extent.left, own.left), right: Math.max(extent.right, own.right) };
      members.add(other);
      grown = true;
    }
  }
  return members.size > 1 ? { extent, members } : null;
}

/**
 * Where each planner's name prints. A name sits on its piece when it fits
 * there, else along the row its piece stands in (rowAround), still centred
 * over its own piece and clear of the copper numbers. With `beside`, a name
 * with neither sits just below, above, right or left of its piece, as a map
 * sets a name beside a narrow street: on floor clear of every other piece,
 * number and name by twice its gap to its own piece, so it never reads as a
 * neighbour's. A name with no such place is left off and returned (once, as
 * the planner wrote it), for the caption.
 */
function placeNames(doc: Doc, drawing: PlanDrawing, markers: ReadonlyMap<string, number>, beside: boolean): { readonly placed: readonly PlanName[]; readonly leftOff: readonly string[] } {
  const xs = drawing.outline.map((point) => point.x);
  const ys = drawing.outline.map((point) => point.y);
  const floor: Rect = { left: Math.min(...xs) + 1, top: Math.min(...ys) + 1, right: Math.max(...xs) - 1, bottom: Math.max(...ys) - 1 };
  const pieceRects = drawing.objects.map((piece) => ({ piece, rect: extentOf(piece) }));
  const taken: Rect[] = drawing.objects.filter((piece) => piece.object.note !== undefined && markers.has(piece.object.note)).map((piece): Rect => {
    const spot = markerSpot(piece);
    return { left: spot.x - MARKER_R, top: spot.y - MARKER_R, right: spot.x + MARKER_R, bottom: spot.y + MARKER_R };
  });
  const clear = (rect: Rect, own: ReadonlySet<PlanPiece>): boolean =>
    !pieceRects.some((other) => !own.has(other.piece) && overlaps(other.rect, rect)) && !taken.some((other) => overlaps(other, rect));
  const placed: PlanName[] = [];
  const leftOff = new Set<string>();
  for (const piece of drawing.objects) {
    const label = piece.object.label?.trim() ?? "";
    if (label.length === 0 || piece.object.category === "chair") continue;
    const text = planLabel(label);
    const across = Math.min(piece.width, piece.depth);
    const style: TextStyle = { face: "Inter-SemiBold", size: Math.max(5.5, Math.min(9, across * 0.42)), color: INK.primary };
    const width = textWidth(doc, style, text);
    const { x: cx, y: cy } = piece.center;
    const onPiece = (middle: number): PlanName => {
      const rect = { left: middle - width / 2 - 1.5, top: cy - style.size * 0.6, right: middle + width / 2 + 1.5, bottom: cy + style.size * 0.6 };
      return { text, style, x: middle - width / 2, y: cy - style.size * 0.55, backing: pieceStyle(piece.object.category).fill, rect };
    };
    if (width <= Math.max(piece.width, piece.depth) * 0.92 && across >= style.size) {
      placed.push(onPiece(cx));
      continue;
    }
    // Along its row: from its own piece's middle, kept inside the row, sliding
    // clear of the copper numbers but never off its own piece, so a name at a
    // row's end names the end piece and not its neighbour.
    const row = rowAround(piece, drawing.objects);
    if (row !== null && across >= style.size) {
      const own = extentOf(piece);
      const middle = (row.extent.left + row.extent.right) / 2;
      const room = (row.extent.right - row.extent.left) * 0.92;
      const reach = room / 2 - width / 2 - 1.5;
      const start = Math.min(Math.max(cx, middle - reach), middle + reach);
      const shifts = Array.from({ length: 41 }, (_, step) => (step % 2 === 0 ? -1 : 1) * Math.ceil(step / 2) * 2);
      const name = shifts.map((shift) => onPiece(start + shift)).find((candidate) => {
        const centre = (candidate.rect.left + candidate.rect.right) / 2;
        return centre > own.left + 1 && centre < own.right - 1
          && candidate.rect.left >= middle - room / 2 && candidate.rect.right <= middle + room / 2 && clear(candidate.rect, row.members);
      });
      if (name !== undefined) {
        taken.push(name.rect);
        placed.push(name);
        continue;
      }
    }
    if (!beside) continue;
    const w = textWidth(doc, BESIDE_STYLE, text) + 3;
    const h = BESIDE_STYLE.size * 1.2;
    const own = extentOf(piece);
    const middle = (own.left + own.right) / 2;
    const level = (own.top + own.bottom) / 2;
    const spots: readonly Rect[] = [
      { left: middle - w / 2, top: own.bottom + BESIDE_GAP, right: middle + w / 2, bottom: own.bottom + BESIDE_GAP + h },
      { left: middle - w / 2, top: own.top - BESIDE_GAP - h, right: middle + w / 2, bottom: own.top - BESIDE_GAP },
      { left: own.right + BESIDE_GAP, top: level - h / 2, right: own.right + BESIDE_GAP + w, bottom: level + h / 2 },
      { left: own.left - BESIDE_GAP - w, top: level - h / 2, right: own.left - BESIDE_GAP, bottom: level + h / 2 },
    ];
    // Touching nothing, and with clear floor round it but for its own piece and the row it stands in.
    const ownRow: ReadonlySet<PlanPiece> = row?.members ?? new Set([piece]);
    const spot = spots.find((rect) => rect.left >= floor.left && rect.right <= floor.right && rect.top >= floor.top && rect.bottom <= floor.bottom
      && clear(rect, NONE) && clear(grown(rect, BESIDE_CLEAR), ownRow));
    if (spot === undefined) {
      leftOff.add(label);
      continue;
    }
    taken.push(spot);
    placed.push({ text, style: BESIDE_STYLE, x: spot.left + 1.5, y: spot.top + BESIDE_STYLE.size * 0.05, backing: "#ffffff", rect: spot });
  }
  return { placed, leftOff: [...leftOff] };
}

/** The planner's names a plan drawn in a box this size has no room for, on their pieces or beside them. */
export function planNamesLeftOff(doc: Doc, plan: HallkeeperFloorPlan, width: number, height: number, markers: ReadonlyMap<string, number>): readonly string[] {
  const drawing = projectHallkeeperFloorPlan(plan, { x: WALL_BAND, y: WALL_BAND, width: width - WALL_BAND * 2, height: height - WALL_BAND * 2 });
  return placeNames(doc, drawing, markers, true).leftOff;
}

/**
 * Draw the plan inside `box`, wall names in a band round it. A table whose
 * label is in `ringed` (the tables the care words name) wears a brick ring
 * round it and its chairs. With `beside`, a name too wide for its piece is
 * set beside it (placeNames). Returns the scale (for the scale bar) and
 * whether any planner's name was printed.
 */
export function drawSheetPlan(
  doc: Doc,
  plan: HallkeeperFloorPlan,
  box: PlanViewport,
  markers: ReadonlyMap<string, number>,
  ringed: ReadonlySet<string> = new Set(),
  beside = false,
): { pointsPerMetre: number; named: boolean } {
  const drawing = projectHallkeeperFloorPlan(plan, {
    x: box.x + WALL_BAND, y: box.y + WALL_BAND, width: box.width - WALL_BAND * 2, height: box.height - WALL_BAND * 2,
  });

  doc.save();
  tracePath(doc, drawing.outline);
  doc.lineWidth(1.1).fillAndStroke("#ffffff", INK.secondary);
  doc.restore();

  // Staging and floor panels first, so tables and chairs set on them stay visible.
  const pieces = [...drawing.objects].sort((a, b) => Number(b.object.category === "stage") - Number(a.object.category === "stage"));
  for (const piece of pieces) {
    const style = pieceStyle(piece.object.category);
    doc.save().lineWidth(style.weight);
    if (piece.object.collisionType === "cylinder") {
      doc.rotate(-piece.object.rotationY * 180 / Math.PI, { origin: [piece.center.x, piece.center.y] });
      doc.ellipse(piece.center.x, piece.center.y, piece.width / 2, piece.depth / 2);
    } else {
      tracePath(doc, piece.corners);
    }
    doc.fillAndStroke(style.fill, style.stroke).restore();
  }

  for (const piece of drawing.objects) {
    const label = piece.object.label?.trim() ?? "";
    if (piece.object.category !== "table" || !ringed.has(label)) continue;
    const radius = Math.max(piece.width, piece.depth) / 2 + RING_REACH_M * drawing.pointsPerMetre;
    doc.save().circle(piece.center.x, piece.center.y, radius).lineWidth(1.1).strokeColor(INK.alert).stroke().restore();
  }

  const names = placeNames(doc, drawing, markers, beside);
  for (const name of names.placed) {
    // A backing (the table's own colour, or the floor's beside it) keeps the name legible over anything under it.
    doc.save().rect(name.rect.left, name.rect.top, name.rect.right - name.rect.left, name.rect.bottom - name.rect.top).fill(name.backing).restore();
    drawLine(doc, name.style, name.text, name.x, name.y);
  }

  for (const piece of drawing.objects) {
    const number = piece.object.note === undefined ? undefined : markers.get(piece.object.note);
    if (number === undefined) continue;
    drawMarker(doc, number, piece.center.x + piece.width * 0.36 + 2, piece.center.y - piece.depth * 0.36 - 2);
  }

  const xs = drawing.outline.map((point) => point.x);
  const ys = drawing.outline.map((point) => point.y);
  const left = Math.min(...xs); const right = Math.max(...xs);
  const top = Math.min(...ys); const bottom = Math.max(...ys);
  const middle = (left + right) / 2; const level = (top + bottom) / 2;
  drawLine(doc, WALL_STYLE, "North wall", middle - textWidth(doc, WALL_STYLE, "North wall") / 2, top - 10);
  drawLine(doc, WALL_STYLE, "South wall", middle - textWidth(doc, WALL_STYLE, "South wall") / 2, bottom + 4);
  for (const [name, x, turn] of [["West wall", left - 6, -90], ["East wall", right + 6, 90]] as const) {
    doc.save().rotate(turn, { origin: [x, level] });
    drawLine(doc, WALL_STYLE, name, x - textWidth(doc, WALL_STYLE, name) / 2, level - 3);
    doc.restore();
  }

  return { pointsPerMetre: drawing.pointsPerMetre, named: names.placed.length > 0 };
}

/** A bar of 1, 2 or 5 × 10ⁿ metres, at most 80 pt long, ending at `xRight`. */
export function drawScaleBar(doc: Doc, pointsPerMetre: number, xRight: number, y: number): void {
  if (!(pointsPerMetre > 0)) return;
  const longest = 80 / pointsPerMetre;
  const magnitude = 10 ** Math.floor(Math.log10(longest));
  const metres = ([5, 2, 1].find((step) => step * magnitude <= longest) ?? 1) * magnitude;
  const width = metres * pointsPerMetre;
  doc.save()
    .moveTo(xRight - width, y).lineTo(xRight, y)
    .moveTo(xRight - width, y - 2.5).lineTo(xRight - width, y + 2.5)
    .moveTo(xRight, y - 2.5).lineTo(xRight, y + 2.5)
    .lineWidth(0.6).strokeColor(INK.quiet).stroke().restore();
  const label = `${String(Number(metres.toPrecision(3)))} m`;
  drawLine(doc, TYPE.small, label, xRight - width - 4 - textWidth(doc, TYPE.small, label), y - 3.5);
}
