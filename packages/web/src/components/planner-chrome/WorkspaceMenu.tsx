import { useEffect, useRef, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { ChevronDown, Lightbulb, PencilRuler, PoundSterling, Route, Users } from "lucide-react";
import { WORKSPACES, workspaceEntry, type WorkspaceId } from "../../lib/workspaces-model.js";
import { usePlannerChromeStore } from "../../stores/planner-chrome-store.js";
import { Kbd } from "./Kbd.js";
import { Key, ariaKeyShortcut } from "./Keys.js";
import { Popover, usePopoverState } from "./Popover.js";
import {
  chooseWorkspace,
  setWorkspaceTrigger,
  useWorkspaceKeys,
  useWorkspaceStore,
  useWorkspacesAllowed,
} from "./workspace-state.js";
import "./chrome.css";
import "./workspaces.css";

// ---------------------------------------------------------------------------
// The workspace menu (T-674, v2 slice 18; spec 4.6, 6.15, frame 20), at the
// dock's left, staff only.
//
// A key named for the workspace in use ("Design ▾", never "Layout") opens a
// popover upward from the dock: Design, Guests, Flow, Production and Costs,
// each with one line of what it holds and its Ctrl digit, over the foot
// "Clients see the room and the dock, never these." Choosing one shows it in
// the right zone, replacing that zone's panel. Ctrl 1–5 do the same from
// anywhere in the planner. The arrows, Home and End move between the rows;
// Esc closes the menu and gives focus back to the key (the one Escape order).
// Clients, guests and (until D4) sales see none of it, and Ctrl 1–5 stay the
// browser's.
// ---------------------------------------------------------------------------

const ICONS: Readonly<Record<WorkspaceId, ReactNode>> = {
  design: <PencilRuler className="pc-icon" aria-hidden="true" />,
  guests: <Users className="pc-icon" aria-hidden="true" />,
  flow: <Route className="pc-icon" aria-hidden="true" />,
  production: <Lightbulb className="pc-icon" aria-hidden="true" />,
  costs: <PoundSterling className="pc-icon" aria-hidden="true" />,
};

const FOOT = "Clients see the room and the dock, never these.";

export function WorkspaceMenu(): ReactElement | null {
  const allowed = useWorkspacesAllowed();
  useWorkspaceKeys(allowed);
  if (!allowed) return null;
  return <WorkspaceMenuKey />;
}

function WorkspaceMenuKey(): ReactElement {
  const state = usePopoverState();
  const workspace = useWorkspaceStore((store) => store.workspace);
  const panelOpen = usePlannerChromeStore((chrome) => chrome.right === "workspace");
  const rows = useRef(new Map<WorkspaceId, HTMLButtonElement>());
  const { triggerRef, close } = state;
  const name = workspaceEntry(workspace).name;

  // The panel in the right zone gives focus back to this key when it closes.
  useEffect(() => {
    setWorkspaceTrigger(triggerRef.current);
    return () => { setWorkspaceTrigger(null); };
  }, [triggerRef]);

  const choose = (id: WorkspaceId): void => {
    close(false);
    chooseWorkspace(id);
  };

  const onRowKeys = (event: KeyboardEvent<HTMLDivElement>): void => {
    const order = WORKSPACES.map((entry) => entry.id);
    const at = order.findIndex((id) => rows.current.get(id) === document.activeElement);
    const index = at < 0 ? order.indexOf(workspace) : at;
    const next = event.key === "ArrowDown" ? order[(index + 1) % order.length]
      : event.key === "ArrowUp" ? order[(index - 1 + order.length) % order.length]
        : event.key === "Home" ? order[0]
          : event.key === "End" ? order[order.length - 1]
            : undefined;
    if (next === undefined) return;
    event.preventDefault();
    rows.current.get(next)?.focus();
  };

  return (
    <>
      <Key
        ref={triggerRef}
        label={name}
        tip={`${name} workspace`}
        on={state.open || panelOpen}
        expanded={state.open}
        trailing={<ChevronDown className="pc-icon pc-workspace-key__chevron" aria-hidden="true" />}
        className="pc-workspace-key"
        data-testid="planner-workspace-menu"
        data-workspace={workspace}
        {...state.triggerProps}
        onPress={state.toggle}
      />
      <Popover state={state} label="Workspaces" align="start" side="above" chrome="workspace-menu" className="pc-workspace-menu">
        <div className="pc-workspace-menu__section">
          <div className="pc-workspace-menu__head" aria-hidden="true">
            <span className="pc-caps">Workspaces</span>
            <span className="pc-meta">staff only</span>
          </div>
          <div role="menu" aria-label="Workspaces" className="pc-workspace-menu__rows" onKeyDown={onRowKeys}>
            {WORKSPACES.map((entry) => {
              const current = entry.id === workspace;
              const keys = ["Ctrl", String(entry.digit)];
              return (
                <button
                  key={entry.id}
                  ref={(element) => {
                    if (element === null) rows.current.delete(entry.id);
                    else rows.current.set(entry.id, element);
                  }}
                  type="button"
                  role="menuitemradio"
                  aria-checked={current}
                  aria-keyshortcuts={ariaKeyShortcut(keys)}
                  tabIndex={current ? 0 : -1}
                  className="pc-workspace-menu__row"
                  data-workspace={entry.id}
                  onClick={() => { choose(entry.id); }}
                >
                  <span className="pc-workspace-menu__icon">{ICONS[entry.id]}</span>
                  <span className="pc-workspace-menu__words">
                    <span className="pc-workspace-menu__name">{entry.name}</span>
                    <span className="pc-workspace-menu__line">{entry.line}</span>
                  </span>
                  <span className="pc-workspace-menu__keys" aria-hidden="true">
                    {keys.map((key) => <Kbd key={key}>{key}</Kbd>)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <p className="pc-meta pc-popover__foot pc-workspace-menu__foot">{FOOT}</p>
      </Popover>
    </>
  );
}
