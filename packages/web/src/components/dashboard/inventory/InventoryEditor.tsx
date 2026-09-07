import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState, type ReactElement, type ReactNode } from "react";
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
import { ActivityIndicator, ActivityStatus } from "../../shared/Activity.js";
import { InventoryNavigationGuard } from "./InventoryNavigationGuard.js";

interface EditorProps {
  readonly actorId: string;
  readonly venueId: string;
  readonly item: VenueInventoryItem;
  readonly onClose: () => void;
  readonly onSaved: (stock: InventoryStock) => void;
  readonly presentation?: "inline" | "dialog";
  readonly remedies?: ReactNode;
}

export interface InventoryEditorHandle {
  readonly requestClose: (accepted?: () => void) => void;
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
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(null); setLoading(true);
    void recentVenueInventoryHistory(venueId, assetId, controller.signal).then((result) => {
      if (!controller.signal.aborted) setReceipts(result);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(inventoryErrorMessage(failure));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); };
  }, [venueId, assetId, refresh, retry]);
  return <details className="inventory-history"><summary>Recent adjustments</summary>
    <p className="inventory-muted">The latest 20 recorded changes.</p>
    {loading ? <ActivityStatus>Loading history…</ActivityStatus> : null}
    {error !== null ? <div role="alert"><p>{error}</p><button type="button" className="inventory-button"
      onClick={() => { setRetry((value) => value + 1); }}>Retry history</button></div> :
      receipts === null ? null : receipts.length === 0 ?
        <p>No adjustments recorded.</p> : receipts.map((receipt) => <InventoryReceipt
          key={receipt.command.commandId} receipt={receipt} />)}
  </details>;
}

/** A pending command is immutable until the server confirms its result. A lost
 * response must never turn one physical correction into two independent writes. */
