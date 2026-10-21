import { type ReactElement } from "react";
import { EditorBridge } from "../editor/EditorBridge.js";
import { useLayoutLiveRoom } from "../editor/LayoutLiveLayer.js";
import { ChromeShell } from "./ChromeShell.js";
import { RoomStage } from "./RoomStage.js";

// ---------------------------------------------------------------------------
// The planner in the new chrome (T-671), loaded only behind `?chrome=v2`, so
// today's planner carries none of it until slice 21 makes it the default.
//
// The room, full bleed, under the zones the slices fill. The layout keeps
// syncing, saving and its live room exactly as before; none of today's
// surfaces mount.
// ---------------------------------------------------------------------------

export function PlannerChromeV2(): ReactElement {
  useLayoutLiveRoom();
  return (
    <>
      <EditorBridge />
      <a className="vv-skip-link" href="#main-content">Skip to the room</a>
      <ChromeShell room={<RoomStage />} />
    </>
  );
}
