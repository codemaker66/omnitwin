import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  ackProgress,
  enqueueProgress,
  listPendingProgress,
  opsStillNeedingReplay,
} from "../lib/progress-sync-queue.js";
import { useParams } from "react-router-dom";
import type {
  HallkeeperSheetV2,
  Phase,
  AccessibilityCallout,
  SheetApproval,
} from "@omnitwin/types";
import {
  BRAND,
  PHASE_METADATA,
  SEVERITY_PALETTE,
  buildAccessibilityCallouts,
  buildDoorScheduleSummary,
  dietaryTotal,
  hasDietaryContent,
} from "@omnitwin/types";
import { API_URL } from "../config/env.js";
import { getAuthToken } from "../api/client.js";
import { InstructionsBanner } from "../components/hallkeeper/InstructionsBanner.js";
import { InteractiveFloorPlan } from "../components/hallkeeper/InteractiveFloorPlan.js";
import { HallkeeperStatusBanner } from "../components/hallkeeper/HallkeeperStatusBanner.js";
import {
  GOLD, GREEN, DARK_BG, CARD_BG, BORDER, TEXT_MUT, TEXT_SEC,
} from "../constants/ui-palette.js";

// ---------------------------------------------------------------------------
// HallkeeperPage — S+ operations-grade events sheet
//
// Server-backed: fetches /v2 (manifest) + /progress (checkboxes) in
// parallel. Checkbox toggles are optimistic with rollback on failure.
// Multiple hallkeepers share the same state.
//
// Design principles (matching the PDF):
//   - Scanability: phase headers are bold + collapsible
//   - Pen-friendliness: checkboxes are 44px touch targets
//   - Authority: gold accents, structured info grid, progress bar
//   - Responsive: works on phone (320px) through desktop (1200px)
// ---------------------------------------------------------------------------

type CheckMap = Readonly<Record<string, boolean>>;

/**
 * Set-or-clear a row's checked state without dynamic `delete`, which is
 * banned by @typescript-eslint/no-dynamic-delete. We rebuild the map
 * each toggle — map sizes are small (≤ hundreds of rows) so this is
 * cheaper than the allocator overhead of a `Set`.
 */
