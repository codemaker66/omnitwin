import type { FloorPlanPoint } from "../space.js";
import type { SolverPlacedObject } from "./types.js";
import type { SolverInput, SolverOutput, SolverConfig, FireExit } from "./types.js";
import { SOLVER_ASSETS, SOLVER_ASSET_DIMENSIONS } from "./types.js";
import {
  pointInPolygon,
  circleInPolygon,
  distanceToEdge,
  distanceToPoint,
  generateGridPoints,
} from "./geometry.js";
import { generateComplianceReport } from "./compliance.js";

// ---------------------------------------------------------------------------
// Layout strategies — one per LayoutStyle
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Constants — real UK event furniture dimensions
// ---------------------------------------------------------------------------

const ROUND_TABLE_DIAMETER = SOLVER_ASSET_DIMENSIONS[SOLVER_ASSETS.ROUND_TABLE_5FT].diameter;
const ROUND_TABLE_RADIUS = ROUND_TABLE_DIAMETER / 2;
const RECT_TABLE_WIDTH = SOLVER_ASSET_DIMENSIONS[SOLVER_ASSETS.RECTANGULAR_TABLE_6FT].width;
const RECT_TABLE_DEPTH = SOLVER_ASSET_DIMENSIONS[SOLVER_ASSETS.RECTANGULAR_TABLE_6FT].depth;
const CHAIR_WIDTH = SOLVER_ASSET_DIMENSIONS[SOLVER_ASSETS.CHAIR_STANDARD].width;
const CHAIR_DEPTH = SOLVER_ASSET_DIMENSIONS[SOLVER_ASSETS.CHAIR_STANDARD].depth;
const HIGHBOY_DIAMETER = SOLVER_ASSET_DIMENSIONS[SOLVER_ASSETS.HIGHBOY_TABLE].diameter;

/** Distance from table center to chair center for round tables. */
const CHAIR_OFFSET_FROM_ROUND_TABLE = ROUND_TABLE_RADIUS + CHAIR_DEPTH / 2 + 0.05;

/** Row spacing (back-to-back) for theatre/ceremony seating. */
const ROW_SPACING = 0.9;

/** Chair spacing along a row. */
const CHAIR_ROW_SPACING = 0.5;

/** Centre aisle width. */
const CENTRE_AISLE_WIDTH = 1.5;

/** Side aisle margin from walls. */
const SIDE_AISLE_MARGIN = 1.2;

/** First row distance from stage/front wall. */
const FRONT_ROW_OFFSET = 2.0;

/** Chair spacing around rectangular table edges. */
const RECT_CHAIR_SPACING = 0.7;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal ambient declaration for the Web Crypto API global.
 *  The types package compiles with `lib: ["ES2022"]` (no DOM, no @types/node)
 *  to stay isomorphic, so we declare the sliver of `crypto` we actually use.
 *  At runtime this resolves to `globalThis.crypto`, which exists in Node 19+
 *  and all modern browsers — no polyfill required. */
declare const crypto: { readonly randomUUID: () => string };

/** Generates a cryptographically random UUID v4. */
function generateUUID(): string {
  return crypto.randomUUID();
}

