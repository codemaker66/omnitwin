import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  ackProgress,
  enqueueProgress,
  isReplayStatusTerminal,
  listPendingProgress,
  partitionReplay,
  resolveReplayDisposition,
  type ReplayResult,
} from "../lib/progress-sync-queue.js";
import { Link, useParams } from "react-router-dom";
import type {
  HallkeeperSheetV2,
  Phase,
  AccessibilityCallout,
  SheetApproval,
} from "@omnitwin/types";
import {
  BRAND,
  EventInstructionsSchema,
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
import { ActivityStatus } from "../components/shared/Activity.js";
import "./hallkeeper-sheet.css";

const GOLD = "#986246";
const GREEN = "#385542";
const BORDER = "#e4dcd0";
const TEXT_MUT = "#726c61";
const TEXT_SEC = "#575a4e";
const INK = "#2e382e";

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

interface DownloadNotice {
  readonly kind: "success" | "error";
  readonly message: string;
}

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
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadNotice, setDownloadNotice] = useState<DownloadNotice | null>(null);
  // Count of progress toggles queued offline. Surfaces as a small
  // badge on the page so the hallkeeper sees "3 edits pending sync"
  // when WiFi drops mid-event-setup. The number drains to 0 when the
  // online-event flush runs on reconnect.
  const [pendingCount, setPendingCount] = useState(0);
  const diagramRef = useRef<HTMLDivElement>(null);
  const fetchCountRef = useRef(0);
  const activeConfigRef = useRef(configId);
  activeConfigRef.current = configId;
  const checksRef = useRef<CheckMap>({});
  const operationVersions = useRef(new Map<string, number>());
  const [progressUnavailable, setProgressUnavailable] = useState(false);
  const [progressNotice, setProgressNotice] = useState<string | null>(null);

  // --- Fetch sheet data + progress in parallel ---
  const loadData = useCallback(() => {
    if (configId === undefined) return;
    setLoading(true);
    setError(null);
    setData(null);
    setChecks({});
    checksRef.current = {};
    setProgressUnavailable(false);
    setProgressNotice(null);
    setHighlightedRowKey(null);
    setCollapsed(new Set());
    setPendingCount(0);
    fetchCountRef.current += 1;
    const thisFetch = fetchCountRef.current;
    void (async () => {
      try {
        const token = await getAuthToken();
        const headers: Record<string, string> = {};
        if (token !== null) headers["Authorization"] = `Bearer ${token}`;

        const sheetRes = await fetch(`${API_URL}/hallkeeper/${configId}/v2`, { headers });

        // Stale-request guard
        if (thisFetch !== fetchCountRef.current) return;

        if (sheetRes.status === 403) { setError("You don't have permission to view this events sheet."); return; }
        if (sheetRes.status === 404) { setError("Configuration not found."); return; }
        if (!sheetRes.ok) throw new Error(`Failed to load (${String(sheetRes.status)})`);

        const sheetJson = (await sheetRes.json()) as { data: HallkeeperSheetV2 };
        if (thisFetch !== fetchCountRef.current || activeConfigRef.current !== configId) return;
        setData(sheetJson.data);

        try {
          const progressRes = await fetch(`${API_URL}/hallkeeper/${configId}/progress`, { headers });
          if (progressRes.ok) {
            const progressJson = (await progressRes.json()) as { data: { checked: Record<string, string> } };
            if (thisFetch !== fetchCountRef.current || activeConfigRef.current !== configId) return;
            const loaded: Record<string, boolean> = {};
            for (const key of Object.keys(progressJson.data.checked)) {
              loaded[key] = true;
            }
            checksRef.current = loaded;
            setChecks(loaded);
          } else if (thisFetch === fetchCountRef.current) {
            setProgressUnavailable(true);
          }
        } catch {
          if (thisFetch === fetchCountRef.current) setProgressUnavailable(true);
          // Progress is an enhancement over the sheet payload. A failed
          // progress fetch must not mask a valid sheet or its 403/404 status.
        }
      } catch (err: unknown) {
        if (thisFetch !== fetchCountRef.current) return;
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (thisFetch === fetchCountRef.current) setLoading(false);
      }
    })();
  }, [configId]);

  useEffect(() => {
    loadData();
    return () => { fetchCountRef.current += 1; };
  }, [loadData]);

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
    if (configId === undefined || progressUnavailable) return;
    const wasChecked = checksRef.current[rowKey] === true;
    const operationKey = `${configId}|${rowKey}`;
    const operationVersion = (operationVersions.current.get(operationKey) ?? 0) + 1;
    operationVersions.current.set(operationKey, operationVersion);
    const isCurrent = (): boolean => activeConfigRef.current === configId
      && operationVersions.current.get(operationKey) === operationVersion;
    const rollback = (): void => {
      if (!isCurrent()) return;
      checksRef.current = toggleCheck(checksRef.current, rowKey, wasChecked);
      setChecks(checksRef.current);
      setProgressNotice("That check could not be saved. Your previous check has been restored; please try again.");
    };
    const desiredChecked = !wasChecked;

    checksRef.current = toggleCheck(checksRef.current, rowKey, desiredChecked);
    setChecks(checksRef.current);
    setProgressNotice(null);

    void (async () => {
      let result: ReplayResult;
      try {
        const token = await getAuthToken();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token !== null) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(`${API_URL}/hallkeeper/${configId}/progress`, {
          method: "PATCH", headers, body: JSON.stringify({ rowKey, checked: desiredChecked }),
        });
        result = { ok: res.ok, status: res.status };
      } catch {
        // No response at all — treat as offline / retriable.
        result = { ok: false, status: null };
      }

      if (result.ok) return; // Server has the toggle; nothing to queue.

      // The server actively REJECTED the toggle (revoked access, deleted
      // row, bad payload). Replaying it could never succeed, so don't
      // queue a poison op — revert the optimistic flip so the UI stays
      // honest about what the server actually holds.
      if (result.status !== null && isReplayStatusTerminal(result.status)) {
        rollback();
        return;
      }

      // Retriable failure (offline / 5xx / 408 / 429) — KEEP the
      // optimistic UI and queue the intent for replay on reconnect.
      try {
        if (operationVersions.current.get(operationKey) !== operationVersion) return;
        await enqueueProgress(configId, rowKey, desiredChecked);
        const pending = await listPendingProgress();
        if (activeConfigRef.current === configId) setPendingCount(pending.filter((op) => op.configId === configId).length);
      } catch {
        // IDB unreachable — last-resort rollback so the UI doesn't
        // show a check that's neither on the server nor in IDB.
        rollback();
      }
    })();
  }, [configId, progressUnavailable]);

  // Serialize drains for each sheet while allowing a newly opened sheet
  // to sync even when the previous sheet still has a request in flight.
  const flushingConfigsRef = useRef(new Set<string>());

  // --- Flush queued progress on reconnect ---
  //
  // On reconnect (or mount) reconcile the offline queue against the
  // server. We fetch AUTHORITATIVE server state first — never the
  // optimistic local `checks`, which already reflects the queued
  // toggles and would make every op look already-applied, silently
  // discarding the very edits we are trying to save. Ops the server
  // already satisfies are acknowledged without a network call; the rest
  // are re-issued as idempotent set-state (`checked: desiredChecked`), which
  // converges on the user's intent regardless of any change between the read
  // and the write (no toggle TOCTOU). Successful and terminally-rejected
  // replays are dropped; network/5xx failures stay queued for the next flush.
  useEffect(() => {
    if (configId === undefined) return;

    const flush = (): void => {
      if (flushingConfigsRef.current.has(configId)) return;
      flushingConfigsRef.current.add(configId);
      void (async () => {
        try {
          const queued = (await listPendingProgress()).filter((op) => op.configId === configId);
          if (activeConfigRef.current === configId) setPendingCount(queued.length);
          if (queued.length === 0) {
            return;
          }

          const token = await getAuthToken();
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (token !== null) headers["Authorization"] = `Bearer ${token}`;

          // Authoritative server truth. If we can't read it, bail and
          // keep the queue intact rather than guessing and dropping edits.
          let serverChecked: Set<string>;
          try {
            const stateRes = await fetch(`${API_URL}/hallkeeper/${configId}/progress`, { headers });
            if (!stateRes.ok) return;
            const stateJson = (await stateRes.json()) as { data: { checked: Record<string, string> } };
            serverChecked = new Set(Object.keys(stateJson.data.checked));
          } catch {
            return;
          }

          const { replay, converged } = partitionReplay(queued, serverChecked);

          // Server already satisfies these — safe to drop, no network.
          for (const op of converged) {
            await ackProgress(op.configId, op.rowKey);
          }

          // Server still differs — replay each desired checked state.
          for (const op of replay) {
            let result: ReplayResult;
            try {
              const res = await fetch(`${API_URL}/hallkeeper/${op.configId}/progress`, {
                method: "PATCH", headers, body: JSON.stringify({ rowKey: op.rowKey, checked: op.desiredChecked }),
              });
              result = { ok: res.ok, status: res.status };
            } catch {
              result = { ok: false, status: null };
            }
            if (resolveReplayDisposition(result) === "ack") {
              await ackProgress(op.configId, op.rowKey);
            }
          }

          const remaining = await listPendingProgress();
          if (activeConfigRef.current === configId) setPendingCount(remaining.filter((op) => op.configId === configId).length);
        } catch {
          // Don't surface — flush failures are silent ops noise.
        } finally {
          flushingConfigsRef.current.delete(configId);
        }
      })();
    };

    // Initial drain on mount in case the previous session left ops.
    flush();

    window.addEventListener("online", flush);
    return () => {
      window.removeEventListener("online", flush);
    };
  }, [configId]);

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
      diagramRef.current.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "nearest" });
    }
  }, []);

  const handleMarkerClick = useCallback((rowKey: string) => {
    setHighlightedRowKey(rowKey);
    const phase = data?.phases.find((entry) => entry.zones.some((zone) => zone.rows.some((row) => row.key === rowKey)));
    if (phase !== undefined) setCollapsed((prev) => { const next = new Set(prev); next.delete(phase.phase); return next; });
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(rowKey)}"]`);
      el?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" });
    });
  }, [data]);

  const handleDownload = useCallback(() => {
    if (configId === undefined || downloadBusy) return;
    void (async () => {
      setDownloadBusy(true);
      setDownloadNotice(null);
      try {
        const token = await getAuthToken();
        const headers: Record<string, string> = {};
        if (token !== null) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(`${API_URL}/hallkeeper/${configId}/sheet?download=true`, { headers });
        if (!res.ok) {
          setDownloadNotice({
            kind: "error",
            message: "PDF could not be downloaded. Try again or use Print.",
          });
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `hallkeeper-${configId}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
        setDownloadNotice({ kind: "success", message: "PDF download started." });
      } catch {
        setDownloadNotice({
          kind: "error",
          message: "PDF could not be downloaded. Try again or use Print.",
        });
      } finally {
        setDownloadBusy(false);
      }
    })();
  }, [configId, downloadBusy]);

  const handlePrint = useCallback(() => { window.print(); }, []);

  const counts = useMemo(() => computeCounts(data, checks), [data, checks]);

  if (loading) {
    return <main className="hk-page hk-sheet-state" aria-label="Hallkeeper sheet loading">
      <SheetNavigation />
      <div className="hk-state-card">
        <h1>Hallkeeper sheet</h1>
        <ActivityStatus variant="panel">Loading sheet…</ActivityStatus>
      </div>
    </main>;
  }

  if (error !== null || data === null) {
    const isPermissionError = error !== null && error.includes("permission");
    return <main className="hk-page hk-sheet-state" aria-label="Hallkeeper sheet unavailable">
      <SheetNavigation />
      <section className="hk-state-card" aria-labelledby="hallkeeper-error-title">
        <h1 id="hallkeeper-error-title" role="alert">{error ?? "Configuration not found"}</h1>
        <p>{isPermissionError
          ? "Ask the event manager to share this sheet or open it with a hallkeeper-approved account."
          : "Check that the handoff link is current, then try again."}</p>
        <button type="button" className="hk-button hk-button-primary hk-retry-btn" onClick={loadData}>Try Again</button>
      </section>
    </main>;
  }

  const payload = data as HallkeeperSheetV2 & {
    readonly instructions?: HallkeeperSheetV2["instructions"];
    readonly approval?: SheetApproval | null;
  };
  const parsedInstructions = EventInstructionsSchema.nullable().safeParse(payload.instructions ?? null);
  const instructions = parsedInstructions.success ? parsedInstructions.data : null;
  const approval = payload.approval ?? null;
  const doorSummary = instructions === null ? null : buildDoorScheduleSummary(instructions.doorSchedule);

  return (
    <main className="hk-page" aria-label={`Hallkeeper sheet for ${data.config.name} at ${data.venue.name}`}>
      <a className="hk-skip-link" href="#hk-manifest">Skip to setup manifest</a>
      <SheetNavigation />
      <div className="hk-sheet-shell">
        <header className="hk-sheet-heading">
          <div className="hk-heading-copy">
            <div className="hk-eyebrow">{data.venue.name} <span aria-hidden="true">/</span> Hallkeeper sheet</div>
            <h1>{data.config.name}</h1>
            <p className="hk-room-name">{data.space.name} <span>· {formatLayoutStyle(data.config.layoutStyle)}</span></p>
            <p className="hk-room-dimensions">{formatDims(data.space)} · {data.totals.totalItems} items</p>
          </div>
          <div className="hk-guest-count"><strong>{data.config.guestCount}</strong><span>guests</span></div>
          <div className="hk-time-pair">
            <div><span>Indicative setup time</span><strong>{data.timing === null ? "Not provided" : formatLocalTime(data.timing.setupBy, data.venue.timezone)}</strong></div>
            <div><span>Indicative event time</span><strong>{data.timing === null ? "Not provided" : formatLocalTime(data.timing.eventStart, data.venue.timezone)}</strong></div>
            <p>Estimated times. Confirm with the venue · {data.venue.timezone}.</p>
          </div>
        </header>

        <div className="hk-provenance">
          <HallkeeperStatusBanner configId={data.config.id} />
          {approval !== null && <ApprovalStampBanner approval={approval} timezone={data.venue.timezone} />}
          {pendingCount > 0 && <OfflinePendingBadge count={pendingCount} />}
          {progressUnavailable && <div className="hk-notice" role="alert">Shared checks could not be loaded. The layout is available; reload before changing checks. <button className="hk-text-button" onClick={loadData}>Reload checks</button></div>}
          {progressNotice !== null && <div className="hk-notice" role="alert">{progressNotice}</div>}
        </div>

        <nav className="hk-phase-strip" aria-label="Setup categories">
          {data.phases.map((phase) => {
            const meta = PHASE_METADATA[phase.phase];
            const rows = phase.zones.flatMap((zone) => zone.rows);
            const done = rows.filter((row) => checks[row.key] === true).length;
            return <a key={phase.phase} className={`hk-phase-step hk-tone-${phase.phase}`} href={`#hk-phase-${phase.phase}`}
              onClick={() => { setCollapsed((prev) => { const next = new Set(prev); next.delete(phase.phase); return next; }); }}>
              <span className="hk-step-number">{meta.order.toString().padStart(2, "0")}</span>
              <strong>{meta.label}</strong>
              <span>{progressUnavailable ? "Checks unavailable" : `${String(done)}/${String(rows.length)} rows checked`}</span>
            </a>;
          })}
        </nav>

        <div className="hk-workspace">
          <section id="hk-manifest" className="hk-manifest" aria-label="Setup manifest">
            <div className="hk-section-heading"><div><h2>Room setup</h2></div>
              <span className="hk-count-label">{progressUnavailable ? "Checks unavailable" : `${String(counts.checkedRows)} of ${String(counts.totalRows)} rows checked`}</span>
            </div>
            <p className="hk-section-intro">Tap a row to check it · ◎ finds its position.</p>
            {data.phases.length === 0 && <div className="hk-empty"><h3>No items placed yet</h3><p>Save furniture in the planner to create this checklist.</p></div>}
            {data.phases.map((phase) => <PhaseBlock key={phase.phase} phase={phase} checks={checks}
              onToggle={handleToggle} highlightedRowKey={highlightedRowKey} onHighlightRow={handleHighlightRow}
              isCollapsed={collapsed.has(phase.phase)} onToggleCollapse={() => { toggleCollapse(phase.phase); }} disabled={progressUnavailable} />)}
            {counts.allDone && <div className="hk-checklist-complete" role="status"><strong>✓ Every setup row is checked</strong><p>Checklist complete. Layout approval and room release are separate.</p></div>}
          </section>

          <aside className="hk-room-reference" aria-label="Layout and event details">
            <section ref={diagramRef} className="hk-plan-card">
              <div className="hk-section-heading"><div><h2>The layout</h2></div><span className="hk-plan-label">{data.space.name}</span></div>
              <p className="hk-section-intro">Select an item to find its checklist row.</p>
              <InteractiveFloorPlan floorPlan={data.floorPlan} room={data.space} phases={data.phases}
                highlightedRowKey={highlightedRowKey} onMarkerClick={handleMarkerClick} />
              {highlightedRowKey !== null && <button type="button" className="hk-text-button" onClick={() => { setHighlightedRowKey(null); }}>Clear highlight</button>}
            </section>
            <section className="hk-care-card" aria-label="People and practical details">
              <div className="hk-section-heading"><div><h2>People & practicalities</h2></div></div>
              {instructions !== null ? <InstructionsBanner instructions={instructions} timezone={data.venue.timezone} /> : <p className="hk-section-intro">No instructions or event-day contact supplied.</p>}
              {instructions !== null && <AccessibilityCallouts callouts={buildAccessibilityCallouts(instructions.accessibility)} />}
              {instructions !== null && instructions.dietary !== null && hasDietaryContent(instructions.dietary) && <DietarySummaryBlock dietary={instructions.dietary} />}
              {doorSummary !== null && <DoorScheduleBlock summary={doorSummary} timezone={data.venue.timezone} />}
            </section>
          </aside>
        </div>

        <div className="hk-sheet-bottom">
          <div className="hk-actions">
            <button type="button" className="hk-button hk-button-primary" onClick={handleDownload} disabled={downloadBusy}>
              {downloadBusy ? <ActivityStatus>Preparing PDF…</ActivityStatus> : "Download PDF"}
            </button>
            <button type="button" className="hk-button" onClick={handlePrint}>Print</button>
          </div>
        </div>
        {downloadNotice !== null && <div className={`hk-notice hk-notice-${downloadNotice.kind}`} role={downloadNotice.kind === "error" ? "alert" : "status"}>{downloadNotice.message}</div>}
        <footer className="hk-sheet-footer"><span>{data.space.name} · {formatDims(data.space)}</span><span>Generated by VenViewer · {new Date(data.generatedAt).toLocaleString("en-GB", { timeZone: data.venue.timezone })}</span></footer>
      </div>
      {counts.totalRows > 0 && <div className="hk-summary-sticky" aria-label="Setup checklist progress">
        <span><strong>{progressUnavailable ? "—" : counts.checkedRows}</strong> / {counts.totalRows} rows checked</span>
        <div className="hk-progress-track"><div style={{ width: `${String(progressUnavailable ? 0 : counts.checkedRows / counts.totalRows * 100)}%` }} /></div>
        <a href="#hk-manifest">Back to checklist ↑</a>
      </div>}
    </main>
  );
}

function SheetNavigation(): React.ReactElement {
  return <nav className="hk-top-nav" aria-label="Hallkeeper navigation">
    <Link to="/hallkeeper/today" className="hk-brand"><span aria-hidden="true">▥</span><span>VENVIEWER<small>Hallkeeper</small></span></Link>
    <div><Link to="/hallkeeper/today">Today's rooms</Link><Link to="/hallkeeper/walkthrough">Workflow walkthrough <span aria-hidden="true">↗</span></Link></div>
  </nav>;
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
  readonly disabled: boolean;
}

function PhaseBlock({ phase, checks, onToggle, highlightedRowKey, onHighlightRow, isCollapsed, onToggleCollapse, disabled }: PhaseBlockProps): React.ReactElement {
  const meta = PHASE_METADATA[phase.phase];
  const rows = phase.zones.flatMap((zone) => zone.rows);
  const doneCount = rows.filter((row) => checks[row.key] === true).length;
  const qtyTotal = rows.reduce((total, row) => total + row.qty, 0);
  return <section id={`hk-phase-${phase.phase}`} className={`hk-phase hk-tone-${phase.phase}`}>
    <button type="button" className="hk-phase-heading" onClick={onToggleCollapse} aria-expanded={!isCollapsed} aria-controls={`hk-phase-content-${phase.phase}`}>
      <span className="hk-phase-icon" aria-hidden="true">{meta.icon}</span>
      <span className="hk-phase-title">Phase {meta.order} — {meta.label}<small>{qtyTotal} items · {rows.length} checklist rows</small></span>
      <span className="hk-phase-count">{disabled ? "—" : `${String(doneCount)}/${String(rows.length)}`}<span aria-hidden="true">{isCollapsed ? " +" : " −"}</span></span>
    </button>
    <div id={`hk-phase-content-${phase.phase}`} className={`hk-phase-content${isCollapsed ? " hk-collapsed" : ""}`}>
      {phase.zones.map(({ zone, rows: zoneRows }) => <div key={zone} className="hk-zone">
        <h3 className="hk-zone-name">{zone}</h3>
        {zoneRows.map((row) => {
          const done = checks[row.key] === true;
          const highlighted = highlightedRowKey === row.key;
          const runtimeRow: { readonly positions?: readonly unknown[]; readonly notes?: unknown } = row;
          const positions = runtimeRow.positions ?? [];
          const notes = typeof runtimeRow.notes === "string" ? runtimeRow.notes : "";
          return <div key={row.key} className={`hk-row-wrap${highlighted ? " highlighted" : ""}`}>
            <div data-row-key={row.key} className={`hk-row${done ? " checked" : ""}${highlighted ? " highlighted" : ""}`}
              onClick={() => { if (!disabled) onToggle(row.key); }}
              onKeyDown={(event) => { if (!disabled && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onToggle(row.key); } }}
              role="checkbox" aria-checked={done} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}>
              <span className="hk-checkbox" aria-hidden="true">{done ? "✓" : ""}</span>
              <span className="hk-row-copy"><span className="hk-row-name">{row.name}{row.afterDepth > 0 && <span className="hk-after">after</span>}</span>
                {notes.length > 0 && <span className="hk-row-note">{notes}</span>}
              </span>
              <strong className="hk-row-qty">×{row.qty}</strong>
            </div>
            {positions.length > 0 && <button type="button" className={`hk-locate${highlighted ? " active" : ""}`}
              onClick={() => { onHighlightRow(row.key); }} aria-label={highlighted ? "Hide on floor plan" : "Locate on floor plan"}
              title={highlighted ? "Hide on floor plan" : `Locate ×${String(positions.length)} on floor plan`}>◎</button>}
          </div>;
        })}
      </div>)}
    </div>
  </section>;
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

function formatLocalTime(iso: string, timezone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: timezone });
}

function formatLayoutStyle(style: string): string {
  return style.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

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
            <div key={`${c.label}-${String(i)}`} style={{ fontSize: 12, color: INK, padding: "3px 0" }}>
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
              <strong style={{ color: INK }}>{c.label}:</strong> {c.detail}
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
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 12, color: INK }}>
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
          fontSize: 12, color: INK, marginTop: 6,
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
  { summary, timezone }: { summary: DoorScheduleSummary; timezone: string },
): React.ReactElement {
  const fmtTime = (iso: string): string => {
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: timezone });
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
            <div style={{ fontSize: 12, fontWeight: 600, color: INK, marginBottom: 4 }}>
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
                    <span style={{ color: INK, fontVariantNumeric: "tabular-nums" }}>
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
        flexWrap: "wrap",
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
