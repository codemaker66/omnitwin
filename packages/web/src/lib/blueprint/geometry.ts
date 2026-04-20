import type {
  BlueprintItem,
  BlueprintScene,
  Point,
  RoundTableItem,
  StatusMetrics,
} from "./types.js";

// ---------------------------------------------------------------------------
// Blueprint geometry — pure helpers. No React, no DOM, no I/O.
// ---------------------------------------------------------------------------

/** Default render scale in pixels per metre. Tuned so Grand Hall fits a laptop viewport. */
export const DEFAULT_PIXELS_PER_METRE = 60;

/** Architectural scale label ("1:50") — display only; not a rendering input. */
export const DEFAULT_SCALE_LABEL = "1:50";

export function metresToPixels(metres: number, pxPerM: number = DEFAULT_PIXELS_PER_METRE): number {
  return metres * pxPerM;
}

export function pixelsToMetres(pixels: number, pxPerM: number = DEFAULT_PIXELS_PER_METRE): number {
  return pixels / pxPerM;
}

/**
 * Position of a door marker along its wall, expressed in world metres.
 * Callers project the returned point through `metresToPixels` for SVG.
 */
export function doorPoint(
  wall: "north" | "south" | "east" | "west",
  distanceM: number,
  room: { readonly widthM: number; readonly lengthM: number },
): Point {
  switch (wall) {
    case "north":
      return { x: distanceM, y: 0 };
    case "south":
      return { x: distanceM, y: room.lengthM };
    case "west":
      return { x: 0, y: distanceM };
    case "east":
      return { x: room.widthM, y: distanceM };
  }
}

/** Axis-aligned footprint of an item in world metres. */
export function itemBoundingBox(item: BlueprintItem): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (item.shape === "round") {
    const radius = item.diameterM / 2;
    return {
      x: item.center.x - radius,
      y: item.center.y - radius,
      width: item.diameterM,
      height: item.diameterM,
    };
  }
  return {
    x: item.topLeft.x,
    y: item.topLeft.y,
    width: item.widthM,
    height: item.lengthM,
  };
}

/** Area occupied by a single item in square metres. Round tables use π r². */
export function itemAreaM2(item: BlueprintItem): number {
  if (item.shape === "round") {
    const r = item.diameterM / 2;
    return Math.PI * r * r;
  }
  return item.widthM * item.lengthM;
}

/** Sum seats across all seated items (rounds + rect tables with a seats field). */
export function totalSeats(items: readonly BlueprintItem[]): number {
  let sum = 0;
  for (const item of items) {
    if (item.shape === "round") {
      sum += item.seats;
    } else if (item.shape === "rect" && typeof item.seats === "number") {
      sum += item.seats;
    }
  }
  return sum;
}

/** Count of round tables (for the "Rounds" status chip). */
export function roundCount(items: readonly BlueprintItem[]): number {
  let n = 0;
  for (const item of items) {
    if (item.kind === "round-table") n += 1;
  }
  return n;
}

