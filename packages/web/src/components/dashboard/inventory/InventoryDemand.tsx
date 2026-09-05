import { useEffect, useRef, useState, type ReactElement } from "react";
import type { InventoryAssessment, InventoryAssessmentItem, InventoryRemedy, InventoryReservationRelease, InventoryReservationSource, InventoryWindow } from "@omnitwin/types";
import { ApiError } from "../../../api/client.js";
import { ActivityStatus } from "../../shared/Activity.js";
import { assessVenueInventory, getInventoryRemedy } from "../../../api/venue-inventory-demand.js";
import { InventoryWindowForm } from "./InventoryWindowForm.js";
import { defaultInventoryWindow, inventoryClockLabel, inventoryWindowInput, localInventoryInstant } from "./inventory-window.js";
import { inventoryErrorMessage } from "./inventory-form.js";
import { InventoryDemandEvidence } from "./InventoryDemandEvidence.js";
import { InventoryActionDialog } from "./InventoryActionDialog.js";
import { InventoryReservationReview, ReservationReceipt } from "./InventoryReservationReview.js";
import { InventoryRemedyForm, InventoryRemedyReview } from "./InventoryRemedyReview.js";
import { inventoryActionKey, readInventoryAction, runInventoryAction, writeInventoryAction, type InventoryPendingAction } from "./inventory-action-pending.js";

type Review = { readonly kind: "source"; readonly source: InventoryReservationSource }
  | { readonly kind: "prepare"; readonly item: InventoryAssessmentItem }
  | { readonly kind: "remedy"; readonly remedy: InventoryRemedy; readonly original: InventoryRemedy | null }
  | { readonly kind: "receipt"; readonly release: InventoryReservationRelease; readonly replayed: boolean; readonly timeZone: string }
  | { readonly kind: "pending" } | { readonly kind: "loading"; readonly remedyId: string; readonly original: InventoryRemedy | null }
  | { readonly kind: "readError"; readonly remedyId: string; readonly message: string; readonly original: InventoryRemedy | null };

function reviewTitle(review: Review): string {
  switch (review.kind) {
    case "source": return "Review reservation";
    case "prepare": return "Prepare internal request";
    case "remedy": return review.remedy.kind === "hire_request" ? "Hire request" : "Stock inspection";
    case "receipt": return "Reservation decision recorded";
    case "pending": return "Check recorded result";
    case "loading": return "Opening internal request";
    case "readError": return "Request unavailable";
  }
}

