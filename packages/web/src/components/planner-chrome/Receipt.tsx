import { useEffect, type ReactElement } from "react";
import { useEditorStore } from "../../stores/editor-store.js";
import { usePlacementNoticeStore } from "../../stores/placement-notice-store.js";
import { usePlannerChromeStore } from "../../stores/planner-chrome-store.js";
import { Kbd } from "./Kbd.js";
import { QuietKey } from "./Keys.js";
import "./chrome.css";
import "./receipt.css";

// ---------------------------------------------------------------------------
// The receipt (T-671; approved spec §6.9): one line above the dock for 5 s,
// in a status region: "Table 7 put back in store · Undo · Ctrl Z". Undo is
// the dock's own undo. A newer receipt replaces the older and has its own
// five seconds. The region stays mounted so each new line is announced. Under v2
// it is also where the placement engine's notices appear.
// ---------------------------------------------------------------------------

export const RECEIPT_MS = 5000;

export function Receipt(): ReactElement {
  const receipt = usePlannerChromeStore((state) => state.receipt);

  // The engine's notices (lane E's one channel): v1 shows them in its own strip, v2 here.
  // A receipt one Undo takes back keeps its Undo; a refusal is the line alone.
  useEffect(() => usePlacementNoticeStore.subscribe((state, previous) => {
    const notice = state.notice;
    if (notice === null || notice.id === previous.notice?.id) return;
    usePlannerChromeStore.getState().postReceipt(notice.text, { undo: notice.undo === true });
  }), []);

  useEffect(() => {
    if (receipt === null) return undefined;
    const timer = window.setTimeout(() => {
      // Only this receipt goes: a newer one keeps its own time.
      if (usePlannerChromeStore.getState().receipt?.id === receipt.id) usePlannerChromeStore.getState().clearReceipt();
    }, RECEIPT_MS);
    return () => { window.clearTimeout(timer); };
  }, [receipt]);

  return (
    <div className="pc-receipt-region" role="status">
      {receipt !== null ? (
        <p className="pc-lacquer pc-receipt" key={receipt.id}>
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
      ) : null}
    </div>
  );
}
