import { useMemo, useRef, useState, type ReactElement } from "react";
import { Armchair, LayoutGrid, Plus, RotateCcw, SlidersHorizontal, Trash2, X } from "lucide-react";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useSelectionStore } from "../../../stores/selection-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useLayoutTimelinePreviewStore } from "../../../stores/layout-timeline-preview-store.js";
import { useAutoFillRequestStore } from "../../../stores/auto-fill-request-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { toRealWorld, toRenderSpace } from "../../../constants/scale.js";
import { normalizeFurnitureScale } from "../../../lib/furniture-scale.js";
import { SCALE_MIN, SCALE_MAX } from "../../../lib/planner-tools.js";
import { canApplyTableLinenToItem, effectiveTableLinenStyle, isDiningTableItem } from "../../../lib/furniture-semantics.js";
import { dispatchPlannerToolbarCommand } from "../../../lib/planner-toolbar-events.js";
import { useEscapeLayer } from "../../../lib/planner-keys.js";
import { asOneUndoStep } from "../../../lib/planner-keymap.js";
import { referenceSceneEntries, referenceSceneSummary, referenceSelection, type ReferenceSceneEntry } from "../../../lib/reference-scene-model.js";
import { floorNames, withFloorNames } from "../../../lib/floor-names.js";
import { countLabel } from "../../../lib/count-label.js";
import { EVENT_KIND_WORDS, layOutStyleFor } from "../../../lib/event-kind-record.js";
import { usePlannerEventStore } from "../../../stores/planner-event-store.js";
import "./ReferencePanels.css";

interface NumberControlProps {
  readonly label: string;
  readonly value: number;
  readonly step: number;
  readonly min?: number;
  readonly max?: number;
  readonly onCommit: (value: number) => void;
}

function NumberControl({ label, value, step, min, max, onCommit }: NumberControlProps): ReactElement {
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // A typed value not yet committed is an operation in progress: Escape puts
  // the committed value back and leaves the field, before it steps back any
  // further (the selection stays). With nothing typed, Escape passes on.
  useEscapeLayer("operation", {
    open: () => {
      const input = inputRef.current;
      return input !== null && document.activeElement === input && input.value !== String(value);
    },
    onEscape: () => {
      const input = inputRef.current;
      if (input === null) return;
      input.value = String(value);
      input.blur();
    },
  });
  return <label className="reference-number-control"><span>{label}</span>
    <input ref={inputRef} key={value} aria-label={label} type="number" defaultValue={value} step={step} min={min} max={max} aria-invalid={error !== null}
      onBlur={(event) => {
        const next = event.currentTarget.valueAsNumber;
        if (!Number.isFinite(next) || (min !== undefined && next < min) || (max !== undefined && next > max)) {
          event.currentTarget.value = String(value);
          setError(min !== undefined && max !== undefined ? `Use ${String(min)}–${String(max)}.` : "Enter a finite number.");
          return;
        }
        setError(null);
        if (Math.abs(next - value) > 1e-9) onCommit(next);
      }}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
    {error !== null && <small role="alert">{error}</small>}
  </label>;
}

function NumberFact({ label, value }: { readonly label: string; readonly value: string }): ReactElement {
  return <div className="reference-fact"><dt>{label}</dt><dd>{value}</dd></div>;
}

function InspectorOverview({ primary, members }: { readonly primary: ReferenceSceneEntry; readonly members: readonly ReferenceSceneEntry[] }): ReactElement {
  const catalogue = primary.catalogue;
  const scale = normalizeFurnitureScale(primary.item.scale);
  return <section className="reference-inspector-section"><h3>Overview</h3><dl>
    <NumberFact label="Type" value={catalogue?.name ?? "Not in the catalogue"} />
    {catalogue !== undefined && <>
      <NumberFact label={catalogue.tableShape === "round" ? "Diameter" : "Width"} value={`${(catalogue.width * scale).toFixed(2)} m`} />
      {catalogue.tableShape !== "round" && <NumberFact label="Depth" value={`${(catalogue.depth * scale).toFixed(2)} m`} />}
      <NumberFact label="Height" value={`${(catalogue.height * scale).toFixed(2)} m`} />
    </>}
    <NumberFact label="Pieces" value={countLabel(members.length, "piece")} />
    <NumberFact label="Seats" value={String(members.filter((entry) => entry.category === "chair").length)} />
  </dl>{catalogue?.dimensionStatus === "approximate" && <p className="reference-muted">Approximate planning dimensions · confirm before final setup.</p>}</section>;
}

