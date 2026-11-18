// ---------------------------------------------------------------------------
// The planner HUD's parts of the room's scene
//
// The room's scene is every planner's, and what it imports every planner
// downloads. These two belong to the HUD alone: the stage's hold on the camera
// (with its measurements and its lens) and the line on the floor round what is
// chosen. The scene fetches this one module, and only where a screen has asked
// for the stage or the mark (components/editor/PlannerScene.tsx), so the
// planner without the HUD downloads none of it.
// ---------------------------------------------------------------------------

export { ChosenMarks } from "../editor/ChosenMarks.js";
export { HallStage } from "../grand-hall/HallStage.js";
