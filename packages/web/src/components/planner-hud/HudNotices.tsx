import { useEffect, useRef, type ReactElement } from "react";
import { canUndo } from "../../lib/editor-history.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { useLayoutTimelinePreviewStore } from "../../stores/layout-timeline-preview-store.js";
import { usePlacementNoticeStore } from "../../stores/placement-notice-store.js";
import { CloseGlyph, UndoGlyph } from "./glyphs.js";
import "./hud-notices.css";

// ---------------------------------------------------------------------------
// Receipts: the planner's one plain line about what was just refused or done
// (stores/placement-notice-store.ts), shown above the hand in the HUD's own
// look. It is the line the earlier screen shows (components/editor/
// PlacementNotice.tsx), with the same rules: the status region is always
// mounted so a screen reader hears each new line, politely; the line clears
// itself after a few seconds, or as soon as the piece it was about is set
// down or another is taken. A receipt one Undo takes back carries Undo beside
// it, because nothing should be frightening to try.
// ---------------------------------------------------------------------------

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
        <div key={notice.id} className="hud-notice" data-testid="hud-notice">
          <p className="hud-notice__line">{notice.text}</p>
          {notice.undo === true ? (
            <button
              type="button"
              className="hud-key hud-key--quiet hud-notice__undo"
              disabled={!undoable || previewing}
              onClick={() => {
                useEditorStore.getState().undo();
                usePlacementNoticeStore.getState().dismiss(notice.id);
              }}
            >
              <UndoGlyph />
              <span>Undo</span>
            </button>
          ) : null}
          <button
            type="button"
            className="hud-key hud-key--quiet hud-notice__close"
            aria-label="Close this note"
            onClick={() => { usePlacementNoticeStore.getState().dismiss(notice.id); }}
          >
            <CloseGlyph />
          </button>
        </div>
      ) : null}
    </div>
  );
}
