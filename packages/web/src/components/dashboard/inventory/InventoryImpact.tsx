import { ArrowUpRight, TriangleAlert } from "lucide-react";
import type { ReactElement } from "react";
import type { InventoryAssessmentItem } from "@omnitwin/types";
import { ActivityStatus } from "../../shared/Activity.js";
import type { InventoryDemandContext } from "./InventoryDemand.js";
import { InventoryInterval } from "./InventoryDemandEvidence.js";

export function InventoryImpact({ demand, assetId }: { readonly demand: InventoryDemandContext;
  readonly assetId: string | null }): ReactElement {
  const { assessment, loading } = demand;
  const item = assessment?.items.find((entry) => entry.assetDefinitionId === assetId);
  // Display all three quantities from the SAME interval. Independently taking
  // their extrema can imply a stock equation that never occurred.
  const interval = item?.availability?.segments.reduce((lowest, segment) =>
    segment.remainingQuantity < lowest.remainingQuantity ? segment : lowest);
  return <section className="inventory-impact" aria-labelledby="inventory-impact-title">
    <div className="inventory-impact-toolbar"><div className="inventory-impact-heading"><h2 id="inventory-impact-title">Reservation impact</h2>
      <a href="#inventory-decisions" className="inventory-text-link">Review decisions <ArrowUpRight size={16} /></a></div>
    <details className="inventory-period"><summary>Choose period</summary>{demand.windowForm}</details></div>
    {assessment !== null ? <p className="inventory-impact-caption">Selected period · <InventoryInterval window={assessment.window} timeZone={assessment.timeZone} /> · {assessment.timeZone}</p> : null}
    {assessment !== null && !demand.assessmentCurrent ? <p className="inventory-impact-caveat" role="status">Previous assessment — refresh required. These figures are not current.</p> : null}
    {loading ? <ActivityStatus>Checking reservations…</ActivityStatus> : assessment === null ?
      <p>Choose and assess a period to see demand against your stock.</p> : interval === undefined ?
        <p>{item === undefined ? "This item is not in the current assessment." : item.unavailableReason === "historical_unsupported" ? "Historical stock is not available for this period." :
          "Record stock to assess availability. Unknown counts remain unrecorded."}</p> : <>
      <p className="inventory-impact-caption">At the lowest remaining stock · <InventoryInterval window={interval} timeZone={assessment.timeZone} /></p>
      <dl className="inventory-hero-numbers"><div><dd>{interval.usableQuantity.toLocaleString("en-GB")}</dd><dt>Usable</dt></div>
        <div><dd>{interval.reservedQuantity.toLocaleString("en-GB")}</dd><dt>Reserved</dt></div>
        <div><dd className={interval.remainingQuantity < 0 ? "inventory-shortage" : undefined}>{interval.remainingQuantity.toLocaleString("en-GB")}</dd><dt>Remaining</dt></div></dl>
      <div className="inventory-impact-events"><p className={interval.remainingQuantity < 0 ? "inventory-impact-shortage" : "inventory-impact-available"}>
        {interval.remainingQuantity < 0 ? <><TriangleAlert size={24} />{Math.abs(interval.remainingQuantity).toLocaleString("en-GB")} needed</> : "Approved demand covered"}</p>
        <div><h3>Overlapping reservations</h3>{interval.eventIds.length === 0 ? <p>No approved reservations in this interval.</p> :
          interval.eventIds.map((eventId) => <a key={eventId} href={`/ops/events/${encodeURIComponent(eventId)}`}>
            {assessment.sources.find((source) => source.eventId === eventId)?.eventName ?? "Open event"}<ArrowUpRight size={14} /></a>)}</div></div>
      {assessment.coverage !== "complete" ? <p className="inventory-impact-caveat">Coverage gaps remain. Further event demand may be missing; review the decisions below.</p> : null}
    </>}
  </section>;
}

export function InventoryRemedyShortcut({ demand, item }: { readonly demand: InventoryDemandContext;
  readonly item: InventoryAssessmentItem | undefined }): ReactElement {
  const shortage = item?.availability?.maximumShortageQuantity;
  return <section className="inventory-remedy-shortcut" aria-labelledby="inventory-remedy-shortcut-title">
    <h3 id="inventory-remedy-shortcut-title">Review remedies <ArrowUpRight size={20} /></h3>
    {item === undefined || demand.assessment?.coverage === "historical_unsupported" ?
      <p>Assess a current period to prepare a request.</p> : <button className="inventory-button" type="button"
        disabled={!demand.canAct} onClick={() => { demand.onRemedy(item); }}>
        {shortage !== undefined && shortage > 0 ? `Prepare request · ${shortage.toLocaleString("en-GB")} needed` : "Prepare hire or inspection request"}<ArrowUpRight size={18} /></button>}
    <p>Review the evidence, then submit for venue-admin approval.</p>
    <p>No supply is confirmed by a request. {!demand.assessmentCurrent ? "Refresh the assessment for current shortages." : shortage !== undefined && shortage > 0 ? `Shortfall remains ${shortage.toLocaleString("en-GB")}.` : "Stock changes are recorded separately."}</p>
  </section>;
}
