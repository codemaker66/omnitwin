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

export function AssemblyReplay(): ReactElement | null {
  const playing = useAssemblyRecallStore((state) => state.active);
  const fast = useAssemblyRecallStore((state) => state.fast);
  const furnished = usePlacementStore((state) => state.placedItems.length > 0);
  if (!furnished) return null;
  const label = !playing ? "Replay the assembly" : fast ? "Skip to the end" : "Skip";
  const press = !playing ? requestAssemblyReplay : fast ? skipAssemblyToEnd : speedUpAssembly;
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
