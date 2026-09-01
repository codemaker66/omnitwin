import { useEffect, useState } from "react";
import { useEditorStore } from "../../stores/editor-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useLayoutTimelinePreviewStore } from "../../stores/layout-timeline-preview-store.js";
import { getCatalogueItem } from "../../lib/catalogue.js";
import { canApplyTableLinenToItem, isDiningTableItem } from "../../lib/furniture-semantics.js";
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
const MAX_CHAIR_STYLE = 40;
const MAX_CENTERPIECE = 80;

const segmentStyle = (active: boolean): React.CSSProperties => ({
  padding: "5px 10px", fontSize: 11, fontWeight: active ? 700 : 500,
  background: active ? "rgba(201,168,76,0.16)" : "transparent",
  color: active ? GOLD : TEXT_SEC,
  border: `1px solid ${active ? GOLD : BORDER}`, borderRadius: 6,
  cursor: "pointer", fontFamily: "inherit",
});

const dressingInputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  padding: "6px 8px", borderRadius: 6,
  background: "#111", color: "#eee",
  border: `1px solid ${BORDER}`,
  fontSize: 12, fontFamily: "inherit",
};

const rowLabelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, letterSpacing: "0.06em",
  color: TEXT_SEC, textTransform: "uppercase",
};

/**
 * DRESSING (C2) — segmented linen / place-setting controls plus free-text
 * chair style and centrepiece for the selected table. Linen and tableware
 * write through the placement store (the single catalogue-gated path the
 * command deck already uses); chair style and centrepiece are placement
 * metadata written through the editor store, so all four reach the
 * hallkeeper sheet through the same auto-save batch as the note below.
 */
function DressingSection({ objectId }: { readonly objectId: string }): React.ReactElement | null {
  const assetDefinitionId = useEditorStore((s) => {
    const o = s.objects.find((x) => x.id === objectId);
    return o === undefined ? null : o.assetDefinitionId;
  });
  const clothed = useEditorStore((s) => s.objects.find((x) => x.id === objectId)?.clothed ?? false);
  const clothStyle = useEditorStore((s) => s.objects.find((x) => x.id === objectId)?.clothStyle ?? null);
  const tableSetting = useEditorStore((s) => s.objects.find((x) => x.id === objectId)?.tableSetting ?? null);
  const savedChairStyle = useEditorStore((s) => s.objects.find((x) => x.id === objectId)?.chairStyle ?? null);
  const savedCenterpiece = useEditorStore((s) => s.objects.find((x) => x.id === objectId)?.centerpiece ?? null);
  const setObjectDressing = useEditorStore((s) => s.setObjectDressing);

  const [chairDraft, setChairDraft] = useState("");
  const [centerpieceDraft, setCenterpieceDraft] = useState("");

  // Same draft law as the note below: re-seed ONLY on selection change so an
  // in-progress draft survives autosave/drag store ticks.
  useEffect(() => {
    const current = useEditorStore.getState().objects.find((o) => o.id === objectId);
    setChairDraft(current?.chairStyle ?? "");
    setCenterpieceDraft(current?.centerpiece ?? "");
  }, [objectId]);

  const catalogueItem = assetDefinitionId === null ? undefined : getCatalogueItem(assetDefinitionId);
  if (catalogueItem === undefined || !canApplyTableLinenToItem(catalogueItem)) return null;
  const dining = isDiningTableItem(catalogueItem);

  const commitChair = (): void => {
    if (chairDraft.trim() !== (savedChairStyle ?? "")) {
      setObjectDressing(objectId, { chairStyle: chairDraft });
    }
  };
  const commitCenterpiece = (): void => {
    if (centerpieceDraft.trim() !== (savedCenterpiece ?? "")) {
      setObjectDressing(objectId, { centerpiece: centerpieceDraft });
    }
  };
  const onEnterBlur = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter") e.currentTarget.blur();
  };

  const linen: "none" | "white" | "black" = clothed ? (clothStyle === "white" ? "white" : "black") : "none";
  const placement = usePlacementStore.getState;

  return (
    <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: `1px solid ${BORDER}` }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", color: GOLD, textTransform: "uppercase", marginBottom: 8 }}>
        Dressing
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: dining ? 8 : 0 }}>
        <span style={rowLabelStyle}>Linen</span>
        <div style={{ display: "flex", gap: 4 }} role="group" aria-label="Table linen">
          <button type="button" aria-pressed={linen === "none"} style={segmentStyle(linen === "none")}
            onClick={() => { if (clothed) placement().toggleCloth(objectId); }}>
            None
          </button>
          <button type="button" aria-pressed={linen === "white"} style={segmentStyle(linen === "white")}
            onClick={() => { placement().applyTableCloth(new Set([objectId]), "white"); }}>
            White
          </button>
          <button type="button" aria-pressed={linen === "black"} style={segmentStyle(linen === "black")}
            onClick={() => { placement().applyTableCloth(new Set([objectId]), "black"); }}>
            Black
          </button>
        </div>
      </div>

      {dining && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={rowLabelStyle}>Place setting</span>
            <div style={{ display: "flex", gap: 4 }} role="group" aria-label="Place setting">
              <button type="button" aria-pressed={tableSetting === null} style={segmentStyle(tableSetting === null)}
                onClick={() => { placement().clearTableSetting(objectId); }}>
                None
              </button>
              <button type="button" aria-pressed={tableSetting === "dinner"} style={segmentStyle(tableSetting === "dinner")}
                onClick={() => { placement().applyTableSetting(new Set([objectId]), "dinner"); }}>
                Dinner
              </button>
            </div>
          </div>

          <label style={{ display: "block", marginBottom: 8 }}>
            <span style={{ ...rowLabelStyle, display: "block", marginBottom: 3 }}>Chair style</span>
            <input
              type="text"
              value={chairDraft}
              maxLength={MAX_CHAIR_STYLE}
              placeholder="e.g. Chiavari gold, house banquet"
              onChange={(e) => { setChairDraft(e.target.value); }}
              onBlur={commitChair}
              onKeyDown={onEnterBlur}
              style={dressingInputStyle}
            />
          </label>

          <label style={{ display: "block" }}>
            <span style={{ ...rowLabelStyle, display: "block", marginBottom: 3 }}>Centrepiece</span>
            <input
              type="text"
              value={centerpieceDraft}
              maxLength={MAX_CENTERPIECE}
              placeholder="e.g. low white florals, candelabra"
              onChange={(e) => { setCenterpieceDraft(e.target.value); }}
              onBlur={commitCenterpiece}
              onKeyDown={onEnterBlur}
              style={dressingInputStyle}
            />
          </label>
        </>
      )}
    </div>
  );
}

export function ObjectNotePanel(): React.ReactElement | null {
  const selectedId = useEditorStore((s) => s.selectedObjectId);
  const timelinePreviewActive = useLayoutTimelinePreviewStore((state) => state.mode !== "inactive");
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

  // Keep the component mounted so an in-progress note draft survives a
  // preview, but remove its editing surface while the scene is read-only.
  if (timelinePreviewActive || selectedId === null || savedNotes === null) return null;

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
      aria-label="Selected object dressing and note"
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
      <DressingSection objectId={selectedId} />

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
