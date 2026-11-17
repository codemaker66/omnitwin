import type { SpringConfig } from "../../lib/springs.js";

// ---------------------------------------------------------------------------
// The new chrome's sheet settle (T-671, spec section 8). It moves on the shared
// spring core (lib/springs.ts); its tuning lives here rather than in
// SPRING_PRESETS because only the new chrome's catalogue sheet uses it, and a
// preset there is kept in today's planner's download (as lens-sheet-motion.ts
// does for the phone lens sheet).
// ---------------------------------------------------------------------------

/** A phone sheet let go of: firm, ζ ≈ 0.87, settles in 0.35 s with a 0.18 %
 *  overshoot, so it lands rather than stops. */
export const SHEET_SETTLE: SpringConfig = { stiffness: 300, damping: 30 };
