import { type ReactElement } from "react";
import { EditorBridge } from "../editor/EditorBridge.js";
import { useLayoutLiveRoom } from "../editor/LayoutLiveLayer.js";
import { RoomStage } from "../planner-chrome/RoomStage.js";
import { Slate } from "../planner-chrome/Slate.js";
import { useSlateAudience } from "../planner-chrome/slate-data.js";
import { TooltipHost } from "../planner-chrome/Tooltip.js";
import "../planner-chrome/chrome.css";
import { HudFrame } from "./HudFrame.js";
import { HudSheets } from "./HudSheets.js";

// ---------------------------------------------------------------------------
// The planner in the HUD (docs/superpowers/specs/2026-11-13-planner-hud-design.md;
// its look, docs/superpowers/specs/2026-11-13-planner-hud-design.md), loaded only behind
// `?chrome=hud` until it becomes the default.
//
// The layout keeps syncing, saving and its live room exactly as before. The
// plaque is the slate the second chrome already built, whole: the event's name
// and its menu of rooms and layouts, the save state and every notice a save
// can need (a conflict, a dropped connection, sign-in). It lies flat in the
// top bar, restyled from outside (hud-plaque.css) through the house tokens the
// HUD's ground re-points. A table in front of a door is said once, on the
// shelf's status line, and moved clear by the one primary key.
// ---------------------------------------------------------------------------

export function PlannerHud(): ReactElement {
  useLayoutLiveRoom();
  const { event } = useSlateAudience();
  return (
    <>
      <EditorBridge />
      <a className="vv-skip-link" href="#main-content">Skip to the room</a>
      <HudFrame
        room={<RoomStage />}
        plaque={(
          <div className="pc-root hud-plaque">
            <Slate />
            <TooltipHost />
          </div>
        )}
        eventGuests={event?.guestCount ?? null}
        sheets={<HudSheets />}
      />
    </>
  );
}
