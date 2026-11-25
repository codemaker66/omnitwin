import { toRenderSpace } from "../constants/scale.js";
import type { CatalogueItem } from "./catalogue.js";

const CHAIR_BRUSH_GAP_M = 0.12;
const LINE_DOMINANCE_RATIO = 1.45;
const SINGLE_AXIS_THRESHOLD_FACTOR = 1.08;

export const CHAIR_BRUSH_MAX_ITEMS = 160;

export interface ChairBrushPoint {
  readonly x: number;
  readonly z: number;
  readonly rotationY: number;
}

export interface ChairBrushSummary {
  readonly mode: "single" | "row" | "block";
  readonly columns: number;
  readonly rows: number;
  readonly points: readonly ChairBrushPoint[];
}

interface LocalDelta {
  readonly x: number;
  readonly z: number;
}

function worldDeltaToLocal(dx: number, dz: number, rotationY: number): LocalDelta {
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);
  return {
    x: dx * cos + dz * sin,
    z: -dx * sin + dz * cos,
  };
}

function localOffsetToWorld(localX: number, localZ: number, rotationY: number): LocalDelta {
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);
  return {
    x: localX * cos - localZ * sin,
    z: localX * sin + localZ * cos,
  };
}

function countFromDistance(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value) + 1);
}

/**
 * Computes the chair-row/chair-block brush preview from a floor drag.
 *
 * The brush is intentionally deterministic and axis-aware: a mostly horizontal
 * or vertical drag becomes a clean line of chairs, while a diagonal drag opens
 * into a rectangular block. Rotation is inherited from the current placement
 * ghost, so Q/E still controls which way the chairs face.
 */
export function computeChairBrushSummary(
  chair: CatalogueItem,
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
  rotationY: number,
  maxItems: number = CHAIR_BRUSH_MAX_ITEMS,
): ChairBrushSummary {
  const spacingX = toRenderSpace(Math.max(chair.width, 0.45) + CHAIR_BRUSH_GAP_M);
  const spacingZ = toRenderSpace(Math.max(chair.depth, 0.45) + CHAIR_BRUSH_GAP_M);
  const local = worldDeltaToLocal(endX - startX, endZ - startZ, rotationY);
  const absX = Math.abs(local.x);
  const absZ = Math.abs(local.z);

  const rawColumns = countFromDistance(absX / spacingX);
  const rawRows = countFromDistance(absZ / spacingZ);
  const smallCrossAxis = Math.min(absX / spacingX, absZ / spacingZ) < SINGLE_AXIS_THRESHOLD_FACTOR;
  const lineMode =
    smallCrossAxis ||
    rawColumns >= rawRows * LINE_DOMINANCE_RATIO ||
    rawRows >= rawColumns * LINE_DOMINANCE_RATIO;

  const signX = local.x < 0 ? -1 : 1;
  const signZ = local.z < 0 ? -1 : 1;
  const columns = lineMode && rawRows > rawColumns ? 1 : rawColumns;
  const rows = lineMode && rawColumns >= rawRows ? 1 : rawRows;
  const limit = Math.max(1, Math.min(maxItems, CHAIR_BRUSH_MAX_ITEMS));
  const points: ChairBrushPoint[] = [];

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (points.length >= limit) break;
      const localX = column * spacingX * signX;
      const localZ = row * spacingZ * signZ;
      const world = localOffsetToWorld(localX, localZ, rotationY);
      points.push({
        x: startX + world.x,
        z: startZ + world.z,
        rotationY,
      });
    }
  }

  const mode = points.length <= 1 ? "single" : rows > 1 && columns > 1 ? "block" : "row";
  return { mode, columns, rows, points };
}
