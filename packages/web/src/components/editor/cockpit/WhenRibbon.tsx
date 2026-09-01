import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError } from "../../../api/client.js";
import { moveBooking } from "../../../api/diary.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { useLinkedEvent } from "../../../hooks/use-linked-event.js";
import { useCalendar } from "../../../pages/diary/hooks/useCalendar.js";
import { useDiaryLive } from "../../../pages/diary/hooks/useDiaryLive.js";
import {
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
  buildRibbonDay,
  dropRibbonDrag,
  moveRibbonDrag,
  type RibbonDay,
  type RibbonDrag,
  type RibbonDragMode,
} from "./when-ribbon-model.js";
import { RIBBON_COPY } from "./when-ribbon-copy.js";
import "./when-ribbon.css";

// ---------------------------------------------------------------------------
// The When ribbon (Day Board S2; docs/plan/hallkeeper-day-board-plan.md §2)
// — the plan's booking as a draggable gilt ingot over its room's day strip.
//
// LAW: times are set through the Diary booking — the ribbon writes ONE
// moveBooking PATCH (idempotent command path) and re-reads GET /calendar;
// it never keeps its own time store.
//
// Feel: the ingot tracks the pointer 1:1 (never gated behind reduced
// motion); 15-minute snapping lives on a landing shadow, not on the
// grabbed bar (hard mid-drag snapping reads as magnetism); the release
// spring-settles onto the snapped span. Ink ghosts are walls (DB truth) —
// the bar compresses against them with a rubber offset and bounces back.
// Turnaround buffers are hatched guidance you can push through — the
// team judges. Ink moves keep the confirm step: ink resists.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60_000;
const HOUR_MS = 3_600_000;
/** Settle onto the snapped span (design language: deliberate, 200–300ms). */
const INGOT_SETTLE: SpringConfig = { stiffness: 380, damping: 32 };
/** The bounce off an inked wall — deliberately underdamped, a visible wobble. */
const INGOT_BOUNCE: SpringConfig = { stiffness: 300, damping: 18 };
/** Rubber compression: asymptotic give, never a hard visual stop. */
function rubberPx(overshootPx: number): number {
  return overshootPx / (1 + Math.abs(overshootPx) / 36);
}

interface PointerSession {
  readonly pointerId: number;
  readonly startClientX: number;
  readonly mode: RibbonDragMode;
}

interface PendingCommit {
  readonly startsAt: string;
  readonly endsAt: string;
  readonly warning: string | null;
}

interface UndoState {
  readonly startsAt: string;
  readonly endsAt: string;
}

type Notice =
  | { readonly kind: "warning" | "error"; readonly text: string }
  | { readonly kind: "moved"; readonly text: string };

function rangeLabel(startMs: number, endMs: number): string {
  return `${formatWallTime(startMs)} – ${formatWallTime(endMs)}`;
}

export function WhenRibbon(): ReactElement | null {
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get("eventId");
  const linked = useLinkedEvent();
  const user = useAuthStore((state) => state.user);
  const writable = user?.role === "staff" || user?.role === "admin";

  const venueId = linked.graph?.event.venueId ?? null;
  const eventStartsAt = linked.graph?.event.startsAt ?? null;
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
  const { data, status, refetch } = useCalendar(venueId, range);
  useDiaryLive(venueId !== null, refetch);

  const day = useMemo(
    () => (data === null || eventId === null ? null : buildRibbonDay(data, eventId)),
    [data, eventId],
  );
  useEffect(() => {
    if (data !== null && day === null && windowDays === 7) setWindowDays(90);
  }, [data, day, windowDays]);

  if (eventId === null || linked.status !== "loaded" || venueId === null) return null;

  return (
    <RibbonBody
      key={eventId}
      day={day}
      calendarStatus={status}
      writable={writable}
      refetch={refetch}
    />
  );
}

