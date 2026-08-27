import type { TwinScanNode } from "@omnitwin/types";
import { e57PointToThree } from "./twin-basis.js";
import { ROOM_DISPLAY_NAMES, VERIFIED_ROOM_NODES } from "./shell/twin-rooms.js";

// -----------------------------------------------------------------------------
// plan-mode — the pure maths under the orthographic plan (the CAD view).
//
// A plan is a horizontal SECTION, not a photograph from a drone: the storey is
// cut open at head height above its walking floor and drawn to scale under an
// orthographic camera. Everything here derives from the manifest's own data —
// floor buckets, scanner pose heights, node footprints — so the plan can never
// claim a geometry the capture does not carry.
//
// Storey labels are deliberately RELATIONAL ("Upper level", "Lower level")
// plus the names of validated rooms only. The scanner's floor numbers are
// vocabulary for machines — a guest was once told they stood on "Floor -1" in
// the front door, and that class of claim is banned (see TwinViewer's minimap
// obituary and twin-rooms.ts's philosophy).
// -----------------------------------------------------------------------------

/** Scanner optical centre above the walking floor (metres) — the twin-wide
 *  convention (the brief's 1.4–1.5 m band; batch-solved heights median 1.5). */
export const SCAN_EYE_HEIGHT_M = 1.45;

/** The section cut above each storey's walking floor — head height, the
 *  architectural convention that keeps doorways open and window sills drawn. */
export const PLAN_CUT_ABOVE_FLOOR_M = 2.2;

/** Breathing room around the node footprint when framing a storey. */
const PLAN_FRAME_MARGIN_FRACTION = 0.08;
/** A storey is never framed tighter than this half-extent (metres). */
const PLAN_FRAME_MIN_HALF_M = 4;

/** The scale bar must never exceed this rendered width. */
const SCALE_BAR_CEILING_PX = 180;

export interface PlanStorey {
  /** The manifest's floor bucket — machine vocabulary, never rendered. */
  readonly floor: number;
  readonly nodeCount: number;
  /** Three-space y of the walking floor (median pose height − eye height). */
  readonly floorY: number;
  /** Relational label: Upper/Lower/Middle level — or just "Level" alone. */
  readonly label: string;
  /** Validated room names on this storey, in display order. Never inferred. */
  readonly roomNames: readonly string[];
}

export interface PlanFrame {
  readonly centerX: number;
  readonly centerZ: number;
  readonly halfW: number;
  readonly halfD: number;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  const lower = sorted[middle - 1];
  if (upper === undefined) {
    return 0;
  }
  return sorted.length % 2 === 0 && lower !== undefined ? (lower + upper) / 2 : upper;
}

/** Relational storey labels, top first. Beyond three the middles repeat — no
 *  real venue bundle carries five pose-height buckets. */
function relationalLabels(count: number): readonly string[] {
  if (count <= 1) {
    return ["Level"];
  }
  return Array.from({ length: count }, (_, index) =>
    index === 0 ? "Upper level" : index === count - 1 ? "Lower level" : "Middle level",
  );
}

/**
 * The bundle's storeys, upper first: floor bucket, node count, derived
 * walking-floor height, relational label, and the validated rooms it holds.
 */
export function storeysFromNodes(nodes: readonly TwinScanNode[]): PlanStorey[] {
  const byFloor = new Map<number, TwinScanNode[]>();
  for (const scanNode of nodes) {
    const list = byFloor.get(scanNode.floor);
    if (list === undefined) {
      byFloor.set(scanNode.floor, [scanNode]);
    } else {
      list.push(scanNode);
    }
  }
  const floors = [...byFloor.keys()].sort((a, b) => b - a);
  const labels = relationalLabels(floors.length);
  return floors.map((floor, index) => {
    const storeyNodes = byFloor.get(floor) ?? [];
    const poseY = median(
      storeyNodes.map((scanNode) => e57PointToThree(scanNode.pose.t)[1]),
    );
    const roomNames: string[] = [];
    for (const scanNode of storeyNodes) {
      const slug = VERIFIED_ROOM_NODES[scanNode.id];
      if (slug !== undefined) {
        const name = ROOM_DISPLAY_NAMES[slug];
        if (!roomNames.includes(name)) {
          roomNames.push(name);
        }
      }
    }
    return {
      floor,
      nodeCount: storeyNodes.length,
      floorY: poseY - SCAN_EYE_HEIGHT_M,
      label: labels[index] ?? "Level",
      roomNames,
    };
  });
}

/** The horizontal section height that opens this storey for the plan. */
export function planCutY(storey: PlanStorey): number {
  return storey.floorY + PLAN_CUT_ABOVE_FLOOR_M;
}

/**
 * The horizontal frame (three space) around a storey's nodes — or the whole
 * bundle when no floor is named — grown by a margin and clamped to a
 * readable minimum, so one lonely scan still yields a navigable plan.
 */
