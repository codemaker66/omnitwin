import {
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactElement,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Bell, Check, Clock, DoorOpen, Link2, Radio, RotateCcw, UserCheck, Users, WifiOff, Wrench,
} from "lucide-react";
import { occasionLabel, type HallkeeperSheetSummary } from "@omnitwin/types";
import { getSheetSummary } from "../../api/hallkeeper-summary.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { boardRange, formatWallDay, formatWallTime, msToWallInput, shiftRange, wallInputToMs, type BoardRange } from "../diary/lib/board-time.js";
import { ActivityStatus } from "../../components/shared/Activity.js";
import { CALENDAR_REUSE_MS, useCalendar } from "../diary/hooks/useCalendar.js";
import { useDiaryLive } from "../diary/hooks/useDiaryLive.js";
import { DashboardLayout } from "../../components/dashboard/DashboardLayout.js";
import { VenueNotConnected } from "../../components/dashboard/VenueNotConnected.js";
import { awaitsVenue } from "../../lib/role-capabilities.js";
import { clockIsCorrected, correctedNowMs, subscribeClock } from "../../lib/clock-offset.js";
import { resolveEventLinkedLayouts, type LinkedLayoutChoice } from "../../lib/event-linked-layouts.js";
import { roomPhoto } from "../../components/dashboard/enquiries/enquiry-room-photo.js";
import { useSlotRequests } from "../../components/requests/requests-context.js";
import {
  DAY_BOARD_LEGEND,
  DAY_BOARD_RING_LEGEND,
  deriveDayBoard,
  formatMinutes,
  type DayBoardIcon,
  type DayBoardLane,
  type DayBoardSlot,
  type NextAction,
  type SlotAttention,
  type UnownedRequest,
} from "./lib/day-board-state.js";
import {
  boardWindow, gapGeometry, nowPlaque, rulerTicks, slabGeometry, type BoardWindow, type RulerTick, type Span,
} from "./lib/day-board-layout.js";
import { boardFreshness, useBoardClock, useBreathPhase, useConnectionState } from "./lib/use-board-clock.js";
import { describeSlotSheet, sheetProgressLine, type SlotSheetState } from "./lib/day-board-sheet.js";
import { useVenueClock } from "./lib/use-venue-timezone.js";
import { deviceZone, zoneNote } from "../../components/hallkeeper/sheet-facts.js";
import {
  DayBoardSlotRequestsContext,
  type SlotRequestsComponent,
  type SlotRequestsProps,
} from "./lib/slot-requests-contract.js";
import "../../styles/hallkeeper-register.css";
import "./day-board.css";

// ---------------------------------------------------------------------------
// The Day Board (goal 19 S3; D1, D3, D7, D9, D10, D11) — the hallkeeper's
// live view of today. A pure projection of GET /calendar and the venue's
// open requests through deriveDayBoard, on one corrected clock; live updates
// arrive over /ws/diary (any committed change refetches: the snapshot
// doctrine, never trusted deltas).
//
// The composition, from Blake's reference (D7): one ruler across the day
// with a NOW plaque; a lane per room with its photograph; slabs placed by
// time with setup, live and clear-down segments; dimensioned gaps between
// them; the UNOWNED rail at the edge; this hallkeeper's next action in one
// line at the top, always. A tap on a slab opens the slot: its sheet, its
// event, its phases and its requests. The phone shows one lane at a time,
// swiped between rooms, the day running down the screen, the next action
// fixed above. The office and the phone wear the ivory register; the wall
// (`?register=wall`) wears the dark one and shows room, title, state, time
// and next action only (D11): nothing opens there.
//
// Motion is the attention system (D3): a breath on the dot as the room's
// moment approaches, the live breath as the room's heartbeat and the proof
// the display is alive, a copper halo that breathes round a request's ring
// until somebody owns it. All of it is CSS on opacity and transform. Each
// breath samples its own epoch phase the moment it begins (useBreathPhase),
// so every screen breathes on the venue's minute grid, and every breath
// stops the instant the connection drops. State ticks are boundary-exact
// (useBoardClock); nothing polls.
// ---------------------------------------------------------------------------

/** Focus a keyboard gave, not the focus a tap or click gives on the way to
 *  pressing; a browser that cannot tell counts it. */
function keyboardFocus(target: EventTarget): boolean {
  if (!(target instanceof Element)) return false;
  try {
    return target.matches(":focus-visible");
  } catch {
    return true;
  }
}

/** No days read ahead: nobody has shown they may step. */
const NO_DAYS: readonly BoardRange[] = [];
/** The board before its day has landed: no lanes, one stable value. */
const NO_LANES: readonly DayBoardLane[] = [];
const DAY_MS = 86_400_000;
/** The phone: one lane at a time (D7). */
const PHONE_QUERY = "(max-width: 700px)";

/** A calendar day on either side of `date` (YYYY-MM-DD), as the same form. */
function stepDay(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Keys that move the day are the board's own only when no field holds focus. */
function typingInto(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName));
}

/** A fraction of the window as a CSS percentage, to two decimals. */
function percent(fraction: number): string {
  return `${String(Math.round(fraction * 10_000) / 100)}%`;
}

/** Where a span sits: along the lane on the sheet, down the lane on the phone. */
function placement(span: Span, vertical: boolean): CSSProperties {
  return vertical
    ? { top: percent(span.left), height: percent(span.width) }
    : { left: percent(span.left), width: percent(span.width) };
}

