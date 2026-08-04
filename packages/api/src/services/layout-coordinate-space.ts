import {
  HallkeeperSheetV2Schema,
  type HallkeeperSheetV2,
} from "@omnitwin/types";
import {
  LEGACY_RENDER_COORDINATE_SPACE,
  REAL_METRE_COORDINATE_SPACE,
  type LayoutCoordinateSpace,
} from "../db/coordinate-space.js";

/**
 * Parse a frozen hallkeeper payload and expose its positions in real metres.
 * Legacy payload bytes remain untouched in Postgres; this function creates a
 * compatibility view at the read boundary.
 */
export function parseHallkeeperSnapshotPayload(
  raw: unknown,
  coordinateSpace: string,
): HallkeeperSheetV2 | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;

  const candidate = "approval" in raw ? raw : { ...raw, approval: null };
  const parsed = HallkeeperSheetV2Schema.safeParse(candidate);
  if (!parsed.success) return null;
  if (coordinateSpace === REAL_METRE_COORDINATE_SPACE) return parsed.data;
  if (coordinateSpace !== LEGACY_RENDER_COORDINATE_SPACE) return null;

  return {
    ...parsed.data,
    phases: parsed.data.phases.map((phase) => ({
      ...phase,
      zones: phase.zones.map((zone) => ({
        ...zone,
        rows: zone.rows.map((row) => ({
          ...row,
          positions: row.positions.map((position) => ({
            ...position,
            x: position.x / 2,
            z: position.z / 2,
          })),
        })),
      })),
    })),
  };
}

/** Legacy proposal geometry cannot be reconstructed from its origin-relative
 * snapshot without the original room origin, so consumers must suppress it. */
export function canRenderPersistedLayout(
  coordinateSpace: LayoutCoordinateSpace,
): boolean {
  return coordinateSpace === REAL_METRE_COORDINATE_SPACE;
}
