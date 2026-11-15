import type { SpringConfig } from "../springs.js";

// ---------------------------------------------------------------------------
// The one spring this screen's shelf moves by
//
// The numbers are the shared table's (lib/springs.ts, SPRING_PRESETS.dialGlide:
// critically damped, settles in 0.59 s, never overshoots), and the spring they
// set is the shared one (lib/use-spring-value.ts over lib/springs.ts): this is
// a setting handed to it, never a second spring. It is written again here, not
// read from the table, for as long as this screen is behind its flag: nothing
// else in production uses that entry yet, so the bundler leaves it out of the
// table, and reading it from here put it back, in a shared file nine of the
// build's other files import (14 Nov 2026). Flag-only code may not grow what
// every planner downloads (the design note, "Behind its flag, and nothing
// more"). __tests__/flag-only-copies.test.ts holds these to the table's own
// numbers. When this screen is the planner, read the table again.
// The stage's own spring is beside its measurements (grand-hall/hall-stage.ts).
// ---------------------------------------------------------------------------

/** The seat line filling as guests are seated. */
export const SEAT_LINE_SPRING: SpringConfig = { stiffness: 170, damping: 26 };
