// ---------------------------------------------------------------------------
// AssemblyReplay — the Grand Assembly's one control over the drawn hall.
//
// While the Assembly plays it is the Skip (Blake: "a visible skip which speeds
// it up"): a first press plays the show on at speed, a second goes straight to
// the end. At rest it plays the Assembly again over the open layout. Shown
// where the Assembly may play and a layout with furniture is open.
// ---------------------------------------------------------------------------

import type { ReactElement } from "react";
import { usePlacementStore } from "../../stores/placement-store.js";
import { requestAssemblyReplay, skipAssemblyToEnd, speedUpAssembly, useAssemblyRecallStore } from "./recall.js";
import "./assembly.css";

/**
 * How long the control lets presses go once the Assembly gives the room back, ms. A press that lands this soon
 * was aimed at the Skip (a hurried show can end under a press already on its way); asking for the replay takes
 * a person longer than this to read and decide.
 */
export const REPLAY_SETTLE_MS = 600;

/** A press does what the Assembly is doing now, not what the last frame drew: the show can end in between. */
function press(): void {
  const { active, fast, restedAt } = useAssemblyRecallStore.getState();
  if (active) {
    if (fast) skipAssemblyToEnd();
    else speedUpAssembly();
  } else if (performance.now() - restedAt >= REPLAY_SETTLE_MS) {
    requestAssemblyReplay();
  }
}

export function AssemblyReplay(): ReactElement | null {
  const playing = useAssemblyRecallStore((state) => state.active);
  const fast = useAssemblyRecallStore((state) => state.fast);
  const furnished = usePlacementStore((state) => state.placedItems.length > 0);
  if (!furnished) return null;
  const label = !playing ? "Replay the assembly" : fast ? "Skip to the end" : "Skip";
  return (
    <button
      type="button"
      className="assembly-replay"
      data-playing={playing ? "true" : "false"}
      data-fast={fast ? "true" : "false"}
      onClick={press}
    >
      {label}
    </button>
  );
}