function toggleCheck(prev: CheckMap, rowKey: string, next: boolean): CheckMap {
  if (next) return { ...prev, [rowKey]: true };
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(prev)) {
    if (k !== rowKey) out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Print styles (injected once)
// ---------------------------------------------------------------------------
const PRINT_STYLE_ID = "omnitwin-hallkeeper-print";
if (typeof document !== "undefined" && document.getElementById(PRINT_STYLE_ID) === null) {
  const style = document.createElement("style");
  style.id = PRINT_STYLE_ID;
  style.textContent = `
    @media print {
      body, .hk-page { background: #fff !important; color: #000 !important; }
      .hk-page { max-width: 100% !important; padding: 0 12px !important; }
      .hk-card { background: #fff !important; border: 1px solid #ccc !important; }
      .hk-phase { page-break-inside: avoid; }
      .hk-actions, .hk-summary-sticky, .hk-retry-btn { display: none !important; }
      .hk-row { background: #fff !important; }
      .hk-row:nth-child(even) { background: #f5f5f5 !important; }
      h1, h2, h3 { color: #000 !important; }
      .hk-checkbox { border-color: #000 !important; }
    }
    @keyframes hk-pulse {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 0.15; }
    }
    @keyframes hk-celebrate {
      0% { transform: scale(0.8); opacity: 0; }
      50% { transform: scale(1.05); }
      100% { transform: scale(1); opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HallkeeperPage(): React.ReactElement {
  const { configId } = useParams<{ configId: string }>();
  const [data, setData] = useState<HallkeeperSheetV2 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checks, setChecks] = useState<CheckMap>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [highlightedRowKey, setHighlightedRowKey] = useState<string | null>(null);
  // Count of progress toggles queued offline. Surfaces as a small
  // badge on the page so the hallkeeper sees "3 edits pending sync"
  // when WiFi drops mid-event-setup. The number drains to 0 when the
  // online-event flush runs on reconnect.
  const [pendingCount, setPendingCount] = useState(0);
  const diagramRef = useRef<HTMLDivElement>(null);
  const fetchCountRef = useRef(0);

  // --- Fetch sheet data + progress in parallel ---
  const loadData = useCallback(() => {
    if (configId === undefined) return;
    setLoading(true);
    setError(null);
    fetchCountRef.current += 1;
    const thisFetch = fetchCountRef.current;
    void (async () => {
      try {
        const token = await getAuthToken();
        const headers: Record<string, string> = {};
        if (token !== null) headers["Authorization"] = `Bearer ${token}`;

        const [sheetRes, progressRes] = await Promise.all([
          fetch(`${API_URL}/hallkeeper/${configId}/v2`, { headers }),
          fetch(`${API_URL}/hallkeeper/${configId}/progress`, { headers }),
        ]);

        // Stale-request guard
        if (thisFetch !== fetchCountRef.current) return;

        if (sheetRes.status === 403) { setError("You don't have permission to view this events sheet."); return; }
        if (sheetRes.status === 404) { setError("Configuration not found."); return; }
        if (!sheetRes.ok) throw new Error(`Failed to load (${String(sheetRes.status)})`);

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
        if (thisFetch !== fetchCountRef.current) return;
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (thisFetch === fetchCountRef.current) setLoading(false);
      }
    })();
  }, [configId]);

  useEffect(() => { loadData(); }, [loadData]);

  // --- Toggle with optimistic UI + offline-resilient server PATCH ---
  //
  // Three-state behaviour:
  //   1. PATCH succeeds → UI matches server, no queue work.
  //   2. PATCH fails (network / 5xx) → ENQUEUE the desired state in
  //      IDB and KEEP the optimistic UI. The hallkeeper's checkmark
  //      stays checked even though the server hasn't heard yet.
  //      An `online`-event listener flushes the queue on reconnect.
  //   3. Old behaviour (rollback on any failure) caused users to
  //      double-tap when WiFi was flaky and lose work — the new
  //      enqueue path makes the tablet usable in the bad-network
  //      conditions where it matters most.
  const handleToggle = useCallback((rowKey: string) => {
    if (configId === undefined) return;
    const wasChecked = checks[rowKey] === true;
    const desiredChecked = !wasChecked;

    setChecks((prev) => toggleCheck(prev, rowKey, desiredChecked));

    void (async () => {
      try {
        const token = await getAuthToken();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token !== null) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(`${API_URL}/hallkeeper/${configId}/progress`, {
          method: "PATCH", headers, body: JSON.stringify({ rowKey }),
        });
        if (!res.ok) throw new Error("toggle failed");
      } catch {
        // Network / server error — KEEP the optimistic UI and queue
        // the intent for replay. The flush effect below drains on
        // reconnect.
        try {
          await enqueueProgress(configId, rowKey, desiredChecked);
          const pending = await listPendingProgress();
          setPendingCount(pending.length);
        } catch {
          // IDB unreachable — last-resort rollback so the UI doesn't
          // show a check that's neither on the server nor in IDB.
          setChecks((prev) => toggleCheck(prev, rowKey, wasChecked));
        }
      }
    })();
  }, [configId, checks]);

  // --- Flush queued progress on reconnect ---
  //
  // The browser fires a global `online` event when network comes
  // back. We read the queue, filter to ops still needing replay
  // (the server may already match, e.g. another device toggled the
  // same row), then re-issue each PATCH. Successful replays delete
  // their queue entry; failures stay queued for the next attempt.
  useEffect(() => {
    if (configId === undefined) return;

    const flush = (): void => {
      void (async () => {
        try {
          const queued = await listPendingProgress();
          if (queued.length === 0) return;
          const serverChecked = new Set(
            Object.keys(checks).filter((k) => checks[k] === true),
          );
          const toReplay = opsStillNeedingReplay(queued, serverChecked);

          const token = await getAuthToken();
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (token !== null) headers["Authorization"] = `Bearer ${token}`;

          for (const op of toReplay) {
            try {
              const res = await fetch(`${API_URL}/hallkeeper/${op.configId}/progress`, {
                method: "PATCH", headers, body: JSON.stringify({ rowKey: op.rowKey }),
              });
              if (res.ok) await ackProgress(op.configId, op.rowKey);
            } catch {
              // Leave queued for next flush.
            }
          }

          // Acknowledge any ops that were already-converged no-ops too.
          for (const op of queued) {
            if (!toReplay.some((r) => r.rowKey === op.rowKey)) {
              await ackProgress(op.configId, op.rowKey);
            }
          }

          const remaining = await listPendingProgress();
          setPendingCount(remaining.length);
        } catch {
          // Don't surface — flush failures are silent ops noise.
        }
      })();
    };

    // Initial drain on mount in case the previous session left ops.
    flush();

    window.addEventListener("online", flush);
    return () => {
      window.removeEventListener("online", flush);
    };
  }, [configId, checks]);

  // --- Phase collapse ---
  const toggleCollapse = useCallback((phase: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(phase)) next.delete(phase); else next.add(phase);
      return next;
    });
  }, []);

  // --- Highlight handoff: row click → floor plan, marker click → row ---
  //
  // Clicking a manifest row toggles its highlight state; the floor plan
  // pulses that row's markers and dims the rest. Clicking a marker sets
  // the same state AND scrolls the manifest row into view so a
  // hallkeeper asking "what's that one?" can tap a marker and see the
  // checklist jump straight to it.
  const handleHighlightRow = useCallback((rowKey: string) => {
    setHighlightedRowKey((prev) => prev === rowKey ? null : rowKey);
    if (diagramRef.current !== null) {
      diagramRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, []);

  const handleMarkerClick = useCallback((rowKey: string) => {
    setHighlightedRowKey(rowKey);
    const el = document.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(rowKey)}"]`);
    if (el !== null) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

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
      } catch { /* swallow */ }
    })();
  }, [configId]);

  const handlePrint = useCallback(() => { window.print(); }, []);

  const counts = useMemo(() => computeCounts(data, checks), [data, checks]);

  // =====================================================================
  // LOADING SKELETON
  // =====================================================================
  if (loading) {
    return (
      <div className="hk-page" style={pageStyle}>
        <div style={{ paddingTop: 20 }}>
          {/* Skeleton header */}
          <div style={{ ...skeletonBar, width: 120, height: 10, marginBottom: 8 }} />
          <div style={{ ...skeletonBar, width: "70%", height: 24, marginBottom: 12 }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div style={{ ...skeletonBar, height: 14 }} />
            <div style={{ ...skeletonBar, height: 14 }} />
            <div style={{ ...skeletonBar, height: 14 }} />
            <div style={{ ...skeletonBar, height: 14 }} />
          </div>
          <div style={{ ...skeletonBar, width: "100%", height: 160, marginTop: 16, borderRadius: 8 }} />
          {/* Skeleton rows */}
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} style={{ ...skeletonBar, height: 16, marginTop: 8, width: `${String(80 - i * 5)}%` }} />
          ))}
        </div>
      </div>
    );
  }

  // =====================================================================
  // ERROR STATE + RETRY
  // =====================================================================
  if (error !== null || data === null) {
    return (
      <div className="hk-page" style={pageStyle}>
        <div style={{ textAlign: "center", paddingTop: 100 }}>
          <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.15 }}>⚠</div>
          <div role="alert" style={{ color: "#ef4444", fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
            {error ?? "Configuration not found"}
          </div>
          <p style={{ color: TEXT_MUT, fontSize: 13, marginBottom: 20 }}>
            {error !== null && error.includes("permission") ? "Ask the events manager to share access." : "Check the link and try again."}
          </p>
          <button
            type="button"
            className="hk-retry-btn"
            onClick={loadData}
            style={{
              padding: "10px 28px", fontSize: 14, fontWeight: 600, borderRadius: 8,
              background: GOLD, color: "#111", border: "none", cursor: "pointer",
            }}
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // =====================================================================
  // EMPTY STATE (config has no phases / no placed items)
  // =====================================================================
  if (data.phases.length === 0) {
    return (
      <div className="hk-page" style={pageStyle}>
        <header style={headerStyle}>
          <div style={labelStyle}>Hallkeeper Sheet</div>
          <h1 style={eventNameStyle}>{data.config.name}</h1>
        </header>
        <div style={{ textAlign: "center", paddingTop: 60 }}>
          <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.1 }}>▣</div>
          <div style={{ color: TEXT_SEC, fontSize: 15, fontWeight: 500 }}>No items placed yet</div>
          <p style={{ color: TEXT_MUT, fontSize: 13, marginTop: 8, maxWidth: 300, margin: "8px auto 0" }}>
            The planner hasn't added furniture to this layout. Once they save a layout, the setup manifest will appear here automatically.
          </p>
        </div>
      </div>
    );
  }

  // =====================================================================
  // MAIN RENDER
  // =====================================================================
  return (
    <main
      className="hk-page"
      style={pageStyle}
      aria-label={`Hallkeeper sheet for ${data.config.name} at ${data.venue.name}`}
    >
      {/* Skip link — first focusable element; jumps keyboard users
          past the header straight into the manifest. Off-screen
          until focused — standard skip-link pattern so sighted
          users don't see it unless they tab into it. */}
      <a
        href="#hk-manifest"
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          padding: "8px 14px",
          background: "#1a1a2e",
          color: "#fff",
          borderRadius: 6,
          fontSize: 13,
          textDecoration: "none",
          zIndex: 1000,
          transform: "translateY(-200%)",
          transition: "transform 0.15s",
        }}
        onFocus={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
        onBlur={(e) => { e.currentTarget.style.transform = "translateY(-200%)"; }}
      >
        Skip to setup manifest
      </a>

      {/* === REVIEW STATUS BANNER ===
          Surfaces whether this sheet is approved (source of truth) or a
          preview. Gracefully no-ops for configs that pre-date the review
          workflow — rendering nothing when the status / snapshot aren't
          accessible. */}
      <HallkeeperStatusBanner configId={data.config.id} />

      {/* === OFFLINE QUEUE BADGE — visible when toggles are queued === */}
      {pendingCount > 0 && <OfflinePendingBadge count={pendingCount} />}

      {/* === APPROVAL STAMP — only renders on approved sheets === */}
      {data.approval !== null && (
        <ApprovalStampBanner approval={data.approval} timezone={data.venue.timezone} />
      )}

      {/* === HEADER === */}
      <header style={headerStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={labelStyle}>Hallkeeper Sheet</div>
            <h1 style={eventNameStyle}>{data.config.name}</h1>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: "#fff", lineHeight: 1 }}>{data.config.guestCount}</div>
            <div style={{ fontSize: 9, color: TEXT_MUT, textTransform: "uppercase", letterSpacing: 1.5 }}>guests</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 14px", fontSize: 11, color: TEXT_SEC, marginTop: 10 }}>
          <div><span style={{ color: TEXT_MUT }}>Venue </span>{data.venue.name}</div>
          <div><span style={{ color: TEXT_MUT }}>Room </span>{data.space.name} · {formatDims(data.space)}</div>
          <div><span style={{ color: TEXT_MUT }}>Layout </span>{formatLayoutStyle(data.config.layoutStyle)}</div>
          <div><span style={{ color: TEXT_MUT }}>Items </span><strong style={{ color: "#fff" }}>{data.totals.totalItems}</strong></div>
        </div>

        {data.timing !== null && (
          <div style={{
            marginTop: 10, padding: "8px 12px", borderRadius: 8,
            background: "rgba(201,168,76,0.08)", border: `1px solid rgba(201,168,76,0.2)`,
          }}>
            <strong style={{ color: GOLD, fontSize: 13 }}>Setup by {formatLocalTime(data.timing.setupBy)}</strong>
            <span style={{ color: TEXT_SEC, fontSize: 12, marginLeft: 10 }}>Event {formatLocalTime(data.timing.eventStart)}</span>
          </div>
        )}
      </header>

      {/* === INSTRUCTIONS BANNER === */}
      {data.instructions !== null && (
        <InstructionsBanner instructions={data.instructions} />
      )}

      {/* === ACCESSIBILITY CALLOUTS === */}
      {data.instructions !== null && (
        <AccessibilityCallouts
          callouts={buildAccessibilityCallouts(data.instructions.accessibility)}
        />
      )}

      {/* === DIETARY SUMMARY === */}
      {data.instructions !== null && data.instructions.dietary !== null
        && hasDietaryContent(data.instructions.dietary) && (
        <DietarySummaryBlock dietary={data.instructions.dietary} />
      )}

      {/* === DOOR SCHEDULE === */}
      {data.instructions !== null && (() => {
        const summary = buildDoorScheduleSummary(data.instructions.doorSchedule);
        if (summary === null) return null;
        return <DoorScheduleBlock summary={summary} />;
      })()}

      {/* === DIAGRAM — interactive floor plan with row↔marker link === */}
      <section ref={diagramRef} style={{ margin: "14px 0" }}>
        <InteractiveFloorPlan
          room={data.space}
          phases={data.phases}
          highlightedRowKey={highlightedRowKey}
          onMarkerClick={handleMarkerClick}
        />
        {highlightedRowKey !== null && (
          <button
            type="button"
            onClick={() => { setHighlightedRowKey(null); }}
            style={{
              marginTop: 8, padding: "6px 12px", borderRadius: 6,
              background: "transparent", color: TEXT_SEC,
              border: `1px solid ${BORDER}`, cursor: "pointer",
              fontSize: 11, fontFamily: "inherit",
            }}
          >
            Clear highlight
          </button>
        )}
      </section>

      {/* === PHASES === */}
      <section id="hk-manifest" style={{ marginBottom: 16 }} aria-label="Setup manifest">
        {data.phases.map((phase) => (
          <PhaseBlock
            key={phase.phase}
            phase={phase}
            checks={checks}
            onToggle={handleToggle}
            highlightedRowKey={highlightedRowKey}
            onHighlightRow={handleHighlightRow}
            isCollapsed={collapsed.has(phase.phase)}
            onToggleCollapse={() => { toggleCollapse(phase.phase); }}
          />
        ))}
      </section>

      {/* === COMPLETION CELEBRATION === */}
      {counts.allDone && (
        <div style={{
          textAlign: "center", padding: "24px 16px", marginBottom: 16,
          background: "rgba(91,168,112,0.08)", borderRadius: 12,
          border: `1px solid rgba(91,168,112,0.2)`,
          animation: "hk-celebrate 0.5s ease forwards",
        }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>✓</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: GREEN }}>Setup Complete</div>
          <div style={{ fontSize: 12, color: TEXT_SEC, marginTop: 4 }}>
            All {counts.totalRows} items verified. Ready for the event.
          </div>
        </div>
      )}

      {/* === ACTION BUTTONS === */}
      <div className="hk-actions" style={actionsRow}>
        <button type="button" style={actionBtnPrimary} onClick={handleDownload}>Download PDF</button>
        <button type="button" style={actionBtnSecondary} onClick={handlePrint}>Print</button>
      </div>

      {/* === STICKY PROGRESS === */}
      <div className="hk-summary-sticky" style={stickyBar}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 5 }}>
          {data.phases.map((p) => {
            const rows = p.zones.reduce((s, z) => s + z.rows.length, 0);
            const done = p.zones.reduce((s, z) => s + z.rows.filter((r) => checks[r.key] === true).length, 0);
            const complete = rows > 0 && done === rows;
            const meta = PHASE_METADATA[p.phase];
            return (
              <span key={p.phase} className="hk-chip" style={{
                padding: "1px 7px", borderRadius: 100, fontSize: 9, fontWeight: 600,
                background: complete ? "rgba(91,168,112,0.1)" : "#1a1a1d",
                color: complete ? GREEN : TEXT_SEC,
                border: `1px solid ${complete ? GREEN : BORDER}`,
              }}>
                {meta.icon} {done}/{rows}
              </span>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, height: 4, background: BORDER, borderRadius: 2, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 2, transition: "width 0.3s ease",
              width: `${String(counts.totalRows > 0 ? (counts.checkedRows / counts.totalRows) * 100 : 0)}%`,
              background: counts.allDone ? GREEN : GOLD,
            }} />
          </div>
          <span style={{ fontSize: 10, fontWeight: 600, color: counts.allDone ? GREEN : TEXT_SEC, whiteSpace: "nowrap" }}>
            {counts.checkedRows}/{counts.totalRows}{counts.allDone ? " ✓" : ""}
          </span>
        </div>
      </div>

      {/* === FOOTER === */}
      <footer style={footerStyle}>
        <div style={{ fontSize: 10, color: TEXT_MUT }}>{data.space.name} — {formatDims(data.space)}</div>
        <div style={{ fontSize: 9, color: "#444", marginTop: 4 }}>Generated by OMNITWIN — {new Date(data.generatedAt).toLocaleString()}</div>
      </footer>
    </main>
  );
}

