import { useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PHASE_METADATA, type HallkeeperSheetV2, type OpsTask } from "@omnitwin/types";
import { ArrowLeft, ArrowRight, Check, ClipboardList, MapPin, Printer, Users, X } from "lucide-react";
import { useFocusTrap } from "../../lib/use-focus-trap.js";
import { getHallkeeperRoomPlan, HALLKEEPER_PLAN_VENUE_SLUG } from "../../data/hallkeeper-room-plans.js";
import { RoomPlanReference } from "./RoomPlanReference.js";
import { roomPosterUrl } from "../../lib/room-posters.js";
import { ActivityStatus } from "../shared/Activity.js";
import { InteractiveFloorPlan } from "./InteractiveFloorPlan.js";
import { HallkeeperStatusBanner } from "./HallkeeperStatusBanner.js";
import { useHallkeeperContext, type HallkeeperVerifiedContext, type HallkeeperContextResult } from "./useHallkeeperContext.js";
import "./hallkeeper-workspace.css";

const STAGES = [
  { id: "prepare", name: "Prepare", caption: "People & access" },
  { id: "setup", name: "Setup", caption: "Put the room together" },
  { id: "checks", name: "Checks", caption: "Before guests arrive" },
  { id: "hosting", name: "Hosting", caption: "The running order" },
  { id: "reset", name: "Reset", caption: "Clear & turn around" },
  { id: "handback", name: "Handback", caption: "Leave it in good hands" },
] as const;
type Stage = typeof STAGES[number]["id"];

export interface HallkeeperWorkspaceProps {
  readonly data: HallkeeperSheetV2;
  readonly checks: Readonly<Record<string, boolean>>;
  readonly onToggle: (key: string) => void;
  readonly highlightedRowKey: string | null;
  readonly onHighlight: (key: string | null) => void;
  readonly disabled: boolean;
  readonly notices: ReactNode;
  readonly details: ReactNode;
  readonly downloadBusy: boolean;
  readonly onDownload: () => void;
  readonly onPrint: () => void;
}