// The body is split out so hooks that need a loaded day stay unconditional.
function RibbonBody({
  day,
  calendarStatus,
  writable,
  refetch,
}: {
  readonly day: RibbonDay | null;
  readonly calendarStatus: "loading" | "ready" | "error";
  readonly writable: boolean;
  readonly refetch: () => void;
}): ReactElement | null {
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
  // for. Cleared whenever fresh calendar data arrives (day identity turns
  // over) or the PATCH fails.
  const [override, setOverride] = useState<{ startMs: number; endMs: number } | null>(null);
  useEffect(() => { setOverride(null); }, [day]);

  const [drag, setDrag] = useState<RibbonDrag | null>(null);
  const [pending, setPending] = useState<PendingCommit | null>(null);
  const [undoable, setUndoable] = useState<UndoState | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [keyboardDrag, setKeyboardDrag] = useState<RibbonDrag | null>(null);

  const sessionRef = useRef<PointerSession | null>(null);
  const springRef = useRef<{ state: SpringState; target: number; raf: number | null }>({
    state: { value: 0, velocity: 0 },
    target: 0,
    raf: null,
  });

  const self = day === null
    ? null
    : override === null
      ? day.self
      : { ...day.self, startMs: override.startMs, endMs: override.endMs };

  const pxPerHour = stripWidth / 24;
  const msToPx = useCallback(
    (ms: number) => (ms / HOUR_MS) * pxPerHour,
    [pxPerHour],
  );

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
      const tick = (now: number): void => {
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
        spring.raf = requestAnimationFrame(tick);
      };
      spring.raf = requestAnimationFrame(tick);
    },
    [setOffsetPx, stopSpring],
  );

  useEffect(() => () => { stopSpring(); }, [stopSpring]);

  const commitMove = useCallback(
    (startsAt: string, endsAt: string, warning: string | null) => {
      if (day === null) return;
      const before: UndoState = {
        startsAt: new Date(day.self.startMs).toISOString(),
        endsAt: new Date(day.self.endMs).toISOString(),
      };
      setOverride({ startMs: Date.parse(startsAt), endMs: Date.parse(endsAt) });
      setOffsetPx(0);
      springRef.current.state = { value: 0, velocity: 0 };
      setPending(null);
      setNotice(warning === null ? null : { kind: "warning", text: warning });
      void moveBooking(day.self.id, { startsAt, endsAt })
        .then(() => {
          setUndoable(before);
          setNotice(
            warning !== null
              ? { kind: "warning", text: warning }
              : { kind: "moved", text: RIBBON_COPY.moved(rangeLabel(Date.parse(startsAt), Date.parse(endsAt))) },
          );
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
          setNotice({ kind: "error", text: RIBBON_COPY.moveFailed });
        });
    },
    [day, refetch, setOffsetPx],
  );

  const undoMove = useCallback(() => {
    if (day === null || undoable === null) return;
    const back = undoable;
    setUndoable(null);
    setNotice(null);
    setOverride({ startMs: Date.parse(back.startsAt), endMs: Date.parse(back.endsAt) });
    void moveBooking(day.self.id, { startsAt: back.startsAt, endsAt: back.endsAt })
      .then(() => { refetch(); })
      .catch(() => {
        setOverride(null);
        setNotice({ kind: "error", text: RIBBON_COPY.moveFailed });
      });
  }, [day, refetch, undoable]);

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
      if (finalDrag.mode === "move") {
        animateOffsetTo(proposedOffsetPx, bounced ? INGOT_BOUNCE : INGOT_SETTLE, () => {
          if (drop.needsInkConfirm) {
            setPending({ startsAt: drop.startsAt, endsAt: drop.endsAt, warning: drop.warning });
          } else {
            commitMove(drop.startsAt, drop.endsAt, drop.warning);
          }
        });
      } else {
        // Resize renders its proposal on the base span directly (width is
        // not springable as a transform without distorting the bar's text).
        if (drop.needsInkConfirm) {
          setPending({ startsAt: drop.startsAt, endsAt: drop.endsAt, warning: drop.warning });
        } else {
          commitMove(drop.startsAt, drop.endsAt, drop.warning);
        }
      }
    },
    [animateOffsetTo, commitMove, day, msToPx],
  );

  const beginPointerDrag = useCallback(
    (mode: RibbonDragMode) =>
      (event: React.PointerEvent<HTMLElement>) => {
        if (!writable || day === null) return;
        if (sessionRef.current !== null) return; // first pointer wins
        if (pending !== null) return;
        event.preventDefault();
        event.stopPropagation();
        stopSpring();
        setOffsetPx(0);
        springRef.current.state = { value: 0, velocity: 0 };
        sessionRef.current = {
          pointerId: event.pointerId,
          startClientX: event.clientX,
          mode,
        };
        const captureTarget = event.currentTarget;
        if (typeof captureTarget.setPointerCapture === "function") {
          captureTarget.setPointerCapture(event.pointerId);
        }
        const base = override === null
          ? day.self
          : { ...day.self, startMs: override.startMs, endMs: override.endMs };
        setDrag(beginRibbonDrag(mode, base));
        setNotice(null);
        setUndoable(null);
      },
    [day, override, pending, setOffsetPx, stopSpring, writable],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const session = sessionRef.current;
      if (session === null || day === null) return;
      if (event.pointerId !== session.pointerId) return;
      const rawDeltaPx = event.clientX - session.startClientX;
      const rawDeltaMs = (rawDeltaPx / pxPerHour) * HOUR_MS;
      const fine = event.shiftKey;
      setDrag((current) => {
        if (current === null) return current;
        const next = moveRibbonDrag(current, day, rawDeltaMs, fine);
        if (session.mode === "move") {
          // The bar itself follows the pointer 1:1, compressed against
          // hard walls — the snapped landing lives on the shadow.
          const clampedPx = next.overshootMs === 0
            ? msToPx(rawDeltaMs)
            : msToPx(next.proposedStartMs - next.originStartMs);
          const givePx = next.overshootMs === 0 ? 0 : rubberPx(msToPx(next.overshootMs));
          setOffsetPx(clampedPx + givePx);
        }
        return next;
      });
    },
    [day, msToPx, pxPerHour, setOffsetPx],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const session = sessionRef.current;
      if (session === null || event.pointerId !== session.pointerId) return;
      sessionRef.current = null;
      setDrag((current) => {
        if (current !== null) settleDrop(current);
        return null;
      });
    },
    [settleDrop],
  );

  const onPointerCancel = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const session = sessionRef.current;
      if (session === null || event.pointerId !== session.pointerId) return;
      sessionRef.current = null;
      animateOffsetTo(0, INGOT_SETTLE);
      setDrag(null);
    },
    [animateOffsetTo],
  );

  const onIngotKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (!writable || day === null || pending !== null) return;
      const base = override === null
        ? day.self
        : { ...day.self, startMs: override.startMs, endMs: override.endMs };
      const current = keyboardDrag ?? beginRibbonDrag(event.altKey ? "resize-end" : "move", base);
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const stepMs = (event.shiftKey ? 1 : 15) * 60_000;
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const already = current.mode === "resize-end"
          ? current.proposedEndMs - current.originEndMs
          : current.proposedStartMs - current.originStartMs;
        const next = moveRibbonDrag(current, day, already + direction * stepMs, event.shiftKey);
        setKeyboardDrag(next);
        setAnnouncement(
          next.overshootMs !== 0 && next.mode === "move"
            ? RIBBON_COPY.announceBlocked(
                day.ghosts.find((ghost) => ghost.exclusion === "hard")?.title ?? "an inked booking",
              )
            : RIBBON_COPY.announceMove(rangeLabel(next.proposedStartMs, next.proposedEndMs)),
        );
        return;
      }
      if (event.key === "Enter" && keyboardDrag !== null) {
        event.preventDefault();
        const drop = dropRibbonDrag(keyboardDrag, day);
        setKeyboardDrag(null);
        if (drop.effect === "commit") {
          // Keyboard commits are never animated — they repeat all day.
          if (drop.needsInkConfirm) {
            setPending({ startsAt: drop.startsAt, endsAt: drop.endsAt, warning: drop.warning });
          } else {
            commitMove(drop.startsAt, drop.endsAt, drop.warning);
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
    [commitMove, day, keyboardDrag, override, pending, writable],
  );

  if (day === null) {
    if (calendarStatus === "loading") return null;
    return (
      <aside className="when-ribbon" data-testid="when-ribbon" aria-label="When">
        <div className="when-ribbon__row">
          <span className="when-ribbon__eyebrow">{RIBBON_COPY.heading}</span>
          {calendarStatus === "error" ? (
            <span className="when-ribbon__note" role="note">
              {RIBBON_COPY.loadFailed}{" "}
              <button type="button" className="when-ribbon__link" onClick={refetch}>
                {RIBBON_COPY.tryAgain}
              </button>
            </span>
          ) : (
            <span className="when-ribbon__note" role="note">
              {RIBBON_COPY.notInDiary}{" "}
              <a className="when-ribbon__link" href="/diary?view=day">
                {RIBBON_COPY.openDiary}
              </a>
            </span>
          )}
        </div>
      </aside>
    );
  }
  if (self === null) return null;

  const active = drag ?? keyboardDrag;
  const shownStartMs = pending !== null
    ? Date.parse(pending.startsAt)
    : keyboardDrag?.proposedStartMs ?? (drag !== null && drag.mode !== "move" ? drag.proposedStartMs : self.startMs);
  const shownEndMs = pending !== null
    ? Date.parse(pending.endsAt)
    : keyboardDrag?.proposedEndMs ?? (drag !== null && drag.mode !== "move" ? drag.proposedEndMs : self.endMs);

  const ticks = hourTicks(day.range).filter((_, index) => index % 3 === 0);
  const nowMs = Date.now();
  const showNow = nowMs >= day.range.fromMs && nowMs < day.range.toMs;
  const shadowDrag =
    drag !== null &&
    drag.mode === "move" &&
    (drag.proposedStartMs !== drag.originStartMs || drag.proposedEndMs !== drag.originEndMs)
      ? drag
      : null;

  return (
    <aside className="when-ribbon" data-testid="when-ribbon" aria-label="When">
      <div className="when-ribbon__row">
        <span className="when-ribbon__eyebrow">{RIBBON_COPY.heading}</span>
        <span className="when-ribbon__day">{formatWallDay(day.range.fromMs)}</span>
        <span className="when-ribbon__note">
          {writable ? RIBBON_COPY.dragHint : RIBBON_COPY.readOnly}
        </span>
      </div>

      <div className="when-ribbon__strip" ref={stripRef} data-testid="when-ribbon-strip">
        {ticks.map((tick) => (
          <span
            key={tick.ms}
            className="when-ribbon__tick"
            style={{ left: `${String(msToX(tick.ms, day.range, pxPerHour))}px` }}
          >
            {tick.label}
          </span>
        ))}
        {showNow ? (
          <span
            className="when-ribbon__now"
            style={{ left: `${String(msToX(nowMs, day.range, pxPerHour))}px` }}
            aria-hidden="true"
          />
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
            title={`${ghost.title} · ${rangeLabel(ghost.startMs, ghost.endMs)}`}
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
          className={`when-ribbon__ingot${writable ? "" : " is-readonly"}${active !== null ? " is-active" : ""}`}
          data-testid="when-ribbon-ingot"
          role={writable ? "button" : undefined}
          tabIndex={writable ? 0 : undefined}
          aria-label={`${self.title}, ${rangeLabel(shownStartMs, shownEndMs)}. ${writable ? RIBBON_COPY.keyboardHint : RIBBON_COPY.readOnly}`}
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
            {rangeLabel(
              drag?.proposedStartMs ?? shownStartMs,
              drag?.proposedEndMs ?? shownEndMs,
            )}
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
        </div>
      </div>

      <div className="when-ribbon__foot">
        <span className="when-ribbon__disclosure">{RIBBON_COPY.disclosure}</span>
        {pending !== null ? (
          <span
            className="when-ribbon__confirm"
            data-testid="when-ribbon-confirm"
            role="alertdialog"
            aria-label={RIBBON_COPY.inkConfirm(rangeLabel(Date.parse(pending.startsAt), Date.parse(pending.endsAt)))}
          >
            {RIBBON_COPY.inkConfirm(rangeLabel(Date.parse(pending.startsAt), Date.parse(pending.endsAt)))}
            {pending.warning !== null ? (
              <span className="when-ribbon__confirm-warning">{pending.warning}</span>
            ) : null}
            <button
              type="button"
              className="when-ribbon__button when-ribbon__button--primary"
              onClick={() => { commitMove(pending.startsAt, pending.endsAt, pending.warning); }}
            >
              {RIBBON_COPY.inkConfirmYes}
            </button>
            <button
              type="button"
              className="when-ribbon__button"
              onClick={() => {
                setPending(null);
                animateOffsetTo(0, INGOT_SETTLE);
              }}
            >
              {RIBBON_COPY.inkConfirmNo}
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
      </div>

      <span className="when-ribbon__sr" aria-live="polite">{announcement}</span>
    </aside>
  );
}

export default WhenRibbon;
