import type { PlanView, PlanViewFootprint } from "@omnitwin/types";
import { savedFootprintCorners, type PlanPoint } from "./hallkeeper-frozen-plan.js";

// ---------------------------------------------------------------------------
// A visitor's plan, drawn to scale for the view-only page (fix-first item 11).
//
// The same geometry as the PDF and the hallkeeper's saved plan: catalogue
// footprints at their saved position and turn, +Z down the page, one uniform
// scale for the room and everything in it (nothing off the room is clipped
// or moved). The drawing keeps the room's own proportions, so a long hall is
// drawn long on a phone, within a height a screen can hold.
// ---------------------------------------------------------------------------

export const PLAN_VIEW_WIDTH = 1000;
const MARGIN = 28;
const FOOTER = 64;
/** The tallest the drawing of the plan itself may be, as a share of its width. */
const MAX_PLAN_ASPECT = 1.5;
const SCALE_BAR_STEPS = [0.5, 1, 2, 5, 10, 20, 50] as const;

export interface DrawnFootprint {
  readonly footprint: PlanViewFootprint;
  readonly center: PlanPoint;
  readonly corners: readonly PlanPoint[];
  /** Half the drawn width and depth, for round items. */
  readonly rx: number;
  readonly ry: number;
  /** SVG rotation in degrees (the page's y runs down). */
  readonly rotationDeg: number;
}

export interface PlanViewDrawing {
  readonly width: number;
  readonly height: number;
  readonly outline: readonly PlanPoint[];
  readonly footprints: readonly DrawnFootprint[];
  readonly scaleBar: { readonly x: number; readonly y: number; readonly length: number; readonly metres: number };
}

/** The plan in drawing units, or null when its outline has no area to draw. */
export function drawPlanView(view: Pick<PlanView, "outline" | "objects">): PlanViewDrawing | null {
  const outline = view.outline.map(({ x, z }) => ({ x, y: z }));
  const corners = view.objects.map((footprint) => savedFootprintCorners(footprint));
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const point of [...outline, ...corners.flat()]) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (!(spanX > 0) || !(spanY > 0)) return null;

  const usable = PLAN_VIEW_WIDTH - MARGIN * 2;
  const scale = Math.min(usable / spanX, (usable * MAX_PLAN_ASPECT) / spanY);
  const planHeight = spanY * scale;
  const left = MARGIN + (usable - spanX * scale) / 2;
  const project = (point: PlanPoint): PlanPoint => ({
    x: left + (point.x - minX) * scale,
    y: MARGIN + (point.y - minY) * scale,
  });

  const footprints = view.objects.map((footprint, index): DrawnFootprint => ({
    footprint,
    center: project({ x: footprint.x, y: footprint.z }),
    corners: (corners[index] ?? []).map(project),
    rx: (footprint.widthM * footprint.scale * scale) / 2,
    ry: (footprint.depthM * footprint.scale * scale) / 2,
    rotationDeg: (-footprint.rotationY * 180) / Math.PI,
  }));

  // The longest round length that fits in a third of the width.
  const metres = [...SCALE_BAR_STEPS].reverse().find((step) => step * scale <= PLAN_VIEW_WIDTH / 3) ?? SCALE_BAR_STEPS[0];
  const height = MARGIN + planHeight + FOOTER;
  return {
    width: PLAN_VIEW_WIDTH,
    height,
    outline: outline.map(project),
    footprints,
    scaleBar: { x: MARGIN, y: height - FOOTER / 2, length: metres * scale, metres },
  };
}

/** SVG `points` for a polygon. */
export function pointsAttribute(points: readonly PlanPoint[]): string {
  return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
}

/** "8 tables, 64 chairs and 1 lectern", for the drawing's accessible name. */
export function describePlanItems(items: PlanView["items"]): string {
  const byCategory = new Map<string, number>();
  for (const item of items) byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + item.count);
  const words: Readonly<Record<string, readonly [string, string]>> = {
    table: ["table", "tables"],
    chair: ["chair", "chairs"],
    stage: ["piece of staging", "pieces of staging"],
    lectern: ["lectern", "lecterns"],
  };
  const parts = [...byCategory.entries()].map(([category, count]) => {
    const [one, many] = words[category] ?? ["other item", "other items"];
    return `${String(count)} ${count === 1 ? one : many}`;
  });
  if (parts.length === 0) return "nothing placed yet";
  if (parts.length === 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1] ?? ""}`;
}

/** "17 October 2026, 14:02" in the venue's own clock (UTC, said so, if the zone is unknown). */
export function formatInVenueClock(iso: string, timeZone: string): string {
  const at = new Date(iso);
  const format = (zone: string): string => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone, day: "numeric", month: "long", year: "numeric",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(at);
    const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? "";
    return `${part("day")} ${part("month")} ${part("year")}, ${part("hour")}:${part("minute")}`;
  };
  try {
    return format(timeZone);
  } catch {
    return `${format("UTC")} UTC`;
  }
}

/** "16 November 2026" in the venue's own clock. */
export function formatDateInVenueClock(iso: string, timeZone: string): string {
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" };
  try {
    return new Date(iso).toLocaleDateString("en-GB", { ...options, timeZone });
  } catch {
    return new Date(iso).toLocaleDateString("en-GB", { ...options, timeZone: "UTC" });
  }
}
