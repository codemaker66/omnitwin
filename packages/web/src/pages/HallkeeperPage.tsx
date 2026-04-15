import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import type { HallkeeperSheetData } from "@omnitwin/types";
import { API_URL } from "../config/env.js";
import { getAuthToken } from "../api/client.js";

// ---------------------------------------------------------------------------
// SheetData — imported from @omnitwin/types (HallkeeperSheetData).
// The API may return extra fields (venue.id, config.userId) used by the route
// handler for auth checks; we ignore them here via structural typing.
// ---------------------------------------------------------------------------
type SheetData = HallkeeperSheetData;
type ManifestRow = SheetData["manifest"]["rows"][number];

// ---------------------------------------------------------------------------
// Styles — dark theme with gold accents, matching the editor aesthetic
// ---------------------------------------------------------------------------

const GOLD = "#c9a84c";
const DARK_BG = "#111111";
const CARD_BG = "#1a1a1a";

const GROUP_LABELS: Record<string, string> = {
  stage: "Stage & Platforms",
  table: "Tables & Seating",
  av: "AV Equipment",
  lectern: "Lecterns",
  decor: "Decor & Misc",
};

const GROUP_ORDER = ["stage", "table", "av", "lectern", "decor"];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HallkeeperPage(): React.ReactElement {
  const { configId } = useParams<{ configId: string }>();
  const [data, setData] = useState<SheetData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [highlightedCode, setHighlightedCode] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(GROUP_ORDER));
  const manifestRef = useRef<HTMLDivElement>(null);

  // Fetch sheet data.
  //
  // The route is gated by ProtectedRoute, so the caller is guaranteed to be
  // an authenticated staff user by the time this effect runs. Per-resource
  // authorization (403) is still possible — e.g., a planner trying to view
  // a config owned by another venue. That case renders a distinct message.
  useEffect(() => {
    if (configId === undefined) return;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const token = await getAuthToken();
        const headers: Record<string, string> = {};
        if (token !== null) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(`${API_URL}/hallkeeper/${configId}/data`, { headers });
        if (res.status === 403) {
          setError("You don't have permission to view this events sheet.");
          return;
        }
        if (res.status === 404) {
          setError("Configuration not found.");
          return;
        }
        if (!res.ok) {
          throw new Error(`Failed to load events sheet (${String(res.status)})`);
        }
        const json = (await res.json()) as { data: SheetData };
        setData(json.data);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, [configId]);

  // Toggle group expansion
  const toggleGroup = useCallback((group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group); else next.add(group);
      return next;
    });
  }, []);

  // Highlight a manifest item.
  //
  // Today this is one-directional: tapping a row flashes that row (and
  // scrolls it into view in case the manifest scrolled off-screen).
  // The reverse direction (tap diagram → highlight matching row) needs
  // a coordinate-mapping sidecar on the diagram PNG that the backend
  // doesn't emit yet — left for when the diagram pipeline grows that
  // metadata. The state shape (highlightedCode keyed on the row code)
  // is already what diagram→row would consume, so the work to wire
  // that direction is purely on the data side.
  const handleRowTap = useCallback((code: string) => {
    setHighlightedCode(code);
    setTimeout(() => { setHighlightedCode(null); }, 2000);
    // scrollIntoView is a no-op on rows already in viewport, so this is
    // safe to call unconditionally. `block: "nearest"` keeps scrolling
    // minimal — the row only moves if it's off-screen.
    const node = manifestRef.current?.querySelector(`[data-row-code="${code}"]`);
    if (node !== null && node !== undefined) {
      (node as HTMLElement).scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, []);

  // Download PDF with authentication
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
      } catch {
        // Download failed silently
      }
    })();
  }, [configId]);

  // Print
  const handlePrint = useCallback(() => { window.print(); }, []);

  if (loading) {
    return (
      <div style={pageStyle}>
        <div style={{ color: "#666", fontSize: 16, textAlign: "center", paddingTop: 120 }}>
          Loading events sheet...
        </div>
      </div>
    );
  }

  if (error !== null || data === null) {
    return (
      <div style={pageStyle}>
        <div style={{ color: "#cc4444", fontSize: 16, textAlign: "center", paddingTop: 120 }}>
          {error ?? "Configuration not found"}
        </div>
      </div>
    );
  }

  // Group manifest rows by setupGroup
  const grouped = new Map<string, ManifestRow[]>();
  for (const row of data.manifest.rows) {
    const list = grouped.get(row.setupGroup) ?? [];
    list.push(row);
    grouped.set(row.setupGroup, list);
  }

  return (
    <div style={pageStyle}>
      {/* === HEADER === */}
      <header style={headerStyle}>
        <div style={headerTopRow}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: 2.5, color: GOLD }}>
              {data.venue.name}
            </div>
            <div style={{ fontSize: 10, color: "#777", marginTop: 2 }}>{data.venue.address}</div>
          </div>
          <div style={{ textAlign: "right" as const }}>
            <div style={{ fontSize: 36, fontWeight: 800, color: "#fff", lineHeight: 1 }}>
              {data.config.guestCount}
            </div>
            <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase" as const, letterSpacing: 1.5 }}>
              guests
            </div>
          </div>
        </div>

        <h1 style={eventNameStyle}>{data.config.name}</h1>

        <div style={headerMetaRow}>
          <span style={metaChipStyle}>{data.space.name}</span>
          <span style={metaChipStyle}>{formatLayoutStyle(data.config.layoutStyle)}</span>
          <span style={{ ...metaChipStyle, background: "rgba(201,168,76,0.15)", color: GOLD }}>
            {String(data.space.widthM)}m × {String(data.space.lengthM)}m
          </span>
        </div>
      </header>

      {/* === DIAGRAM === */}
      <section style={diagramSection}>
        {data.diagramUrl !== null ? (
          <img
            src={data.diagramUrl}
            alt="Floor plan"
            style={{ width: "100%", height: "auto", borderRadius: 8 }}
          />
        ) : (
          <div style={diagramPlaceholder}>
            <div style={{ fontSize: 14, color: "#555" }}>Floor plan diagram</div>
            <div style={{ fontSize: 11, color: "#444", marginTop: 4 }}>
              Available after generating from the 3D editor
            </div>
          </div>
        )}
      </section>

      {/* === MANIFEST ACCORDION === */}
      <section ref={manifestRef} style={manifestSection}>
        <h2 style={sectionTitle}>Setup Manifest</h2>

        {GROUP_ORDER.map((group) => {
          const rows = grouped.get(group);
          if (rows === undefined || rows.length === 0) return null;
          const isExpanded = expandedGroups.has(group);
          return (
            <div key={group} style={groupContainer}>
              <button
                type="button"
                style={groupHeaderBtn}
                onClick={() => { toggleGroup(group); }}
              >
                <span style={{ fontWeight: 600, color: "#ddd" }}>
                  {GROUP_LABELS[group] ?? group}
                </span>
                <span style={{ color: "#666", fontSize: 13 }}>
                  {rows.length} {rows.length === 1 ? "item" : "items"}
                  {isExpanded ? " ▾" : " ▸"}
                </span>
              </button>

              {isExpanded && (
                <div style={groupBody}>
                  {rows.map((row) => (
                    <div
                      key={row.code}
                      data-row-code={row.code}
                      style={{
                        ...manifestRowStyle,
                        background: highlightedCode === row.code
                          ? "rgba(201,168,76,0.15)"
                          : "transparent",
                        transition: "background 0.3s",
                      }}
                      onClick={() => { handleRowTap(row.code); }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === "Enter") handleRowTap(row.code); }}
                    >
                      <div style={rowCodeStyle}>{row.code}</div>
                      <div style={rowBodyStyle}>
                        <div style={rowItemStyle}>{row.item}</div>
                        <div style={rowPositionStyle}>{row.position}</div>
                        {row.notes !== "" && <div style={rowNotesStyle}>{row.notes}</div>}
                      </div>
                      <div style={rowQtyStyle}>×{row.qty}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Totals */}
        <div style={totalsBar}>
          <div style={{ fontWeight: 700, color: GOLD, fontSize: 13, marginBottom: 6 }}>TOTALS</div>
          <div style={totalsGrid}>
            {data.manifest.totals.entries.map((e) => (
              <div key={e.item} style={totalItemStyle}>
                <span style={{ fontWeight: 700, fontSize: 18, color: "#fff" }}>{e.qty}</span>
                <span style={{ fontSize: 11, color: "#888" }}>× {e.item}</span>
              </div>
            ))}
            {data.manifest.totals.totalChairs > 0 && (
              <div style={totalItemStyle}>
                <span style={{ fontWeight: 700, fontSize: 18, color: "#fff" }}>
                  {data.manifest.totals.totalChairs}
                </span>
                <span style={{ fontSize: 11, color: "#888" }}>× Chairs</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* === ACTION BUTTONS === */}
      <div style={actionsRow}>
        <button type="button" style={actionBtnPrimary} onClick={handleDownload}>
          Download PDF
        </button>
        <button type="button" style={actionBtnSecondary} onClick={handlePrint}>
          Print
        </button>
      </div>

      {/* === FOOTER === */}
      <footer style={footerStyle}>
        <div style={{ fontSize: 10, color: "#555" }}>
          {data.space.name} — {String(data.space.widthM)}m × {String(data.space.lengthM)}m × {String(data.space.heightM)}m
        </div>
        <div style={{ fontSize: 9, color: "#444", marginTop: 4 }}>
          Generated by OMNITWIN — {new Date(data.generatedAt).toLocaleString()}
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatLayoutStyle(style: string): string {
  return style.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Styles — inline for portability (no CSS modules needed for this page)
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
  paddingTop: 24,
  paddingBottom: 20,
  borderBottom: "1px solid #2a2a2a",
};

const headerTopRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
};

const eventNameStyle: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 800,
  color: "#fff",
  margin: "16px 0 12px",
  fontFamily: "'Playfair Display', serif",
  lineHeight: 1.2,
};

const headerMetaRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap" as const,
};

const metaChipStyle: React.CSSProperties = {
  fontSize: 11,
  padding: "4px 10px",
  borderRadius: 6,
  background: "rgba(255,255,255,0.06)",
  color: "#aaa",
  fontWeight: 500,
};

const diagramSection: React.CSSProperties = {
  margin: "20px 0",
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

const manifestSection: React.CSSProperties = {
  marginBottom: 20,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: GOLD,
  textTransform: "uppercase" as const,
  letterSpacing: 2,
  margin: "0 0 12px",
};

const groupContainer: React.CSSProperties = {
  marginBottom: 8,
  borderRadius: 10,
  overflow: "hidden",
  background: CARD_BG,
};

const groupHeaderBtn: React.CSSProperties = {
  width: "100%",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "12px 16px",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  fontSize: 14,
  fontFamily: "inherit",
};

const groupBody: React.CSSProperties = {
  borderTop: "1px solid #2a2a2a",
};

const manifestRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  padding: "10px 16px",
  gap: 12,
  cursor: "pointer",
  borderBottom: "1px solid #222",
};

const rowCodeStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 14,
  color: GOLD,
  minWidth: 40,
  flexShrink: 0,
};

const rowBodyStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const rowItemStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
  color: "#eee",
};

const rowPositionStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#777",
  marginTop: 2,
};

const rowNotesStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#999",
  marginTop: 2,
  fontStyle: "italic" as const,
};

const rowQtyStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 16,
  color: "#fff",
  flexShrink: 0,
  minWidth: 36,
  textAlign: "right" as const,
};

const totalsBar: React.CSSProperties = {
  padding: "16px",
  background: CARD_BG,
  borderRadius: 10,
  marginTop: 12,
};

const totalsGrid: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap" as const,
  gap: 16,
};

const totalItemStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column" as const,
  alignItems: "center",
  minWidth: 70,
};

const actionsRow: React.CSSProperties = {
  display: "flex",
  gap: 12,
  marginBottom: 24,
};

const actionBtnPrimary: React.CSSProperties = {
  flex: 1,
  padding: "14px 0",
  borderRadius: 10,
  border: "none",
  background: `linear-gradient(135deg, #a8872e, ${GOLD}, #dfc06a)`,
  color: "#111",
  fontSize: 15,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
  letterSpacing: 0.5,
};

const actionBtnSecondary: React.CSSProperties = {
  flex: 1,
  padding: "14px 0",
  borderRadius: 10,
  border: "1px solid #333",
  background: "transparent",
  color: "#aaa",
  fontSize: 15,
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: "inherit",
};

const footerStyle: React.CSSProperties = {
  textAlign: "center" as const,
  paddingTop: 16,
  borderTop: "1px solid #222",
};
