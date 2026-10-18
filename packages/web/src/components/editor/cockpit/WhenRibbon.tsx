import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import { addRotaDays, rotaInstant, rotaLocalDate, type ClientEventSchedule, type EventPhase } from "@omnitwin/types";
import { ActivityStatus } from "../../shared/Activity.js";
import { ApiError } from "../../../api/client.js";
import { moveBooking, transitionBooking } from "../../../api/diary.js";
import { estimatePrice } from "../../../api/pricing.js";
import { proposeWindow } from "../../../api/when-window.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { canReadInternalEventData } from "../../../lib/event-access.js";
import { CLIENT_SIDE_ROLES, DIARY_WRITE_ROLES, hasRole } from "../../../lib/role-capabilities.js";
import { useLinkedEvent } from "../../../hooks/use-linked-event.js";
import { useClientEventSchedule } from "../../../hooks/use-client-event-schedule.js";
import { useRoomDay } from "../../../hooks/use-room-day.js";
import { useCalendar } from "../../../pages/diary/hooks/useCalendar.js";
import { useDiaryLive } from "../../../pages/diary/hooks/useDiaryLive.js";
import {
  VENUE_TIME_ZONE,
  formatWallDay,
  formatWallTime,
  hourTicks,
  msToX,
  widthPx,
} from "../../../pages/diary/lib/board-time.js";
import { prefersReducedMotion } from "../../../lib/reduced-motion.js";
import { stepSpring, isSpringSettled, type SpringConfig, type SpringState } from "../../../lib/springs.js";
import {
  beginRibbonDrag,
  buildClientRibbonDay,
  buildRibbonDay,
  CLIENT_DRAFT_SLOT_ID,
  deriveRibbonHandles,
  dropRibbonDrag,
  moveRibbonDrag,
  moveRibbonHandle,
  ribbonPhaseWrites,
  typedRibbonDrag,
  type RibbonDay,
  type RibbonDrag,
  type RibbonDragMode,
  type RibbonDrop,
  type RibbonHandle,
  type RibbonHandles,
  type RibbonSlot,
} from "./when-ribbon-model.js";
import { parseWhenEntry } from "./when-ribbon-entry.js";
import { applyRibbonPhaseWrites, phaseInputsFor } from "./when-ribbon-phases.js";
import { formatPrice, priceWindowFor } from "./when-ribbon-price.js";
import { createSnapTick, readTickPreference, writeTickPreference } from "../../../lib/sound-registry.js";
import { RIBBON_COPY } from "./when-ribbon-copy.js";
import "./when-ribbon.css";

// ---------------------------------------------------------------------------
// The When ribbon (Day Board S2; goal 19 S6) — the plan's booking as a
// draggable gilt ingot over its room's day strip.
//
// LAW: times are set through the Diary booking — the ribbon writes ONE
// moveBooking PATCH (idempotent command path) and re-reads GET /calendar;
// it never keeps its own time store. Goal 19 S6 adds the client's side of
// the same law: their ribbon is built from the anonymised room day and
// writes ONE proposed-window PUT, which the house holds and the office
// confirms; typed natural entry ("12-4pm", "7 for 7:30") lands on the same
// drop path as a drag; the office's phase handles write event phases; the
// price line is the venue's own estimate, recomputed as the window moves.
//
// Feel: the ingot tracks the pointer 1:1 (never gated behind reduced
// motion); 15-minute snapping lives on a landing shadow, not on the
// grabbed bar (hard mid-drag snapping reads as magnetism); the release
// spring-settles onto the snapped span like a drawer (goal 01 §5). Ink
// ghosts are walls (DB truth) — the bar compresses against them with a
// rubber offset and bounces back. Turnaround buffers are hatched guidance
// you can push through — the team judges. Ink moves keep the confirm step:
// ink resists. Every sound is opt-in: the snap tick is off until asked for.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
/** Where a client's bar rests before any proposal, when the event has no planned window yet. */
const DEFAULT_WINDOW_MS = 5 * HOUR_MS;
const DEFAULT_EVENING_MINUTE = 18 * 60;
/** How long the window must rest before the venue is asked for a price. */
const PRICE_DEBOUNCE_MS = 350;
/** Release / magnetise (goal 01 §5): mass 2, stiffness 200, damping 24, folded per unit mass. Snaps home like a drawer. */
const INGOT_SETTLE: SpringConfig = { stiffness: 100, damping: 12 };
/** The bounce off a confirmed wall — the same drawer, underdamped so the wall is felt. */
const INGOT_BOUNCE: SpringConfig = { stiffness: 100, damping: 7 };
const EMPTY_PHASES: readonly EventPhase[] = [];
const INNER_HANDLES: readonly RibbonHandle[] = ["doors", "live", "clear-down"];

/** Rubber compression: asymptotic give, never a hard visual stop. */
function rubberPx(overshootPx: number): number {
  return overshootPx / (1 + Math.abs(overshootPx) / 36);
}

type RibbonVariant =
  | {
      readonly kind: "office";
      readonly eventId: string;
      readonly venueId: string;
      readonly timeZone: string;
      readonly guestCount: number | null;
      readonly phases: readonly EventPhase[];
    }
  | {
      readonly kind: "client";
      readonly eventId: string;
      readonly spaceId: string;
      readonly timeZone: string;
    };

interface PointerSession {
  readonly pointerId: number;
  readonly startClientX: number;
  readonly mode: RibbonDragMode;
}

interface HandleSession {
  readonly pointerId: number;
  readonly startClientX: number;
  readonly handle: RibbonHandle;
  readonly origin: RibbonHandles;
}

interface PendingCommit {
  readonly startsAt: string;
  readonly endsAt: string;
  readonly warning: string | null;
  /** What a typed entry had to assume, echoed beside the question. */
  readonly assumptions: readonly string[];
}

interface UndoState {
  readonly startsAt: string;
  readonly endsAt: string;
}

type Notice =
  | { readonly kind: "warning" | "error" | "hint"; readonly text: string }
  | { readonly kind: "moved"; readonly text: string };

type PriceLine =
  | { readonly kind: "idle" }
  | { readonly kind: "working" }
  | { readonly kind: "ready"; readonly text: string }
  | { readonly kind: "note"; readonly text: string };

function rangeLabel(startMs: number, endMs: number, timeZone: string = VENUE_TIME_ZONE): string {
  return `${formatWallTime(startMs, timeZone)} – ${formatWallTime(endMs, timeZone)}`;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** One key per gesture: a retry of the same proposal is the same proposal. */
function newGestureKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const hex = (): string => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}

