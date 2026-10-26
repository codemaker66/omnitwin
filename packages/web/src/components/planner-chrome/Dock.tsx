import { useEffect, type KeyboardEvent, type ReactElement } from "react";
import { PenLine, Plus, Redo2, Ruler, Undo2 } from "lucide-react";
import { canRedo, canUndo, redoLabel, undoLabel } from "../../lib/editor-history.js";
import { useCardsStore } from "../../stores/cards-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { useHallViewStore } from "../../stores/hall-view-store.js";
import { usePlannerChromeStore } from "../../stores/planner-chrome-store.js";
import { useToolStore } from "../../stores/tool-store.js";
import { useModelledGrandHall } from "../grand-hall/hall-space.js";
import { VIEW_ORDER, chooseView, toggleLayOut, useDockKeys } from "./dock-keys.js";
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
// has set views; Add (A) opens the catalogue above the rail; Undo and Redo
// are named for what they would do. The hour chip (slice 10) and the staff
// workspace menu (slice 18) join this bar later; the rail sits on its top
// edge (DockStack).
// ---------------------------------------------------------------------------

/** The dock's words, in order: no two share a stem (spec 4.1, "Lay out" never beside "Layout"). */
export const DOCK_LABELS = ["Plan", "Room", "Walk", "Add", "Lay out", "Measure", "Draw", "Undo", "Redo"] as const;

const NO_SET_VIEWS = "Only the Grand Hall has set views so far";
const LEAVE_WALK = "Leave Walk first";

export function Dock(): ReactElement {
  const viewsReady = useModelledGrandHall();
  useDockKeys(viewsReady);
  const walking = useCockpitStore((state) => state.walkMode);
  const preset = useHallViewStore((state) => state.activePreset);
  const tool = useToolStore((state) => state.activeTool);
  const layingOut = usePlannerChromeStore((state) => state.right === "lay-out");
  const history = useEditorStore((state) => state.history);
  const catalogueOpen = useCardsStore((state) => state.catalogueOpen);
  // The keymap's A (and F) put the add tool in hand; in this chrome Add is the catalogue, so A opens it and A again closes it.
  useEffect(() => {
    if (tool !== "add") return;
    useCardsStore.getState().toggleCatalogue();
    useToolStore.getState().setTool("select");
  }, [tool]);
  const view = walking ? "walk" : preset === "walk" ? null : preset;
  const undoName = undoLabel(history);
  const redoName = redoLabel(history);

  const setTool = (next: "measure" | "draw"): void => {
    const tools = useToolStore.getState();
    tools.setTool(tools.activeTool === next ? "select" : next);
  };

  // The views are one Tab stop (the view in use); the arrows, Home and End move between them.
  const tabStop = view ?? "plan";
  const onViewKeys = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!viewsReady) return;
    const index = VIEW_ORDER.indexOf(tabStop);
    const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? VIEW_ORDER[(index + 1) % VIEW_ORDER.length]
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? VIEW_ORDER[(index - 1 + VIEW_ORDER.length) % VIEW_ORDER.length]
        : event.key === "Home" ? VIEW_ORDER[0]
          : event.key === "End" ? VIEW_ORDER[VIEW_ORDER.length - 1]
            : undefined;
    if (next === undefined) return;
    event.preventDefault();
    chooseView(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-pc-key="${next}"]`)?.focus();
  };

  return (
    <div className="pc-lacquer pc-dock" role="toolbar" aria-label="The dock" data-testid="planner-dock">
      <div className="pc-dock__group" onKeyDown={onViewKeys}>
        <KeyRow role="radiogroup" label="View" activeKey={viewsReady ? view : null}>
          {VIEW_ORDER.map((id, index) => (
            <Key
              key={id}
              rowKey={id}
              label={DOCK_LABELS[index] ?? id}
              radio
              on={viewsReady && view === id}
              tabIndex={id === tabStop ? 0 : -1}
              shortcut={["Shift", String(index + 1)]}
              disabledReason={viewsReady ? undefined : NO_SET_VIEWS}
              onPress={() => { chooseView(id); }}
            />
          ))}
        </KeyRow>
      </div>
      <KeySeparator />
      <div className="pc-dock__group" role="group" aria-label="Making">
        <Key
          label="Add"
          icon={<Plus className="pc-icon" aria-hidden="true" />}
          on={catalogueOpen}
          marked
          expanded={catalogueOpen}
          shortcut={["A"]}
          disabledReason={walking ? LEAVE_WALK : undefined}
          onPress={() => { useCardsStore.getState().toggleCatalogue(); }}
        />
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