export function InventoryDemand({ actorId, venueId, refreshKey }: {
  readonly actorId: string; readonly venueId: string; readonly refreshKey: string | number;
}): ReactElement {
  const key = inventoryActionKey(actorId, venueId);
  const [pending, setPending] = useState(() => readInventoryAction(key));
  const [initial] = useState(() => {
    if (pending === null) return defaultInventoryWindow();
    const retainedWindow = pending.kind === "approve" ? pending.window : pending.input.window;
    return { startsAt: localInventoryInstant(new Date(retainedWindow.startsAt)), endsAt: localInventoryInstant(new Date(retainedWindow.endsAt)) };
  });
  const [window, setWindow] = useState<InventoryWindow | null>(() => {
    const parsed = inventoryWindowInput(initial); return parsed.success ? parsed.data : null;
  });
  const [assessment, setAssessment] = useState<InventoryAssessment | null>(null);
  const [loading, setLoading] = useState(false);
  const [assessmentUsable, setAssessmentUsable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [identityConflict, setIdentityConflict] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [view, setView] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const detailController = useRef<AbortController | null>(null);
  const refreshController = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; detailController.current?.abort(); refreshController.current?.abort(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    detailController.current?.abort();
    refreshController.current?.abort();
    setView((current) => current?.kind === "pending" ? current : null);
    setAssessment(null); setAssessmentUsable(false); setError(null);
    if (window === null) { setLoading(false); return () => { controller.abort(); }; }
    setLoading(true);
    void assessVenueInventory(venueId, window, controller.signal).then((result) => {
      if (!controller.signal.aborted) { setAssessment(result); setAssessmentUsable(true); }
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(inventoryErrorMessage(failure));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); };
  }, [venueId, window, refreshKey, retry]);

  const close = (): void => {
    if (busyRef.current) return;
    detailController.current?.abort(); setView(null); if (pending === null && assessmentUsable) setError(null);
  };
  const refreshAssessment = (message = "Current assessment could not be refreshed. The recorded request remains readable."): void => {
    if (window === null) return;
    refreshController.current?.abort();
    const controller = new AbortController(); refreshController.current = controller;
    setLoading(true); setAssessmentUsable(false);
    void assessVenueInventory(venueId, window, controller.signal).then((current) => {
      if (!controller.signal.aborted) { setAssessment(current); setAssessmentUsable(true); }
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(`${message} ${inventoryErrorMessage(failure)}`);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
  };
  const perform = async (action: InventoryPendingAction): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setPending(action); writeInventoryAction(key, action);
    setError(null); setIdentityConflict(false); setNotice(null); setView({ kind: "pending" });
    try {
      const response = await runInventoryAction(venueId, action);
      writeInventoryAction(key, null);
      if (!mounted.current) return;
      setPending(null);
      if (response.kind === "reservation") {
        setAssessment(response.result.assessment);
        setAssessmentUsable(true);
        setView({ kind: "receipt", release: response.result.release, replayed: response.result.replayed, timeZone: response.result.assessment.timeZone });
      } else {
        const remedy = response.result.remedy;
        if (response.result.replayed) readRequest(remedy.id, remedy);
        else {
          setAssessment((current) => current === null ? null : { ...current,
            remedies: [...current.remedies.filter((entry) => entry.id !== remedy.id), remedy] });
          setView({ kind: "remedy", remedy, original: null });
        }
        if (action.kind === "approve" && !response.result.replayed)
          refreshAssessment("The request was approved, but the current assessment could not be refreshed.");
      }
    } catch (failure: unknown) {
      if (!mounted.current) return;
      if (failure instanceof ApiError && ["INVENTORY_IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_CONFLICT"].includes(failure.code)) {
        setIdentityConflict(true);
        setError("This command identifier conflicts with a recorded action. Automatic retries have stopped. Review the retained attempt and venue records before preparing another action.");
      } else if (failure instanceof ApiError && failure.status >= 400 && failure.status < 500) {
        writeInventoryAction(key, null); setPending(null); setView(null);
        if (failure.status === 409) {
          setNotice("Facts changed. Review a fresh assessment before choosing an action.");
          setRetry((value) => value + 1);
        } else setNotice(inventoryErrorMessage(failure));
      } else setError(`The result is not confirmed. ${inventoryErrorMessage(failure)}`);
    } finally {
      busyRef.current = false; if (mounted.current) setBusy(false);
    }
  };
  const readRequest = (remedyId: string, original: InventoryRemedy | null = null): void => {
    detailController.current?.abort();
    const controller = new AbortController(); detailController.current = controller;
    setView({ kind: "loading", remedyId, original });
    void getInventoryRemedy(venueId, remedyId, controller.signal).then((remedy) => {
      if (!controller.signal.aborted) {
        const known = assessment?.remedies.find((entry) => entry.id === remedy.id);
        setAssessment((current) => current === null ? null : { ...current,
          remedies: [...current.remedies.filter((entry) => entry.id !== remedy.id), remedy] });
        setView({ kind: "remedy", remedy, original });
        if (original !== null || known?.status !== remedy.status || known.check !== remedy.check) refreshAssessment();
      }
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setView({ kind: "readError", remedyId, message: inventoryErrorMessage(failure), original });
    });
  };
  const openRequest = (remedyId: string): void => {
    if (pending === null && !busyRef.current && assessmentUsable) readRequest(remedyId);
  };
  const onAction = (action: InventoryPendingAction): void => { if (pending === null && assessmentUsable) void perform(action); };

  return <section className="inventory-demand" aria-labelledby="inventory-demand-title">
    <div className="inventory-section-heading"><h2 id="inventory-demand-title">Demand & decisions</h2>
      <p>Review event allocations, see shortages and prepare the next action.</p></div>
    {pending !== null && view?.kind !== "pending" ? <section className="inventory-notice" role="status"><h3>An earlier action is not confirmed</h3>
      <p>{pending.title}. Check its recorded result before making another reservation or request.</p>
      <button type="button" className="inventory-button" disabled={busy} onClick={() => {
        if (identityConflict) setView({ kind: "pending" }); else void perform(pending);
      }}>{identityConflict ? "Review command conflict" : "Check recorded result"}</button></section> : null}
    <InventoryWindowForm initial={initial} disabled={pending !== null || busy} busy={loading}
      onChange={() => { setWindow(null); setNotice(null); }} onAssess={(value) => { setWindow(value); setNotice(null); }} />
    {notice !== null ? <p className="inventory-notice" role="status">{notice}</p> : null}
    {error !== null && view?.kind !== "pending" ? <p className="inventory-error" role="alert">{error}</p> : null}
    {loading ? <ActivityStatus className="inventory-muted">Assessing recorded demand and stock…</ActivityStatus> : null}
    {window === null ? <p className="inventory-muted">Assess the selected window to review current choices.</p> : null}
    {assessment !== null ? <InventoryDemandEvidence assessment={assessment} disabled={busy || pending !== null || loading || !assessmentUsable}
      onSource={(source) => { setView({ kind: "source", source }); }} onRemedy={(item) => { setView({ kind: "prepare", item }); }} onRequest={openRequest} /> : null}
    {view !== null ? <InventoryActionDialog title={reviewTitle(view)} busy={busy} onClose={close}>
      {view.kind === "source" && assessment !== null ? <InventoryReservationReview source={view.source} assessment={assessment} actorId={actorId}
        busy={busy} onAction={onAction} onClose={close} /> : null}
      {view.kind === "prepare" && assessment !== null ? <InventoryRemedyForm item={view.item} assessment={assessment} busy={busy} onAction={onAction} onClose={close} /> : null}
      {view.kind === "remedy" ? <InventoryRemedyReview remedy={view.remedy} timeZone={assessment?.timeZone ?? inventoryClockLabel()} actorId={actorId} busy={busy} canAct={assessmentUsable && !loading}
        onAction={onAction} onClose={close} onPrepareAgain={() => {
          const item = assessment?.items.find((entry) => entry.assetDefinitionId === view.remedy.assetDefinitionId);
          if (item !== undefined) setView({ kind: "prepare", item });
          else { close(); setNotice("The item is no longer present in this assessment. Refresh inventory before preparing another request."); }
        }} /> : null}
      {view.kind === "pending" && pending !== null ? <section aria-busy={busy}><h3>{busy ? <ActivityStatus>Recording your action…</ActivityStatus> : "Result not confirmed"}</h3>
        <p>{pending.title}</p>{error !== null ? <p className="inventory-error" role="alert">{error}</p> : null}
        <p className="inventory-muted">{identityConflict ? "Dismissal removes this retained attempt only. Check venue records before preparing another action. " : "Retry checks the same command. "}Closing this review does not cancel an action the server may have recorded.</p>
        <details className="inventory-evidence"><summary>Retained attempt</summary><p>{pending.title}</p>
          <code>{pending.input.commandId}</code>{"reason" in pending.input ? <p>{pending.input.reason}</p> : null}</details>
        <div className="inventory-actions">{!identityConflict ? <button type="button" className="inventory-button inventory-button--primary" disabled={busy}
          onClick={() => { void perform(pending); }}>Check recorded result</button> : <button type="button" className="inventory-button" onClick={() => {
            writeInventoryAction(key, null); setPending(null); setIdentityConflict(false); setError(null); setView(null);
            setNotice("The retained attempt was dismissed. This does not cancel any recorded action. Review the refreshed records before proceeding.");
            setRetry((value) => value + 1);
          }}>Dismiss retained attempt</button>}
          <button type="button" className="inventory-button" disabled={busy} onClick={close}>Close and check later</button></div></section> : null}
      {view.kind === "receipt" ? <><h3>{view.release.action === "approved" ? "Reservation approved" : "Reservation revoked"}</h3>
        <p className="inventory-muted">{view.replayed ? "This is the earlier recorded decision. " : ""}This receipt records demand allocation; it does not confirm equipment supply. Current availability is assessed separately.</p>
        <ReservationReceipt release={view.release} actorId={actorId} timeZone={view.timeZone} />
        <div className="inventory-actions"><button type="button" className="inventory-button" onClick={close}>Done</button></div></> : null}
      {view.kind === "loading" ? <ActivityStatus>Reading the prepared request and its current status…</ActivityStatus> : null}
      {view.kind === "readError" ? <div role="alert"><p>{view.message}</p><button type="button" className="inventory-button"
        onClick={() => { readRequest(view.remedyId, view.original); }}>Retry request</button></div> : null}
      {(view.kind === "remedy" || view.kind === "readError") && view.original !== null ? <details className="inventory-evidence">
        <summary>Original command result</summary><p>The earlier command was recorded with status “{view.original.status}”. Current request status is read separately.</p>
        <p>{view.original.quantity.toLocaleString("en-GB")} × {view.original.assetName} · {view.original.reason}</p>
        <code>{view.original.id}</code><code>{view.original.assessmentDigest}</code></details> : null}
    </InventoryActionDialog> : null}
  </section>;
}
