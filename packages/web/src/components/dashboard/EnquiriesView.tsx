import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import * as enquiriesApi from "../../api/enquiries.js";
import type {
  Enquiry, EnquiryListOrder, EnquiryListQuery, EnquiryStageCounts, StatusHistoryEntry,
} from "../../api/enquiries.js";
import { ApiError } from "../../api/client.js";
import { createOpportunityFromEnquiry } from "../../api/crm.js";
import { useMediaQuery } from "../../hooks/use-media-query.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { useToastStore } from "../../stores/toast-store.js";
import { ActivityIndicator, ActivityStatus } from "../shared/Activity.js";
import {
  appendEnquiryPage, describeEnquiryCount, ENQUIRY_PAGE_SIZE, firstPageWindow, hasMoreEnquiries,
  nextPageWindow, withoutListedEnquiry, type ListedEnquiries,
} from "./enquiry-list-paging.js";
import { EnquiryStages } from "./enquiries/EnquiryStages.js";
import { EnquiryLedger, enquiryName, type LedgerStamp } from "./enquiries/EnquiryLedger.js";
import { EnquiryPanel, type TransitionTarget } from "./enquiries/EnquiryPanel.js";
import { EnquiryOverview } from "./enquiries/EnquiryOverview.js";
import { useVenueRooms } from "./enquiries/use-venue-rooms.js";
import { deskGreeting, deskSummary, stageLabel, type DeskFilter } from "./enquiries/enquiry-desk-format.js";
import "./enquiries/EnquiriesDesk.css";

// ---------------------------------------------------------------------------
// EnquiriesView — the staff enquiries desk.
//
// The sheet lists enquiries newest first under the pipeline counts, which are
// also the filters; the decision panel beside it holds the open enquiry, so
// the list keeps its place while staff work through it. Below 1180px the two
// take turns, as the list and detail always did.
//
// Newest first by creation date. Whether staff would rather see the most
// recently active enquiries first is Blake's call; that order would need an
// `updated_desc` option (and index) in the API, which offers only
// `created_desc` and the default least-recently-updated order.
// ---------------------------------------------------------------------------

const LIST_ORDER: EnquiryListOrder = "created_desc";
const WIDE_DESK = "(min-width: 1180px)";

/** The list for one load of one stage filter. */
interface EnquiryListState extends ListedEnquiries {
  /** Identifies the load; a response for an older one is discarded. */
  readonly generation: number;
  readonly filter: DeskFilter;
  readonly status: "loading" | "ready" | "error";
  /** The order the server confirmed; null when an older API did not say. */
  readonly order: EnquiryListOrder | null;
  readonly loadingMore: boolean;
  readonly moreFailed: boolean;
  /** A later page could not be joined to the listed rows, or the finished
   *  list no longer matches the server's total. */
  readonly interrupted: boolean;
}

const UNLOADED_LIST: EnquiryListState = {
  generation: 0, filter: "all", status: "loading", rows: [], nextOffset: 0, total: 0,
  order: null, loadingMore: false, moreFailed: false, interrupted: false,
};

interface CountsState {
  readonly status: "loading" | "ready" | "error";
  /** The latest counts; kept while they are refreshed. */
  readonly value: EnquiryStageCounts | null;
}

interface HistoryState {
  readonly id: string | null;
  readonly entries: readonly StatusHistoryEntry[];
  readonly status: "loading" | "ready" | "error";
}

type PendingFocus =
  | { readonly kind: "panel" }
  | { readonly kind: "row"; readonly id: string }
  /** The control that asked for a confirmation the reader then cancelled. */
  | { readonly kind: "action"; readonly to: TransitionTarget };

function listQuery(filter: DeskFilter): EnquiryListQuery {
  return filter === "all" ? { order: LIST_ORDER } : { status: filter, order: LIST_ORDER };
}

type CountedState = (typeof enquiriesApi.COUNTED_ENQUIRY_STATES)[number];

function isCountedState(state: string): state is CountedState {
  return (enquiriesApi.COUNTED_ENQUIRY_STATES as readonly string[]).includes(state);
}

/** The counts once one enquiry has moved between stages here, until the
 *  server's own counts replace them. */
