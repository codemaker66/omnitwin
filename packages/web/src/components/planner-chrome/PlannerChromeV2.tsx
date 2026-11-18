import { type ReactElement } from "react";
import { EditorBridge } from "../editor/EditorBridge.js";
import { useLayoutLiveRoom } from "../editor/LayoutLiveLayer.js";
import { DoorClearNotice } from "../editor/DoorClearNotice.js";
import { ChromePresence } from "../editor/cockpit/ChromeFold.js";
import { usePlannerChromeStore } from "../../stores/planner-chrome-store.js";
import { ChromeShell } from "./ChromeShell.js";
import { DockStack } from "./DockStack.js";
import { Receipt } from "./Receipt.js";
import { LayOutPanel } from "./LayOutPanel.js";
import { useNothingOutOfSight } from "./nothing-out-of-sight.js";
import { RoomStage } from "./RoomStage.js";
import { Slate } from "./Slate.js";

// ---------------------------------------------------------------------------
// The planner in the new chrome (T-671), loaded only behind `?chrome=v2`, so
// today's planner carries none of it until slice 21 makes it the default.
//
// The room, full bleed, under the zones the slices fill: so far the slate
// (slice 7), the dock (8′), the rail (12′), the receipt and the door rule's
// notice above the dock (spec §6.9; lane E, T-679). \, the crest or Esc
// clears them away and brings them back, as in today's planner (T-680). The
// layout keeps syncing, saving and its live room exactly as before; none of
// today's other surfaces mount.
// ---------------------------------------------------------------------------

export function PlannerChromeV2(): ReactElement {
  useLayoutLiveRoom();
  // A panel asked for while the tools are cleared brings them back with it (T-680).
  useNothingOutOfSight();
  const right = usePlannerChromeStore((state) => state.right);
  return (
    <>
      <EditorBridge />
      <a className="vv-skip-link" href="#main-content">Skip to the room</a>
      {/* Above the dock: what just happened (5 s, with Undo), and a table in front of a door, said calmly
          apart from the slate's notice. The door's line is the lower and stays put; a receipt comes and goes above it. */}
      <ChromeShell
        room={<RoomStage />}
        slate={<Slate />}
        aboveDock={
          <>
            <Receipt />
            <DoorClearNotice zoned />
          </>
        }
        dock={<DockStack />}
        right={right === "lay-out" ? <LayOutPanel /> : null}
      />
      {/* \, the crest and Esc clear the tools away and bring them back (T-680; fold.css). Last, so its effects run after the shell's. */}
      <ChromePresence />
    </>
  );
}
