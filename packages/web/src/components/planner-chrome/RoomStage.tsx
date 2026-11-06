import { type ReactElement } from "react";
import { PlannerScene } from "../editor/PlannerScene.js";
import { MarkupPersistence } from "../MarkupPersistence.js";
import { Caption } from "./Caption.js";
import { usePlannerRoomDimensions } from "../../hooks/use-planner-room-dimensions.js";
import "../../App.css";
import "./shell.css";

// ---------------------------------------------------------------------------
// RoomStage — the room, full bleed, under the new chrome (T-671 slice 6).
//
// The planner's own scene with nothing of today's chrome round it: the room
// is the exhibit (spec 1.1, law 1). It keeps the room's size in step with the
// loaded space and the drawn strokes saved with the layout, as the editor
// does; everything a person touches arrives in the zones above it.
// ---------------------------------------------------------------------------

export function RoomStage(): ReactElement {
  usePlannerRoomDimensions();
  return (
    <div className="pc-room-stage venviewer-planner-shell" data-testid="planner-room-stage">
      <PlannerScene />
      <Caption />
      <MarkupPersistence />
    </div>
  );
}
