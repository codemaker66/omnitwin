import { useMemo, useState, type ReactElement } from "react";
import { Armchair, Box, Building2, ChevronDown, Circle, Layers3, Plus, Search } from "lucide-react";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useSelectionStore } from "../../../stores/selection-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useLayoutTimelinePreviewStore } from "../../../stores/layout-timeline-preview-store.js";
import { getGroupMemberIds } from "../../../lib/placement.js";
import { dispatchPlannerToolbarCommand } from "../../../lib/planner-toolbar-events.js";
import { referenceCategoryLabel, referenceEntryMatches, referenceSceneEntries, referenceSceneSummary, type ReferenceSceneEntry } from "../../../lib/reference-scene-model.js";
import "./ReferencePanels.css";

interface OutlinerCategoryProps {
  readonly category: string;
  readonly entries: readonly ReferenceSceneEntry[];
  readonly selectedIds: ReadonlySet<string>;
  readonly locked: boolean;
  readonly searching: boolean;
}

function selectEntry(entry: ReferenceSceneEntry): void {
  if (useLayoutTimelinePreviewStore.getState().mode !== "inactive") return;
  const items = usePlacementStore.getState().placedItems;
  useSelectionStore.getState().selectMultiple([...getGroupMemberIds(entry.item.id, items)]);
}

function OutlinerCategory({ category, entries, selectedIds, locked, searching }: OutlinerCategoryProps): ReactElement {
  const Icon = category === "chair" ? Armchair : category === "table" ? Circle : Box;
  return (
    <details className="reference-tree-category" key={`${category}-${String(searching)}`} open={searching || category === "table"}>
      <summary><ChevronDown size={13} /><Icon size={14} /><span>{referenceCategoryLabel(category)}</span><span className="reference-count">{entries.length}</span></summary>
      <ul className="reference-tree-items">
        {entries.map((entry) => (
          <li key={entry.item.id}>
            <button type="button" className="reference-tree-item" disabled={locked} aria-pressed={selectedIds.has(entry.item.id)}
              data-furniture-id={entry.item.id}
              aria-label={entry.label}
              title={entry.item.groupId === null ? entry.label : `${entry.label} · selects its furniture group`}
              onClick={() => { selectEntry(entry); }}>
              <Icon size={12} /><span>{entry.shortLabel}</span>
              {entry.item.groupId !== null && <Layers3 size={12} className="reference-tree-group" aria-label="Grouped furniture" />}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function SceneOutliner({ className = "" }: { readonly className?: string }): ReactElement {
  const items = usePlacementStore((state) => state.placedItems);
  const selectedIds = useSelectionStore((state) => state.selectedIds);
  const previewMode = useLayoutTimelinePreviewStore((state) => state.mode);
  const previewItems = useLayoutTimelinePreviewStore((state) => state.currentItems);
  const previewRuntime = useLayoutTimelinePreviewStore((state) => state.activeVenueRuntime);
  const previewMessage = useLayoutTimelinePreviewStore((state) => state.unavailableMessage);
  const runtime = useCockpitStore((state) => state.runtimeAssetStatus);
  const [search, setSearch] = useState("");
  const locked = previewMode !== "inactive";
  const entries = useMemo(() => referenceSceneEntries(locked ? previewItems : items), [items, locked, previewItems]);
  const summary = useMemo(() => referenceSceneSummary(entries), [entries]);
  const filtered = useMemo(() => entries.filter((entry) => referenceEntryMatches(entry, search)), [entries, search]);
  const categories = [...new Set(entries.map((entry) => entry.category))].sort((a, b) => {
    const priority = (category: string): number => category === "table" ? 0 : category === "chair" ? 1 : 2;
    return priority(a) - priority(b) || a.localeCompare(b);
  });
  return (
    <aside className={`reference-panel reference-scene-outliner ${className}`} aria-label="Scene layers" data-testid="reference-scene-outliner">
      <header className="reference-panel-heading"><Layers3 size={15} /><h2>Layers</h2><span className="reference-count">{summary.objects}</span></header>
      <label className="reference-search"><Search size={14} /><input type="search" aria-label="Search scene objects" placeholder="Search layers" value={search} onChange={(event) => { setSearch(event.target.value); }} /></label>
      <div className="reference-panel-scroll">
        <details className="reference-tree-category reference-architecture" open>
          <summary><ChevronDown size={13} /><Building2 size={14} /><span>Architecture</span></summary>
          <div className="reference-capture-label"><span>{locked ? previewRuntime === null ? "Room preview unavailable" : "Frozen room outline" : "Room capture"}</span><small>{locked ? previewRuntime === null ? previewMessage ?? "No frozen room snapshot" : "Historical layout preview" : runtime}</small></div>
        </details>
        <div className="reference-section-caption">{locked ? "Phase furniture · read only" : "Furniture"}</div>
        {categories.map((category) => {
          const matching = filtered.filter((entry) => entry.category === category);
          return matching.length === 0 ? null : <OutlinerCategory key={category} category={category} entries={matching} selectedIds={locked ? new Set<string>() : selectedIds} locked={locked} searching={search.trim().length > 0} />;
        })}
        {filtered.length === 0 && <p className="reference-muted">{entries.length === 0 ? "No furniture in this layout." : "No matching objects."}</p>}
      </div>
      <footer className="reference-panel-footer"><span>{summary.tables} tables · {summary.chairs} chairs · {summary.groups} groups</span>
        <button type="button" className="reference-action" disabled={locked} onClick={() => { if (useLayoutTimelinePreviewStore.getState().mode === "inactive") dispatchPlannerToolbarCommand("open-furniture"); }}><Plus size={14} />Add furniture</button>
      </footer>
    </aside>
  );
}
