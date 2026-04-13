import { describe, it, expect } from "vitest";
import {
  solveDinnerRounds,
  solveTheatre,
  solveBoardroom,
  solveCabaret,
  solveCocktail,
  solveCeremony,
  solveDinnerBanquet,
} from "../layouts.js";
import { solveLayout } from "../index.js";
import { DEFAULT_SOLVER_CONFIG, SOLVER_ASSETS } from "../types.js";
import type { SolverInput, SolverConfig } from "../types.js";
import type { FloorPlanPoint } from "../../space.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** 21×20 room — wide enough for table layouts with aisles. */
const GRAND_HALL_POLYGON: readonly FloorPlanPoint[] = [
  { x: 0, y: 0 },
  { x: 21, y: 0 },
  { x: 21, y: 20 },
  { x: 0, y: 20 },
];

const config: SolverConfig = DEFAULT_SOLVER_CONFIG;

function makeInput(
  eventType: SolverInput["eventType"],
  guestCount: number,
  overrides?: Partial<SolverInput>,
): SolverInput {
  return {
    roomPolygon: [...GRAND_HALL_POLYGON],
    roomDimensions: { width: 21, length: 20, height: 7 },
    eventType,
    guestCount,
    fireExits: [
      { position: { x: 0, y: 5 }, widthMm: 900 },
      { position: { x: 21, y: 5 }, widthMm: 900 },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Shared assertions
// ---------------------------------------------------------------------------

function expectValidOutput(output: ReturnType<typeof solveDinnerRounds>): void {
  expect(output.placedObjects).toBeDefined();
  expect(Array.isArray(output.placedObjects)).toBe(true);
  expect(output.actualCapacity).toBeGreaterThanOrEqual(0);
  expect(output.complianceReport).toBeDefined();
}

function expectAllObjectsHaveUUIDs(output: ReturnType<typeof solveDinnerRounds>): void {
  for (const obj of output.placedObjects) {
    expect(obj.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  }
}

function expectObjectsInsidePolygon(
  output: ReturnType<typeof solveDinnerRounds>,
  polygon: readonly FloorPlanPoint[],
): void {
  // Check that table/chair positions are within the bounding box at minimum
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  // Allow small tolerance for chair placement at edges
  const margin = 1;
  for (const obj of output.placedObjects) {
    expect(obj.position.x).toBeGreaterThanOrEqual(minX - margin);
    expect(obj.position.x).toBeLessThanOrEqual(maxX + margin);
    expect(obj.position.z).toBeGreaterThanOrEqual(minY - margin);
    expect(obj.position.z).toBeLessThanOrEqual(maxY + margin);
  }
}

// ---------------------------------------------------------------------------
// solveDinnerRounds
// ---------------------------------------------------------------------------

describe("solveDinnerRounds", () => {
  it("returns empty for 0 guests", () => {
    const result = solveDinnerRounds(makeInput("dinner-rounds", 0), config);
    expect(result.placedObjects).toHaveLength(0);
    expect(result.actualCapacity).toBe(0);
  });

  it("produces tables and chairs for 20 guests", () => {
    const result = solveDinnerRounds(makeInput("dinner-rounds", 20), config);
    expectValidOutput(result);
    expect(result.actualCapacity).toBeGreaterThan(0);
    const tables = result.placedObjects.filter((o) => o.furnitureItemId === SOLVER_ASSETS.ROUND_TABLE_5FT);
    const chairs = result.placedObjects.filter((o) => o.furnitureItemId === SOLVER_ASSETS.CHAIR_STANDARD);
    expect(tables.length).toBeGreaterThan(0);
    expect(chairs.length).toBeGreaterThan(0);
  });

  it("generates valid UUIDs for all objects", () => {
    const result = solveDinnerRounds(makeInput("dinner-rounds", 16), config);
    expectAllObjectsHaveUUIDs(result);
  });

  it("places objects inside the room polygon", () => {
    const result = solveDinnerRounds(makeInput("dinner-rounds", 16), config);
    expectObjectsInsidePolygon(result, GRAND_HALL_POLYGON);
  });

  it("respects guest count limit", () => {
    const result = solveDinnerRounds(makeInput("dinner-rounds", 8), config);
    // Should not massively exceed requested count
    expect(result.actualCapacity).toBeLessThanOrEqual(16);
  });

  it("generates compliance report", () => {
    const result = solveDinnerRounds(makeInput("dinner-rounds", 16), config);
    expect(result.complianceReport.aisleWidthsValid).toBeDefined();
    expect(result.complianceReport.fireExitClearance).toBeDefined();
    expect(result.complianceReport.maxTravelDistance).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// solveTheatre
// ---------------------------------------------------------------------------

describe("solveTheatre", () => {
  it("returns empty for 0 guests", () => {
    const result = solveTheatre(makeInput("theatre", 0), config);
    expect(result.placedObjects).toHaveLength(0);
    expect(result.actualCapacity).toBe(0);
  });

  it("produces chairs only (no tables) for theatre layout", () => {
    const result = solveTheatre(makeInput("theatre", 30), config);
    expectValidOutput(result);
    const tables = result.placedObjects.filter(
      (o) => o.furnitureItemId === SOLVER_ASSETS.ROUND_TABLE_5FT ||
             o.furnitureItemId === SOLVER_ASSETS.RECTANGULAR_TABLE_6FT,
    );
    expect(tables).toHaveLength(0);
    expect(result.actualCapacity).toBeGreaterThan(0);
  });

  it("places chairs inside the room", () => {
    const result = solveTheatre(makeInput("theatre", 30), config);
    expectObjectsInsidePolygon(result, GRAND_HALL_POLYGON);
  });

  it("returns empty for impossibly narrow room", () => {
    const narrow: FloorPlanPoint[] = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 0.5, y: 10 },
      { x: 0, y: 10 },
    ];
    const input = makeInput("theatre", 10, {
      roomPolygon: narrow,
      roomDimensions: { width: 0.5, length: 10, height: 3 },
    });
    const result = solveTheatre(input, config);
    expect(result.actualCapacity).toBe(0);
  });

  it("generates unique UUIDs", () => {
    const result = solveTheatre(makeInput("theatre", 30), config);
    const ids = result.placedObjects.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// solveBoardroom
// ---------------------------------------------------------------------------

describe("solveBoardroom", () => {
  it("returns empty for 0 guests", () => {
    const result = solveBoardroom(makeInput("boardroom", 0), config);
    expect(result.placedObjects).toHaveLength(0);
  });

  it("uses single table for ≤20 guests", () => {
    const result = solveBoardroom(makeInput("boardroom", 12), config);
    expectValidOutput(result);
    const tables = result.placedObjects.filter(
      (o) => o.furnitureItemId === SOLVER_ASSETS.RECTANGULAR_TABLE_6FT,
    );
    expect(tables).toHaveLength(1);
  });

  it("uses U-shape for >20 guests", () => {
    const result = solveBoardroom(makeInput("boardroom", 25), config);
    expectValidOutput(result);
    const tables = result.placedObjects.filter(
      (o) => o.furnitureItemId === SOLVER_ASSETS.RECTANGULAR_TABLE_6FT,
    );
    // U-shape: head + 2 wings = 3 tables
    expect(tables.length).toBe(3);
  });

  it("produces seated capacity", () => {
    const result = solveBoardroom(makeInput("boardroom", 10), config);
    expect(result.actualCapacity).toBeGreaterThan(0);
  });

  it("places objects inside room", () => {
    const result = solveBoardroom(makeInput("boardroom", 10), config);
    expectObjectsInsidePolygon(result, GRAND_HALL_POLYGON);
  });
});

// ---------------------------------------------------------------------------
// solveCabaret
// ---------------------------------------------------------------------------

describe("solveCabaret", () => {
  it("returns empty for 0 guests", () => {
    const result = solveCabaret(makeInput("cabaret", 0), config);
    expect(result.placedObjects).toHaveLength(0);
  });

  it("produces round tables with chairs", () => {
    const result = solveCabaret(makeInput("cabaret", 20), config);
    expectValidOutput(result);
    const tables = result.placedObjects.filter((o) => o.furnitureItemId === SOLVER_ASSETS.ROUND_TABLE_5FT);
    const chairs = result.placedObjects.filter((o) => o.furnitureItemId === SOLVER_ASSETS.CHAIR_STANDARD);
    expect(tables.length).toBeGreaterThan(0);
    expect(chairs.length).toBeGreaterThan(0);
  });

  it("places fewer chairs per table than dinner rounds (5 vs 8)", () => {
    const cabaretResult = solveCabaret(makeInput("cabaret", 16), config);
    const cabaretTables = cabaretResult.placedObjects.filter((o) => o.furnitureItemId === SOLVER_ASSETS.ROUND_TABLE_5FT);
    const cabaretChairs = cabaretResult.placedObjects.filter((o) => o.furnitureItemId === SOLVER_ASSETS.CHAIR_STANDARD);

    if (cabaretTables.length > 0) {
      const ratio = cabaretChairs.length / cabaretTables.length;
      expect(ratio).toBeLessThanOrEqual(5.5); // ~5 chairs per table
    }
  });

  it("places objects inside room", () => {
    const result = solveCabaret(makeInput("cabaret", 20), config);
    expectObjectsInsidePolygon(result, GRAND_HALL_POLYGON);
  });
});

// ---------------------------------------------------------------------------
// solveCocktail
// ---------------------------------------------------------------------------

describe("solveCocktail", () => {
  it("returns empty for 0 guests", () => {
    const result = solveCocktail(makeInput("cocktail", 0), config);
    expect(result.placedObjects).toHaveLength(0);
  });

  it("produces only highboy tables (no chairs)", () => {
    const result = solveCocktail(makeInput("cocktail", 30), config);
    expectValidOutput(result);
    const highboys = result.placedObjects.filter((o) => o.furnitureItemId === SOLVER_ASSETS.HIGHBOY_TABLE);
    const chairs = result.placedObjects.filter((o) => o.furnitureItemId === SOLVER_ASSETS.CHAIR_STANDARD);
    expect(highboys.length).toBeGreaterThan(0);
    expect(chairs).toHaveLength(0);
  });

  it("reports standing capacity", () => {
    const result = solveCocktail(makeInput("cocktail", 30), config);
    expect(result.actualCapacity).toBeGreaterThan(0);
  });

  it("places tables inside room", () => {
    const result = solveCocktail(makeInput("cocktail", 30), config);
    expectObjectsInsidePolygon(result, GRAND_HALL_POLYGON);
  });
});

// ---------------------------------------------------------------------------
// solveCeremony
// ---------------------------------------------------------------------------

describe("solveCeremony", () => {
  it("returns empty for 0 guests", () => {
    const result = solveCeremony(makeInput("ceremony", 0), config);
    expect(result.placedObjects).toHaveLength(0);
  });

  it("produces chairs only", () => {
    const result = solveCeremony(makeInput("ceremony", 40), config);
    expectValidOutput(result);
    const tables = result.placedObjects.filter(
      (o) => o.furnitureItemId !== SOLVER_ASSETS.CHAIR_STANDARD,
    );
    expect(tables).toHaveLength(0);
    expect(result.actualCapacity).toBeGreaterThan(0);
  });

  it("places chairs in the room", () => {
    const result = solveCeremony(makeInput("ceremony", 40), config);
    expectObjectsInsidePolygon(result, GRAND_HALL_POLYGON);
  });

  it("returns empty for impossibly narrow room", () => {
    const narrow: FloorPlanPoint[] = [
      { x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 10 }, { x: 0, y: 10 },
    ];
    const input = makeInput("ceremony", 10, {
      roomPolygon: narrow,
      roomDimensions: { width: 0.5, length: 10, height: 3 },
    });
    const result = solveCeremony(input, config);
    expect(result.actualCapacity).toBe(0);
  });

  it("generates unique IDs", () => {
    const result = solveCeremony(makeInput("ceremony", 40), config);
    const ids = result.placedObjects.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// solveDinnerBanquet
// ---------------------------------------------------------------------------

describe("solveDinnerBanquet", () => {
  it("returns empty for 0 guests", () => {
    const result = solveDinnerBanquet(makeInput("dinner-banquet", 0), config);
    expect(result.placedObjects).toHaveLength(0);
  });

  it("produces rectangular tables and chairs", () => {
    const result = solveDinnerBanquet(makeInput("dinner-banquet", 30), config);
    expectValidOutput(result);
    const tables = result.placedObjects.filter((o) => o.furnitureItemId === SOLVER_ASSETS.RECTANGULAR_TABLE_6FT);
    const chairs = result.placedObjects.filter((o) => o.furnitureItemId === SOLVER_ASSETS.CHAIR_STANDARD);
    expect(tables.length).toBeGreaterThan(0);
    expect(chairs.length).toBeGreaterThan(0);
  });

  it("includes a head table", () => {
    const result = solveDinnerBanquet(makeInput("dinner-banquet", 20), config);
    // First table placed should be the head table (rotated π/2)
    const tables = result.placedObjects.filter((o) => o.furnitureItemId === SOLVER_ASSETS.RECTANGULAR_TABLE_6FT);
    expect(tables.length).toBeGreaterThanOrEqual(1);
    const headTable = tables[0];
    expect(headTable).toBeDefined();
    if (headTable) {
      expect(headTable.rotation.y).toBeCloseTo(Math.PI / 2, 5);
    }
  });

  it("places objects inside room", () => {
    const result = solveDinnerBanquet(makeInput("dinner-banquet", 30), config);
    expectObjectsInsidePolygon(result, GRAND_HALL_POLYGON);
  });

  it("generates valid UUIDs", () => {
    const result = solveDinnerBanquet(makeInput("dinner-banquet", 20), config);
    expectAllObjectsHaveUUIDs(result);
  });
});

// ---------------------------------------------------------------------------
// solveLayout (entry point)
// ---------------------------------------------------------------------------

describe("solveLayout", () => {
  it("dispatches to correct strategy for each event type", () => {
    const types: Array<SolverInput["eventType"]> = [
      "dinner-rounds", "theatre", "boardroom", "cabaret",
      "cocktail", "ceremony", "dinner-banquet",
    ];
    for (const eventType of types) {
      const result = solveLayout(makeInput(eventType, 10));
      expectValidOutput(result);
    }
  });

  it("throws for custom layout style", () => {
    expect(() => solveLayout(makeInput("custom", 10))).toThrow("custom");
  });

  it("throws for invalid input (bad guest count)", () => {
    const input = makeInput("theatre", -5);
    expect(() => solveLayout(input)).toThrow();
  });

  it("throws for invalid input (too few polygon points)", () => {
    const input = makeInput("theatre", 10, {
      roomPolygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    });
    expect(() => solveLayout(input)).toThrow();
  });

  it("uses default config when none provided", () => {
    const result = solveLayout(makeInput("theatre", 20));
    expectValidOutput(result);
  });

  it("accepts custom config with correct field names", () => {
    // SolverConfig uses minTableSpacingM and chairSpacingDeg (not chairSpacingDegrees)
    const customConfig: SolverConfig = {
      minAisleWidthM: 1.5,
      fireExitClearanceM: 1.5,
      minTableSpacingM: 1.0,
      chairSpacingDeg: 60,
    };
    const result = solveLayout(makeInput("dinner-rounds", 16), customConfig);
    expectValidOutput(result);
  });
});