/** Percentage of the room's floor currently occupied by items (0-100, integer). */
export function floorUsedPercent(scene: BlueprintScene): number {
  const roomArea = scene.room.widthM * scene.room.lengthM;
  if (roomArea <= 0) return 0;
  let used = 0;
  for (const item of scene.items) used += itemAreaM2(item);
  const pct = (used / roomArea) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/**
 * Fire egress heuristic: each door must have a clear 1.2 m radius free of
 * furniture. Returns `true` when every listed door is clear. No doors = vacuously clear.
 */
export function fireEgressClear(scene: BlueprintScene): boolean {
  const doors = scene.room.doors;
  if (doors === undefined || doors.length === 0) return true;
  const CLEARANCE_M = 1.2;
  for (const door of doors) {
    const dp = doorPoint(door.wall, door.distanceM, scene.room);
    for (const item of scene.items) {
      if (distanceToItemM(dp, item) < CLEARANCE_M) return false;
    }
  }
  return true;
}

/** Distance from a point to the nearest surface of an item, in metres. 0 if inside. */
export function distanceToItemM(p: Point, item: BlueprintItem): number {
  if (item.shape === "round") {
    const dx = p.x - item.center.x;
    const dy = p.y - item.center.y;
    const centreDist = Math.sqrt(dx * dx + dy * dy);
    return Math.max(0, centreDist - item.diameterM / 2);
  }
  const left = item.topLeft.x;
  const right = item.topLeft.x + item.widthM;
  const top = item.topLeft.y;
  const bottom = item.topLeft.y + item.lengthM;
  const dx = Math.max(left - p.x, 0, p.x - right);
  const dy = Math.max(top - p.y, 0, p.y - bottom);
  return Math.sqrt(dx * dx + dy * dy);
}

/** Build the status chip metrics in one pass. */
export function computeStatusMetrics(scene: BlueprintScene): StatusMetrics {
  return {
    totalSeats: totalSeats(scene.items),
    roundCount: roundCount(scene.items),
    floorUsedPercent: floorUsedPercent(scene),
    fireEgressClear: fireEgressClear(scene),
  };
}

/** Count items of a given kind. */
export function countByKind(items: readonly BlueprintItem[], kind: BlueprintItem["kind"]): number {
  let n = 0;
  for (const item of items) if (item.kind === kind) n += 1;
  return n;
}

/**
 * Fit-scale: what `pixelsPerMetre` makes the room exactly fill a given
 * viewport (minus padding) without overflow.
 */
export function computeFitScale(
  room: { readonly widthM: number; readonly lengthM: number },
  viewport: { readonly widthPx: number; readonly heightPx: number },
  paddingPx: number = 48,
): number {
  const availableW = Math.max(100, viewport.widthPx - paddingPx * 2);
  const availableH = Math.max(100, viewport.heightPx - paddingPx * 2);
  const scaleByWidth = availableW / room.widthM;
  const scaleByHeight = availableH / room.lengthM;
  return Math.max(1, Math.min(scaleByWidth, scaleByHeight));
}

/**
 * Human-readable "saved X ago". Avoids pulling in a date library.
 */
export function relativeTimeShort(tsMs: number | null, nowMs: number): string {
  if (tsMs === null) return "Not saved";
  const diffMs = Math.max(0, nowMs - tsMs);
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${String(m)}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${String(h)}h ago`;
  const d = Math.floor(h / 24);
  return `${String(d)}d ago`;
}

/** Inspector title — "ROUND TABLE · 10", "STAGE · 8×3m", etc. */
export function inspectorTitle(item: BlueprintItem): string {
  if (item.kind === "round-table") {
    return `ROUND TABLE · ${String(item.seats)}`;
  }
  if (item.kind === "long-table") {
    return `LONG TABLE · ${String(item.seats ?? 0)}`;
  }
  if (item.kind === "top-table") {
    return `TOP TABLE · ${String(item.seats ?? 0)}`;
  }
  if (item.kind === "stage") {
    return `STAGE · ${formatDimensions(item)}`;
  }
  if (item.kind === "dancefloor") {
    return `DANCEFLOOR · ${formatDimensions(item)}`;
  }
  return `BAR · ${String(item.widthM)}m`;
}

/** "8×3m" for a rect item. */
export function formatDimensions(item: BlueprintItem): string {
  if (item.shape === "round") {
    return `${formatM(item.diameterM)}m ⌀`;
  }
  return `${formatM(item.widthM)}×${formatM(item.lengthM)}m`;
}

function formatM(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Type guard for round tables. */
export function isRoundTable(item: BlueprintItem): item is RoundTableItem {
  return item.kind === "round-table";
}

// ---------------------------------------------------------------------------
// Layer-panel rows
// ---------------------------------------------------------------------------

export interface LayerRow {
  readonly id: string;
  readonly kind: BlueprintItem["kind"];
  readonly label: string;
  readonly locked: boolean;
  readonly selected: boolean;
}

/**
 * Flatten the scene into a layer-panel list, ordered top-to-bottom so the
 * item drawn on top of the stack appears first. Mirrors Figma/Photoshop.
 */
export function getLayerRows(
  scene: BlueprintScene,
  selectedIds: readonly string[] = [],
): readonly LayerRow[] {
  const selected = new Set(selectedIds);
  const rows: LayerRow[] = [];
  for (let i = scene.items.length - 1; i >= 0; i -= 1) {
    const item = scene.items[i];
    if (item === undefined) continue;
    rows.push({
      id: item.id,
      kind: item.kind,
      label: layerLabel(item),
      locked: item.locked === true,
      selected: selected.has(item.id),
    });
  }
  return rows;
}

function layerLabel(item: BlueprintItem): string {
  switch (item.kind) {
    case "round-table":
      return `Round table · seats ${String(item.seats)}`;
    case "long-table":
      return `Long table · seats ${String(item.seats ?? 0)}`;
    case "top-table":
      return `Top table · seats ${String(item.seats ?? 0)}`;
    case "stage":
      return `Stage · ${formatDimensions(item)}`;
    case "dancefloor":
      return `Dancefloor · ${formatDimensions(item)}`;
    case "bar":
      return `Bar · ${formatDimensions(item)}`;
  }
}
