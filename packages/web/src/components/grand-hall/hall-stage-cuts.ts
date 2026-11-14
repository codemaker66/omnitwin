// ---------------------------------------------------------------------------
// What the drawn hall changes when it is shown as a stage (hall-stage.ts)
//
// Two heights, kept apart from the stage's own measurements: the hall's model
// reads these in every planner, while the measurements are fetched only by a
// screen that holds the stage (components/planner-hud/hud-scene.ts).
// ---------------------------------------------------------------------------

/**
 * Walls the camera stands behind are lowered to this on the stage: under the
 * floor, so nothing of the fourth wall, its doors or its section is left
 * standing along the picture's foot.
 */
export const STAGE_NEAR_CUT_M = -1;

/** The chandeliers show in the overview below this camera height on the stage: above every stage camera (the highest stands near 11.1 m). */
export const STAGE_CHANDELIER_CEILING_M = 12.5;