function countsAfterMove(counts: EnquiryStageCounts, enquiryId: string, from: string, to: string): EnquiryStageCounts {
  const byState = { ...counts.byState };
  if (isCountedState(from)) byState[from] = Math.max(0, byState[from] - 1);
  if (isCountedState(to)) byState[to] += 1;
  return { ...counts, byState, longestWaiting: counts.longestWaiting?.id === enquiryId ? null : counts.longestWaiting };
}

const ANNOUNCEMENTS: Readonly<Record<string, string>> = {
  under_review: "Now in review.",
  approved: "Approved.",
  rejected: "Declined.",
};

/** Empty-list words for each stage: an empty "New" is a finished job. */
const EMPTY_WORDS: Readonly<Record<DeskFilter, readonly [heading: string, detail: string]>> = {
  submitted: ["Nothing new to answer", "Every new enquiry has had a first look."],
  under_review: ["No decisions waiting", "Nothing is in review."],
  approved: ["No approved enquiries", "Approved enquiries appear here."],
  rejected: ["No declined enquiries", "Declined enquiries appear here."],
  withdrawn: ["No withdrawn enquiries", "Enquiries a client withdraws appear here."],
  all: ["No enquiries yet", "Enquiries from the venue’s website and planner arrive here."],
};

// ---------------------------------------------------------------------------
// Props — punch list #34
//
// `initialSelectedId` is set when the user navigates here from a different
// view (e.g. clicking an enquiry in ClientProfile). The component pre-selects
// that enquiry on mount AND fetches it independently via `getEnquiry`, so
// the decision panel renders even when the loaded pages of the current stage
// filter don't include it.
//
// `onDetailClose` is called when the user closes the open enquiry. When
// provided, the parent decides where that goes (e.g. restoring the
// ClientProfile they came from). When omitted, closing returns to the desk.
// ---------------------------------------------------------------------------

interface EnquiriesViewProps {
  readonly initialSelectedId?: string | null;
  readonly onDetailClose?: () => void;
}

