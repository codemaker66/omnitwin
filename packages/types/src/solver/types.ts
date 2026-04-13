import { z } from "zod";
import { FloorPlanPointSchema } from "../space.js";
import { SpaceDimensionsSchema } from "../space.js";
import { LayoutStyleSchema, Vec3Schema } from "../configuration.js";

// ---------------------------------------------------------------------------
// Solver Types — input, output, and configuration for auto-layout
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Solver-internal placed object — uses Vec3 for position/rotation/scale.
// This is the solver's computational model, NOT the DB-persisted shape.
// To persist solver output, convert SolverPlacedObject → DB PlacedObject
// by flattening Vec3 to positionX/Y/Z etc.
// ---------------------------------------------------------------------------

export const SolverPlacedObjectSchema = z.object({
  id: z.string().uuid(),
  furnitureItemId: z.string().uuid(),
  position: Vec3Schema,
  rotation: Vec3Schema,
  scale: Vec3Schema,
});

export type SolverPlacedObject = z.infer<typeof SolverPlacedObjectSchema>;

// ---------------------------------------------------------------------------
// Solver asset IDs — well-known furniture identifiers for generated layouts
// ---------------------------------------------------------------------------

/** Well-known asset IDs used by the solver to create PlacedObjects. */
export const SOLVER_ASSETS = {
  ROUND_TABLE_5FT: "00000000-0000-4000-8000-000000000001",
  RECTANGULAR_TABLE_6FT: "00000000-0000-4000-8000-000000000002",
  CHAIR_STANDARD: "00000000-0000-4000-8000-000000000003",
  HIGHBOY_TABLE: "00000000-0000-4000-8000-000000000004",
} as const;

/** Real-world dimensions in metres for each solver asset. */
export const SOLVER_ASSET_DIMENSIONS = {
  [SOLVER_ASSETS.ROUND_TABLE_5FT]: { diameter: 1.524, height: 0.762 },
  [SOLVER_ASSETS.RECTANGULAR_TABLE_6FT]: { width: 1.829, depth: 0.762, height: 0.762 },
  [SOLVER_ASSETS.CHAIR_STANDARD]: { width: 0.45, depth: 0.45, height: 0.9 },
  [SOLVER_ASSETS.HIGHBOY_TABLE]: { diameter: 0.6, height: 1.1 },
} as const;

// ---------------------------------------------------------------------------
// Fire exit
// ---------------------------------------------------------------------------

export const FireExitSchema = z.object({
  position: FloorPlanPointSchema,
  widthMm: z.number().positive(),
});

export type FireExit = z.infer<typeof FireExitSchema>;

// ---------------------------------------------------------------------------
// Solver input
// ---------------------------------------------------------------------------

export const SolverInputSchema = z.object({
  roomPolygon: z.array(FloorPlanPointSchema).min(3),
  roomDimensions: SpaceDimensionsSchema,
  eventType: LayoutStyleSchema,
  guestCount: z.number().int().nonnegative(),
  fireExits: z.array(FireExitSchema),
  fixedObjects: z.array(SolverPlacedObjectSchema).optional(),
});

export type SolverInput = z.infer<typeof SolverInputSchema>;

// ---------------------------------------------------------------------------
// Compliance report
// ---------------------------------------------------------------------------

export const ComplianceReportSchema = z.object({
  aisleWidthsValid: z.boolean(),
  fireExitClearance: z.boolean(),
  maxTravelDistance: z.boolean(),
  violations: z.array(z.string()),
});

export type ComplianceReport = z.infer<typeof ComplianceReportSchema>;

// ---------------------------------------------------------------------------
// Solver output
// ---------------------------------------------------------------------------

export const SolverOutputSchema = z.object({
  placedObjects: z.array(SolverPlacedObjectSchema),
  actualCapacity: z.number().int().nonnegative(),
  complianceReport: ComplianceReportSchema,
});

export type SolverOutput = z.infer<typeof SolverOutputSchema>;

// ---------------------------------------------------------------------------
// Solver configuration (all distances in metres)
// ---------------------------------------------------------------------------

export const SolverConfigSchema = z.object({
  minAisleWidthM: z.number().positive().default(1.2),
  fireExitClearanceM: z.number().positive().default(1.05),
  minTableSpacingM: z.number().positive().default(0.8),
  chairSpacingDeg: z.number().positive().default(45),
});

export type SolverConfig = z.infer<typeof SolverConfigSchema>;

export const DEFAULT_SOLVER_CONFIG: SolverConfig = {
  minAisleWidthM: 1.2,
  fireExitClearanceM: 1.05,
  minTableSpacingM: 0.8,
  chairSpacingDeg: 45,
};
