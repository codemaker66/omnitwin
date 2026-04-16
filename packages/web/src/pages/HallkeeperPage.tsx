import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams } from "react-router-dom";
import type { HallkeeperSheetV2, Phase, SetupPhase } from "@omnitwin/types";
import { API_URL } from "../config/env.js";
import { getAuthToken } from "../api/client.js";

// ---------------------------------------------------------------------------
// HallkeeperPage — phase/zone sheet with dependency-aware ordering
//
// Data contract: GET /hallkeeper/:configId/v2 returns HallkeeperSheetV2
// (see @omnitwin/types/hallkeeper-v2.ts). Each row has a stable `key`
// used for localStorage checkbox persistence — the hallkeeper can
// refresh/switch tabs without losing progress.
//
// Print: the styles below include an @media print block that flattens
// the dark theme to print-safe monochrome and forces page breaks
// between phases so an A4 printout is legible.
// ---------------------------------------------------------------------------

const GOLD = "#c9a84c";
const GREEN = "#5ba870";
const DARK_BG = "#111";
const CARD_BG = "#1a1a1a";
const BORDER = "#252320";
const TEXT_MUT = "#5c5955";
const TEXT_SEC = "#9a9690";

const PHASE_META: Readonly<Record<SetupPhase, { label: string; icon: string; order: number }>> = {
  structure: { label: "Structure", icon: "▣", order: 0 },
  furniture: { label: "Furniture", icon: "▬", order: 1 },
  dress: { label: "Dress", icon: "✦", order: 2 },
  technical: { label: "Technical", icon: "⚡", order: 3 },
  final: { label: "Final Touches", icon: "★", order: 4 },
};