export function EnquiriesView({ initialSelectedId = null, onDetailClose }: EnquiriesViewProps = {}): ReactElement {
  const wide = useMediaQuery(WIDE_DESK);
  const titleId = useId();
  const [list, setList] = useState<EnquiryListState>(UNLOADED_LIST);
  const [statusFilter, setStatusFilter] = useState<DeskFilter>("all");
  const [reloadCount, setReloadCount] = useState(0);
  const generationRef = useRef(0);
  const loadMoreRef = useRef<AbortController | null>(null);
  const [counts, setCounts] = useState<CountsState>({ status: "loading", value: null });
  const [countsVersion, setCountsVersion] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  // The enquiry the panel shows: the opened row, or the independent fetch
  // for the cross-view pre-selection case. It survives the list dropping the
  // row after a status change.
  const [openedEnquiry, setOpenedEnquiry] = useState<Enquiry | null>(null);
  const [preselectionLoading, setPreselectionLoading] = useState(initialSelectedId !== null);
  const [history, setHistory] = useState<HistoryState>({ id: null, entries: [], status: "ready" });
  const [historyVersion, setHistoryVersion] = useState(0);
  const [confirming, setConfirming] = useState<TransitionTarget | null>(null);
  const [saving, setSaving] = useState<TransitionTarget | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [stamp, setStamp] = useState<LedgerStamp | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [moved, setMoved] = useState(0);
  const [creatingOpportunity, setCreatingOpportunity] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const deskRef = useRef<HTMLDivElement>(null);
  const sheetHeadingRef = useRef<HTMLHeadingElement>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const selectedIdRef = useRef(selectedId);
  // Where the open enquiry sat in the list, so "next" still means the row
  // after it once a status change has taken it out of the filter.
  const [openedIndex, setOpenedIndex] = useState(-1);
  const pendingFocusRef = useRef<PendingFocus | null>(initialSelectedId === null ? null : { kind: "panel" });
  const addToast = useToastStore((s) => s.addToast);
  const userName = useAuthStore((s) => s.user?.name ?? null);

  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  // "2 hours ago" stays true while the desk is open all day.
  useEffect(() => {
    const timer = window.setInterval(() => { setNowMs(Date.now()); }, 60_000);
    return () => { window.clearInterval(timer); };
  }, []);

  // A filter change or reload starts a new list: its first page, and any
  // in-flight first page or "show more" of the previous list, is aborted
  // and could not land anyway because its generation no longer matches.
  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    const controller = new AbortController();
    setList((previous) => ({
      ...UNLOADED_LIST,
      generation,
      filter: statusFilter,
      // A reload keeps the filter's rows visible until the new page lands.
      rows: previous.filter === statusFilter ? previous.rows : [],
    }));
    void enquiriesApi.listEnquiryPage({ ...listQuery(statusFilter), ...firstPageWindow() }, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setList((previous) => previous.generation !== generation ? previous : {
          ...previous, status: "ready", rows: page.rows, nextOffset: page.offset + page.rows.length,
          total: page.total, order: page.order,
        });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setList((previous) => previous.generation !== generation ? previous : { ...previous, status: "error" });
        addToast("Failed to load enquiries", "error");
      });
    return () => {
      controller.abort();
      loadMoreRef.current?.abort();
      loadMoreRef.current = null;
    };
  }, [statusFilter, reloadCount, addToast]);

  // The pipeline counts, refreshed after every change made here.
  useEffect(() => {
    const controller = new AbortController();
    setCounts((previous) => ({ ...previous, status: "loading" }));
    void enquiriesApi.countEnquiryStages(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setCounts({ status: "ready", value });
      })
      .catch(() => {
        if (!controller.signal.aborted) setCounts((previous) => ({ ...previous, status: "error" }));
      });
    return () => { controller.abort(); };
  }, [countsVersion, reloadCount]);

  const showMore = useCallback((): void => {
    if (list.status !== "ready" || list.loadingMore || !hasMoreEnquiries(list)) return;
    const { generation, filter } = list;
    loadMoreRef.current?.abort();
    const controller = new AbortController();
    loadMoreRef.current = controller;
    setList((previous) => previous.generation !== generation ? previous
      : { ...previous, loadingMore: true, moreFailed: false });
    void enquiriesApi.listEnquiryPage({ ...listQuery(filter), ...nextPageWindow(list) }, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setList((previous) => {
          if (previous.generation !== generation) return previous;
          const appended = appendEnquiryPage(previous, page);
          // A page in another order (an API redeployed mid-list) cannot be
          // joined either, and a finished list must hold what the total says.
          const finishedAdrift = !hasMoreEnquiries(appended) && appended.rows.length !== appended.total;
          return {
            ...previous, rows: appended.rows, nextOffset: appended.nextOffset, total: appended.total,
            loadingMore: false,
            interrupted: previous.interrupted || !appended.continuous || page.order !== previous.order || finishedAdrift,
          };
        });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setList((previous) => previous.generation !== generation ? previous
          : { ...previous, loadingMore: false, moreFailed: true });
      })
      .finally(() => {
        if (loadMoreRef.current === controller) loadMoreRef.current = null;
      });
  }, [list]);

  // Working through a stage empties its listed rows; when more wait on the
  // server, they follow without another click.
  const listRanDry = list.status === "ready" && list.rows.length === 0 && hasMoreEnquiries(list)
    && !list.loadingMore && !list.moreFailed;
  useEffect(() => {
    if (listRanDry) showMore();
  }, [listRanDry, showMore]);

  const reloadList = (): void => { setReloadCount((count) => count + 1); };

  // When pre-selected via initialSelectedId, fetch the enquiry directly so
  // the panel can render regardless of the active stage filter.
  useEffect(() => {
    if (initialSelectedId === null) {
      setPreselectionLoading(false);
      return;
    }
    const controller = new AbortController();
    setPreselectionLoading(true);
    setSelectedId(initialSelectedId);
    void enquiriesApi.getEnquiry(initialSelectedId, controller.signal)
      .then((enquiry) => {
        if (!controller.signal.aborted) setOpenedEnquiry(enquiry);
      })
      .catch(() => {
        if (!controller.signal.aborted) addToast("Failed to load enquiry", "error");
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreselectionLoading(false);
      });
    return () => { controller.abort(); };
  }, [initialSelectedId, addToast]);

  // Prefer the opened enquiry if it matches the selected id; otherwise fall
  // back to the list lookup.
  const selected = (openedEnquiry !== null && openedEnquiry.id === selectedId)
    ? openedEnquiry
    : list.rows.find((e) => e.id === selectedId);

  useEffect(() => {
    if (selectedId === null) {
      setHistory({ id: null, entries: [], status: "ready" });
      return;
    }
    const controller = new AbortController();
    // A refresh after a status change keeps the timeline it is extending.
    setHistory((previous) => previous.id === selectedId
      ? { ...previous, status: "loading" }
      : { id: selectedId, entries: [], status: "loading" });
    void enquiriesApi.getEnquiryHistory(selectedId, controller.signal)
      .then((entries) => {
        if (!controller.signal.aborted) setHistory({ id: selectedId, entries, status: "ready" });
      })
      .catch(() => {
        // An absent timeline does not block enquiry review.
        if (!controller.signal.aborted) setHistory((previous) => ({ ...previous, status: "error" }));
      });
    return () => { controller.abort(); };
  }, [selectedId, historyVersion]);

  // Keyboard focus follows the reader: into the panel when an enquiry opens,
  // back to its row when it closes.
  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (pending === null) return;
    if (pending.kind === "panel") {
      if (panelHeadingRef.current === null) return;
      pendingFocusRef.current = null;
      panelHeadingRef.current.focus();
      return;
    }
    pendingFocusRef.current = null;
    if (pending.kind === "action") {
      const action = deskRef.current?.querySelector<HTMLButtonElement>(`button[data-transition="${pending.to}"]`);
      (action ?? panelHeadingRef.current)?.focus();
      return;
    }
    const rows = deskRef.current?.querySelectorAll<HTMLButtonElement>("button[data-enquiry-id]") ?? [];
    const row = [...rows].find((button) => button.dataset.enquiryId === pending.id);
    (row ?? sheetHeadingRef.current)?.focus();
  });

  const roomOf = useVenueRooms([
    ...list.rows.map((row) => row.venueId),
    ...(selected === undefined ? [] : [selected.venueId]),
    ...(counts.value?.longestWaiting === undefined || counts.value.longestWaiting === null ? [] : [counts.value.longestWaiting.venueId]),
  ]);

  const open = (enquiry: Enquiry): void => {
    setOpenedIndex(list.rows.findIndex((row) => row.id === enquiry.id));
    setSelectedId(enquiry.id);
    setOpenedEnquiry(enquiry);
    setConfirming(null);
    setFailure(null);
    setAnnouncement(null);
    pendingFocusRef.current = { kind: "panel" };
  };

  const close = (): void => {
    const closing = selectedId;
    setSelectedId(null);
    setOpenedEnquiry(null);
    setConfirming(null);
    setFailure(null);
    setAnnouncement(null);
    if (onDetailClose !== undefined) {
      onDetailClose();
      return;
    }
    if (closing !== null) pendingFocusRef.current = { kind: "row", id: closing };
  };

  const listedIndex = selectedId === null ? -1 : list.rows.findIndex((row) => row.id === selectedId);
  const stepTarget = (direction: 1 | -1): Enquiry | undefined => {
    if (listedIndex >= 0) return list.rows[listedIndex + direction];
    if (openedIndex < 0) return undefined;
    // The open enquiry left this filter: the row that took its place is next.
    return list.rows[direction === 1 ? openedIndex : openedIndex - 1];
  };
  const step = (direction: 1 | -1): void => {
    const target = stepTarget(direction);
    if (target !== undefined) open(target);
  };

  const applyUpdated = (updated: Enquiry): void => {
    // A stage-filtered list drops an enquiry that no longer matches, and its
    // later pages shift up one; "all" keeps it with its new status.
    setList((previous) => previous.filter === "all" || updated.state === previous.filter
      ? { ...previous, rows: previous.rows.map((e) => e.id === updated.id ? updated : e) }
      : { ...previous, ...withoutListedEnquiry(previous, updated.id) });
    setOpenedEnquiry((opened) => opened !== null && opened.id === updated.id ? updated : opened);
  };

  const runTransition = async (enquiry: Enquiry, to: TransitionTarget, note: string | undefined): Promise<void> => {
    setSaving(to);
    setFailure(null);
    const stillOpen = (): boolean => selectedIdRef.current === enquiry.id;
    try {
      const updated = await enquiriesApi.transitionEnquiry(enquiry.id, to, note);
      applyUpdated(updated);
      setCounts((previous) => previous.value === null ? previous
        : { ...previous, value: countsAfterMove(previous.value, enquiry.id, enquiry.state, updated.state) });
      setCountsVersion((version) => version + 1);
      setHistoryVersion((version) => version + 1);
      setStamp((previous) => ({ id: updated.id, key: (previous?.key ?? 0) + 1 }));
      setMoved((count) => count + 1);
      if (stillOpen()) {
        setConfirming(null);
        setAnnouncement(ANNOUNCEMENTS[updated.state] ?? `${stageLabel(updated.state)}.`);
        panelHeadingRef.current?.focus();
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === "INVALID_TRANSITION") {
        // Someone else moved it on first: show where it really is.
        try {
          const current = await enquiriesApi.getEnquiry(enquiry.id);
          applyUpdated(current);
          setCountsVersion((version) => version + 1);
          setHistoryVersion((version) => version + 1);
          if (stillOpen()) {
            setConfirming(null);
            setFailure(`This enquiry had already moved on. It is ${stageLabel(current.state).toLowerCase()} now.`);
          }
        } catch {
          if (stillOpen()) setFailure("The status could not be changed. Reload the list to see where this enquiry is.");
        }
      } else if (stillOpen()) {
        setFailure("The status could not be changed. Try again.");
      }
      if (!stillOpen()) addToast(`${enquiryName(enquiry)}’s status could not be changed`, "error");
    } finally {
      setSaving(null);
    }
  };

  const requestTransition = (to: TransitionTarget, withNote: boolean): void => {
    if (selected === undefined || saving !== null) return;
    setFailure(null);
    setAnnouncement(null);
    // Starting a review sends nothing, so it happens at once; a decision
    // emails the client and is confirmed first.
    if (to === "under_review" && !withNote) {
      void runTransition(selected, to, undefined);
      return;
    }
    setConfirming(to);
  };

  const confirmTransition = (note: string): void => {
    if (selected === undefined || confirming === null || saving !== null) return;
    const trimmed = note.trim();
    void runTransition(selected, confirming, trimmed === "" ? undefined : trimmed);
  };

  const cancelTransition = (): void => {
    if (saving !== null || confirming === null) return;
    pendingFocusRef.current = { kind: "action", to: confirming };
    setConfirming(null);
    setFailure(null);
  };

  const handleCreateOpportunity = async (enquiry: Enquiry): Promise<void> => {
    if (creatingOpportunity) return;
    setCreatingOpportunity(true);
    try {
      const result = await createOpportunityFromEnquiry(enquiry.id);
      addToast(result.created ? "Opportunity created from enquiry" : "Existing opportunity opened", "success");
    } catch {
      addToast("Failed to create opportunity from enquiry", "error");
    } finally {
      setCreatingOpportunity(false);
    }
  };

  const onDeskKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (confirming !== null) {
      event.preventDefault();
      cancelTransition();
      return;
    }
    if (selectedId !== null) {
      event.preventDefault();
      close();
    }
  };

  const chooseFilter = (filter: DeskFilter): void => {
    // "Next" follows the open enquiry's place in the new list, if it has one.
    setOpenedIndex(-1);
    setStatusFilter(filter);
  };

  const opening = selectedId !== null && selected === undefined && preselectionLoading;
  const panelOpen = selectedId !== null && (selected !== undefined || preselectionLoading);
  const showSheet = wide || !panelOpen;
  const showPanel = wide || panelOpen;
  const backLabel = onDetailClose !== undefined ? "Back to profile" : wide ? "Close enquiry" : "Back to enquiries";

  const countNote = list.status === "ready"
    ? describeEnquiryCount({ shown: list.rows.length, total: list.total, filter: list.filter, newestFirst: list.order === "created_desc" })
    : null;
  const moreAvailable = list.status === "ready" && hasMoreEnquiries(list);
  const nextBatch = Math.min(ENQUIRY_PAGE_SIZE, list.total - list.nextOffset);
  const summary = deskSummary({
    newCount: counts.value?.byState.submitted ?? null,
    reviewCount: counts.value?.byState.under_review ?? null,
    longestWaitingCreatedAt: counts.value?.longestWaiting?.createdAt ?? null,
    nowMs,
  });
  const [emptyHeading, emptyDetail] = EMPTY_WORDS[list.filter];
  const greeting = deskGreeting(nowMs, userName);

  return (
    <div ref={deskRef} className={`enq-desk${wide ? "" : " enq-desk--single"}`} data-calm-controls onKeyDown={onDeskKeyDown}>
      {showSheet && (
        <section className="enq-sheet" aria-labelledby={titleId}>
          <header className="enq-head">
            <p className="enq-greeting">
              <span>{greeting.date}</span>
              <span aria-hidden="true">·</span>
              <span>{greeting.greeting}</span>
            </p>
            <h1 id={titleId} ref={sheetHeadingRef} tabIndex={-1}>Enquiries</h1>
          </header>
          <div className="enq-summary">
            {summary !== null && (
              <p>
                {summary.map((part, index) => typeof part === "string" ? part
                  : <strong key={index} data-tone={part.tone}>{part.strong}</strong>)}
              </p>
            )}
            {summary === null && counts.status === "loading" && <ActivityStatus>Counting enquiries…</ActivityStatus>}
            {summary === null && counts.status === "error" && (
              <div className="enq-summary__retry">
                <p>The stage counts could not be loaded.</p>
                <button type="button" className="enq-button" onClick={() => { setCountsVersion((version) => version + 1); }}>
                  Count again
                </button>
              </div>
            )}
          </div>

          <EnquiryStages filter={statusFilter} counts={counts.value} onFilter={chooseFilter} />

          {/* Stays mounted so a new count is announced when a page lands. */}
          <p className="enq-count" data-testid="enquiry-list-count" aria-live="polite">{countNote}</p>
          {list.status === "loading" && <ActivityStatus className="enq-sheet__activity">Loading enquiries…</ActivityStatus>}

          {list.status === "error" && (
            <div className="enq-notice enq-notice--alert" role="alert">
              <p>Enquiries could not be loaded.</p>
              <button type="button" className="enq-button" onClick={reloadList}>Try again</button>
            </div>
          )}

          {list.status === "ready" && list.rows.length === 0 && !moreAvailable && (
            <div className="enq-empty">
              <h2>{emptyHeading}</h2>
              <p>{emptyDetail}</p>
            </div>
          )}

          <EnquiryLedger
            rows={list.rows}
            selectedId={selectedId}
            nowMs={nowMs}
            room={roomOf}
            complete={list.status === "ready" && !moreAvailable}
            stamp={stamp}
            onOpen={open}
          />

          {list.interrupted && (
            <div className="enq-notice">
              <p role="status">Enquiries changed while this list was open, so it may be incomplete or out of date.</p>
              <button type="button" className="enq-button" onClick={reloadList}>Reload list</button>
            </div>
          )}

          {moreAvailable && (
            <div className="enq-more">
              <button type="button" className="enq-button" data-testid="enquiry-list-more"
                onClick={showMore} disabled={list.loadingMore} aria-busy={list.loadingMore}>
                {list.loadingMore && <ActivityIndicator size={16} />}
                {list.loadingMore ? "Loading more…" : `Show ${String(nextBatch)} more`}
              </button>
              {list.moreFailed && <p role="alert">More enquiries could not be loaded. Try again.</p>}
            </div>
          )}
        </section>
      )}

      {showPanel && (selected !== undefined ? (
        <EnquiryPanel
          key={selected.id}
          enquiry={selected}
          room={roomOf(selected)}
          nowMs={nowMs}
          history={history.id === selected.id ? history.entries : []}
          historyStatus={history.id === selected.id ? history.status : "loading"}
          transition={{ confirming, saving, failure }}
          stampKey={stamp !== null && stamp.id === selected.id ? stamp.key : null}
          announcement={announcement}
          creatingOpportunity={creatingOpportunity}
          navigation={{
            layout: wide ? "wide" : "single",
            backLabel,
            canPrevious: stepTarget(-1) !== undefined,
            canNext: stepTarget(1) !== undefined,
            onClose: close,
            onStep: step,
          }}
          headingRef={panelHeadingRef}
          onRequest={requestTransition}
          onConfirm={confirmTransition}
          onCancel={cancelTransition}
          onCreateOpportunity={() => { void handleCreateOpportunity(selected); }}
        />
      ) : opening ? (
        <section className="enq-panel enq-panel--opening" aria-label="Opening enquiry">
          <div className="enq-panel__body">
            <ActivityStatus variant="panel">Opening enquiry…</ActivityStatus>
          </div>
        </section>
      ) : wide ? (
        <EnquiryOverview
          counts={counts.value}
          nowMs={nowMs}
          moved={moved}
          room={roomOf}
          onOpen={open}
          onFilter={chooseFilter}
        />
      ) : null)}
    </div>
  );
}
