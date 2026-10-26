import { useLayoutEffect, useRef, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AVLensPanel } from "../editor/cockpit/AVLensPanel.js";
import { PowerLensPanel } from "../editor/cockpit/PowerLensPanel.js";
import { RiggingLensPanel } from "../editor/cockpit/RiggingLensPanel.js";

// ---------------------------------------------------------------------------
// Figures kept per layout for the sitting (T-674 slice 18; finding C-17).
//
// v1's AV, Power and Rigging bodies hold the figures a person types (a
// speaker's rating, the breaker, the suspended load) in their own component
// state, so in v1 a lens switch threw them away. Here each of those bodies is
// rendered once per layout into a detached element of its own, and the
// Production panel lends that element a place while it shows the part: a
// switch of part, of workspace, or closing the panel and opening it again
// keeps every figure. Nothing is saved with the layout (the panel says so),
// and a page reload starts empty, as before.
//
// Each body is its own small React root: it reads only the planner's stores
// (no router, no context), so it needs nothing from the tree it is lent to.
// The last few layouts are kept; an older one is let go.
// ---------------------------------------------------------------------------

export type KeptPart = "power" | "rigging" | "av";

const BODIES: Readonly<Record<KeptPart, () => ReactElement>> = {
  power: () => <PowerLensPanel />,
  rigging: () => <RiggingLensPanel />,
  av: () => <AVLensPanel />,
};

/** How many layouts' figures stay in hand at once. */
export const KEPT_LAYOUTS = 4;

interface Kept {
  readonly host: HTMLDivElement;
  readonly root: Root;
}

/** Layout key → part → its body; insertion order is the order of last use. */
const kept = new Map<string, Map<KeptPart, Kept>>();

function letGo(parts: ReadonlyMap<KeptPart, Kept>): void {
  // Never inside another root's commit: React refuses a synchronous unmount there.
  const roots = [...parts.values()];
  queueMicrotask(() => {
    for (const { host, root } of roots) {
      root.unmount();
      host.remove();
    }
  });
}

/** The element holding this layout's body for a part, made the first time it is asked for. */
export function keptBody(layoutKey: string, part: KeptPart): HTMLDivElement {
  let parts = kept.get(layoutKey);
  if (parts === undefined) parts = new Map();
  else kept.delete(layoutKey);
  kept.set(layoutKey, parts);
  while (kept.size > KEPT_LAYOUTS) {
    const oldest = kept.keys().next().value;
    if (oldest === undefined) break;
    const gone = kept.get(oldest);
    kept.delete(oldest);
    if (gone !== undefined) letGo(gone);
  }
  let entry = parts.get(part);
  if (entry === undefined) {
    const host = document.createElement("div");
    host.className = "pc-workspace__kept";
    const root = createRoot(host);
    root.render(BODIES[part]());
    entry = { host, root };
    parts.set(part, entry);
  }
  return entry.host;
}

/** The layouts whose figures are in hand, oldest first (for tests). */
export function keptLayouts(): readonly string[] {
  return [...kept.keys()];
}

/** Lets every kept body go (tests; a sign-out could call it too). */
export function forgetKeptBodies(): void {
  for (const parts of kept.values()) letGo(parts);
  kept.clear();
}

export interface KeptBodyProps {
  /** The layout the figures belong to. */
  readonly layoutKey: string;
  readonly part: KeptPart;
  /** In the panel but not in front: kept, out of sight and out of the tab order. */
  readonly hidden: boolean;
}

/** Lends this layout's body for a part a place in the panel while it is mounted. */
export function KeptBody({ layoutKey, part, hidden }: KeptBodyProps): ReactElement {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = keptBody(layoutKey, part);
    slot.current?.appendChild(host);
    return () => { host.remove(); };
  }, [layoutKey, part]);
  return <div ref={slot} className="pc-workspace__part" hidden={hidden} data-workspace-part={part} />;
}
