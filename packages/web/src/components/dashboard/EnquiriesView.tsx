import { useState, useEffect, useRef } from "react";
import * as enquiriesApi from "../../api/enquiries.js";
import type { Enquiry, EnquiryListOrder, EnquiryListQuery, StatusHistoryEntry } from "../../api/enquiries.js";
import { createOpportunityFromEnquiry } from "../../api/crm.js";
import { StatusBadge } from "../shared/StatusBadge.js";
import { ConfirmModal } from "../shared/ConfirmModal.js";
import { ActivityIndicator, ActivityStatus } from "../shared/Activity.js";
import { useToastStore } from "../../stores/toast-store.js";
import { AIDraftPanel } from "../ai/AIDraftPanel.js";
import {
  appendEnquiryPage, describeEnquiryCount, ENQUIRY_PAGE_SIZE, firstPageWindow, hasMoreEnquiries,
  nextPageWindow, withoutListedEnquiry, type ListedEnquiries,
} from "./enquiry-list-paging.js";

// ---------------------------------------------------------------------------
// EnquiriesView — list + detail for enquiry management
// ---------------------------------------------------------------------------

const STATUSES = ["all", "submitted", "under_review", "approved", "rejected", "withdrawn"] as const;

// Newest first by creation date. Whether staff would rather see the most
// recently active enquiries first is Blake's call; that order would need an
// `updated_desc` option (and index) in the API, which offers only
// `created_desc` and the default least-recently-updated order.
const LIST_ORDER: EnquiryListOrder = "created_desc";

/** The list for one load of one status filter. */
interface EnquiryListState extends ListedEnquiries {
  /** Identifies the load; a response for an older one is discarded. */
  readonly generation: number;
  readonly filter: string;
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

function listQuery(filter: string): EnquiryListQuery {
  return filter === "all" ? { order: LIST_ORDER } : { status: filter, order: LIST_ORDER };
}

// Light ink for copy that sits directly on the dashboard's forest ground.
const listNoteStyle: React.CSSProperties = { margin: "0 0 12px", fontSize: 13, color: "#c9cdbd" };
const listAlertStyle: React.CSSProperties = { margin: 0, fontSize: 13, color: "#f3b4a6" };
const listActionStyle = (busy: boolean): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600,
  background: "#f2edda", color: "#132b25", border: "1px solid #f2edda", borderRadius: 6,
  cursor: busy ? "default" : "pointer", fontFamily: "inherit",
});

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: "8px 16px", fontSize: 13, fontWeight: active ? 600 : 400,
  background: active ? "#fff" : "none", border: active ? "1px solid #e5e7eb" : "1px solid transparent",
  borderBottom: active ? "1px solid #fff" : "none", borderRadius: "6px 6px 0 0",
  cursor: "pointer", color: active ? "#1a1a2e" : "#666",
});

const cardStyle: React.CSSProperties = {
  background: "#fff", borderRadius: 8, padding: 16, marginBottom: 8,
  border: "1px solid #e5e7eb", cursor: "pointer", transition: "box-shadow 0.15s",
  width: "100%", boxSizing: "border-box", textAlign: "left",
  color: "inherit", fontFamily: "inherit",
};

// ---------------------------------------------------------------------------
// Props — punch list #34
//
// `initialSelectedId` is set when the user navigates here from a different
// view (e.g. clicking an enquiry in ClientProfile). The component pre-selects
// that enquiry on mount AND fetches it independently via `getEnquiry`, so
// the detail view renders even when the loaded pages of the current status
// filter don't include it. Without the independent fetch the `find()` call
// below would return undefined whenever the filter or paging excluded the
// target enquiry, leaving the user dumped at an unfiltered list with no
// idea where to scroll.
//
// `onDetailClose` is called when the user clicks "Back" from the detail
// view. When provided, the parent gets to decide where back goes (e.g.
// restoring the ClientProfile they came from). When omitted, "Back" falls
// back to the in-component behaviour of returning to the list.
// ---------------------------------------------------------------------------

interface EnquiriesViewProps {
  readonly initialSelectedId?: string | null;
  readonly onDetailClose?: () => void;
}

