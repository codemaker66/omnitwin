import { useCallback, useEffect, useMemo, useState } from "react";
import { formatMinorUnitMoney, type VenueDashboardAnalytics } from "@omnitwin/types";
import { getVenueDashboardAnalytics } from "../../api/revenue-analytics.js";
import { listVenues, type Venue } from "../../api/spaces.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { ActivityIndicator } from "../shared/Activity.js";

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly data: VenueDashboardAnalytics }
  | { readonly status: "error"; readonly message: string }
  // A platform admin has no venue of their own, and the analytics API
  // requires one. Before this, the view showed "Analytics unavailable: Admin
  // analytics requests must provide venueId" — a configuration message
  // wearing an error's clothes. Now it asks which venue.
  | { readonly status: "choose-venue" };

const cardStyle: React.CSSProperties = {
  border: "1px solid rgba(215, 181, 109, 0.24)",
  borderRadius: 8,
  background:
    "linear-gradient(135deg, rgba(255,255,255,0.055), rgba(255,255,255,0.018)), rgba(9,14,16,0.94)",
  padding: 18,
  boxShadow: "0 22px 70px rgba(0,0,0,0.28)",
};

const metricValueStyle: React.CSSProperties = {
  margin: "8px 0 0",
  color: "#f1c978",
  fontSize: 28,
  lineHeight: 1,
  fontWeight: 800,
};

const labelStyle: React.CSSProperties = {
  margin: 0,
  color: "#8ff8f2",
  fontSize: 12,
  fontWeight: 850,
  letterSpacing: 0,
  textTransform: "uppercase",
};

function statusCount(data: VenueDashboardAnalytics, status: string): number {
  return data.proposalStatusCounts[status] ?? 0;
}

/** Callers render this only when there is something to list — a card saying
 *  "none recorded" reads as reassurance the data cannot support. */
function warningList(items: readonly string[]): React.ReactElement {
  return (
    <ul style={{ margin: 0, paddingLeft: 18, color: "rgba(246,241,232,0.82)", fontSize: 13, lineHeight: 1.55 }}>
      {items.map((item) => <li key={item}>{item}</li>)}
    </ul>
  );
}

