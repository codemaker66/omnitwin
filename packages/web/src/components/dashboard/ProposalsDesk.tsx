import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import {
  findUnsupportedProposalClaim, PROPOSAL_VERSION_PAYLOAD_SCHEMA_VERSION, ProposalVersionPayloadSchema, type ProposalVersionPayload,
} from "@omnitwin/types";
import { Plus, X } from "lucide-react";
import { ApiError } from "../../api/client.js";
import {
  createProposal, createProposalShareToken, createProposalVersion, createQuote, getDeskProposal, getLatestProposalVersion,
  getProposalComments, getProposalHistory, listProposalDesk, postProposalComment, transitionProposal,
  type DeskProposal, type ProposalCommentRow, type ProposalDeskPage, type ProposalHistoryEntry, type StaffProposalVersion,
} from "../../api/proposals.js";
import { listSpaces, type Space } from "../../api/spaces.js";
import { useMediaQuery } from "../../hooks/use-media-query.js";
import { useLatestRequest } from "../../hooks/use-latest-request.js";
import { parsePoundsToMinor } from "../../lib/money-input.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { ActivityIndicator, ActivityStatus } from "../shared/Activity.js";
import { deskGreeting, venueYear, type SummaryPart } from "./enquiries/enquiry-desk-format.js";
import {
  ProposalPanel, type PartRead, type ProposalFailure, type ProposalPanelProps, type ProposalWork,
} from "./proposals/ProposalPanel.js";
import { ProposalsLedger } from "./proposals/ProposalsLedger.js";
import { ProposalsStages } from "./proposals/ProposalsStages.js";
import {
  groupRows, groupWords, proposalStatusWords, proposalsSummary, type ComposerDraft, type ProposalFilter,
} from "./proposals/proposals-desk-format.js";
import "./enquiries/EnquiriesDesk.css";
import "./pipeline/PipelineDesk.css";
import "./proposals/ProposalsDesk.css";

// ---------------------------------------------------------------------------
// ProposalsDesk — proposals as a desk (roadmap X1).
//
// The ledger groups proposals as a booker works them: what the client sent
// back, their own drafts, what is with the client, what was accepted, what is
// closed. Beside it the forest panel holds the one proposal open: who it is
// for and what it comes to, the next step its status allows (sending asks
// first), the next version starting from the last one, the conversation and
// the history. The open proposal is in the address (?proposal=), so the
// Clients desk and the pipeline land on it.
// ---------------------------------------------------------------------------

const WIDE_DESK = "(min-width: 1180px)";
const PAGE = 50;

export interface ProposalsDeskProps {
  /** A proposal to open from the address (?proposal=). */
  readonly proposalId?: string | null;
  /** Told which proposal is open, or null when none, so the address follows it. */
  readonly onProposalShown?: (proposalId: string | null) => void;
  /** Opens the proposal's deal in the pipeline. */
  readonly onOpenDeal?: (opportunityId: string) => void;
}

type ListState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly page: ProposalDeskPage; readonly rows: readonly DeskProposal[] }
  | { readonly status: "error"; readonly previous: { readonly page: ProposalDeskPage; readonly rows: readonly DeskProposal[] } | null };

type DetailState =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly id: string }
  | { readonly status: "ready"; readonly proposal: DeskProposal }
  | { readonly status: "missing"; readonly id: string }
  | { readonly status: "error"; readonly id: string };

/** A part of the open proposal, remembered with the proposal it belongs to,
 *  so another proposal's answer is never shown under this one. */
interface Part<T> extends PartRead<T> {
  readonly id: string | null;
}

const NOTHING: Part<never> = { id: null, status: "loading", value: null };

/** "Couldn't save" in words that say what is and is not true afterwards. */
const FAILURE_WORDS: Readonly<Record<ProposalFailure["where"], string>> = {
  step: "That did not go through. The proposal is as it was.",
  version: "The version did not save. Your changes are still here.",
  reply: "The reply was not posted. Your words are still here.",
};

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
}

