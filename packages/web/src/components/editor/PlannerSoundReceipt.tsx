import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { prefersReducedMotion } from "../../lib/reduced-motion.js";
import { usePlannerSoundArming, type PlannerSoundMode } from "../../lib/sound-registry.js";
import { usePlannerSoundShortcut } from "../../lib/planner-sound-shortcut.js";
import "./LayoutLiveLayer.css";
import "./PlannerSoundReceipt.css";

// ---------------------------------------------------------------------------
// PlannerSoundReceipt: what Shift M did (T-700, Task 14b). No sound control is
// ever on screen (the setting lives in the menus), so a press says what it
// did for 2.4 s, in the live layer's capsule, through a polite status line
// that is always there to be heard. The scene mounts it for every chrome, and
// it arms the planner's sound at the first press or key anywhere. Under
// reduced motion the capsule simply appears.
// ---------------------------------------------------------------------------

/** How long the receipt stays. */
export const SOUND_RECEIPT_MS = 2_400;

/** The receipt's words for the mode a press left the planner in. */
export function soundReceiptLine(mode: PlannerSoundMode): string {
  return mode === "off" ? "Sound off · Shift M" : "Sound on · Shift M";
}

interface Receipt {
  readonly line: string;
  /** Each press draws its own capsule, so its entrance plays again. */
  readonly press: number;
  readonly moves: boolean;
}

export function PlannerSoundReceipt(): ReactElement {
  usePlannerSoundArming();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const timer = useRef<number | null>(null);
  const presses = useRef(0);

  const onToggled = useCallback((mode: PlannerSoundMode) => {
    presses.current += 1;
    setReceipt({ line: soundReceiptLine(mode), press: presses.current, moves: !prefersReducedMotion() });
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setReceipt(null);
    }, SOUND_RECEIPT_MS);
  }, []);
  usePlannerSoundShortcut(onToggled);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  return (
    <div className="planner-sound-receipt" role="status" aria-live="polite">
      {receipt !== null && (
        <span key={receipt.press} className={receipt.moves ? "layout-live-capsule layout-live-notice" : "layout-live-capsule"}>
          {receipt.line}
        </span>
      )}
    </div>
  );
}
