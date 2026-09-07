import { useState, type ReactElement } from "react";
import { InventoryRemedyPrepareInputSchema, type InventoryAssessment, type InventoryAssessmentItem, type InventoryRemedy } from "@omnitwin/types";
import type { InventoryPendingAction } from "./inventory-action-pending.js";
import { InventoryInterval } from "./InventoryDemandEvidence.js";
import { inventoryTime } from "./inventory-window.js";
import { ActivityIndicator } from "../../shared/Activity.js";

export function InventoryRemedyForm({ item, assessment, busy, onAction, onClose }: {
  readonly item: InventoryAssessmentItem; readonly assessment: InventoryAssessment; readonly busy: boolean;
  readonly onAction: (action: InventoryPendingAction) => void; readonly onClose: () => void;
}): ReactElement {
  const [kind, setKind] = useState<"hire_request" | "stock_inspection">(item.availability === null ? "stock_inspection" : "hire_request");
  const [quantity, setQuantity] = useState(item.availability !== null && item.availability.maximumShortageQuantity > 0
    ? String(item.availability.maximumShortageQuantity) : "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  return <form onSubmit={(event) => {
    event.preventDefault(); if (busy) return;
    if (!/^\d+$/u.test(quantity.trim()) || !Number.isSafeInteger(Number(quantity)) || Number(quantity) < 1) {
      setError("Enter a whole requested quantity greater than zero."); return;
    }
    const result = InventoryRemedyPrepareInputSchema.safeParse({ commandId: crypto.randomUUID(), kind,
      assetDefinitionId: item.assetDefinitionId, window: assessment.window, quantity: Number(quantity),
      expectedAssessmentDigest: assessment.assessmentDigest, reason });
    if (!result.success) { setError(result.error.issues[0]?.message ?? "Check the request details."); return; }
    setError(null); onAction({ kind: "prepare", title: `${kind === "hire_request" ? "Hire request" : "Stock inspection"} · ${item.name}`, input: result.data });
  }}>
    <p className="inventory-review-context">{item.name}</p>
    <p><InventoryInterval window={assessment.window} timeZone={assessment.timeZone} /> · {assessment.timeZone}</p>
    <p className="inventory-muted">Internal request only. No supplier contact, equipment confirmation or stock change.</p>
    <label className="inventory-field"><span>Request type</span><select value={kind} disabled={busy}
      onChange={(event) => { setKind(event.target.value === "stock_inspection" ? "stock_inspection" : "hire_request"); }}>
      <option value="hire_request">Hire request</option><option value="stock_inspection">Stock inspection</option></select></label>
    <label className="inventory-field"><span>Requested quantity</span><input type="text" inputMode="numeric" value={quantity}
      disabled={busy} onChange={(event) => { setQuantity(event.target.value); }} /></label>
    <label className="inventory-field"><span>Reason for request</span><textarea rows={3} value={reason} maxLength={1000}
      disabled={busy} onChange={(event) => { setReason(event.target.value); }} /></label>
    {error !== null ? <p className="inventory-error" role="alert">{error}</p> : null}
    <div className="inventory-actions"><button type="submit" className="inventory-button inventory-button--primary" disabled={busy} aria-busy={busy}>
      {busy ? <ActivityIndicator size={18} /> : null}{busy ? "Preparing…" : "Prepare request"}</button><button type="button" className="inventory-button" disabled={busy} onClick={onClose}>Cancel</button></div>
  </form>;
}

