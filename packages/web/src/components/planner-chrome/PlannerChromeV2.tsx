import { type ReactElement } from "react";
import { EditorBridge } from "../editor/EditorBridge.js";
import { useLayoutLiveRoom } from "../editor/LayoutLiveLayer.js";
import { DoorClearNotice } from "../editor/DoorClearNotice.js";
import { PlacementNotice } from "../editor/PlacementNotice.js";
import { ChromeShell } from "./ChromeShell.js";
import { RoomStage } from "./RoomStage.js";
import { Slate } from "./Slate.js";
import { Notice } from "./Surfaces.js";

// ---------------------------------------------------------------------------
// The planner in the new chrome (T-671), loaded only behind `?chrome=v2`, so
// today's planner carries none of it until slice 21 makes it the default.
//
// The room, full bleed, under the zones the slices fill: so far the slate
// (slice 7), the door rule's notice above the dock (lane E, T-679), and under
// it the line about the change just tried ("Nothing was undone: ...", ruling
// C2 on #388). The layout keeps syncing, saving and its live room exactly as
// before; none of today's other surfaces mount, nor the 2D view, so that line
// is said here and nowhere else.
// ---------------------------------------------------------------------------

/** The placement line, in this chrome's own notice. */
function placementLine(text: string): ReactElement {
  return <Notice lead={text} urgency="status" />;
}

export function PlannerChromeV2(): ReactElement {
  useLayoutLiveRoom();
  return (
    <>
      <EditorBridge />
      <a className="vv-skip-link" href="#main-content">Skip to the room</a>
      {/* A table in front of a door, said calmly in the line above the dock, apart from the slate's notice; the placement line under it. */}
      <ChromeShell
        room={<RoomStage />}
        slate={<Slate />}
        aboveDock={(
          <>
            <DoorClearNotice zoned />
            <PlacementNotice zoned line={placementLine} />
          </>
        )}
      />
    </>
  );
}
