import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { isBookingEnquiry } from "@omnitwin/types";
import type {
  CalendarBookingEntry,
  CalendarEntry,
  ConflictSeverity,
} from "@omnitwin/types";
import { useAuthStore } from "../../stores/auth-store.js";
import { DIARY_WRITE_ROLES, VENUE_ADMIN_ROLES, hasRole } from "../../lib/role-capabilities.js";
import { ApiError } from "../../api/client.js";
import { moveBooking } from "../../api/diary.js";
import { BOARD_COPY } from "./board-copy.js";
import {
  dayColumns,
  snapMs,
  boardRange,
  formatInlineDay,
  formatWallTime,
  rangeTitle,
  shiftRange,
  msToWallInput,
  type BoardView,
} from "./lib/board-time.js";
import { filterBoardEntries, needsAction, type LaneGap } from "./lib/board-layout.js";
import { bookingTimeLabel } from "./lib/board-overview.js";
import { contestedHolds } from "./lib/lifecycle-ending.js";
import { ladderPlace } from "./lib/ladder-place.js";
import { parseGoToDate, roomsOnDay, saidWeekday } from "./lib/go-to-date.js";
import type { CommitPayload, InkSpan } from "./lib/board-drag.js";
import {
  popMove,
  pushMove,
  rollbackOverride,
  type MoveSnapshot,
  type UndoEntry,
} from "./lib/undo-stack.js";
import type { DrawerMode } from "./lib/drawer-form.js";
import { markWelcomeSeen, shouldShowWelcome } from "./lib/welcome.js";
import { holdScrollWhileLifted, keepTouchesHoldable, type ScrollHold } from "./lib/touch-scroll.js";
import { useCalendar } from "./hooks/useCalendar.js";
import { useBoardDrag } from "./hooks/useBoardDrag.js";
import { useDiaryLive } from "./hooks/useDiaryLive.js";
import { listEnquiries, type Enquiry } from "../../api/enquiries.js";
import { BoardGrid, type BoardCreate, type OpenGap } from "./components/BoardGrid.js";
import { GapSheet } from "./components/GapSheet.js";
import { BoardOverview } from "./components/BoardOverview.js";
import { ActivityStatus } from "../../components/shared/Activity.js";
import { BookingDrawer } from "./components/BookingDrawer.js";
import { WelcomePanel } from "./components/WelcomePanel.js";
import { ViewMenu } from "./components/ViewMenu.js";
import {
  type TrayEnquiry, ConflictRail, DecisionsDuePanel, HoldingTray, InkConfirm, UndoToast } from "./components/BoardPanels.js";
import { BoardPalette, type PaletteResult } from "./components/BoardPalette.js";
import { EnquiryDragGhost } from "./components/EnquiryDragGhost.js";
import { DashboardLayout } from "../../components/dashboard/DashboardLayout.js";
import "./diary-board.css";

// ---------------------------------------------------------------------------
// The Diary Board (T-493; Canon §8/§9/§12/§18) — the multi-room timeline over
// GET /calendar. Lanes, day/week/fortnight zoom, venue-local now-line, pointer
// + keyboard drag with a live-conflict ghost, ink-move confirmation, undo, the
// venue-wide decisions list, the conflict rail with honest checks, and the
// needs-attention tray.
//
// DIARY_WRITE_ROLES create and move bookings; the hallkeeper reads (the API
// enforces the same split server-side). URL carries ?view=&date= so board
// positions deep-link.
// ---------------------------------------------------------------------------

const PX_PER_HOUR: Record<BoardView, number> = { day: 96, week: 18, "2w": 9 };
// The reference sheet's three zooms — the toolbar's, and now the URL's. The
// month board is retired (T-619).
const VIEWS: readonly BoardView[] = ["day", "week", "2w"];
/** Each zoom's key, printed in its tooltip. */
const VIEW_KEYS: Readonly<Record<BoardView, string>> = { day: "D", week: "W", "2w": "F" };
const TOAST_MS = 7_000;
const NOW_TICK_MS = 60_000;
/** How long a finger rests on a slip before it lifts rather than scrolls —
 *  the same rule as a block's lift in useBoardDrag. */
const LONG_PRESS_MS = 400;
/** Travel that proves a ripening press was a scroll after all. */
const LONG_PRESS_SLOP_PX = 8;
const SEVERITY_RANK: Record<ConflictSeverity, number> = { blocking: 3, warning: 2, info: 1 };
// The tray asks for exactly the states it can pencil in, newest first, for
// this board's venue. One row beyond the limit only reveals that more exist.
const TRAY_ENQUIRY_STATES: readonly string[] = ["submitted", "under_review"];
const TRAY_ENQUIRY_LIMIT = 50;

function isBoardView(value: string | null): value is BoardView {
  return value === "day" || value === "week" || value === "2w";
}

/** The retired month board's deep links (`?view=month`) still sit in
 *  bookmarks and older emails. They land on the week their date falls in —
 *  a real range, not an error and not a URL that disagrees with the board. */
function viewFromParam(value: string | null): BoardView {
  if (isBoardView(value)) return value;
  return "week";
}

