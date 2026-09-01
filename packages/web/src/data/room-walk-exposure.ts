// ---------------------------------------------------------------------------
// Which captured rooms a visitor may walk.
//
// A staged capture renders whether or not its alignment is right, and six of
// the eight Trades Hall rooms shipped at alignment "review". Rendering is not
// the question; whether a visitor standing in it is INSIDE THE ROOM is. The
// walk box, spawn and clip come from the scanner's own trajectory, and for
// three rooms that trajectory cannot describe the room at all until the
// ingest tool learns to crop the walk as well as the mesh and to rotate a
// room that the scanner swept at an angle (see the reasons below).
//
// This is a decision record, not a heuristic: one entry per captured room,
// with the reason and the date it was taken, reviewable in git. A room that
// is missing here is closed. Reopening a room is a one-line change here, made
// only after someone has stood at its spawn and looked.
//
// Decisions of 2026-09-01 follow docs/handoffs/SPLAT-ALIGNMENT-STATUS.md and
// the per-room analysis recorded in docs/state/tasks.md under T-568.
// ---------------------------------------------------------------------------

export interface RoomWalkDecision {
  /** May a visitor open /room/<slug> and be placed in the capture? */
  readonly walkable: boolean;
  /** ISO date the decision was taken. */
  readonly decidedOn: string;
  /** Why, in terms a reviewer can check against the manifest. */
  readonly reason: string;
}

export const ROOM_WALK_EXPOSURE: Readonly<Record<string, RoomWalkDecision>> = {
  "grand-hall": {
    walkable: true,
    decidedOn: "2026-09-01",
    reason:
      "Walk footprint agrees with the published 21 x 10 m within 5%. The floor had been " +
      "taken from a slab a storey lower and 18 m outside the hall, which put visitors " +
      "under the floor; the roomCropM of 2026-09-01 removes it. Mesh-check span 11.3 x " +
      "21.1 x 7.4 m at 92% retention, confident; the walkable footprint printed to " +
      "visitors is the walk's 10.1 x 19.9 x 7.4 m.",
  },
  "reception-room": {
    walkable: true,
    decidedOn: "2026-09-01",
    reason: "Clean single-room scan, 96% retention, agrees with the published 13.4 x 11.2 m.",
  },
  "deacon-conveners-room": {
    walkable: true,
    decidedOn: "2026-09-01",
    reason: "Clean single-room scan, 99% retention, nothing outside the room in the walk.",
  },
  "saloon": {
    walkable: true,
    decidedOn: "2026-09-01",
    reason:
      "Walk keeps the visitor 0.7 to 1.4 m inside the walls and the floor is right. Still " +
      "'review' because the mesh's 9.9 m built width disagrees with the venue's 7 m clear " +
      "width, a human call on which figure to print, not a containment defect. Dimensions " +
      "are withheld until that call is made.",
  },
  "south-gallery": {
    walkable: true,
    decidedOn: "2026-09-01",
    reason:
      "Walk is inside the gallery on every side by 0.3 to 1.4 m. A 5 m stair west of the " +
      "room dragged the mesh frame; the roomCropM of 2026-09-01 excludes it and the frame " +
      "reaches 99% retention, confident.",
  },
  "robert-adam-room": {
    walkable: false,
    decidedOn: "2026-09-01",
    reason:
      "Whole-floor scan (49% retention): the walk box is the entire floor, so a visitor " +
      "could wander corridors and neighbouring rooms under this room's name. roomCropM " +
      "crops only the mesh; the tool must crop the walk too before this room can open.",
  },
  "north-gallery": {
    walkable: false,
    decidedOn: "2026-09-01",
    reason:
      "The gallery runs at about 45 degrees to the scanner's axes. An axis-aligned walk box " +
      "puts its corners outside the walls, so a visitor can walk through them. The tool " +
      "needs a yaw step before any frame for this room means anything.",
  },
  "lady-convenors-room": {
    walkable: false,
    decidedOn: "2026-09-01",
    reason:
      "The visitor is contained, but the operator walked only the west 4 x 4 m of an " +
      "8.9 x 6.1 m room and the clip box follows the walk, so the east half of the room is " +
      "cut away. Opening it would show half a room; the extent must come from the cropped " +
      "mesh, not the walk.",
  },
};

export function roomWalkExposure(roomSlug: string): RoomWalkDecision | null {
  return ROOM_WALK_EXPOSURE[roomSlug] ?? null;
}

/** The closed door is the default: unknown or undecided rooms are not walkable. */
export function isRoomWalkable(roomSlug: string): boolean {
  return ROOM_WALK_EXPOSURE[roomSlug]?.walkable === true;
}