/** Whether the screen is a phone, by the one query the stylesheet uses. */
function usePhoneLayout(): boolean {
  const subscribe = useCallback((listener: () => void): (() => void) => {
    if (typeof window.matchMedia !== "function") return () => undefined;
    const media = window.matchMedia(PHONE_QUERY);
    media.addEventListener("change", listener);
    return () => { media.removeEventListener("change", listener); };
  }, []);
  const read = useCallback((): boolean => typeof window.matchMedia === "function" && window.matchMedia(PHONE_QUERY).matches, []);
  return useSyncExternalStore(subscribe, read, () => false);
}

// The <SlotRequests> mount point: its contract lives in
// ./lib/slot-requests-contract.ts and is re-exported here, where Lane 9's
// documented import points.
export { DayBoardSlotRequestsContext };
export type { SlotRequestsComponent, SlotRequestsProps };

const ICONS: Readonly<Record<DayBoardIcon, typeof Clock>> = {
  clock: Clock,
  wrench: Wrench,
  users: Users,
  "door-open": DoorOpen,
  radio: Radio,
  "rotate-ccw": RotateCcw,
  check: Check,
  "alert-triangle": AlertTriangle,
  bell: Bell,
  "user-check": UserCheck,
  "wifi-off": WifiOff,
};

function StateIcon({ icon, size = 14 }: { readonly icon: DayBoardIcon; readonly size?: number }): ReactElement {
  const Icon = ICONS[icon];
  return <Icon size={size} aria-hidden="true" />;
}

const NEVER_CORRECTED = (): boolean => false;

/** Whether the corrected clock disagrees with the device by a minute or more. */
function useClockCorrected(): boolean {
  return useSyncExternalStore(subscribeClock, clockIsCorrected, NEVER_CORRECTED);
}

interface SlotSheetResult {
  readonly status: "loading" | "ready" | "error";
  readonly state: SlotSheetState | null;
  readonly error: string | null;
}

/**
 * Resolve the slot's setup-sheet door. One resolution per event+room; the
 * `isCurrent` guard is the same superseded-request discipline the planner
 * bootstrap uses, so a board that rolls over midnight (or a room filter
 * change) can never paint a stale room's layouts onto a slot.
 */
function useSlotSheet(eventId: string | null, roomSlug: string, roomName: string): SlotSheetResult {
  const [layouts, setLayouts] = useState<readonly LinkedLayoutChoice[] | null>(null);
  const [unavailable, setUnavailable] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (eventId === null) {
      setLayouts([]);
      setUnavailable(0);
      setError(null);
      return;
    }
    let current = true;
    setLayouts(null);
    setError(null);
    void resolveEventLinkedLayouts({ eventId, spaceSlug: roomSlug, isCurrent: () => current })
      .then((resolved) => {
        if (!current) return;
        setLayouts(resolved.layouts);
        setUnavailable(resolved.unavailableCount);
      })
      .catch(() => {
        if (!current) return;
        setError("The setup sheet link could not be checked.");
      });
    return () => { current = false; };
  }, [eventId, roomSlug]);

  if (error !== null) return { status: "error", state: null, error };
  if (layouts === null) return { status: "loading", state: null, error: null };
  return {
    status: "ready",
    state: describeSlotSheet({ eventId, roomName, layouts, unavailableCount: unavailable }),
    error: null,
  };
}

const SUMMARY_REFRESH_MS = 60_000;

/**
 * A sheet's ready-by time and rows checked, read now and each minute while
 * the slot is open. A failed read keeps the last line it had; before any
 * read lands there is no line at all, rather than a guess.
 */
function useSheetSummary(configId: string, eventId: string | null): HallkeeperSheetSummary | null {
  const key = `${configId}:${eventId ?? ""}`;
  const [summary, setSummary] = useState<{ readonly key: string; readonly value: HallkeeperSheetSummary } | null>(null);
  useEffect(() => {
    let reading: AbortController | null = null;
    const read = (): void => {
      if (typeof document !== "undefined" && document.hidden) return;
      reading?.abort();
      const current = new AbortController();
      reading = current;
      void getSheetSummary(configId, eventId, current.signal)
        .then((value) => { if (!current.signal.aborted) setSummary({ key, value }); })
        .catch(() => {
          // Keep the last line; the next minute reads again.
        });
    };
    read();
    const timer = window.setInterval(read, SUMMARY_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      reading?.abort();
    };
  }, [configId, eventId, key]);
  return summary?.key === key ? summary.value : null;
}

/** Under the sheet's door: "Ready by 16:00 · 12 of 43 checked", with a thin
 *  bar that turns sage when every row is checked. */
function SheetProgress({ configId, eventId, timeZone }: {
  readonly configId: string;
  readonly eventId: string | null;
  readonly timeZone: string;
}): ReactElement | null {
  const summary = useSheetSummary(configId, eventId);
  if (summary === null) return null;
  const complete = summary.total > 0 && summary.checked === summary.total;
  return (
    <p className={`dayboard-slot-progress${complete ? " is-complete" : ""}`}>
      <span className="dayboard-slot-progress-words">
        {complete && <Check size={14} aria-hidden="true" />}
        {sheetProgressLine(summary, timeZone)}
      </span>
      {summary.total > 0 && (
        <span className="dayboard-slot-progress-bar" aria-hidden="true">
          <span style={{ width: `${String(Math.round(summary.checked / summary.total * 100))}%` }} />
        </span>
      )}
    </p>
  );
}