/** View selection is navigation only; operational states always come from their owning API. */
export function HallkeeperWorkspace({ data, checks, onToggle, highlightedRowKey, onHighlight, disabled, notices, details, downloadBusy, onDownload, onPrint }: HallkeeperWorkspaceProps): React.ReactElement {
  const [params] = useSearchParams();
  const result = useHallkeeperContext(data.config.id, params.get("eventId"));
  const context = result.context;
  const [stage, setStage] = useState<Stage>("setup");
  const [category, setCategory] = useState(data.phases[0]?.phase ?? "furniture");
  const [showDetails, setShowDetails] = useState(false);
  const briefRef = useFocusTrap<HTMLElement>(showDetails);
  const [reference, setReference] = useState(false);
  const [remaining, setRemaining] = useState(false);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const phase = data.phases.find((entry) => entry.phase === category);
  const allRows = data.phases.flatMap((entry) => entry.zones.flatMap((zone) => zone.rows));
  const done = allRows.filter((row) => checks[row.key] === true).length;
  const rows = (phase?.zones.flatMap((zone) => zone.rows.map((row) => ({ ...row, zone: zone.zone }))) ?? [])
    .filter((row) => (!remaining || checks[row.key] !== true) && `${row.name} ${row.zone} ${row.notes}`.toLowerCase().includes(search.toLowerCase()));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / 5) - 1));
  const visibleRows = rows.slice(currentPage * 5, (currentPage + 1) * 5);
  const board = context?.board;
  const issues = board?.issues.filter((issue) => issue.status === "open" || issue.status === "in_progress") ?? [];
  const roomPhases = context?.graph?.phases.filter((entry) => entry.spaceId === context.room.id) ?? [];
  const slug = context?.room.slug;
  const roomReference = context?.venue.slug === HALLKEEPER_PLAN_VENUE_SLUG ? getHallkeeperRoomPlan(slug) : null;
  const plannedAt = context?.graph === null || context?.graph === undefined ? data.timing?.eventStart ?? null : context.graph.event.startsAt;
  const plannedDate = plannedAt === null ? "Date not supplied" : new Date(plannedAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: data.venue.timezone });
  const time = (value: string | null): string => value === null ? "Not provided" : new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: data.venue.timezone });
  const locate = (key: string): void => {
    const selected = data.phases.find((entry) => entry.zones.some((zone) => zone.rows.some((row) => row.key === key)));
    if (selected === undefined) return;
    const index = selected.zones.flatMap((zone) => zone.rows).findIndex((row) => row.key === key);
    setStage("setup"); setCategory(selected.phase); setRemaining(false); setSearch(""); setPage(Math.floor(index / 5)); setReference(false); onHighlight(key);
  };

  return <div className="hkf-app">
    <header className="hkf-topbar">
      <Link className="hkf-brand" to="/hallkeeper/today"><span aria-hidden="true">▥</span><span>{data.venue.name}<small>HALLKEEPER</small></span></Link>
      <nav aria-label="Hallkeeper navigation"><Link to="/hallkeeper/today">Today’s rooms</Link><Link to="/hallkeeper/rooms">Room plans</Link></nav>
      <div className="hkf-tools"><button type="button" onClick={onPrint}><Printer size={16} /> Print</button><button type="button" onClick={onDownload} disabled={downloadBusy}>{downloadBusy ? <ActivityStatus>Preparing PDF…</ActivityStatus> : "Download PDF"}</button></div>
    </header>
    <div className="hkf-shell">
      <aside className="hkf-room-rail" aria-label="Rooms linked to this event">
        <span className="hkf-overline">Your room</span>
        <div className="hkf-room-current">{slug !== undefined && <img src={roomPosterUrl(slug)} alt="" />}<strong>{data.space.name}</strong><span>Selected layout</span></div>
        {(context?.layouts ?? []).filter((layout) => layout.configurationId !== data.config.id).map((layout) => <Link className="hkf-room-link" key={layout.configurationId} to={`/hallkeeper/${layout.configurationId}?eventId=${encodeURIComponent(context?.graph?.event.id ?? "")}`}><img src={roomPosterUrl(layout.spaceSlug)} alt="" /><span>{layout.spaceName}<small>{layout.name}</small></span></Link>)}
        <Link className="hkf-library-link" to="/hallkeeper/rooms"><MapPin size={16} /> Room references <ArrowRight size={14} /></Link>
        <div className="hkf-rail-bottom"><span className="hkf-overline">Layout record</span><p>{data.space.widthM} × {data.space.lengthM} m</p><p>{data.totals.totalItems} manifest items</p><span className="hkf-muted">{data.config.layoutStyle.replace(/[-_]/g, " ")}</span></div>
      </aside>
      <div className="hkf-main">
        <header className="hkf-heading"><div><span className="hkf-overline">Hallkeeper sheet</span><h1>{data.space.name}</h1><p className="hkf-event-name" title={data.config.name}>{data.config.name}</p><div className="hkf-facts"><span><Users size={15} /> {data.config.guestCount} guests</span><span>{data.totals.totalItems} manifest items</span>{data.approval !== null && <span>Sheet v{data.approval.version}</span>}<button type="button" onClick={() => { setShowDetails(true); }}>Brief & contacts ↗</button></div></div>
          <div className="hkf-time-card"><span>{context?.graph !== null && context?.graph !== undefined ? "Event planned at" : "Indicative event time"}</span><strong>{context?.graph !== null && context?.graph !== undefined ? time(context.graph.event.startsAt) : data.timing === null ? "Not provided" : time(data.timing.eventStart)}</strong><small>{plannedDate}<br />{data.venue.timezone}</small></div>
        </header>
        <div className="hkf-provenance"><HallkeeperStatusBanner key={data.config.id} configId={data.config.id} compact />{data.approval !== null && <span className="hkf-approved-by">Sheet v{data.approval.version} · approved by {data.approval.approverName}</span>}{notices}</div>
        <nav className="hkf-stages" aria-label="Event workflow views">{STAGES.map((item, index) => <button key={item.id} type="button" className={`hkf-stage hkf-${item.id}`} aria-pressed={stage === item.id} onClick={() => { setStage(item.id); if (item.id === "checks" && data.phases.some((entry) => entry.phase === "final")) { setCategory("final"); setPage(0); setSearch(""); } }}><span className="hkf-stage-index">{String(index + 1).padStart(2, "0")}</span><strong>{item.name}</strong><small>{item.caption}</small></button>)}</nav>
        <div className="hkf-work-area">
          <section className="hkf-plan" aria-label="Room plan">
            <div className="hkf-panel-heading"><div><span className="hkf-overline">{reference ? "Room reference" : "Saved event layout"}</span><h2>{data.space.name}</h2></div><div className="hkf-segment" aria-label="Plan view"><button type="button" aria-pressed={!reference} onClick={() => { setReference(false); }}>Event layout</button><button type="button" aria-pressed={reference} onClick={() => { setReference(true); }}>Room plan</button></div></div>
            {reference ? (roomReference !== null ? <RoomPlanReference room={roomReference} compact /> : <div className="hkf-reference-preview"><MapPin size={30} /><h3>{result.status === "loading" ? "Room reference" : result.status === "error" ? "Room reference unavailable" : "No room reference linked"}</h3><p>{result.status === "loading" ? "Verifying the selected room." : "No supplied architectural drawing is linked to this verified room."}</p><Link className="hkf-primary" to="/hallkeeper/rooms">Open room library <ArrowRight size={16} /></Link></div>) : <div className="hkf-drawing"><InteractiveFloorPlan floorPlan={data.floorPlan} room={data.space} phases={data.phases} highlightedRowKey={highlightedRowKey} onMarkerClick={locate} /></div>}
            <div className="hkf-plan-footer"><span>{highlightedRowKey === null ? "Select furniture to find its setup check" : "Selected furniture is highlighted"}</span>{highlightedRowKey !== null && <button type="button" onClick={() => { onHighlight(null); }}>Clear selection</button>}<button type="button" onClick={() => { setShowDetails(true); }}><ClipboardList size={15} /> Brief</button></div>
          </section>
          <section className={`hkf-work-panel hkf-work-${stage}`} aria-label={`${STAGES.find((item) => item.id === stage)?.name ?? "Setup"} workspace`}>
            {stage === "setup" || (stage === "checks" && phase?.phase === "final") ? <>
              <div className="hkf-panel-heading"><div><span className="hkf-overline">{stage === "checks" ? "Final room checks" : "Room setup"}</span><h2>{stage === "checks" ? "Ready for the room review" : "One thing at a time"}</h2></div><span className="hkf-progress-number">{disabled ? "—" : done}<small> / {allRows.length}</small></span></div>
              <div className="hkf-progress" aria-label="Setup checklist progress"><div style={{ width: `${String(disabled || allRows.length === 0 ? 0 : done / allRows.length * 100)}%` }} /></div>
              <div className="hkf-category"><label>Setup category<select value={category} onChange={(event) => { const selected = data.phases.find((entry) => entry.phase === event.target.value); if (selected !== undefined) setCategory(selected.phase); setStage("setup"); setPage(0); }}>{data.phases.map((entry) => <option key={entry.phase} value={entry.phase}>{PHASE_METADATA[entry.phase].label}</option>)}</select></label><label className="hkf-remaining"><input type="checkbox" checked={remaining} onChange={(event) => { setRemaining(event.target.checked); setPage(0); }} /> Remaining</label></div>
              <input className="hkf-search" type="search" aria-label="Find a setup item" placeholder="Find an item or zone…" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} />
              <div className="hkf-task-list">{visibleRows.map((row) => <div key={row.key} className={`hkf-task ${highlightedRowKey === row.key ? "hkf-highlighted" : ""}`}>
                <button type="button" role="checkbox" aria-checked={checks[row.key] === true} aria-disabled={disabled} disabled={disabled} data-row-key={row.key} className="hkf-check-task" onClick={() => { onToggle(row.key); }}><span className="hkf-checkbox">{checks[row.key] === true && <Check size={15} />}</span><span><strong>{row.name}</strong><small>{row.zone}{row.afterDepth > 0 ? " · after preceding items" : ""}</small>{row.notes.length > 0 && <small>{row.notes}</small>}</span><b>×{row.qty}</b></button>
                {(row.positions.length) > 0 && <button className="hkf-locate" type="button" aria-label={`Locate ${row.name} on floor plan`} onClick={() => { locate(row.key); }}><MapPin size={16} /></button>}
              </div>)}{visibleRows.length === 0 && <div className="hkf-empty"><Check size={24} /><h3>{rows.length === 0 && remaining ? "Nothing remaining in this view" : "No setup items in this view"}</h3><p>{allRows.length === 0 ? "The planner has not placed any items in this layout." : "Choose another category or adjust the filter."}</p></div>}</div>
              <div className="hkf-pagination"><span>{rows.length === 0 ? "0 items" : `${String(currentPage * 5 + 1)}–${String(Math.min((currentPage + 1) * 5, rows.length))} of ${String(rows.length)} checks`}</span><button type="button" aria-label="Previous setup items" disabled={currentPage === 0} onClick={() => { setPage(currentPage - 1); }}><ArrowLeft size={16} /></button><button type="button" aria-label="Next setup items" disabled={(currentPage + 1) * 5 >= rows.length} onClick={() => { setPage(currentPage + 1); }}><ArrowRight size={16} /></button></div>
              <p className="hkf-footnote">{disabled ? "Shared checks unavailable. Reload checks before making changes." : done === allRows.length && allRows.length > 0 ? "Every setup row is checked. Room release remains a separate decision." : "Checks record setup work. Approval and room release remain separate."}</p>
            </> : <><div className="hkf-panel-heading"><div><span className="hkf-overline">{STAGES.find((item) => item.id === stage)?.caption}</span><h2>{STAGES.find((item) => item.id === stage)?.name}</h2></div></div><div className="hkf-stage-content">
              {stage === "prepare" && <>{details}<TaskList context={context} availability={result.status} kinds={["supplier"]} /></>}
              {stage === "checks" && <><p className="hkf-summary"><strong>{disabled ? "—" : done} / {allRows.length}</strong> setup rows checked</p><p>Review the room’s checks before inviting guests in.</p><TaskList context={context} availability={result.status} kinds={["review_gate"]} /></>}
              {stage === "hosting" && <>{result.status === "loading" || result.status === "error" ? <p>Running order {result.status === "loading" ? "is being loaded." : "is unavailable. Retry event context below."}</p> : <>{roomPhases.length === 0 ? <p>No room running order is linked to this sheet.</p> : <><p className="hkf-overline">Planned running order · {data.venue.timezone}</p>{roomPhases.map((entry) => <div className="hkf-schedule-row" key={entry.id}><time>{entry.startsAt === null ? "Time unset" : time(entry.startsAt)}</time><strong>{entry.name}</strong><small>{entry.durationMinutes} min</small></div>)}</>}<p className="hkf-footnote">Planned times do not confirm that an activity has started.</p></>}</>}
              {stage === "reset" && <TaskList context={context} availability={result.status} kinds={["breakdown", "room_flip"]} />}
              {stage === "handback" && <><p className="hkf-summary"><strong>{disabled ? "�" : allRows.length - done}</strong> setup rows unchecked</p>{result.status === "loading" || result.status === "error" ? <p>Handoff context {result.status === "loading" ? "is being loaded." : "is unavailable. Retry event context below."}</p> : board?.handoffPack === null || board?.handoffPack === undefined ? <p>No verified handoff pack is linked to this sheet.</p> : <><p>Handoff v{board.handoffPack.pack.version} · {board.handoffPack.opsTasks.filter((task) => task.status !== "done" && task.status !== "waived").length} operations tasks still open</p><p>{board.changesSinceLastHandoff.summary}</p><Link className="hkf-primary" to={`/ops/handoff/${board.handoffPack.pack.id}`}>Review handoff <ArrowRight size={16} /></Link></>}</>}
              {context?.graph !== null && context?.graph !== undefined && <Link className="hkf-primary" to={`/ops/events/${context.graph.event.id}`}>Open event operations <ArrowRight size={16} /></Link>}
            </div></>}
          </section>
        </div>
        <div className="hkf-attention-strip"><div><span className="hkf-overline">Keep in view</span><strong>{issues.length > 0 ? `${String(issues.length)} event-wide issue${issues.length === 1 ? "" : "s"} open` : board === null || board === undefined ? "Event context" : "No open event-wide issues"}</strong></div><div className="hkf-attention-copy">{result.status === "loading" ? <ActivityStatus>Loading room context…</ActivityStatus> : result.error !== null || context?.opsError !== null && context?.opsError !== undefined ? <><span>{result.error ?? context?.opsError}</span><button type="button" onClick={result.retry}>Retry context</button></> : issues.length > 0 ? <><span>{issues[0]?.title}</span>{context?.graph !== null && context?.graph !== undefined && <Link to={`/ops/events/${context.graph.event.id}`}>Review issues ↗</Link>}</> : <span>{context?.graph === null || context === null ? "Open this sheet from its event to include the running order and operations updates." : "Operations updates are available in the event board."}</span>}</div></div>
        <footer className="hkf-footer"><span>{disabled ? "Checks unavailable" : `${String(done)} of ${String(allRows.length)} setup rows checked`}</span><span>Full checklist included in Print & PDF</span><Link to="/hallkeeper/walkthrough">Workflow walkthrough ↗</Link></footer>
      </div>
    </div>
    {showDetails && <div className="hkf-detail-backdrop" onClick={() => { setShowDetails(false); }}><section ref={briefRef} className="hkf-detail-panel" role="dialog" aria-modal="true" aria-labelledby="hkf-brief-title" onClick={(event) => { event.stopPropagation(); }} onKeyDown={(event) => { if (event.key === "Escape") setShowDetails(false); }}><div className="hkf-panel-heading"><div><span className="hkf-overline">{data.space.name}</span><h2 id="hkf-brief-title">Brief & contacts</h2></div><button type="button" aria-label="Close brief" onClick={() => { setShowDetails(false); }}><X size={20} /></button></div><div className="hkf-detail-body">{details}{data.approval !== null && <p>Sheet v{data.approval.version} approved by {data.approval.approverName} on {new Date(data.approval.approvedAt).toLocaleString("en-GB", { timeZone: data.venue.timezone })}.</p>}<p className="hkf-footnote">Generated {new Date(data.generatedAt).toLocaleString("en-GB", { timeZone: data.venue.timezone })} · {data.venue.timezone}</p></div></section></div>}
  </div>;
}

function TaskList({ context, availability, kinds }: { readonly context: HallkeeperVerifiedContext | null; readonly availability: HallkeeperContextResult["status"]; readonly kinds: readonly OpsTask["kind"][] }): React.ReactElement {
  if (availability === "loading") return <p>Operations context is being loaded.</p>;
  if (availability === "error" || context?.opsError !== null && context?.opsError !== undefined) return <p>Operations context is unavailable. Retry below to check the supplied tasks.</p>;
  const tasks = context?.board?.handoffPack?.opsTasks.filter((task) => kinds.includes(task.kind)) ?? [];
  return tasks.length === 0 ? <p className="hkf-empty-copy">No {kinds.includes("review_gate") ? "review checks" : kinds.includes("supplier") ? "supplier tasks" : "reset tasks"} supplied in a verified handoff pack.</p> : <div className="hkf-ops-tasks">{tasks.map((task) => <article key={task.id}><span className={`hkf-task-status hkf-status-${task.status}`}>{task.status.replace(/_/g, " ")}</span><h3>{task.title}</h3>{task.dueLabel !== null && <small>{task.dueLabel}</small>}<p>{task.detail}</p></article>)}</div>;
}
