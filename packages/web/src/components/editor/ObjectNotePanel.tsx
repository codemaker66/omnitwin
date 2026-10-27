import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { isLayoutTimelineMutationLocked } from "../../lib/layout-timeline-preview-lock.js";
import { useLayoutTimelinePreviewStore } from "../../stores/layout-timeline-preview-store.js";
import { getCatalogueItem } from "../../lib/catalogue.js";
import { canApplyTableLinenToItem, isDiningTableItem } from "../../lib/furniture-semantics.js";
import { GOLD, BORDER, CARD_BG, TEXT_SEC, TEXT_MUT } from "../../constants/ui-palette.js";
import { ActivityStatus } from "../shared/Activity.js";
import { useOnlineStatus } from "../../hooks/use-online-status.js";
import type { EditorObject } from "../../stores/editor-store.js";

// ---------------------------------------------------------------------------
// ObjectNotePanel — the note for the hallkeeper on the selected table (or
// the one piece selected), with the table's dressing.
//
// The note propagates through the editor store → auto-save batch →
// placed_objects.metadata.notes → manifest row notes → PDF + tablet
// display. One sentence of text becomes operational context for the
// hallkeeper on the day of the event ("this table is VIP", "HDMI
// cable routes through here", "keep chair at exact angle").
//
// The note is never lost (approved spec 4.5, QoL B-04/C-14): it saves as you
// type, 400 ms after the last keystroke, and at once on blur, on a change of
// selection and on unmount. With several pieces selected it belongs to the
// table of the selection's unit, never to whichever id came first (often a
// chair); with several tables, or none, the panel says so and takes no note.
//
// Privacy: the note is written only through the editor store's
// setObjectNotes, the one recorded path. That path also lands the text in the
// layout's action log, as it did before; the redaction the log still needs
// lives outside this file (T-674 v1-hardening report).
// ---------------------------------------------------------------------------

const MAX_NOTE = 500;
/** Typing pause after which the note is written into the layout. */
export const NOTE_SAVE_DELAY_MS = 400;
const MAX_CHAIR_STYLE = 40;
const MAX_CENTERPIECE = 80;

const segmentStyle = (active: boolean): React.CSSProperties => ({
  padding: "5px 10px", fontSize: 11, fontWeight: active ? 700 : 500,
  background: active ? "rgba(201, 138, 91,0.16)" : "transparent",
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
  fontSize: 11, fontWeight: 600, letterSpacing: "0.06em",
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
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: GOLD, textTransform: "uppercase", marginBottom: 8 }}>
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

type NoteTarget =
  | { readonly kind: "piece"; readonly id: string }
  | { readonly kind: "many-tables" }
  | { readonly kind: "no-table" };

/**
 * Which piece the note belongs to. The tables in the selection, or in the
 * group of anything selected, are counted by unit (a table group, or a set of
 * trestles sharing one group). One unit: its table, the one already holding a
 * note first. Several units: no target. No table: the one piece selected, or
 * no target when several are.
 */
export function noteTargetFor(
  objects: readonly Pick<EditorObject, "id" | "assetDefinitionId" | "groupId" | "notes">[],
  selectedIds: ReadonlySet<string>,
): NoteTarget | null {
  const selected = objects.filter((object) => selectedIds.has(object.id));
  if (selected.length === 0) return null;
  const groups = new Set(selected.flatMap((object) => object.groupId === null ? [] : [object.groupId]));
  const tables = objects.filter((object) => getCatalogueItem(object.assetDefinitionId)?.category === "table"
    && (selectedIds.has(object.id) || (object.groupId !== null && groups.has(object.groupId))));
  const units = new Set(tables.map((table) => table.groupId ?? table.id));
  if (units.size > 1) return { kind: "many-tables" };
  const table = tables.find((candidate) => candidate.notes.trim().length > 0) ?? tables[0];
  if (table !== undefined) return { kind: "piece", id: table.id };
  const only = selected.length === 1 ? selected[0] : undefined;
  return only === undefined ? { kind: "no-table" } : { kind: "piece", id: only.id };
}