function SlotSheetLink({ eventId, roomSlug, roomName, timeZone }: {
  readonly eventId: string | null;
  readonly roomSlug: string;
  readonly roomName: string;
  readonly timeZone: string;
}): ReactElement {
  const result = useSlotSheet(eventId, roomSlug, roomName);

  if (result.status === "loading") {
    return (
      <div className="dayboard-slot-sheet">
        <ActivityStatus>Finding this room’s setup sheet…</ActivityStatus>
      </div>
    );
  }

  if (result.status === "error" || result.state === null) {
    return (
      <div className="dayboard-slot-sheet">
        <p className="dayboard-slot-sheet-note">{result.error ?? "The setup sheet link could not be checked."}</p>
      </div>
    );
  }

  const state = result.state;
  return (
    <div className="dayboard-slot-sheet">
      {state.kind === "one" && (
        <>
          <Link className="dayboard-open-sheet" to={state.href}>
            {state.label}<span className="dayboard-slot-sheet-layout">{state.layoutName}</span>
          </Link>
          <SheetProgress configId={state.configurationId} eventId={state.eventId} timeZone={timeZone} />
        </>
      )}
      {state.kind === "many" && (
        <>
          <p className="dayboard-slot-sheet-note">{roomName} has more than one linked layout.</p>
          <ul className="dayboard-sheet-choices">
            {state.choices.map((choice) => (
              <li key={choice.configurationId}>
                <Link className="dayboard-open-sheet" to={choice.href}>{choice.name}</Link>
                <SheetProgress configId={choice.configurationId} eventId={state.eventId} timeZone={timeZone} />
              </li>
            ))}
          </ul>
        </>
      )}
      {(state.kind === "no-event" || state.kind === "no-layout") && (
        <>
          <p className="dayboard-slot-sheet-note">{state.message}</p>
          {state.kind === "no-layout"
            ? <Link className="dayboard-open-event" to={`/ops/events/${state.eventId}`}>{state.nextAction}</Link>
            : <Link className="dayboard-open-event" to="/diary">{state.nextAction}</Link>}
        </>
      )}
    </div>
  );
}

/** The ring's words: who has it, or how many wait and for how long. */
function ringWords(slot: DayBoardSlot, nowMs: number): string | null {
  const ring = slot.attention;
  if (ring === null) return null;
  if (ring.level === "owned") return ring.ownerName === null ? "In hand" : `${ring.ownerName} has this`;
  const waiting = ring.waitingSinceMs === null ? "" : ` · waiting ${formatMinutes((nowMs - ring.waitingSinceMs) / 60_000)}`;
  const head = ring.unownedCount === 1 ? "1 request" : `${String(ring.unownedCount)} requests`;
  return `${ring.level === "urgent" ? "URGENT · " : ""}${head} · nobody has this${waiting}`;
}

/** The copper ring on a slot with open requests. Its halo breathes while
 *  nobody owns the request and pulses while it is urgent; the words stay at
 *  full ink. Keyed by the parent to the newest request, so an arrival
 *  remounts it and its one stamp plays once, structurally. */
function Ring({ ring, words, frozen }: {
  readonly ring: SlotAttention;
  readonly words: string;
  readonly frozen: boolean;
}): ReactElement {
  const phase = useBreathPhase(`${ring.level}|${frozen ? "frozen" : "live"}`);
  const Icon = ring.level === "owned" ? UserCheck : ring.level === "urgent" ? AlertTriangle : Bell;
  return (
    <span
      className="dayboard-ring"
      data-level={ring.level}
      data-arrived={ring.arrived ? "true" : "false"}
      style={{ "--lt-epoch-phase-ms": String(phase) } as CSSProperties}
    >
      <Icon size={13} aria-hidden="true" />
      <span className="dayboard-ring-count">{String(ring.count)}</span>
      <span className="dayboard-ring-words">{words}</span>
    </span>
  );
}

/** One slab on a lane: the state's dot, icon and verb, the title, the
 *  segments along its edge, the ring. A button where a tap opens the slot;
 *  on the wall a plain group, because nothing opens there (D11). */
function Slab({ slot, view, nowMs, selected, onOpen, wall, vertical, frozen }: {
  readonly slot: DayBoardSlot;
  readonly view: BoardWindow;
  readonly nowMs: number;
  readonly selected: boolean;
  readonly onOpen: (bookingId: string) => void;
  readonly wall: boolean;
  readonly vertical: boolean;
  readonly frozen: boolean;
}): ReactElement {
  const geometry = slabGeometry(slot, view);
  const slabWidth = geometry.slab.width > 0 ? geometry.slab.width : 1;
  // The breath samples its phase the moment it begins: a new motion, or a
  // freeze lifting, starts a new animation and a new sample (D3 law 1).
  const phase = useBreathPhase(`${slot.motion}|${frozen ? "frozen" : "live"}`);
  const ring = slot.attention;
  const words = ringWords(slot, nowMs);
  const linked = slot.linkedRooms.length > 0 ? `also ${slot.linkedRooms.join(", ")}` : null;
  const label = `${slot.title}, ${slot.timeRange}, ${slot.countdown}${words === null ? "" : `, ${words}`}`;
  const segment = (span: Span): CSSProperties => (
    vertical ? { height: percent(span.width / slabWidth) } : { width: percent(span.width / slabWidth) }
  );
  const shared = {
    className: `dayboard-slab dayboard-tone-${slot.tone}${selected ? " is-selected" : ""}`,
    "data-state": slot.state,
    "data-tone": slot.tone,
    "data-motion": slot.motion,
    "data-attention": ring?.level ?? "none",
    "data-booking": slot.bookingId,
    style: { ...placement(geometry.slab, vertical), "--lt-epoch-phase-ms": String(phase) } as CSSProperties,
  };
  const face = (
    <>
      <span className="dayboard-segments" aria-hidden="true">
        <span className="dayboard-segment dayboard-segment-setup" style={segment(geometry.setup)} />
        <span className="dayboard-segment dayboard-segment-live" style={segment(geometry.live)} />
        <span className="dayboard-segment dayboard-segment-clear" style={segment(geometry.clearDown)} />
      </span>
      <span className="dayboard-slab-face">
        <span className="dayboard-verb">
          <span className="dayboard-dot" aria-hidden="true" />
          <StateIcon icon={slot.icon} size={wall ? 18 : 14} />
          <span className="dayboard-verb-words">{slot.countdown}</span>
        </span>
        <span className="dayboard-slab-title">{slot.title}</span>
        <span className="dayboard-slab-time">
          {slot.timeRange}
          {slot.kind !== "ink" && <span className="dayboard-slab-kind"> · {slot.bookingLabel}</span>}
          {linked !== null && <span className="dayboard-linked"><Link2 size={12} aria-hidden="true" />{linked}</span>}
        </span>
        {ring !== null && words !== null && (
          <Ring key={slot.requestSignal?.newestId ?? "steady"} ring={ring} words={words} frozen={frozen} />
        )}
      </span>
    </>
  );
  if (wall) {
    return <div {...shared} role="group" aria-label={label}>{face}</div>;
  }
  return (
    <button {...shared} type="button" aria-pressed={selected} aria-label={label} onClick={() => { onOpen(slot.bookingId); }}>
      {face}
    </button>
  );
}

