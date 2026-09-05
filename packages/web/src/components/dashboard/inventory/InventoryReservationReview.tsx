import { useEffect, useState, type ReactElement } from "react";
import type { InventoryAssessment, InventoryReservationRelease, InventoryReservationSource } from "@omnitwin/types";
import { getInventoryReservationHistory } from "../../../api/venue-inventory-demand.js";
import { ActivityStatus } from "../../shared/Activity.js";
import { InventoryAvailability, InventoryInterval } from "./InventoryDemandEvidence.js";
import { inventoryErrorMessage } from "./inventory-form.js";
import { inventoryTime } from "./inventory-window.js";
import type { InventoryPendingAction } from "./inventory-action-pending.js";

export function ReservationReceipt({ release, actorId, timeZone }: {
  readonly release: InventoryReservationRelease; readonly actorId: string; readonly timeZone: string;
}): ReactElement {
  return <div className="inventory-reservation-receipt">
    <p>Revision {release.revision} · {release.action} · {inventoryTime(release.recordedAt, timeZone)}</p>
    <p><InventoryInterval window={release.occupiedWindow} timeZone={timeZone} /></p>
    <p>{release.reason}</p>
    <ul>{release.demands.map((demand) => <li key={demand.assetDefinitionId}>{demand.quantity.toLocaleString("en-GB")} × {demand.name}</li>)}</ul>
    <p className="inventory-muted">Recorded by {release.actorUserId === actorId ? "you" : "a venue administrator"}. Equipment setup through return was confirmed.</p>
    <details className="inventory-evidence"><summary>Audit identifiers</summary><dl className="inventory-audit">
      <div><dt>Receipt</dt><dd>{release.id}</dd></div><div><dt>Actor</dt><dd>{release.actorUserId}</dd></div>
      <div><dt>Source evidence</dt><dd>{release.sourceDigest}</dd></div>
    </dl></details>
  </div>;
}

function ReservationHistory({ venueId, source, actorId, timeZone }: {
  readonly venueId: string; readonly source: InventoryReservationSource; readonly actorId: string; readonly timeZone: string;
}): ReactElement {
  const [history, setHistory] = useState<InventoryReservationRelease[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setHistory(null); setError(null);
    void getInventoryReservationHistory(venueId, source.eventId, source.spaceId, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setHistory(value); })
      .catch((failure: unknown) => { if (!controller.signal.aborted) setError(inventoryErrorMessage(failure)); });
    return () => { controller.abort(); };
  }, [venueId, source.eventId, source.spaceId, retry]);
  return <details className="inventory-evidence"><summary>Reservation decision history</summary>
    {error !== null ? <div role="alert"><p>{error}</p><button type="button" className="inventory-button"
      onClick={() => { setRetry((current) => current + 1); }}>Retry history</button></div>
      : history === null ? <ActivityStatus>Reading reservation decisions…</ActivityStatus>
        : history.length === 0 ? <p>No reservation decisions recorded.</p>
          : history.map((release) => <ReservationReceipt key={release.id} release={release} actorId={actorId} timeZone={timeZone} />)}
  </details>;
}

