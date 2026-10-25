import { type ReactElement } from "react";
import { PenLine, Plus, Redo2, Ruler, Undo2 } from "lucide-react";
import { canRedo, canUndo, redoLabel, undoLabel } from "../../lib/editor-history.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { useHallViewStore } from "../../stores/hall-view-store.js";
import { usePlannerChromeStore } from "../../stores/planner-chrome-store.js";
import { useToolStore } from "../../stores/tool-store.js";
import { useModelledGrandHall } from "../grand-hall/hall-space.js";
import { chooseView, toggleLayOut, useDockKeys } from "./dock-keys.js";
import { LayOutGlyph } from "./glyphs.js";
import { Key, KeyRow, KeySeparator } from "./Keys.js";
import "./chrome.css";
import "./dock.css";

// ---------------------------------------------------------------------------
// The dock (T-671 slice 8′; spec 4.1, 6.3; card-dock spec §2, §12).
//
// One lacquer bar bottom centre, the same keys in the same places in every
// state: Plan · Room · Walk | Add · Lay out · Measure · Draw | Undo · Redo.
// A key that cannot act stays where it is, dimmed, and says why. The views
// move on Shift 1 2 3 (plain digits are the cards'), and only where the room
// has set views; Undo and Redo are named for what they would do. The hour
// chip (slice 10), the staff workspace menu (slice 18) and the rail with its
// meter on the top edge (slice 12′) join this bar later.
// ---------------------------------------------------------------------------

/** The dock's words, in order: no two share a stem (spec 4.1, "Lay out" never beside "Layout"). */
export const DOCK_LABELS = ["Plan", "Room", "Walk", "Add", "Lay out", "Measure", "Draw", "Undo", "Redo"] as const;

const NO_SET_VIEWS = "Only the Grand Hall has set views so far";
const ADD_WAITS = "Opens with the furniture cards";
const LEAVE_WALK = "Leave Walk first";

export function Dock(): ReactElement {
  const viewsReady = useModelledGrandHall();
  useDockKeys(viewsReady);
  const walking = useCockpitStore((state) => state.walkMode);
  const preset = useHallViewStore((state) => state.activePreset);
  const tool = useToolStore((state) => state.activeTool);
  const layingOut = usePlannerChromeStore((state) => state.right === "lay-out");
  const history = useEditorStore((state) => state.history);
  const view = walking ? "walk" : preset === "walk" ? null : preset;
  const undoName = undoLabel(history);
  const redoName = redoLabel(history);

  const setTool = (next: "measure" | "draw"): void => {
    const tools = useToolStore.getState();
    tools.setTool(tools.activeTool === next ? "select" : next);
  };

  return (
    <div className="pc-lacquer pc-dock" role="toolbar" aria-label="The dock" data-testid="planner-dock">
      <KeyRow role="radiogroup" label="View" activeKey={viewsReady ? view : null}>
        {(["plan", "room", "walk"] as const).map((id, index) => (
          <Key
            key={id}
            rowKey={id}
            label={DOCK_LABELS[index] ?? id}
            radio
            on={viewsReady && view === id}
            shortcut={["Shift", String(index + 1)]}
            disabledReason={viewsReady ? undefined : NO_SET_VIEWS}
            onPress={() => { chooseView(id); }}
          />
        ))}
      </KeyRow>
      <KeySeparator />
      <div className="pc-dock__group" role="group" aria-label="Making">
        <Key label="Add" icon={<Plus className="pc-icon" aria-hidden="true" />} shortcut={["A"]} disabledReason={ADD_WAITS} />
        <Key
          label="Lay out"
          icon={<LayOutGlyph />}
          on={layingOut}
          marked
          expanded={layingOut}
          shortcut={["L"]}
          onPress={toggleLayOut}
        />
        <Key
          label="Measure"
          icon={<Ruler className="pc-icon" aria-hidden="true" />}
          toggle
          on={tool === "measure"}
          marked
          shortcut={["M"]}
          disabledReason={walking ? LEAVE_WALK : undefined}
          onPress={() => { setTool("measure"); }}
        />
        <Key
          label="Draw"
          icon={<PenLine className="pc-icon" aria-hidden="true" />}
          toggle
          on={tool === "draw"}
          marked
          shortcut={["D"]}
          disabledReason={walking ? LEAVE_WALK : undefined}
          onPress={() => { setTool("draw"); }}
        />
      </div>
      <KeySeparator />
      <div className="pc-dock__group" role="group" aria-label="Undo and redo">
        <Key
          label="Undo"
          iconOnly
          icon={<Undo2 className="pc-icon" aria-hidden="true" />}
          tip={undoName === null ? undefined : `Undo ${undoName}`}
          shortcut={["Ctrl", "Z"]}
          disabledReason={canUndo(history) ? undefined : "Nothing to undo yet"}
          onPress={() => { useEditorStore.getState().undo(); }}
        />
        <Key
          label="Redo"
          iconOnly
          icon={<Redo2 className="pc-icon" aria-hidden="true" />}
          tip={redoName === null ? undefined : `Redo ${redoName}`}
          shortcut={["Ctrl", "Shift", "Z"]}
          disabledReason={canRedo(history) ? undefined : "Nothing to redo yet"}
          onPress={() => { useEditorStore.getState().redo(); }}
        />
      </div>
    </div>
  );
}
