// -----------------------------------------------------------------------------
// CaptionRegion — the ONE aria-live="polite" region for the stage's captions
// (law 10: separate from the progress region and the Convener's mirror).
// Visible as a small caption line at the foot of the stage when captions are
// on; when they are off it stays in the tree, live and visually hidden, so a
// screen reader still hears what a poke did. The child is keyed on the
// store's sequence so an identical caption twice is announced twice.
//
// Place it inside the stage's 100dvh `overflow: clip` wrapper: it is
// absolutely positioned and adds nothing to the document's scroll height.
// -----------------------------------------------------------------------------
import { useSyncExternalStore, type ReactElement } from "react";
import type { CaptionStore } from "./captions.js";
import "./captions.css";

export interface CaptionRegionProps {
  readonly store: CaptionStore;
  /** prefs.captions: on shows the line; off keeps the region live for screen readers only. */
  readonly captionsOn: boolean;
  readonly className?: string;
}

export function CaptionRegion({ store, captionsOn, className }: CaptionRegionProps): ReactElement {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const classes = className === undefined ? "quiz-caption-region" : `quiz-caption-region ${className}`;
  return (
    <div className={classes} data-captions={captionsOn ? "on" : "off"} data-testid="quiz-captions">
      <p className="quiz-caption-line" aria-live="polite" aria-atomic="true">
        {snapshot.text === "" ? null : <span key={snapshot.seq}>{snapshot.text}</span>}
      </p>
    </div>
  );
}
