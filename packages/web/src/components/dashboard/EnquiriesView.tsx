import { useState, useEffect } from "react";
import * as enquiriesApi from "../../api/enquiries.js";
import type { Enquiry, StatusHistoryEntry } from "../../api/enquiries.js";
import { StatusBadge } from "../shared/StatusBadge.js";
import { ConfirmModal } from "../shared/ConfirmModal.js";
import { useToastStore } from "../../stores/toast-store.js";

// ---------------------------------------------------------------------------
// EnquiriesView — list + detail for enquiry management
// ---------------------------------------------------------------------------

const STATUSES = ["all", "submitted", "under_review", "approved", "rejected", "withdrawn"] as const;

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: "8px 16px", fontSize: 13, fontWeight: active ? 600 : 400,
  background: active ? "#fff" : "none", border: active ? "1px solid #e5e7eb" : "1px solid transparent",
  borderBottom: active ? "1px solid #fff" : "none", borderRadius: "6px 6px 0 0",
  cursor: "pointer", color: active ? "#1a1a2e" : "#666",
});

const cardStyle: React.CSSProperties = {
  background: "#fff", borderRadius: 8, padding: 16, marginBottom: 8,
  border: "1px solid #e5e7eb", cursor: "pointer", transition: "box-shadow 0.15s",
};

// ---------------------------------------------------------------------------
// Props — punch list #34
//
// `initialSelectedId` is set when the user navigates here from a different
// view (e.g. clicking an enquiry in ClientProfile). The component pre-selects
// that enquiry on mount AND fetches it independently via `getEnquiry`, so
// the detail view renders even when the current status filter wouldn't
// have included it in `listEnquiries`. Without the independent fetch the
// `find()` call below would return undefined whenever the status filter
// excluded the target enquiry, leaving the user dumped at an unfiltered
// list with no idea where to scroll.
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
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  // Independent fetch for the cross-view pre-selection case. Populated by
  // the effect below; falls back to the list lookup once both are loaded.
  const [preselectedEnquiry, setPreselectedEnquiry] = useState<Enquiry | null>(null);
  const [history, setHistory] = useState<StatusHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [transition, setTransition] = useState<{ id: string; status: string } | null>(null);
  const addToast = useToastStore((s) => s.addToast);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const data = await enquiriesApi.listEnquiries(statusFilter === "all" ? undefined : statusFilter);
        setEnquiries(data);
      } catch { addToast("Failed to load enquiries", "error"); }
      setLoading(false);
    })();
  }, [statusFilter, addToast]);

  // When pre-selected via initialSelectedId, fetch the enquiry directly so
  // the detail view can render regardless of the active status filter.
  useEffect(() => {
    if (initialSelectedId === null) return;
    setSelectedId(initialSelectedId);
    void enquiriesApi.getEnquiry(initialSelectedId)
      .then(setPreselectedEnquiry)
      .catch(() => { addToast("Failed to load enquiry", "error"); });
  }, [initialSelectedId, addToast]);

  // Prefer the freshly-fetched pre-selected enquiry if it matches the
  // currently-selected id; otherwise fall back to the list lookup. This
  // makes status-filter mismatches a non-issue for the navigation case.
  const selected = (preselectedEnquiry !== null && preselectedEnquiry.id === selectedId)
    ? preselectedEnquiry
    : enquiries.find((e) => e.id === selectedId);

  // "Back" exits the detail view. If a parent provided `onDetailClose`,
  // the parent owns the destination (e.g. restore ClientProfile). Else
  // we just clear the selection and return to the in-component list.
  const handleBack = (): void => {
    setSelectedId(null);
    setPreselectedEnquiry(null);
    if (onDetailClose !== undefined) onDetailClose();
  };

  useEffect(() => {
    if (selectedId !== null) {
      void enquiriesApi.getEnquiryHistory(selectedId).then(setHistory).catch(() => { /* ignore */ });
    }
  }, [selectedId]);

  const handleTransition = async (note?: string): Promise<void> => {
    if (transition === null) return;
    try {
      const updated = await enquiriesApi.transitionEnquiry(transition.id, transition.status, note);
      setEnquiries((prev) => prev.map((e) => e.id === updated.id ? updated : e));
      // Also update preselected record so the detail view reflects the change
      if (preselectedEnquiry !== null && preselectedEnquiry.id === updated.id) {
        setPreselectedEnquiry(updated);
      }
      addToast(`Enquiry ${transition.status.replace(/_/g, " ")}`, "success");
      setTransition(null);
      // Refresh history
      void enquiriesApi.getEnquiryHistory(transition.id).then(setHistory).catch(() => { /* ignore */ });
    } catch {
      addToast("Failed to update status", "error");
      setTransition(null);
    }
  };

  const handleDownloadPdf = async (id: string): Promise<void> => {
    try {
      await enquiriesApi.downloadHallkeeperPdf(id);
      addToast("PDF downloaded", "success");
    } catch { addToast("Failed to download PDF", "error"); }
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

          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
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
              <a href={`/editor/${selected.configurationId}`} target="_blank" rel="noreferrer"
                style={{ padding: "8px 16px", fontSize: 13, fontWeight: 600, background: "#3b82f6", color: "#fff", borderRadius: 6, textDecoration: "none" }}>
                View Layout
              </a>
            )}
            <button type="button" onClick={() => { void handleDownloadPdf(selected.id); }}
              style={{ padding: "8px 16px", fontSize: 13, fontWeight: 600, background: "#6b7280", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
              Download Sheet
            </button>
          </div>

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
            onConfirm={(note) => { void handleTransition(note); }}
            onCancel={() => { setTransition(null); }}
          />
        )}
      </div>
    );
  }

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

      {loading && <p style={{ color: "#999", fontSize: 14 }}>Loading...</p>}

      {!loading && enquiries.length === 0 && (
        <p style={{ color: "#999", fontSize: 14 }}>No enquiries found.</p>
      )}

      {enquiries.map((e) => (
        <div key={e.id} style={cardStyle} onClick={() => { setSelectedId(e.id); }}>
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
        </div>
      ))}
    </div>
  );
}