function createSolverPlacedObject(
  furnitureItemId: string,
  x: number,
  z: number,
  rotationY: number = 0,
): SolverPlacedObject {
  return {
    id: generateUUID(),
    furnitureItemId,
    position: { x, y: 0, z },
    rotation: { x: 0, y: rotationY, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

/** Checks if a position is far enough from all fire exits. */
function clearOfFireExits(
  x: number,
  z: number,
  radius: number,
  fireExits: readonly FireExit[],
  clearanceM: number,
): boolean {
  for (const exit of fireExits) {
    const dist = distanceToPoint({ x, y: z }, exit.position);
    if (dist - radius < clearanceM) return false;
  }
  return true;
}

/** Checks if position is far enough from all fixed objects. */
function clearOfFixedObjects(
  x: number,
  z: number,
  radius: number,
  fixedObjects: readonly SolverPlacedObject[],
  minGap: number,
): boolean {
  for (const obj of fixedObjects) {
    const dist = distanceToPoint({ x, y: z }, { x: obj.position.x, y: obj.position.z });
    if (dist - radius < minGap) return false;
  }
  return true;
}

function buildOutput(
  objects: readonly SolverPlacedObject[],
  capacity: number,
  input: SolverInput,
  config: SolverConfig,
): SolverOutput {
  return {
    placedObjects: [...objects],
    actualCapacity: capacity,
    complianceReport: generateComplianceReport(
      objects,
      input.fireExits,
      input.roomPolygon,
      config,
    ),
  };
}

// ---------------------------------------------------------------------------
// 1. Dinner Rounds — round tables with chairs evenly spaced around
// ---------------------------------------------------------------------------

export function solveDinnerRounds(input: SolverInput, config: SolverConfig): SolverOutput {
  if (input.guestCount === 0) return buildOutput([], 0, input, config);

  const seatsPerTable = config.chairSpacingDeg <= 36 ? 10 : 8;
  const tablesNeeded = Math.ceil(input.guestCount / seatsPerTable);
  const fixed = input.fixedObjects ?? [];

  // Center-to-center spacing: table diameter + chairs on both sides + aisle
  const spacing = ROUND_TABLE_DIAMETER + CHAIR_DEPTH * 2 + config.minAisleWidthM;

  // Generate candidate positions
  const candidates = generateGridPoints(input.roomPolygon, spacing, spacing);

  // Filter: must fit circle, clear of exits, clear of fixed objects, clear of walls
  const minWallDist = config.minAisleWidthM + ROUND_TABLE_RADIUS + CHAIR_DEPTH;
  const validPositions = candidates.filter((p) => {
    if (!circleInPolygon(p, ROUND_TABLE_RADIUS, input.roomPolygon)) return false;
    if (distanceToEdge(p, input.roomPolygon) < minWallDist) return false;
    if (!clearOfFireExits(p.x, p.y, ROUND_TABLE_RADIUS + CHAIR_DEPTH, input.fireExits, config.fireExitClearanceM)) return false;
    if (!clearOfFixedObjects(p.x, p.y, ROUND_TABLE_RADIUS + CHAIR_DEPTH, fixed, config.minTableSpacingM)) return false;
    return true;
  });

  // Remove tables on the centre aisle (longitudinal centerline of the room)
  const roomCenterY = (input.roomDimensions.length) / 2;
  const aisleHalf = CENTRE_AISLE_WIDTH / 2;
  const withAisle = validPositions.filter((p) =>
    Math.abs(p.y - roomCenterY) > aisleHalf,
  );

  // Take only as many tables as needed
  const tablesToPlace = withAisle.slice(0, tablesNeeded);

  const objects: SolverPlacedObject[] = [];
  let totalSeats = 0;

  for (const pos of tablesToPlace) {
    objects.push(createSolverPlacedObject(SOLVER_ASSETS.ROUND_TABLE_5FT, pos.x, pos.y));

    // Place chairs radially
    const angleDeg = 360 / seatsPerTable;
    for (let i = 0; i < seatsPerTable; i++) {
      const angleRad = (i * angleDeg * Math.PI) / 180;
      const cx = pos.x + Math.cos(angleRad) * CHAIR_OFFSET_FROM_ROUND_TABLE;
      const cz = pos.y + Math.sin(angleRad) * CHAIR_OFFSET_FROM_ROUND_TABLE;

      // Chair faces inward (toward table center)
      const facingAngle = angleRad + Math.PI;
      const chairPos: FloorPlanPoint = { x: cx, y: cz };

      if (pointInPolygon(chairPos, input.roomPolygon)) {
        objects.push(createSolverPlacedObject(SOLVER_ASSETS.CHAIR_STANDARD, cx, cz, facingAngle));
        totalSeats++;
      }
    }
  }

  return buildOutput(objects, totalSeats, input, config);
}

// ---------------------------------------------------------------------------
// 2. Theatre — rows of chairs facing the short wall (stage end)
// ---------------------------------------------------------------------------

export function solveTheatre(input: SolverInput, config: SolverConfig): SolverOutput {
  if (input.guestCount === 0) return buildOutput([], 0, input, config);

  const roomW = input.roomDimensions.width;
  const roomL = input.roomDimensions.length;
  const fixed = input.fixedObjects ?? [];

  // Usable width after side aisles
  const usableWidth = roomW - SIDE_AISLE_MARGIN * 2;
  if (usableWidth < CHAIR_WIDTH) return buildOutput([], 0, input, config);

  // Chairs per half (split by centre aisle)
  const halfWidth = (usableWidth - CENTRE_AISLE_WIDTH) / 2;
  const chairsPerHalf = Math.floor(halfWidth / CHAIR_ROW_SPACING);
  const chairsPerRow = chairsPerHalf * 2;
  if (chairsPerRow === 0) return buildOutput([], 0, input, config);

  const rowsNeeded = Math.ceil(input.guestCount / chairsPerRow);

  const objects: SolverPlacedObject[] = [];
  let totalSeats = 0;

  for (let row = 0; row < rowsNeeded; row++) {
    const z = FRONT_ROW_OFFSET + row * ROW_SPACING;
    if (z > roomL - SIDE_AISLE_MARGIN) break;

    // Stagger alternate rows by half a chair width
    const stagger = row % 2 === 0 ? 0 : CHAIR_ROW_SPACING / 2;

    // Left block
    for (let i = 0; i < chairsPerHalf; i++) {
      const x = SIDE_AISLE_MARGIN + i * CHAIR_ROW_SPACING + stagger;
      if (x + CHAIR_WIDTH / 2 > roomW / 2 - CENTRE_AISLE_WIDTH / 2) continue;

      const pos: FloorPlanPoint = { x, y: z };
      if (!pointInPolygon(pos, input.roomPolygon)) continue;
      if (!clearOfFixedObjects(x, z, CHAIR_WIDTH / 2, fixed, config.minTableSpacingM)) continue;

      objects.push(createSolverPlacedObject(SOLVER_ASSETS.CHAIR_STANDARD, x, z, 0));
      totalSeats++;
      if (totalSeats >= input.guestCount) break;
    }
    if (totalSeats >= input.guestCount) break;

    // Right block
    for (let i = 0; i < chairsPerHalf; i++) {
      const x = roomW / 2 + CENTRE_AISLE_WIDTH / 2 + i * CHAIR_ROW_SPACING + stagger;
      if (x + CHAIR_WIDTH / 2 > roomW - SIDE_AISLE_MARGIN) continue;

      const pos: FloorPlanPoint = { x, y: z };
      if (!pointInPolygon(pos, input.roomPolygon)) continue;
      if (!clearOfFixedObjects(x, z, CHAIR_WIDTH / 2, fixed, config.minTableSpacingM)) continue;

      objects.push(createSolverPlacedObject(SOLVER_ASSETS.CHAIR_STANDARD, x, z, 0));
      totalSeats++;
      if (totalSeats >= input.guestCount) break;
    }
    if (totalSeats >= input.guestCount) break;
  }

  return buildOutput(objects, totalSeats, input, config);
}

// ---------------------------------------------------------------------------
// 3. Boardroom — single large rectangular table (or U-shape) centered
// ---------------------------------------------------------------------------

export function solveBoardroom(input: SolverInput, config: SolverConfig): SolverOutput {
  if (input.guestCount === 0) return buildOutput([], 0, input, config);

  const roomW = input.roomDimensions.width;
  const roomL = input.roomDimensions.length;
  const centerX = roomW / 2;
  const centerZ = roomL / 2;

  const objects: SolverPlacedObject[] = [];
  let totalSeats = 0;

  if (input.guestCount <= 20) {
    // Single rectangular table centered
    // Table length based on guest count: chairs on both long sides
    const chairsPerSide = Math.ceil(input.guestCount / 2);
    const tableLength = Math.max(RECT_TABLE_WIDTH, chairsPerSide * RECT_CHAIR_SPACING);
    const tableDepth = RECT_TABLE_DEPTH;

    objects.push(createSolverPlacedObject(SOLVER_ASSETS.RECTANGULAR_TABLE_6FT, centerX, centerZ, 0));

    // Chairs along both long sides
    for (let side = 0; side < 2; side++) {
      const zOff = side === 0
        ? centerZ - tableDepth / 2 - CHAIR_DEPTH / 2 - 0.05
        : centerZ + tableDepth / 2 + CHAIR_DEPTH / 2 + 0.05;
      const facing = side === 0 ? 0 : Math.PI;

      for (let i = 0; i < chairsPerSide; i++) {
        const x = centerX - (tableLength / 2) + RECT_CHAIR_SPACING / 2 + i * RECT_CHAIR_SPACING;
        const pos: FloorPlanPoint = { x, y: zOff };
        if (!pointInPolygon(pos, input.roomPolygon)) continue;

        objects.push(createSolverPlacedObject(SOLVER_ASSETS.CHAIR_STANDARD, x, zOff, facing));
        totalSeats++;
        if (totalSeats >= input.guestCount) break;
      }
      if (totalSeats >= input.guestCount) break;
    }
  } else {
    // U-shape: head table + two wing tables
    const headZ = SIDE_AISLE_MARGIN + RECT_TABLE_DEPTH / 2;
    objects.push(createSolverPlacedObject(SOLVER_ASSETS.RECTANGULAR_TABLE_6FT, centerX, headZ, 0));

    // Head table chairs (outside edge only)
    const headChairs = Math.min(6, Math.floor(RECT_TABLE_WIDTH / RECT_CHAIR_SPACING));
    for (let i = 0; i < headChairs; i++) {
      const x = centerX - (RECT_TABLE_WIDTH / 2) + RECT_CHAIR_SPACING / 2 + i * RECT_CHAIR_SPACING;
      objects.push(createSolverPlacedObject(
        SOLVER_ASSETS.CHAIR_STANDARD, x,
        headZ - RECT_TABLE_DEPTH / 2 - CHAIR_DEPTH / 2 - 0.05,
        0,
      ));
      totalSeats++;
    }

    // Left wing
    const wingLength = roomL - SIDE_AISLE_MARGIN * 2 - RECT_TABLE_DEPTH;
    const wingX = centerX - roomW / 4;
    const wingZ = headZ + RECT_TABLE_DEPTH / 2 + wingLength / 2;
    objects.push(createSolverPlacedObject(SOLVER_ASSETS.RECTANGULAR_TABLE_6FT, wingX, wingZ, Math.PI / 2));

    // Right wing
    const wingXR = centerX + roomW / 4;
    objects.push(createSolverPlacedObject(SOLVER_ASSETS.RECTANGULAR_TABLE_6FT, wingXR, wingZ, Math.PI / 2));

    // Chairs along inner edge of wings
    const wingChairs = Math.floor(wingLength / RECT_CHAIR_SPACING);
    for (let i = 0; i < wingChairs; i++) {
      const z = headZ + RECT_TABLE_DEPTH + i * RECT_CHAIR_SPACING + RECT_CHAIR_SPACING / 2;
      if (z > roomL - SIDE_AISLE_MARGIN) break;

      // Left wing — chairs on right side (inner)
      objects.push(createSolverPlacedObject(
        SOLVER_ASSETS.CHAIR_STANDARD,
        wingX + RECT_TABLE_DEPTH / 2 + CHAIR_DEPTH / 2 + 0.05, z,
        -Math.PI / 2,
      ));
      totalSeats++;

      // Right wing — chairs on left side (inner)
      objects.push(createSolverPlacedObject(
        SOLVER_ASSETS.CHAIR_STANDARD,
        wingXR - RECT_TABLE_DEPTH / 2 - CHAIR_DEPTH / 2 - 0.05, z,
        Math.PI / 2,
      ));
      totalSeats++;

      if (totalSeats >= input.guestCount) break;
    }
  }

  return buildOutput(objects, totalSeats, input, config);
}

// ---------------------------------------------------------------------------
// 4. Cabaret — round tables with chairs on stage-facing side only
// ---------------------------------------------------------------------------

export function solveCabaret(input: SolverInput, config: SolverConfig): SolverOutput {
  if (input.guestCount === 0) return buildOutput([], 0, input, config);

  const seatsPerTable = 5; // Crescent/cabaret: chairs on front 180° only
  const tablesNeeded = Math.ceil(input.guestCount / seatsPerTable);
  const fixed = input.fixedObjects ?? [];

  const spacing = ROUND_TABLE_DIAMETER + CHAIR_DEPTH * 2 + config.minAisleWidthM;
  const candidates = generateGridPoints(input.roomPolygon, spacing, spacing);

  const minWallDist = config.minAisleWidthM + ROUND_TABLE_RADIUS + CHAIR_DEPTH;
  const validPositions = candidates.filter((p) => {
    if (!circleInPolygon(p, ROUND_TABLE_RADIUS, input.roomPolygon)) return false;
    if (distanceToEdge(p, input.roomPolygon) < minWallDist) return false;
    if (!clearOfFireExits(p.x, p.y, ROUND_TABLE_RADIUS + CHAIR_DEPTH, input.fireExits, config.fireExitClearanceM)) return false;
    if (!clearOfFixedObjects(p.x, p.y, ROUND_TABLE_RADIUS + CHAIR_DEPTH, fixed, config.minTableSpacingM)) return false;
    return true;
  });

  const tablesToPlace = validPositions.slice(0, tablesNeeded);
  const objects: SolverPlacedObject[] = [];
  let totalSeats = 0;

  for (const pos of tablesToPlace) {
    objects.push(createSolverPlacedObject(SOLVER_ASSETS.ROUND_TABLE_5FT, pos.x, pos.y));

    // Place 5 chairs on the stage-facing side (front 180°, which is the
    // side facing z=0 / the short wall where the stage would be)
    const angleRange = Math.PI; // 180 degrees
    const startAngle = Math.PI / 2; // Start from right, sweep through front
    const angleStep = angleRange / (seatsPerTable - 1);

    for (let i = 0; i < seatsPerTable; i++) {
      const angleRad = startAngle + i * angleStep;
      const cx = pos.x + Math.cos(angleRad) * CHAIR_OFFSET_FROM_ROUND_TABLE;
      const cz = pos.y - Math.sin(angleRad) * CHAIR_OFFSET_FROM_ROUND_TABLE;

      // Chairs face forward (toward stage at z=0)
      const chairPos: FloorPlanPoint = { x: cx, y: cz };
      if (pointInPolygon(chairPos, input.roomPolygon)) {
        objects.push(createSolverPlacedObject(SOLVER_ASSETS.CHAIR_STANDARD, cx, cz, 0));
        totalSeats++;
      }
    }
  }

  return buildOutput(objects, totalSeats, input, config);
}

// ---------------------------------------------------------------------------
// 5. Cocktail — standing/highboy tables, no seated chairs
// ---------------------------------------------------------------------------

export function solveCocktail(input: SolverInput, config: SolverConfig): SolverOutput {
  if (input.guestCount === 0) return buildOutput([], 0, input, config);

  const fixed = input.fixedObjects ?? [];

  // Highboy tables at ~2.5m spacing, roughly 1 per 4-6 guests
  const tablesNeeded = Math.ceil(input.guestCount / 5);
  const spacing = 2.5;

  const candidates = generateGridPoints(input.roomPolygon, spacing, spacing);

  const minWallDist = config.minAisleWidthM + HIGHBOY_DIAMETER / 2;
  const validPositions = candidates.filter((p) => {
    if (!circleInPolygon(p, HIGHBOY_DIAMETER / 2, input.roomPolygon)) return false;
    if (distanceToEdge(p, input.roomPolygon) < minWallDist) return false;
    if (!clearOfFireExits(p.x, p.y, HIGHBOY_DIAMETER / 2, input.fireExits, config.fireExitClearanceM)) return false;
    if (!clearOfFixedObjects(p.x, p.y, HIGHBOY_DIAMETER / 2, fixed, config.minTableSpacingM)) return false;
    return true;
  });

  // Leave center area open for circulation — skip tables in the middle third
  const roomCenterX = input.roomDimensions.width / 2;
  const roomCenterZ = input.roomDimensions.length / 2;
  const openRadius = Math.min(input.roomDimensions.width, input.roomDimensions.length) * 0.2;

  const withOpenCenter = validPositions.filter((p) => {
    const dist = distanceToPoint(p, { x: roomCenterX, y: roomCenterZ });
    return dist > openRadius;
  });

  const tablesToPlace = withOpenCenter.slice(0, tablesNeeded);
  const objects: SolverPlacedObject[] = [];

  for (const pos of tablesToPlace) {
    objects.push(createSolverPlacedObject(SOLVER_ASSETS.HIGHBOY_TABLE, pos.x, pos.y));
  }

  // No seated chairs — cocktail standing only
  // Capacity = guestCount (standing, not seated)
  const actualCapacity = Math.min(input.guestCount, tablesToPlace.length * 5);

  return buildOutput(objects, actualCapacity, input, config);
}

// ---------------------------------------------------------------------------
// 6. Ceremony — two blocks of chairs with central aisle
// ---------------------------------------------------------------------------

export function solveCeremony(input: SolverInput, config: SolverConfig): SolverOutput {
  if (input.guestCount === 0) return buildOutput([], 0, input, config);

  const roomW = input.roomDimensions.width;
  const roomL = input.roomDimensions.length;
  const fixed = input.fixedObjects ?? [];

  const usableWidth = roomW - SIDE_AISLE_MARGIN * 2;
  if (usableWidth < CHAIR_WIDTH) return buildOutput([], 0, input, config);

  const halfWidth = (usableWidth - CENTRE_AISLE_WIDTH) / 2;
  const chairsPerHalf = Math.floor(halfWidth / CHAIR_ROW_SPACING);
  const chairsPerRow = chairsPerHalf * 2;
  if (chairsPerRow === 0) return buildOutput([], 0, input, config);

  // Reserved front rows have more spacing
  const reservedRows = 3;
  const reservedRowSpacing = 1.1;
  const rowsNeeded = Math.ceil(input.guestCount / chairsPerRow);

  const objects: SolverPlacedObject[] = [];
  let totalSeats = 0;

  for (let row = 0; row < rowsNeeded; row++) {
    const isReserved = row < reservedRows;
    const z = FRONT_ROW_OFFSET +
      (isReserved ? row * reservedRowSpacing : reservedRows * reservedRowSpacing + (row - reservedRows) * ROW_SPACING);

    if (z > roomL - SIDE_AISLE_MARGIN) break;

    // Left block
    for (let i = 0; i < chairsPerHalf; i++) {
      const x = SIDE_AISLE_MARGIN + i * CHAIR_ROW_SPACING;
      if (x + CHAIR_WIDTH / 2 > roomW / 2 - CENTRE_AISLE_WIDTH / 2) continue;

      const pos: FloorPlanPoint = { x, y: z };
      if (!pointInPolygon(pos, input.roomPolygon)) continue;
      if (!clearOfFixedObjects(x, z, CHAIR_WIDTH / 2, fixed, config.minTableSpacingM)) continue;

      objects.push(createSolverPlacedObject(SOLVER_ASSETS.CHAIR_STANDARD, x, z, 0));
      totalSeats++;
      if (totalSeats >= input.guestCount) break;
    }
    if (totalSeats >= input.guestCount) break;

    // Right block
    for (let i = 0; i < chairsPerHalf; i++) {
      const x = roomW / 2 + CENTRE_AISLE_WIDTH / 2 + i * CHAIR_ROW_SPACING;
      if (x + CHAIR_WIDTH / 2 > roomW - SIDE_AISLE_MARGIN) continue;

      const pos: FloorPlanPoint = { x, y: z };
      if (!pointInPolygon(pos, input.roomPolygon)) continue;
      if (!clearOfFixedObjects(x, z, CHAIR_WIDTH / 2, fixed, config.minTableSpacingM)) continue;

      objects.push(createSolverPlacedObject(SOLVER_ASSETS.CHAIR_STANDARD, x, z, 0));
      totalSeats++;
      if (totalSeats >= input.guestCount) break;
    }
    if (totalSeats >= input.guestCount) break;
  }

  return buildOutput(objects, totalSeats, input, config);
}

// ---------------------------------------------------------------------------
// 7. Dinner Banquet — long rectangular tables in parallel rows
// ---------------------------------------------------------------------------

export function solveDinnerBanquet(input: SolverInput, config: SolverConfig): SolverOutput {
  if (input.guestCount === 0) return buildOutput([], 0, input, config);

  const roomW = input.roomDimensions.width;
  const roomL = input.roomDimensions.length;
  const fixed = input.fixedObjects ?? [];

  // Chairs on both long sides of each table
  const seatsPerTable = Math.floor(RECT_TABLE_WIDTH / RECT_CHAIR_SPACING) * 2;
  const tablesNeeded = Math.ceil(input.guestCount / seatsPerTable);

  // Table rows run along the room length
  // Row spacing: table depth + chair depth * 2 + aisle
  const rowSpacing = RECT_TABLE_DEPTH + CHAIR_DEPTH * 2 + config.minAisleWidthM;

  // How many rows fit?
  const usableWidth = roomW - SIDE_AISLE_MARGIN * 2;
  const rowsCount = Math.max(1, Math.floor(usableWidth / rowSpacing));

  // Tables per row (along room length), with cross-aisle every 3 tables
  const tableRunLength = RECT_TABLE_WIDTH + config.minTableSpacingM;
  const crossAisleInterval = 3;
  const crossAisleWidth = 1.2;

  const objects: SolverPlacedObject[] = [];
  let totalSeats = 0;
  let tablesPlaced = 0;

  // Head table perpendicular at front
  const headTableZ = SIDE_AISLE_MARGIN + RECT_TABLE_DEPTH / 2;
  const headTableX = roomW / 2;
  objects.push(createSolverPlacedObject(SOLVER_ASSETS.RECTANGULAR_TABLE_6FT, headTableX, headTableZ, Math.PI / 2));

  // Head table chairs (facing the room)
  const headChairs = Math.floor(RECT_TABLE_WIDTH / RECT_CHAIR_SPACING);
  for (let i = 0; i < headChairs; i++) {
    const x = headTableX - RECT_TABLE_WIDTH / 2 + RECT_CHAIR_SPACING / 2 + i * RECT_CHAIR_SPACING;
    objects.push(createSolverPlacedObject(
      SOLVER_ASSETS.CHAIR_STANDARD, x,
      headTableZ - RECT_TABLE_DEPTH / 2 - CHAIR_DEPTH / 2 - 0.05,
      0,
    ));
    totalSeats++;
    if (totalSeats >= input.guestCount) break;
  }

  // Parallel rows
  const startZ = headTableZ + RECT_TABLE_DEPTH / 2 + config.minAisleWidthM + CHAIR_DEPTH + RECT_TABLE_DEPTH / 2;

  for (let rowIdx = 0; rowIdx < rowsCount && tablesPlaced < tablesNeeded; rowIdx++) {
    const rowX = SIDE_AISLE_MARGIN + rowSpacing / 2 + rowIdx * rowSpacing;
    if (rowX > roomW - SIDE_AISLE_MARGIN) break;

    let tableIdx = 0;
    let z = startZ;

    while (z + RECT_TABLE_WIDTH / 2 < roomL - SIDE_AISLE_MARGIN && tablesPlaced < tablesNeeded) {
      // Cross-aisle break
      if (tableIdx > 0 && tableIdx % crossAisleInterval === 0) {
        z += crossAisleWidth;
      }

      const pos: FloorPlanPoint = { x: rowX, y: z };
      if (!pointInPolygon(pos, input.roomPolygon)) { z += tableRunLength; tableIdx++; continue; }
      if (!clearOfFixedObjects(rowX, z, RECT_TABLE_WIDTH / 2, fixed, config.minTableSpacingM)) { z += tableRunLength; tableIdx++; continue; }

      objects.push(createSolverPlacedObject(SOLVER_ASSETS.RECTANGULAR_TABLE_6FT, rowX, z, Math.PI / 2));
      tablesPlaced++;

      // Chairs on both sides
      const chairsOnSide = Math.floor(RECT_TABLE_WIDTH / RECT_CHAIR_SPACING);
      for (let side = 0; side < 2; side++) {
        const xOff = side === 0
          ? rowX - RECT_TABLE_DEPTH / 2 - CHAIR_DEPTH / 2 - 0.05
          : rowX + RECT_TABLE_DEPTH / 2 + CHAIR_DEPTH / 2 + 0.05;
        const facing = side === 0 ? Math.PI / 2 : -Math.PI / 2;

        for (let ci = 0; ci < chairsOnSide; ci++) {
          const cz = z - RECT_TABLE_WIDTH / 2 + RECT_CHAIR_SPACING / 2 + ci * RECT_CHAIR_SPACING;
          const cPos: FloorPlanPoint = { x: xOff, y: cz };
          if (!pointInPolygon(cPos, input.roomPolygon)) continue;

          objects.push(createSolverPlacedObject(SOLVER_ASSETS.CHAIR_STANDARD, xOff, cz, facing));
          totalSeats++;
          if (totalSeats >= input.guestCount) break;
        }
        if (totalSeats >= input.guestCount) break;
      }

      z += tableRunLength;
      tableIdx++;
      if (totalSeats >= input.guestCount) break;
    }
    if (totalSeats >= input.guestCount) break;
  }

  return buildOutput(objects, totalSeats, input, config);
}
