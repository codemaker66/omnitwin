import { TRADES_HALL_SALOON_DIMENSIONS, type Space, type SpaceDimensions } from "@omnitwin/types";
import { scaleForRendering } from "../constants/scale.js";
import { computeBoundingBox, resolveRoomGeometry } from "../data/room-geometries.js";

// ---------------------------------------------------------------------------
// The planner lab's other rooms
//
// /dev/planner-lab shows the planner's scene in the Grand Hall. `?space=<slug>`
// shows another Trades Hall room instead, as a made-up Space with no backend:
// the way to look at a surveyed room in the planner's own scene, from the
// planner's own cameras (components/surveyed-room/use-planner-surveyed-room.ts).
// Without the parameter, or with a slug that is not listed here, the lab is
// the Grand Hall exactly as before.
// ---------------------------------------------------------------------------

/** The lab's made-up venue, which it answers for as Trades Hall (the same id as its Grand Hall's). */
export const PLANNER_LAB_VENUE_ID = "00000000-0000-4000-8000-00000000a11a";

function labRoom(id: string, name: string, slug: string, dimensions: SpaceDimensions, sortOrder: number): Space {
  const { width, length, height } = dimensions;
  return {
    id,
    venueId: PLANNER_LAB_VENUE_ID,
    name,
    slug,
    description: null,
    widthM: String(width),
    lengthM: String(length),
    heightM: String(height),
    floorPlanOutline: [
      { x: -width / 2, y: -length / 2 },
      { x: width / 2, y: -length / 2 },
      { x: width / 2, y: length / 2 },
      { x: -width / 2, y: length / 2 },
    ],
    meshUrl: null,
    thumbnailUrl: null,
    sortOrder,
    createdAt: "2026-10-10T00:00:00.000Z",
    updatedAt: "2026-10-10T00:00:00.000Z",
  };
}

/** The rooms `?space=` can ask for, by slug: each as production stores its row. */
const ROOMS: ReadonlyMap<string, Space> = new Map([
  ["saloon", labRoom("00000000-0000-4000-8000-00000000a11c", "Saloon", "saloon", TRADES_HALL_SALOON_DIMENSIONS, 3)],
]);

/** The room `?space=<slug>` asks for, or null for the lab's own Grand Hall. */
export function plannerLabRoom(search: string): Space | null {
  const asked = new URLSearchParams(search).get("space");
  return asked === null ? null : ROOMS.get(asked) ?? null;
}

/** The size the planner draws and places in for a room, as its own hooks work it out from the room's data. */
export function plannerLabRoomDimensions(space: Space): SpaceDimensions {
  const geometry = resolveRoomGeometry(space);
  if (geometry === null) return scaleForRendering({ width: parseFloat(space.widthM), length: parseFloat(space.lengthM), height: parseFloat(space.heightM) });
  const bounds = computeBoundingBox(geometry.wallPolygon);
  return scaleForRendering({ width: bounds.width, length: bounds.depth, height: geometry.ceilingHeight });
}
