import { useEffect, useState } from "react";
import { useEditorStore } from "../../stores/editor-store.js";
import { GOLD, BORDER, CARD_BG, TEXT_SEC, TEXT_MUT } from "../../constants/ui-palette.js";

// ---------------------------------------------------------------------------
// ObjectNotePanel — floating input for attaching a planner note to the
// currently-selected placed object.
//
// The note propagates through the editor store → auto-save batch →
// placed_objects.metadata.notes → manifest row notes → PDF + tablet
// display. One sentence of text becomes operational context for the
// hallkeeper on the day of the event ("this table is VIP", "HDMI
// cable routes through here", "keep chair at exact angle").
//
// Only renders when exactly one object is selected; multi-select or
// zero-select hides the panel to keep the viewport clean.
// ---------------------------------------------------------------------------

const MAX_NOTE = 500;

export function ObjectNotePanel(): React.ReactElement | null {
  const selectedId = useEditorStore((s) => s.selectedObjectId);
  // Subscribe to the notes primitive only, not the whole object. `.find()`
  // returns a fresh reference on every mutation to the selected object
  // (drag, rotate, autosave round-trip that replaces `objects` wholesale),
  // so selecting the whole object would rebuild this component's view
  // constantly. Subscribing to a primitive is Object.is-stable until the
  // note string actually changes, which is what we care about.
  const savedNotes = useEditorStore((s) => {
    if (selectedId === null) return null;
    const o = s.objects.find((x) => x.id === selectedId);
    return o === undefined ? null : o.notes;
  });
  const setObjectNotes = useEditorStore((s) => s.setObjectNotes);

  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);

  // Re-sync the draft ONLY when the selection changes. Depending on the
  // object identity (or savedNotes directly) would silently wipe an
  // in-progress draft on every store tick that touches the selected
  // object — autosave round-trip, drag, rotate all trigger new object
  // references even though the planner hasn't moved on. Keep dirty
  // drafts sacrosanct; only reset when the user picks a different
  // object or deselects.
  useEffect(() => {
    // savedNotes read through a ref-free closure: read the current store
    // state directly so this effect doesn't fire on note-string changes.
    const current = useEditorStore.getState().objects.find((o) => o.id === selectedId);
    setDraft(current?.notes ?? "");
    setDirty(false);
  }, [selectedId]);

  if (selectedId === null || savedNotes === null) return null;

  const handleSave = (): void => {
    setObjectNotes(selectedId, draft.trim());
    setDirty(false);
  };

  const handleClear = (): void => {
    setDraft("");
    setObjectNotes(selectedId, "");
    setDirty(false);
  };

  const hasNote = savedNotes.length > 0;
  const charsLeft = MAX_NOTE - draft.length;

  return (
    <section
      role="region"
      aria-label="Object note editor"
      style={{
        position: "fixed",
        bottom: 20, right: 20,
        width: 320, maxWidth: "calc(100vw - 40px)",
        padding: 14, borderRadius: 12,
        background: CARD_BG,
        border: `1px solid ${BORDER}`,
        boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
        zIndex: 40,
        color: "#ddd",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", color: GOLD, textTransform: "uppercase" }}>
            Planner Note
          </div>
          <div style={{ fontSize: 11, color: TEXT_SEC, marginTop: 1 }}>
            Surfaced on the hallkeeper sheet
          </div>
        </div>
        {hasNote && (
          <span
            style={{ fontSize: 9, color: GOLD, fontWeight: 700, background: "rgba(201,168,76,0.12)", padding: "2px 6px", borderRadius: 4 }}
            aria-label="This object has a saved note"
          >
            SAVED
          </span>
        )}
      </div>

      <textarea
        value={draft}
        onChange={(e) => {
          const next = e.target.value.slice(0, MAX_NOTE);
          setDraft(next);
          setDirty(next !== savedNotes);
        }}
        placeholder="e.g. VIP table, needs HDMI run, keep exit clear…"
        rows={3}
        style={{
          width: "100%", boxSizing: "border-box",
          padding: 8, borderRadius: 6,
          background: "#111", color: "#eee",
          border: `1px solid ${BORDER}`,
          fontSize: 13, fontFamily: "inherit",
          resize: "vertical", minHeight: 60,
        }}
      />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
        <div style={{ fontSize: 10, color: charsLeft < 40 ? GOLD : TEXT_MUT }}>
          {charsLeft} characters left
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {hasNote && (
            <button
              type="button"
              onClick={handleClear}
              style={{
                padding: "6px 10px", fontSize: 11,
                background: "transparent", color: TEXT_SEC,
                border: `1px solid ${BORDER}`, borderRadius: 6,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty}
            style={{
              padding: "6px 14px", fontSize: 12, fontWeight: 600,
              background: dirty ? GOLD : "#2a2824",
              color: dirty ? "#111" : TEXT_MUT,
              border: "none", borderRadius: 6,
              cursor: dirty ? "pointer" : "default",
              fontFamily: "inherit",
            }}
          >
            {dirty ? "Save Note" : hasNote ? "Note saved" : "No note"}
          </button>
        </div>
      </div>
    </section>
  );
}
