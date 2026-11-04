// ---------------------------------------------------------------------------
// AssemblyReplay — the Grand Assembly's Skip over the drawn hall.
//
// While the Assembly plays it is the Skip (Blake: "a visible skip which speeds
// it up"): a first press plays the show on at speed, a second goes straight to
// the end. At rest it is gone: Present replays the Assembly (Blake: "There is a
// present button which plays it also if we want to see it again";
// components/editor/planner-present.ts). As the show ends it stays a moment,
// fading, so a press already on its way to it lands on it and not the room.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState, type ReactElement } from "react";
import { usePlacementStore } from "../../stores/placement-store.js";
import { REPLAY_SETTLE_MS, hurryAssembly, useAssemblyRecallStore } from "./recall.js";
import "./assembly.css";

// The Skip stays REPLAY_SETTLE_MS once the Assembly gives the room back, fading as it goes (assembly.css). A
// hurried show can end under a press already on its way to the Skip; landing on the room it would select or
// deselect a piece, so it lands on the Skip, which lets it go.
export { REPLAY_SETTLE_MS };

function skipWords(fast: boolean): string {
  return fast ? "Skip to the end" : "Skip";
}

export function AssemblyReplay(): ReactElement | null {
  const playing = useAssemblyRecallStore((state) => state.active);
  const fast = useAssemblyRecallStore((state) => state.fast);
  const restedAt = useAssemblyRecallStore((state) => state.restedAt);
  const furnished = usePlacementStore((state) => state.placedItems.length > 0);
  /** What the Skip last said while the show played: it keeps its words as it fades. Null once it has gone. */
  const [lastWords, setLastWords] = useState<string | null>(null);
  const control = useRef<HTMLButtonElement | null>(null);
  /** Where focus was before it came to the Skip: it goes back there as the Skip goes. */
  const cameFrom = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (playing) setLastWords(skipWords(fast));
  }, [fast, playing]);

  useEffect(() => {
    if (playing || lastWords === null) return undefined;
    const timer = window.setTimeout(() => {
      const back = cameFrom.current;
      cameFrom.current = null;
      if (document.activeElement === control.current && back !== null && back.isConnected) back.focus({ preventScroll: true });
      setLastWords(null);
    }, Math.max(0, REPLAY_SETTLE_MS - (performance.now() - restedAt)));
    return () => { window.clearTimeout(timer); };
  }, [lastWords, playing, restedAt]);

  if (!furnished || (!playing && lastWords === null)) return null;
  const settling = !playing;
  return (
    <button
      ref={control}
      type="button"
      className="assembly-replay"
      data-playing={playing ? "true" : "false"}
      data-fast={fast ? "true" : "false"}
      data-settling={settling ? "true" : "false"}
      tabIndex={settling ? -1 : undefined}
      onFocus={(event) => {
        if (event.relatedTarget instanceof HTMLElement) cameFrom.current = event.relatedTarget;
      }}
      // At rest a press does nothing: hurryAssembly reads that the show is over.
      onClick={hurryAssembly}
    >
      {settling ? lastWords : skipWords(fast)}
    </button>
  );
}
