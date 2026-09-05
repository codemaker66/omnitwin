import { useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import { z } from "zod";
import { InventoryStockSchema, type InventoryStock, type VenueInventoryReceipt, type VenueInventoryWriteInput } from "@omnitwin/types";
import { ApiError } from "../../../api/client.js";
import { recentVenueInventoryHistory, writeVenueInventory, type VenueInventoryItem,
  type VenueInventoryResult } from "../../../api/venue-inventory.js";
import { useFocusTrap } from "../../../lib/use-focus-trap.js";
import { inventoryDraft, inventoryErrorMessage, inventoryWriteInput, rebaseInventoryDraft, type InventoryDraft } from "./inventory-form.js";
import { InventoryReceipt } from "./InventoryReceipt.js";
import { inventoryPendingKey, readInventoryPending, writeInventoryPending } from "./inventory-pending.js";

interface EditorProps {
  readonly actorId: string;
  readonly venueId: string;
  readonly item: VenueInventoryItem;
  readonly onClose: () => void;
  readonly onSaved: (stock: InventoryStock) => void;
}
const ConflictSchema = z.object({ currentStock: InventoryStockSchema.nullable() });

function QuantityField({ label, value, disabled, onChange }: { readonly label: string; readonly value: string;
  readonly disabled: boolean; readonly onChange: (value: string) => void }): ReactElement {
  return <label className="inventory-field inventory-field--quantity"><span>{label}</span>
    <input type="text" inputMode="numeric" autoComplete="off" value={value} disabled={disabled}
      onChange={(event) => { onChange(event.target.value); }} />
  </label>;
}

function RecentHistory({ venueId, assetId, refresh }: { readonly venueId: string; readonly assetId: string;
  readonly refresh: string | null }): ReactElement {
  const [receipts, setReceipts] = useState<VenueInventoryReceipt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    void recentVenueInventoryHistory(venueId, assetId, controller.signal).then((result) => {
      if (!controller.signal.aborted) setReceipts(result);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(inventoryErrorMessage(failure));
    });
    return () => { controller.abort(); };
  }, [venueId, assetId, refresh, retry]);
  return <details className="inventory-history"><summary>Recent adjustments</summary>
    <p className="inventory-muted">The latest 20 recorded changes.</p>
    {error !== null ? <div role="alert"><p>{error}</p><button type="button" className="inventory-button"
      onClick={() => { setRetry((value) => value + 1); }}>Retry history</button></div> :
      receipts === null ? <p role="status">Loading history…</p> : receipts.length === 0 ?
        <p>No adjustments recorded.</p> : receipts.map((receipt) => <InventoryReceipt
          key={receipt.command.commandId} receipt={receipt} />)}
  </details>;
}

/** A pending command is immutable until the server confirms its result. A lost
 * response must never turn one physical correction into two independent writes. */
