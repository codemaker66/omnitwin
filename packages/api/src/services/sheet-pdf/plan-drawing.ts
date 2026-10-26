import type { HallkeeperFloorPlan } from "@omnitwin/types";
import { projectHallkeeperFloorPlan, type PlanViewport } from "../hallkeeper-floor-plan.js";
import { INK, TYPE, drawLine, textWidth, type Doc, type TextStyle } from "./style.js";

// ---------------------------------------------------------------------------
// The room drawn from the layout's frozen catalogue footprints: one uniform
// scale, looking down, North at the top as the zone names have it. The
// planner's table names sit on their tables, and a piece that carries a
// planner's note wears the copper number its note has in the legend.
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

/**
 * Draw the plan inside `box`, wall names in a band round it. Returns the
 * scale (for the scale bar) and whether any planner's name was printed.
 */
export function drawSheetPlan(doc: Doc, plan: HallkeeperFloorPlan, box: PlanViewport, markers: ReadonlyMap<string, number>): { pointsPerMetre: number; named: boolean } {
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

  let named = false;
  for (const piece of drawing.objects) {
    if (piece.object.label === undefined || piece.object.category === "chair") continue;
    const text = planLabel(piece.object.label);
    const across = Math.min(piece.width, piece.depth);
    const style: TextStyle = { face: "Inter-SemiBold", size: Math.max(5.5, Math.min(9, across * 0.42)), color: INK.primary };
    const width = textWidth(doc, style, text);
    if (width > Math.max(piece.width, piece.depth) * 0.92 || across < style.size) continue;
    // A backing in the table's own colour keeps the name legible over anything set on it.
    doc.save().rect(piece.center.x - width / 2 - 1.5, piece.center.y - style.size * 0.6, width + 3, style.size * 1.2).fill(pieceStyle(piece.object.category).fill).restore();
    drawLine(doc, style, text, piece.center.x - width / 2, piece.center.y - style.size * 0.55);
    named = true;
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

  return { pointsPerMetre: drawing.pointsPerMetre, named };
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
