// ---------------------------------------------------------------------------
// theatre-layout — theatre/ceremony auto-arrangement engine (planning-grade).
//
// Rows of chairs all facing a stage at one end, split by a centre aisle, with a
// clear stage zone kept at the front and comfortable row/seat pitch. The
// audience faces down the room's LONGER axis (proper theatre depth) — a planner
// would reject a wide, shallow block. Deterministic and pure; positions in
// METRES on a room-centred origin (× RENDER_SCALE to land in the scene).
//
// SAFE LANGUAGE: PLANNING-GRADE. Seat/row/aisle pitches are event-planning
// comfort targets, NOT fire-code egress widths; human review before any layout
// reaches a client.
// ---------------------------------------------------------------------------

/** One generated seat, metres, room-centred; rotationY faces the stage. */
export interface TheatreSeatPlacement {
  readonly xM: number;
  readonly zM: number;
  readonly rotationY: number;
}

export interface TheatreLayoutOptions {
  /** Stop once seats reach this many guests (rounded up to full rows). */
  readonly targetGuests?: number;
  /** Side-to-side centre spacing per seat, metres. */
  readonly seatPitchM?: number;
  /** Front-to-back row spacing, metres. */
  readonly rowPitchM?: number;
  /** Centre aisle width, metres. */
  readonly aisleM?: number;
  /** Clear zone kept at the stage (front) end, metres. */
  readonly stageDepthM?: number;
  /** Clear band kept from the walls, metres. */
  readonly wallClearanceM?: number;
  /** Hard cap on total seats. */
  readonly maxSeats?: number;
}

export interface TheatreLayoutPlan {
  readonly seats: readonly TheatreSeatPlacement[];
  readonly seatCount: number;
  readonly rows: number;
  readonly seatsPerRow: number;
  readonly seatsPerBlock: number;
  readonly aisleM: number;
  readonly stageDepthM: number;
  /** True when the stage is at the −Z end (audience faces −Z); else −X end. */
  readonly alongLength: boolean;
}

const DEFAULT_SEAT_PITCH_M = 0.52;
const DEFAULT_ROW_PITCH_M = 0.9;
const DEFAULT_AISLE_M = 1.1;
const DEFAULT_STAGE_DEPTH_M = 2.4;
const DEFAULT_WALL_CLEARANCE_M = 0.7;

/**
 * Plan a theatre seating block for a room. Pure. The stage sits at one end of
 * the room's longer axis; every chair faces it. Rows are placed front-to-back
 * (nearest the stage first); a target rounds UP to full rows (a few spare seats
 * is friendlier than leaving guests short).
 */
export function planTheatreLayout(
  roomWidthM: number,
  roomLengthM: number,
  options: TheatreLayoutOptions = {},
): TheatreLayoutPlan {
  const seatPitchM = options.seatPitchM ?? DEFAULT_SEAT_PITCH_M;
  const rowPitchM = options.rowPitchM ?? DEFAULT_ROW_PITCH_M;
  const aisleM = options.aisleM ?? DEFAULT_AISLE_M;
  const stageDepthM = options.stageDepthM ?? DEFAULT_STAGE_DEPTH_M;
  const wallClearanceM = options.wallClearanceM ?? DEFAULT_WALL_CLEARANCE_M;

  const width = Math.max(0, roomWidthM);
  const length = Math.max(0, roomLengthM);
  // Audience faces down the longer axis.
  const alongLength = length >= width;
  const depthM = alongLength ? length : width;
  const crossM = alongLength ? width : length;

  const usableCrossM = Math.max(0, crossM - 2 * wallClearanceM);
  const blockWidthM = Math.max(0, (usableCrossM - aisleM) / 2);
  const seatsPerBlock = Math.max(0, Math.floor(blockWidthM / seatPitchM));
  const seatsPerRow = 2 * seatsPerBlock;

  const frontD = -depthM / 2 + stageDepthM;
  const backD = depthM / 2 - wallClearanceM;
  const usableDepthM = backD - frontD;
  const roomRows = usableDepthM >= 0 ? Math.floor(usableDepthM / rowPitchM) + 1 : 0;

  const base = { seatsPerRow, seatsPerBlock, aisleM, stageDepthM, alongLength };
  if (seatsPerRow === 0 || roomRows === 0) {
    return { ...base, seats: [], seatCount: 0, rows: 0 };
  }

  let rows = roomRows;
  if (options.targetGuests !== undefined && options.targetGuests > 0) {
    rows = Math.min(rows, Math.ceil(options.targetGuests / seatsPerRow));
  }
  if (options.maxSeats !== undefined && options.maxSeats > 0) {
    rows = Math.min(rows, Math.floor(options.maxSeats / seatsPerRow));
  }
  rows = Math.max(0, rows);
  if (rows === 0) return { ...base, seats: [], seatCount: 0, rows: 0 };

  // Two blocks flanking the centre aisle.
  const blockCentres = (centre: number): number[] => {
    const cs: number[] = [];
    for (let j = 0; j < seatsPerBlock; j += 1) {
      cs.push(centre + (j - (seatsPerBlock - 1) / 2) * seatPitchM);
    }
    return cs;
  };
  const rowCross = [
    ...blockCentres(-(aisleM / 2 + blockWidthM / 2)),
    ...blockCentres(aisleM / 2 + blockWidthM / 2),
  ];

  // rotationY 0 faces −Z; −π/2 faces −X (see table-group.ts facing convention).
  const rotationY = alongLength ? 0 : -Math.PI / 2;
  const seats: TheatreSeatPlacement[] = [];
  for (let r = 0; r < rows; r += 1) {
    const d = frontD + r * rowPitchM;
    for (const c of rowCross) {
      seats.push({ xM: alongLength ? c : d, zM: alongLength ? d : c, rotationY });
    }
  }

  return { ...base, seats, seatCount: seats.length, rows };
}