// ---------------------------------------------------------------------------
// Inject print styles once per module load. Inline so the page is
// self-contained — no CSS module dependency.
// ---------------------------------------------------------------------------
const PRINT_STYLE_ID = "omnitwin-hallkeeper-print";
if (typeof document !== "undefined" && document.getElementById(PRINT_STYLE_ID) === null) {
  const style = document.createElement("style");
  style.id = PRINT_STYLE_ID;
  style.textContent = `
    @media print {
      body, .hk-page { background: #fff !important; color: #000 !important; }
      .hk-page { max-width: 100% !important; padding: 0 !important; }
      .hk-card { background: #fff !important; border: 1px solid #ccc !important; }
      .hk-chip { background: #f3f3f3 !important; color: #000 !important; border-color: #ccc !important; }
      .hk-phase { page-break-inside: avoid; }
      .hk-actions, .hk-summary-sticky { display: none !important; }
      .hk-row { background: #fff !important; }
      .hk-row.checked { background: #f3f3f3 !important; }
      h1, h2, h3 { color: #000 !important; }
      .hk-phase-title { color: #000 !important; }
      .hk-checkbox { border-color: #000 !important; }
      .hk-qty { color: #000 !important; }
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
type CheckMap = Readonly<Record<string, boolean>>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HallkeeperPage(): React.ReactElement {
  const { configId } = useParams<{ configId: string }>();
  const [data, setData] = useState<HallkeeperSheetV2 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checks, setChecks] = useState<CheckMap>({});
  const manifestRef = useRef<HTMLDivElement>(null);

  // --- Fetch sheet data + progress in parallel ---
  useEffect(() => {
    if (configId === undefined) return;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const token = await getAuthToken();
        const headers: Record<string, string> = {};
        if (token !== null) headers["Authorization"] = `Bearer ${token}`;

        // Parallel fetch: sheet data + progress state
        const [sheetRes, progressRes] = await Promise.all([
          fetch(`${API_URL}/hallkeeper/${configId}/v2`, { headers }),
          fetch(`${API_URL}/hallkeeper/${configId}/progress`, { headers }),
        ]);

        if (sheetRes.status === 403) { setError("You don't have permission to view this events sheet."); return; }
        if (sheetRes.status === 404) { setError("Configuration not found."); return; }
        if (!sheetRes.ok) throw new Error(`Failed to load events sheet (${String(sheetRes.status)})`);

        const sheetJson = (await sheetRes.json()) as { data: HallkeeperSheetV2 };
        setData(sheetJson.data);

        if (progressRes.ok) {
          const progressJson = (await progressRes.json()) as { data: { checked: Record<string, string> } };
          const loaded: Record<string, boolean> = {};
          for (const key of Object.keys(progressJson.data.checked)) {
            loaded[key] = true;
          }
          setChecks(loaded);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, [configId]);

  // --- Toggle a row — optimistic UI + server PATCH ---
  // Updates the checkbox immediately (optimistic), then sends PATCH to
  // the server. On failure, rolls back. The hallkeeper never waits for
  // the network to tick a box.
  const handleToggle = useCallback((rowKey: string) => {
    if (configId === undefined) return;
    const wasChecked = checks[rowKey] === true;

    // Optimistic update
    setChecks((prev) => {
      const next = { ...prev };
      if (wasChecked) { delete (next as Record<string, boolean>)[rowKey]; }
      else { next[rowKey] = true; }
      return next;
    });

    // Fire-and-forget PATCH with rollback on failure
    void (async () => {
      try {
        const token = await getAuthToken();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token !== null) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(`${API_URL}/hallkeeper/${configId}/progress`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ rowKey }),
        });
        if (!res.ok) throw new Error("toggle failed");
      } catch {
        // Rollback on failure — restore the previous state
        setChecks((prev) => {
          const rolled = { ...prev };
          if (wasChecked) { rolled[rowKey] = true; }
          else { delete (rolled as Record<string, boolean>)[rowKey]; }
          return rolled;
        });
      }
    })();
  }, [configId, checks]);

  // --- Download / print handlers ---
  const handleDownload = useCallback(() => {
    if (configId === undefined) return;
    void (async () => {
      try {
        const token = await getAuthToken();
        const headers: Record<string, string> = {};
        if (token !== null) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(`${API_URL}/hallkeeper/${configId}/sheet?download=true`, { headers });
        if (!res.ok) return;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `hallkeeper-${configId}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      } catch { /* swallow — silent download failure */ }
    })();
  }, [configId]);

  const handlePrint = useCallback(() => { window.print(); }, []);

  // --- Derived counts for the progress bar ---
  const counts = useMemo(() => computeCounts(data, checks), [data, checks]);

  // --- Loading / error / empty states ---
  if (loading) {
    return (
      <div className="hk-page" style={pageStyle}>
        <div style={{ color: TEXT_MUT, fontSize: 16, textAlign: "center", paddingTop: 120 }}>
          Loading events sheet...
        </div>
      </div>
    );
  }
  if (error !== null || data === null) {
    return (
      <div className="hk-page" style={pageStyle}>
        <div role="alert" style={{ color: "#cc4444", fontSize: 16, textAlign: "center", paddingTop: 120 }}>
          {error ?? "Configuration not found"}
        </div>
      </div>
    );
  }

  return (
    <div className="hk-page" style={pageStyle}>
      {/* === HEADER === */}
      <header style={headerStyle}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", color: GOLD, textTransform: "uppercase", marginBottom: 3 }}>
          Hallkeeper Sheet
        </div>
        <h1 style={eventNameStyle}>{data.config.name}</h1>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 14px", fontSize: 11, color: TEXT_SEC, marginTop: 8 }}>
          <div><span style={{ color: TEXT_MUT }}>Venue </span>{data.venue.name}</div>
          <div><span style={{ color: TEXT_MUT }}>Guests </span><strong style={{ color: "#fff" }}>{data.config.guestCount}</strong></div>
          <div><span style={{ color: TEXT_MUT }}>Room </span>{data.space.name} · {formatDims(data.space)}</div>
          <div><span style={{ color: TEXT_MUT }}>Items </span><strong style={{ color: "#fff" }}>{data.totals.totalItems}</strong></div>
          {data.timing !== null && (
            <div style={{ gridColumn: "1 / span 2", marginTop: 4 }}>
              <span style={{ color: TEXT_MUT }}>Setup by </span>
              <strong style={{ color: GOLD }}>{formatLocalTime(data.timing.setupBy)}</strong>
              <span style={{ color: TEXT_MUT }}> · Event {formatLocalTime(data.timing.eventStart)}</span>
            </div>
          )}
        </div>
      </header>

      {/* === DIAGRAM === */}
      <section style={{ margin: "14px 0" }}>
        {data.diagramUrl !== null ? (
          <img src={data.diagramUrl} alt="Floor plan" style={{ width: "100%", height: "auto", borderRadius: 8 }} />
        ) : (
          <div style={diagramPlaceholder}>
            <div style={{ fontSize: 13, color: TEXT_MUT }}>Floor plan diagram</div>
            <div style={{ fontSize: 11, color: "#444", marginTop: 3 }}>
              Available after generating from the 3D editor
            </div>
          </div>
        )}
      </section>

      {/* === PHASES === */}
      <section ref={manifestRef} style={{ marginBottom: 16 }}>
        {data.phases.map((phase) => (
          <PhaseBlock
            key={phase.phase}
            phase={phase}
            checks={checks}
            onToggle={handleToggle}
          />
        ))}
      </section>

      {/* === ACTION BUTTONS === */}
      <div className="hk-actions" style={actionsRow}>
        <button type="button" style={actionBtnPrimary} onClick={handleDownload}>Download PDF</button>
        <button type="button" style={actionBtnSecondary} onClick={handlePrint}>Print</button>
      </div>

      {/* === STICKY PROGRESS SUMMARY === */}
      <div className="hk-summary-sticky" style={stickyBar}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 5 }}>
          {data.phases.map((p) => {
            const rows = p.zones.reduce((s, z) => s + z.rows.length, 0);
            const done = p.zones.reduce((s, z) => s + z.rows.filter((r) => checks[r.key] === true).length, 0);
            const qtyTotal = p.zones.reduce((s, z) => z.rows.reduce((ss, r) => ss + r.qty, s), 0);
            const qtyDone = p.zones.reduce((s, z) => z.rows.reduce((ss, r) => ss + (checks[r.key] === true ? r.qty : 0), s), 0);
            const complete = rows > 0 && done === rows;
            const meta = PHASE_META[p.phase];
            return (
              <span key={p.phase} className="hk-chip" style={{
                padding: "1px 7px", borderRadius: 100, fontSize: 9, fontWeight: 600, fontFamily: "DM Mono, monospace",
                background: complete ? "rgba(91,168,112,0.1)" : "#1a1a1d",
                color: complete ? GREEN : TEXT_SEC,
                border: `1px solid ${complete ? GREEN : BORDER}`,
              }}>
                {meta.icon} {qtyDone}/{qtyTotal}
              </span>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, height: 4, background: BORDER, borderRadius: 2, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 2, transition: "width 0.25s",
              width: `${String(counts.totalRows > 0 ? (counts.checkedRows / counts.totalRows) * 100 : 0)}%`,
              background: counts.allDone ? GREEN : GOLD,
            }} />
          </div>
          <span style={{ fontSize: 10, fontFamily: "DM Mono, monospace", color: counts.allDone ? GREEN : TEXT_SEC, whiteSpace: "nowrap", fontWeight: 600 }}>
            {counts.checkedRows}/{counts.totalRows}{counts.allDone ? " COMPLETE" : " rows"}
          </span>
        </div>
      </div>

      {/* === FOOTER === */}
      <footer style={footerStyle}>
        <div style={{ fontSize: 10, color: TEXT_MUT }}>
          {data.space.name} — {formatDims(data.space)}
        </div>
        <div style={{ fontSize: 9, color: "#444", marginTop: 4 }}>
          Generated by OMNITWIN — {new Date(data.generatedAt).toLocaleString()}
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PhaseBlock — a single phase section with its zones
// ---------------------------------------------------------------------------

interface PhaseBlockProps {
  readonly phase: Phase;
  readonly checks: CheckMap;
  readonly onToggle: (rowKey: string) => void;
}

function PhaseBlock({ phase, checks, onToggle }: PhaseBlockProps): React.ReactElement {
  const meta = PHASE_META[phase.phase];
  const rowCount = phase.zones.reduce((s, z) => s + z.rows.length, 0);
  const doneCount = phase.zones.reduce((s, z) => s + z.rows.filter((r) => checks[r.key] === true).length, 0);
  const qtyTotal = phase.zones.reduce((s, z) => z.rows.reduce((ss, r) => ss + r.qty, s), 0);
  const qtyDone = phase.zones.reduce((s, z) => z.rows.reduce((ss, r) => ss + (checks[r.key] === true ? r.qty : 0), s), 0);
  const phaseDone = rowCount > 0 && doneCount === rowCount;

  return (
    <section className="hk-phase" style={{ marginBottom: 16 }}>
      <div className="hk-phase-title" style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "7px 0 3px", borderBottom: `1px solid ${BORDER}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ color: GOLD, fontSize: 11 }}>{meta.icon}</span>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: phaseDone ? GREEN : "#ddd" }}>
            Phase {meta.order + 1} — {meta.label}
          </span>
        </div>
        <span style={{ fontSize: 10, fontFamily: "DM Mono, monospace", color: phaseDone ? GREEN : TEXT_MUT }}>
          {qtyDone}/{qtyTotal}{phaseDone ? " ✓" : ""}
        </span>
      </div>

      {phase.zones.map(({ zone, rows }) => (
        <div key={zone}>
          <div style={{ padding: "4px 4px 2px", fontSize: 9, fontWeight: 600, color: TEXT_MUT, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            ▹ {zone}
          </div>
          {rows.map((row, i) => {
            const done = checks[row.key] === true;
            return (
              <div
                key={row.key}
                data-row-key={row.key}
                className={`hk-row${done ? " checked" : ""}`}
                style={{
                  display: "grid", gridTemplateColumns: "1fr 40px", alignItems: "center",
                  padding: "5px 4px 5px 12px", borderRadius: 3, cursor: "pointer", userSelect: "none",
                  background: done ? "rgba(91,168,112,0.08)" : (i % 2 === 0 ? "transparent" : "#1a1a1d"),
                  borderLeft: done ? `2px solid ${GREEN}` : "2px solid transparent",
                  transition: "all 0.12s",
                }}
                onClick={() => { onToggle(row.key); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(row.key); } }}
                role="checkbox"
                aria-checked={done}
                tabIndex={0}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span className="hk-checkbox" style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: 13, height: 13, borderRadius: 2, flexShrink: 0,
                    border: `1.5px solid ${done ? GREEN : TEXT_MUT}`,
                    background: done ? GREEN : "transparent",
                    fontSize: 8, color: "#fff",
                  }}>{done ? "✓" : ""}</span>
                  <span style={{
                    fontSize: 12, fontWeight: 500,
                    color: done ? TEXT_MUT : "#eee",
                    textDecoration: done ? "line-through" : "none",
                  }}>
                    {row.name}
                  </span>
                  {row.afterDepth > 0 && (
                    <span style={{
                      fontSize: 8, color: "rgba(201,168,76,0.7)",
                      background: "rgba(201,168,76,0.1)", padding: "0 4px",
                      borderRadius: 2, fontWeight: 600,
                    }}>after</span>
                  )}
                </div>
                <div className="hk-qty" style={{
                  textAlign: "right", fontFamily: "DM Mono, monospace",
                  fontWeight: 600, fontSize: 12, color: done ? TEXT_MUT : GOLD,
                }}>
                  ×{row.qty}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeCounts(
  data: HallkeeperSheetV2 | null,
  checks: CheckMap,
): { totalRows: number; checkedRows: number; allDone: boolean } {
  if (data === null) return { totalRows: 0, checkedRows: 0, allDone: false };
  let totalRows = 0;
  let checkedRows = 0;
  for (const phase of data.phases) {
    for (const zone of phase.zones) {
      for (const row of zone.rows) {
        totalRows += 1;
        if (checks[row.key] === true) checkedRows += 1;
      }
    }
  }
  return {
    totalRows,
    checkedRows,
    allDone: totalRows > 0 && checkedRows === totalRows,
  };
}

function formatDims(space: { widthM: number; lengthM: number; heightM: number }): string {
  return `${String(space.widthM)}m × ${String(space.lengthM)}m × ${String(space.heightM)}m`;
}

function formatLocalTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: DARK_BG,
  color: "#ddd",
  fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
  maxWidth: 640,
  margin: "0 auto",
  padding: "0 16px 32px",
};

const headerStyle: React.CSSProperties = {
  paddingTop: 20,
  paddingBottom: 14,
  borderBottom: `2px solid ${GOLD}`,
};

const eventNameStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 800,
  color: "#fff",
  margin: "4px 0 2px",
  fontFamily: "'Playfair Display', serif",
  lineHeight: 1.2,
};

const diagramPlaceholder: React.CSSProperties = {
  height: 200,
  border: "1px dashed #333",
  borderRadius: 12,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
};

const actionsRow: React.CSSProperties = {
  display: "flex",
  gap: 12,
  marginBottom: 24,
};

const actionBtnPrimary: React.CSSProperties = {
  flex: 1, padding: "14px 0", borderRadius: 10, border: "none",
  background: `linear-gradient(135deg, #a8872e, ${GOLD}, #dfc06a)`,
  color: "#111", fontSize: 15, fontWeight: 700, cursor: "pointer",
  fontFamily: "inherit", letterSpacing: 0.5,
};

const actionBtnSecondary: React.CSSProperties = {
  flex: 1, padding: "14px 0", borderRadius: 10, border: "1px solid #333",
  background: "transparent", color: "#aaa", fontSize: 15, fontWeight: 500,
  cursor: "pointer", fontFamily: "inherit",
};

const stickyBar: React.CSSProperties = {
  position: "sticky" as const,
  bottom: 0,
  background: CARD_BG,
  borderTop: `1px solid ${BORDER}`,
  padding: "7px 14px 10px",
  margin: "0 -16px",
};

const footerStyle: React.CSSProperties = {
  textAlign: "center" as const,
  paddingTop: 16,
  borderTop: "1px solid #222",
};