export function InventoryReservationReview({ source, assessment, actorId, busy, onAction, onClose }: {
  readonly source: InventoryReservationSource; readonly assessment: InventoryAssessment; readonly actorId: string;
  readonly busy: boolean; readonly onAction: (action: InventoryPendingAction) => void; readonly onClose: () => void;
}): ReactElement {
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const historicalFootprint = source.proposalImpact.some((item) => item.unavailableReason === "historical_unsupported");
  const canApprove = source.occupiedWindow !== null && ["unapproved", "stale", "revoked"].includes(source.state)
    && assessment.coverage !== "historical_unsupported" && !historicalFootprint;
  const submit = (kind: "reserve" | "revoke"): void => {
    if (busy || reason.trim() === "" || (kind === "reserve" && (!confirmed || !canApprove))) return;
    const input = { commandId: crypto.randomUUID(), eventId: source.eventId, spaceId: source.spaceId,
      window: assessment.window, expectedSourceDigest: source.sourceDigest, expectedAssessmentDigest: assessment.assessmentDigest, reason: reason.trim() };
    const title = `${source.eventName} · ${source.spaceName}`;
    onAction(kind === "reserve" ? { kind, title, input: { ...input, occupiedWindowConfirmed: true } } : { kind, title, input });
  };
  return <>
    <p className="inventory-review-context">{source.eventName} · {source.spaceName}</p>
    <p className="inventory-small inventory-muted">{assessment.scopeDisclosure}</p>
    {source.issues.length > 0 ? <div className="inventory-notice"><ul>{source.issues.map((issue, index) => <li key={`${issue.code}:${String(index)}`}>{issue.message}</li>)}</ul></div> : null}
    <h3>Full recorded allocation</h3>
    {source.occupiedWindow === null ? <p className="inventory-notice">An occupied window could not be established. Correct the event source before approval.</p>
      : <p><InventoryInterval window={source.occupiedWindow} timeZone={assessment.timeZone} /><br /><span className="inventory-muted inventory-small">{assessment.timeZone}. This allocation is not clipped to the assessment window.</span></p>}
    <ul>{source.demands.map((demand) => <li key={demand.assetDefinitionId}>{demand.quantity.toLocaleString("en-GB")} × {demand.name}</li>)}</ul>
    {historicalFootprint ? <p className="inventory-notice">This allocation extends into unsupported stock history. It cannot be approved from this assessment; its recorded times have not been shortened.</p> : null}
    <details className="inventory-evidence"><summary>Frozen layouts and room phases</summary>
      {source.phases.map((phase) => <div className="inventory-demand-segment" key={phase.phaseId}><h4>{phase.name}</h4>
        <InventoryInterval window={phase.window} timeZone={assessment.timeZone} />
        <p>{phase.mode === "frozen_layout" ? "Verified frozen layout" : phase.mode === "room_flip_carry" ? "Equipment carried through room change" : "Equipment carried through breakdown"} · {phase.objects.length} placed objects</p>
        {phase.snapshotDigest !== null ? <details className="inventory-evidence"><summary>Source identifiers</summary>
          <code>{phase.snapshotId}</code><code>{phase.snapshotDigest}</code></details> : null}
      </div>)}
    </details>
    {source.approvedRelease !== null ? <details className="inventory-evidence"><summary>Currently approved allocation</summary>
      <ReservationReceipt release={source.approvedRelease} actorId={actorId} timeZone={assessment.timeZone} /></details> : null}
    {canApprove ? <><h3>After this reservation approval</h3>
      <p className="inventory-small inventory-muted">Consequences across the full occupied window. A reservation records demand; it does not acquire equipment or resolve shortages.</p>
      <InventoryAvailability items={source.proposalImpact} sources={assessment.sources} timeZone={assessment.timeZone} />
      <label className="inventory-confirmation"><input type="checkbox" checked={confirmed} disabled={busy}
        onChange={(event) => { setConfirmed(event.target.checked); }} />
        <span>I confirm these recorded times cover equipment setup through return.</span></label></> : null}
    {(canApprove || source.approvedRelease !== null) ? <label className="inventory-field"><span>Reason for reservation decision</span>
      <textarea rows={3} maxLength={1000} value={reason} disabled={busy} onChange={(event) => { setReason(event.target.value); }} /></label> : null}
    <div className="inventory-actions">
      {canApprove ? <button type="button" className="inventory-button inventory-button--primary" disabled={busy || !confirmed || reason.trim() === ""}
        onClick={() => { submit("reserve"); }}>Approve reservation</button> : null}
      {source.approvedRelease !== null ? <button type="button" className="inventory-button" disabled={busy || reason.trim() === ""}
        onClick={() => { submit("revoke"); }}>Revoke reservation</button> : null}
      <button type="button" className="inventory-button" disabled={busy} onClick={onClose}>Close review</button>
    </div>
    <ReservationHistory venueId={assessment.venueId} source={source} actorId={actorId} timeZone={assessment.timeZone} />
  </>;
}