export function EnquiriesView({ initialSelectedId = null, onDetailClose }: EnquiriesViewProps = {}): React.ReactElement {
  const [list, setList] = useState<EnquiryListState>(UNLOADED_LIST);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [reloadCount, setReloadCount] = useState(0);
  const generationRef = useRef(0);
  const loadMoreRef = useRef<AbortController | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  // The enquiry the detail view shows: the clicked card, or the independent
  // fetch for the cross-view pre-selection case (populated by the effect
  // below). It survives the list dropping the row after a status change.
  const [openedEnquiry, setOpenedEnquiry] = useState<Enquiry | null>(null);
  const [history, setHistory] = useState<StatusHistoryEntry[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [preselectionLoading, setPreselectionLoading] = useState(initialSelectedId !== null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [transitionSaving, setTransitionSaving] = useState(false);
  const [transition, setTransition] = useState<{ id: string; status: string } | null>(null);
  const [creatingOpportunity, setCreatingOpportunity] = useState(false);
  const addToast = useToastStore((s) => s.addToast);

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

  const showMore = (): void => {
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
  };

  const reloadList = (): void => { setReloadCount((count) => count + 1); };

  // When pre-selected via initialSelectedId, fetch the enquiry directly so
  // the detail view can render regardless of the active status filter.
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

  // Prefer the opened enquiry if it matches the currently-selected id;
  // otherwise fall back to the list lookup. This makes status-filter
  // mismatches a non-issue for the navigation case.
  const selected = (openedEnquiry !== null && openedEnquiry.id === selectedId)
    ? openedEnquiry
    : list.rows.find((e) => e.id === selectedId);

  // "Back" exits the detail view. If a parent provided `onDetailClose`,
  // the parent owns the destination (e.g. restore ClientProfile). Else
  // we just clear the selection and return to the in-component list.
  const handleBack = (): void => {
    setSelectedId(null);
    setOpenedEnquiry(null);
    setHistory([]);
    if (onDetailClose !== undefined) onDetailClose();
  };

  useEffect(() => {
    setHistory([]);
    if (selectedId === null) {
      setHistoryLoading(false);
      return;
    }

    const controller = new AbortController();
    setHistoryLoading(true);
    void enquiriesApi.getEnquiryHistory(selectedId, controller.signal)
      .then((entries) => {
        if (!controller.signal.aborted) setHistory(entries);
      })
      .catch(() => { /* An absent timeline does not block enquiry review. */ })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });
    return () => { controller.abort(); };
  }, [selectedId, historyVersion]);

  const handleTransition = async (note?: string): Promise<void> => {
    if (transition === null || transitionSaving) return;
    setTransitionSaving(true);
    try {
      const updated = await enquiriesApi.transitionEnquiry(transition.id, transition.status, note);
      // A status-filtered list drops an enquiry that no longer matches, and
      // its later pages shift up one; "all" keeps it with its new status.
      setList((previous) => previous.filter === "all" || updated.state === previous.filter
        ? { ...previous, rows: previous.rows.map((e) => e.id === updated.id ? updated : e) }
        : { ...previous, ...withoutListedEnquiry(previous, updated.id) });
      // The detail view keeps showing the enquiry with its new status.
      setOpenedEnquiry((opened) => opened !== null && opened.id === updated.id ? updated : opened);
      addToast(`Enquiry ${transition.status.replace(/_/g, " ")}`, "success");
      setTransition(null);
      setHistoryVersion((version) => version + 1);
    } catch {
      addToast("Failed to update status", "error");
      setTransition(null);
    } finally {
      setTransitionSaving(false);
    }
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

  if (selected !== undefined) {
    const isGuest = selected.userId === null;
    return (
      <div>
        <button
          type="button"
          onClick={handleBack}
          style={{ background: "none", border: "none", color: "#3b82f6", cursor: "pointer", fontSize: 13, marginBottom: 16, padding: 0 }}
        >
          &larr; {onDetailClose !== undefined ? "Back to profile" : "Back to list"}
        </button>

        <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #e5e7eb" }}>
          {preselectionLoading && <ActivityStatus>Opening enquiry…</ActivityStatus>}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{selected.name}</h2>
            <StatusBadge status={selected.state} />
            {isGuest && <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "#fef3c7", color: "#d97706" }}>Guest</span>}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 13, color: "#666", marginBottom: 20 }}>
            <div>Email: {selected.guestEmail ?? selected.email}</div>
            {selected.guestPhone !== null && <div>Phone: {selected.guestPhone}</div>}
            {selected.eventType !== null && <div>Type: {selected.eventType}</div>}
            {selected.preferredDate !== null && <div>Date: {selected.preferredDate}</div>}
            {selected.estimatedGuests !== null && <div>Guests: {String(selected.estimatedGuests)}</div>}
            {selected.message !== null && <div style={{ gridColumn: "1 / -1" }}>Message: {selected.message}</div>}
          </div>

          <div style={{ marginBottom: 20 }}>
            <AIDraftPanel
              title="AI enquiry draft"
              useCase="enquiry_summary"
              actionLabel="Draft summary"
              context={{
                enquiryId: selected.id,
                name: selected.guestName ?? selected.name,
                email: selected.guestEmail ?? selected.email,
                eventType: selected.eventType,
                preferredDate: selected.preferredDate,
                estimatedGuests: selected.estimatedGuests,
                message: selected.message,
                currentStatus: selected.state,
              }}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <AIDraftPanel
              title="AI proposal wording draft"
              useCase="proposal_draft"
              actionLabel="Draft proposal copy"
              context={{
                enquiryId: selected.id,
                clientName: selected.guestName ?? selected.name,
                eventType: selected.eventType,
                preferredDate: selected.preferredDate,
                estimatedGuests: selected.estimatedGuests,
                clientNotes: selected.message,
                currentStatus: selected.state,
              }}
            />
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            <button
              type="button"
              data-testid="create-opportunity-from-enquiry"
              onClick={() => { void handleCreateOpportunity(selected); }}
              disabled={creatingOpportunity}
              aria-busy={creatingOpportunity}
              style={{ padding: "8px 16px", fontSize: 13, fontWeight: 600, background: "#1a1a2e", color: "#fff", border: "none", borderRadius: 6, cursor: creatingOpportunity ? "default" : "pointer", opacity: creatingOpportunity ? 0.6 : 1 }}
            >
              {creatingOpportunity && <ActivityIndicator size={16} />} Create Opportunity
            </button>
            {selected.state === "submitted" && (
              <button type="button" onClick={() => { setTransition({ id: selected.id, status: "under_review" }); }}
                style={{ padding: "8px 16px", fontSize: 13, fontWeight: 600, background: "#f59e0b", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
                Start Review
              </button>
            )}
            {selected.state === "under_review" && (
              <>
                <button type="button" onClick={() => { setTransition({ id: selected.id, status: "approved" }); }}
                  style={{ padding: "8px 16px", fontSize: 13, fontWeight: 600, background: "#22c55e", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
                  Approve
                </button>
                <button type="button" onClick={() => { setTransition({ id: selected.id, status: "rejected" }); }}
                  style={{ padding: "8px 16px", fontSize: 13, fontWeight: 600, background: "#ef4444", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
                  Reject
                </button>
              </>
            )}
            {selected.configurationId !== null && (
              <a href={`/plan/${selected.configurationId}`} target="_blank" rel="noreferrer"
                style={{ padding: "8px 16px", fontSize: 13, fontWeight: 600, background: "#3b82f6", color: "#fff", borderRadius: 6, textDecoration: "none" }}>
                View Layout
              </a>
            )}
            {/* The legacy per-enquiry hallkeeper PDF was removed. The new flow
                serves an approved-snapshot PDF at /hallkeeper/:configId/sheet
                (see Phase 3 for the dashboard-embedded entry point). */}
          </div>

          {historyLoading && <ActivityStatus>Loading enquiry history…</ActivityStatus>}
          {history.length > 0 && (
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "#333", marginBottom: 8 }}>Status Timeline</h3>
              {history.map((h) => (
                <div key={h.id} style={{ fontSize: 12, color: "#666", padding: "4px 0", borderLeft: "2px solid #e5e7eb", paddingLeft: 12, marginLeft: 4 }}>
                  <StatusBadge status={h.fromStatus} /> &rarr; <StatusBadge status={h.toStatus} />
                  <span style={{ marginLeft: 8, color: "#999" }}>{new Date(h.createdAt).toLocaleString()}</span>
                  {h.note !== null && <div style={{ marginTop: 2, fontStyle: "italic" }}>{h.note}</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        {transition !== null && (
          <ConfirmModal
            title={`${transition.status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} Enquiry`}
            message={`Are you sure you want to change status to "${transition.status.replace(/_/g, " ")}"?`}
            confirmLabel={transition.status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
            confirmColor={transition.status === "approved" ? "#22c55e" : transition.status === "rejected" ? "#ef4444" : "#f59e0b"}
            showNoteField
            inFlight={transitionSaving}
            onConfirm={(note) => { void handleTransition(note); }}
            onCancel={() => { setTransition(null); }}
          />
        )}
      </div>
    );
  }

  const countNote = list.status === "ready"
    ? describeEnquiryCount({ shown: list.rows.length, total: list.total, filter: list.filter, newestFirst: list.order === "created_desc" })
    : null;
  const moreAvailable = list.status === "ready" && hasMoreEnquiries(list);
  const nextBatch = Math.min(ENQUIRY_PAGE_SIZE, list.total - list.nextOffset);

  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {STATUSES.map((s) => (
          <button key={s} type="button" style={tabStyle(statusFilter === s)}
            onClick={() => { setStatusFilter(s); }}>
            {s === "all" ? "All" : s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
          </button>
        ))}
      </div>

      {/* Stays mounted so a new count is announced when a page lands. */}
      <p data-testid="enquiry-list-count" aria-live="polite" style={countNote === null ? { margin: 0 } : listNoteStyle}>
        {countNote}
      </p>
      {list.status === "loading" && <ActivityStatus style={{ color: "#999", fontSize: 14 }}>Loading enquiries…</ActivityStatus>}
      {preselectionLoading && <ActivityStatus>Opening enquiry…</ActivityStatus>}

      {list.status === "error" && (
        <div role="alert" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <p style={listAlertStyle}>Enquiries could not be loaded.</p>
          <button type="button" style={listActionStyle(false)} onClick={reloadList}>Try again</button>
        </div>
      )}

      {list.status === "ready" && !preselectionLoading && list.rows.length === 0 && (
        <p style={{ color: "#999", fontSize: 14 }}>No enquiries found.</p>
      )}

      {list.rows.map((e) => (
        <button key={e.id} type="button" style={cardStyle} onClick={() => { setSelectedId(e.id); setOpenedEnquiry(e); }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{e.guestName ?? e.name}</span>
            <StatusBadge status={e.state} />
            {e.userId === null && <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, background: "#fef3c7", color: "#d97706" }}>Guest</span>}
          </div>
          <div style={{ fontSize: 12, color: "#888" }}>
            {e.guestEmail ?? e.email}
            {e.eventType !== null && ` · ${e.eventType}`}
            {e.preferredDate !== null && ` · ${e.preferredDate}`}
            {e.estimatedGuests !== null && ` · ${String(e.estimatedGuests)} guests`}
          </div>
          <div style={{ fontSize: 11, color: "#bbb", marginTop: 4 }}>
            {new Date(e.createdAt).toLocaleDateString()}
          </div>
        </button>
      ))}

      {list.interrupted && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, margin: "4px 0 12px" }}>
          <p role="status" style={{ ...listNoteStyle, margin: 0 }}>
            Enquiries changed while this list was open, so it may be incomplete or out of date.
          </p>
          <button type="button" style={listActionStyle(false)} onClick={reloadList}>Reload list</button>
        </div>
      )}

      {moreAvailable && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginTop: 8 }}>
          <button type="button" data-testid="enquiry-list-more" style={listActionStyle(list.loadingMore)}
            onClick={showMore} disabled={list.loadingMore} aria-busy={list.loadingMore}>
            {list.loadingMore && <ActivityIndicator size={16} />}
            {list.loadingMore ? "Loading more…" : `Show ${String(nextBatch)} more`}
          </button>
          {list.moreFailed && <p role="alert" style={listAlertStyle}>More enquiries could not be loaded. Try again.</p>}
        </div>
      )}
    </div>
  );
}
