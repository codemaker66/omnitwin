import { useEffect, useMemo, useState, type ReactElement } from "react";
import { ArrowUpRight, Info, Plus, Search } from "lucide-react";
import type { InventoryStock } from "@omnitwin/types";
import { useAuthStore } from "../../../stores/auth-store.js";
import { listVenueInventory, type VenueInventoryData, type VenueInventoryItem } from "../../../api/venue-inventory.js";
import { InventoryEditor } from "./InventoryEditor.js";
import { inventoryErrorMessage } from "./inventory-form.js";
import "./InventoryPanel.css";

function InventoryLedger({ items, onSelect }: { readonly items: readonly VenueInventoryItem[];
  readonly onSelect: (item: VenueInventoryItem) => void }): ReactElement {
  return <div className="inventory-ledger-wrap"><table className="inventory-ledger">
    <caption className="inventory-sr-only">Physical furniture and equipment stock</caption>
    <thead><tr><th scope="col">Item</th><th scope="col">Owned</th><th scope="col">Damaged</th>
      <th scope="col">Other unavailable</th><th scope="col">Storage</th><th scope="col"><span className="inventory-sr-only">Action</span></th></tr></thead>
    <tbody>{items.map((item) => <tr key={item.catalogue.id}><th scope="row"><span className="inventory-item-name">{item.catalogue.name}</span>
      <span className="inventory-item-category">{item.catalogue.category.toLowerCase() === "av" ? "AV" : item.catalogue.category.replaceAll("_", " ")}{item.stock?.status === "retired" ? " · Retired" : ""}</span></th>
      <td data-label="Owned">{item.stock?.ownedQuantity.toLocaleString("en-GB") ?? <span className="inventory-muted">Not recorded</span>}</td>
      <td data-label="Damaged">{item.stock?.damagedQuantity.toLocaleString("en-GB") ?? "—"}</td>
      <td data-label="Other unavailable">{item.stock?.unavailableQuantity.toLocaleString("en-GB") ?? "—"}</td>
      <td className="inventory-storage" data-label="Storage">{item.stock?.storageLocation ?? "—"}</td>
      <td className="inventory-row-action"><button type="button" className="inventory-button inventory-button--quiet"
        aria-label={`${item.stock === null ? "Record" : "Adjust"} ${item.catalogue.name}`} onClick={() => { onSelect(item); }}>
        {item.stock === null ? "Record" : "Adjust"}<ArrowUpRight size={16} strokeWidth={1.5} /></button></td>
    </tr>)}</tbody></table></div>;
}

function InventoryWorkspace({ actorId, venueId }: { readonly actorId: string; readonly venueId: string }): ReactElement {
  const [data, setData] = useState<VenueInventoryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [unrecordedOnly, setUnrecordedOnly] = useState(false);
  const [selected, setSelected] = useState<VenueInventoryItem | null>(null);
  useEffect(() => {
    const controller = new AbortController(); setError(null);
    void listVenueInventory(venueId, controller.signal).then((result) => {
      if (!controller.signal.aborted) setData(result);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(inventoryErrorMessage(failure));
    });
    return () => { controller.abort(); };
  }, [venueId, retry]);
  const items = useMemo(() => (data?.items ?? []).filter((item) =>
    (!unrecordedOnly || item.stock === null) &&
    `${item.catalogue.name} ${item.catalogue.category} ${item.stock?.storageLocation ?? ""}`.toLocaleLowerCase("en-GB")
      .includes(query.toLocaleLowerCase("en-GB").trim())), [data, query, unrecordedOnly]);
  const onSaved = (stock: InventoryStock): void => {
    setData((current) => current === null ? null : { ...current, items: current.items.map((item) =>
      item.catalogue.id === stock.assetDefinitionId ? { ...item, stock } : item) });
  };
  const unrecordedCount = data?.items.filter((item) => item.stock === null).length ?? 0;

  return <section className="inventory-panel" aria-labelledby="inventory-title">
    <header className="inventory-header"><div><h1 id="inventory-title">Inventory</h1>
      <p>Furniture and equipment, accounted for.</p></div>
      {unrecordedCount > 0 ? <button className="inventory-button inventory-button--primary" type="button"
        onClick={() => { setUnrecordedOnly(true); setQuery(""); }}><Plus size={18} strokeWidth={1.5} />Record stock</button> : null}
    </header>
    {error !== null ? <section className="inventory-state" role="alert"><h2>Inventory could not be loaded</h2>
      <p>{error}</p><button type="button" className="inventory-button" onClick={() => { setRetry((value) => value + 1); }}>Try again</button></section> :
      data === null ? <div className="inventory-state" role="status"><span className="inventory-loading-line" /><h2>Opening inventory</h2>
        <p>Reading your venue’s recorded furniture and equipment.</p></div> : <>
        <div className="inventory-tools"><label className="inventory-search"><Search size={18} strokeWidth={1.5} />
          <span className="inventory-sr-only">Find furniture or equipment</span><input type="search" value={query}
            placeholder="Find furniture or equipment" onChange={(event) => { setQuery(event.target.value); }} /></label>
          {unrecordedOnly ? <button type="button" className="inventory-button inventory-button--quiet"
            onClick={() => { setUnrecordedOnly(false); }}>Show all items</button> : null}
          <p className="inventory-result-count" aria-live="polite">{items.length} {items.length === 1 ? "item" : "items"}{unrecordedOnly ? " to record" : ""}</p>
        </div>
        {items.length === 0 ? <section className="inventory-state"><h2>{data.items.length === 0 ? "Your catalogue is empty" : "No matching items"}</h2>
          <p>{data.items.length === 0 ? "Furniture and equipment must be added to your venue’s catalogue before stock can be recorded." :
            "Try another item name, category or storage location."}</p></section> : <InventoryLedger items={items} onSelect={setSelected} />}
        <aside className="inventory-availability-note"><Info size={19} strokeWidth={1.5} /><p>Booking availability is not connected.
          These are physical stock counts. Event shortages cannot yet be assessed here.</p></aside>
      </>}
    {selected !== null ? <InventoryEditor key={selected.catalogue.id} actorId={actorId} venueId={venueId} item={selected}
      onClose={() => { setSelected(null); setRetry((value) => value + 1); }} onSaved={onSaved} /> : null}
  </section>;
}

export function InventoryPanel(): ReactElement {
  const user = useAuthStore((state) => state.user);
  if (user?.role !== "admin" || user.venueId === null) return <section className="inventory-panel inventory-state" role="alert">
    <h1>Venue administrator access required</h1><p>Inventory belongs to the venue assigned to your administrator account.</p></section>;
  return <InventoryWorkspace key={`${user.id}:${user.venueId}`} actorId={user.id} venueId={user.venueId} />;
}
