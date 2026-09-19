import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import type {
  CalendarBookingEntry,
  CalendarEntry,
  ConflictSeverity,
} from "@omnitwin/types";
import { useAuthStore } from "../../stores/auth-store.js";
import { ApiError } from "../../api/client.js";
import { moveBooking } from "../../api/diary.js";
import { BOARD_COPY } from "./board-copy.js";
import {
  dayColumns,
  formatWallTime,
  snapMs,
  boardRange,
  rangeTitle,
  shiftRange,
  msToWallInput,
  type BoardView,
} from "./lib/board-time.js";
import { filterBoardEntries, needsAction } from "./lib/board-layout.js";
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
import { suppressScrollWhileLifted } from "./lib/touch-scroll.js";
import { useCalendar } from "./hooks/useCalendar.js";
import { useBoardDrag } from "./hooks/useBoardDrag.js";
import { useDiaryLive } from "./hooks/useDiaryLive.js";
import { listOpenEnquiries, type Enquiry } from "../../api/enquiries.js";
import { BoardGrid } from "./components/BoardGrid.js";
import { BoardOverview } from "./components/BoardOverview.js";
import { ActivityStatus } from "../../components/shared/Activity.js";
import { BookingDrawer } from "./components/BookingDrawer.js";
import { WelcomePanel } from "./components/WelcomePanel.js";
import {
  type TrayEnquiry, ConflictRail, HoldingTray, InkConfirm, UndoToast } from "./components/BoardPanels.js";
import { BoardPalette, type PaletteResult } from "./components/BoardPalette.js";
import { DashboardLayout } from "../../components/dashboard/DashboardLayout.js";
import "./diary-board.css";

// ---------------------------------------------------------------------------
// The Diary Board (T-493; Canon §8/§9/§12/§18) — the multi-room timeline over
// GET /calendar. Lanes, day/week/month zoom, venue-local now-line, pointer +
// keyboard drag with a live-conflict ghost, ink-move confirmation, undo, the
// conflict rail with honest checks, and the needs-attention tray.
//
// Staff/admin move bookings; hallkeeper reads (the API enforces the same
// split server-side). URL carries ?view=&date= so board positions deep-link.
// ---------------------------------------------------------------------------

const PX_PER_HOUR: Record<BoardView, number> = { day: 96, week: 18, "2w": 9 };
// The toolbar offers the reference sheet's three zooms — and now so does
// the URL. The month board is retired (T-619).
const VIEWS: readonly BoardView[] = ["day", "week", "2w"];
const TOAST_MS = 7_000;
const NOW_TICK_MS = 60_000;
/** How long a finger must rest before it is lifting rather than scrolling.
 *  Matched to the block lift in useBoardDrag so the two gestures feel like
 *  one rule, and kept just above the platform's own ~350ms context-menu
 *  press so the two do not fight. */
const LONG_PRESS_MS = 400;
/** Travel that proves the press was a scroll after all. */
const LONG_PRESS_SLOP_PX = 8;
const SEVERITY_RANK: Record<ConflictSeverity, number> = { blocking: 3, warning: 2, info: 1 };

function isBoardView(value: string | null): value is BoardView {
  return value === "day" || value === "week" || value === "2w";
}

/** The retired month board's deep links (`?view=month`) still sit in
 *  bookmarks and older emails. They resolve to the week their anchor falls
 *  in — a real range, not a 404 and not a silent mismatch between what the
 *  URL claims and what the board draws. */
const RETIRED_VIEW_ALIASES: Readonly<Record<string, BoardView>> = { month: "week" };

