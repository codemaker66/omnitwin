import { type ReactElement, type ReactNode } from "react";
import { usePlannerChromeStore } from "../../stores/planner-chrome-store.js";
import { TooltipHost } from "./Tooltip.js";
import "./chrome.css";
import "./shell.css";

// ---------------------------------------------------------------------------
// ChromeShell — the new chrome's zones over the room (T-671 slice 6).
//
// The room is the page's one main landmark, full bleed; the zones sit over it
// with fixed homes (shell.css), each holding what the slices put there: the
// slate, the utilities, the dock, the next step, and one panel per side zone
// (stores/planner-chrome-store.ts). Nothing here is drawn of its own: an empty
// zone is an empty place in the room.
// ---------------------------------------------------------------------------

export interface ChromeShellProps {
  /** The room, full bleed. */
  readonly room: ReactNode;
  /** Top left: what this is and whether it is saved, with the plane joined under it. */
  readonly slate?: ReactNode;
  /** Top centre: the command line, and Plan's Model / Drawing switch. */
  readonly topCentre?: ReactNode;
  /** Top right: Present, Find, Sound, who is here, the account. */
  readonly utilities?: ReactNode;
  /** The left zone's panel: making. */
  readonly left?: ReactNode;
  /** The right zone's panel: deciding. */
  readonly right?: ReactNode;
  /** The line above the dock: a first-visit hint, a receipt, the evening. */
  readonly aboveDock?: ReactNode;
  /** Bottom centre. */
  readonly dock?: ReactNode;
  /** Bottom right: the one outcome that comes next. */
  readonly nextStep?: ReactNode;
}

export function ChromeShell({ room, slate, topCentre, utilities, left, right, aboveDock, dock, nextStep }: ChromeShellProps): ReactElement {
  const leftPanel = usePlannerChromeStore((state) => state.left);
  const rightPanel = usePlannerChromeStore((state) => state.right);
  return (
    <div
      className="pc-shell pc-root"
      data-testid="planner-chrome-v2"
      data-left-panel={leftPanel ?? undefined}
      data-right-panel={rightPanel ?? undefined}
    >
      <main id="main-content" className="pc-room-stage" aria-label="The room">{room}</main>
      <div className="pc-shell__zones">
        <div className="pc-zone pc-zone--slate" data-pc-zone="slate">{slate}</div>
        <div className="pc-zone pc-zone--top-centre" data-pc-zone="top-centre">{topCentre}</div>
        <div className="pc-zone pc-zone--utilities" data-pc-zone="utilities">{utilities}</div>
        <div className="pc-zone pc-zone--left" data-pc-zone="left">{left}</div>
        <div className="pc-zone pc-zone--right" data-pc-zone="right">{right}</div>
        <div className="pc-zone pc-zone--above-dock" data-pc-zone="above-dock">{aboveDock}</div>
        <div className="pc-zone pc-zone--dock" data-pc-zone="dock">{dock}</div>
        <div className="pc-zone pc-zone--next-step" data-pc-zone="next-step">{nextStep}</div>
      </div>
      <TooltipHost />
    </div>
  );
}