function targetCode(target: NoteTarget | null): string {
  return target === null ? "" : target.kind === "piece" ? `piece:${target.id}` : target.kind;
}

function targetFromCode(code: string): NoteTarget | null {
  if (code === "") return null;
  if (code === "many-tables" || code === "no-table") return { kind: code };
  return { kind: "piece", id: code.slice("piece:".length) };
}

interface PendingNote {
  readonly id: string;
  readonly text: string;
}

/** Writes the note into the layout unless it already holds that text.
 *  False while a frozen phase preview refuses writes. */
function writeNote(pending: PendingNote): boolean {
  if (isLayoutTimelineMutationLocked()) return false;
  const editor = useEditorStore.getState();
  const object = editor.objects.find((candidate) => candidate.id === pending.id);
  if (object === undefined) return true;
  const text = pending.text.trim();
  if (text !== object.notes) editor.setObjectNotes(pending.id, text);
  return true;
}

export function ObjectNotePanel({ embedded = false, mobile = false, viewMode = "3d" }: {
  readonly embedded?: boolean;
  readonly mobile?: boolean;
  readonly viewMode?: "3d" | "2d";
}): React.ReactElement | null {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  // A primitive code keeps the subscription stable across store ticks. The
  // 2D drawing may hold its one selection on the editor store only.
  const code = useEditorStore((s) => targetCode(noteTargetFor(
    s.objects,
    selectedIds.size > 0 || s.selectedObjectId === null ? selectedIds : new Set([s.selectedObjectId]),
  )));
  const target = targetFromCode(code);
  const selectedId = target?.kind === "piece" ? target.id : null;
  const activeMode = useCockpitStore((s) => s.activeMode);
  const placingItemId = useCatalogueStore((s) => mobile ? s.selectedItemId : null);
  const timelinePreviewActive = useLayoutTimelinePreviewStore((state) => state.mode !== "inactive");
  const [dockHost, setDockHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setDockHost(mobile && viewMode === "3d"
      ? document.getElementById("mobile-object-notes")
      : embedded ? document.getElementById("reference-object-notes") : null);
  }, [embedded, mobile, viewMode, code, activeMode, timelinePreviewActive, placingItemId]);
  // Subscribe to the notes primitive only, not the whole object: `.find()`
  // returns a fresh reference on every mutation (drag, rotate, autosave), and
  // the string is Object.is-stable until the note itself changes.
  const savedNotes = useEditorStore((s) => {
    if (selectedId === null) return null;
    const o = s.objects.find((x) => x.id === selectedId);
    return o === undefined ? null : o.notes;
  });
  const layoutDirty = useEditorStore((s) => s.isDirty);
  const layoutSaving = useEditorStore((s) => s.isSaving);
  const layoutSaveFailed = useEditorStore((s) => s.saveError !== null);
  const online = useOnlineStatus();

  const [draft, setDraft] = useState("");
  const [waiting, setWaiting] = useState(false);
  const pending = useRef<PendingNote | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback((): void => {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
    const note = pending.current;
    if (note === null) return;
    // A frozen phase preview refuses writes; the note waits for it to end.
    if (!writeNote(note)) return;
    pending.current = null;
    setWaiting(false);
  }, []);

  // A new target: the previous target's typing is written first (the effect's
  // cleanup, which also runs on unmount), then the field shows the new note.
  // Store ticks that only touch the object never re-seed an open draft.
  useEffect(() => {
    const current = selectedId === null ? undefined : useEditorStore.getState().objects.find((o) => o.id === selectedId);
    setDraft(current?.notes ?? "");
    return flush;
  }, [selectedId, flush]);

  useEffect(() => {
    if (!timelinePreviewActive) flush();
  }, [timelinePreviewActive, flush]);

  const onType = (next: string): void => {
    if (selectedId === null) return;
    setDraft(next);
    pending.current = { id: selectedId, text: next };
    setWaiting(true);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(flush, NOTE_SAVE_DELAY_MS);
  };

  // Keep the component mounted so an in-progress note draft survives a
  // preview, but remove its editing surface while the scene is read-only.
  if (timelinePreviewActive || target === null) return null;
  if (target.kind === "piece" && savedNotes === null) return null;

  const handleClear = (): void => {
    if (selectedId === null || isLayoutTimelineMutationLocked()) return;
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
    pending.current = null;
    setWaiting(false);
    setDraft("");
    useEditorStore.getState().setObjectNotes(selectedId, "");
  };

  const hasNote = (savedNotes ?? "").length > 0;
  const charsLeft = MAX_NOTE - draft.length;
  const inDisclosure = embedded || mobile;
  const unsent = waiting || layoutDirty || layoutSaving;
  const status = !hasNote && !waiting
    ? <>Prints on the function sheet</>
    : !online && unsent
      ? <>Offline · not saved yet</>
      : layoutSaveFailed && unsent
        ? <>Not saved yet</>
        : unsent
          // The 400 ms pause, then the layout's own autosave: work under way.
          ? <ActivityStatus>Saving…</ActivityStatus>
          : <>Saved · prints on the function sheet</>;

  const content = (
    <section
      role="region"
      aria-label="Dressing and note for the hallkeeper"
      style={{
        position: inDisclosure ? "static" : "fixed",
        bottom: 20, right: 20,
        width: inDisclosure ? "auto" : 320, maxWidth: "calc(100vw - 40px)",
        padding: inDisclosure ? "14px 0 0" : 14, borderRadius: inDisclosure ? 0 : 12,
        background: inDisclosure ? "transparent" : CARD_BG,
        border: inDisclosure ? 0 : `1px solid ${BORDER}`,
        boxShadow: inDisclosure ? "none" : "0 10px 30px rgba(0,0,0,0.5)",
        zIndex: 40,
        color: "#ddd",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      {selectedId !== null && <DressingSection objectId={selectedId} />}

      <div id="object-note-label" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: GOLD, textTransform: "uppercase", marginBottom: 8 }}>
        Note for the hallkeeper
      </div>

      {target.kind !== "piece" ? (
        <p role="status" data-testid="object-note-refusal" style={{ margin: 0, fontSize: 12, color: TEXT_SEC, lineHeight: 1.5 }}>
          {target.kind === "many-tables"
            ? "Several tables are selected. Select one table to write its note."
            : "There is no table in this selection. Select a table to write its note."}
        </p>
      ) : (
        <>
          <textarea
            aria-labelledby="object-note-label"
            aria-describedby="object-note-status"
            value={draft}
            onChange={(e) => { onType(e.target.value.slice(0, MAX_NOTE)); }}
            onBlur={flush}
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

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8 }}>
            <div id="object-note-status" data-testid="object-note-status" aria-live="polite" style={{ fontSize: 11, color: TEXT_SEC }}>
              {status}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: charsLeft < 40 ? GOLD : TEXT_MUT }}>
                {charsLeft} left
              </span>
              {(hasNote || draft.length > 0) && (
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
                  Clear note
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
  if (mobile) {
    const disclosure = <details className="mobile-object-notes"><summary>Notes and styling details{waiting ? " · saving" : ""}</summary>{content}</details>;
    // The component remains mounted through view changes, preserving its
    // draft. The 2D view has no 3D action sheet, so it owns a compact fallback.
    if (viewMode === "2d") return <div className="mobile-object-notes-fallback">{disclosure}</div>;
    return dockHost === null ? null : createPortal(disclosure, dockHost);
  }
  if (!embedded) return content;
  return dockHost === null || activeMode !== "design" ? null : createPortal(
    <details className="reference-model-provenance"><summary>Notes and styling details</summary>{content}</details>,
    dockHost,
  );
}