export function ExecutiveAnalyticsView(): React.ReactElement {
  const isPlatformAdmin = useAuthStore((state) => state.user?.platformRole === "admin");
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [venues, setVenues] = useState<readonly Venue[]>([]);
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);

  const load = useCallback((venueId?: string) => {
    setLoadState({ status: "loading" });
    void getVenueDashboardAnalytics(venueId)
      .then((data) => { setLoadState({ status: "loaded", data }); })
      .catch((error: unknown) => {
        setLoadState({
          status: "error",
          message: error instanceof Error ? error.message : "Analytics are unavailable.",
        });
      });
  }, []);

  // A venue user's scope comes from their own account, so load immediately.
  // A platform admin has to say which venue first.
  useEffect(() => {
    if (!isPlatformAdmin) { load(); return; }
    if (selectedVenueId !== null) { load(selectedVenueId); return; }
    setLoadState({ status: "choose-venue" });
  }, [isPlatformAdmin, load, selectedVenueId]);

  useEffect(() => {
    if (!isPlatformAdmin) return;
    void listVenues()
      .then((rows) => { setVenues(rows); })
      // The picker failing is not the dashboard failing: the admin can still
      // retry, and a venue user never reaches this path at all.
      .catch(() => { setVenues([]); });
  }, [isPlatformAdmin]);

  const venuePicker = isPlatformAdmin
    ? (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <label htmlFor="analytics-venue" style={{ ...labelStyle, textTransform: "none" }}>Venue</label>
        <select
          id="analytics-venue"
          data-testid="analytics-venue-picker"
          value={selectedVenueId ?? ""}
          onChange={(event) => { setSelectedVenueId(event.target.value === "" ? null : event.target.value); }}
          style={selectStyle}
        >
          <option value="">Choose a venue…</option>
          {venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
        </select>
      </div>
    )
    : null;

  const content = useMemo(() => {
    if (loadState.status === "loading") {
      return (
        <section style={cardStyle} aria-live="polite">
          <h2 style={{ margin: "8px 0", fontSize: 22, color: "#fff7e8" }}><ActivityIndicator size={28} /> Loading commercial planning data</h2>
        </section>
      );
    }

    if (loadState.status === "choose-venue") {
      return (
        <section style={cardStyle} aria-live="polite">
          <h2 style={{ margin: "8px 0", fontSize: 22, color: "#fff7e8" }}>Choose a venue</h2>
          <p style={{ margin: "0 0 14px", color: "rgba(246,241,232,0.86)" }}>
            Analytics are reported per venue. Pick the one you want to look at.
          </p>
          {venuePicker}
        </section>
      );
    }

    if (loadState.status === "error") {
      return (
        <section style={cardStyle} role="alert">
          <h2 style={{ margin: "8px 0", fontSize: 22, color: "#ffd2bd" }}>Analytics unavailable</h2>
          <p style={{ margin: "0 0 14px", color: "rgba(246,241,232,0.86)" }}>{loadState.message}</p>
          <button
            type="button"
            onClick={() => { load(selectedVenueId ?? undefined); }}
            style={primaryButtonStyle}
          >
            Retry analytics
          </button>
        </section>
      );
    }

    const data = loadState.data;
    const scenario = data.revenueScenarios[0];
    // Revenue scenarios have no creation path in the product yet, so these
    // three surfaces were permanently empty: a card reading "Create a revenue
    // scenario from an event, quote or layout", a zero tile, and two "nothing
    // recorded" lists. An empty card is worse than no card — it reads as an
    // absence of problems rather than an absence of data — so each renders
    // only when it has something true to say.
    const hasScenario = scenario !== undefined;
    const hasComfortWarnings = data.comfortFloorWarnings.length > 0;
    const hasReviewBottlenecks = data.reviewBottlenecks.length > 0;
    return (
      <div style={{ display: "grid", gap: 18 }}>
        <section style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div>
            <h2 style={{ margin: "6px 0", color: "#fff7e8", fontSize: 28, fontFamily: "Georgia, 'Times New Roman', serif", letterSpacing: 0 }}>Executive analytics</h2>
            <p style={{ margin: 0, maxWidth: 760, color: "rgba(246,241,232,0.88)", lineHeight: 1.5 }}>
              {data.disclosure}.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {venuePicker}
            <button
              type="button"
              onClick={() => { load(selectedVenueId ?? undefined); }}
              style={secondaryButtonStyle}
            >
              Refresh
            </button>
          </div>
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
          <div style={cardStyle}>
            {/* Same definition and same figure as the Pipeline tab: open
                opportunities only, computed server-side. */}
            <p style={labelStyle}>Pipeline value</p>
            <p style={metricValueStyle}>{formatMinorUnitMoney(data.pipelineValueMinor, data.currency)}</p>
            <p style={{ margin: "8px 0 0", color: "rgba(246,241,232,0.62)", fontSize: 12 }}>Open opportunities only</p>
          </div>
          <div style={cardStyle}>
            <p style={labelStyle}>Enquiry conversion</p>
            <p style={metricValueStyle}>{data.enquiryConversionPercent}%</p>
          </div>
          <div style={cardStyle}>
            <p style={labelStyle}>Proposal status</p>
            <p style={metricValueStyle}>{statusCount(data, "sent")} sent</p>
            <p style={{ margin: "8px 0 0", color: "rgba(246,241,232,0.62)", fontSize: 12 }}>
              {statusCount(data, "accepted")} accepted · {statusCount(data, "changes_requested")} changes requested
            </p>
          </div>
          {hasReviewBottlenecks && (
            <div style={cardStyle}>
              <p style={labelStyle}>Review bottlenecks</p>
              <p style={metricValueStyle}>{data.reviewBottlenecks.length}</p>
            </div>
          )}
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 18 }}>
          <div style={cardStyle}>
            <p style={labelStyle}>Room utilisation</p>
            {data.roomUtilisation.length === 0 ? (
              <p style={{ margin: "12px 0 0", color: "rgba(246,241,232,0.66)" }}>Add rooms to this venue to see utilisation.</p>
            ) : (
              <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                {data.roomUtilisation.map((room) => (
                  <div key={`${room.spaceId ?? "unassigned"}:${room.roomName}`} style={{ display: "grid", gap: 5 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, color: "#fff7e8", fontSize: 13, fontWeight: 700 }}>
                      <span>{room.roomName}</span>
                      <span>{room.utilisationPercent}%</span>
                    </div>
                    <div style={{ height: 8, borderRadius: 999, background: "rgba(255,247,232,0.12)", overflow: "hidden" }}>
                      <span style={{ display: "block", width: `${String(room.utilisationPercent)}%`, height: "100%", background: "#68d8d2" }} />
                    </div>
                    <p style={{ margin: 0, color: "rgba(246,241,232,0.62)", fontSize: 12 }}>
                      {room.bookedEvents} confirmed · {room.proposedEvents} pencilled
                      {room.reviewBottlenecks > 0 ? ` · ${String(room.reviewBottlenecks)} review bottlenecks` : ""}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {hasScenario && (
            <div style={cardStyle}>
              <p style={labelStyle}>Revenue scenario</p>
              <div style={{ marginTop: 12 }}>
                <h3 style={{ margin: "0 0 8px", color: "#fff7e8", fontSize: 18 }}>{scenario.name}</h3>
                <p style={{ margin: "0 0 8px", color: "rgba(246,241,232,0.82)", fontWeight: 700 }}>
                  {formatMinorUnitMoney(scenario.estimatedRevenueMinor, scenario.currency)} revenue · {formatMinorUnitMoney(scenario.estimatedMarginMinor, scenario.currency)} margin
                </p>
                <p style={{ margin: 0, color: "#f2b35e", fontSize: 13 }}>
                  Comfort status {scenario.comfortStatus}; {scenario.reviewGateCount} review gate(s).
                </p>
              </div>
            </div>
          )}
        </section>

        {(hasComfortWarnings || hasReviewBottlenecks) && (
          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 18 }}>
            {hasComfortWarnings && (
              <div style={cardStyle}>
                <p style={labelStyle}>Comfort floor warnings</p>
                <div style={{ marginTop: 12 }}>{warningList(data.comfortFloorWarnings)}</div>
              </div>
            )}
            {hasReviewBottlenecks && (
              <div style={cardStyle}>
                <p style={labelStyle}>Review bottlenecks</p>
                <div style={{ marginTop: 12 }}>{warningList(data.reviewBottlenecks)}</div>
              </div>
            )}
          </section>
        )}
      </div>
    );
    // `venuePicker` and `selectedVenueId` belong here: without them the memo
    // keeps rendering the picker built on the first render, so the venue list
    // arriving from the server never reaches the dropdown.
  }, [load, loadState, selectedVenueId, venuePicker]);

  return <>{content}</>;
}

const primaryButtonStyle: React.CSSProperties = {
  minHeight: 40,
  border: "1px solid rgba(255,224,154,0.52)",
  borderRadius: 8,
  background: "linear-gradient(135deg, #d7b56d, #f0cf84), #d7b56d",
  color: "#0a0b0b",
  padding: "0 14px",
  fontWeight: 700,
  cursor: "pointer",
};

const selectStyle: React.CSSProperties = {
  minHeight: 40,
  border: "1px solid rgba(215, 181, 109, 0.4)",
  borderRadius: 8,
  background: "rgba(7,12,14,0.92)",
  color: "#fff7e8",
  padding: "0 10px",
  fontSize: 14,
};

const secondaryButtonStyle: React.CSSProperties = {
  minHeight: 40,
  border: "1px solid rgba(143,248,242,0.68)",
  borderRadius: 8,
  background: "rgba(7,12,14,0.92)",
  color: "#fff7e8",
  padding: "0 14px",
  fontWeight: 700,
  cursor: "pointer",
};