/** This evening at six on the venue's clock, or tomorrow's if that has passed. */
function eveningStart(nowMs: number, timeZone: string): number {
  const date = rotaLocalDate(nowMs, timeZone);
  const today = rotaInstant(date, DEFAULT_EVENING_MINUTE, timeZone);
  return today > nowMs ? today : rotaInstant(addRotaDays(date, 1), DEFAULT_EVENING_MINUTE, timeZone);
}

function handleValue(handles: RibbonHandles, handle: RibbonHandle): number {
  switch (handle) {
    case "setup-start": return handles.setupStartMs;
    case "doors": return handles.doorsMs;
    case "live": return handles.liveMs;
    case "clear-down": return handles.clearDownMs;
    case "end": return handles.endMs;
  }
}

function handleLabel(handle: RibbonHandle): string {
  switch (handle) {
    case "setup-start": return RIBBON_COPY.handleSetup;
    case "doors": return RIBBON_COPY.handleDoors;
    case "live": return RIBBON_COPY.handleLive;
    case "clear-down": return RIBBON_COPY.handleClearDown;
    case "end": return RIBBON_COPY.handleEnd;
  }
}

/** "Setup 17:00 · Doors 18:00 · Live 18:30 · Clear-down 22:00 · Ends 23:00" */
function handleLegend(handles: RibbonHandles, timeZone: string): string {
  const all: readonly RibbonHandle[] = ["setup-start", "doors", "live", "clear-down", "end"];
  return all.map((handle) => `${handleLabel(handle)} ${formatWallTime(handleValue(handles, handle), timeZone)}`).join(" · ");
}

export function WhenRibbon(): ReactElement | null {
  const auth = useAuthStore();
  if (canReadInternalEventData(auth)) return <VenueWhenRibbon />;
  if (!auth.isLoading && auth.isAuthenticated && hasRole(CLIENT_SIDE_ROLES, auth.user?.role)) return <ClientWhenRibbon />;
  return null;
}

function VenueWhenRibbon(): ReactElement | null {
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get("eventId");
  const linked = useLinkedEvent();
  const user = useAuthStore((state) => state.user);
  // Moving the booking is a Diary write (`moveBooking`), whoever does it.
  const writable = hasRole(DIARY_WRITE_ROLES, user?.role);
  const venueId = linked.graph?.event.venueId ?? null;
  const eventStartsAt = linked.graph?.event.startsAt ?? null;
  const guestCount = linked.graph?.event.guestCount ?? null;
  const phases = linked.graph?.phases ?? EMPTY_PHASES;
  const anchorMs = useMemo(
    () => (eventStartsAt !== null ? Date.parse(eventStartsAt) : Date.now()),
    [eventStartsAt],
  );
  // The booking is found by scanning calendar entries for the plan's
  // eventId (no lookup endpoint exists) — a ±7 day room-agnostic window
  // around the event, widened once to ±90 before concluding "not in the
  // Diary" (the booking may have been moved well away from the event's
  // seeded date).
  const [windowDays, setWindowDays] = useState(7);
  const range = useMemo(
    () => ({
      // The view tag is descriptive only here — this is a search window, not
      // a board layout; nothing shifts or titles it.
      view: "week" as const,
      fromMs: anchorMs - windowDays * DAY_MS,
      toMs: anchorMs + windowDays * DAY_MS,
    }),
    [anchorMs, windowDays],
  );
  const { data, status, isRefreshing, refetch } = useCalendar(venueId, range);
  useDiaryLive(venueId !== null, refetch);
  const day = useMemo(
    () => (data === null || eventId === null ? null : buildRibbonDay(data, eventId)),
    [data, eventId],
  );
  useEffect(() => {
    if (data !== null && day === null && windowDays === 7) setWindowDays(90);
  }, [data, day, windowDays]);
  // useCalendar retains the previous response while a new range starts. An
  // empty narrow response cannot establish that the expanded search is empty.
  const expandedSearchComplete = windowDays === 90 && data !== null &&
    data.venueId === venueId &&
    Date.parse(data.range.from) === range.fromMs &&
    Date.parse(data.range.to) === range.toMs;
  const searching = day === null && status !== "error" && !expandedSearchComplete;
  const variant = useMemo<RibbonVariant | null>(
    () => (eventId === null || venueId === null
      ? null
      : { kind: "office", eventId, venueId, timeZone: VENUE_TIME_ZONE, guestCount, phases }),
    [eventId, venueId, guestCount, phases],
  );
  if (eventId === null || linked.status !== "loaded" || variant === null) return null;
  return (
    <RibbonBody
      key={eventId}
      day={day}
      calendarStatus={status}
      calendarRefreshing={isRefreshing || searching}
      writable={writable}
      refetch={refetch}
      variant={variant}
    />
  );
}

/** The client's side (goal 19 S6): the room's day, anonymised, around their
 *  own slot or the draft where their event is planned to sit. */
