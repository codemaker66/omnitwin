import { useCallback, useEffect, useMemo, useState } from "react";
import { formatMinorUnitMoney, type VenueDashboardAnalytics } from "@omnitwin/types";
import { getVenueDashboardAnalytics } from "../../api/revenue-analytics.js";

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly data: VenueDashboardAnalytics }
  | { readonly status: "error"; readonly message: string };

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
  color: "#68d8d2",
  fontSize: 12,
  fontWeight: 850,
  letterSpacing: 0,
  textTransform: "uppercase",
};

function statusCount(data: VenueDashboardAnalytics, status: string): number {
  return data.proposalStatusCounts[status] ?? 0;
}

function warningList(items: readonly string[], empty: string): React.ReactElement {
  if (items.length === 0) {
    return <p style={{ margin: 0, color: "rgba(246,241,232,0.66)", fontSize: 13 }}>{empty}</p>;
  }
  return (
    <ul style={{ margin: 0, paddingLeft: 18, color: "rgba(246,241,232,0.82)", fontSize: 13, lineHeight: 1.55 }}>
      {items.map((item) => <li key={item}>{item}</li>)}
    </ul>
  );
}

export function ExecutiveAnalyticsView(): React.ReactElement {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  const load = useCallback(() => {
    setLoadState({ status: "loading" });
    void getVenueDashboardAnalytics()
      .then((data) => { setLoadState({ status: "loaded", data }); })
      .catch((error: unknown) => {
        setLoadState({
          status: "error",
          message: error instanceof Error ? error.message : "Analytics are unavailable.",
        });
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  const content = useMemo(() => {
    if (loadState.status === "loading") {
      return (
        <section style={cardStyle} aria-live="polite">
          <p style={labelStyle}>Executive analytics</p>
          <h2 style={{ margin: "8px 0", fontSize: 22, color: "#fff7e8" }}>Loading commercial planning data</h2>
          <p style={{ margin: 0, color: "rgba(246,241,232,0.72)" }}>Revenue, comfort, and review signals are loading from the venue records.</p>
        </section>
      );
    }

    if (loadState.status === "error") {
      return (
        <section style={cardStyle} role="alert">
          <p style={labelStyle}>Executive analytics</p>
          <h2 style={{ margin: "8px 0", fontSize: 22, color: "#ffd2bd" }}>Analytics unavailable</h2>
          <p style={{ margin: "0 0 14px", color: "rgba(246,241,232,0.72)" }}>{loadState.message}</p>
          <button type="button" onClick={load} style={primaryButtonStyle}>Retry analytics</button>
        </section>
      );
    }

    const data = loadState.data;
    const scenario = data.revenueScenarios[0];
    return (
      <div style={{ display: "grid", gap: 18 }}>
        <section style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div>
            <p style={labelStyle}>Executive analytics</p>
            <h2 style={{ margin: "6px 0", color: "#fff7e8", fontSize: 28, fontFamily: "Georgia, 'Times New Roman', serif", letterSpacing: 0 }}>Commercial planning dashboard</h2>
            <p style={{ margin: 0, maxWidth: 760, color: "rgba(246,241,232,0.72)", lineHeight: 1.5 }}>
              {data.disclosure}. Values are planning indicators and keep comfort floors and review gates visible.
            </p>
          </div>
          <button type="button" onClick={load} style={secondaryButtonStyle}>Refresh</button>
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
          <div style={cardStyle}>
            <p style={labelStyle}>Pipeline value</p>
            <p style={metricValueStyle}>{formatMinorUnitMoney(data.pipelineValueMinor, data.currency)}</p>
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
          <div style={cardStyle}>
            <p style={labelStyle}>Review bottlenecks</p>
            <p style={metricValueStyle}>{data.reviewBottlenecks.length}</p>
            <p style={{ margin: "8px 0 0", color: "rgba(246,241,232,0.62)", fontSize: 12 }}>Visible before recommendations are used</p>
          </div>
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 18 }}>
          <div style={cardStyle}>
            <p style={labelStyle}>Room utilisation</p>
            {data.roomUtilisation.length === 0 ? (
              <p style={{ margin: "12px 0 0", color: "rgba(246,241,232,0.66)" }}>No room utilisation data yet. Link quotes or events to rooms to populate this view.</p>
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
                      {room.bookedEvents} booked · {room.proposedEvents} proposed · {room.reviewBottlenecks} review bottlenecks
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={cardStyle}>
            <p style={labelStyle}>Revenue scenario</p>
            {scenario === undefined ? (
              <p style={{ margin: "12px 0 0", color: "rgba(246,241,232,0.66)" }}>No revenue scenarios yet. Create one from an event, quote, or planner layout.</p>
            ) : (
              <div style={{ marginTop: 12 }}>
                <h3 style={{ margin: "0 0 8px", color: "#fff7e8", fontSize: 18 }}>{scenario.name}</h3>
                <p style={{ margin: "0 0 8px", color: "rgba(246,241,232,0.82)", fontWeight: 700 }}>
                  {formatMinorUnitMoney(scenario.estimatedRevenueMinor, scenario.currency)} revenue · {formatMinorUnitMoney(scenario.estimatedMarginMinor, scenario.currency)} margin
                </p>
                <p style={{ margin: 0, color: "#f2b35e", fontSize: 13 }}>
                  Comfort status {scenario.comfortStatus}; {scenario.reviewGateCount} review gate(s).
                </p>
              </div>
            )}
          </div>
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 18 }}>
          <div style={cardStyle}>
            <p style={labelStyle}>Comfort floor warnings</p>
            <div style={{ marginTop: 12 }}>
              {warningList(data.comfortFloorWarnings, "No comfort floor warnings recorded for the current analytics set.")}
            </div>
          </div>
          <div style={cardStyle}>
            <p style={labelStyle}>Review bottlenecks</p>
            <div style={{ marginTop: 12 }}>
              {warningList(data.reviewBottlenecks, "No review bottlenecks recorded for the current analytics set.")}
            </div>
          </div>
        </section>
      </div>
    );
  }, [load, loadState]);

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

const secondaryButtonStyle: React.CSSProperties = {
  minHeight: 40,
  border: "1px solid rgba(215,181,109,0.25)",
  borderRadius: 8,
  background: "rgba(255,247,232,0.07)",
  color: "#fff7e8",
  padding: "0 14px",
  fontWeight: 700,
  cursor: "pointer",
};
