import { useEffect, useRef, type ReactElement } from "react";
import { canUndo } from "../../lib/editor-history.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { useLayoutTimelinePreviewStore } from "../../stores/layout-timeline-preview-store.js";
import { usePlacementNoticeStore } from "../../stores/placement-notice-store.js";
import "./hud-notices.css";

// ---------------------------------------------------------------------------
// Receipts: the planner's one plain line about what was just refused or done
// (stores/placement-notice-store.ts). While one shows it takes the status
// line's place on the shelf (Hand.tsx), in the same type, and gives the line
// back when it clears. The rules are the earlier screen's (components/editor/
// PlacementNotice.tsx): the status region is always mounted so a screen reader
// hears each new line, politely; the line clears itself after a few seconds,
// or as soon as the piece it was about is set down or another is taken. A
// receipt one Undo takes back carries Undo beside it, because nothing should
// be frightening to try.
// ---------------------------------------------------------------------------

/** Whether a receipt is showing, and so has the status line's place. */
export function useReceiptShowing(): boolean {
  return usePlacementNoticeStore((state) => state.notice !== null);
}

export function HudNotices(): ReactElement {
  const notice = usePlacementNoticeStore((state) => state.notice);
  const selectedItemId = useCatalogueStore((state) => state.selectedItemId);
  const undoable = useEditorStore((state) => canUndo(state.history));
  const previewing = useLayoutTimelinePreviewStore((state) => state.mode !== "inactive");

  // Setting the piece down, or taking another, makes the line about it stale.
  const shownFor = useRef(selectedItemId);
  useEffect(() => {
    if (shownFor.current === selectedItemId) return;
    shownFor.current = selectedItemId;
    usePlacementNoticeStore.getState().dismiss();
  }, [selectedItemId]);

  return (
    <div className="hud-notices" role="status" aria-live="polite" data-testid="hud-notice-region">
      {notice !== null ? (
        <p key={notice.id} className="hud-notice" data-testid="hud-notice">
          <span className="hud-notice__line">{notice.text}</span>
          {notice.undo === true ? (
            <button
              type="button"
              className="hud-word hud-notice__undo"
              disabled={!undoable || previewing}
              onClick={() => {
                useEditorStore.getState().undo();
                usePlacementNoticeStore.getState().dismiss(notice.id);
              }}
            >
              Undo
            </button>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