function ClientWhenRibbon(): ReactElement | null {
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get("eventId");
  const configurationId = useEditorStore((state) => state.configId);
  const expectedVenueId = useEditorStore((state) => state.venueId);
  const schedule = useClientEventSchedule(eventId, { configurationId, expectedVenueId });
  // A refresh after a proposal empties the hook for a moment; the ribbon keeps
  // the last schedule on screen rather than unmounting and losing its notice.
  const lastSchedule = useRef<ClientEventSchedule | null>(null);
  if (schedule.data !== null) lastSchedule.current = schedule.data;
  const data = schedule.data ?? (schedule.status === "loading" ? lastSchedule.current : null);
  const timeZone = data?.venue.timezone ?? VENUE_TIME_ZONE;
  const room = useMemo(() => {
    if (data === null) return null;
    return data.layouts.find((layout) => layout.id === configurationId)?.space ?? data.layouts[0]?.space ?? null;
  }, [data, configurationId]);
  const own = useMemo(() => {
    if (data === null || room === null) return null;
    const slot = data.slots.find((candidate) => candidate.space.id === room.id);
    if (slot === undefined) return null;
    return { bookingId: slot.bookingId, kind: slot.kind, title: slot.title, startMs: Date.parse(slot.startsAt), endMs: Date.parse(slot.endsAt) };
  }, [data, room]);
  const draft = useMemo(() => {
    if (data === null) return null;
    const planned = data.event.startsAt === null ? null : Date.parse(data.event.startsAt);
    const startMs = planned ?? eveningStart(Date.now(), timeZone);
    const plannedEnd = data.event.endsAt === null ? null : Date.parse(data.event.endsAt);
    const endMs = plannedEnd !== null && plannedEnd > startMs ? plannedEnd : startMs + DEFAULT_WINDOW_MS;
    return { startMs, endMs, title: data.event.name };
  }, [data, timeZone]);
  const anchorMs = own?.startMs ?? draft?.startMs ?? null;
  const date = anchorMs === null ? null : rotaLocalDate(anchorMs, timeZone);
  const roomDay = useRoomDay(eventId, room?.id ?? null, date);
  const day = useMemo(
    () => (roomDay.data === null || room === null
      ? null
      : buildClientRibbonDay({ spans: roomDay.data.spans, space: room, timeZone, turnaroundMinutes: roomDay.data.turnaroundMinutes, own, draft })),
    [roomDay.data, room, timeZone, own, draft],
  );
  const refreshBoth = useCallback(() => {
    schedule.refresh();
    roomDay.refetch();
  }, [schedule, roomDay]);
  const variant = useMemo<RibbonVariant | null>(
    () => (eventId === null || room === null ? null : { kind: "client", eventId, spaceId: room.id, timeZone }),
    [eventId, room, timeZone],
  );
  if (eventId === null || schedule.status === "none") return null;
  if (data === null || variant === null) {
    return (
      <aside className="when-ribbon" data-testid="when-ribbon" aria-label="When">
        <div className="when-ribbon__row">
          <span className="when-ribbon__eyebrow">{RIBBON_COPY.heading}</span>
          {schedule.status === "loading" ? (
            <ActivityStatus>{RIBBON_COPY.roomDayLoading}</ActivityStatus>
          ) : (
            <span className="when-ribbon__note" role="note">
              {RIBBON_COPY.roomDayFailed}{" "}
              <button type="button" className="when-ribbon__link" onClick={schedule.refresh}>
                {RIBBON_COPY.tryAgain}
              </button>
            </span>
          )}
        </div>
      </aside>
    );
  }
  // A confirmed time is the office's to change; a provisional one, or none
  // yet, is the client's to propose.
  const writable = own === null || own.kind !== "ink";
  return (
    <RibbonBody
      key={eventId}
      day={day}
      calendarStatus={roomDay.status}
      calendarRefreshing={roomDay.isRefreshing}
      writable={writable}
      refetch={refreshBoth}
      variant={variant}
    />
  );
}

