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
  formatWallTime,
  snapMs,
  boardRange,
  rangeTitle,
  shiftRange,
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
import { useCalendar } from "./hooks/useCalendar.js";
import { useBoardDrag } from "./hooks/useBoardDrag.js";
import { useDiaryLive } from "./hooks/useDiaryLive.js";
import { listEnquiries, type Enquiry } from "../../api/enquiries.js";
import { BoardGrid } from "./components/BoardGrid.js";
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

const PX_PER_HOUR: Record<BoardView, number> = { day: 96, week: 18, "2w": 9, month: 3 };
// The toolbar offers the reference sheet's three zooms. Month stays in the
// union and URL-reachable (?view=month, the m key) so old deep links keep
// working — a deliberate compat decision, not an oversight.
const VIEWS: readonly BoardView[] = ["day", "week", "2w"];
const TOAST_MS = 7_000;
const NOW_TICK_MS = 60_000;
const SEVERITY_RANK: Record<ConflictSeverity, number> = { blocking: 3, warning: 2, info: 1 };

function isBoardView(value: string | null): value is BoardView {
  return value === "day" || value === "week" || value === "2w" || value === "month";
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
  const view: BoardView = isBoardView(viewParam) ? viewParam : "week";
  const anchorMs = anchorFromParam(searchParams.get("date"));
  const range = useMemo(() => boardRange(anchorMs, view), [anchorMs, view]);

  const { data, status, error, refetch } = useCalendar(venueId, range);

  const [showExited, setShowExited] = useState(false);
  const [overrides, setOverrides] = useState<ReadonlyMap<string, MoveSnapshot>>(new Map());
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
  const [openEnquiries, setOpenEnquiries] = useState<readonly Enquiry[]>([]);

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

  useEffect(() => {
    if (venueId === null) return;
    let cancelled = false;
    listEnquiries()
      .then((all) => {
        if (cancelled) return;
        setOpenEnquiries(
          all.filter((enquiry) => enquiry.state === "submitted" || enquiry.state === "under_review"),
        );
      })
      .catch(() => {
        // The tray degrades to pencils-only; the board itself is unaffected.
      });
    return () => {
      cancelled = true;
    };
  }, [venueId, data]);

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
      const date = new Date(nextAnchorMs).toISOString().slice(0, 10);
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
        });
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

  const openCreateDrawer = useCallback(() => {
    const firstRoom = rooms[0];
    if (user === null || firstRoom === undefined) return;
    openDrawer({
      kind: "create",
      spaceId: firstRoom.id,
      dayStartMs: range.fromMs,
      ownerUserId: user.id,
    });
  }, [openDrawer, range.fromMs, rooms, user]);

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

  const beginEnquiryDrag = useCallback(
    (enquiry: TrayEnquiry, event: React.PointerEvent<HTMLElement>) => {
      if (!writable) return;
      event.preventDefault();
      setEnquiryDrag({
        enquiryId: enquiry.id,
        name: enquiry.name,
        x: event.clientX,
        y: event.clientY,
        laneId: null,
        startMs: null,
      });
    },
    [writable],
  );

  const enquiryDragActive = enquiryDrag !== null;
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      const target = event.target;
      // Skip only TEXT-entry surfaces — a focused checkbox still gets t/d/w/m.
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
      else if (event.key === "m") setRange("month", anchorMs);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [anchorMs, drag.state.phase, setRange, undo, view]);

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
          .querySelector(`[data-diary-lane="${result.id}"]`)
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
          <p className="diary-subtitle">{BOARD_COPY.subtitle}</p>
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
          <button type="button" className="diary-button" onClick={refetch}>
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
          <span
            className={`diary-live${live.connected ? " is-connected" : ""}`}
            title={BOARD_COPY.presence.here(
              live.presence
                .filter((person) => person.userId !== user?.id)
                .map((person) => person.name),
            )}
          >
            {live.connected ? BOARD_COPY.presence.live : BOARD_COPY.presence.offline}
            {live.presence.length > 0 ? ` · ${String(live.presence.length)}` : ""}
          </span>
        </div>
        <ul className="diary-legend" aria-label="Legend">
          <li className="diary-legend-item is-ink">{BOARD_COPY.legend.ink}</li>
          <li className="diary-legend-item is-hold">{BOARD_COPY.legend.hold}</li>
          <li className="diary-legend-item is-prospect">{BOARD_COPY.legend.prospect}</li>
          <li className="diary-legend-item is-internal_block">{BOARD_COPY.legend.internal_block}</li>
          <li className="diary-legend-item is-phase">{BOARD_COPY.legend.phase}</li>
        </ul>
      <footer className="diary-title-block" aria-label="Sheet details">
        <span className="diary-title-block-name">{BOARD_COPY.titleBlock.sheet}</span>
        <span className="diary-title-block-field">
          {BOARD_COPY.titleBlock.drawnBy}: {BOARD_COPY.titleBlock.drawnByValue}
        </span>
        <span className="diary-title-block-field">
          {BOARD_COPY.titleBlock.rangeLabel}: {rangeTitle(range)}
        </span>
      </footer>
      </header>

      {status === "error" ? (
        <div className="diary-notice is-error" role="alert">
          <p>{BOARD_COPY.errorTitle}</p>
          {error !== null ? <p className="diary-notice-detail">{error}</p> : null}
          <button type="button" className="diary-button" onClick={refetch}>
            {BOARD_COPY.retry}
          </button>
        </div>
      ) : data === null ? (
        <div className="diary-notice" role="status">
          {BOARD_COPY.loading}
        </div>
      ) : (
        <div className="diary-layout">
          <BoardGrid
            rooms={rooms}
            entries={entries}
            range={range}
            pxPerHour={PX_PER_HOUR[view]}
            conflictSeverity={conflictSeverity}
            drag={drag}
            writable={writable}
            nowMs={nowMs}
            turnaroundRules={data?.turnaroundRules}
          />
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
              canConvert={writable}
              onConvertEnquiry={openConvertDrawer}
              onBeginEnquiryDrag={writable ? beginEnquiryDrag : undefined}
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
            setDrawer(null);
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