function InspectorTransforms({ primary, members, ids }: {
  readonly primary: ReferenceSceneEntry; readonly members: readonly ReferenceSceneEntry[]; readonly ids: ReadonlySet<string>;
}): ReactElement {
  const item = primary.item;
  const scale = normalizeFurnitureScale(item.scale);
  const group = members.length > 1;
  const move = (axis: "x" | "z", metres: number): void => {
    asOneUndoStep(() => { usePlacementStore.getState().moveItemsByDelta(ids, axis === "x" ? toRenderSpace(metres) - item.x : 0, axis === "z" ? toRenderSpace(metres) - item.z : 0); });
  };
  const rotate = (degrees: number): void => {
    const delta = degrees * Math.PI / 180 - item.rotationY;
    asOneUndoStep(() => { usePlacementStore.getState().rotateItemsTo(new Map(members.map((entry) => [entry.item.id, entry.item.rotationY + delta]))); });
  };
  // Catalogue pieces are the hall's own stock at their real size (spec D10):
  // nothing in the hall changes size, so only a piece outside the catalogue
  // can be resized. A legacy layout keeps its stored scale; it is named and
  // can be put back to the real size in one step.
  const resizable = members.length > 0 && members.every((entry) => entry.catalogue === undefined);
  const offSize = members.filter((entry) => entry.catalogue !== undefined && Math.abs(normalizeFurnitureScale(entry.item.scale) - 1) > 1e-6);
  const scales = members.map((entry) => normalizeFurnitureScale(entry.item.scale));
  const minPercent = Math.ceil(SCALE_MIN / Math.min(...scales) * scale * 100);
  const maxPercent = Math.floor(SCALE_MAX / Math.max(...scales) * scale * 100);
  const resize = (percent: number): void => {
    const ratio = percent / 100 / scale;
    asOneUndoStep(() => { usePlacementStore.getState().scaleItemsTo(new Map(members.map((entry) => [entry.item.id, normalizeFurnitureScale(entry.item.scale) * ratio]))); });
  };
  return <section className="reference-inspector-section"><h3>Transform</h3>
    <div className="reference-position-controls">
      <NumberControl label="X (m)" value={Number(toRealWorld(item.x).toFixed(3))} step={0.01} onCommit={(value) => { move("x", value); }} />
      <NumberControl label="Z (m)" value={Number(toRealWorld(item.z).toFixed(3))} step={0.01} onCommit={(value) => { move("z", value); }} />
    </div>
    <dl><NumberFact label="Surface height" value={`${item.y.toFixed(3)} m`} /></dl>
    <NumberControl label={group ? "Piece rotation (°)" : "Rotation (°)"} value={Number((item.rotationY * 180 / Math.PI).toFixed(1))} step={1} onCommit={rotate} />
    {resizable && <NumberControl label={group ? "Piece size (%)" : "Size (%)"} value={Number((scale * 100).toFixed(1))} step={1} min={minPercent} max={maxPercent} onCommit={resize} />}
    {offSize.length > 0 && <div data-testid="reference-off-size">
      <p className="reference-muted">{offSize.length === 1 && offSize[0] !== undefined
        ? `Drawn at ${String(Math.round(normalizeFurnitureScale(offSize[0].item.scale) * 100))}% of its real size.`
        : `${countLabel(offSize.length, "piece")} drawn away from their real size.`}</p>
      <button type="button" className="reference-action" onClick={() => { asOneUndoStep(() => { usePlacementStore.getState().scaleItemsTo(new Map(offSize.map((entry) => [entry.item.id, 1]))); }); }}>
        <RotateCcw size={14} aria-hidden="true" />Reset to the real size
      </button>
    </div>}
    {group && <p className="reference-muted">Position moves the whole group; turning applies to each piece.</p>}
  </section>;
}

function InspectorStyle({ primary }: { readonly primary: ReferenceSceneEntry }): ReactElement | null {
  const catalogue = primary.catalogue;
  if (catalogue === undefined || catalogue.category !== "table") return null;
  const item = primary.item;
  const linen = effectiveTableLinenStyle(catalogue, item);
  const setLinen = (value: string): void => { asOneUndoStep(() => {
    const placement = usePlacementStore.getState();
    if (value === "none") { if (item.clothed) placement.toggleCloth(item.id); }
    else if (value === "white" || value === "black") placement.applyTableCloth(new Set([item.id]), value);
  }); };
  return <section className="reference-inspector-section"><h3>Style</h3>
    {canApplyTableLinenToItem(catalogue) ? <label className="reference-select-control"><span>Linen</span><select aria-label="Table linen" value={linen ?? "none"} onChange={(event) => { setLinen(event.target.value); }}>
      <option value="none">Bare table</option><option value="white">Ivory</option><option value="black">Black</option>
    </select></label> : <dl><NumberFact label="Linen" value={`${linen === "white" ? "Ivory" : linen === "included" ? "Included cloth" : "Black"} · catalogue variant`} /></dl>}
    {isDiningTableItem(catalogue) && <label className="reference-select-control"><span>Place settings</span><select aria-label="Table place settings" value={item.tableSetting ?? "none"} onChange={(event) => { const value = event.target.value; asOneUndoStep(() => {
      if (value === "dinner") usePlacementStore.getState().applyTableSetting(new Set([item.id]), "dinner");
      else usePlacementStore.getState().clearTableSetting(item.id);
    }); }}><option value="none">None</option><option value="dinner">Dinner</option></select></label>}
  </section>;
}

