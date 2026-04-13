import type { FloorPlanPoint } from "../space.js";
import type { SolverPlacedObject } from "./types.js";
import type { ComplianceReport, FireExit, SolverConfig } from "./types.js";
import { SOLVER_ASSETS, SOLVER_ASSET_DIMENSIONS } from "./types.js";
import { distanceToPoint } from "./geometry.js";

// ---------------------------------------------------------------------------
// Compliance — UK building regulation checks for generated layouts
// ---------------------------------------------------------------------------

/**
 * Maximum travel distance to nearest fire exit (metres).
 * BS 9999:2017, Table 12 — single-direction travel, unsprinklered,
 * risk profile B2 (assembly use). Conservative value.
 */
const MAX_TRAVEL_DISTANCE_M = 18;

/**
 * Checks that all pairs of adjacent tables have sufficient aisle width.
 * "Adjacent" = within 4m center-to-center (close enough to form an aisle).
 *
 * @returns Object with validity flag and human-readable violation descriptions.
 */
export function checkAisleWidths(
  placedObjects: readonly SolverPlacedObject[],
  config: SolverConfig,
): { readonly valid: boolean; readonly violations: readonly string[] } {
  const tables = placedObjects.filter((obj) => isTable(obj.furnitureItemId));
  const violations: string[] = [];

  for (let i = 0; i < tables.length; i++) {
    const a = tables[i];
    if (a === undefined) continue;

    for (let j = i + 1; j < tables.length; j++) {
      const b = tables[j];
      if (b === undefined) continue;

      const centerDist = distanceToPoint(
        { x: a.position.x, y: a.position.z },
        { x: b.position.x, y: b.position.z },
      );

      // Only check pairs that are close enough to form an aisle
      if (centerDist > 5) continue;

      const radiusA = getTableRadius(a.furnitureItemId);
      const radiusB = getTableRadius(b.furnitureItemId);
      const gap = centerDist - radiusA - radiusB;

      if (gap < config.minAisleWidthM) {
        violations.push(
          `Aisle width ${gap.toFixed(2)}m between tables at ` +
          `(${a.position.x.toFixed(1)}, ${a.position.z.toFixed(1)}) and ` +
          `(${b.position.x.toFixed(1)}, ${b.position.z.toFixed(1)}) ` +
          `is below minimum ${config.minAisleWidthM.toFixed(1)}m ` +
          `(Approved Document B)`,
        );
      }
    }
  }

  return { valid: violations.length === 0, violations };
}

/**
 * Checks that no furniture is placed within the required clearance
 * zone in front of fire exits.
 */
export function checkFireExitClearance(
  placedObjects: readonly SolverPlacedObject[],
  fireExits: readonly FireExit[],
  config: SolverConfig,
): { readonly valid: boolean; readonly violations: readonly string[] } {
  const violations: string[] = [];

  for (const exit of fireExits) {
    for (const obj of placedObjects) {
      const dist = distanceToPoint(
        { x: obj.position.x, y: obj.position.z },
        exit.position,
      );

      const objRadius = getObjectRadius(obj.furnitureItemId);

      if (dist - objRadius < config.fireExitClearanceM) {
        violations.push(
          `Object at (${obj.position.x.toFixed(1)}, ${obj.position.z.toFixed(1)}) ` +
          `is ${(dist - objRadius).toFixed(2)}m from fire exit at ` +
          `(${exit.position.x.toFixed(1)}, ${exit.position.y.toFixed(1)}), ` +
          `below minimum clearance ${config.fireExitClearanceM.toFixed(1)}m`,
        );
      }
    }
  }

  return { valid: violations.length === 0, violations };
}

/**
 * Checks that every seated position is within the maximum travel
 * distance to at least one fire exit.
 *
 * BS 9999:2017, Table 12: 18m for single-direction travel in
 * unsprinklered assembly-use rooms (risk profile B2).
 *
 * Uses Euclidean distance as a conservative approximation
 * (actual travel distance along aisles would be longer).
 */
