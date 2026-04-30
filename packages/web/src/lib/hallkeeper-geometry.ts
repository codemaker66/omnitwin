import type { Phase } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Hallkeeper floor-plan geometry — pure helpers
//
// Placed-object coordinates are stored in the room's floor-plan frame:
// x goes along the room's width, z along the length. Both are centred on
// the room's midpoint (the origin). These helpers convert those
// coordinates to normalised SVG space so the interactive floor plan
// can draw markers that align with placements.
// ---------------------------------------------------------------------------

export interface RoomDims {
  readonly widthM: number;
  readonly lengthM: number;
}

/**
 * Convert a room-frame (x, z) position in metres to a normalised [0,1]²
 * coordinate where (0,0) is top-left and (1,1) is bottom-right. The
 * SVG viewport is expected to use this aspect ratio.
 *
 * Placements can legitimately sit outside the room bounds (e.g. a
 * chair drawn slightly off a table): we clamp the result to [0,1] so
 * off-room markers still render at the room edge instead of
 * disappearing.
 */
export function roomToNormalised(x: number, z: number, room: RoomDims): { nx: number; nz: number } {
  const halfW = room.widthM / 2;
  const halfL = room.lengthM / 2;
  const nx = (x + halfW) / room.widthM;
  const nz = (z + halfL) / room.lengthM;
  return {
    nx: clamp01(nx),
    nz: clamp01(nz),
  };
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0.5;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

// ---------------------------------------------------------------------------
// Markers — one per placement, tagged with its source row key
// ---------------------------------------------------------------------------

export interface FloorPlanMarker {
  readonly rowKey: string;
  readonly rowName: string;
  readonly category: string;
  readonly isAccessory: boolean;
  /** Normalised x in [0,1] — 0 = left edge of room. */
  readonly nx: number;
  /** Normalised z in [0,1] — 0 = top edge of room. */
  readonly nz: number;
  /** Y rotation in radians, for orientation arrows. */
  readonly rotationY: number;
  /** Source object UUID — lets click handlers dispatch back to the 3D scene. */
  readonly objectId: string;
}

/**
 * Flatten all phases → zones → rows → positions into a single list of
 * floor-plan markers. Accessories are excluded (they don't have their
 * own positions — they follow their parents, and rendering every
 * tablecloth marker on top of its table is just noise).
 */
export function collectFloorPlanMarkers(phases: readonly Phase[], room: RoomDims): FloorPlanMarker[] {
  const markers: FloorPlanMarker[] = [];
  for (const phase of phases) {
    for (const zone of phase.zones) {
      for (const row of zone.rows) {
        if (row.isAccessory) continue;
        const runtimeRow: {
          readonly positions?: readonly {
            readonly objectId?: unknown;
            readonly x?: unknown;
            readonly z?: unknown;
            readonly rotationY?: unknown;
          }[];
        } = row;
        const positions = runtimeRow.positions ?? [];
        for (const pos of positions) {
          if (
            typeof pos.objectId !== "string"
            || typeof pos.x !== "number"
            || typeof pos.z !== "number"
            || typeof pos.rotationY !== "number"
          ) {
            continue;
          }
          const { nx, nz } = roomToNormalised(pos.x, pos.z, room);
          markers.push({
            rowKey: row.key,
            rowName: row.name,
            category: row.category,
            isAccessory: row.isAccessory,
            nx,
            nz,
            rotationY: pos.rotationY,
            objectId: pos.objectId,
          });
        }
      }
    }
  }
  return markers;
}

// ---------------------------------------------------------------------------
// Category styling — deterministic colour map
// Each furniture category gets a distinct marker colour so the
// hallkeeper can scan the floor plan visually: "tables are gold,
// chairs are faint, AV is cyan". Consistent with the 3D editor palette.
// ---------------------------------------------------------------------------

export function markerColourFor(category: string): string {
  switch (category) {
    case "table": return "#c9a84c";
    case "chair": return "#8a8680";
    case "av": return "#5bb0d4";
    case "stage": return "#b86a4a";
    case "decor": return "#a87bcb";
    default: return "#6a6965";
  }
}

// ---------------------------------------------------------------------------
// Aspect ratio helper — the SVG should preserve the room's aspect
// ratio so markers land in the right place regardless of container
// width. Landscape rooms get wider SVGs; square rooms get square ones.
// ---------------------------------------------------------------------------

export function svgAspectRatio(room: RoomDims): number {
  if (room.lengthM <= 0) return 1;
  return room.widthM / room.lengthM;
}