// ---------------------------------------------------------------------------
// PhaseBlock — collapsible phase section
// ---------------------------------------------------------------------------

interface PhaseBlockProps {
  readonly phase: Phase;
  readonly checks: CheckMap;
  readonly onToggle: (rowKey: string) => void;
  readonly highlightedRowKey: string | null;
  readonly onHighlightRow: (rowKey: string) => void;
  readonly isCollapsed: boolean;
  readonly onToggleCollapse: () => void;
}

function PhaseBlock({ phase, checks, onToggle, highlightedRowKey, onHighlightRow, isCollapsed, onToggleCollapse }: PhaseBlockProps): React.ReactElement {
  const meta = PHASE_METADATA[phase.phase];
  const rowCount = phase.zones.reduce((s, z) => s + z.rows.length, 0);
  const doneCount = phase.zones.reduce((s, z) => s + z.rows.filter((r) => checks[r.key] === true).length, 0);
  const qtyTotal = phase.zones.reduce((s, z) => z.rows.reduce((ss, r) => ss + r.qty, s), 0);
  const qtyDone = phase.zones.reduce((s, z) => z.rows.reduce((ss, r) => ss + (checks[r.key] === true ? r.qty : 0), s), 0);
  const phaseDone = rowCount > 0 && doneCount === rowCount;

  return (
    <section className="hk-phase" style={{ marginBottom: 12 }}>
      <button
        type="button"
        onClick={onToggleCollapse}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          width: "100%", padding: "8px 10px", borderRadius: 8, cursor: "pointer",
          background: phaseDone ? "rgba(91,168,112,0.06)" : CARD_BG,
          border: `1px solid ${phaseDone ? "rgba(91,168,112,0.2)" : BORDER}`,
          fontFamily: "inherit", textAlign: "left",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: GOLD, fontSize: 12 }}>{meta.icon}</span>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: phaseDone ? GREEN : "#ddd" }}>
            Phase {meta.order} — {meta.label}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: phaseDone ? GREEN : TEXT_MUT }}>
            {qtyDone}/{qtyTotal}{phaseDone ? " ✓" : ""}
          </span>
          <span style={{ fontSize: 10, color: TEXT_MUT }}>{isCollapsed ? "▸" : "▾"}</span>
        </div>
      </button>

      {!isCollapsed && (
        <div style={{ marginTop: 4 }}>
          {phase.zones.map(({ zone, rows }) => (
            <div key={zone}>
              <div style={{ padding: "4px 6px 2px", fontSize: 9, fontWeight: 600, color: TEXT_MUT, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                ▹ {zone}
              </div>
              {rows.map((row, i) => {
                const done = checks[row.key] === true;
                const highlighted = highlightedRowKey === row.key;
                const locatable = row.positions.length > 0;
                return (
                  <div
                    key={row.key}
                    data-row-key={row.key}
                    className={`hk-row${done ? " checked" : ""}${highlighted ? " highlighted" : ""}`}
                    onClick={() => { onToggle(row.key); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(row.key); } }}
                    role="checkbox"
                    aria-checked={done}
                    tabIndex={0}
                    style={{
                      display: "grid", gridTemplateColumns: locatable ? "1fr 28px 40px" : "1fr 40px",
                      alignItems: "center",
                      padding: "6px 6px 6px 12px", borderRadius: 4, userSelect: "none",
                      background: done
                        ? "rgba(91,168,112,0.08)"
                        : highlighted
                          ? "rgba(201,168,76,0.12)"
                          : (i % 2 === 0 ? "transparent" : "#1a1a1d"),
                      borderLeft: done
                        ? `2px solid ${GREEN}`
                        : highlighted
                          ? `2px solid ${GOLD}`
                          : "2px solid transparent",
                      transition: "all 0.12s",
                      minHeight: 44, // touch target — whole row is tap-to-tick
                      cursor: "pointer",
                    }}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 32 }}
                    >
                      <span className="hk-checkbox" style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        width: 16, height: 16, borderRadius: 3, flexShrink: 0,
                        border: `1.5px solid ${done ? GREEN : TEXT_MUT}`,
                        background: done ? GREEN : "transparent",
                        fontSize: 10, color: "#fff", transition: "all 0.15s",
                      }}>{done ? "✓" : ""}</span>
                      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span style={{
                            fontSize: 13, fontWeight: 500,
                            color: done ? TEXT_MUT : "#eee",
                            textDecoration: done ? "line-through" : "none",
                          }}>
                            {row.name}
                          </span>
                          {row.afterDepth > 0 && (
                            <span style={{
                              fontSize: 8, color: "rgba(201,168,76,0.7)",
                              background: "rgba(201,168,76,0.1)", padding: "1px 5px",
                              borderRadius: 3, fontWeight: 600,
                            }}>after</span>
                          )}
                        </div>
                        {row.notes.length > 0 && (
                          <div
                            className="hk-row-note"
                            style={{
                              fontSize: 11, fontStyle: "italic",
                              color: done ? TEXT_MUT : GOLD,
                              marginTop: 1, lineHeight: 1.3,
                            }}
                          >
                            ▸ {row.notes}
                          </div>
                        )}
                      </div>
                    </div>
                    {locatable && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onHighlightRow(row.key); }}
                        aria-label={highlighted ? "Hide on floor plan" : "Locate on floor plan"}
                        style={{
                          width: 28, height: 28, borderRadius: 4,
                          background: highlighted ? "rgba(201,168,76,0.25)" : "transparent",
                          border: `1px solid ${highlighted ? GOLD : BORDER}`,
                          color: highlighted ? GOLD : TEXT_SEC,
                          cursor: "pointer", fontSize: 13,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontFamily: "inherit",
                        }}
                        title={highlighted ? "Hide on floor plan" : `Locate ×${String(row.positions.length)} on floor plan`}
                      >
                        ◎
                      </button>
                    )}
                    <div style={{
                      textAlign: "right", fontWeight: 700, fontSize: 13, color: done ? TEXT_MUT : GOLD,
                    }}>
                      ×{row.qty}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeCounts(
  data: HallkeeperSheetV2 | null, checks: CheckMap,
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
  return { totalRows, checkedRows, allDone: totalRows > 0 && checkedRows === totalRows };
}

function formatDims(space: { widthM: number; lengthM: number; heightM: number }): string {
  return `${String(space.widthM)}m × ${String(space.lengthM)}m × ${String(space.heightM)}m`;
}

function formatLocalTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatLayoutStyle(style: string): string {
  return style.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const skeletonBar: React.CSSProperties = {
  background: "#252320", borderRadius: 4,
  animation: "hk-pulse 1.5s ease-in-out infinite",
};

const pageStyle: React.CSSProperties = {
  minHeight: "100vh", background: DARK_BG, color: "#ddd",
  fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
  maxWidth: 640, margin: "0 auto", padding: "0 16px 32px",
};

const headerStyle: React.CSSProperties = {
  paddingTop: 20, paddingBottom: 14, borderBottom: `2px solid ${GOLD}`,
};

const labelStyle: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", color: GOLD, textTransform: "uppercase", marginBottom: 3,
};

const eventNameStyle: React.CSSProperties = {
  fontSize: 22, fontWeight: 800, color: "#fff", margin: "4px 0 2px",
  fontFamily: "'Playfair Display', serif", lineHeight: 1.2,
};

const actionsRow: React.CSSProperties = { display: "flex", gap: 12, marginBottom: 24 };

const actionBtnPrimary: React.CSSProperties = {
  flex: 1, padding: "14px 0", borderRadius: 10, border: "none",
  background: `linear-gradient(135deg, #a8872e, ${GOLD}, #dfc06a)`,
  color: "#111", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
};

const actionBtnSecondary: React.CSSProperties = {
  flex: 1, padding: "14px 0", borderRadius: 10, border: "1px solid #333",
  background: "transparent", color: "#aaa", fontSize: 15, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
};

const stickyBar: React.CSSProperties = {
  position: "sticky", bottom: 0, background: CARD_BG,
  borderTop: `1px solid ${BORDER}`, padding: "7px 14px 10px", margin: "0 -16px",
};

const footerStyle: React.CSSProperties = {
  textAlign: "center", paddingTop: 16, borderTop: "1px solid #222",
};

// ---------------------------------------------------------------------------
// AccessibilityCallouts — critical / warning / info bands.
//
// Critical callouts (hearing loop, wheelchair spaces, sign-language
// interpreter) render FIRST in a red-bordered stack at the top so the
// hallkeeper sees them before anything else. Warning + info callouts
// follow in a compact info block. Empty → renders nothing.
// ---------------------------------------------------------------------------

function AccessibilityCallouts(
  { callouts }: { callouts: readonly AccessibilityCallout[] },
): React.ReactElement | null {
  if (callouts.length === 0) return null;
  const critical = callouts.filter((c) => c.severity === "critical");
  const other = callouts.filter((c) => c.severity !== "critical");

  return (
    <section style={{ margin: "12px 0", display: "flex", flexDirection: "column", gap: 8 }}>
      {critical.length > 0 && (
        <div
          role="alert"
          aria-live="assertive"
          style={{
            padding: "12px 14px",
            borderLeft: `4px solid ${SEVERITY_PALETTE.critical.border}`,
            background: "rgba(239, 68, 68, 0.12)",
            borderRadius: "0 6px 6px 0",
          }}
        >
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
            textTransform: "uppercase",
            color: SEVERITY_PALETTE.critical.border,
            marginBottom: 6,
          }}>
            Critical — action required before guests arrive
          </div>
          {critical.map((c, i) => (
            <div key={`${c.label}-${String(i)}`} style={{ fontSize: 12, color: "#fff", padding: "3px 0" }}>
              <strong style={{ color: SEVERITY_PALETTE.critical.border }}>{c.label}:</strong>{" "}
              <span style={{ color: TEXT_SEC }}>{c.detail}</span>
            </div>
          ))}
        </div>
      )}

      {other.length > 0 && (
        <div
          role="status"
          style={{
            padding: "10px 14px",
            borderLeft: `3px solid ${SEVERITY_PALETTE.info.border}`,
            background: "rgba(255, 255, 255, 0.02)",
            borderRadius: "0 6px 6px 0",
            border: `1px solid ${BORDER}`,
          }}
        >
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
            textTransform: "uppercase", color: TEXT_SEC, marginBottom: 6,
          }}>
            Accessibility
          </div>
          {other.map((c, i) => (
            <div key={`${c.label}-${String(i)}`} style={{ fontSize: 12, color: TEXT_SEC, padding: "2px 0" }}>
              <strong style={{ color: "#fff" }}>{c.label}:</strong> {c.detail}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// DietarySummaryBlock — single-line summary row.
//
// Only counts with value > 0 render. Empty → parent gates via
// hasDietaryContent. Total is bolded + gold so the hallkeeper's eye
// lands on it first. Other allergies, when set, render on a second line.
// ---------------------------------------------------------------------------

import type { DietarySummary, DoorScheduleSummary } from "@omnitwin/types";

type DietaryCountKey = "vegetarian" | "vegan" | "glutenFree" | "nutFree" | "halal" | "kosher";

const DIETARY_LABELS: readonly { readonly key: DietaryCountKey; readonly label: string }[] = [
  { key: "vegetarian", label: "Veg" },
  { key: "vegan", label: "Vegan" },
  { key: "glutenFree", label: "GF" },
  { key: "nutFree", label: "Nut-free" },
  { key: "halal", label: "Halal" },
  { key: "kosher", label: "Kosher" },
];

function DietarySummaryBlock(
  { dietary }: { dietary: DietarySummary },
): React.ReactElement {
  const total = dietaryTotal(dietary);
  const entries = DIETARY_LABELS
    .map((d) => ({ ...d, count: dietary[d.key] }))
    .filter((d) => d.count > 0);

  return (
    <section
      style={{
        margin: "12px 0",
        padding: "10px 14px",
        background: "rgba(255,255,255,0.02)",
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        borderLeft: `3px solid ${GOLD}`,
      }}
    >
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
        textTransform: "uppercase", color: TEXT_SEC, marginBottom: 6,
      }}>
        Dietary — <span style={{ color: GOLD }}>{String(total)}</span> special meals
      </div>
      {entries.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 12, color: "#fff" }}>
          {entries.map((d) => (
            <span key={d.key}>
              <strong style={{ color: GOLD, fontVariantNumeric: "tabular-nums" }}>{String(d.count)}</strong>
              <span style={{ color: TEXT_SEC, marginLeft: 4 }}>{d.label}</span>
            </span>
          ))}
        </div>
      )}
      {dietary.otherAllergies.trim().length > 0 && (
        <div style={{
          fontSize: 12, color: "#fff", marginTop: 6,
          padding: "6px 10px",
          background: "rgba(239, 68, 68, 0.12)",
          borderLeft: `3px solid ${SEVERITY_PALETTE.critical.border}`,
          borderRadius: "0 4px 4px 0",
        }}>
          <strong style={{ color: SEVERITY_PALETTE.critical.border }}>Allergies:</strong>{" "}
          <span>{dietary.otherAllergies.trim()}</span>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// DoorScheduleBlock — compact per-door timeline.
//
// Each door renders a label + ordered list of {time} {open|lock} {note}
// rows. Events already sorted by buildDoorScheduleSummary. Open events
// get a green dot; lock events a muted dot — fast visual parsing.
// ---------------------------------------------------------------------------

function DoorScheduleBlock(
  { summary }: { summary: DoorScheduleSummary },
): React.ReactElement {
  const fmtTime = (iso: string): string => {
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    } catch {
      return iso;
    }
  };

  return (
    <section
      style={{
        margin: "12px 0",
        padding: "10px 14px",
        background: "rgba(255,255,255,0.02)",
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
      }}
    >
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
        textTransform: "uppercase", color: TEXT_SEC, marginBottom: 8,
      }}>
        Door schedule
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {summary.entries.map((door, doorIdx) => (
          <div key={`${door.label}-${String(doorIdx)}`}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", marginBottom: 4 }}>
              {door.label}
            </div>
            {door.events.length === 0 ? (
              <div style={{ fontSize: 11, color: TEXT_MUT, paddingLeft: 12 }}>
                No events scheduled
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {door.events.map((ev, eventIdx) => (
                  <div
                    key={`${String(doorIdx)}-${String(eventIdx)}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "10px 56px 60px 1fr",
                      gap: 8,
                      alignItems: "center",
                      fontSize: 12,
                      color: TEXT_SEC,
                      padding: "2px 0",
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: ev.kind === "open" ? GREEN : TEXT_MUT,
                      }}
                    />
                    <span style={{ color: "#fff", fontVariantNumeric: "tabular-nums" }}>
                      {fmtTime(ev.at)}
                    </span>
                    <span style={{ textTransform: "uppercase", letterSpacing: 0.3, fontSize: 10, fontWeight: 700, color: ev.kind === "open" ? GREEN : TEXT_MUT }}>
                      {ev.kind}
                    </span>
                    <span>{ev.note}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// ApprovalStampBanner — surfaces the PDF's approval band on the tablet.
//
// Renders a green full-width band at the top of the page (above the
// status banner and header) with:
//   - checkmark + "APPROVED" + snapshot version (left)
//   - approver name + ISO-formatted date (right)
//
// Mirrors the PDF banner pixel-for-pixel in intent: one line, authoritative
// colour from the shared `BRAND.greenDeep` token, no animation. The
// hallkeeper sees the same proof-of-sign-off on paper and on screen.
// ---------------------------------------------------------------------------

function ApprovalStampBanner({
  approval,
  timezone,
}: {
  approval: SheetApproval;
  timezone: string;
}): React.ReactElement {
  // Pin rendering to the venue's own IANA timezone so the displayed
  // date matches the PDF and doesn't shift by a day near midnight UTC
  // depending on the reader's device. `timezone` is passed through
  // from /v2 → `data.venue.timezone` (migration 0015).
  const approvedDate = new Date(approval.approvedAt).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: timezone,
  });
  return (
    <div
      role="status"
      aria-label={`Approved version ${String(approval.version)} by ${approval.approverName} on ${approvedDate}`}
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        padding: "10px 16px",
        marginBottom: 10,
        background: BRAND.greenDeep,
        color: "#fff",
        borderRadius: 8,
        fontWeight: 600,
        fontSize: 13,
        letterSpacing: 0.3,
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span aria-hidden="true" style={{ fontSize: 16, fontWeight: 800 }}>✓</span>
        <span style={{ textTransform: "uppercase", letterSpacing: 1.2, fontWeight: 800 }}>
          Approved
        </span>
        <span style={{ opacity: 0.8 }}>·</span>
        <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
          v{String(approval.version)}
        </span>
      </span>
      <span
        style={{
          display: "flex", alignItems: "center", gap: 10,
          opacity: 0.95, fontWeight: 500,
          minWidth: 0, // allow flex shrink so long names truncate instead of overflow
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 280,
          }}
          title={approval.approverName}
        >
          {approval.approverName}
        </span>
        <span aria-hidden="true" style={{ opacity: 0.6, flexShrink: 0 }}>·</span>
        <span style={{ fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
          {approvedDate}
        </span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OfflinePendingBadge — surfaces queued progress toggles
//
// When the tablet's WiFi drops mid-event-setup, each checkbox toggle
// is enqueued to IDB by the toggle handler. This badge tells the
// hallkeeper "your last 3 edits haven't synced yet" so they don't
// double-tap or worry that the work is lost. Drains to 0 when the
// online-event flush completes — the badge disappears automatically.
//
// `role="status"` + an aria-label so screen readers announce the
// pending count change.
// ---------------------------------------------------------------------------

function OfflinePendingBadge({ count }: { count: number }): React.ReactElement {
  const noun = count === 1 ? "edit" : "edits";
  const label = `${String(count)} offline ${noun} pending sync`;
  return (
    <div
      role="status"
      aria-label={label}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 14px",
        marginBottom: 10,
        background: "#fff4e0",
        border: "1px solid #eec98f",
        borderRadius: 8,
        color: "#8c5a00",
        fontWeight: 500,
        fontSize: 13,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "#d97706",
        }}
      />
      <span>{label}</span>
      <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.75 }}>
        will sync when WiFi returns
      </span>
    </div>
  );
}
