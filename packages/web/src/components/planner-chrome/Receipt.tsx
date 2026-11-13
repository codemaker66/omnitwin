import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { useEditorStore } from "../../stores/editor-store.js";
import { usePlacementNoticeStore } from "../../stores/placement-notice-store.js";
import { usePlannerChromeStore, type Receipt as ReceiptShown } from "../../stores/planner-chrome-store.js";
import { Kbd } from "./Kbd.js";
import { QuietKey } from "./Keys.js";
import "./chrome.css";
import "./receipt.css";

// ---------------------------------------------------------------------------
// The receipt (T-671; approved spec §6.9): one line above the dock for 5 s,
// in a status region: "Table 7 put back in store · Undo · Ctrl Z". Undo is
// the dock's own undo. A newer receipt replaces the older and has its own
// five seconds. The region stays mounted so each new line is announced. Under v2
// it is also where the placement engine's notices appear. Focus or the
// pointer on the line holds it (WCAG 2.2.1); a line that goes while it has
// focus hands focus to the dock's Undo, not to the page.
// ---------------------------------------------------------------------------

export const RECEIPT_MS = 5000;

/** The dock's own Undo (Dock.tsx), the receipt's Undo's twin. */
function dockUndo(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-dock-undo]");
}

function ReceiptLine({ receipt }: { readonly receipt: ReceiptShown }): ReactElement {
  const lineRef = useRef<HTMLParagraphElement>(null);
  const [focused, setFocused] = useState(false);
  const [pointed, setPointed] = useState(false);
  const held = focused || pointed;

  // Five seconds, counted only while nobody holds it; letting go gives it five more.
  useEffect(() => {
    if (held) return undefined;
    const timer = window.setTimeout(() => {
      // Only this receipt goes: a newer one keeps its own time.
      if (usePlannerChromeStore.getState().receipt?.id === receipt.id) usePlannerChromeStore.getState().clearReceipt();
    }, RECEIPT_MS);
    return () => { window.clearTimeout(timer); };
  }, [held, receipt.id]);

  // Runs before the line leaves the page, while focus is still in it.
  useLayoutEffect(() => {
    const line = lineRef.current;
    return () => {
      if (line !== null && line.contains(document.activeElement)) dockUndo()?.focus({ preventScroll: true });
    };
  }, []);

  return (
    <p
      ref={lineRef}
      className="pc-lacquer pc-receipt"
      onFocus={() => { setFocused(true); }}
      onBlur={(event) => { if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setFocused(false); }}
      onPointerEnter={() => { setPointed(true); }}
      onPointerLeave={() => { setPointed(false); }}
    >
      <span className="pc-receipt__text">{receipt.text}</span>
      {receipt.undo ? (
        <>
          <span className="pc-receipt__dot" aria-hidden="true">·</span>
          <QuietKey
            label="Undo"
            className="pc-receipt__undo"
            onPress={() => {
              useEditorStore.getState().undo();
              usePlannerChromeStore.getState().clearReceipt();
            }}
          />
          <span className="pc-receipt__keys" aria-hidden="true"><Kbd>Ctrl</Kbd> <Kbd>Z</Kbd></span>
        </>
      ) : null}
    </p>
  );
}

export function Receipt(): ReactElement {
  const receipt = usePlannerChromeStore((state) => state.receipt);

  // The engine's notices (lane E's one channel): v1 shows them in its own strip, v2 here.
  // A receipt one Undo takes back keeps its Undo; a refusal is the line alone.
  useEffect(() => usePlacementNoticeStore.subscribe((state, previous) => {
    const notice = state.notice;
    if (notice === null || notice.id === previous.notice?.id) return;
    usePlannerChromeStore.getState().postReceipt(notice.text, { undo: notice.undo === true });
  }), []);

  return (
    <div className="pc-receipt-region" role="status">
      {receipt !== null ? <ReceiptLine key={receipt.id} receipt={receipt} /> : null}
    </div>
  );
}