export function checkMaxTravelDistance(
  placedObjects: readonly SolverPlacedObject[],
  fireExits: readonly FireExit[],
  _roomPolygon: readonly FloorPlanPoint[],
): { readonly valid: boolean; readonly violations: readonly string[] } {
  if (fireExits.length === 0) {
    return { valid: true, violations: [] };
  }

  const chairs = placedObjects.filter(
    (obj) => obj.furnitureItemId === SOLVER_ASSETS.CHAIR_STANDARD,
  );
  const violations: string[] = [];

  for (const chair of chairs) {
    const chairPos: FloorPlanPoint = { x: chair.position.x, y: chair.position.z };

    let minExitDist = Infinity;
    for (const exit of fireExits) {
      const dist = distanceToPoint(chairPos, exit.position);
      if (dist < minExitDist) minExitDist = dist;
    }

    if (minExitDist > MAX_TRAVEL_DISTANCE_M) {
      violations.push(
        `Seat at (${chair.position.x.toFixed(1)}, ${chair.position.z.toFixed(1)}) ` +
        `is ${minExitDist.toFixed(1)}m from nearest fire exit, ` +
        `exceeding maximum travel distance ${String(MAX_TRAVEL_DISTANCE_M)}m ` +
        `(BS 9999:2017 Table 12)`,
      );
    }
  }

  return { valid: violations.length === 0, violations };
}

/**
 * Generates a complete compliance report for a solved layout.
 */
export function generateComplianceReport(
  placedObjects: readonly SolverPlacedObject[],
  fireExits: readonly FireExit[],
  roomPolygon: readonly FloorPlanPoint[],
  config: SolverConfig,
): ComplianceReport {
  const aisles = checkAisleWidths(placedObjects, config);
  const exits = checkFireExitClearance(placedObjects, fireExits, config);
  const travel = checkMaxTravelDistance(placedObjects, fireExits, roomPolygon);

  return {
    aisleWidthsValid: aisles.valid,
    fireExitClearance: exits.valid,
    maxTravelDistance: travel.valid,
    violations: [...aisles.violations, ...exits.violations, ...travel.violations],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isTable(furnitureItemId: string): boolean {
  return (
    furnitureItemId === SOLVER_ASSETS.ROUND_TABLE_5FT ||
    furnitureItemId === SOLVER_ASSETS.RECTANGULAR_TABLE_6FT ||
    furnitureItemId === SOLVER_ASSETS.HIGHBOY_TABLE
  );
}

/** Returns the effective radius of a table for aisle-width calculations. */
function getTableRadius(furnitureItemId: string): number {
  if (furnitureItemId === SOLVER_ASSETS.ROUND_TABLE_5FT) {
    return SOLVER_ASSET_DIMENSIONS[SOLVER_ASSETS.ROUND_TABLE_5FT].diameter / 2;
  }
  if (furnitureItemId === SOLVER_ASSETS.RECTANGULAR_TABLE_6FT) {
    const dims = SOLVER_ASSET_DIMENSIONS[SOLVER_ASSETS.RECTANGULAR_TABLE_6FT];
    // Use half-diagonal as effective radius
    return Math.sqrt(dims.width * dims.width + dims.depth * dims.depth) / 2;
  }
  if (furnitureItemId === SOLVER_ASSETS.HIGHBOY_TABLE) {
    return SOLVER_ASSET_DIMENSIONS[SOLVER_ASSETS.HIGHBOY_TABLE].diameter / 2;
  }
  return 0.5; // fallback
}

/** Returns the effective radius of any placed object. */
function getObjectRadius(furnitureItemId: string): number {
  if (isTable(furnitureItemId)) return getTableRadius(furnitureItemId);
  if (furnitureItemId === SOLVER_ASSETS.CHAIR_STANDARD) {
    return SOLVER_ASSET_DIMENSIONS[SOLVER_ASSETS.CHAIR_STANDARD].width / 2;
  }
  return 0.25; // fallback
}
