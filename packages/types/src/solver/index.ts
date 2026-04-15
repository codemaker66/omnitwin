import type { LayoutStyle } from "../configuration.js";
import type { SolverInput, SolverOutput, SolverConfig } from "./types.js";
import { DEFAULT_SOLVER_CONFIG, SolverInputSchema } from "./types.js";
import { solveDinnerRounds } from "./layouts.js";
import { solveTheatre } from "./layouts.js";
import { solveBoardroom } from "./layouts.js";
import { solveCabaret } from "./layouts.js";
import { solveCocktail } from "./layouts.js";
import { solveCeremony } from "./layouts.js";
import { solveDinnerBanquet } from "./layouts.js";

// ---------------------------------------------------------------------------
// Auto-Layout Solver — main entry point
//
// @aspirational This solver is a computational model tested in isolation.
// It is NOT yet consumed by @omnitwin/web or @omnitwin/api at runtime.
// It uses its own asset ID namespace (SOLVER_ASSETS) and Vec3 transforms
// that would need translation before persisting to placed_objects.
// When the auto-layout feature ships, wire this into the editor.
// ---------------------------------------------------------------------------

/** Layout strategy dispatch table. "custom" is not auto-solvable. */
const STRATEGY_MAP: Readonly<
  Record<Exclude<LayoutStyle, "custom">, (input: SolverInput, config: SolverConfig) => SolverOutput>
> = {
  "dinner-rounds": solveDinnerRounds,
  "theatre": solveTheatre,
  "boardroom": solveBoardroom,
  "cabaret": solveCabaret,
  "cocktail": solveCocktail,
  "ceremony": solveCeremony,
  "dinner-banquet": solveDinnerBanquet,
};

/**
 * Generates a furniture layout for the given room and event parameters.
 *
 * @param input  - Room polygon, dimensions, event type, guest count, fire exits.
 * @param config - Optional solver configuration (defaults to UK building regs).
 * @returns Solved layout with placed objects, capacity, and compliance report.
 * @throws {Error} If the event type is "custom" (not auto-solvable).
 * @throws {z.ZodError} If input fails schema validation.
 */
export function solveLayout(
  input: SolverInput,
  config: SolverConfig = DEFAULT_SOLVER_CONFIG,
): SolverOutput {
  // Validate input at runtime
  SolverInputSchema.parse(input);

  if (input.eventType === "custom") {
    throw new Error(
      'Layout style "custom" cannot be auto-solved. Use the manual editor.',
    );
  }

  const strategy = STRATEGY_MAP[input.eventType];
  return strategy(input, config);
}

// Re-export everything for convenient single-import
export {
  // Types & schemas
  SolverInputSchema,
  SolverOutputSchema,
  SolverConfigSchema,
  ComplianceReportSchema,
  FireExitSchema,
  DEFAULT_SOLVER_CONFIG,
  SOLVER_ASSETS,
  SOLVER_ASSET_DIMENSIONS,
  type SolverInput,
  type SolverOutput,
  type SolverConfig,
  type ComplianceReport,
  type FireExit,
} from "./types.js";

export {
  // Geometry
  pointInPolygon,
  distanceToEdge,
  distanceToPoint,
  circleInPolygon,
  rectInPolygon,
  lineIntersectsRect,
  generateGridPoints,
} from "./geometry.js";

export {
  // Compliance
  checkAisleWidths,
  checkFireExitClearance,
  checkMaxTravelDistance,
  generateComplianceReport,
} from "./compliance.js";

export {
  // Layout strategies
  solveDinnerRounds,
  solveTheatre,
  solveBoardroom,
  solveCabaret,
  solveCocktail,
  solveCeremony,
  solveDinnerBanquet,
} from "./layouts.js";
