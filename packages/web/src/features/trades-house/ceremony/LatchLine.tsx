import { useEffect, useRef, type ReactElement } from "react";
import { MAX_LATCH_WORDS, latchWordCount } from "../stage/stage-manifest.js";
import { stampBeat } from "./beats.js";
import type { CeremonyPhase } from "./ceremony-types.js";
import { createFrameLoop } from "./spring-loop.js";

// -----------------------------------------------------------------------------
// LatchLine — the line that makes you want the next scene.
//
// The manifest's `latch`: at most fourteen words, names the next place or
// object, no question, no forecast of the reader. It has its own slot in the
// reply panel and renders only once the reply has ended (phase "latched"),
// stamping data-beat-at="latch" on its first frame. The word cap is held by
// construction here as well as by the manifest test: a latch that arrives
// long is cut to its first fourteen words rather than shipped long.
// -----------------------------------------------------------------------------

export interface LatchLineProps {
  readonly text: string;
  readonly phase: CeremonyPhase;
  readonly className?: string;
}

/** The first MAX_LATCH_WORDS words, whitespace normalised. */
export function clampLatch(text: string): string {
  const words = text.trim().split(/\s+/u).filter(Boolean);
  return words.slice(0, MAX_LATCH_WORDS).join(" ");
}

export function LatchLine({ text, phase, className }: LatchLineProps): ReactElement | null {
  const rootRef = useRef<HTMLParagraphElement>(null);
  const visible = phase === "latched";

  useEffect(() => {
    if (!visible) return undefined;
    const loop = createFrameLoop((nowMs) => {
      stampBeat(rootRef.current, "latch", nowMs);
      return false;
    });
    loop.wake();
    return () => { loop.stop(); };
  }, [visible]);

  if (!visible) return null;
  const line = clampLatch(text);
  return (
    <p
      ref={rootRef}
      className={className === undefined ? "ceremony-latch" : `ceremony-latch ${className}`}
      data-words={latchWordCount(line)}
    >
      {line}
    </p>
  );
}
