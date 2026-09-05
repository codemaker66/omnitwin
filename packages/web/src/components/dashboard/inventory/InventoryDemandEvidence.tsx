import type { ReactElement } from "react";
import type { InventoryAssessment, InventoryAssessmentItem, InventoryReservationSource, InventoryWindow } from "@omnitwin/types";
import { inventoryTime } from "./inventory-window.js";

export function InventoryInterval({ window, timeZone }: { readonly window: InventoryWindow; readonly timeZone: string }): ReactElement {
  return <span className="inventory-interval"><time dateTime={window.startsAt}>{inventoryTime(window.startsAt, timeZone)}</time>
    <span aria-hidden="true"> → </span><span className="inventory-sr-only"> until </span>
    <time dateTime={window.endsAt}>{inventoryTime(window.endsAt, timeZone)}</time></span>;
}

function eventNames(ids: readonly string[], sources: readonly InventoryReservationSource[]): string {
  return ids.map((id) => sources.find((source) => source.eventId === id)?.eventName ?? "Event details unavailable").join(", ");
}

export function InventoryAvailability({ items, sources, timeZone, onRemedy }: {
  readonly items: readonly InventoryAssessmentItem[]; readonly sources: readonly InventoryReservationSource[];
  readonly timeZone: string; readonly onRemedy?: (item: InventoryAssessmentItem) => void;
}): ReactElement {
  return <div className="inventory-availability-grid">{items.map((item) => <article className="inventory-demand-item" key={item.assetDefinitionId}>
    <header><h4>{item.name}</h4>{onRemedy !== undefined ? <button type="button" className="inventory-button inventory-button--quiet"
      aria-label={`Prepare remedy · ${item.name}`} onClick={() => { onRemedy(item); }}>Prepare remedy</button> : null}</header>
    {item.availability === null ? <p className="inventory-muted">{item.unavailableReason === "historical_unsupported"
      ? "Historical stock cannot be assessed in this window." : "Record stock before availability can be assessed."}</p> : <>
      <div className="inventory-demand-numbers"><p><strong className={item.availability.minimumRemainingQuantity < 0 ? "inventory-shortage" : undefined}>
        {item.availability.minimumRemainingQuantity.toLocaleString("en-GB")}</strong><span>minimum remaining</span></p>
        <p><strong>{item.availability.maximumShortageQuantity.toLocaleString("en-GB")}</strong><span>maximum shortage</span></p></div>
      <details className="inventory-evidence"><summary>Demand intervals and affected events</summary>
        {item.availability.segments.map((segment) => <div className="inventory-demand-segment" key={`${segment.startsAt}:${segment.endsAt}`}>
          <InventoryInterval window={segment} timeZone={timeZone} />
          <p>{segment.usableQuantity.toLocaleString("en-GB")} usable · {segment.reservedQuantity.toLocaleString("en-GB")} reserved · {segment.remainingQuantity.toLocaleString("en-GB")} remaining</p>
          <p className="inventory-muted">{segment.eventIds.length === 0 ? "No approved event reservations in this interval." : eventNames(segment.eventIds, sources)}</p>
        </div>)}
      </details>
    </>}
  </article>)}</div>;
}

const sourceLabels: Record<InventoryReservationSource["state"], string> = {
  unapproved: "Awaiting reservation approval", approved: "Reservation approved", stale: "Source changed — review required",
  incomplete: "Source evidence incomplete", inactive: "Source inactive", revoked: "Reservation revoked",
};

export function InventoryDemandEvidence({ assessment, disabled, onSource, onRemedy, onRequest }: {
  readonly assessment: InventoryAssessment; readonly disabled: boolean;
  readonly onSource: (source: InventoryReservationSource) => void;
  readonly onRemedy: (item: InventoryAssessmentItem) => void;
  readonly onRequest: (id: string) => void;
}): ReactElement {
  return <>
    <section className={assessment.coverage === "complete" ? "inventory-coverage" : "inventory-notice"}>
      <h3>{assessment.coverage === "complete" ? "Source coverage checked" : assessment.coverage === "historical_unsupported"
        ? "Historical stock evidence unavailable" : "Coverage gaps remain"}</h3>
      <p>{assessment.scopeDisclosure}</p>
      {assessment.issues.length > 0 ? <ul>{assessment.issues.map((issue, index) => <li key={`${issue.code}:${String(index)}`}>{issue.message}</li>)}</ul> : null}
      <p className="inventory-small">Assessment: <InventoryInterval window={assessment.window} timeZone={assessment.timeZone} /> · {assessment.timeZone}</p>
    </section>
    <div className="inventory-section-heading"><h3>Reservations and source layouts</h3><p>Review the recorded equipment allocation for each event and room.</p></div>
    {assessment.sources.length === 0 ? <p className="inventory-muted">No event reservation sources were found in this window.</p> :
      <div className="inventory-source-list">{assessment.sources.map((source) => <article className="inventory-source" key={`${source.eventId}:${source.spaceId}`}>
        <div><h4>{source.eventName}</h4><p>{source.spaceName}</p><p className="inventory-muted inventory-small">{sourceLabels[source.state]}</p>
          {source.occupiedWindow !== null ? <p className="inventory-small"><InventoryInterval window={source.occupiedWindow} timeZone={assessment.timeZone} /></p> : null}</div>
        <button type="button" className="inventory-button" disabled={disabled}
          aria-label={`Review reservation · ${source.eventName} · ${source.spaceName}`} onClick={() => { onSource(source); }}>Review reservation</button>
      </article>)}</div>}
    <div className="inventory-section-heading"><h3>Stock against approved reservations</h3>
      <p>Unapproved layouts are shown above. Remaining quantities apply only to recorded stock and approved reservations; coverage gaps can hide further demand.</p></div>
    <InventoryAvailability items={assessment.items} sources={assessment.sources} timeZone={assessment.timeZone}
      onRemedy={disabled || assessment.coverage === "historical_unsupported" ? undefined : onRemedy} />
    <div className="inventory-section-heading"><h3>Internal requests</h3><p>Preparing or approving a request does not add supply or resolve a shortage.</p></div>
    {assessment.remedies.length === 0 ? <p className="inventory-muted">No internal requests in this window.</p> :
      <div className="inventory-source-list">{assessment.remedies.map((remedy) => <article className="inventory-source" key={remedy.id}>
        <div><h4>{remedy.kind === "hire_request" ? "Hire request" : "Stock inspection"} · {remedy.assetName}</h4>
          <p>{remedy.quantity.toLocaleString("en-GB")} requested · {remedy.status}{remedy.check === "stale" ? " · Facts changed" : ""}</p></div>
        <button type="button" className="inventory-button" disabled={disabled} onClick={() => { onRequest(remedy.id); }}
          aria-label={`Review internal request · ${remedy.assetName}`}>Review request</button>
      </article>)}</div>}
  </>;
}