/** The dimensioned gap between two slabs: "45 min", or "45 min · needs 1 h 30". */
function Gap({ previous, slot, view, vertical }: {
  readonly previous: DayBoardSlot | undefined;
  readonly slot: DayBoardSlot;
  readonly view: BoardWindow;
  readonly vertical: boolean;
}): ReactElement | null {
  const geometry = gapGeometry(previous, slot, view);
  const gap = slot.gapBefore;
  if (geometry === null || gap === null || geometry.width <= 0) return null;
  const words = gap.short && gap.neededMinutes !== null
    ? `${formatMinutes(gap.minutes)} · needs ${formatMinutes(gap.neededMinutes)}`
    : formatMinutes(gap.minutes);
  return (
    <span className={`dayboard-gap${gap.short ? " is-short" : ""}`} style={placement(geometry, vertical)} aria-hidden="true">
      <span className="dayboard-gap-words">{words}</span>
    </span>
  );
}

/** The hour ticks and the NOW plaque, along the sheet or down a phone's lane. */
function Ruler({ ticks, plaque, nowMs, timeZone, vertical }: {
  readonly ticks: readonly RulerTick[];
  readonly plaque: number | null;
  readonly nowMs: number;
  readonly timeZone: string;
  readonly vertical: boolean;
}): ReactElement {
  const at = (x: number): CSSProperties => (vertical ? { top: percent(x) } : { left: percent(x) });
  return (
    <span className="dayboard-ruler-track">
      {ticks.map((tick) => (
        <span key={tick.ms} className={`dayboard-tick${tick.major ? " is-major" : ""}`} style={at(tick.x)}>
          {tick.major && <span className="dayboard-tick-label">{tick.label}</span>}
        </span>
      ))}
      {plaque !== null && (
        <span className="dayboard-now" style={at(plaque)}>
          <span className="dayboard-now-plaque">NOW<span className="dayboard-now-time">{formatWallTime(nowMs, timeZone)}</span></span>
        </span>
      )}
    </span>
  );
}

