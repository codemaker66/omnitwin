import type { HallkeeperFloorPlan } from "@omnitwin/types";
import { projectHallkeeperFloorPlan, type PlanViewport } from "./hallkeeper-floor-plan.js";

/** A vector drawing of frozen catalogue footprints, not a captured room image. */
export function renderHallkeeperFloorPlan(doc: PDFKit.PDFDocument, plan: HallkeeperFloorPlan, box: PlanViewport): void {
  const drawing = projectHallkeeperFloorPlan(plan, { x: box.x + 16, y: box.y + 24, width: box.width - 32, height: box.height - 52 });
  const line = (points: readonly { readonly x: number; readonly y: number }[]) => {
    for (const [index, point] of points.entries()) {
      if (index === 0) doc.moveTo(point.x, point.y);
      else doc.lineTo(point.x, point.y);
    }
    doc.closePath();
  };
  doc.save();
  doc.rect(box.x, box.y, box.width, box.height).lineWidth(0.5).strokeColor("#dddddd").stroke();
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#333333");
  doc.text("FLOOR PLAN · CATALOGUE FOOTPRINTS", box.x + 10, box.y + 8, { width: box.width - 20, height: 11 });
  line(drawing.outline);
  doc.lineWidth(0.8).fillAndStroke("#faf9f6", "#777777");
  // Source ordering is stable. Individual chairs remain independent of tables.
  for (const item of drawing.objects) {
    doc.save();
    const fill = item.object.category === "chair" ? "#ffffff" : "#ece6d7";
    doc.lineWidth(item.object.category === "chair" ? 0.35 : 0.6);
    if (item.object.collisionType === "cylinder") {
      doc.rotate(-item.object.rotationY * 180 / Math.PI, { origin: [item.center.x, item.center.y] });
      doc.ellipse(item.center.x, item.center.y, item.width / 2, item.depth / 2);
    } else {
      line(item.corners);
    }
    doc.fillAndStroke(fill, "#555555");
    doc.restore();
  }
  const tableCount = plan.objects.filter((object) => object.category === "table").length;
  const chairCount = plan.objects.filter((object) => object.category === "chair").length;
  const otherCount = plan.objects.length - tableCount - chairCount;
  doc.font("Helvetica").fontSize(7).fillColor("#555555");
  doc.text(`${String(tableCount)} tables · ${String(chairCount)} chairs${otherCount > 0 ? ` · ${String(otherCount)} other objects` : ""}`, box.x + 10, box.y + box.height - 20, { width: box.width / 2, height: 10 });
  doc.text("Room coordinates: +X right, +Z down", box.x + 10, box.y + box.height - 10, { width: box.width / 2, height: 9 });
  // A measured scale bar stays meaningful even if the printed page is resized.
  const maxBarMetres = 90 / drawing.pointsPerMetre;
  const magnitude = 10 ** Math.floor(Math.log10(maxBarMetres));
  const barMetres = ([5, 2, 1].find((step) => step * magnitude <= maxBarMetres) ?? 1) * magnitude;
  const barWidth = barMetres * drawing.pointsPerMetre;
  const barX = box.x + box.width - 12 - barWidth;
  const barY = box.y + box.height - 11;
  doc.moveTo(barX, barY - 3).lineTo(barX, barY + 3)
    .moveTo(barX, barY).lineTo(barX + barWidth, barY)
    .moveTo(barX + barWidth, barY - 3).lineTo(barX + barWidth, barY + 3)
    .lineWidth(0.6).strokeColor("#555555").stroke();
  doc.text(`${String(barMetres)} m`, barX, barY - 12, { width: barWidth, height: 9, align: "center" });
  doc.restore();
}
