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
import { useCalendar } from "./hooks/useCalendar.js";
import { useBoardDrag } from "./hooks/useBoardDrag.js";
import { useDiaryLive } from "./hooks/useDiaryLive.js";
import { listEnquiries, type Enquiry } from "../../api/enquiries.js";
import { BoardGrid } from "./components/BoardGrid.js";
import { BookingDrawer } from "./components/BookingDrawer.js";
import { ConflictRail, HoldingTray, InkConfirm, UndoToast } from "./components/BoardPanels.js";
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

const PX_PER_HOUR: Record<BoardView, number> = { day: 96, week: 18, month: 3 };
const VIEWS: readonly BoardView[] = ["day", "week", "month"];
const TOAST_MS = 7_000;
const NOW_TICK_MS = 60_000;
const SEVERITY_RANK: Record<ConflictSeverity, number> = { blocking: 3, warning: 2, info: 1 };

function isBoardView(value: string | null): value is BoardView {
  return value === "day" || value === "week" || value === "month";
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
    (enquiryId: string) => {
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
      });
    },
    [openDrawer, openEnquiries, user],
  );

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
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (drag.state.phase !== "idle") return;
      if (event.key === "t") setRange(view, Date.now());
      else if (event.key === "d") setRange("day", anchorMs);
      else if (event.key === "w") setRange("week", anchorMs);
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

  if (user !== null && venueId === null) {
    return (
      <main className="diary-page" aria-label={BOARD_COPY.title}>
        <div className="diary-notice">{BOARD_COPY.noVenue}</div>
      </main>
    );
  }

  return (
    <main className="diary-page" aria-label={BOARD_COPY.title}>
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
            />
            <ConflictRail report={data.conflicts} onFocusEntry={focusEntry} />
            {entries.length === 0 ? (
              <p className="diary-panel-empty">{BOARD_COPY.emptyRange}</p>
            ) : null}
          </aside>
        </div>
      )}

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
    </main>
  );
}

export default DiaryBoardPage;