export const InventoryEditor = forwardRef<InventoryEditorHandle, EditorProps>(function InventoryEditor({
  actorId, venueId, item, onClose, onSaved, presentation = "dialog", remedies,
}, ref): ReactElement {
  const trap = useFocusTrap<HTMLDivElement>(presentation === "dialog");
  const formId = useId();
  const headingId = useId();
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
  const closeActionRef = useRef<(() => void) | null>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirmClose) keepEditingRef.current?.focus(); }, [confirmClose]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(inventoryDraft(base));
  const locked = busy || pending !== null;
  useEffect(() => {
    if (!dirty && !busy) return;
    const protectEdits = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", protectEdits);
    return () => { window.removeEventListener("beforeunload", protectEdits); };
  }, [dirty, busy]);
  const requestClose = useCallback((accepted?: () => void): void => {
    if (busyRef.current) return;
    const action = accepted ?? onClose;
    if (pending !== null || !dirty) {
      closeActionRef.current = null; setConfirmClose(false); action(); return;
    }
    closeActionRef.current = action; setConfirmClose(true);
  }, [dirty, onClose, pending]);
  useImperativeHandle(ref, () => ({ requestClose }), [requestClose]);
  const close = (): void => { requestClose(); };
  const discard = (): void => {
    if (busyRef.current) return;
    const action = closeActionRef.current ?? onClose;
    closeActionRef.current = null; setConfirmClose(false); action();
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
    closeActionRef.current = null; setConfirmClose(false);
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

  const inlineState = busy ? "Saving…" : pending !== null ? "Save not confirmed" : dirty ? "Unsaved correction"
    : base === null ? "Stock not recorded" : "Current stock";
  const stockDetails = <><label className="inventory-field"><span>Status</span><select value={draft.status} disabled={locked}
    onChange={(event) => { change("status", event.target.value === "retired" ? "retired" : "active"); }}>
    <option value="active">Active</option><option value="retired">Retired</option></select></label>
    <div className="inventory-serviceable"><p><strong>{serviceable?.toLocaleString("en-GB") ?? "—"}</strong> serviceable owned</p>
      <span>{draft.status === "retired" ? "Retired stock is excluded from use." : "Before bookings and hired equipment."}</span>
      {base !== null && base.hires.length > 0 ? <span>{base.hires.length} hire {base.hires.length === 1 ? "record is" : "records are"} preserved separately.</span> : null}
    </div></>;
  const editor = <div className={`inventory-editor${presentation === "inline" ? " inventory-editor--inline" : ""}`} ref={trap}
      role={presentation === "inline" ? "region" : "dialog"} aria-modal={presentation === "dialog" ? true : undefined} aria-labelledby={headingId}
      onKeyDown={(event) => { if (presentation === "dialog" && event.key === "Escape") { event.preventDefault(); close(); } }}>
      {presentation === "inline" ? <InventoryNavigationGuard dirty={dirty} busy={busy} /> : null}
      <header className="inventory-editor-header"><div><h2 id={headingId}>{presentation === "inline"
        ? base === null ? "Record stock" : "Correct stock" : item.catalogue.name}</h2>
        <p>{presentation === "inline" ? `${item.catalogue.name} · ${inlineState}`
          : base === null ? "Record physical stock" : "Adjust physical stock"}</p></div>
        <button type="button" className="inventory-icon-button" aria-label="Close inventory adjustment" disabled={busy}
          onClick={close}><X size={22} strokeWidth={1.5} /></button></header>
      {confirmClose ? <section className="inventory-notice" role="alert"><h3>Keep these changes?</h3>
        <p>Your unsaved counts and reason will be lost if you close.</p><div className="inventory-actions">
          <button className="inventory-button" type="button" ref={keepEditingRef} onClick={() => {
            closeActionRef.current = null; setConfirmClose(false);
            trap.current?.querySelector<HTMLInputElement>("input:not([disabled])")?.focus();
          }}>Keep editing</button>
          <button className="inventory-button" type="button" onClick={discard}>Discard changes</button>
        </div></section> : null}
      {saved !== null ? <section className="inventory-success" role="status"><h3><Check size={18} />Stock saved</h3>
        {saved.replayed ? <p>Your earlier save was confirmed. The form shows the latest stock record.</p> : null}
        <InventoryReceipt receipt={saved.receipt} /></section> : null}
      <form id={formId} onSubmit={(event) => { event.preventDefault(); void submit(); }} noValidate>
        <div className="inventory-count-fields">
          <QuantityField label="Owned" value={draft.ownedQuantity} disabled={locked} onChange={(value) => { change("ownedQuantity", value); }} />
          <QuantityField label="Damaged" value={draft.damagedQuantity} disabled={locked} onChange={(value) => { change("damagedQuantity", value); }} />
          <QuantityField label="Other unavailable" value={draft.unavailableQuantity} disabled={locked} onChange={(value) => { change("unavailableQuantity", value); }} />
        </div>
        {presentation === "dialog" ? <p className="inventory-field-help">Damaged and other unavailable counts are separate parts of owned stock.</p> : null}
        <label className="inventory-field"><span>Storage location</span><input value={draft.storageLocation} maxLength={240}
          disabled={locked} onChange={(event) => { change("storageLocation", event.target.value); }} /></label>
        {presentation === "dialog" ? stockDetails : null}
        <label className="inventory-field"><span>Reason</span><textarea rows={presentation === "inline" ? 2 : 3} value={draft.reason} maxLength={1000}
          disabled={locked} onChange={(event) => { change("reason", event.target.value); }} /></label>
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
      </form>
      {presentation === "inline" ? <div className="inventory-editor-disclosures">
        <details className="inventory-stock-details"><summary>Stock details</summary>
          <p className="inventory-field-help">Damaged and other unavailable counts are separate parts of owned stock.</p>{stockDetails}</details>
        <RecentHistory venueId={venueId} assetId={item.catalogue.id} refresh={saved?.receipt.command.commandId ?? null} />
      </div> : null}
      {remedies !== undefined && remedies !== null ? <div className="inventory-editor-remedies">{remedies}</div> : null}
        <footer className="inventory-editor-actions"><button type="submit" form={formId} className="inventory-button inventory-button--primary"
          disabled={busy || conflict !== null} aria-busy={busy}>{busy ? <ActivityIndicator size={18} /> : null}{busy ? "Saving…" : pending !== null ? "Retry this save" :
            base === null ? "Save stock record" : presentation === "inline" ? "Save stock correction" : "Save adjustment"}</button>
          <button type="button" className="inventory-button" onClick={close} disabled={busy}>{pending !== null ? "Close and check later" : saved === null ? "Cancel" : "Done"}</button></footer>
      {presentation === "dialog" ? <RecentHistory venueId={venueId} assetId={item.catalogue.id} refresh={saved?.receipt.command.commandId ?? null} /> : null}
    </div>;
  return presentation === "inline" ? editor : createPortal(<div className="inventory-overlay">{editor}</div>, document.body);
});