// The body is split out so hooks that need a loaded day stay unconditional.
function RibbonBody({
  day,
  calendarStatus,
  calendarRefreshing,
  writable,
  refetch,
  variant,
}: {
  readonly day: RibbonDay | null;
  readonly calendarStatus: "loading" | "ready" | "error";
  readonly calendarRefreshing: boolean;
  readonly writable: boolean;
  readonly refetch: () => void;
  readonly variant: RibbonVariant;
}): ReactElement | null {
  const timeZone = variant.timeZone;
  const office = variant.kind === "office" ? variant : null;
  const stripRef = useRef<HTMLDivElement | null>(null);
  const ingotRef = useRef<HTMLDivElement | null>(null);
  const [stripWidth, setStripWidth] = useState(960);
  const hasDay = day !== null;
  useEffect(() => {
    const strip = stripRef.current;
    if (strip === null) return;
    const measure = (): void => {
      const width = strip.clientWidth;
      if (width > 0) setStripWidth(width);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    return () => { observer.disconnect(); };
  }, [hasDay]);
  // Optimistic override: the one moved span we are waiting on the server
  // for. Cleared whenever fresh data arrives (day identity turns over) or
  // the write fails.
  const [override, setOverride] = useState<{ startMs: number; endMs: number } | null>(null);
  useEffect(() => { setOverride(null); }, [day]);
  const [drag, setDrag] = useState<RibbonDrag | null>(null);
  const dragRef = useRef<RibbonDrag | null>(null);
  const updateDrag = useCallback((next: RibbonDrag | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);
  const [pending, setPending] = useState<PendingCommit | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [undoable, setUndoable] = useState<UndoState | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [pendingRequests, setPendingRequests] = useState(0);
  const [keyboardDrag, setKeyboardDrag] = useState<RibbonDrag | null>(null);
  const [typed, setTyped] = useState("");
  const [price, setPrice] = useState<PriceLine>({ kind: "idle" });
  const [tickOn, setTickOn] = useState(readTickPreference);
  const tickRef = useRef<(() => void) | null>(null);
  const sessionRef = useRef<PointerSession | null>(null);
  const springRef = useRef<{ state: SpringState; target: number; raf: number | null }>({
    state: { value: 0, velocity: 0 },
    target: 0,
    raf: null,
  });
  // The office's phase handles: the phases as the server holds them, the
  // marker under the hand, and the write in flight.
  const officePhases = office?.phases ?? EMPTY_PHASES;
  const [phases, setPhases] = useState<readonly EventPhase[]>(officePhases);
  useEffect(() => { setPhases(officePhases); }, [officePhases]);
  const [handleDraft, setHandleDraft] = useState<RibbonHandles | null>(null);
  const handleDraftRef = useRef<RibbonHandles | null>(null);
  const handleSessionRef = useRef<HandleSession | null>(null);
  const [savingHandles, setSavingHandles] = useState(false);

  const self: RibbonSlot | null = day === null
    ? null
    : override === null
      ? day.self
      : { ...day.self, startMs: override.startMs, endMs: override.endMs };
  const pxPerHour = stripWidth / 24;
  const msToPx = useCallback(
    (ms: number) => (ms / HOUR_MS) * pxPerHour,
    [pxPerHour],
  );
  const tick = useCallback(() => {
    if (!tickOn) return;
    tickRef.current ??= createSnapTick();
    tickRef.current();
  }, [tickOn]);
  const toggleTick = useCallback(() => {
    const next = !tickOn;
    setTickOn(next);
    writeTickPreference(next);
  }, [tickOn]);
  const setOffsetPx = useCallback((px: number) => {
    const ingot = ingotRef.current;
    if (ingot !== null) ingot.style.transform = px === 0 ? "" : `translateX(${String(px)}px)`;
  }, []);
  const stopSpring = useCallback(() => {
    const spring = springRef.current;
    if (spring.raf !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(spring.raf);
    }
    spring.raf = null;
  }, []);
  const animateOffsetTo = useCallback(
    (targetPx: number, config: SpringConfig, onSettle?: () => void) => {
      const spring = springRef.current;
      stopSpring();
      spring.target = targetPx;
      if (prefersReducedMotion() || typeof requestAnimationFrame !== "function") {
        spring.state.value = targetPx;
        spring.state.velocity = 0;
        setOffsetPx(targetPx);
        onSettle?.();
        return;
      }
      let last = performance.now();
      const step = (now: number): void => {
        const dt = Math.min((now - last) / 1000, 0.25);
        last = now;
        stepSpring(spring.state, spring.target, dt, config);
        setOffsetPx(spring.state.value);
        if (isSpringSettled(spring.state, spring.target, 0.4)) {
          spring.state.value = spring.target;
          spring.state.velocity = 0;
          setOffsetPx(spring.target);
          spring.raf = null;
          onSettle?.();
          return;
        }
        spring.raf = requestAnimationFrame(step);
      };
      spring.raf = requestAnimationFrame(step);
    },
    [setOffsetPx, stopSpring],
  );
  useEffect(() => () => { stopSpring(); }, [stopSpring]);

  // A client's every proposal and the office's every confirmed move pause for
  // the question; a provisional move by the office goes straight through.
  const needsConfirm = useCallback(
    (drop: Extract<RibbonDrop, { effect: "commit" }>) => variant.kind === "client" || drop.needsInkConfirm,
    [variant.kind],
  );
  const commitSpan = useCallback(
    (startsAt: string, endsAt: string, warning: string | null, assumptions: readonly string[] = []) => {
      if (day === null) return;
      const before: UndoState = { startsAt: iso(day.self.startMs), endsAt: iso(day.self.endMs) };
      setOverride({ startMs: Date.parse(startsAt), endMs: Date.parse(endsAt) });
      setOffsetPx(0);
      springRef.current.state = { value: 0, velocity: 0 };
      setPending(null);
      setNotice(warning === null ? null : { kind: "warning", text: warning });
      setPendingRequests((count) => count + 1);
      const range = rangeLabel(Date.parse(startsAt), Date.parse(endsAt), timeZone);
      const echo = assumptions.length === 0 ? "" : ` ${assumptions.join(" · ")}.`;
      const request: Promise<string> = variant.kind === "office"
        ? moveBooking(day.self.id, { startsAt, endsAt }).then(() => {
            setUndoable(before);
            return `${RIBBON_COPY.moved(range)}${echo}`;
          })
        : proposeWindow(variant.eventId, { spaceId: variant.spaceId, startsAt, endsAt, idempotencyKey: newGestureKey() })
            .then(() => `${RIBBON_COPY.proposed(range)}${echo}`);
      void request
        .then((text) => {
          setNotice(warning !== null ? { kind: "warning", text: `${warning}${echo}` } : { kind: "moved", text });
          refetch();
        })
        .catch((error: unknown) => {
          setOverride(null);
          const code = error instanceof ApiError ? error.code : null;
          if (code === "INK_SLOT_TAKEN" || code === "BOOKING_STATE_CHANGED") {
            setNotice({ kind: "error", text: RIBBON_COPY.slotTaken });
            refetch();
            return;
          }
          if (code === "WINDOW_DECIDED") {
            setNotice({ kind: "error", text: RIBBON_COPY.proposeDecided });
            refetch();
            return;
          }
          setNotice({ kind: "error", text: variant.kind === "office" ? RIBBON_COPY.moveFailed : RIBBON_COPY.proposeFailed });
        })
        .finally(() => { setPendingRequests((count) => count - 1); });
    },
    [day, refetch, setOffsetPx, timeZone, variant],
  );
  const undoMove = useCallback(() => {
    if (day === null || undoable === null || variant.kind !== "office") return;
    const back = undoable;
    setUndoable(null);
    setNotice(null);
    setOverride({ startMs: Date.parse(back.startsAt), endMs: Date.parse(back.endsAt) });
    setPendingRequests((count) => count + 1);
    void moveBooking(day.self.id, { startsAt: back.startsAt, endsAt: back.endsAt })
      .then(() => { refetch(); })
      .catch(() => {
        setOverride(null);
        setNotice({ kind: "error", text: RIBBON_COPY.moveFailed });
      })
      .finally(() => { setPendingRequests((count) => count - 1); });
  }, [day, refetch, undoable, variant.kind]);
  // The office confirms a provisional time: the hold becomes the booking, the
  // Diary and the client's schedule follow through the live channel.
  const confirmHold = useCallback(() => {
    if (day === null || office === null) return;
    const range = rangeLabel(day.self.startMs, day.self.endMs, timeZone);
    setConfirming(false);
    setPendingRequests((count) => count + 1);
    void transitionBooking(day.self.id, "ink")
      .then(() => {
        setUndoable(null);
        setNotice({ kind: "hint", text: RIBBON_COPY.confirmed(range) });
        refetch();
      })
      .catch(() => { setNotice({ kind: "error", text: RIBBON_COPY.confirmFailed }); })
      .finally(() => { setPendingRequests((count) => count - 1); });
  }, [day, office, refetch, timeZone]);
  const settleDrop = useCallback(
    (finalDrag: RibbonDrag) => {
      if (day === null) return;
      const drop = dropRibbonDrag(finalDrag, day);
      const proposedOffsetPx = msToPx(finalDrag.proposedStartMs - finalDrag.originStartMs);
      const bounced = finalDrag.overshootMs !== 0;
      if (drop.effect === "noop") {
        animateOffsetTo(0, bounced ? INGOT_BOUNCE : INGOT_SETTLE);
        return;
      }
      const land = (): void => {
        if (needsConfirm(drop)) {
          setPending({ startsAt: drop.startsAt, endsAt: drop.endsAt, warning: drop.warning, assumptions: [] });
        } else {
          commitSpan(drop.startsAt, drop.endsAt, drop.warning);
        }
      };
      if (finalDrag.mode === "move") {
        animateOffsetTo(proposedOffsetPx, bounced ? INGOT_BOUNCE : INGOT_SETTLE, land);
      } else {
        // Resize renders its proposal on the base span directly (width is
        // not springable as a transform without distorting the bar's text).
        land();
      }
    },
    [animateOffsetTo, commitSpan, day, msToPx, needsConfirm],
  );
  const beginPointerDrag = useCallback(
    (mode: RibbonDragMode) =>
      (event: React.PointerEvent<HTMLElement>) => {
        if (!writable || day === null) return;
        if (sessionRef.current !== null || handleSessionRef.current !== null) return; // first pointer wins
        if (pending !== null) return;
        event.preventDefault();
        event.stopPropagation();
        stopSpring();
        setOffsetPx(0);
        springRef.current.state = { value: 0, velocity: 0 };
        sessionRef.current = { pointerId: event.pointerId, startClientX: event.clientX, mode };
        const captureTarget = event.currentTarget;
        if (typeof captureTarget.setPointerCapture === "function") {
          captureTarget.setPointerCapture(event.pointerId);
        }
        const base = override === null
          ? day.self
          : { ...day.self, startMs: override.startMs, endMs: override.endMs };
        updateDrag(beginRibbonDrag(mode, base));
        setNotice(null);
        setUndoable(null);
      },
    [day, override, pending, setOffsetPx, stopSpring, updateDrag, writable],
  );
  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const session = sessionRef.current;
      const current = dragRef.current;
      if (session === null || current === null || day === null) return;
      if (event.pointerId !== session.pointerId) return;
      const rawDeltaPx = event.clientX - session.startClientX;
      const rawDeltaMs = (rawDeltaPx / pxPerHour) * HOUR_MS;
      const next = moveRibbonDrag(current, day, rawDeltaMs, event.shiftKey);
      if (session.mode === "move") {
        // The bar itself follows the pointer 1:1, compressed against
        // hard walls — the snapped landing lives on the shadow.
        const clampedPx = next.overshootMs === 0
          ? msToPx(rawDeltaMs)
          : msToPx(next.proposedStartMs - next.originStartMs);
        const givePx = next.overshootMs === 0 ? 0 : rubberPx(msToPx(next.overshootMs));
        setOffsetPx(clampedPx + givePx);
      }
      if (next.proposedStartMs !== current.proposedStartMs || next.proposedEndMs !== current.proposedEndMs) tick();
      updateDrag(next);
    },
    [day, msToPx, pxPerHour, setOffsetPx, tick, updateDrag],
  );
  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const session = sessionRef.current;
      if (session === null || event.pointerId !== session.pointerId) return;
      sessionRef.current = null;
      const finalDrag = dragRef.current;
      updateDrag(null);
      if (finalDrag !== null) settleDrop(finalDrag);
    },
    [settleDrop, updateDrag],
  );
  const onPointerCancel = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const session = sessionRef.current;
      if (session === null || event.pointerId !== session.pointerId) return;
      sessionRef.current = null;
      animateOffsetTo(0, INGOT_SETTLE);
      updateDrag(null);
    },
    [animateOffsetTo, updateDrag],
  );
  const onIngotKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (!writable || day === null || pending !== null) return;
      if (event.target !== event.currentTarget) return; // a grip's own keys are its own
      const base = override === null
        ? day.self
        : { ...day.self, startMs: override.startMs, endMs: override.endMs };
      const current = keyboardDrag ?? beginRibbonDrag(event.altKey ? "resize-end" : "move", base);
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const stepMs = (event.shiftKey ? 1 : 15) * MINUTE_MS;
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const already = current.mode === "resize-end"
          ? current.proposedEndMs - current.originEndMs
          : current.proposedStartMs - current.originStartMs;
        const next = moveRibbonDrag(current, day, already + direction * stepMs, event.shiftKey);
        if (next.proposedStartMs !== current.proposedStartMs || next.proposedEndMs !== current.proposedEndMs) tick();
        setKeyboardDrag(next);
        setAnnouncement(
          next.overshootMs !== 0 && next.mode === "move"
            ? RIBBON_COPY.announceBlocked(
                day.ghosts.find((ghost) => ghost.exclusion === "hard")?.title ?? "a confirmed booking",
              )
            : RIBBON_COPY.announceMove(rangeLabel(next.proposedStartMs, next.proposedEndMs, timeZone)),
        );
        return;
      }
      if (event.key === "Enter" && keyboardDrag !== null) {
        event.preventDefault();
        const drop = dropRibbonDrag(keyboardDrag, day);
        setKeyboardDrag(null);
        if (drop.effect === "commit") {
          // Keyboard commits are never animated — they repeat all day.
          if (needsConfirm(drop)) {
            setPending({ startsAt: drop.startsAt, endsAt: drop.endsAt, warning: drop.warning, assumptions: [] });
          } else {
            commitSpan(drop.startsAt, drop.endsAt, drop.warning);
          }
        }
        return;
      }
      if (event.key === "Escape" && keyboardDrag !== null) {
        event.preventDefault();
        setKeyboardDrag(null);
        setAnnouncement("");
      }
    },
    [commitSpan, day, keyboardDrag, needsConfirm, override, pending, tick, timeZone, writable],
  );
  // Typed entry lands on the same drop path as a drag: exact, refused on a
  // wall, warned inside a guideline, questioned where a drag would be.
  const submitTyped = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (day === null || self === null || !writable || pending !== null) return;
      const date = rotaLocalDate(day.range.fromMs + 12 * HOUR_MS, timeZone);
      const parsed = parseWhenEntry(typed, {
        date,
        timeZone,
        current: { startMs: self.startMs, endMs: self.endMs },
        defaultDurationMs: DEFAULT_WINDOW_MS,
      });
      if (parsed.kind === "unparsed") {
        setNotice({ kind: "hint", text: parsed.hint });
        return;
      }
      const attempt = typedRibbonDrag(day, self, parsed.startMs, parsed.endMs);
      if (!attempt.ok) {
        setNotice({ kind: "error", text: RIBBON_COPY.typedBlocked });
        return;
      }
      const drop = dropRibbonDrag(attempt.drag, day);
      setTyped("");
      setKeyboardDrag(null);
      if (drop.effect === "noop") {
        setNotice(null);
        return;
      }
      if (needsConfirm(drop)) {
        setPending({ startsAt: drop.startsAt, endsAt: drop.endsAt, warning: drop.warning, assumptions: parsed.assumptions });
      } else {
        commitSpan(drop.startsAt, drop.endsAt, drop.warning, parsed.assumptions);
      }
    },
    [commitSpan, day, needsConfirm, pending, self, timeZone, typed, writable],
  );
  // --- the office's phase handles -------------------------------------------
  const phaseInputs = useMemo(
    () => (day === null || office === null ? [] : phaseInputsFor(phases, day.spaceId)),
    [day, office, phases],
  );
  const savedHandles = useMemo(
    () => (self === null || office === null ? null : deriveRibbonHandles({ startMs: self.startMs, endMs: self.endMs }, phaseInputs)),
    [office, phaseInputs, self],
  );
  const handles = handleDraft ?? savedHandles;
  const setHandleDraftBoth = useCallback((next: RibbonHandles | null) => {
    handleDraftRef.current = next;
    setHandleDraft(next);
  }, []);
  const saveHandles = useCallback(
    (next: RibbonHandles) => {
      if (day === null || office === null) return;
      const writes = ribbonPhaseWrites(next, phaseInputs);
      setHandleDraftBoth(null);
      if (writes.length === 0) return;
      setSavingHandles(true);
      void applyRibbonPhaseWrites(office.eventId, day.spaceId, writes, phases)
        .then((saved) => {
          setPhases(saved);
          setNotice({ kind: "hint", text: RIBBON_COPY.handleSaved });
        })
        .catch(() => { setNotice({ kind: "error", text: RIBBON_COPY.handleFailed }); })
        .finally(() => { setSavingHandles(false); });
    },
    [day, office, phaseInputs, phases, setHandleDraftBoth],
  );
  const beginHandleDrag = useCallback(
    (handle: RibbonHandle) =>
      (event: React.PointerEvent<HTMLElement>) => {
        if (!writable || handles === null || pending !== null) return;
        if (sessionRef.current !== null || handleSessionRef.current !== null) return;
        event.preventDefault();
        event.stopPropagation();
        handleSessionRef.current = { pointerId: event.pointerId, startClientX: event.clientX, handle, origin: handles };
        const captureTarget = event.currentTarget;
        if (typeof captureTarget.setPointerCapture === "function") {
          captureTarget.setPointerCapture(event.pointerId);
        }
        setHandleDraftBoth(handles);
      },
    [handles, pending, setHandleDraftBoth, writable],
  );
  const onHandlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const session = handleSessionRef.current;
      if (session === null || event.pointerId !== session.pointerId) return;
      const deltaMs = ((event.clientX - session.startClientX) / pxPerHour) * HOUR_MS;
      const previous = handleDraftRef.current ?? session.origin;
      const next = moveRibbonHandle(session.origin, session.handle, handleValue(session.origin, session.handle) + deltaMs, { fine: event.shiftKey });
      if (handleValue(next, session.handle) !== handleValue(previous, session.handle)) tick();
      setHandleDraftBoth(next);
    },
    [pxPerHour, setHandleDraftBoth, tick],
  );
  const onHandlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const session = handleSessionRef.current;
      if (session === null || event.pointerId !== session.pointerId) return;
      handleSessionRef.current = null;
      const draft = handleDraftRef.current;
      if (draft !== null) saveHandles(draft);
      event.stopPropagation();
    },
    [saveHandles],
  );
  const onHandlePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const session = handleSessionRef.current;
      if (session === null || event.pointerId !== session.pointerId) return;
      handleSessionRef.current = null;
      setHandleDraftBoth(null);
    },
    [setHandleDraftBoth],
  );
  const onHandleKeyDown = useCallback(
    (handle: RibbonHandle) =>
      (event: React.KeyboardEvent<HTMLElement>) => {
        if (!writable || handles === null || pending !== null) return;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          event.stopPropagation();
          const stepMs = (event.shiftKey ? 1 : 15) * MINUTE_MS;
          const direction = event.key === "ArrowRight" ? 1 : -1;
          const next = moveRibbonHandle(handles, handle, handleValue(handles, handle) + direction * stepMs, { fine: event.shiftKey });
          if (handleValue(next, handle) !== handleValue(handles, handle)) tick();
          setHandleDraftBoth(next);
          setAnnouncement(`${handleLabel(handle)} ${formatWallTime(handleValue(next, handle), timeZone)}`);
          return;
        }
        if (event.key === "Enter" && handleDraft !== null) {
          event.preventDefault();
          event.stopPropagation();
          saveHandles(handleDraft);
          return;
        }
        if (event.key === "Escape" && handleDraft !== null) {
          event.preventDefault();
          event.stopPropagation();
          setHandleDraftBoth(null);
          setAnnouncement("");
        }
      },
    [handleDraft, handles, pending, saveHandles, setHandleDraftBoth, tick, timeZone, writable],
  );
  const shownStartMs = self === null
    ? 0
    : pending !== null
      ? Date.parse(pending.startsAt)
      : keyboardDrag?.proposedStartMs ?? (drag !== null && drag.mode !== "move" ? drag.proposedStartMs : self.startMs);
  const shownEndMs = self === null
    ? 0
    : pending !== null
      ? Date.parse(pending.endsAt)
      : keyboardDrag?.proposedEndMs ?? (drag !== null && drag.mode !== "move" ? drag.proposedEndMs : self.endMs);
  // --- the price line (office): the venue's own estimate, once the window
  //     has rested a moment ---------------------------------------------------
  const hasSelf = self !== null;
  const venueId = office?.venueId ?? null;
  const guestCount = office?.guestCount ?? null;
  const spaceId = day?.spaceId ?? null;
  useEffect(() => {
    if (venueId === null || spaceId === null || !hasSelf) {
      setPrice({ kind: "idle" });
      return;
    }
    const window = priceWindowFor(spaceId, shownStartMs, shownEndMs, timeZone, guestCount);
    if (window.kind === "none") {
      setPrice({ kind: "idle" });
      return;
    }
    if (window.kind === "crosses-midnight") {
      setPrice({ kind: "note", text: RIBBON_COPY.priceSameDayOnly });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setPrice({ kind: "working" });
      estimatePrice(venueId, window.input)
        .then((estimate) => {
          if (cancelled) return;
          // No line at all means the venue's sheet has no slot holding this
          // window (0089): say so rather than show a nought.
          setPrice(estimate.lineItems.length === 0
            ? { kind: "note", text: RIBBON_COPY.priceNoSlot }
            : { kind: "ready", text: RIBBON_COPY.priceLine(formatPrice(estimate.total, estimate.currency)) });
        })
        .catch(() => {
          // The ribbon is not the place to debug the price book: no line, no fuss.
          if (!cancelled) setPrice({ kind: "idle" });
        });
    }, PRICE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [guestCount, hasSelf, shownEndMs, shownStartMs, spaceId, timeZone, venueId]);

  if (day === null) {
    return (
      <aside className="when-ribbon" data-testid="when-ribbon" data-variant={variant.kind} aria-label="When">
        <div className="when-ribbon__row">
          <span className="when-ribbon__eyebrow">{RIBBON_COPY.heading}</span>
          {calendarStatus === "loading" || calendarRefreshing ? (
            <ActivityStatus>{office !== null ? "Loading event times…" : RIBBON_COPY.roomDayLoading}</ActivityStatus>
          ) : calendarStatus === "error" ? (
            <span className="when-ribbon__note" role="note">
              {office !== null ? RIBBON_COPY.loadFailed : RIBBON_COPY.roomDayFailed}{" "}
              <button type="button" className="when-ribbon__link" onClick={refetch}>
                {RIBBON_COPY.tryAgain}
              </button>
            </span>
          ) : office !== null ? (
            <span className="when-ribbon__note" role="note">
              {RIBBON_COPY.notInDiary}{" "}
              <a className="when-ribbon__link" href="/diary?view=day">
                {RIBBON_COPY.openDiary}
              </a>
            </span>
          ) : null}
        </div>
      </aside>
    );
  }
  if (self === null) return null;
  const active = drag ?? keyboardDrag;
  const ticks = hourTicks(day.range, timeZone).filter((_, index) => index % 3 === 0);
  const nowMs = Date.now();
  const showNow = nowMs >= day.range.fromMs && nowMs < day.range.toMs;
  const shadowDrag =
    drag !== null &&
    drag.mode === "move" &&
    (drag.proposedStartMs !== drag.originStartMs || drag.proposedEndMs !== drag.originEndMs)
      ? drag
      : null;
  const isDraft = self.id === CLIENT_DRAFT_SLOT_ID;
  const readOnlyText = office !== null ? RIBBON_COPY.readOnly : RIBBON_COPY.clientConfirmedNote;
  const hintText = !writable
    ? readOnlyText
    : office !== null
      ? RIBBON_COPY.dragHint
      : isDraft
        ? RIBBON_COPY.clientDraftNote
        : RIBBON_COPY.clientHint;
  const confirmCopy = variant.kind === "client"
    ? { question: RIBBON_COPY.proposeConfirm, yes: RIBBON_COPY.proposeYes, no: RIBBON_COPY.proposeNo }
    : { question: RIBBON_COPY.inkConfirm, yes: RIBBON_COPY.inkConfirmYes, no: RIBBON_COPY.inkConfirmNo };
  const showGrips = office !== null && writable && handles !== null && drag === null && keyboardDrag === null && pending === null;
  const canConfirmHold = office !== null && writable && self.kind === "hold" && !isDraft && pending === null && !confirming;
  const pendingRange = pending === null ? "" : rangeLabel(Date.parse(pending.startsAt), Date.parse(pending.endsAt), timeZone);
  return (
    <aside className="when-ribbon" data-testid="when-ribbon" data-variant={variant.kind} aria-label="When">
      <div className="when-ribbon__row">
        <span className="when-ribbon__eyebrow">{RIBBON_COPY.heading}</span>
        <span className="when-ribbon__day">{formatWallDay(day.range.fromMs, timeZone)}</span>
        {variant.kind === "client" && !isDraft && self.kind === "hold" ? (
          <span className="when-ribbon__state" data-testid="when-ribbon-state">{RIBBON_COPY.clientWaitingNote}</span>
        ) : null}
        {pendingRequests > 0
          ? <ActivityStatus>Saving event times…</ActivityStatus>
          : calendarRefreshing ? <ActivityStatus>Refreshing event times…</ActivityStatus> : null}
        <span className="when-ribbon__note">{hintText}</span>
        {writable ? (
          <form className="when-ribbon__entry" onSubmit={submitTyped}>
            <input
              className="when-ribbon__input"
              type="text"
              data-testid="when-ribbon-entry"
              aria-label={RIBBON_COPY.typedLabel}
              placeholder={RIBBON_COPY.typedPlaceholder}
              value={typed}
              disabled={pending !== null}
              onChange={(event) => { setTyped(event.target.value); }}
            />
            <button type="submit" className="when-ribbon__button" disabled={pending !== null || typed.trim() === ""}>
              {RIBBON_COPY.typedSet}
            </button>
          </form>
        ) : null}
      </div>
      <div className="when-ribbon__strip" ref={stripRef} data-testid="when-ribbon-strip">
        {ticks.map((tick) => (
          <span key={tick.ms} className="when-ribbon__tick" style={{ left: `${String(msToX(tick.ms, day.range, pxPerHour))}px` }}>
            {tick.label}
          </span>
        ))}
        {showNow ? (
          <span className="when-ribbon__now" style={{ left: `${String(msToX(nowMs, day.range, pxPerHour))}px` }} aria-hidden="true" />
        ) : null}
        {day.buffers.map((buffer) => (
          <span
            key={`${buffer.ghostId}:${buffer.side}`}
            className="when-ribbon__buffer"
            data-testid="when-ribbon-buffer"
            title={RIBBON_COPY.bufferWarning(buffer.minutes, buffer.ruleName)}
            style={{
              left: `${String(msToX(Math.max(buffer.startMs, day.range.fromMs), day.range, pxPerHour))}px`,
              width: `${String(widthPx(Math.max(buffer.startMs, day.range.fromMs), Math.min(buffer.endMs, day.range.toMs), pxPerHour))}px`,
            }}
          />
        ))}
        {day.ghosts.map((ghost) => (
          <span
            key={ghost.id}
            className={`when-ribbon__ghost when-ribbon__ghost--${ghost.kind}`}
            data-testid="when-ribbon-ghost"
            title={`${ghost.title} · ${rangeLabel(ghost.startMs, ghost.endMs, timeZone)}`}
            style={{
              left: `${String(msToX(Math.max(ghost.occStartMs, day.range.fromMs), day.range, pxPerHour))}px`,
              width: `${String(widthPx(Math.max(ghost.occStartMs, day.range.fromMs), Math.min(ghost.occEndMs, day.range.toMs), pxPerHour))}px`,
            }}
          >
            {ghost.title}
          </span>
        ))}
        {shadowDrag !== null ? (
          <span
            className="when-ribbon__shadow"
            data-testid="when-ribbon-shadow"
            style={{
              left: `${String(msToX(shadowDrag.proposedStartMs, day.range, pxPerHour))}px`,
              width: `${String(widthPx(shadowDrag.proposedStartMs, shadowDrag.proposedEndMs, pxPerHour))}px`,
            }}
            aria-hidden="true"
          />
        ) : null}
        <div
          ref={ingotRef}
          className={`when-ribbon__ingot${writable ? "" : " is-readonly"}${active !== null ? " is-active" : ""}${isDraft ? " is-draft" : ""}`}
          data-testid="when-ribbon-ingot"
          role={writable ? "button" : undefined}
          tabIndex={writable ? 0 : undefined}
          aria-label={`${self.title}, ${rangeLabel(shownStartMs, shownEndMs, timeZone)}. ${writable ? RIBBON_COPY.keyboardHint : readOnlyText}`}
          style={{
            left: `${String(msToX(shownStartMs, day.range, pxPerHour))}px`,
            width: `${String(widthPx(shownStartMs, shownEndMs, pxPerHour))}px`,
          }}
          onPointerDown={beginPointerDrag("move")}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onKeyDown={onIngotKeyDown}
        >
          {writable ? (
            <span
              className="when-ribbon__handle when-ribbon__handle--start"
              data-testid="when-ribbon-handle-start"
              onPointerDown={beginPointerDrag("resize-start")}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              aria-hidden="true"
            />
          ) : null}
          <span className="when-ribbon__ingot-title">{self.title}</span>
          <span className="when-ribbon__ingot-time">
            {rangeLabel(drag?.proposedStartMs ?? shownStartMs, drag?.proposedEndMs ?? shownEndMs, timeZone)}
          </span>
          {writable ? (
            <span
              className="when-ribbon__handle when-ribbon__handle--end"
              data-testid="when-ribbon-handle-end"
              onPointerDown={beginPointerDrag("resize-end")}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              aria-hidden="true"
            />
          ) : null}
          {showGrips ? INNER_HANDLES.map((handle) => {
            const ms = handleValue(handles, handle);
            const label = handleLabel(handle);
            return (
              <span
                key={handle}
                role="slider"
                tabIndex={0}
                className={`when-ribbon__grip when-ribbon__grip--${handle}`}
                data-testid={`when-ribbon-grip-${handle}`}
                aria-label={label}
                aria-valuemin={handles.setupStartMs}
                aria-valuemax={handles.endMs}
                aria-valuenow={ms}
                aria-valuetext={`${label} ${formatWallTime(ms, timeZone)}`}
                title={`${label} · ${formatWallTime(ms, timeZone)}`}
                style={{ left: `${String(widthPx(shownStartMs, ms, pxPerHour))}px` }}
                onPointerDown={beginHandleDrag(handle)}
                onPointerMove={onHandlePointerMove}
                onPointerUp={onHandlePointerUp}
                onPointerCancel={onHandlePointerCancel}
                onKeyDown={onHandleKeyDown(handle)}
              />
            );
          }) : null}
        </div>
      </div>
      <div className="when-ribbon__foot">
        <span className="when-ribbon__disclosure">{RIBBON_COPY.disclosure}</span>
        {office !== null && writable && handles !== null ? (
          <span className="when-ribbon__legend" data-testid="when-ribbon-legend" title={RIBBON_COPY.handleHint}>
            {handleLegend(handles, timeZone)}
          </span>
        ) : null}
        {savingHandles ? <ActivityStatus>Saving phases…</ActivityStatus> : null}
        {price.kind === "working" ? (
          <ActivityStatus>Working out the price…</ActivityStatus>
        ) : price.kind === "ready" || price.kind === "note" ? (
          <span className={`when-ribbon__price${price.kind === "note" ? " when-ribbon__price--note" : ""}`} data-testid="when-ribbon-price">
            {price.text}
          </span>
        ) : null}
        {pending !== null ? (
          <span
            className="when-ribbon__confirm"
            data-testid="when-ribbon-confirm"
            role="alertdialog"
            aria-label={confirmCopy.question(pendingRange)}
          >
            {confirmCopy.question(pendingRange)}
            {pending.assumptions.length > 0 ? (
              <span className="when-ribbon__confirm-note" data-testid="when-ribbon-assumptions">{pending.assumptions.join(" · ")}</span>
            ) : null}
            {pending.warning !== null ? (
              <span className="when-ribbon__confirm-warning">{pending.warning}</span>
            ) : null}
            <button
              type="button"
              className="when-ribbon__button when-ribbon__button--primary"
              onClick={() => { commitSpan(pending.startsAt, pending.endsAt, pending.warning, pending.assumptions); }}
            >
              {confirmCopy.yes}
            </button>
            <button
              type="button"
              className="when-ribbon__button"
              onClick={() => {
                setPending(null);
                animateOffsetTo(0, INGOT_SETTLE);
              }}
            >
              {confirmCopy.no}
            </button>
          </span>
        ) : null}
        {confirming && pending === null ? (
          <span
            className="when-ribbon__confirm"
            data-testid="when-ribbon-confirm-time"
            role="alertdialog"
            aria-label={RIBBON_COPY.confirmQuestion(rangeLabel(self.startMs, self.endMs, timeZone), self.title)}
          >
            {RIBBON_COPY.confirmQuestion(rangeLabel(self.startMs, self.endMs, timeZone), self.title)}
            <button type="button" className="when-ribbon__button when-ribbon__button--primary" onClick={confirmHold}>
              {RIBBON_COPY.confirmYes}
            </button>
            <button type="button" className="when-ribbon__button" onClick={() => { setConfirming(false); }}>
              {RIBBON_COPY.confirmNo}
            </button>
          </span>
        ) : null}
        {notice !== null && pending === null ? (
          <span
            className={`when-ribbon__notice when-ribbon__notice--${notice.kind}`}
            role={notice.kind === "error" ? "alert" : "status"}
          >
            {notice.text}
            {notice.kind === "moved" && undoable !== null ? (
              <button type="button" className="when-ribbon__button" onClick={undoMove}>
                {RIBBON_COPY.undo}
              </button>
            ) : null}
          </span>
        ) : null}
        {canConfirmHold ? (
          <button
            type="button"
            className="when-ribbon__button when-ribbon__button--primary"
            data-testid="when-ribbon-confirm-hold"
            onClick={() => { setConfirming(true); }}
          >
            {RIBBON_COPY.confirmTime}
          </button>
        ) : null}
        {writable ? (
          <button
            type="button"
            className="when-ribbon__toggle"
            data-testid="when-ribbon-tick"
            aria-pressed={tickOn}
            title={RIBBON_COPY.tickHint}
            onClick={toggleTick}
          >
            {tickOn ? RIBBON_COPY.tickOn : RIBBON_COPY.tickOff}
          </button>
        ) : null}
      </div>
      <span className="when-ribbon__sr" aria-live="polite">{announcement}</span>
    </aside>
  );
}

export default WhenRibbon;