function Lane({ lane, view, ticks, nowMs, plaque, timeZone, venueSlug, selectedId, onOpen, wall, vertical, frozen }: {
  readonly lane: DayBoardLane;
  readonly view: BoardWindow;
  readonly ticks: readonly RulerTick[];
  readonly nowMs: number;
  readonly plaque: number | null;
  readonly timeZone: string;
  readonly venueSlug: string | null;
  readonly selectedId: string | null;
  readonly onOpen: (bookingId: string) => void;
  readonly wall: boolean;
  readonly vertical: boolean;
  readonly frozen: boolean;
}): ReactElement {
  const photo = venueSlug === null ? null : roomPhoto(venueSlug, lane.room.slug);
  const count = lane.slots.length === 0
    ? "Nothing scheduled."
    : lane.slots.length === 1 ? "1 booking" : `${String(lane.slots.length)} bookings`;
  return (
    <section className="dayboard-lane" aria-label={lane.room.name} data-room={lane.room.id}>
      <header className="dayboard-lane-head">
        {photo !== null && (
          <img
            className="dayboard-lane-photo"
            src={photo.src}
            srcSet={photo.srcSet}
            sizes="96px"
            alt=""
            loading="lazy"
            decoding="async"
            style={{ objectPosition: photo.objectPosition }}
          />
        )}
        <div className="dayboard-lane-words">
          <h2 className="dayboard-lane-title">{lane.room.name}</h2>
          <p className="dayboard-lane-count">{count}</p>
        </div>
      </header>
      <div className="dayboard-lane-body">
        {vertical && (
          <div className="dayboard-ruler dayboard-ruler-v" aria-hidden="true">
            <Ruler ticks={ticks} plaque={plaque} nowMs={nowMs} timeZone={timeZone} vertical />
          </div>
        )}
        <div className="dayboard-track">
          {plaque !== null && <span className="dayboard-now-line" aria-hidden="true" style={vertical ? { top: percent(plaque) } : { left: percent(plaque) }} />}
          {lane.slots.map((slot, index) => (
            <Fragment key={slot.bookingId}>
              <Gap previous={lane.slots[index - 1]} slot={slot} view={view} vertical={vertical} />
              <Slab
                slot={slot}
                view={view}
                nowMs={nowMs}
                selected={slot.bookingId === selectedId}
                onOpen={onOpen}
                wall={wall}
                vertical={vertical}
                frozen={frozen}
              />
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}

/** The UNOWNED rail: every open request nobody has, urgent first, oldest
 *  first within that. Today's, whichever day is on screen. */
function Rail({ unowned, today, onOpen }: {
  readonly unowned: readonly UnownedRequest[];
  readonly today: boolean;
  readonly onOpen: (bookingId: string | null) => void;
}): ReactElement {
  return (
    <aside className="dayboard-rail" aria-label="Unowned requests" data-count={unowned.length}>
      <h2 className="dayboard-rail-title">Unowned</h2>
      {!today && <p className="dayboard-rail-note">Today’s requests.</p>}
      {unowned.length === 0
        ? <p className="dayboard-rail-empty">Nobody is waiting.</p>
        : (
          <ul className="dayboard-rail-list">
            {unowned.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="dayboard-rail-item"
                  data-urgency={item.urgency}
                  disabled={item.bookingId === null}
                  onClick={() => { onOpen(item.bookingId); }}
                >
                  <Bell size={13} aria-hidden="true" />
                  <span>{item.line}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
    </aside>
  );
}

/** This hallkeeper's next action, one line at the top, always (D7). The
 *  visible line is not a live region, because its minutes tick; a hidden
 *  region says each NEW action once, assertively only when it is urgent. */
function NextActionLine({ action, urgent, onOpen }: {
  readonly action: NextAction;
  readonly urgent: boolean;
  readonly onOpen: (bookingId: string | null) => void;
}): ReactElement {
  const identity = `${action.kind}:${action.requestId ?? action.bookingId ?? ""}`;
  const lineRef = useRef(action.line);
  lineRef.current = action.line;
  const [spoken, setSpoken] = useState("");
  useEffect(() => { setSpoken(lineRef.current); }, [identity]);
  return (
    <>
      <p className={`dayboard-next dayboard-next-${action.kind}`} data-urgent={urgent ? "true" : "false"}>
        {action.kind === "request" ? <Bell size={16} aria-hidden="true" /> : <Clock size={16} aria-hidden="true" />}
        {action.bookingId === null
          ? <span className="dayboard-next-line">{action.line}</span>
          : <button type="button" className="dayboard-next-line" onClick={() => { onOpen(action.bookingId); }}>{action.line}</button>}
      </p>
      <span className="dayboard-announcer" role="status" aria-live={urgent ? "assertive" : "polite"}>{spoken}</span>
    </>
  );
}

/** The open slot: its sheet, its event, its phases and its requests. */
function SlotDetail({ slot, room, timeZone, slotRequests: SlotRequests, onClose }: {
  readonly slot: DayBoardSlot;
  readonly room: { readonly id: string; readonly name: string; readonly slug: string };
  readonly timeZone: string;
  readonly slotRequests: SlotRequestsComponent | null;
  readonly onClose: () => void;
}): ReactElement {
  const occasion = occasionLabel(slot.eventType);
  return (
    <section className={`dayboard-detail dayboard-tone-${slot.tone}`} aria-label={`${room.name}: ${slot.title}`} data-state={slot.state}>
      <div className="dayboard-detail-head">
        <div>
          <p className="dayboard-detail-room">{room.name} · {slot.timeRange}</p>
          <h3 className="dayboard-detail-title">{slot.title}</h3>
          <p className="dayboard-slot-meta">
            <span className="dayboard-slot-state"><StateIcon icon={slot.icon} size={12} /> {slot.stateLabel}</span>
            {occasion !== null ? <span> · {occasion}</span> : null}
            <span> · {slot.bookingLabel}{slot.guestCount !== null ? ` · ${String(slot.guestCount)} guests` : ""}</span>
          </p>
        </div>
        <button type="button" className="dayboard-detail-close" onClick={onClose}>Close</button>
      </div>
      {slot.phases.length > 0 && <ol className="dayboard-phases" aria-label="Planned event phases">
        {slot.phases.map((phase, index) => <li key={phase.id} data-colour={index % 6}>
          <strong>{phase.name}</strong><span>{formatWallTime(Date.parse(phase.startsAt), timeZone)} – {formatWallTime(Date.parse(phase.endsAt), timeZone)}</span>
        </li>)}
      </ol>}
      <SlotSheetLink eventId={slot.eventId} roomSlug={room.slug} roomName={room.name} timeZone={timeZone} />
      {slot.eventId !== null && <Link className="dayboard-open-event" to={`/ops/events/${slot.eventId}`}>Open event &amp; working documents →</Link>}
      {/* Lane 9's mount point. Reserved region, props only; the board never
          reads or writes request state. */}
      <div className="dayboard-slot-requests" data-slot-requests={slot.bookingId}>
        {SlotRequests !== null && (
          <SlotRequests
            bookingId={slot.bookingId}
            eventId={slot.eventId}
            roomId={room.id}
            roomName={room.name}
            startsAtMs={slot.startsAtMs}
            endsAtMs={slot.endsAtMs}
          />
        )}
      </div>
      {slot.exceptionDetail !== null ? (
        <p className="dayboard-slot-alert" role="alert">{slot.exceptionDetail}</p>
      ) : null}
      {slot.turnaroundWarning !== null ? (
        <p className="dayboard-slot-warning">{slot.turnaroundWarning}</p>
      ) : null}
    </section>
  );
}

export interface DayBoardPageProps {
  /** Lane 9's slot request surface. Overrides the context value. */
  readonly slotRequests?: SlotRequestsComponent;
}

/** The day stays on screen when a refresh does not land; it says from when
 *  once that is a different minute (the Diary's words, for the day). */
function dayRefreshFailed(at: string, readAt: string | null): string {
  return readAt === null || readAt === at
    ? `Couldn't refresh at ${at}.`
    : `Couldn't refresh at ${at}. Showing the day as it was at ${readAt}.`;
}

export function DayBoardPage({ slotRequests }: DayBoardPageProps = {}): ReactElement {
  const user = useAuthStore((state) => state.user);
  const venueId = user?.venueId ?? null;
  const venue = useVenueClock(venueId);
  const timeZone = venue.timeZone;
  const contextSlotRequests = useContext(DayBoardSlotRequestsContext);
  const slotRequestsComponent = slotRequests ?? contextSlotRequests;
  const [searchParams, setSearchParams] = useSearchParams();
  const wall = searchParams.get("register") === "wall";
  const phone = usePhoneLayout();
  const vertical = phone && !wall;

  // One corrected clock (D9), ticking at the next state boundary the board
  // derives from it; the boundary and the clock meet through state, so a
  // tick is one render at the exact instant something changes.
  const [boundaryMs, setBoundaryMs] = useState<number | null>(null);
  const nowMs = useBoardClock(boundaryMs);
  const corrected = useClockCorrected();

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [roomId, setRoomId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const browsingToday = selectedDate === null;

  // Today, venue-local; the range re-derives when the clock crosses
  // midnight, so an always-on wall tablet rolls to the new day by itself.
  const selectedMs = selectedDate === null ? nowMs : wallInputToMs(`${selectedDate}T12:00`, timeZone) ?? nowMs;
  const range = useMemo(() => boardRange(selectedMs, "day", timeZone), [selectedMs, timeZone]);
  // The days either side are read once this one is on screen, but only once
  // someone shows they may step (a mouse over or keyboard focus on the day
  // controls, or a step itself); the wish lapses after the reuse window, so
  // a wall left on today reads one day per Diary change.
  const [stepWishedAtMs, setStepWishedAtMs] = useState<number | null>(null);
  const wishToStep = useCallback((): void => { setStepWishedAtMs(Date.now()); }, []);
  const readingAhead = stepWishedAtMs !== null && Date.now() - stepWishedAtMs < CALENDAR_REUSE_MS;
  const neighbours = useMemo(
    () => (readingAhead ? [shiftRange(range, 1, timeZone), shiftRange(range, -1, timeZone)] : NO_DAYS),
    [readingAhead, range, timeZone],
  );
  const { data, status, error, refetch, isRefreshing, refreshFailedAtMs, readAtMs } = useCalendar(venueId, range, neighbours);
  const live = useDiaryLive(venueId !== null, refetch);
  // The calendar stamps its reads with the device clock; the board compares
  // and prints them on the corrected one (D9).
  const readAtCorrectedMs = readAtMs === null ? null : correctedNowMs(readAtMs);
  const refreshFailedCorrectedMs = refreshFailedAtMs === null ? null : correctedNowMs(refreshFailedAtMs);
  // The venue's open requests, from the one provider snapshot. A VenueRequest
  // carries every field the derivation reads.
  const requestsApi = useSlotRequests();
  const shownDate = msToWallInput(selectedMs, timeZone).slice(0, 10);
  const today = msToWallInput(nowMs, timeZone).slice(0, 10);

  const board = useMemo(
    () => (data === null ? null : deriveDayBoard(data, nowMs, timeZone, requestsApi.requests)),
    [data, nowMs, timeZone, requestsApi.requests],
  );
  const nextBoundaryMs = board?.nextBoundaryMs ?? null;
  useEffect(() => { setBoundaryMs(nextBoundaryMs); }, [nextBoundaryMs]);

  const lanes = board?.lanes ?? NO_LANES;
  const view = useMemo(() => boardWindow(range, lanes, nowMs, timeZone), [range, lanes, nowMs, timeZone]);
  const ticks = useMemo(() => rulerTicks(view, timeZone, wall || vertical ? 1 : 2), [view, timeZone, wall, vertical]);
  const plaque = nowPlaque(nowMs, view);

  // Live, offline or stale (D10); and every breath stops the instant the
  // socket drops after it has been up (D3 law 6), a minute before the band.
  const connection = useConnectionState(live.connected);
  const freshness = boardFreshness(nowMs, readAtCorrectedMs, connection.droppedAtMs, refreshFailedAtMs !== null);
  const frozen = freshness.kind !== "live" || (connection.everConnected && !live.connected);

  // ← Today → (roadmap N4): tomorrow's rooms are a key away, not a picker.
  // The keys are the board's while focus rests on it or on nothing.
  const boardRef = useRef<HTMLDivElement>(null);
  const moveDay = useCallback((days: number): void => {
    wishToStep();
    const next = stepDay(shownDate, days);
    setSelectedDate(next === today ? null : next);
  }, [shownDate, today, wishToStep]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.altKey || event.ctrlKey || event.metaKey || typingInto(event.target)) return;
      const onBoard = event.target === document.body || (event.target instanceof Node && boardRef.current?.contains(event.target) === true);
      if (!onBoard) return;
      if (event.key === "ArrowLeft") moveDay(-1);
      else if (event.key === "ArrowRight") moveDay(1);
      else if (event.key === "t") setSelectedDate(null);
      else if (event.key === "Escape") setSelectedId(null);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, [moveDay]);

  // On the phone the day runs down the screen: bring the present into view
  // once per day shown, and never again, so a thumb's scroll is never fought.
  const lanesRef = useRef<HTMLDivElement>(null);
  const centredFor = useRef<number | null>(null);
  useEffect(() => {
    if (!vertical || board === null || plaque === null || centredFor.current === range.fromMs) return;
    const line = lanesRef.current?.querySelector(".dayboard-now-line");
    if (!(line instanceof HTMLElement) || typeof line.scrollIntoView !== "function") return;
    centredFor.current = range.fromMs;
    line.scrollIntoView({ block: "center" });
  }, [vertical, board, plaque, range.fromMs]);
  const showLane = useCallback((roomIdToShow: string): void => {
    const lane = lanesRef.current?.querySelector(`[data-room="${roomIdToShow}"]`);
    if (lane instanceof HTMLElement && typeof lane.scrollIntoView === "function") {
      lane.scrollIntoView({ inline: "start", block: "nearest", behavior: "smooth" });
    }
  }, []);

  // An opened slot comes into view; a slot that left the day closes itself.
  // Nothing opens on the wall (D11).
  const detailRef = useRef<HTMLDivElement>(null);
  const selected = useMemo(() => {
    if (wall || selectedId === null || board === null) return null;
    for (const lane of board.lanes) {
      const slot = lane.slots.find((candidate) => candidate.bookingId === selectedId);
      if (slot !== undefined) return { slot, room: lane.room };
    }
    return null;
  }, [wall, selectedId, board]);
  useEffect(() => {
    if (selected === null) return;
    const panel = detailRef.current;
    if (panel !== null && typeof panel.scrollIntoView === "function") panel.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const openSlot = useCallback((bookingId: string | null): void => {
    if (wall) return;
    setSelectedId((current) => (bookingId === null ? current : bookingId === current ? null : bookingId));
  }, [wall]);
  // A request on the rail belongs to today: reach it from whichever day is
  // on screen.
  const openRequest = useCallback((bookingId: string | null): void => {
    if (wall || bookingId === null) return;
    setSelectedDate(null);
    setSelectedId(bookingId);
  }, [wall]);

  const zone = useMemo(() => zoneNote(timeZone, deviceZone()), [timeZone]);
  const busyLanes = lanes.filter((lane) => lane.slots.length > 0).length;
  // A room with nothing on is one name in a line, not a lane to scroll past;
  // a room chosen from the filter keeps its lane either way.
  const shownLanes = lanes.filter((lane) => (roomId === "" ? lane.slots.length > 0 : lane.room.id === roomId));
  const freeRooms = roomId === "" && busyLanes > 0 ? lanes.filter((lane) => lane.slots.length === 0).map((lane) => lane.room.name) : [];
  const readAt = readAtCorrectedMs === null ? null : formatWallTime(readAtCorrectedMs, timeZone);
  const others = live.presence.filter((person) => person.userId !== user?.id).map((person) => person.name);

  // A venue's own account not connected to one yet is told so, as on every
  // dashboard view, rather than shown a day that can never fill.
  if (awaitsVenue(user)) {
    return (
      <DashboardLayout mainLabel="The Day Board" surface="rota">
        <VenueNotConnected title="The Day Board" consequence="there are no bookings to show" />
      </DashboardLayout>
    );
  }

  const nextAction = board !== null && browsingToday && board.nextAction.kind !== "quiet" ? board.nextAction : null;
  const nextIsUrgent = nextAction?.kind === "request" && board?.unowned[0]?.urgency === "now";
  const body = (
    <div
      className="dayboard"
      ref={boardRef}
      data-register={wall ? "wall" : "paper"}
      data-layout={vertical ? "phone" : "sheet"}
      data-frozen={frozen ? "true" : "false"}
    >
      {/* The stale band (D3, D10): the one thing that outranks every state.
          Every breath on the board has already stopped (data-frozen). */}
      {freshness.kind !== "live" && (
        <div className="dayboard-stale" role="status">
          <WifiOff size={16} aria-hidden="true" />
          {freshness.kind === "offline"
            ? <span>Offline since {formatWallTime(freshness.sinceMs, timeZone)} · reconnecting. Showing the day as last read; the words still stand.</span>
            : <span>Showing the day as read at {formatWallTime(freshness.readAtMs, timeZone)}.</span>}
          <button type="button" className="dayboard-refresh" onClick={refetch}>Refresh</button>
        </div>
      )}

      <header className="dayboard-header">
        <div>
          <h1 className="dayboard-title">The Day Board</h1>
          <p className="dayboard-subtitle">{formatWallDay(selectedMs, timeZone)}{zone === null ? "" : ` · ${zone}`}</p>
        </div>
        {/* Honest about how fresh the day is: the socket reconnects by
            itself, and Refresh reads the day now. With no venue there is
            no socket to reconnect, so nothing is said of one. */}
        {venueId !== null && (
          <div className="dayboard-status" role="status">
            <span className={`dayboard-live-dot${live.connected ? " is-connected" : ""}`} aria-hidden="true" />
            {live.connected
              ? <span>{readAt === null ? "Live" : `Live · updated ${readAt}`}</span>
              : <>
                <span>{readAt === null ? "Reconnecting…" : `Updated ${readAt} · reconnecting…`}</span>
                <button type="button" className="dayboard-refresh" onClick={refetch}>Refresh</button>
              </>}
            {corrected && <span className="dayboard-corrected">Clock corrected</span>}
            {others.length > 0 && <span className="dayboard-presence">Also watching: {others.join(", ")}</span>}
          </div>
        )}
      </header>

      {nextAction !== null && <NextActionLine action={nextAction} urgent={nextIsUrgent === true} onOpen={openSlot} />}

      {!wall && (
        <div className="dayboard-controls">
          <div
            className="dayboard-days"
            onPointerEnter={(event) => { if (event.pointerType !== "touch") wishToStep(); }}
            onFocus={(event) => { if (keyboardFocus(event.target)) wishToStep(); }}
          >
            <button type="button" aria-label="Previous day" onClick={() => { moveDay(-1); }}><ArrowLeft size={18} aria-hidden="true" /></button>
            <label className="dayboard-day-field">Day<input type="date" value={shownDate} onChange={(event) => { if (event.target.value !== "") setSelectedDate(event.target.value === today ? null : event.target.value); }} /></label>
            <button type="button" aria-pressed={selectedDate === null} onClick={() => { setSelectedDate(null); }}>Today</button>
            <button type="button" aria-label="Next day" onClick={() => { moveDay(1); }}><ArrowRight size={18} aria-hidden="true" /></button>
          </div>
          <label>Room<select value={roomId} onChange={(event) => { setRoomId(event.target.value); }}><option value="">All rooms</option>{lanes.map((lane) => <option key={lane.room.id} value={lane.room.id}>{lane.room.name}</option>)}</select></label>
          <Link to="/diary">Open Diary</Link><Link to="/hallkeeper/rooms">Room plans</Link>
          <button type="button" onClick={() => { setSearchParams({ register: "wall" }); }}>Wall display</button>
        </div>
      )}
      {venueId === null && <p className="dayboard-notice">No venue is linked to this account. Ask your venue administrator to connect your workspace.</p>}
      {venueId !== null && data === null && status === "loading" && <ActivityStatus variant="panel">Loading the day’s bookings…</ActivityStatus>}
      {venueId !== null && isRefreshing && <ActivityStatus>Refreshing the day’s bookings…</ActivityStatus>}

      {status === "error" ? (
        <div className="dayboard-notice" role="alert">
          <p>{error ?? "The board could not load."}</p>
          <button type="button" className="diary-button" onClick={refetch}>
            Try again
          </button>
        </div>
      ) : null}
      {/* A refresh that did not land keeps the day on screen and says from when. */}
      {refreshFailedCorrectedMs !== null ? (
        <div className="dayboard-notice" role="status">
          <p>{dayRefreshFailed(formatWallTime(refreshFailedCorrectedMs, timeZone), readAt)}</p>
          <button type="button" className="diary-button" onClick={refetch}>
            Try again
          </button>
        </div>
      ) : null}

      {status !== "error" && board !== null && busyLanes === 0 && roomId === "" ? (
        <p className="dayboard-notice">{selectedDate === null ? "Nothing scheduled today." : "Nothing scheduled on this day."}</p>
      ) : null}

      {/* Swipe between rooms on the phone; the tabs name where you are. */}
      {vertical && shownLanes.length > 1 && (
        <div className="dayboard-pager" aria-label="Rooms">
          {shownLanes.map((lane) => (
            <button key={lane.room.id} type="button" onClick={() => { showLane(lane.room.id); }}>{lane.room.name}</button>
          ))}
        </div>
      )}

      {board !== null && (
        <div className={`dayboard-body${shownLanes.length === 0 ? " is-quiet" : ""}`}>
          {shownLanes.length > 0 && (
            <div className="dayboard-sheet">
              <div className="dayboard-sheet-inner">
                {!vertical && (
                  <div className="dayboard-ruler" aria-hidden="true">
                    <span className="dayboard-ruler-head" />
                    <Ruler ticks={ticks} plaque={plaque} nowMs={nowMs} timeZone={timeZone} vertical={false} />
                  </div>
                )}
                <div className="dayboard-lanes" ref={lanesRef}>
                  {shownLanes.map((lane) => (
                    <Lane
                      key={lane.room.id}
                      lane={lane}
                      view={view}
                      ticks={ticks}
                      nowMs={nowMs}
                      plaque={plaque}
                      timeZone={timeZone}
                      venueSlug={venue.slug}
                      selectedId={selectedId}
                      onOpen={openSlot}
                      wall={wall}
                      vertical={vertical}
                      frozen={frozen}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
          <Rail unowned={board.unowned} today={browsingToday} onOpen={openRequest} />
        </div>
      )}
      {freeRooms.length > 0 && <p className="dayboard-free">
        <span>{selectedDate === null ? "Also free today:" : "Also free this day:"}</span> {freeRooms.join(", ")}.
      </p>}

      {selected !== null && (
        <div ref={detailRef}>
          <SlotDetail
            slot={selected.slot}
            room={selected.room}
            timeZone={timeZone}
            slotRequests={slotRequestsComponent}
            onClose={() => { setSelectedId(null); }}
          />
        </div>
      )}

      {/* Built from the states the board draws, in the words a slot uses;
          then the ring and the band, the second channel. */}
      <footer className="dayboard-legend" aria-label="What the colours mean">
        {DAY_BOARD_LEGEND.map((entry) => (
          <span key={entry.tone} className={`dayboard-chip dayboard-chip-${entry.tone}`}>
            <span className="dayboard-chip-dot" aria-hidden="true" />
            <StateIcon icon={entry.icon} size={12} />
            {entry.label}
          </span>
        ))}
        {DAY_BOARD_RING_LEGEND.map((entry) => (
          <span key={entry.key} className={`dayboard-chip dayboard-chip-ring dayboard-chip-ring-${entry.key}`}>
            <StateIcon icon={entry.icon} size={12} />
            {entry.label}
          </span>
        ))}
      </footer>
      {wall && (
        <p className="dayboard-wall-foot">
          <button type="button" className="dayboard-refresh" onClick={() => { setSearchParams({}); }}>Office view</button>
        </p>
      )}
    </div>
  );

  if (wall) {
    return <main className="dayboard-wall" aria-label="The Day Board, wall display">{body}</main>;
  }
  return <DashboardLayout mainLabel="The Day Board">{body}</DashboardLayout>;
}

export default DayBoardPage;
