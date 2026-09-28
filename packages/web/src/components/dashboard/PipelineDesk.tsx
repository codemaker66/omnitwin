import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { isValidOpportunityStageTransition } from "@omnitwin/types";
import { Plus, X } from "lucide-react";
import {
  addFollowUpTask, addOpportunityActivity, createOpportunity, getOpportunity, getPipeline, updateFollowUpTaskStatus,
  updateOpportunity, type FollowUpTask, type Opportunity, type PipelineOpportunity, type PipelineSummary,
} from "../../api/crm.js";
import { ApiError } from "../../api/client.js";
import { createProposal } from "../../api/proposals.js";
import { useMediaQuery } from "../../hooks/use-media-query.js";
import { useLatestRequest } from "../../hooks/use-latest-request.js";
import { parsePoundsToMinor } from "../../lib/money-input.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { ActivityIndicator, ActivityStatus } from "../shared/Activity.js";
import { deskGreeting, venueYear, type SummaryPart } from "./enquiries/enquiry-desk-format.js";
import { DealPanel, type DealDetail, type DealPanelProps, type DealSaving } from "./pipeline/DealPanel.js";
import { PipelineLedger } from "./pipeline/PipelineLedger.js";
import { PipelineOverview } from "./pipeline/PipelineOverview.js";
import { PipelineStages } from "./pipeline/PipelineStages.js";
import {
  LIVE_STAGES, asStage, dealStageWords, groupByDue, pipelineSummary, type PipelineFilter,
} from "./pipeline/pipeline-desk-format.js";
import "./enquiries/EnquiriesDesk.css";
import "./clients/ClientsDesk.css";
import "./pipeline/PipelineDesk.css";

// ---------------------------------------------------------------------------
// PipelineDesk — the sales pipeline as a desk (roadmap X1).
//
// Open deals are listed by when their next step is due, beside a forest panel
// holding the one deal open: its facts, its path, the one next step for its
// stage, what is owed on it and everything said about it. The live stages sit
// on the copper plane with what their deals are worth, each its own filter.
// The open deal is in the address (?opportunity=), so a link from the
// Enquiries desk or the Clients desk lands on it.
// ---------------------------------------------------------------------------

const WIDE_DESK = "(min-width: 1180px)";
const PAGE = 50;

export interface PipelineDeskProps {
  /** A deal to open from the address (?opportunity=). */
  readonly opportunityId?: string | null;
  /** Told which deal is open, or null when none, so the address follows it. */
  readonly onOpportunityShown?: (opportunityId: string | null) => void;
  readonly onOpenProposal?: (proposalId: string) => void;
  /** Opens a contact on the Clients desk. */
  readonly onOpenClient?: (contactId: string) => void;
}

type ListState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly summary: PipelineSummary; readonly rows: readonly PipelineOpportunity[] }
  | { readonly status: "error"; readonly previous: { readonly summary: PipelineSummary; readonly rows: readonly PipelineOpportunity[] } | null };

type DetailState =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly id: string }
  | { readonly status: "ready"; readonly detail: DealDetail }
  | { readonly status: "missing"; readonly id: string }
  | { readonly status: "error"; readonly id: string };

type Failure = DealPanelProps["failure"];

/** "Couldn't save" in words that say what is and is not true afterwards. */
const FAILURE_WORDS: Readonly<Record<NonNullable<Failure>["where"], string>> = {
  step: "That did not save. The deal has not moved.",
  value: "The value did not save. It is as it was.",
  next: "The next step did not save. It is as it was.",
  task: "The follow-up did not save. Nothing was added.",
  note: "The note did not save. Your words are still here.",
};

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
}

function SummarySentence({ parts }: { readonly parts: readonly SummaryPart[] }): ReactElement {
  return (
    <p className="enq-summary" data-testid="pipeline-summary">
      {parts.map((part, index) => typeof part === "string"
        ? <span key={index}>{part}</span>
        : <strong key={index} data-tone={part.tone}>{part.strong}</strong>)}
    </p>
  );
}