function SummarySentence({ parts }: { readonly parts: readonly SummaryPart[] }): ReactElement {
  return (
    <p className="enq-summary" data-testid="proposals-summary">
      {parts.map((part, index) => typeof part === "string"
        ? <span key={index}>{part}</span>
        : <strong key={index} data-tone={part.tone}>{part.strong}</strong>)}
    </p>
  );
}

/** Reads a part of the open proposal whenever it opens or `read` changes,
 *  and lets a value the desk already holds (a version just saved) stand in
 *  for a read. */
function usePart<T>(id: string | null, read: string, load: (id: string) => Promise<T>): readonly [Part<T>, (id: string, value: T) => void] {
  const [part, setPart] = useState<Part<T>>(NOTHING);
  useEffect(() => {
    if (id === null) return;
    let current = true;
    // Asked again for the same proposal, what was read stays until the answer.
    setPart((previous) => ({ id, status: "loading", value: previous.id === id ? previous.value : null }));
    load(id)
      .then((value) => { if (current) setPart({ id, status: "ready", value }); })
      .catch(() => { if (current) setPart((previous) => ({ id, status: "error", value: previous.id === id ? previous.value : null })); });
    return () => { current = false; };
  }, [id, read, load]);
  const seed = useCallback((seedId: string, value: T): void => { setPart({ id: seedId, status: "ready", value }); }, []);
  return [part.id === id ? part : { id, status: "loading", value: null }, seed];
}

