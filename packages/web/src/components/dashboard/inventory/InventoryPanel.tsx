import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { ArrowUpRight, List, MapPin, Search, SlidersHorizontal } from "lucide-react";
import type { InventoryStock } from "@omnitwin/types";
import { useAuthStore } from "../../../stores/auth-store.js";
import { listVenueInventory, type VenueInventoryData, type VenueInventoryItem } from "../../../api/venue-inventory.js";
import { InventoryEditor, type InventoryEditorHandle } from "./InventoryEditor.js";
import { InventoryDemand } from "./InventoryDemand.js";
import { InventoryImpact, InventoryRemedyShortcut } from "./InventoryImpact.js";
import { InventoryPicture } from "./InventoryPicture.js";
import { ActivityStatus } from "../../shared/Activity.js";
import { inventoryErrorMessage } from "./inventory-form.js";
import "./InventoryPanel.css";
import "./InventoryStyle.css";

function StockFigures({ item }: { readonly item: VenueInventoryItem }): ReactElement {
  return <dl className="inventory-hero-numbers"><div><dd>{item.stock?.ownedQuantity.toLocaleString("en-GB") ?? "—"}</dd><dt>Owned</dt></div>
    <div><dd>{item.stock?.damagedQuantity.toLocaleString("en-GB") ?? "—"}</dd><dt>Damaged</dt></div>
    <div><dd>{item.stock?.unavailableQuantity.toLocaleString("en-GB") ?? "—"}</dd><dt>Other unavailable</dt></div></dl>;
}

