// ---------------------------------------------------------------------------
// AssemblyReplay — plays the Grand Assembly again over the open layout.
//
// Shown only where this device asks for the Assembly (`?assembly=accio`) and
// a layout with furniture is open; it steps aside while the Assembly plays.
// ---------------------------------------------------------------------------

import type { ReactElement } from "react";
import { usePlacementStore } from "../../stores/placement-store.js";
import { requestAssemblyReplay, useAssemblyRecallStore } from "./recall.js";
import "./assembly.css";

export function AssemblyReplay(): ReactElement | null {
  const playing = useAssemblyRecallStore((state) => state.active);
  const furnished = usePlacementStore((state) => state.placedItems.length > 0);
  if (!furnished) return null;
  return (
    <button
      type="button"
      className="assembly-replay"
      data-playing={playing ? "true" : "false"}
      disabled={playing}
      onClick={requestAssemblyReplay}
    >
      Replay the assembly
    </button>
  );
}
