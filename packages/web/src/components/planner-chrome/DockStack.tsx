import { type ReactElement, type ReactNode } from "react";
import { Catalogue } from "./Catalogue.js";
import { Dock } from "./Dock.js";
import { Rail } from "./Rail.js";
import { SeatsMeter } from "./SeatsMeter.js";
import "./chrome.css";
import "./dock.css";

// ---------------------------------------------------------------------------
// The bottom centre (T-671 slice 12′; card-dock spec §2): the catalogue when
// it is open, then the rail joined to the dock's top edge, the seats meter at the joint, then the dock.
// The rail and the dock share one width, the dock's keys centred in it.
// ---------------------------------------------------------------------------

const moreKey = (): HTMLElement | null => document.querySelector<HTMLElement>(".pc-rail__more");

export function DockStack({ catalogue }: { readonly catalogue?: ReactNode }): ReactElement {
  return (
    <div className="pc-dockstack" data-testid="planner-dock-stack">
      {catalogue ?? <Catalogue returnFocusTo={moreKey} />}
      <Rail />
      <SeatsMeter />
      <Dock />
    </div>
  );
}
