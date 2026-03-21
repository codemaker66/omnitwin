import { describe, it, expect } from "vitest";
import {
  checkAisleWidths,
  checkFireExitClearance,
  checkMaxTravelDistance,
  generateComplianceReport,
} from "../compliance.js";
import { DEFAULT_SOLVER_CONFIG, SOLVER_ASSETS } from "../types.js";
import type { PlacedObject } from "../../configuration.js";
import type { FloorPlanPoint } from "../../space.js";
import type { FireExit, SolverConfig } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testIdCounter = 0;
function testUUID(): string {
  testIdCounter++;
  return `00000000-0000-4000-8000-${String(testIdCounter).padStart(12, "0")}`;
}

function makeTable(x: number, z: number, type: string = SOLVER_ASSETS.ROUND_TABLE_5FT): PlacedObject {
  return {
    id: testUUID(),
    furnitureItemId: type,
    position: { x, y: 0, z },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

function makeChair(x: number, z: number): PlacedObject {
  return {
    id: testUUID(),
    furnitureItemId: SOLVER_ASSETS.CHAIR_STANDARD,
    position: { x, y: 0, z },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

function makeExit(x: number, y: number): FireExit {
  return { position: { x, y }, widthMm: 900 };
}

const SQUARE_ROOM: readonly FloorPlanPoint[] = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 20 },
  { x: 0, y: 20 },
];

const config: SolverConfig = DEFAULT_SOLVER_CONFIG;

// ---------------------------------------------------------------------------
// checkAisleWidths
// ---------------------------------------------------------------------------

describe("checkAisleWidths", () => {
  it("returns valid for well-spaced tables", () => {
    const tables = [makeTable(0, 0), makeTable(10, 0)];
    const result = checkAisleWidths(tables, config);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("returns valid for empty layout", () => {
    const result = checkAisleWidths([], config);
    expect(result.valid).toBe(true);
  });

  it("returns violation for tables too close", () => {
    // Two round tables at 2m apart center-to-center, diameter ~1.524m
    // Gap = 2 - 0.762 - 0.762 = 0.476m, well below 1.2m minimum
    const tables = [makeTable(0, 0), makeTable(2, 0)];
    const result = checkAisleWidths(tables, config);
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations[0]).toContain("Aisle width");
    expect(result.violations[0]).toContain("Approved Document B");
  });

  it("ignores pairs that are far apart (>5m center-to-center)", () => {
    const tables = [makeTable(0, 0), makeTable(6, 0)];
    const result = checkAisleWidths(tables, config);
    expect(result.valid).toBe(true);
  });

  it("skips non-table objects", () => {
    const objects = [makeChair(0, 0), makeChair(0.5, 0)];
    const result = checkAisleWidths(objects, config);
    expect(result.valid).toBe(true);
  });

  it("handles rectangular tables", () => {
    const tables = [
      makeTable(0, 0, SOLVER_ASSETS.RECTANGULAR_TABLE_6FT),
      makeTable(3, 0, SOLVER_ASSETS.RECTANGULAR_TABLE_6FT),
    ];
    const result = checkAisleWidths(tables, config);
    expect(result.valid).toBe(false);
  });

  it("handles highboy tables", () => {
    // Two highboy tables very close
    const tables = [
      makeTable(0, 0, SOLVER_ASSETS.HIGHBOY_TABLE),
      makeTable(1, 0, SOLVER_ASSETS.HIGHBOY_TABLE),
    ];
    const result = checkAisleWidths(tables, config);
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkFireExitClearance
// ---------------------------------------------------------------------------

describe("checkFireExitClearance", () => {
  it("returns valid when no objects near exits", () => {
    const exits = [makeExit(0, 10)];
    const objects = [makeTable(10, 10)];
    const result = checkFireExitClearance(objects, exits, config);
    expect(result.valid).toBe(true);
  });

  it("returns valid with no fire exits", () => {
    const result = checkFireExitClearance([makeTable(5, 5)], [], config);
    expect(result.valid).toBe(true);
  });

  it("returns violation when object blocks exit", () => {
    // Table right at the exit position
    const exits = [makeExit(5, 5)];
    const objects = [makeTable(5, 5)];
    const result = checkFireExitClearance(objects, exits, config);
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations[0]).toContain("fire exit");
  });

  it("returns violation when chair is too close to exit", () => {
    const exits = [makeExit(5, 5)];
    const objects = [makeChair(5.5, 5)];
    const result = checkFireExitClearance(objects, exits, config);
    expect(result.valid).toBe(false);
  });

  it("returns valid when object is just outside clearance zone", () => {
    const exits = [makeExit(0, 0)];
    // Object far enough away from exit
    const objects = [makeTable(5, 5)];
    const result = checkFireExitClearance(objects, exits, config);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkMaxTravelDistance
// ---------------------------------------------------------------------------

describe("checkMaxTravelDistance", () => {
  it("returns valid when chairs are close to an exit", () => {
    const exits = [makeExit(5, 5)];
    const chairs = [makeChair(6, 5), makeChair(7, 5)];
    const result = checkMaxTravelDistance(chairs, exits, SQUARE_ROOM);
    expect(result.valid).toBe(true);
  });

  it("returns valid with no fire exits (vacuously true)", () => {
    const chairs = [makeChair(100, 100)];
    const result = checkMaxTravelDistance(chairs, [], SQUARE_ROOM);
    expect(result.valid).toBe(true);
  });

  it("returns valid with no chairs", () => {
    const exits = [makeExit(5, 5)];
    const result = checkMaxTravelDistance([], exits, SQUARE_ROOM);
    expect(result.valid).toBe(true);
  });

  it("returns violation when chair exceeds 18m from all exits", () => {
    const exits = [makeExit(0, 0)];
    // Chair at 20m away — distance = sqrt(20² + 0²) > 18
    const chairs = [makeChair(20, 0)];
    const result = checkMaxTravelDistance(chairs, exits, SQUARE_ROOM);
    expect(result.valid).toBe(false);
    expect(result.violations[0]).toContain("BS 9999");
    expect(result.violations[0]).toContain("18m");
  });

  it("considers closest exit, not all exits", () => {
    // Exit at (0,0) and (19,0). Chair at (18,0) → 1m from second exit
    const exits = [makeExit(0, 0), makeExit(19, 0)];
    const chairs = [makeChair(18, 0)];
    const result = checkMaxTravelDistance(chairs, exits, SQUARE_ROOM);
    expect(result.valid).toBe(true);
  });

  it("ignores non-chair objects", () => {
    const exits = [makeExit(0, 0)];
    const objects = [makeTable(30, 30)]; // far away but it's a table
    const result = checkMaxTravelDistance(objects, exits, SQUARE_ROOM);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generateComplianceReport
// ---------------------------------------------------------------------------

describe("generateComplianceReport", () => {
  it("returns all-valid report for empty layout", () => {
    const report = generateComplianceReport([], [], SQUARE_ROOM, config);
    expect(report.aisleWidthsValid).toBe(true);
    expect(report.fireExitClearance).toBe(true);
    expect(report.maxTravelDistance).toBe(true);
    expect(report.violations).toHaveLength(0);
  });

  it("aggregates violations from all checks", () => {
    // Two tables too close + table blocking exit
    const exits = [makeExit(2, 0)];
    const objects = [makeTable(2, 0), makeTable(3, 0)];
    const report = generateComplianceReport(objects, exits, SQUARE_ROOM, config);
    expect(report.violations.length).toBeGreaterThanOrEqual(2);
  });

  it("returns correct flags for a compliant layout", () => {
    const exits = [makeExit(0, 10)];
    const objects = [makeTable(10, 10), makeChair(11, 10)];
    const report = generateComplianceReport(objects, exits, SQUARE_ROOM, config);
    expect(report.aisleWidthsValid).toBe(true);
    expect(report.fireExitClearance).toBe(true);
    expect(report.maxTravelDistance).toBe(true);
  });
});
