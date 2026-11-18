import { type ReactElement } from "react";
import { PlannerScene } from "../editor/PlannerScene.js";
import { MarkupPersistence } from "../MarkupPersistence.js";
import { usePlannerRoomDimensions } from "../../hooks/use-planner-room-dimensions.js";

// ---------------------------------------------------------------------------
// The room under the HUD: the planner's own scene, full bleed.
//
// It keeps the room's size in step with the loaded space and the drawn strokes
// saved with the layout, as the editor does. The other new chrome frames the
// same scene in a component of its own (planner-chrome/RoomStage.tsx), and
// since #357 that frame carries that chrome's caption over a chosen piece.
// This screen says a chosen piece's verbs once, on the shelf, and marks the
// piece on the floor (the design note, "Each fact is said once"), so it
// frames the scene itself: the scene, and nothing over it.
// ---------------------------------------------------------------------------

export function HudRoom(): ReactElement {
  usePlannerRoomDimensions();
  return (
    <div className="hud-room-stage venviewer-planner-shell" data-testid="planner-hud-room">
      <PlannerScene />
      <MarkupPersistence />
    </div>
  );
}