function InventoryWorkspace({ actorId, venueId }: { readonly actorId: string; readonly venueId: string }): ReactElement {
  const [data, setData] = useState<VenueInventoryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [storage, setStorage] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(true);
  const [showList, setShowList] = useState(false);
  const editor = useRef<InventoryEditorHandle>(null);
  useEffect(() => {
    const controller = new AbortController(); setError(null); setLoading(true);
    void listVenueInventory(venueId, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setData(result);
      setSelectedId((current) => result.items.some((item) => item.catalogue.id === current) ? current :
        (result.items.find((item) => item.stock !== null)?.catalogue.id ?? result.items[0]?.catalogue.id ?? null));
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(inventoryErrorMessage(failure));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); };
  }, [venueId, retry]);
  const items = useMemo(() => (data?.items ?? []).filter((item) =>
    (filter !== "unrecorded" || item.stock === null) &&
    (filter !== "damaged" || (item.stock?.damagedQuantity ?? 0) > 0) &&
    (filter !== "retired" || item.stock?.status === "retired") &&
    (storage === "" || item.stock?.storageLocation === storage) &&
    `${item.catalogue.name} ${item.catalogue.category} ${item.stock?.storageLocation ?? ""}`.toLocaleLowerCase("en-GB")
      .includes(query.toLocaleLowerCase("en-GB").trim())), [data, query, filter, storage]);
  const locations = useMemo(() => Array.from(new Set((data?.items ?? []).flatMap((item) =>
    item.stock?.storageLocation !== null && item.stock?.storageLocation !== undefined && item.stock.storageLocation !== "" ? [item.stock.storageLocation] : []))).sort(), [data]);
  const selected = data?.items.find((item) => item.catalogue.id === selectedId) ?? null;
  const onSaved = (stock: InventoryStock): void => {
    setData((current) => current === null ? null : { ...current, items: current.items.map((item) =>
      item.catalogue.id === stock.assetDefinitionId ? { ...item, stock } : item) });
  };
  const select = (item: VenueInventoryItem): void => {
    const accepted = (): void => { setSelectedId(item.catalogue.id); setEditorOpen(true); };
    if (item.catalogue.id === selectedId) { setEditorOpen(true); return; }
    if (editor.current !== null) editor.current.requestClose(accepted);
    else accepted();
  };
  const closeEditor = (): void => { setEditorOpen(false); setRetry((value) => value + 1); };
  const secondary = items.filter((item) => item.catalogue.id !== selectedId).slice(0, 2);
  const count = data?.items.length ?? 0;

  return <section className="inventory-panel" aria-labelledby="inventory-title">
    {error !== null ? <section className="inventory-state" role="alert"><h1 id="inventory-title">Inventory</h1><h2>Inventory could not be loaded</h2>
      <p>{error}</p><button type="button" className="inventory-button" onClick={() => { setRetry((value) => value + 1); }}>Try again</button></section> :
      data === null ? <div className="inventory-state"><h1 id="inventory-title">Inventory</h1><ActivityStatus variant="panel">Opening inventory</ActivityStatus>
        <p>Reading your venue’s recorded furniture and equipment.</p></div> :
      <InventoryDemand actorId={actorId} venueId={venueId} refreshKey={data.items.map((item) => `${item.catalogue.id}:${String(item.stock?.revision ?? "unrecorded")}`).join("|")}>
        {(demand) => <div className="inventory-workspace">
          <div className="inventory-equipment-sheet">
            <header className="inventory-header"><h1 id="inventory-title">Inventory</h1>
              <button type="button" className="inventory-button inventory-button--quiet" aria-expanded={showList}
                aria-controls="inventory-catalogue" onClick={() => { setShowList((value) => !value); }}>
                {count} {count === 1 ? "item" : "items"}<List size={18} /></button></header>
            <div className="inventory-tools"><label className="inventory-search"><Search size={18} strokeWidth={1.5} />
              <span className="inventory-sr-only">Find furniture or equipment</span><input type="search" value={query}
                placeholder="Find furniture or equipment" onChange={(event) => { setQuery(event.target.value); setShowList(true); }} /></label>
              <details className="inventory-filters"><summary><SlidersHorizontal size={18} /><span>Filter</span></summary>
                <div><label className="inventory-field"><span>Stock status</span><select value={filter} onChange={(event) => { setFilter(event.target.value); setShowList(true); }}>
                  <option value="all">All stock</option><option value="unrecorded">Not recorded</option><option value="damaged">Damaged stock</option><option value="retired">Retired stock</option></select></label>
                  <label className="inventory-field"><span>Storage filter</span><select value={storage} onChange={(event) => { setStorage(event.target.value); setShowList(true); }}>
                    <option value="">All storage</option>{locations.map((location) => <option key={location}>{location}</option>)}</select></label>
                  <button type="button" className="inventory-button" onClick={() => { setFilter("all"); setStorage(""); setQuery(""); }}>Clear filters</button></div></details></div>
            {loading ? <ActivityStatus>Refreshing stock…</ActivityStatus> : null}
            {selected === null ? <section className="inventory-state"><h2>Your catalogue is empty</h2>
              <p>Add furniture and equipment to your venue’s catalogue before recording stock.</p></section> : <>
              <div className="inventory-featured-item"><InventoryPicture name={selected.catalogue.name} hero />
                <div className="inventory-featured-copy"><h2>{selected.catalogue.name}</h2>
                  <p className="inventory-location"><MapPin size={16} />{selected.stock?.storageLocation ?? "Storage not recorded"}</p>
                  {selected.stock?.status === "retired" ? <p className="inventory-stock-status">Retired · excluded from use</p> : null}
                  {selected.stock === null ? <p>Physical stock not recorded</p> : null}<StockFigures item={selected} />
                  <button type="button" className="inventory-button inventory-button--quiet" aria-label={`${selected.stock === null ? "Record" : "Adjust"} ${selected.catalogue.name}`}
                    onClick={() => { setEditorOpen(true); requestAnimationFrame(() => {
                      const pane = document.getElementById("inventory-correction");
                      pane?.scrollIntoView({ block: "nearest" }); pane?.querySelector("input")?.focus();
                    }); }}>
                    {selected.stock === null ? "Record stock" : "Correct stock"}<ArrowUpRight size={16} /></button></div>
              {secondary.length > 0 ? <div className="inventory-secondary-items">{secondary.map((item) => <button type="button"
                className="inventory-equipment-choice" key={item.catalogue.id} aria-label={`${item.stock === null ? "Record" : "Adjust"} ${item.catalogue.name}`}
                onClick={() => { select(item); }}><InventoryPicture name={item.catalogue.name} />
                <span><strong>{item.catalogue.name}</strong><span>{item.stock === null ? "Not recorded" : `${item.stock.ownedQuantity.toLocaleString("en-GB")} owned`}</span></span></button>)}</div> : null}
              </div>
            </>}
            <div id="inventory-catalogue" className="inventory-catalogue" hidden={!showList}>
              <p className="inventory-result-count" aria-live="polite">{items.length} matching {items.length === 1 ? "item" : "items"}</p>
              {items.length === 0 ? <p>No matching items. Try another name, category or storage location.</p> :
                <ul>{items.map((item) => <li key={item.catalogue.id}><button type="button" aria-pressed={item.catalogue.id === selectedId}
                  onClick={() => { select(item); }}><span><strong>{item.catalogue.name}</strong><small>{item.stock?.storageLocation ?? "Storage not recorded"}</small></span>
                  <span>{item.stock?.ownedQuantity.toLocaleString("en-GB") ?? "Not recorded"}<ArrowUpRight size={16} /></span></button></li>)}</ul>}
            </div>
          </div>
          <InventoryImpact demand={demand} assetId={selectedId} />
          <aside className="inventory-correction-pane" id="inventory-correction" aria-label="Stock correction workspace">
            {selected !== null && editorOpen ? <InventoryEditor key={selected.catalogue.id} ref={editor} presentation="inline" actorId={actorId} venueId={venueId}
              item={selected} onClose={closeEditor} onSaved={onSaved} remedies={<InventoryRemedyShortcut demand={demand}
                item={demand.assessment?.items.find((item) => item.assetDefinitionId === selectedId)} />} /> :
              <div className="inventory-editor inventory-editor--rest"><h2>Everything in its place</h2><p>Select a piece of equipment to review its counts and record a correction.</p>
                {selected !== null ? <button type="button" className="inventory-button inventory-button--primary" onClick={() => { setEditorOpen(true); }}>Open stock correction</button> : null}</div>}
          </aside>
        </div>}
      </InventoryDemand>}
  </section>;
}

export function InventoryPanel(): ReactElement {
  const user = useAuthStore((state) => state.user);
  if (user?.role !== "admin" || user.venueId === null) return <section className="inventory-panel inventory-state" role="alert">
    <h1>Venue administrator access required</h1><p>Inventory belongs to the venue assigned to your administrator account.</p></section>;
  return <InventoryWorkspace key={`${user.id}:${user.venueId}`} actorId={user.id} venueId={user.venueId} />;
}