export function InventoryRemedyReview({ remedy, timeZone, actorId, busy, canAct, onAction, onPrepareAgain, onClose }: {
  readonly remedy: InventoryRemedy; readonly timeZone: string; readonly actorId: string; readonly busy: boolean; readonly canAct: boolean;
  readonly onAction: (action: InventoryPendingAction) => void; readonly onPrepareAgain: () => void; readonly onClose: () => void;
}): ReactElement {
  const stale = remedy.check === "stale";
  const own = remedy.preparedBy === actorId;
  return <>
    <p className="inventory-review-context">{remedy.assetName} · {remedy.quantity.toLocaleString("en-GB")} requested</p>
    <p><InventoryInterval window={remedy.window} timeZone={timeZone} /> · {timeZone}</p>
    <div className={remedy.status === "approved" ? "inventory-success" : "inventory-coverage"}>
      <h3>{remedy.status === "approved" ? "Internal request approved" : "Prepared for your review"}</h3>
      <p>This internal request does not add supply or resolve the shortage. {remedy.kind === "hire_request"
        ? "Supplier availability, price and delivery still need confirmation." : "An inspection must establish whether equipment can return to use."}</p>
    </div>
    <p>{remedy.reason}</p>
    <h3>Evidence at preparation</h3>
    <p className="inventory-small inventory-muted">{remedy.evidence.stockRevision === null ? "Stock not recorded" : `Stock revision ${String(remedy.evidence.stockRevision)}`}</p>
    {remedy.evidence.shortageSegments.length === 0 ? <p>No confirmed shortages at preparation.</p> :
      remedy.evidence.shortageSegments.map((segment) => <div className="inventory-demand-segment" key={`${segment.startsAt}:${segment.endsAt}`}>
        <InventoryInterval window={segment} timeZone={timeZone} />
        <p><strong className="inventory-shortage">{segment.shortageQuantity.toLocaleString("en-GB")} short</strong> · {segment.remainingQuantity.toLocaleString("en-GB")} remaining · {segment.reservedQuantity.toLocaleString("en-GB")} reserved</p>
      </div>)}
    {remedy.evidence.affectedReservations.length > 0 ? <><h4>Affected reservations</h4><ul>{remedy.evidence.affectedReservations.map((reservation) =>
      <li key={reservation.releaseId}>{reservation.eventName} · {reservation.spaceName}</li>)}</ul></> : null}
    {remedy.evidence.missingFacts.length > 0 ? <div className="inventory-notice"><h4>Still to establish</h4>
      <ul>{remedy.evidence.missingFacts.map((fact) => <li key={fact}>{fact}</li>)}</ul></div> : null}
    {stale ? <p className="inventory-notice">{remedy.status === "approved" ? "The evidence for this approved request has since changed." : "Facts changed. Prepare a fresh request before approval."}</p> : null}
    {remedy.check === "not_checked" ? <p className="inventory-notice">Current evidence could not be verified. Approval remains unavailable; the recorded request is still readable.</p> : null}
    <div className="inventory-actions">
      {remedy.status === "prepared" && remedy.check === "current" ? <button type="button" className="inventory-button inventory-button--primary" disabled={busy || !canAct}
        onClick={() => { onAction({ kind: "approve", remedyId: remedy.id, window: remedy.window, title: `${remedy.kind === "hire_request" ? "Hire request" : "Stock inspection"} · ${remedy.assetName}`,
          input: { commandId: crypto.randomUUID(), expectedAssessmentDigest: remedy.assessmentDigest } }); }}>Approve internal request</button> : null}
      {remedy.status === "prepared" && stale ? <button type="button" className="inventory-button" disabled={busy || !canAct} onClick={onPrepareAgain}>Prepare fresh request</button> : null}
      <button type="button" className="inventory-button" disabled={busy} onClick={onClose}>Done</button>
    </div>
    <details className="inventory-evidence"><summary>Request record and audit identifiers</summary><dl className="inventory-audit">
      <div><dt>Status</dt><dd>{remedy.status}</dd></div><div><dt>Prepared</dt><dd>{inventoryTime(remedy.preparedAt, timeZone)}</dd></div>
      <div><dt>Prepared by</dt><dd>{own ? "You" : "Venue administrator"}<code>{remedy.preparedBy}</code></dd></div>
      {remedy.approvedAt !== null ? <div><dt>Approved</dt><dd>{inventoryTime(remedy.approvedAt, timeZone)}<code>{remedy.approvedBy}</code></dd></div> : null}
      <div><dt>Request</dt><dd>{remedy.id}</dd></div><div><dt>Evidence</dt><dd>{remedy.assessmentDigest}</dd></div>
    </dl></details>
  </>;
}