function anchorFromParam(dateParam: string | null): number {
  if (dateParam !== null) {
    const parsed = Date.parse(`${dateParam}T12:00:00.000Z`);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

interface ToastState {
  readonly key: number;
  readonly message: string;
  readonly showUndo: boolean;
}

interface GoToState {
  readonly open: boolean;
  readonly text: string;
  /** The venue-local date the words named, "YYYY-MM-DD". */
  readonly sought: string | null;
  readonly unread: boolean;
  /** Weekdays as getUTCDay numbers: the one said, and the date's own. */
  readonly otherWeekday: { readonly said: number; readonly actual: number } | null;
}

const GO_TO_CLOSED: GoToState = { open: false, text: "", sought: null, unread: false, otherWeekday: null };

export function DiaryBoardPage(): ReactElement {
  const user = useAuthStore((state) => state.user);
  const venueId = user?.venueId ?? null;
  const writable = hasRole(DIARY_WRITE_ROLES, user?.role);
  // Changeover times are the venue's administration (T-637): sales and the
  // hallkeeper read them from a gap, and these roles change them.
  const canEditChangeovers = hasRole(VENUE_ADMIN_ROLES, user?.role);

  const [searchParams, setSearchParams] = useSearchParams();
  const viewParam = searchParams.get("view");
  const view: BoardView = viewFromParam(viewParam);
  const anchorMs = anchorFromParam(searchParams.get("date"));
  // A range depends only on the anchor's venue-local date. Without ?date=
  // (the nav's plain /diary link) the anchor is Date.now(), a new instant
  // every render, so the memo keys on that date rather than on anchorMs: one
  // range object — and memoised boards beneath it — until the venue day
  // actually changes.
  const anchorDate = msToWallInput(anchorMs).slice(0, 10);
  const range = useMemo(() => boardRange(anchorMs, view), [anchorDate, view]);

  // Later first: the way a booker usually steps.
  const neighbours = useMemo(() => [shiftRange(range, 1), shiftRange(range, -1)], [range]);
  const { data, frame, status, error, refetch, isRefreshing, refreshFailedAtMs, readAtMs } = useCalendar(venueId, range, neighbours);
  // What the board stands on: this range's read, or while it is on its way,
  // the venue's rooms, rules and decisions from the last range read. Only
  // `data` speaks for this range's bookings and conflicts.
  const shown = data ?? frame;
  const rangePending = data === null && frame !== null && status === "loading";
  const rangeFailed = data === null && frame !== null && status === "error";
  const [timeline, setTimeline] = useState(false);
  const showingOverview = view !== "day" && !timeline;

  const [showExited, setShowExited] = useState(false);
  const [overrides, setOverrides] = useState<ReadonlyMap<string, MoveSnapshot>>(new Map());
  const [pendingMoves, setPendingMoves] = useState(0);
  const [undoStack, setUndoStack] = useState<readonly UndoEntry[]>([]);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // The nonce keys <BookingDrawer> so retargeting (edit A → New → edit B)
  // always remounts with a fresh form — useState initialisers run once per
  // mount, never per prop change (review P1).
  const [drawer, setDrawer] = useState<{ mode: DrawerMode; nonce: number } | null>(null);
  const drawerNonceRef = useRef(0);
  /** Where focus goes back to when the drawer closes and no board block can
   *  take it — a booking opened from the decisions list may sit in a week the
   *  board is not showing. */
  const drawerReturnFocusRef = useRef<HTMLElement | null>(null);
  // The changeover sheet for one gap (T-637). It and the booking drawer
  // share the right-hand edge, so opening either closes the other.
  const [gapSheet, setGapSheet] = useState<{ readonly room: { readonly id: string; readonly name: string }; readonly gap: LaneGap } | null>(null);
  const gapReturnFocusRef = useRef<HTMLElement | null>(null);
  const openDrawer = useCallback((mode: DrawerMode) => {
    drawerNonceRef.current += 1;
    if (document.activeElement instanceof HTMLElement) drawerReturnFocusRef.current = document.activeElement;
    setGapSheet(null);
    setDrawer({ mode, nonce: drawerNonceRef.current });
  }, []);
  const openGap = useCallback<OpenGap>((room, gap, opener) => {
    gapReturnFocusRef.current = opener;
    setDrawer(null);
    setGapSheet({ room, gap });
  }, []);
  const closeGap = useCallback(() => {
    const opener = gapReturnFocusRef.current;
    setGapSheet(null);
    requestAnimationFrame(() => {
      if (opener !== null && opener.isConnected) opener.focus({ preventScroll: true });
    });
  }, []);
  const [enquiryState, setEnquiryState] = useState<{
    readonly venueId: string | null;
    readonly rows: readonly Enquiry[];
    readonly more: boolean;
    readonly status: "loading" | "ready" | "error";
    readonly error: string | null;
  }>({ venueId, rows: [], more: false, status: "loading", error: null });
  const [enquiryRetry, setEnquiryRetry] = useState(0);
  const openEnquiries = enquiryState.venueId === venueId ? enquiryState.rows : [];
  const moreEnquiries = enquiryState.venueId === venueId && enquiryState.more;
  const enquiriesLoading = enquiryState.venueId !== venueId || enquiryState.status === "loading";
  const enquiryError = enquiryState.venueId === venueId ? enquiryState.error : null;

  // First-run welcome (T-520): greet each coordinator once per device; the
  // header's "How the Diary works" button re-opens it any time.
  //
  // Review hardening: the effect keys on the stable user ID (the auth store
  // replaces the user OBJECT on every Clerk sync), and a per-mount ref
  // remembers an in-session dismissal — so even when localStorage writes are
  // denied (kiosks, private browsing), auth churn can never pop the panel
  // back over an in-progress board. Degraded persistence then means
  // "greets again next visit", exactly as documented in lib/welcome.ts.
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const welcomeDismissedForRef = useRef<string | null>(null);
  const userId = user?.id ?? null;
  useEffect(() => {
    if (userId === null || venueId === null) return;
    if (welcomeDismissedForRef.current === userId) return;
    if (shouldShowWelcome(userId)) setWelcomeOpen(true);
  }, [userId, venueId]);
  const dismissWelcome = useCallback(() => {
    if (userId !== null) {
      welcomeDismissedForRef.current = userId;
      markWelcomeSeen(userId);
    }
    setWelcomeOpen(false);
  }, [userId]);

  // A colleague's change can be an enquiry turned into a booking, so a live
  // event reloads the tray along with the board (T-619).
  const onLiveChange = useCallback(() => {
    refetch();
    setEnquiryRetry((value) => value + 1);
  }, [refetch]);
  const live = useDiaryLive(venueId !== null, onLiveChange);
  /** Presence minus yourself: "who else is on this board right now". */
  const othersPresent = useMemo(
    () => live.presence.filter((person) => person.userId !== userId),
    [live.presence, userId],
  );

  // The tray reloads when the venue changes or something can actually have
  // changed an enquiry — Refresh, a drawer save, a colleague's live change
  // (the `enquiryRetry` counter). Not on `data`, which changes on every pan,
  // zoom and refetch: panning a week used to re-read the whole list (T-619).
  useEffect(() => {
    if (venueId === null) return;
    // Aborted on a venue switch, a newer refresh or unmount, so an older
    // response can never land in the tray.
    const controller = new AbortController();
    setEnquiryState((previous) => {
      const sameVenue = previous.venueId === venueId;
      return { venueId, rows: sameVenue ? previous.rows : [], more: sameVenue && previous.more,
        status: "loading", error: null };
    });
    listEnquiries({ states: TRAY_ENQUIRY_STATES, order: "created_desc", venueId, limit: TRAY_ENQUIRY_LIMIT + 1 },
      controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        // The server already filters by state; this also covers an API that
        // predates the `states` parameter. An access request or Venviewer
        // enquiry asks for no room, so there is nothing to place on a day.
        const open = page.filter((enquiry) => TRAY_ENQUIRY_STATES.includes(enquiry.state)
          && isBookingEnquiry(enquiry.eventType));
        setEnquiryState({ venueId, status: "ready", error: null,
          rows: open.slice(0, TRAY_ENQUIRY_LIMIT), more: page.length > TRAY_ENQUIRY_LIMIT });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setEnquiryState((previous) => ({ ...previous, status: "error",
          error: "Enquiries could not be refreshed. Any previously loaded enquiries remain visible." }));
      });
    return () => {
      controller.abort();
    };
  }, [venueId, enquiryRetry]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, NOW_TICK_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  // Server truth arrived — optimistic overrides have served their purpose.
  // Keep the same empty Map when there is nothing to clear: a fresh one would
  // rebuild `entries` (and re-render the board) a second time per refetch.
  useEffect(() => {
    setOverrides((previous) => (previous.size === 0 ? previous : new Map()));
  }, [data]);

  useEffect(() => {
    if (toast === null) return;
    const timer = window.setTimeout(() => {
      setToast(null);
    }, TOAST_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [toast]);

  const setRange = useCallback(
    (nextView: BoardView, nextAnchorMs: number) => {
      const date = msToWallInput(nextAnchorMs).slice(0, 10);
      setSearchParams({ view: nextView, date }, { replace: true });
    },
    [setSearchParams],
  );

  const entries: readonly CalendarEntry[] = useMemo(() => {
    const raw = data?.entries ?? [];
    const withOverrides = raw.map((entry) => {
      if (entry.entryType !== "booking") return entry;
      const override = overrides.get(entry.id);
      return override === undefined ? entry : { ...entry, ...override };
    });
    return filterBoardEntries(withOverrides, { showExited });
  }, [data, overrides, showExited]);

  const bookingById = useMemo(() => {
    const map = new Map<string, CalendarBookingEntry>();
    for (const entry of entries) {
      if (entry.entryType === "booking") map.set(entry.id, entry);
    }
    return map;
  }, [entries]);

  const rooms = shown?.rooms ?? [];
  const laneOrder = useMemo(() => rooms.map((room) => room.id), [rooms]);

  const inksByLane = useMemo(() => {
    const map = new Map<string, InkSpan[]>();
    for (const entry of entries) {
      if (entry.entryType !== "booking") continue;
      if (entry.kind !== "ink" || entry.status !== "active") continue;
      const spans = map.get(entry.spaceId) ?? [];
      spans.push({
        id: entry.id,
        startMs: Date.parse(entry.startsAt),
        endMs: Date.parse(entry.endsAt),
        title: entry.title,
      });
      map.set(entry.spaceId, spans);
    }
    return map;
  }, [entries]);

  const conflictSeverity = useMemo(() => {
    const map = new Map<string, ConflictSeverity>();
    for (const conflict of data?.conflicts.conflicts ?? []) {
      for (const entryId of conflict.entryIds) {
        const existing = map.get(entryId);
        if (existing === undefined || SEVERITY_RANK[conflict.severity] > SEVERITY_RANK[existing]) {
          map.set(entryId, conflict.severity);
        }
      }
    }
    return map;
  }, [data]);

  // With the venue-wide decisions list on the board, a passed decision date
  // is its to show; an older API that sends no list keeps it here.
  const decisionsListed = shown?.decisionsDue !== undefined;
  // The same for next actions (roadmap N3): the venue-wide list carries them.
  const nextActionsListed = shown?.nextActionsDue !== undefined;
  const trayItems = useMemo(
    () => needsAction(entries, nowMs, { decisions: !decisionsListed, nextActions: !nextActionsListed }),
    [decisionsListed, entries, nextActionsListed, nowMs],
  );

  // The holds crossing the booking open in the drawer, so ending it can say
  // who stands first after. The board has read them when the booking lies
  // inside the range on screen; one opened from the decisions list in
  // another week may have holds the board has not read.
  const drawerBooking = drawer !== null && drawer.mode.kind === "edit" ? drawer.mode.booking : null;
  const drawerContested = useMemo(
    () => (drawerBooking === null ? [] : contestedHolds(entries, drawerBooking)),
    [drawerBooking, entries],
  );
  const drawerLadderRead = drawerBooking !== null && data !== null
    && Date.parse(drawerBooking.startsAt) >= range.fromMs && Date.parse(drawerBooking.endsAt) <= range.toMs;

  // Where a new hold would stand on its ladder (roadmap N3), read only from
  // a range the board has read whole: while one is on its way, nothing is
  // suggested it cannot vouch for.
  const placeOnLadder = useCallback(
    (spaceId: string, startMs: number, endMs: number) =>
      ladderPlace(data?.entries ?? [], data === null ? null : range, spaceId, startMs, endMs),
    [data, range],
  );

  // Go to date (roadmap N3): the words typed, the day they named, whether
  // they could be read, and a weekday said with them that the date does not
  // fall on. The answer comes from the range's own read.
  const [goTo, setGoTo] = useState<GoToState>(GO_TO_CLOSED);
  const goToInputRef = useRef<HTMLInputElement | null>(null);
  const goToButtonRef = useRef<HTMLButtonElement | null>(null);
  const goToHintId = useId();
  // Where focus returns when Go to date closes: the enquiry slip's date it
  // was opened from, else the toolbar's button.
  const goToReturnRef = useRef<HTMLElement | null>(null);
  const openGoTo = useCallback(() => {
    goToReturnRef.current = null;
    setGoTo((previous) => ({ ...previous, open: true }));
    requestAnimationFrame(() => { goToInputRef.current?.focus(); goToInputRef.current?.select(); });
  }, []);
  const closeGoTo = useCallback(() => {
    const opener = goToReturnRef.current;
    goToReturnRef.current = null;
    setGoTo(GO_TO_CLOSED);
    requestAnimationFrame(() => {
      if (opener !== null && opener.isConnected) opener.focus();
      else goToButtonRef.current?.focus();
    });
  }, []);
  const soughtDay = useMemo(
    () => (goTo.sought === null ? null : boardRange(Date.parse(`${goTo.sought}T12:00:00.000Z`), "day")),
    [goTo.sought],
  );
  const soughtAnswer = useMemo(() => {
    if (soughtDay === null || data === null || soughtDay.fromMs < range.fromMs || soughtDay.toMs > range.toMs) return null;
    const line = (entry: CalendarBookingEntry): string => {
      const time = bookingTimeLabel(entry);
      if (entry.kind === "ink") return BOARD_COPY.goTo.confirmed(entry.title, time);
      if (entry.kind === "internal_block") return BOARD_COPY.goTo.block(entry.title, time);
      const decides = entry.decisionAt === null ? null : formatInlineDay(Date.parse(entry.decisionAt), nowMs);
      return BOARD_COPY.goTo.hold(entry.rank, entry.jointFlag, entry.title, time, decides);
    };
    return {
      day: rangeTitle(soughtDay),
      rooms: roomsOnDay(data.entries, data.rooms, { startMs: soughtDay.fromMs, endMs: soughtDay.toMs }).map((answer) => ({
        id: answer.roomId,
        name: answer.room,
        lines: answer.bookings.length > 0
          ? answer.bookings.map((entry) => ({ key: entry.id, text: line(entry) }))
          : [{ key: "free", text: BOARD_COPY.goTo.free(answer.interest, answer.freeFromMs === null ? null : formatWallTime(answer.freeFromMs)) }],
      })),
    };
  }, [data, nowMs, range.fromMs, range.toMs, soughtDay]);
  // An enquiry slip's date (roadmap N3): the board goes there and Go to date
  // answers for it, as if the booker had typed it. Focus moves to the field,
  // which brings the answer into view, and returns to the slip on closing.
  const showDateOnBoard = useCallback((sought: string, typed: string, from: HTMLElement) => {
    goToReturnRef.current = from;
    setGoTo({ open: true, text: typed, sought, unread: false, otherWeekday: null });
    setRange(view, Date.parse(`${sought}T12:00:00.000Z`));
    requestAnimationFrame(() => { goToInputRef.current?.focus(); goToInputRef.current?.select(); });
  }, [setRange, view]);
  const goToNote = goTo.unread
    ? BOARD_COPY.goTo.notADate
    : goTo.otherWeekday === null ? null : BOARD_COPY.goTo.otherWeekday(goTo.otherWeekday.actual, goTo.otherWeekday.said);

  const applyMove = useCallback(
    (bookingId: string, patch: MoveSnapshot, undoEntry: UndoEntry | null) => {
      setPendingMoves((count) => count + 1);
      setOverrides((previous) => new Map(previous).set(bookingId, patch));
      moveBooking(bookingId, patch)
        .then(() => {
          if (undoEntry !== null) {
            setUndoStack((stack) => pushMove(stack, undoEntry));
            setToast({
              key: Date.now(),
              message: BOARD_COPY.undo.moved(undoEntry.title),
              showUndo: true,
            });
          } else {
            setToast({ key: Date.now(), message: BOARD_COPY.undo.undone, showUndo: false });
          }
          refetch();
        })
        .catch((caught: unknown) => {
          // Compare-and-delete (review P1): only roll back the override THIS
          // call wrote — a newer move on the same booking must survive.
          setOverrides((previous) => rollbackOverride(previous, bookingId, patch));
          const raced =
            caught instanceof ApiError &&
            (caught.code === "INK_SLOT_TAKEN" || caught.code === "BOOKING_STATE_CHANGED");
          setToast({
            key: Date.now(),
            message: raced ? BOARD_COPY.undo.slotTaken : BOARD_COPY.undo.failed,
            showUndo: false,
          });
          if (raced) refetch();
        })
        .finally(() => { setPendingMoves((count) => count - 1); });
    },
    [refetch],
  );

  const handleCommit = useCallback(
    (payload: CommitPayload) => {
      const entry = bookingById.get(payload.bookingId);
      if (entry === undefined) return;
      const before: MoveSnapshot = {
        spaceId: entry.spaceId,
        startsAt: entry.startsAt,
        endsAt: entry.endsAt,
      };
      const after: MoveSnapshot = {
        spaceId: payload.patch.spaceId ?? before.spaceId,
        startsAt: payload.patch.startsAt ?? before.startsAt,
        endsAt: payload.patch.endsAt ?? before.endsAt,
      };
      applyMove(payload.bookingId, after, {
        bookingId: payload.bookingId,
        title: entry.title,
        before,
        after,
        atMs: Date.now(),
      });
    },
    [applyMove, bookingById],
  );

  const handleRejected = useCallback(() => {
    setToast({ key: Date.now(), message: BOARD_COPY.drag.blockedDrop, showUndo: false });
  }, []);

  const openBlock = useCallback(
    (blockId: string) => {
      const booking = bookingById.get(blockId);
      if (booking === undefined) return;
      openDrawer({ kind: "edit", booking });
    },
    [bookingById, openDrawer],
  );

  const drag = useBoardDrag({
    laneOrder,
    inksByLane,
    pxPerHour: PX_PER_HOUR[view],
    writable,
    onCommit: handleCommit,
    onRejected: handleRejected,
    onOpenBlock: openBlock,
  });

  // Create-in-context (T-619). "New booking" used to seed the first room and
  // the range's first instant — on a week view, Monday in whichever room
  // sorts first. It now seeds the day being looked at (today when today is
  // on the board, else the range's first day); an empty overview square
  // seeds its room and day, and a point on a lane its room and time.
  const days = useMemo(() => dayColumns(range), [range]);
  const seededColumn = days.find((day) => nowMs >= day.startMs && nowMs < day.endMs) ?? days[0];
  const seededDayStartMs = seededColumn?.startMs ?? range.fromMs;
  const seededDayLabel = seededColumn?.label ?? rangeTitle(range);

  /** A DAY was chosen (the toolbar, an overview square, or the lane from
   *  the keyboard): the drawer opens on it at the house's evening window. */
  const openCreateOnDay = useCallback(
    (spaceId: string, dayStartMs: number) => {
      if (userId === null) return;
      openDrawer({ kind: "create", spaceId, dayStartMs, ownerUserId: userId });
    },
    [openDrawer, userId],
  );

  /** An INSTANT was chosen (a point on a lane): the drawer opens at exactly
   *  that time, keeping the default window's length. */
  const openCreateAt = useCallback(
    (spaceId: string, startMs: number) => {
      if (userId === null) return;
      openDrawer({ kind: "create", spaceId, dayStartMs: startMs, ownerUserId: userId, startMs });
    },
    [openDrawer, userId],
  );

  // One object per chosen day, so the memoised lanes keep equal props.
  const boardCreate = useMemo<BoardCreate | undefined>(
    () => (writable
      ? { at: openCreateAt, onDay: openCreateOnDay, day: { startMs: seededDayStartMs, label: seededDayLabel } }
      : undefined),
    [openCreateAt, openCreateOnDay, seededDayLabel, seededDayStartMs, writable],
  );

  const openCreateDrawer = useCallback(() => {
    const firstRoom = rooms[0];
    if (firstRoom === undefined) return;
    openCreateOnDay(firstRoom.id, seededDayStartMs);
  }, [openCreateOnDay, rooms, seededDayStartMs]);

  const openConvertDrawer = useCallback(
    (enquiryId: string, drop?: { readonly spaceId: string; readonly startMs: number }) => {
      const enquiry = openEnquiries.find((candidate) => candidate.id === enquiryId);
      if (enquiry === undefined || user === null) return;
      openDrawer({
        kind: "convert",
        enquiry: {
          id: enquiry.id,
          spaceId: enquiry.spaceId,
          name: enquiry.name,
          eventType: enquiry.eventType,
          preferredDate: enquiry.preferredDate,
        },
        ownerUserId: user.id,
        ...(drop === undefined ? {} : { drop }),
      });
    },
    [openDrawer, openEnquiries, user],
  );

  // --- the finding palette (C1, Ctrl/Cmd-K) -------------------------------
  // The palette owns its query and matching: typing never re-renders the page.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const closePalette = useCallback(() => {
    setPaletteOpen(false);
  }, []);

  // --- the unplaced clipboard's drag-on (C1) ------------------------------
  // A slip dragged from the tray follows the pointer as a paper chip; over a
  // room lane it announces the snapped pencil time, and release opens the
  // SAME convert drawer, prefilled — the drawer keeps every rule (hold
  // hygiene, kinds, validation). Escape or releasing off-lane cancels.
  // The chip tracks the cursor itself (EnquiryDragGhost); page state holds
  // only the drop target, so the board re-renders when the target changes,
  // not on every pointermove.
  const [enquiryDrag, setEnquiryDrag] = useState<{
    readonly enquiryId: string;
    readonly name: string;
    readonly originX: number;
    readonly originY: number;
    readonly laneId: string | null;
    readonly startMs: number | null;
  } | null>(null);

  // Lifting a slip (T-619). A pointerdown used to call preventDefault() and
  // lift at once, which on a phone cancels the browser's scroll before it
  // starts: every attempt to push the tray up picked a slip off it instead.
  // A finger now scrolls and a deliberate long press lifts; a mouse, which
  // has no scroll gesture to steal, still lifts on press. Text selection is
  // suppressed in CSS. A non-passive touchmove listener, registered at
  // pointerdown, holds the page still once the slip is lifted — a
  // touch-action change at lift time cannot (lib/touch-scroll.ts). A press
  // that stopped the tray gliding is the tray's, and lifts nothing.
  const longPressRef = useRef<{ timer: number; x: number; y: number } | null>(null);
  /** Synchronous mirror of "a slip is lifted": the touchmove listener fires
   *  far more often than React renders and must read this instant's truth. */
  const slipLiftedRef = useRef(false);
  const slipScrollHoldRef = useRef<ScrollHold | null>(null);

  const endSlipPress = useCallback(() => {
    if (longPressRef.current !== null) {
      window.clearTimeout(longPressRef.current.timer);
      longPressRef.current = null;
    }
    slipScrollHoldRef.current?.release();
    slipScrollHoldRef.current = null;
  }, []);

  // While slips can be lifted, every touch stays holdable from its first
  // event, which WebKit decides at touchstart (lib/touch-scroll.ts).
  useEffect(() => (writable ? keepTouchesHoldable() : undefined), [writable]);

  const liftSlip = useCallback((enquiry: TrayEnquiry, x: number, y: number) => {
    slipLiftedRef.current = true;
    setEnquiryDrag({ enquiryId: enquiry.id, name: enquiry.name, originX: x, originY: y, laneId: null, startMs: null });
  }, []);

  const beginEnquiryDrag = useCallback(
    (enquiry: TrayEnquiry, event: React.PointerEvent<HTMLElement>) => {
      if (!writable) return;
      const { clientX, clientY } = event;
      // Only a real finger or pen waits for the press to ripen; anything else
      // (a mouse, or a synthetic event with no pointerType) lifts at once.
      if (event.pointerType !== "touch" && event.pointerType !== "pen") {
        liftSlip(enquiry, clientX, clientY);
        return;
      }
      endSlipPress();
      // Before the press ripens, deliberately: a listener added at the lift
      // may never be consulted for a gesture already under way.
      const scrollHold = holdScrollWhileLifted(() => slipLiftedRef.current);
      slipScrollHoldRef.current = scrollHold;
      longPressRef.current = {
        x: clientX,
        y: clientY,
        timer: window.setTimeout(() => {
          longPressRef.current = null;
          // A press that landed on the tray still gliding from a flick only
          // stopped it; the browser will not let the page hold that touch.
          if (!scrollHold.holdable()) {
            endSlipPress();
            return;
          }
          liftSlip(enquiry, clientX, clientY);
        }, LONG_PRESS_MS),
      };
    },
    [endSlipPress, liftSlip, writable],
  );

  /** A finger that travelled while the press was ripening was scrolling. */
  const moveEnquiryPress = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const press = longPressRef.current;
    if (press === null) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > LONG_PRESS_SLOP_PX) {
      window.clearTimeout(press.timer);
      longPressRef.current = null;
    }
  }, []);

  useEffect(() => endSlipPress, [endSlipPress]);

  const enquiryDragActive = enquiryDrag !== null;
  // True is set synchronously in liftSlip, because the touchmove listener
  // must not miss the instant of the lift; false can follow the render — one
  // extra held touchmove after a drop costs nothing.
  useEffect(() => {
    slipLiftedRef.current = enquiryDragActive;
    if (!enquiryDragActive) endSlipPress();
  }, [enquiryDragActive, endSlipPress]);
  const presentationKey = `${String(range.fromMs)}:${String(range.toMs)}:${showingOverview ? "overview" : "timeline"}`;
  const dragPresentationRef = useRef(presentationKey);
  useEffect(() => {
    if (dragPresentationRef.current === presentationKey) return;
    dragPresentationRef.current = presentationKey;
    drag.cancel();
    setEnquiryDrag(null);
  }, [presentationKey, drag.cancel]);
  useEffect(() => {
    if (!enquiryDragActive) return;
    const HOUR = 3_600_000;
    const pxPerHour = PX_PER_HOUR[range.view];
    const onMove = (event: PointerEvent): void => {
      const lane = document
        .elementsFromPoint(event.clientX, event.clientY)
        .find((element): element is HTMLElement =>
          element instanceof HTMLElement && element.dataset["diaryLane"] !== undefined,
        );
      let laneId: string | null = null;
      let startMs: number | null = null;
      if (lane !== undefined) {
        laneId = lane.dataset["diaryLane"] ?? null;
        const rect = lane.getBoundingClientRect();
        const rawMs = range.fromMs + ((event.clientX - rect.left) / pxPerHour) * HOUR;
        const snapped = snapMs(rawMs, 15);
        startMs = Math.min(Math.max(snapped, range.fromMs), range.toMs - 15 * 60_000);
      }
      setEnquiryDrag((current) =>
        current === null || (current.laneId === laneId && current.startMs === startMs)
          ? current
          : { ...current, laneId, startMs },
      );
    };
    const onUp = (): void => {
      setEnquiryDrag((current) => {
        if (current !== null && current.laneId !== null && current.startMs !== null) {
          openConvertDrawer(current.enquiryId, {
            spaceId: current.laneId,
            startMs: current.startMs,
          });
        }
        return null;
      });
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setEnquiryDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [enquiryDragActive, openConvertDrawer, range.fromMs, range.toMs, range.view]);

  const onDrawerSaved = useCallback(
    (message: string) => {
      setDrawer(null);
      setToast({ key: Date.now(), message, showUndo: false });
      refetch();
      // A save is the moment an enquiry's standing can have moved (a
      // conversion, a lifecycle step), so the tray reloads here (T-619).
      setEnquiryRetry((value) => value + 1);
    },
    [refetch],
  );

  const undo = useCallback(() => {
    const { entry, stack } = popMove(undoStack);
    if (entry === null) return;
    setUndoStack(stack);
    setToast(null);
    applyMove(entry.bookingId, entry.before, null);
  }, [applyMove, undoStack]);

  const cancelTimelineDrag = drag.cancel;
  const showTimeline = useCallback((on: boolean) => {
    cancelTimelineDrag();
    setEnquiryDrag(null);
    setTimeline(on);
  }, [cancelTimelineDrag]);

  const drawerOpen = drawer !== null;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      const target = event.target;
      // Text-entry surfaces own their keystrokes; a focused checkbox still
      // gets t/d/w/f.
      if (target instanceof HTMLTextAreaElement) return;
      if (target instanceof HTMLElement && target.isContentEditable) return;
      if (
        target instanceof HTMLInputElement &&
        target.type !== "checkbox" &&
        target.type !== "radio" &&
        target.type !== "button"
      ) {
        return;
      }
      // A <select> owns its letters: "d" in the Room list is type-ahead, and
      // taking it to re-range the board loses the keystroke (T-619).
      if (target instanceof HTMLSelectElement) return;
      // While the drawer is open it is the surface being worked on: single
      // letters do not reach past it. Ctrl/Cmd-Z still does — undo is the
      // board's history, which a drawer never writes to.
      if (drawerOpen && !event.ctrlKey && !event.metaKey) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && (event.key === "k" || event.key === "K")) {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // A dialog over the board takes the letters; none reach behind it.
      if (welcomeOpen || paletteOpen) return;
      if (drag.state.phase !== "idle") return;
      if (event.key === "t") setRange(view, Date.now());
      else if (event.key === "d") setRange("day", anchorMs);
      else if (event.key === "w") setRange("week", anchorMs);
      else if (event.key === "f") setRange("2w", anchorMs);
      else if (event.key === "[") setRange(view, shiftRange(range, -1).fromMs + 12 * 3_600_000);
      else if (event.key === "]") setRange(view, shiftRange(range, 1).fromMs + 12 * 3_600_000);
      else if (event.key === "g") {
        // Held back, or the letter would land in the field it opens.
        event.preventDefault();
        openGoTo();
      } else if (event.key === "o" && view !== "day") showTimeline(!timeline);
      else if (event.key === "n" && writable) {
        event.preventDefault();
        openCreateDrawer();
      } else if (event.key === "?") {
        event.preventDefault();
        setWelcomeOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [anchorMs, drag.state.phase, drawerOpen, openCreateDrawer, openGoTo, paletteOpen, range, setRange, showTimeline, timeline, undo, view, welcomeOpen, writable]);

  /** Scrolls a booking's block into view and focuses it; false when the
   *  board is not showing it. */
  const focusEntry = useCallback((entryId: string): boolean => {
    const element = document.getElementById(`diary-block-${entryId}`);
    if (element === null) return false;
    element.scrollIntoView({ block: "nearest", inline: "center" });
    element.focus({ preventScroll: true });
    return true;
  }, []);

  const pickPaletteResult = useCallback(
    (result: PaletteResult) => {
      setPaletteOpen(false);
      if (result.kind === "booking") {
        focusEntry(result.id);
        return;
      }
      if (result.kind === "room") {
        document
          .querySelector(`[data-diary-room="${result.id}"], [data-diary-lane="${result.id}"]`)
          ?.scrollIntoView({ block: "center", inline: "nearest" });
        return;
      }
      if (writable) openConvertDrawer(result.id);
    },
    [focusEntry, openConvertDrawer, writable],
  );

  // Stable identities, so the memoised overview skips page renders that do
  // not change what it shows (toasts, presence, refresh status, enquiries).
  const openBookingFromOverview = useCallback(
    (entry: CalendarBookingEntry) => {
      openDrawer({ kind: "edit", booking: entry });
    },
    [openDrawer],
  );
  const cancelBoardDrag = drag.cancel;
  const openDayFromOverview = useCallback(
    (startMs: number) => {
      cancelBoardDrag();
      setEnquiryDrag(null);
      setRange("day", startMs);
    },
    [cancelBoardDrag, setRange],
  );


  if (user !== null && venueId === null) {
    return (
      <DashboardLayout mainLabel={BOARD_COPY.title}>
        <div className="diary-page">
          <div className="diary-notice">{BOARD_COPY.noVenue}</div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      {/* The board wears the app shell now, so the nav rail, the account block
          and sign-out follow you here. This is a <div>, not a <main> — the
          shell owns the single <main> a page is allowed. */}
      <div className="diary-page" aria-label={BOARD_COPY.title}>
      <header className="diary-header">
        <div className="diary-heading">
          <h1 className="diary-title">{BOARD_COPY.title}</h1>
          {/* New booking keeps one place, whatever the toolbar holds (roadmap N3). */}
          <div className="diary-heading-actions">
            {/* The count is OTHER people (T-619): alone on the board it read
                "Live · 1" and sent a coordinator looking for a colleague who
                was not there. The tooltip already excluded you. */}
            <span
              className={`diary-live${live.connected ? " is-connected" : ""}`}
              title={BOARD_COPY.presence.here(othersPresent.map((person) => person.name))}
            >
              {live.connected ? BOARD_COPY.presence.live : BOARD_COPY.presence.offline}
              {othersPresent.length > 0 ? ` · ${String(othersPresent.length)}` : ""}
            </span>
            {writable ? (
              <button type="button" className="diary-button is-primary" aria-keyshortcuts="N"
                title={BOARD_COPY.withKey(BOARD_COPY.drawer.createTitle, "N")} onClick={openCreateDrawer}>
                {BOARD_COPY.drawer.createTitle}
              </button>
            ) : <span className="diary-readonly">{BOARD_COPY.readOnly}</span>}
          </div>
        </div>
        {/* Where the board looks, then how it is shown (roadmap N3). */}
        <div className="diary-controls">
          <div className="diary-controls-where">
            <div className="diary-range-nav" role="group" aria-label="Range">
              <button
                type="button"
                className="diary-button is-icon"
                aria-label={BOARD_COPY.previous}
                aria-keyshortcuts="["
                title={BOARD_COPY.withKey(BOARD_COPY.previous, "[")}
                onClick={() => {
                  const previous = shiftRange(range, -1);
                  setRange(view, previous.fromMs + 12 * 3_600_000);
                }}
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="diary-button"
                aria-keyshortcuts="T"
                title={BOARD_COPY.withKey(BOARD_COPY.today, "T")}
                onClick={() => {
                  setRange(view, Date.now());
                }}
              >
                {BOARD_COPY.today}
              </button>
              <button
                type="button"
                className="diary-button is-icon"
                aria-label={BOARD_COPY.next}
                aria-keyshortcuts="]"
                title={BOARD_COPY.withKey(BOARD_COPY.next, "]")}
                onClick={() => {
                  const next = shiftRange(range, 1);
                  setRange(view, next.fromMs + 12 * 3_600_000);
                }}
              >
                <ChevronRight size={18} aria-hidden="true" />
              </button>
              <button
                ref={goToButtonRef}
                type="button"
                className="diary-button"
                aria-expanded={goTo.open}
                aria-keyshortcuts="G"
                title={BOARD_COPY.withKey(BOARD_COPY.goTo.open, "G")}
                onClick={() => { if (goTo.open) closeGoTo(); else openGoTo(); }}
              >
                {BOARD_COPY.goTo.open}
              </button>
            </div>
            <span className="diary-range-title">{rangeTitle(range)}</span>
          </div>
          <div className="diary-controls-how">
            <div className="diary-view-switch" role="group" aria-label="Zoom">
              {VIEWS.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  className={`diary-button${candidate === view ? " is-active" : ""}`}
                  aria-pressed={candidate === view}
                  aria-keyshortcuts={VIEW_KEYS[candidate]}
                  title={BOARD_COPY.withKey(BOARD_COPY.views[candidate], VIEW_KEYS[candidate])}
                  onClick={() => {
                    setRange(candidate, anchorMs);
                  }}
                >
                  {BOARD_COPY.views[candidate]}
                </button>
              ))}
            </div>
            {view !== "day" ? <div className="diary-view-switch" role="group" aria-label="Board presentation">
              <button type="button" className={`diary-button${!timeline ? " is-active" : ""}`} aria-pressed={!timeline}
                aria-keyshortcuts="O" title={BOARD_COPY.withKey("Overview", "O")}
                onClick={() => { showTimeline(false); }}>Overview</button>
              <button type="button" className={`diary-button${timeline ? " is-active" : ""}`} aria-pressed={timeline}
                aria-keyshortcuts="O" title={BOARD_COPY.withKey("Timeline", "O")}
                onClick={() => { showTimeline(true); }}>Timeline</button>
            </div> : null}
            {/* Refresh means the whole board, tray included: the one explicit
                re-read now that panning no longer drags the enquiries along. */}
            <ViewMenu
              showExited={showExited}
              onShowExited={setShowExited}
              onRefresh={() => {
                refetch();
                setEnquiryRetry((value) => value + 1);
              }}
              onHowItWorks={() => { setWelcomeOpen(true); }}
            />
          </div>
        </div>
        {goTo.open ? (
          <form
            className="diary-goto"
            role="search"
            aria-label={BOARD_COPY.goTo.label}
            onSubmit={(event) => {
              event.preventDefault();
              const today = msToWallInput(Date.now()).slice(0, 10);
              const sought = parseGoToDate(goTo.text, today);
              if (sought === null) {
                setGoTo((previous) => ({ ...previous, sought: null, unread: true, otherWeekday: null }));
                return;
              }
              const said = saidWeekday(goTo.text);
              const actual = new Date(`${sought}T12:00:00.000Z`).getUTCDay();
              const otherWeekday = said === null || said === actual ? null : { said, actual };
              setGoTo((previous) => ({ ...previous, sought, unread: false, otherWeekday }));
              setRange(view, Date.parse(`${sought}T12:00:00.000Z`));
            }}
          >
            <label className="diary-goto-field">
              <span>{BOARD_COPY.goTo.label}</span>
              <input
                ref={goToInputRef}
                type="text"
                value={goTo.text}
                placeholder="5 Jun 27"
                autoComplete="off"
                aria-invalid={goTo.unread}
                aria-describedby={goToHintId}
                onChange={(event) => { const text = event.target.value; setGoTo((previous) => ({ ...previous, text, unread: false, otherWeekday: null })); }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    closeGoTo();
                  }
                }}
              />
            </label>
            <button type="submit" className="diary-button is-primary">{BOARD_COPY.goTo.go}</button>
            <button type="button" className="diary-button" onClick={closeGoTo}>{BOARD_COPY.goTo.close}</button>
            {/* A note replaces the hint as a new element, so it is announced. */}
            {goToNote === null
              ? <p key="hint" id={goToHintId} className="diary-goto-hint">{BOARD_COPY.goTo.hint}</p>
              : <p key={goToNote} id={goToHintId} className="diary-goto-error" role="alert">{goToNote}</p>}
            {/* Announced once the range's own read can answer it. */}
            <div className="diary-goto-answer" role="status">
              {soughtAnswer === null ? null : (
                <>
                  <p className="diary-goto-day">{soughtAnswer.day}</p>
                  <dl className="diary-goto-rooms">
                    {soughtAnswer.rooms.map((room) => (
                      <div key={room.id} className="diary-goto-room">
                        <dt>{room.name}</dt>
                        {room.lines.map((roomLine) => <dd key={roomLine.key}>{roomLine.text}</dd>)}
                      </div>
                    ))}
                  </dl>
                </>
              )}
            </div>
          </form>
        ) : null}
        <div className="diary-header-foot">
          <ul className="diary-legend" aria-label="Legend">
            <li className="diary-legend-item is-ink">{BOARD_COPY.legend.ink}</li>
            <li className="diary-legend-item is-hold">{BOARD_COPY.legend.hold}</li>
            <li className="diary-legend-item is-prospect">{BOARD_COPY.legend.prospect}</li>
            <li className="diary-legend-item is-internal_block">{BOARD_COPY.legend.internal_block}</li>
            <li className="diary-legend-item is-phase">{BOARD_COPY.legend.phase}</li>
          </ul>
          {/* One fixed place for what the board is doing, so a refresh or a
              save never pushes the board down (roadmap N3). */}
          <div className="diary-status-slot">
            {rangePending ? <ActivityStatus>{BOARD_COPY.opening(rangeTitle(range))}</ActivityStatus> : null}
            {isRefreshing ? <ActivityStatus>{BOARD_COPY.refreshing}</ActivityStatus> : null}
            {pendingMoves > 0 ? <ActivityStatus>Saving booking moves…</ActivityStatus> : null}
            {refreshFailedAtMs !== null ? (
              <p className="diary-status-notice" role="status">
                {BOARD_COPY.refreshFailed(formatWallTime(refreshFailedAtMs), readAtMs === null ? null : formatWallTime(readAtMs))}
                <button type="button" className="diary-status-retry" onClick={refetch}>{BOARD_COPY.retry}</button>
              </p>
            ) : null}
          </div>
        </div>
      </header>

      {shown === null && status === "error" ? (
        <div className="diary-notice is-error" role="alert">
          <p>{BOARD_COPY.errorTitle}</p>
          {error !== null ? <p className="diary-notice-detail">{error}</p> : null}
          <button type="button" className="diary-button" onClick={refetch}>
            {BOARD_COPY.retry}
          </button>
        </div>
      ) : shown === null ? (
        <div className="diary-notice"><ActivityStatus variant="panel">{BOARD_COPY.loading}</ActivityStatus></div>
      ) : (
        <div className="diary-layout">
          {/* A range that could not be read says so where its bookings would
              be; the rooms' side of the page stays. */}
          {rangeFailed ? (
            <div className="diary-notice is-error diary-range-error" role="alert">
              <p>{BOARD_COPY.rangeError(rangeTitle(range))}</p>
              {error !== null ? <p className="diary-notice-detail">{error}</p> : null}
              <button type="button" className="diary-button" onClick={refetch}>
                {BOARD_COPY.retry}
              </button>
            </div>
          ) : showingOverview ? <BoardOverview rooms={rooms} entries={entries} range={range} nowMs={nowMs}
            conflictSeverity={conflictSeverity} onOpenBooking={openBookingFromOverview} pending={rangePending}
            soughtDayMs={soughtDay?.fromMs ?? null}
            onOpenDay={openDayFromOverview} onCreateOnDay={writable && !rangePending ? openCreateOnDay : undefined} /> : <BoardGrid
            rooms={rooms}
            entries={entries}
            range={range}
            pxPerHour={PX_PER_HOUR[view]}
            conflictSeverity={conflictSeverity}
            drag={drag}
            writable={writable}
            nowMs={nowMs}
            onOpenBlock={openBlock}
            create={rangePending ? undefined : boardCreate}
            pending={rangePending}
            turnaroundRules={shown.turnaroundRules}
            onOpenGap={venueId === null ? undefined : openGap}
          />}
          <aside className="diary-side">
            {shown.decisionsDue === undefined ? null : (
              <DecisionsDuePanel
                decisions={shown.decisionsDue}
                rooms={rooms}
                nowMs={nowMs}
                onOpen={openBookingFromOverview}
              />
            )}
            <HoldingTray
              items={trayItems}
              itemsPending={data === null}
              onFocusEntry={focusEntry}
              nextActions={shown.nextActionsDue}
              rooms={rooms}
              nowMs={nowMs}
              onOpenBooking={openBookingFromOverview}
              enquiries={openEnquiries.map((enquiry) => ({
                id: enquiry.id,
                name: enquiry.name,
                eventType: enquiry.eventType,
                estimatedGuests: enquiry.estimatedGuests,
                preferredDate: enquiry.preferredDate,
              }))}
              enquiriesLoading={enquiriesLoading}
              enquiriesMore={moreEnquiries}
              enquiryError={enquiryError}
              onRetryEnquiries={() => { setEnquiryRetry((value) => value + 1); }}
              canConvert={writable}
              onConvertEnquiry={openConvertDrawer}
              onShowDate={showDateOnBoard}
              onBeginEnquiryDrag={writable && !showingOverview ? beginEnquiryDrag : undefined}
              onEnquiryPressMove={writable && !showingOverview ? moveEnquiryPress : undefined}
              onEnquiryPressEnd={writable && !showingOverview ? endSlipPress : undefined}
              liftedEnquiryId={enquiryDrag?.enquiryId ?? null}
            />
            {/* This range's own: shown once it is read, never as "none". */}
            {data === null ? null : <ConflictRail report={data.conflicts} onFocusEntry={focusEntry} />}
            {data !== null && entries.length === 0 ? (
              <p className="diary-panel-empty">{BOARD_COPY.emptyRange}</p>
            ) : null}
          </aside>
        </div>
      )}

      {welcomeOpen ? <WelcomePanel onDismiss={dismissWelcome} /> : null}

      {drawer !== null && venueId !== null ? (
        <BookingDrawer
          key={drawer.nonce}
          mode={drawer.mode}
          rooms={rooms}
          venueId={venueId}
          role={user?.role ?? ""}
          onClose={() => {
            const bookingId = drawer.mode.kind === "edit" ? drawer.mode.booking.id : null;
            const opener = drawerReturnFocusRef.current;
            setDrawer(null);
            requestAnimationFrame(() => {
              if (bookingId !== null && focusEntry(bookingId)) return;
              // Not on the board (a booking opened from the decisions list in
              // another week): back to whatever opened the drawer.
              if (opener !== null && opener.isConnected) opener.focus({ preventScroll: true });
            });
          }}
          onSaved={onDrawerSaved}
          ladderPlace={placeOnLadder}
          contested={drawerContested}
          ladderRead={drawerLadderRead}
        />
      ) : null}

      {gapSheet !== null && venueId !== null ? (
        <GapSheet
          key={gapSheet.gap.id}
          venueId={venueId}
          room={gapSheet.room}
          gap={gapSheet.gap}
          canEdit={canEditChangeovers}
          onClose={closeGap}
          onChanged={refetch}
        />
      ) : null}

      {drag.confirming ? <InkConfirm onConfirm={drag.confirmDrop} onCancel={drag.cancel} /> : null}
      {paletteOpen ? (
        <BoardPalette
          data={data}
          enquiries={openEnquiries}
          onPick={pickPaletteResult}
          onClose={closePalette}
        />
      ) : null}

      {enquiryDrag !== null ? (
        <EnquiryDragGhost
          name={enquiryDrag.name}
          startMs={enquiryDrag.startMs}
          originX={enquiryDrag.originX}
          originY={enquiryDrag.originY}
        />
      ) : null}

      {toast !== null ? (
        <UndoToast
          key={toast.key}
          message={toast.message}
          showUndo={toast.showUndo}
          onUndo={undo}
        />
      ) : null}
      <div aria-live="polite" className="vv-sr-only">
        {drag.announcement}
      </div>
      </div>
    </DashboardLayout>
  );
}

export default DiaryBoardPage;