export function InventoryEditor({ actorId, venueId, item, onClose, onSaved }: EditorProps): ReactElement {
  const trap = useFocusTrap<HTMLDivElement>();
  const pendingKey = inventoryPendingKey(actorId, venueId, item.catalogue.id);
  const [resumed] = useState(() => readInventoryPending(pendingKey));
  const [base, setBase] = useState(resumed === null ? item.stock : resumed.baseStock);
  const [draft, setDraft] = useState(() => resumed === null ? inventoryDraft(item.stock) : {
    ownedQuantity: String(resumed.command.ownedQuantity), damagedQuantity: String(resumed.command.damagedQuantity),
    unavailableQuantity: String(resumed.command.unavailableQuantity), storageLocation: resumed.command.storageLocation ?? "",
    status: resumed.command.status, reason: resumed.command.reason,
  });
  const [pending, setPending] = useState<VenueInventoryWriteInput | null>(resumed?.command ?? null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(resumed === null ? null : "An earlier save is not confirmed. Retry this save to check its recorded result.");
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ currentStock: InventoryStock | null } | null>(null);
  const [saved, setSaved] = useState<VenueInventoryResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirmClose) keepEditingRef.current?.focus(); }, [confirmClose]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(inventoryDraft(base));
  const locked = busy || pending !== null;
  const close = (): void => {
    if (busy) return;
    if (pending !== null) { onClose(); return; }
    if (dirty) setConfirmClose(true);
    else onClose();
  };
  const change = <K extends keyof InventoryDraft>(key: K, value: InventoryDraft[K]): void => {
    setDraft((current) => ({ ...current, [key]: value })); setError(null); setNotice(null);
  };
  const parsed = inventoryWriteInput({ ...draft, reason: draft.reason || "Preview" }, base,
    "00000000-0000-4000-8000-000000000000");
  const serviceable = parsed.success ? parsed.data.ownedQuantity - parsed.data.damagedQuantity - parsed.data.unavailableQuantity : null;

  const submit = async (): Promise<void> => {
    if (busyRef.current || conflict !== null) return;
    const validation = pending === null ? inventoryWriteInput(draft, base, crypto.randomUUID()) : { success: true as const, data: pending };
    if (!validation.success) { setError(validation.message); return; }
    const command = validation.data;
    busyRef.current = true; setBusy(true); setError(null); setNotice(null); setPending(command);
    writeInventoryPending(pendingKey, { command, baseStock: base });
    try {
      const result = await writeVenueInventory(venueId, item.catalogue.id, command);
      setBase(result.stock); setDraft(inventoryDraft(result.stock)); setSaved(result); setPending(null);
      writeInventoryPending(pendingKey, null);
      onSaved(result.stock);
    } catch (failure: unknown) {
      if (failure instanceof ApiError && failure.code === "INVENTORY_REVISION_CONFLICT") {
        const latest = ConflictSchema.safeParse(failure.details);
        if (latest.success) { setConflict(latest.data); setPending(null); writeInventoryPending(pendingKey, null); }
        else setError("The latest stock could not be read. Retry this save to check its result.");
      } else if (failure instanceof ApiError && failure.status >= 400 && failure.status < 500) {
        setPending(null); writeInventoryPending(pendingKey, null); setError(inventoryErrorMessage(failure));
      } else {
        setError(`The result is not confirmed. Retry this save before making another change. ${inventoryErrorMessage(failure)}`);
      }
    } finally { busyRef.current = false; setBusy(false); }
  };

  return createPortal(<div className="inventory-overlay">
    <div className="inventory-editor" ref={trap} role="dialog" aria-modal="true" aria-labelledby="inventory-editor-title"
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); close(); } }}>
      <header className="inventory-editor-header"><div><h2 id="inventory-editor-title">{item.catalogue.name}</h2>
        <p>{base === null ? "Record physical stock" : "Adjust physical stock"}</p></div>
        <button type="button" className="inventory-icon-button" aria-label="Close inventory adjustment" disabled={busy}
          onClick={close}><X size={22} strokeWidth={1.5} /></button></header>
      {confirmClose ? <section className="inventory-notice" role="alert"><h3>Keep these changes?</h3>
        <p>Your unsaved counts and reason will be lost if you close.</p><div className="inventory-actions">
          <button className="inventory-button" type="button" ref={keepEditingRef} onClick={() => { setConfirmClose(false); }}>Keep editing</button>
          <button className="inventory-button" type="button" onClick={onClose}>Discard changes</button>
        </div></section> : null}
      {saved !== null ? <section className="inventory-success" role="status"><h3><Check size={18} />Stock saved</h3>
        {saved.replayed ? <p>Your earlier save was confirmed. The form shows the latest stock record.</p> : null}
        <InventoryReceipt receipt={saved.receipt} /></section> : null}
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }} noValidate>
        <div className="inventory-count-fields">
          <QuantityField label="Owned" value={draft.ownedQuantity} disabled={locked} onChange={(value) => { change("ownedQuantity", value); }} />
          <QuantityField label="Damaged" value={draft.damagedQuantity} disabled={locked} onChange={(value) => { change("damagedQuantity", value); }} />
          <QuantityField label="Other unavailable" value={draft.unavailableQuantity} disabled={locked} onChange={(value) => { change("unavailableQuantity", value); }} />
        </div>
        <p className="inventory-field-help">Damaged and other unavailable counts are separate parts of owned stock.</p>
        <label className="inventory-field"><span>Storage location</span><input value={draft.storageLocation} maxLength={240}
          disabled={locked} onChange={(event) => { change("storageLocation", event.target.value); }} /></label>
        <label className="inventory-field"><span>Status</span><select value={draft.status} disabled={locked}
          onChange={(event) => { change("status", event.target.value === "retired" ? "retired" : "active"); }}>
          <option value="active">Active</option><option value="retired">Retired</option></select></label>
        <div className="inventory-serviceable"><p><strong>{serviceable?.toLocaleString("en-GB") ?? "—"}</strong> serviceable owned</p>
          <span>{draft.status === "retired" ? "Retired stock is excluded from use." : "Before bookings and hired equipment."}</span>
          {base !== null && base.hires.length > 0 ? <span>{base.hires.length} hire {base.hires.length === 1 ? "record is" : "records are"} preserved separately.</span> : null}
        </div>
        <label className="inventory-field"><span>Reason</span><textarea rows={3} value={draft.reason} maxLength={1000}
          disabled={locked} onChange={(event) => { change("reason", event.target.value); }} aria-describedby="inventory-reason-help" /></label>
        <p id="inventory-reason-help" className="inventory-field-help">Saved with your identity and the exact before and after counts.</p>
        {conflict !== null ? <section className="inventory-notice" role="alert"><h3>This stock record changed</h3>
          <p>Your edits are still here. Review the latest counts before saving again.</p>
          <p>{conflict.currentStock === null ? "There is no current stock record." :
            `Latest: ${String(conflict.currentStock.ownedQuantity)} owned · ${String(conflict.currentStock.damagedQuantity)} damaged · ${String(conflict.currentStock.unavailableQuantity)} other unavailable.`}</p>
          {conflict.currentStock !== null ? <p>Storage: {conflict.currentStock.storageLocation ?? "Not recorded"} · Status: {conflict.currentStock.status}</p> : null}
          <button type="button" className="inventory-button" onClick={() => {
            setDraft(rebaseInventoryDraft(draft, base, conflict.currentStock));
            setBase(conflict.currentStock); setConflict(null); setSaved(null);
            setNotice("Your edits are retained. Untouched fields now use the latest record; review them before saving.");
          }}>Keep my edits against latest record</button></section> : null}
        {error !== null ? <p className="inventory-error" role="alert">{error}</p> : null}
        {notice !== null ? <p className="inventory-notice" role="status">{notice}</p> : null}
        <footer className="inventory-editor-actions"><button type="submit" className="inventory-button inventory-button--primary"
          disabled={busy || conflict !== null}>{busy ? "Saving…" : pending !== null ? "Retry this save" :
            base === null ? "Save stock record" : "Save adjustment"}</button>
          <button type="button" className="inventory-button" onClick={close} disabled={busy}>{pending !== null ? "Close and check later" : saved === null ? "Cancel" : "Done"}</button></footer>
      </form>
      <RecentHistory venueId={venueId} assetId={item.catalogue.id} refresh={saved?.receipt.command.commandId ?? null} />
    </div>
  </div>, document.body);
}