export function ProposalsDesk({ proposalId = null, onProposalShown, onOpenDeal }: ProposalsDeskProps = {}): ReactElement {
  const wide = useMediaQuery(WIDE_DESK);
  const titleId = useId();
  const user = useAuthStore((state) => state.user);
  const [nowMs] = useState(() => Date.now());
  const [filter, setFilter] = useState<ProposalFilter>("all");
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [listReading, setListReading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [detail, setDetail] = useState<DetailState>({ status: "idle" });
  const [refreshing, setRefreshing] = useState(false);
  const [working, setWorking] = useState<ProposalWork>(null);
  const [failure, setFailure] = useState<ProposalFailure | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [stampKey, setStampKey] = useState<number | null>(null);
  const [links, setLinks] = useState<Readonly<Record<string, string>>>({});
  const [creating, setCreating] = useState(false);
  const [reads, setReads] = useState({ latest: 0, history: 0, comments: 0 });
  const listRequest = useLatestRequest();
  // The proposal that should be open, and each time it should be read again.
  // The read is an effect keyed on it, so a read cut short (a newer proposal,
  // React's development double run) is simply made again, and a late answer
  // for a proposal no longer open is never shown.
  const [target, setTarget] = useState<{ readonly id: string; readonly read: number; readonly quietly: boolean } | null>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusPanelRef = useRef(false);
  const returnFocusRef = useRef<string | null>(null);
  const reportedRef = useRef<string | null>(null);
  const onShownRef = useRef(onProposalShown);
  useEffect(() => { onShownRef.current = onProposalShown; });

  const rows = list.status === "ready" ? list.rows : list.status === "error" ? list.previous?.rows ?? [] : [];
  const page = list.status === "ready" ? list.page : list.status === "error" ? list.previous?.page ?? null : null;
  const openId = target?.id ?? null;

  /** Reads the list from its start; `keep` rows keeps as many as are shown.
   *  A read started later wins, and drops a next page still on its way. */
  const readList = useCallback((keep = PAGE): void => {
    const owns = listRequest.begin();
    setListReading(true);
    setLoadingMore(false);
    setMoreFailed(false);
    const group = filter === "all" ? undefined : filter;
    listProposalDesk({ limit: Math.min(100, Math.max(PAGE, keep)), offset: 0, ...(group === undefined ? {} : { group }) })
      .then((next) => { if (owns()) setList({ status: "ready", page: next, rows: next.rows }); })
      .catch(() => {
        if (!owns()) return;
        setList((current) => ({
          status: "error",
          previous: current.status === "ready" ? { page: current.page, rows: current.rows } : current.status === "error" ? current.previous : null,
        }));
      })
      .finally(() => { if (owns()) setListReading(false); });
  }, [filter, listRequest]);

  useEffect(() => {
    setList({ status: "loading" });
    readList();
  }, [readList]);

  const loadMore = (): void => {
    if (list.status !== "ready" || loadingMore || listReading) return;
    const current = list;
    const owns = listRequest.begin();
    const group = filter === "all" ? undefined : filter;
    setLoadingMore(true);
    setMoreFailed(false);
    listProposalDesk({ limit: PAGE, offset: current.rows.length, ...(group === undefined ? {} : { group }) })
      .then((next) => {
        if (!owns()) return;
        setList({ status: "ready", page: next, rows: [...current.rows, ...next.rows.filter((row) => !current.rows.some((shown) => shown.id === row.id))] });
      })
      .catch(() => { if (owns()) setMoreFailed(true); })
      .finally(() => { if (owns()) setLoadingMore(false); });
  };

  // ---------------------------------------------------------------------------
  // The open proposal and its parts
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (target === null) {
      setDetail({ status: "idle" });
      setRefreshing(false);
      return;
    }
    let current = true;
    const { id, quietly } = target;
    if (quietly) setRefreshing(true);
    else setDetail({ status: "loading", id });
    getDeskProposal(id)
      .then((next) => { if (current) setDetail({ status: "ready", proposal: next }); })
      .catch((error: unknown) => {
        // A quiet re-read that fails keeps the proposal as it was last read.
        if (!current || quietly) return;
        setDetail(error instanceof ApiError && error.status === 404 ? { status: "missing", id } : { status: "error", id });
      })
      .finally(() => { if (current) setRefreshing(false); });
    return () => { current = false; };
  }, [target]);

  const proposal = detail.status === "ready" && detail.proposal.id === openId ? detail.proposal : null;
  const openVersion = proposal?.currentVersion ?? null;
  const loadLatest = useCallback((id: string): Promise<StaffProposalVersion> => getLatestProposalVersion(id), []);
  const loadHistory = useCallback((id: string): Promise<readonly ProposalHistoryEntry[]> => getProposalHistory(id), []);
  const loadComments = useCallback((id: string): Promise<readonly ProposalCommentRow[]> => getProposalComments(id), []);
  // The latest version is read once the proposal says there is one, and again
  // whenever its number changes.
  const [latest, seedLatest] = usePart(openVersion !== null && openVersion > 0 ? openId : null,
    `${String(openVersion)}:${String(reads.latest)}`, loadLatest);
  const [history] = usePart(openId, String(reads.history), loadHistory);
  const [comments] = usePart(openId, String(reads.comments), loadComments);

  // The venue's rooms power the capacity guidance; without them the note is
  // written by hand.
  const [spaces, setSpaces] = useState<PartRead<readonly Space[]>>({ status: "loading", value: null });
  const venueId = user?.venueId ?? null;
  useEffect(() => {
    if (venueId === null) {
      setSpaces({ status: "ready", value: [] });
      return;
    }
    let current = true;
    listSpaces(venueId)
      .then((rows) => { if (current) setSpaces({ status: "ready", value: rows }); })
      .catch(() => { if (current) setSpaces({ status: "error", value: [] }); });
    return () => { current = false; };
  }, [venueId]);

  // The address follows the proposal that is open.
  const targetId = target?.id ?? null;
  useEffect(() => {
    if (reportedRef.current === targetId) return;
    reportedRef.current = targetId;
    onShownRef.current?.(targetId);
  }, [targetId]);

  const openProposal = useCallback((id: string, byReader: boolean): void => {
    if (byReader) focusPanelRef.current = true;
    setFailure(null);
    setAnnouncement(null);
    setStampKey(null);
    setTarget((current) => {
      if (current?.id === id) {
        if (byReader) panelHeadingRef.current?.focus();
        return current;
      }
      return { id, read: 0, quietly: false };
    });
  }, []);

  const readAgain = useCallback((id: string): void => {
    setTarget((current) => current?.id === id ? { id, read: current.read + 1, quietly: true } : current);
  }, []);

  const closeProposal = useCallback((): void => {
    setTarget((current) => {
      returnFocusRef.current = current?.id ?? null;
      return null;
    });
    setFailure(null);
  }, []);

  // A proposal linked from the address opens beside the ledger; the browser's
  // Back closes it, and a reader who was in it returns to its row.
  useEffect(() => {
    if (proposalId !== null) {
      openProposal(proposalId, false);
      return;
    }
    setTarget((current) => {
      if (current === null) return current;
      const active = document.activeElement;
      if (active === null || active === document.body || active.closest(".pr-panel") !== null) returnFocusRef.current = current.id;
      return null;
    });
  }, [proposalId, openProposal]);

  // Focus follows the reader into a proposal they opened, and back to its row
  // once it is closed and the ledger is on screen again.
  useEffect(() => {
    if (detail.status === "ready" && focusPanelRef.current) {
      focusPanelRef.current = false;
      panelHeadingRef.current?.focus();
    }
    if (detail.status === "idle" && returnFocusRef.current !== null) {
      const id = returnFocusRef.current;
      returnFocusRef.current = null;
      document.querySelector<HTMLElement>(`button[data-proposal-id="${CSS.escape(id)}"]`)?.focus();
    }
  }, [detail]);

  const ordered = groupRows(rows).flatMap((group) => group.rows);
  const openIndex = ordered.findIndex((row) => row.id === openId);
  const stepTo = (direction: 1 | -1): void => {
    const next = ordered[openIndex + direction];
    if (openIndex >= 0 && next !== undefined) openProposal(next.id, true);
  };

  // ---------------------------------------------------------------------------
  // What the panel changes. Each is made for the proposal it was started on,
  // whatever is open when it answers, and says so only there.
  // ---------------------------------------------------------------------------

  const openIdRef = useRef<string | null>(null);
  useEffect(() => { openIdRef.current = openId; }, [openId]);

  /** A proposal the API has just answered with, over the one open. */
  const applyProposal = (next: Partial<DeskProposal> & { readonly id: string }): void => {
    setDetail((state) => state.status === "ready" && state.proposal.id === next.id
      ? { status: "ready", proposal: { ...state.proposal, ...next } } : state);
  };

  const attempt = async (where: ProposalFailure["where"], work: ProposalWork, action: (id: string) => Promise<string | null>): Promise<boolean> => {
    if (proposal === null || working !== null) return false;
    const id = proposal.id;
    setWorking(work);
    setFailure(null);
    try {
      const said = await action(id);
      if (openIdRef.current === id && said !== null) setAnnouncement(said);
      return true;
    } catch (error: unknown) {
      if (openIdRef.current === id) {
        setFailure({ where, message: error instanceof RefusedHere ? error.message : FAILURE_WORDS[where] });
      }
      return false;
    } finally {
      setWorking(null);
    }
  };

  const onMakeLink = (): Promise<boolean> => attempt("step", "link", async (id) => {
    const made = await createProposalShareToken(id);
    setLinks((current) => ({ ...current, [id]: `${window.location.origin}${made.shareUrl}` }));
    if (made.proposal.status !== proposal?.status) setStampKey(Date.now());
    applyProposal(made.proposal);
    readAgain(id);
    setReads((current) => ({ ...current, history: current.history + 1 }));
    readList(Math.max(PAGE, rows.length));
    return "The client's link is made. Copy it into your message to them.";
  });

  const onTransition = (to: "withdrawn" | "archived"): Promise<boolean> => attempt("step", to === "withdrawn" ? "withdraw" : "archive", async (id) => {
    applyProposal(await transitionProposal(id, to));
    setStampKey(Date.now());
    readAgain(id);
    setReads((current) => ({ ...current, history: current.history + 1 }));
    readList(Math.max(PAGE, rows.length));
    return `The proposal is ${proposalStatusWords(to).toLowerCase()}.`;
  });

  const onSaveVersion = (draft: ComposerDraft): Promise<boolean> => attempt("version", "version", async (id) => {
    if (proposal === null) return null;
    const lines = readQuoteLines(draft);
    const candidate = {
      schemaVersion: PROPOSAL_VERSION_PAYLOAD_SCHEMA_VERSION,
      title: proposal.title,
      clientMessage: draft.message.trim() === "" ? null : draft.message.trim(),
      configurationId: proposal.configurationId,
      layoutRevision: null,
      capacityNote: draft.capacityNote.trim() === "" ? null : draft.capacityNote.trim(),
      quote: null,
    };
    // The claim guard runs before anything is kept, so unsupported certainty
    // wording is explained here rather than refused by the API.
    const checked = ProposalVersionPayloadSchema.safeParse(candidate);
    if (!checked.success) throw new RefusedHere(checked.error.issues[0]?.message ?? "The proposal's words are not valid.");
    let quote: ProposalVersionPayload["quote"] = null;
    if (lines.length > 0) {
      // Totals come back from the server's exact money engine; the snapshot
      // uses them as they are, never adding them up here.
      const made = await createQuote({
        venueId: proposal.venueId, opportunityId: proposal.opportunityId, proposalId: id,
        name: `${proposal.title} quote`, currency: "GBP", lineItems: [...lines],
      });
      quote = {
        quoteId: made.id,
        currency: "GBP",
        lineItems: made.lineItems.map((item) => ({
          description: item.description, quantity: item.quantity, unitAmountMinor: item.unitAmountMinor, lineTotalMinor: item.lineTotalMinor,
        })),
        subtotalMinor: made.subtotalMinor,
        totalMinor: made.totalMinor,
      };
    }
    const saved = await createProposalVersion(id, { ...checked.data, quote });
    // The next version starts from this one at once; the proposal is then
    // read again for what the server made of it.
    seedLatest(id, saved);
    applyProposal({ id, currentVersion: saved.version, latestTotalMinor: quote?.totalMinor ?? null, latestCurrency: quote === null ? null : "GBP" });
    readAgain(id);
    readList(Math.max(PAGE, rows.length));
    return `Version ${String(saved.version)} is saved.`;
  });

  const onReply = (body: string): Promise<boolean> => attempt("reply", "reply", async (id) => {
    const claim = findUnsupportedProposalClaim(body);
    if (claim !== null) {
      throw new RefusedHere(`The reply says "${claim}", a certainty the venue cannot show a client. Reword it and post again.`);
    }
    await postProposalComment(id, body.trim());
    setReads((current) => ({ ...current, comments: current.comments + 1 }));
    return "The reply is posted.";
  });

  // ---------------------------------------------------------------------------
  // The desk
  // ---------------------------------------------------------------------------

  const onDeskKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Escape" || event.defaultPrevented || openId === null || isEditable(event.target)) return;
    event.preventDefault();
    closeProposal();
  };

  const greeting = deskGreeting(nowMs, user?.name ?? null);
  const year = venueYear(nowMs);
  const sentence = proposalsSummary(page?.statusCounts ?? null);
  const total = page?.total ?? null;
  const showSheet = wide || openId === null;

  const panelProps: Omit<ProposalPanelProps, "proposal"> = {
    refreshing,
    nowMs,
    navigation: {
      layout: wide ? "wide" : "single",
      canPrevious: openIndex > 0,
      canNext: openIndex >= 0 && openIndex < ordered.length - 1,
      onClose: closeProposal,
      onStep: stepTo,
    },
    headingRef: panelHeadingRef,
    announcement,
    stampKey,
    latest,
    history,
    comments,
    spaces,
    shareUrl: openId === null ? null : links[openId] ?? null,
    working,
    failure,
    onMakeLink,
    onTransition,
    onSaveVersion,
    onReply,
    onRetryLatest: () => { setReads((current) => ({ ...current, latest: current.latest + 1 })); },
    onRetryHistory: () => { setReads((current) => ({ ...current, history: current.history + 1 })); },
    onRetryComments: () => { setReads((current) => ({ ...current, comments: current.comments + 1 })); },
    onOpenDeal: onOpenDeal ?? null,
  };

  return (
    <div className={`enq-desk pr-desk${wide ? "" : " enq-desk--single"}`} data-register="ivory" onKeyDown={onDeskKey}>
      {showSheet && (
        <section className="enq-sheet" aria-labelledby={titleId}>
          <header className="enq-head pl-head">
            <p className="enq-greeting">
              <span>{greeting.date}</span>
              <span aria-hidden="true">·</span>
              <span>{greeting.greeting}</span>
            </p>
            <div className="pl-title">
              <h1 id={titleId}>Proposals</h1>
              <button type="button" className="enq-quiet pl-new" aria-expanded={creating} onClick={() => { setCreating((open) => !open); }}>
                <Plus size={16} aria-hidden="true" /> New proposal
              </button>
            </div>
            {sentence !== null && <SummarySentence parts={sentence} />}
          </header>

          {creating && (
            <NewProposal venueId={venueId} onCancel={() => { setCreating(false); }}
              onCreated={(id) => { setCreating(false); readList(Math.max(PAGE, rows.length + 1)); openProposal(id, true); }} />
          )}

          <ProposalsStages filter={filter} counts={page?.statusCounts ?? null} onFilter={(next) => { setFilter(next); }} />

          {list.status === "loading" && <ActivityStatus className="enq-sheet__activity">Reading the proposals…</ActivityStatus>}
          {list.status === "ready" && listReading && <ActivityStatus className="enq-sheet__activity">Reading the proposals again…</ActivityStatus>}
          {list.status === "error" && (
            <div className="enq-notice enq-notice--alert" role="alert" data-testid="proposal-list-error">
              <p>{list.previous === null ? "The proposals could not be read." : "The proposals could not be read again. This is how they last stood."}</p>
              <button type="button" className="enq-button" disabled={listReading} onClick={() => { readList(Math.max(PAGE, rows.length)); }}>Try again</button>
            </div>
          )}
          {list.status === "ready" && rows.length === 0 && (
            <div className="enq-empty">
              <h2>{filter === "all" ? "No proposals yet" : `Nothing under ${groupWords(filter)}`}</h2>
              <p>{filter === "all" ? "A proposal is drafted from a deal in the pipeline, or with New proposal." : "Choose All to see every proposal."}</p>
            </div>
          )}

          <ProposalsLedger rows={rows} selectedId={openId} nowMs={nowMs} year={year} onOpen={(row) => { openProposal(row.id, true); }} />

          {total !== null && total > rows.length && list.status === "ready" && (
            <div className="enq-more" data-testid="proposals-more">
              <p className="enq-next__hint">Showing {rows.length.toLocaleString("en-GB")} of {total.toLocaleString("en-GB")}.</p>
              <button type="button" className="enq-button" onClick={loadMore} disabled={loadingMore || listReading} aria-busy={loadingMore}>
                {loadingMore && <ActivityIndicator size={18} />}
                {loadingMore ? "Reading more…" : `Show more (${(total - rows.length).toLocaleString("en-GB")} more)`}
              </button>
              {moreFailed && <p className="enq-confirm__error" role="alert">The next proposals could not be read. Those shown are as they were.</p>}
            </div>
          )}
        </section>
      )}

      {proposal !== null ? (
        <ProposalPanel key={proposal.id} proposal={proposal} {...panelProps} />
      ) : detail.status !== "idle" ? (
        <section className="enq-panel pr-panel" data-register="forest" aria-label="Proposal" aria-busy={detail.status === "loading"}>
          <div className="enq-panel__body">
            <div className="enq-panel__bar">
              <span />
              <button type="button" className="enq-close" onClick={closeProposal} aria-label="Close proposal"><X size={18} aria-hidden="true" /></button>
            </div>
            {detail.status === "loading" && <ActivityStatus variant="panel">Opening the proposal…</ActivityStatus>}
            {detail.status === "missing" && (
              <p className="enq-next__hint" role="alert" data-testid="proposal-link-failure">This proposal is not here any more. It may have been removed.</p>
            )}
            {detail.status === "error" && (
              <>
                <p className="enq-next__hint" role="alert" data-testid="proposal-link-failure">The proposal could not be opened.</p>
                <div className="enq-actions">
                  <button type="button" className="enq-quiet" onClick={() => { setTarget((current) => current === null ? null : { ...current, read: current.read + 1, quietly: false }); }}>
                    Try again
                  </button>
                </div>
              </>
            )}
          </div>
        </section>
      ) : wide ? (
        <section className="enq-panel enq-panel--rest pr-panel" data-register="forest" aria-label="No proposal open">
          <div className="enq-panel__body">
            <p className="enq-eyebrow">Proposals</p>
            <p className="pr-rest">Open a proposal to write its next version, send it, and read what the client said.</p>
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** A refusal the desk can put in words before anything is kept. */
class RefusedHere extends Error {}

/** The quote lines as the API takes them, or a refusal naming the line. */
function readQuoteLines(draft: ComposerDraft): readonly { description: string; quantity: number; unitAmountMinor: number }[] {
  return draft.lines.map((line, index) => {
    const at = `Quote line ${String(index + 1)}`;
    const quantity = Number(line.quantity);
    const unitAmountMinor = parsePoundsToMinor(line.pounds);
    if (line.description.trim() === "") throw new RefusedHere(`${at} needs a description.`);
    if (!Number.isInteger(quantity) || quantity < 1) throw new RefusedHere(`${at} needs a whole-number quantity of at least 1.`);
    if (unitAmountMinor === null) throw new RefusedHere(`${at} needs a price like 120 or 120.50.`);
    return { description: line.description.trim(), quantity, unitAmountMinor };
  });
}

// ---------------------------------------------------------------------------
// A new proposal, started in the sheet
// ---------------------------------------------------------------------------

interface NewProposalProps {
  readonly venueId: string | null;
  readonly onCancel: () => void;
  readonly onCreated: (id: string) => void;
}

function NewProposal({ venueId, onCancel, onCreated }: NewProposalProps): ReactElement {
  const headingId = useId();
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    if (venueId === null || title.trim() === "" || saving) return;
    setSaving(true);
    setError(null);
    createProposal({ venueId, title: title.trim() })
      .then((created) => { onCreated(created.id); })
      .catch(() => { setError("The proposal was not started. Check the title and try again."); })
      .finally(() => { setSaving(false); });
  };

  if (venueId === null) {
    return (
      <div className="pl-new-deal" role="group" aria-labelledby={headingId}>
        <h2 id={headingId}>New proposal</h2>
        <p className="enq-next__hint">Your account is not linked to a venue, so a proposal cannot be started here.</p>
      </div>
    );
  }

  return (
    <form className="pl-new-deal" aria-labelledby={headingId} onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <h2 id={headingId}>New proposal</h2>
      <p className="enq-next__hint">A proposal made from a deal in the pipeline brings its client, date and guests with it.</p>
      <label className="pr-field">
        <span>What it is</span>
        <input data-testid="create-title" value={title} maxLength={200} placeholder="Autumn gala in the Grand Hall" disabled={saving}
          onChange={(event) => { setTitle(event.target.value); }} />
      </label>
      {error !== null && <p className="enq-confirm__error" role="alert" data-testid="create-error">{error}</p>}
      <div className="enq-actions">
        <button type="submit" className="enq-cta" data-testid="create-submit" disabled={saving || title.trim() === ""} aria-busy={saving}>
          {saving && <ActivityIndicator size={18} />}
          {saving ? "Starting…" : "Start the proposal"}
        </button>
        <button type="button" className="enq-quiet" disabled={saving} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
