import { type ReactElement } from "react";
import { EditorBridge } from "../editor/EditorBridge.js";
import { useLayoutLiveRoom } from "../editor/LayoutLiveLayer.js";
import { DoorClearNotice } from "../editor/DoorClearNotice.js";
import { ChromeShell } from "./ChromeShell.js";
import { RoomStage } from "./RoomStage.js";
import { Slate } from "./Slate.js";

// ---------------------------------------------------------------------------
// The planner in the new chrome (T-671), loaded only behind `?chrome=v2`, so
// today's planner carries none of it until slice 21 makes it the default.
//
// The room, full bleed, under the zones the slices fill: so far the slate
// (slice 7), and the door rule's notice above the dock (lane E, T-679). The
// layout keeps syncing, saving and its live room exactly as before; none of
// today's other surfaces mount.
// ---------------------------------------------------------------------------

export function PlannerChromeV2(): ReactElement {
  useLayoutLiveRoom();
  return (
    <>
      <EditorBridge />
      <a className="vv-skip-link" href="#main-content">Skip to the room</a>
      {/* A table in front of a door, said calmly in the line above the dock, apart from the slate's notice. */}
      <ChromeShell room={<RoomStage />} slate={<Slate />} aboveDock={<DoorClearNotice zoned />} />
    </>
  );
}