function viewFromParam(value: string | null): BoardView {
  if (isBoardView(value)) return value;
  if (value !== null && value in RETIRED_VIEW_ALIASES) {
    return RETIRED_VIEW_ALIASES[value] ?? "week";
  }
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

export function DiaryBoardPage(): ReactElement {
  const user = useAuthStore((state) => state.user);
  const venueId = user?.venueId ?? null;
  const writable = user?.role === "staff" || user?.role === "admin";

  const [searchParams, setSearchParams] = useSearchParams();
  const viewParam = searchParams.get("view");
  const view: BoardView = viewFromParam(viewParam);
  const anchorMs = anchorFromParam(searchParams.get("date"));
  const range = useMemo(() => boardRange(anchorMs, view), [anchorMs, view]);

  const { data, status, error, refetch, isRefreshing } = useCalendar(venueId, range);
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
  const openDrawer = useCallback((mode: DrawerMode) => {
    drawerNonceRef.current += 1;
    setDrawer({ mode, nonce: drawerNonceRef.current });
  }, []);
  const [enquiryState, setEnquiryState] = useState<{
    readonly venueId: string | null;
    readonly rows: readonly Enquiry[];
    readonly status: "loading" | "ready" | "error";
    readonly error: string | null;
  }>({ venueId, rows: [], status: "loading", error: null });
  const [enquiryRetry, setEnquiryRetry] = useState(0);
  const openEnquiries = enquiryState.venueId === venueId ? enquiryState.rows : [];
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

  const live = useDiaryLive(venueId !== null, refetch);
  /** Presence minus yourself: "who else is on this board right now". */
  const othersPresent = useMemo(
    () => live.presence.filter((person) => person.userId !== userId),
    [live.presence, userId],
  );

  // The tray reloads when the VENUE changes or something actually touched an
  // enquiry — not on `data`, which changes on every pan, zoom, refetch and
  // live nudge. Keying on `data` meant panning a week re-read the whole
  // enquiry list; the tray's contents could not have changed, and the board
  // paid for a round trip per interaction (T-619).
  useEffect(() => {
    if (venueId === null) return;
    const controller = new AbortController();
    let cancelled = false;
    setEnquiryState((previous) => ({ venueId,
      rows: previous.venueId === venueId ? previous.rows : [], status: "loading", error: null }));
    listOpenEnquiries(controller.signal)
      .then((rows) => {
        if (cancelled) return;
        setEnquiryState({ venueId, status: "ready", error: null, rows });
      })
      .catch(() => {
        if (cancelled) return;
        setEnquiryState((previous) => ({ ...previous, status: "error",
          error: "Enquiries could not be refreshed. Any previously loaded enquiries remain visible." }));
      });
    return () => {
      cancelled = true;
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
  useEffect(() => {
    setOverrides(new Map());
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

  const rooms = data?.rooms ?? [];
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

  const trayItems = useMemo(() => needsAction(entries, nowMs), [entries, nowMs]);

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

  // Create-in-context (T-619). "New booking" used to seed the FIRST room and
  // the first instant of the range — so on a week view it offered Monday in
  // whatever room the venue happened to sort first, and the coordinator
  // retyped both. The day it seeds is now the day being looked at (today,
  // when today is inside the visible range; otherwise the range's first
  // day), and a click on an empty overview cell or a point on a day lane
  // seeds exactly the room and time that was pointed at.
  // The whole column, not just its start: the lane's create control announces
  // this day by name, so the label and the instant must come from one place
  // and cannot drift apart (review fix 2).
  const seededDay = useMemo(() => {
    const days = dayColumns(range);
    const today = days.find((day) => nowMs >= day.startMs && nowMs < day.endMs);
    const chosen = today ?? days[0];
    return chosen ?? { startMs: range.fromMs, label: rangeTitle(range) };
  }, [nowMs, range]);
  const seededDayStartMs = seededDay.startMs;

  /** A DAY was chosen (the toolbar button, or an overview square): the
   *  drawer opens on that day at the house's default evening window. */
  const openCreateOnDay = useCallback(
    (spaceId: string, dayStartMs: number) => {
      if (user === null) return;
      openDrawer({ kind: "create", spaceId, dayStartMs, ownerUserId: user.id });
    },
    [openDrawer, user],
  );

  /** An INSTANT was chosen (a point on a day lane): the drawer opens at
   *  exactly that time, keeping the default window's length. */
  const openCreateAt = useCallback(
    (spaceId: string, startMs: number) => {
      if (user === null) return;
      openDrawer({ kind: "create", spaceId, dayStartMs: startMs, ownerUserId: user.id, startMs });
    },
    [openDrawer, user],
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const paletteResults = useMemo<readonly PaletteResult[]>(() => {
    const query = paletteQuery.trim().toLowerCase();
    if (query.length < 2 || data === null) return [];
    const out: PaletteResult[] = [];
    const roomName = (spaceId: string): string =>
      data.rooms.find((room) => room.id === spaceId)?.name ?? "";
    for (const room of data.rooms) {
      if (room.name.toLowerCase().includes(query)) {
        out.push({ kind: "room", id: room.id, label: room.name, detail: BOARD_COPY.palette.roomDetail });
      }
    }
    for (const entry of data.entries) {
      if (entry.entryType !== "booking") continue;
      const hay = `${entry.title} ${entry.clientName ?? ""} ${entry.eventName ?? ""}`.toLowerCase();
      if (hay.includes(query)) {
        out.push({
          kind: "booking",
          id: entry.id,
          label: entry.title,
          detail: `${roomName(entry.spaceId)} · ${formatWallTime(Date.parse(entry.startsAt))}`,
        });
      }
    }
    for (const enquiry of openEnquiries) {
      if (`${enquiry.name} ${enquiry.eventType ?? ""}`.toLowerCase().includes(query)) {
        out.push({
          kind: "enquiry",
          id: enquiry.id,
          label: enquiry.name,
          detail: BOARD_COPY.palette.enquiryDetail,
        });
      }
    }
    return out.slice(0, 12);
  }, [data, openEnquiries, paletteQuery]);

  // --- the unplaced clipboard's drag-on (C1) ------------------------------
  // A slip dragged from the tray follows the pointer as a paper chip; over a
  // room lane it announces the snapped pencil time, and release opens the
  // SAME convert drawer, prefilled — the drawer keeps every rule (hold
  // hygiene, kinds, validation). Escape or releasing off-lane cancels.
  const [enquiryDrag, setEnquiryDrag] = useState<{
    readonly enquiryId: string;
    readonly name: string;
    readonly x: number;
    readonly y: number;
    readonly laneId: string | null;
    readonly startMs: number | null;
  } | null>(null);

  // Lifting a slip (T-619).
  //
  // A pointerdown on a slip used to call preventDefault() and lift
  // immediately. On a phone that cancels the browser's own scroll before it
  // has begun, so the tray could not be scrolled at all: every attempt to
  // push the list up picked a slip off the page instead. A finger now
  // scrolls by default and only a deliberate long-press lifts; a mouse,
  // which has no scroll gesture to steal, still lifts on press. Nothing
  // calls preventDefault — text selection is suppressed in CSS.
  //
  // Review fix 1: `touch-action: none` applied at lift time cannot affect a
  // gesture the browser has already classified as a pan, so the slip lifted
  // and then died on the first movement. A non-passive `touchmove` listener
  // is registered at pointerdown and decides per event — see
  // lib/touch-scroll.ts.
  const longPressRef = useRef<{ timer: number; x: number; y: number } | null>(null);
  /** Synchronous mirror of `enquiryDrag !== null`. The touchmove listener runs
   *  far more often than React re-renders and must read the truth of THIS
   *  instant, not the last committed render's. */
  const slipLiftedRef = useRef(false);
  const releaseSlipScrollRef = useRef<(() => void) | null>(null);

  const endSlipPress = useCallback(() => {
    if (longPressRef.current !== null) {
      window.clearTimeout(longPressRef.current.timer);
      longPressRef.current = null;
    }
    releaseSlipScrollRef.current?.();
    releaseSlipScrollRef.current = null;
  }, []);

  /** Kept under its old name because <HoldingTray> takes it as a prop; it now
   *  also releases the scroll hold, since both belong to the same press. */
  const clearLongPress = endSlipPress;

  const liftSlip = useCallback((enquiry: TrayEnquiry, x: number, y: number) => {
    slipLiftedRef.current = true;
    setEnquiryDrag({ enquiryId: enquiry.id, name: enquiry.name, x, y, laneId: null, startMs: null });
  }, []);

  const beginEnquiryDrag = useCallback(
    (enquiry: TrayEnquiry, event: React.PointerEvent<HTMLElement>) => {
      if (!writable) return;
      const { clientX, clientY } = event;
      // Only a real finger or pen waits for the press to ripen; anything
      // else (mouse, or a synthetic event with no pointerType) lifts at
      // once, as it always did.
      if (event.pointerType !== "touch" && event.pointerType !== "pen") {
        liftSlip(enquiry, clientX, clientY);
        return;
      }
      endSlipPress();
      // Before the press ripens, deliberately: a listener added at lift time
      // may never be consulted for a sequence already under way.
      releaseSlipScrollRef.current = suppressScrollWhileLifted(() => slipLiftedRef.current);
      longPressRef.current = {
        x: clientX,
        y: clientY,
        timer: window.setTimeout(() => {
          longPressRef.current = null;
          liftSlip(enquiry, clientX, clientY);
        }, LONG_PRESS_MS),
      };
    },
    [endSlipPress, liftSlip, writable],
  );

  /** A finger that travelled while the press was still ripening was
   *  scrolling, not lifting. */
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
  // The ref is set to TRUE synchronously in liftSlip, because the touchmove
  // listener must not miss the instant of the lift. Going false can safely
  // follow the render: one extra suppressed touchmove after a drop costs
  // nothing, whereas one missed one loses the drag.
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
        current === null ? null : { ...current, x: event.clientX, y: event.clientY, laneId, startMs },
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
      // A drawer save is the one moment an enquiry's standing can actually
      // have moved (a conversion, a lifecycle step) — so the tray reloads
      // here, deliberately, instead of on every board change.
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

  const drawerOpen = drawer !== null;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      const target = event.target;
      // Text-entry surfaces own their keystrokes.
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
      // A <select> owns its own letter keys: typing "d" in the Commitment or
      // Room dropdown is type-ahead, and stealing it to re-range the board
      // behind an open drawer both loses the keystroke and moves the ground
      // under the form (T-619).
      if (target instanceof HTMLSelectElement) return;
      // While the drawer is open it is the surface the coordinator is
      // working on. Single-letter board shortcuts do not reach past it —
      // Ctrl/Cmd-Z still does, because undo is about the board's history
      // and a drawer never writes to that stack.
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
      if (drag.state.phase !== "idle") return;
      if (event.key === "t") setRange(view, Date.now());
      else if (event.key === "d") setRange("day", anchorMs);
      else if (event.key === "w") setRange("week", anchorMs);
      else if (event.key === "f") setRange("2w", anchorMs);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [anchorMs, drag.state.phase, drawerOpen, setRange, undo, view]);

  const focusEntry = useCallback((entryId: string) => {
    const element = document.getElementById(`diary-block-${entryId}`);
    if (element === null) return;
    element.scrollIntoView({ block: "nearest", inline: "center" });
    element.focus({ preventScroll: true });
  }, []);

  const pickPaletteResult = useCallback(
    (result: PaletteResult) => {
      setPaletteOpen(false);
      setPaletteQuery("");
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
        </div>
        <div className="diary-controls">
          <div className="diary-view-switch" role="group" aria-label="Zoom">
            {VIEWS.map((candidate) => (
              <button
                key={candidate}
                type="button"
                className={`diary-button${candidate === view ? " is-active" : ""}`}
                aria-pressed={candidate === view}
                onClick={() => {
                  setRange(candidate, anchorMs);
                }}
              >
                {BOARD_COPY.views[candidate]}
              </button>
            ))}
          </div>
          <div className="diary-range-nav" role="group" aria-label="Range">
            <button
              type="button"
              className="diary-button"
              onClick={() => {
                const previous = shiftRange(range, -1);
                setRange(view, previous.fromMs + 12 * 3_600_000);
              }}
            >
              {BOARD_COPY.previous}
            </button>
            <button
              type="button"
              className="diary-button"
              onClick={() => {
                setRange(view, Date.now());
              }}
            >
              {BOARD_COPY.today}
            </button>
            <button
              type="button"
              className="diary-button"
              onClick={() => {
                const next = shiftRange(range, 1);
                setRange(view, next.fromMs + 12 * 3_600_000);
              }}
            >
              {BOARD_COPY.next}
            </button>
          </div>
          <span className="diary-range-title">{rangeTitle(range)}</span>
          {view !== "day" ? <div className="diary-view-switch" role="group" aria-label="Board presentation">
            <button type="button" className={`diary-button${!timeline ? " is-active" : ""}`} aria-pressed={!timeline}
              onClick={() => { drag.cancel(); setEnquiryDrag(null); setTimeline(false); }}>Overview</button>
            <button type="button" className={`diary-button${timeline ? " is-active" : ""}`} aria-pressed={timeline}
              onClick={() => { drag.cancel(); setEnquiryDrag(null); setTimeline(true); }}>Timeline</button>
          </div> : null}
          <label className="diary-toggle">
            <input
              type="checkbox"
              checked={showExited}
              onChange={(event) => {
                setShowExited(event.target.checked);
              }}
            />
            {BOARD_COPY.showExited}
          </label>
          {/* "Refresh" means the whole board, tray included. It is the one
              explicit re-read left now that panning and zooming no longer
              drag the enquiry list along with them (T-619). */}
          <button
            type="button"
            className="diary-button"
            onClick={() => {
              refetch();
              setEnquiryRetry((value) => value + 1);
            }}
          >
            {BOARD_COPY.refresh}
          </button>
          <button
            type="button"
            className="diary-button"
            onClick={() => {
              setWelcomeOpen(true);
            }}
          >
            {BOARD_COPY.welcome.reopen}
          </button>
          {writable ? (
            <button type="button" className="diary-button is-primary" onClick={openCreateDrawer}>
              {BOARD_COPY.drawer.createTitle}
            </button>
          ) : null}
          {!writable ? <span className="diary-readonly">{BOARD_COPY.readOnly}</span> : null}
          {/* The count is OTHER people (T-619). It used to include you, so a
              coordinator alone on the board read "Live · 1" and went looking
              for the colleague who was not there. The tooltip already
              excluded self; the number now agrees with it. */}
          <span
            className={`diary-live${live.connected ? " is-connected" : ""}`}
            title={BOARD_COPY.presence.here(othersPresent.map((person) => person.name))}
          >
            {live.connected ? BOARD_COPY.presence.live : BOARD_COPY.presence.offline}
            {othersPresent.length > 0 ? ` · ${String(othersPresent.length)}` : ""}
          </span>
        </div>
        <ul className="diary-legend" aria-label="Legend">
          <li className="diary-legend-item is-ink">{BOARD_COPY.legend.ink}</li>
          <li className="diary-legend-item is-hold">{BOARD_COPY.legend.hold}</li>
          <li className="diary-legend-item is-prospect">{BOARD_COPY.legend.prospect}</li>
          <li className="diary-legend-item is-internal_block">{BOARD_COPY.legend.internal_block}</li>
          <li className="diary-legend-item is-phase">{BOARD_COPY.legend.phase}</li>
        </ul>
      </header>

      {isRefreshing ? <ActivityStatus>Refreshing the Diary…</ActivityStatus> : null}
      {pendingMoves > 0 ? <ActivityStatus>Saving booking moves…</ActivityStatus> : null}

      {status === "error" ? (
        <div className="diary-notice is-error" role="alert">
          <p>{BOARD_COPY.errorTitle}</p>
          {error !== null ? <p className="diary-notice-detail">{error}</p> : null}
          <button type="button" className="diary-button" onClick={refetch}>
            {BOARD_COPY.retry}
          </button>
        </div>
      ) : data === null ? (
        <div className="diary-notice"><ActivityStatus variant="panel">{BOARD_COPY.loading}</ActivityStatus></div>
      ) : (
        <div className="diary-layout">
          {showingOverview ? <BoardOverview rooms={rooms} entries={entries} range={range} nowMs={nowMs}
            conflictSeverity={conflictSeverity} onOpenBooking={(entry) => { openDrawer({ kind: "edit", booking: entry }); }}
            onOpenDay={(startMs) => { drag.cancel(); setEnquiryDrag(null); setRange("day", startMs); }}
            onCreateOnDay={writable ? openCreateOnDay : undefined} /> : <BoardGrid
            rooms={rooms}
            entries={entries}
            range={range}
            pxPerHour={PX_PER_HOUR[view]}
            conflictSeverity={conflictSeverity}
            drag={drag}
            writable={writable}
            nowMs={nowMs}
            onOpenBlock={openBlock}
            create={writable ? {
              at: openCreateAt,
              onDay: openCreateOnDay,
              day: { startMs: seededDay.startMs, label: seededDay.label },
            } : undefined}
            turnaroundRules={data.turnaroundRules}
          />}
          <aside className="diary-side">
            <HoldingTray
              items={trayItems}
              onFocusEntry={focusEntry}
              enquiries={openEnquiries.map((enquiry) => ({
                id: enquiry.id,
                name: enquiry.name,
                eventType: enquiry.eventType,
                estimatedGuests: enquiry.estimatedGuests,
              }))}
              enquiriesLoading={enquiriesLoading}
              enquiryError={enquiryError}
              onRetryEnquiries={() => { setEnquiryRetry((value) => value + 1); }}
              canConvert={writable}
              onConvertEnquiry={openConvertDrawer}
              onBeginEnquiryDrag={writable && !showingOverview ? beginEnquiryDrag : undefined}
              onEnquiryPressMove={writable && !showingOverview ? moveEnquiryPress : undefined}
              onEnquiryPressEnd={writable && !showingOverview ? clearLongPress : undefined}
              liftedEnquiryId={enquiryDrag?.enquiryId ?? null}
            />
            <ConflictRail report={data.conflicts} onFocusEntry={focusEntry} />
            {entries.length === 0 ? (
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
            setDrawer(null);
            if (bookingId !== null) requestAnimationFrame(() => { focusEntry(bookingId); });
          }}
          onSaved={onDrawerSaved}
        />
      ) : null}

      {drag.confirming ? <InkConfirm onConfirm={drag.confirmDrop} onCancel={drag.cancel} /> : null}
      {paletteOpen ? (
        <BoardPalette
          query={paletteQuery}
          results={paletteResults}
          onQueryChange={setPaletteQuery}
          onPick={pickPaletteResult}
          onClose={() => {
            setPaletteOpen(false);
            setPaletteQuery("");
          }}
        />
      ) : null}

      {enquiryDrag !== null ? (
        <div
          className="diary-enquiry-ghost"
          style={{ left: enquiryDrag.x + 12, top: enquiryDrag.y + 10 }}
          aria-hidden="true"
        >
          <span className="diary-tray-item-title">{enquiryDrag.name}</span>
          <span className="diary-enquiry-ghost-time">
            {enquiryDrag.startMs !== null
              ? BOARD_COPY.trayEnquiries.dropAt(formatWallTime(enquiryDrag.startMs))
              : BOARD_COPY.trayEnquiries.dropSeeking}
          </span>
        </div>
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