export function planFrame(
  nodes: readonly TwinScanNode[],
  floor?: number,
): PlanFrame {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const scanNode of nodes) {
    if (floor !== undefined && scanNode.floor !== floor) {
      continue;
    }
    const [x, , z] = e57PointToThree(scanNode.pose.t);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  if (!Number.isFinite(minX)) {
    return {
      centerX: 0,
      centerZ: 0,
      halfW: PLAN_FRAME_MIN_HALF_M,
      halfD: PLAN_FRAME_MIN_HALF_M,
    };
  }
  const halfW = Math.max(
    ((maxX - minX) / 2) * (1 + PLAN_FRAME_MARGIN_FRACTION * 2),
    PLAN_FRAME_MIN_HALF_M,
  );
  const halfD = Math.max(
    ((maxZ - minZ) / 2) * (1 + PLAN_FRAME_MARGIN_FRACTION * 2),
    PLAN_FRAME_MIN_HALF_M,
  );
  return {
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    halfW,
    halfD,
  };
}

/**
 * The orthographic zoom (px per metre) that fits the frame in the viewport —
 * the tighter axis binds, so the whole storey is always on screen at entry.
 */
export function planFitZoom(
  viewportWidthPx: number,
  viewportHeightPx: number,
  frame: PlanFrame,
): number {
  const width = Math.max(viewportWidthPx, 1);
  const height = Math.max(viewportHeightPx, 1);
  return Math.min(width / (2 * frame.halfW), height / (2 * frame.halfD));
}

export interface PlanRoomLabel {
  readonly slug: string;
  /** The venue's own name, as twin-rooms renders it. */
  readonly name: string;
  /** Three-space position ON the drawing: the centroid of the room's
   *  validated viewpoints, floated just above the storey's walking floor. */
  readonly position: readonly [number, number, number];
}

/** Height above the walking floor a label floats — under any furniture-scale
 *  geometry, above the floor surface itself. */
const PLAN_LABEL_FLOAT_M = 0.35;

/**
 * The room annotations for a storey's drawing: one label per VALIDATED room
 * (twin-rooms' whole philosophy — nothing inferred), positioned at the
 * centroid of that room's validated viewpoints. The Grand Hall's two
 * validated ends therefore centre it; single-viewpoint rooms sit on their
 * viewpoint.
 */
export function planRoomLabels(
  nodes: readonly TwinScanNode[],
  storey: PlanStorey,
): PlanRoomLabel[] {
  const sums = new Map<string, { x: number; z: number; count: number }>();
  for (const scanNode of nodes) {
    if (scanNode.floor !== storey.floor) {
      continue;
    }
    const slug = VERIFIED_ROOM_NODES[scanNode.id];
    if (slug === undefined) {
      continue;
    }
    const [x, , z] = e57PointToThree(scanNode.pose.t);
    const sum = sums.get(slug);
    if (sum === undefined) {
      sums.set(slug, { x, z, count: 1 });
    } else {
      sum.x += x;
      sum.z += z;
      sum.count += 1;
    }
  }
  return [...sums.entries()].map(([slug, sum]) => ({
    slug,
    name: ROOM_DISPLAY_NAMES[slug as keyof typeof ROOM_DISPLAY_NAMES],
    position: [
      sum.x / sum.count,
      storey.floorY + PLAN_LABEL_FLOAT_M,
      sum.z / sum.count,
    ],
  }));
}

export interface ScaleBarSpec {
  readonly metres: number;
  readonly px: number;
  /** Honest unit label — metres at plan zooms, centimetres when zoomed tight. */
  readonly label: string;
}

/**
 * A 1-2-5 ladder scale bar: the longest round length that renders under the
 * ceiling. Null when there is no meaningful scale (degenerate zoom) — the
 * caller renders nothing rather than a lie.
 */
export function scaleBarSpec(pxPerMetre: number): ScaleBarSpec | null {
  if (!Number.isFinite(pxPerMetre) || pxPerMetre <= 0) {
    return null;
  }
  let best: ScaleBarSpec | null = null;
  let smallest: ScaleBarSpec | null = null;
  for (let exponent = -2; exponent <= 2; exponent += 1) {
    for (const mantissa of [1, 2, 5]) {
      const metres = mantissa * 10 ** exponent;
      const px = metres * pxPerMetre;
      const label =
        metres >= 1
          ? `${String(Math.round(metres * 100) / 100)} m`
          : `${String(Math.round(metres * 100))} cm`;
      const candidate: ScaleBarSpec = { metres, px, label };
      if (smallest === null || px < smallest.px) {
        smallest = candidate;
      }
      if (px <= SCALE_BAR_CEILING_PX && (best === null || px > best.px)) {
        best = candidate;
      }
    }
  }
  if (best !== null) {
    return best;
  }
  // Every ladder rung overflows (an extreme zoom): the smallest is the most
  // honest bar available.
  return smallest;
}
