import { useLayoutEffect, useRef, type ReactElement, type ReactNode } from "react";
import { Catalogue } from "./Catalogue.js";
import { Dock } from "./Dock.js";
import { Rail } from "./Rail.js";
import { SeatsMeter } from "./SeatsMeter.js";
import { useStoreStock } from "./store-figures.js";
import "./chrome.css";
import "./dock.css";

// ---------------------------------------------------------------------------
// The bottom centre (T-671 slice 12′; card-dock spec §2): the catalogue when
// it is open, then the rail joined to the dock's top edge, the seats meter at the joint, then the dock.
// The rail and the dock share one width, the dock's keys centred in it.
// ---------------------------------------------------------------------------

const moreKey = (): HTMLElement | null => document.querySelector<HTMLElement>(".pc-rail__more");

export function DockStack({ catalogue }: { readonly catalogue?: ReactNode }): ReactElement {
  useStoreStock();
  const stackRef = useRef<HTMLDivElement>(null);
  // The receipt and anything else above the dock stand above the whole stack, whatever it shows.
  useLayoutEffect(() => {
    const stack = stackRef.current;
    const shell = stack?.closest<HTMLElement>(".pc-shell") ?? null;
    if (stack === null || shell === null) return undefined;
    const publish = (): void => { shell.style.setProperty("--pc-dockstack-height", `${String(Math.round(stack.getBoundingClientRect().height))}px`); };
    publish();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
    observer?.observe(stack);
    return () => {
      observer?.disconnect();
      shell.style.removeProperty("--pc-dockstack-height");
    };
  }, []);
  return (
    <div ref={stackRef} className="pc-dockstack" data-testid="planner-dock-stack">
      {catalogue ?? <Catalogue returnFocusTo={moreKey} />}
      <Rail />
      <SeatsMeter />
      <Dock />
    </div>
  );
}