export function PipelineDesk({ opportunityId = null, onOpportunityShown, onOpenProposal, onOpenClient }: PipelineDeskProps = {}): ReactElement {
  const wide = useMediaQuery(WIDE_DESK);
  const titleId = useId();
  const user = useAuthStore((state) => state.user);
  const [nowMs] = useState(() => Date.now());
  const [filter, setFilter] = useState<PipelineFilter>("all");
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [detail, setDetail] = useState<DetailState>({ status: "idle" });
  const [saving, setSaving] = useState<DealSaving>(null);
  const [failure, setFailure] = useState<Failure>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [stampKey, setStampKey] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const listRequest = useLatestRequest();
  // The deal that should be open, and each time it should be read again. The
  // read is an effect keyed on it, so a read cut short (a newer deal, React's
  // development double run) is simply made again, and a late answer for a
  // deal no longer open is never shown.
  const [target, setTarget] = useState<{ readonly id: string; readonly read: number; readonly quietly: boolean } | null>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusPanelRef = useRef(false);
  const returnFocusRef = useRef<string | null>(null);
  const reportedRef = useRef<string | null>(null);
  const onShownRef = useRef(onOpportunityShown);
  useEffect(() => { onShownRef.current = onOpportunityShown; });

  const rows = list.status === "ready" ? list.rows : list.status === "error" ? list.previous?.rows ?? [] : [];
  const summary = list.status === "ready" ? list.summary : list.status === "error" ? list.previous?.summary ?? null : null;
  const openId = target?.id ?? null;

  /** Reads the pipeline from its start; `keep` rows keeps as many as are shown. */
  const readList = useCallback((keep = PAGE): void => {
    const owns = listRequest.begin();
    const stage = filter === "all" ? undefined : filter;
    getPipeline({ order: "due", limit: Math.min(200, Math.max(PAGE, keep)), ...(stage === undefined ? {} : { stage }) })
      .then((next) => { if (owns()) setList({ status: "ready", summary: next, rows: next.opportunities }); })
      .catch(() => {
        if (!owns()) return;
        setList((current) => ({
          status: "error",
          previous: current.status === "ready" ? { summary: current.summary, rows: current.rows } : current.status === "error" ? current.previous : null,
        }));
      });
  }, [filter, listRequest]);

  useEffect(() => {
    setList({ status: "loading" });
    readList();
  }, [readList]);

  const loadMore = (): void => {
    if (list.status !== "ready" || loadingMore) return;
    const current = list;
    const stage = filter === "all" ? undefined : filter;
    setLoadingMore(true);
    getPipeline({ order: "due", limit: PAGE, offset: current.rows.length, ...(stage === undefined ? {} : { stage }) })
      .then((next) => {
        setList((latest) => latest.status !== "ready" || latest.rows !== current.rows ? latest : {
          status: "ready", summary: next,
          rows: [...current.rows, ...next.opportunities.filter((row) => !current.rows.some((shown) => shown.id === row.id))],
        });
      })
      .catch(() => { setList((latest) => latest.status === "ready" ? { status: "error", previous: latest } : latest); })
      .finally(() => { setLoadingMore(false); });
  };

  // ---------------------------------------------------------------------------
  // The open deal
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (target === null) {
      setDetail({ status: "idle" });
      return;
    }
    let current = true;
    const { id, quietly } = target;
    if (!quietly) setDetail({ status: "loading", id });
    getOpportunity(id)
      .then((next) => { if (current) setDetail({ status: "ready", detail: next }); })
      .catch((error: unknown) => {
        // A quiet re-read that fails keeps the deal as it was last read.
        if (!current || quietly) return;
        setDetail(error instanceof ApiError && error.status === 404 ? { status: "missing", id } : { status: "error", id });
      });
    return () => { current = false; };
  }, [target]);

  // The address follows the deal that is open.
  const targetId = target?.id ?? null;
  useEffect(() => {
    if (reportedRef.current === targetId) return;
    reportedRef.current = targetId;
    onShownRef.current?.(targetId);
  }, [targetId]);

  const openDeal = useCallback((id: string, byReader: boolean): void => {
    if (byReader) focusPanelRef.current = true;
    setFailure(null);
    setAnnouncement(null);
    setStampKey(null);
    setSaving(null);
    setTarget((current) => {
      if (current?.id === id) {
        if (byReader) panelHeadingRef.current?.focus();
        return current;
      }
      return { id, read: 0, quietly: false };
    });
  }, []);

  const readAgain = useCallback((id: string, quietly: boolean): void => {
    setTarget((current) => current?.id === id ? { id, read: current.read + 1, quietly } : current);
  }, []);

  const closeDeal = useCallback((): void => {
    setTarget((current) => {
      returnFocusRef.current = current?.id ?? null;
      return null;
    });
    setFailure(null);
  }, []);

  // A deal linked from the address opens beside the ledger; the browser's
  // Back closes it, and a reader who was in it returns to its row.
  useEffect(() => {
    if (opportunityId !== null) {
      openDeal(opportunityId, false);
      return;
    }
    setTarget((current) => {
      if (current === null) return current;
      const active = document.activeElement;
      if (active === null || active === document.body || active.closest(".pl-panel") !== null) returnFocusRef.current = current.id;
      return null;
    });
  }, [opportunityId, openDeal]);

  // Focus follows the reader into a deal they opened, and back to its row
  // once the deal is closed and the ledger is on screen again.
  useEffect(() => {
    if (detail.status === "ready" && focusPanelRef.current) {
      focusPanelRef.current = false;
      panelHeadingRef.current?.focus();
    }
    if (detail.status === "idle" && returnFocusRef.current !== null) {
      const id = returnFocusRef.current;
      returnFocusRef.current = null;
      document.querySelector<HTMLElement>(`button[data-deal-id="${CSS.escape(id)}"]`)?.focus();
    }
  }, [detail]);

  const stepTo = (direction: 1 | -1): void => {
    const ordered = groupByDue(rows, nowMs).flatMap((group) => group.rows);
    const index = ordered.findIndex((row) => row.id === openId);
    const next = ordered[index + direction];
    if (index >= 0 && next !== undefined) openDeal(next.id, true);
  };

  // ---------------------------------------------------------------------------
  // What the panel changes; each re-reads the deal and the ledger quietly.
  // ---------------------------------------------------------------------------

  const current = detail.status === "ready" ? detail.detail : null;

  const afterChange = (id: string): void => {
    readAgain(id, true);
    readList(Math.max(PAGE, rows.length));
  };

  const attempt = async (where: NonNullable<Failure>["where"], busy: DealSaving, work: () => Promise<void>): Promise<boolean> => {
    if (current === null || saving !== null) return false;
    const id = current.opportunity.id;
    setSaving(busy);
    setFailure(null);
    try {
      await work();
      afterChange(id);
      return true;
    } catch (error: unknown) {
      const reason = error instanceof ApiError && error.code === "INVALID_TRANSITION"
        ? "That move is not open from this stage any more. The deal has been read again."
        : FAILURE_WORDS[where];
      setFailure({ where, message: reason });
      if (error instanceof ApiError && error.code === "INVALID_TRANSITION") afterChange(id);
      return false;
    } finally {
      setSaving(null);
    }
  };

  const applyDeal = (next: Opportunity): void => {
    setDetail((state) => state.status === "ready" && state.detail.opportunity.id === next.id
      ? { status: "ready", detail: { ...state.detail, opportunity: next } } : state);
  };

  const onMove = (to: string, reason: string | null): Promise<boolean> => attempt("step", "step", async () => {
    if (current === null) return;
    const updated = await updateOpportunity(current.opportunity.id, { stage: to, note: reason });
    applyDeal(updated);
    setStampKey(Date.now());
    setAnnouncement(`${current.opportunity.title} is now ${dealStageWords(to).toLowerCase()}.`);
  });

  const onDraftProposal = (): Promise<boolean> => attempt("step", "step", async () => {
    if (current === null) return;
    const deal = current.opportunity;
    await createProposal({
      // The server brings the deal's enquiry and that enquiry's layout.
      venueId: deal.venueId, opportunityId: deal.id, title: `${deal.title} proposal`,
    });
    const from = asStage(deal.stage);
    if (from !== null && isValidOpportunityStageTransition(from, "proposal_drafting")) {
      try {
        const updated = await updateOpportunity(deal.id, { stage: "proposal_drafting", note: "Proposal draft created" });
        applyDeal(updated);
        setStampKey(Date.now());
      } catch {
        // The proposal exists; only the move did not happen, and that is said.
        // The next step then offers the move alone, never a second draft.
        setFailure({ where: "step", message: "The proposal draft is made, but the deal did not move to Proposal drafting." });
        return;
      }
    }
    setAnnouncement("A proposal draft is made. Open it under Proposals to write it.");
  });

  const onSaveValue = (minor: number): Promise<boolean> => attempt("value", "value", async () => {
    if (current === null) return;
    applyDeal(await updateOpportunity(current.opportunity.id, { estimatedValueMinor: minor }));
    setAnnouncement("The value is saved.");
  });

  const onSaveNext = (nextAction: string, dueAt: string | null): Promise<boolean> => attempt("next", "next", async () => {
    if (current === null) return;
    applyDeal(await updateOpportunity(current.opportunity.id, { nextAction, nextActionDueAt: dueAt }));
    setAnnouncement("The next step is saved.");
  });

  const onAddTask = (title: string, dueAt: string | null): Promise<boolean> => attempt("task", "task", async () => {
    if (current === null) return;
    await addFollowUpTask(current.opportunity.id, title, dueAt);
    setAnnouncement(`Follow-up added: ${title}.`);
  });

  const onCompleteTask = (task: FollowUpTask): void => {
    void attempt("task", { task: task.id }, async () => {
      if (current === null) return;
      await updateFollowUpTaskStatus(current.opportunity.id, task.id, "done");
      setAnnouncement(`${task.title}: done.`);
    });
  };

  const onAddNote = (body: string): Promise<boolean> => attempt("note", "note", async () => {
    if (current === null) return;
    await addOpportunityActivity(current.opportunity.id, body);
    setAnnouncement("The note is added.");
  });

  // ---------------------------------------------------------------------------
  // The desk
  // ---------------------------------------------------------------------------

  const onDeskKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Escape" || event.defaultPrevented || openId === null || isEditable(event.target)) return;
    event.preventDefault();
    closeDeal();
  };

  const greeting = deskGreeting(nowMs, user?.name ?? null);
  const year = venueYear(nowMs);
  const counts = summary?.stageCounts ?? null;
  const openCount = counts === null ? 0 : LIVE_STAGES.reduce((sum, stage) => sum + (counts[stage] ?? 0), 0);
  const sentence = summary === null ? null : pipelineSummary({
    due: summary.due ?? null, openCount, openValueMinor: summary.pipelineValueMinor ?? null, currency: summary.currency ?? "GBP",
  });
  const total = summary?.page?.total ?? null;
  const showSheet = wide || openId === null;
  const openIndex = rows.findIndex((row) => row.id === openId);

  return (
    <div className={`enq-desk pl-desk${wide ? "" : " enq-desk--single"}`} data-register="ivory" onKeyDown={onDeskKey}>
      {showSheet && (
        <section className="enq-sheet" aria-labelledby={titleId}>
          <header className="enq-head pl-head">
            <p className="enq-greeting">
              <span>{greeting.date}</span>
              <span aria-hidden="true">·</span>
              <span>{greeting.greeting}</span>
            </p>
            <div className="pl-title">
              <h1 id={titleId}>Pipeline</h1>
              <button type="button" className="enq-quiet pl-new" aria-expanded={creating} onClick={() => { setCreating((open) => !open); }}>
                <Plus size={16} aria-hidden="true" /> New deal
              </button>
            </div>
            {sentence !== null && <SummarySentence parts={sentence} />}
          </header>

          {creating && (
            <NewDeal venueId={user?.venueId ?? null} onCancel={() => { setCreating(false); }}
              onCreated={(id) => { setCreating(false); readList(Math.max(PAGE, rows.length + 1)); openDeal(id, true); }} />
          )}

          <PipelineStages filter={filter} counts={counts} values={summary?.stageValues ?? null} currency={summary?.currency ?? "GBP"}
            onFilter={(next) => { setFilter(next); }} />

          {list.status === "loading" && <ActivityStatus className="enq-sheet__activity">Reading the pipeline…</ActivityStatus>}
          {list.status === "error" && (
            <div className="enq-notice enq-notice--alert" role="alert">
              <p>{list.previous === null ? "The pipeline could not be read." : "The pipeline could not be read again. This is how it last stood."}</p>
              <button type="button" className="enq-button" onClick={() => { readList(Math.max(PAGE, rows.length)); }}>Try again</button>
            </div>
          )}
          {list.status === "ready" && rows.length === 0 && (
            <div className="enq-empty">
              <h2>{filter === "all" ? "No deals yet" : `Nothing at ${dealStageWords(filter)}`}</h2>
              <p>{filter === "all" ? "A deal is opened from an enquiry on the Enquiries desk, or with New deal." : "Choose All open to see every deal."}</p>
            </div>
          )}

          <PipelineLedger rows={rows} selectedId={openId} nowMs={nowMs} year={year} onOpen={(deal) => { openDeal(deal.id, true); }} />

          {total !== null && total > rows.length && list.status === "ready" && (
            <div className="enq-more">
              <button type="button" className="enq-button" onClick={loadMore} disabled={loadingMore} aria-busy={loadingMore}>
                {loadingMore && <ActivityIndicator size={18} />}
                {loadingMore ? "Reading more…" : `Show more (${(total - rows.length).toLocaleString("en-GB")} more)`}
              </button>
            </div>
          )}
        </section>
      )}

      {detail.status === "ready" ? (
        <DealPanel
          key={detail.detail.opportunity.id}
          detail={detail.detail}
          nowMs={nowMs}
          saving={saving}
          failure={failure}
          announcement={announcement}
          stampKey={stampKey}
          headingRef={panelHeadingRef}
          navigation={{
            layout: wide ? "wide" : "single",
            canPrevious: openIndex > 0,
            canNext: openIndex >= 0 && openIndex < rows.length - 1,
            onClose: closeDeal,
            onStep: stepTo,
          }}
          onMove={onMove}
          onDraftProposal={onDraftProposal}
          onSaveValue={onSaveValue}
          onSaveNext={onSaveNext}
          onAddTask={onAddTask}
          onCompleteTask={onCompleteTask}
          onAddNote={onAddNote}
          onOpenProposal={(id) => { onOpenProposal?.(id); }}
          onOpenClient={(id) => { onOpenClient?.(id); }}
        />
      ) : detail.status !== "idle" ? (
        <section className="enq-panel pl-panel" data-register="forest" aria-label="Deal" aria-busy={detail.status === "loading"}>
          <div className="enq-panel__body">
            <div className="enq-panel__bar">
              <span />
              <button type="button" className="enq-close" onClick={closeDeal} aria-label="Close deal"><X size={18} aria-hidden="true" /></button>
            </div>
            {detail.status === "loading" && <ActivityStatus variant="panel">Opening the deal…</ActivityStatus>}
            {detail.status === "missing" && (
              <p className="enq-next__hint" role="alert" data-testid="opportunity-detail-error">This deal is not on the pipeline any more.</p>
            )}
            {detail.status === "error" && (
              <>
                <p className="enq-next__hint" role="alert" data-testid="opportunity-detail-error">The deal could not be opened.</p>
                <div className="enq-actions">
                  <button type="button" className="enq-quiet" onClick={() => { readAgain(detail.id, false); }}>Try again</button>
                </div>
              </>
            )}
          </div>
        </section>
      ) : wide ? (
        <PipelineOverview tasks={summary?.todayTasks ?? []} total={summary?.page?.taskTotal ?? null} nowMs={nowMs}
          onOpenDeal={(id) => { openDeal(id, true); }} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A new deal, for one that did not start as an enquiry
// ---------------------------------------------------------------------------

function NewDeal({ venueId, onCancel, onCreated }: {
  readonly venueId: string | null;
  readonly onCancel: () => void;
  readonly onCreated: (opportunityId: string) => void;
}): ReactElement {
  const headingId = useId();
  const [title, setTitle] = useState("");
  const [day, setDay] = useState("");
  const [guests, setGuests] = useState("");
  const [pounds, setPounds] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  const create = (): void => {
    if (saving || title.trim() === "") return;
    if (venueId === null) {
      setProblem("Your account is not linked to a venue, so a deal cannot be opened here.");
      return;
    }
    const value = pounds.trim() === "" ? 0 : parsePoundsToMinor(pounds);
    if (value === null) {
      setProblem("Enter the value in pounds, like 18400 or 18400.50.");
      return;
    }
    const guestCount = guests.trim() === "" ? null : Number(guests);
    if (guestCount !== null && (!Number.isInteger(guestCount) || guestCount < 0)) {
      setProblem("Enter the guests as a whole number.");
      return;
    }
    setSaving(true);
    setProblem(null);
    createOpportunity({
      venueId, title: title.trim(), estimatedValueMinor: value, guestCount,
      preferredDate: /^\d{4}-\d{2}-\d{2}$/u.test(day) ? day : null,
    })
      .then((result) => { onCreated(result.opportunity.id); })
      .catch(() => { setProblem("The deal was not opened. Nothing was saved; try again."); })
      .finally(() => { setSaving(false); });
  };

  return (
    <form className="pl-new-deal" aria-labelledby={headingId} onSubmit={(event) => { event.preventDefault(); create(); }}
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onCancel(); } }}>
      <h2 id={headingId}>A new deal</h2>
      <label className="pl-new-deal__title">
        <span>What it is</span>
        <input ref={titleRef} value={title} maxLength={200} required placeholder="Merchants' winter dinner" disabled={saving}
          data-testid="manual-opportunity-title" onChange={(event) => { setTitle(event.target.value); }} />
      </label>
      <label>
        <span>Event date</span>
        <input type="date" value={day} disabled={saving} onChange={(event) => { setDay(event.target.value); }} />
      </label>
      <label>
        <span>Guests</span>
        <input inputMode="numeric" value={guests} disabled={saving} onChange={(event) => { setGuests(event.target.value); }} />
      </label>
      <label>
        <span>Estimated value, £</span>
        <input inputMode="decimal" value={pounds} disabled={saving} data-testid="manual-opportunity-value"
          onChange={(event) => { setPounds(event.target.value); }} />
      </label>
      <div className="enq-actions">
        <button type="submit" className="enq-cta" disabled={saving || title.trim() === ""} aria-busy={saving}>
          {saving && <ActivityIndicator size={18} />}
          {saving ? "Opening…" : "Open the deal"}
        </button>
        <button type="button" className="enq-quiet" disabled={saving} onClick={onCancel}>Cancel</button>
      </div>
      {problem !== null && <p className="enq-confirm__error" role="alert" data-testid="manual-opportunity-error">{problem}</p>}
    </form>
  );
}