function openCatalogue(): void {
  if (useLayoutTimelinePreviewStore.getState().mode === "inactive") dispatchPlannerToolbarCommand("open-furniture");
}

function layOutForGuests(): void {
  if (useLayoutTimelinePreviewStore.getState().mode !== "inactive") return;
  // The event's shape: rows of seats for a corporate event, round tables otherwise (T-674).
  useAutoFillRequestStore.getState().request(layOutStyleFor(usePlannerEventStore.getState().eventKind));
  useCockpitStore.getState().setMode("guests");
}

function EmptyInspector({ entries, roomName }: { readonly entries: readonly ReferenceSceneEntry[]; readonly roomName: string }): ReactElement {
  const eventKind = usePlannerEventStore((state) => state.eventKind);
  // An empty floor says once where to start, and shows no zeros (A-15); once the planner knows the event, it names it.
  if (entries.length === 0) {
    const layOut = eventKind === null ? "lay out for your guests" : EVENT_KIND_WORDS[eventKind].layOut;
    const layOutName = layOutStyleFor(eventKind) === "theatre" ? "Lay out rows of seats for your guests" : "Lay out tables and seats for your guests";
    return <div className="reference-empty-inspector" data-testid="reference-empty-floor"><Armchair size={28} strokeWidth={1} aria-hidden="true" /><h3>{roomName}</h3>
      <p>Nothing on the floor yet. Add a table, or {layOut}.</p>
      <button className="reference-action" type="button" onClick={openCatalogue}><Plus size={14} aria-hidden="true" />Add a table</button>
      <button className="reference-action" type="button" aria-label={layOutName} onClick={layOutForGuests}><LayoutGrid size={14} aria-hidden="true" />Lay out</button>
    </div>;
  }
  const summary = referenceSceneSummary(entries);
  return <div className="reference-empty-inspector"><Armchair size={28} strokeWidth={1} aria-hidden="true" /><h3>{roomName}</h3><p>Select a table or piece to change it.</p>
    <dl><NumberFact label="Tables" value={String(summary.tables)} /><NumberFact label="Seats" value={String(summary.chairs)} /><NumberFact label="Pieces" value={String(summary.objects)} /></dl>
    <button className="reference-action" type="button" onClick={openCatalogue}><Plus size={14} aria-hidden="true" />Add furniture</button>
  </div>;
}

export function SelectedFurnitureInspector({ className = "" }: { readonly className?: string }): ReactElement {
  const items = usePlacementStore((state) => state.placedItems);
  const selectedIds = useSelectionStore((state) => state.selectedIds);
  const roomName = useEditorStore((state) => state.space?.name ?? "Room layout");
  const previewMode = useLayoutTimelinePreviewStore((state) => state.mode);
  const entries = useMemo(() => withFloorNames(referenceSceneEntries(items), floorNames(items)), [items]);
  const selection = useMemo(() => referenceSelection(entries, selectedIds), [entries, selectedIds]);
  const primary = selection.primary;
  const locked = previewMode !== "inactive";
  return <aside className={`reference-panel reference-furniture-inspector ${className}`} aria-label="Furniture inspector" data-testid="reference-furniture-inspector">
    <header className="reference-panel-heading"><SlidersHorizontal size={15} /><h2>{locked ? "Phase preview" : primary?.label ?? "Details"}</h2>
      {!locked && primary !== undefined && <button type="button" className="reference-icon-button" aria-label="Clear furniture selection" onClick={() => { useSelectionStore.getState().clearSelection(); }}><X size={15} /></button>}
    </header>
    <div className="reference-panel-scroll">
      {locked ? <div className="reference-empty-inspector"><h3>Editing is paused</h3><p>Return to the saved plan to edit.</p></div> : primary === undefined ? <EmptyInspector entries={entries} roomName={roomName} /> : <>
        <InspectorOverview primary={primary} members={selection.members} />
        <InspectorTransforms key={primary.item.id} primary={primary} members={selection.members} ids={selection.ids} />
        <InspectorStyle primary={primary} />
      </>}
    </div>
    {!locked && primary !== undefined && <footer className="reference-panel-footer"><button type="button" className="reference-action reference-action-danger" onClick={() => { asOneUndoStep(() => { usePlacementStore.getState().removeItems(selection.ids); useSelectionStore.getState().clearSelection(); }); }}><Trash2 size={14} aria-hidden="true" />{selection.members.length > 1 ? `Remove ${countLabel(selection.members.length, "piece")}` : "Remove this piece"}</button></footer>}
  </aside>;
}
