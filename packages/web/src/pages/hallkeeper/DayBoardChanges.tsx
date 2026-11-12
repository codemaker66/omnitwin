import { useEffect, useRef, type ReactElement } from "react";
import type { FloorChange } from "@omnitwin/types";
import { formatWallDay, formatWallTime } from "../diary/lib/board-time.js";
import { ActivityIndicator } from "../../components/shared/Activity.js";

// ---------------------------------------------------------------------------
// What changed, in the floor's words, wherever the board shows it: the open
// slot's panel (DayBoardSlotDetail.tsx) and the notice for a function seen on
// this day that has left it. One rule for both, so a change reads the same
// in either place.
// ---------------------------------------------------------------------------

/** When a change was made: the time today, the day and time before that. */
export function changeWhen(atMs: number, nowMs: number, timeZone: string): string {
  const time = formatWallTime(atMs, timeZone);
  return formatWallDay(atMs, timeZone) === formatWallDay(nowMs, timeZone) ? time : `${formatWallDay(atMs, timeZone)}, ${time}`;
}

/** Got it, for one change or several. */
export function gotItLabel(count: number): string {
  return count === 1 ? "Got it" : `Got all ${String(count)}`;
}

/**
 * Each change with its title and time, its sentence, and where it stood and
 * stands (Was and Now) when those differ. A Diary move's Was and Now carry
 * its room and exact hours, so it is said once, by them; every other change
 * keeps its sentence, whatever its Was and Now happen to hold (an older
 * event edit's carry only the guests).
 */
export function ChangeList({ changes, timeZone, nowMs }: {
  readonly changes: readonly FloorChange[];
  readonly timeZone: string;
  readonly nowMs: number;
}): ReactElement {
  return (
    <ol className="dayboard-changes-list">
      {changes.map((change) => {
        const fromTo = change.beforeSummary !== null && change.afterSummary !== null && change.beforeSummary !== change.afterSummary;
        const saysMore = !fromTo || change.movedTo === null;
        return (
          <li key={change.id} className="dayboard-change">
            <p className="dayboard-change-title">
              {change.title}<span className="dayboard-change-when"> · {changeWhen(Date.parse(change.createdAt), nowMs, timeZone)}</span>
            </p>
            {saysMore && <p className="dayboard-change-summary">{change.summary}</p>}
            {fromTo && (
              <dl className="dayboard-change-fromto">
                <div><dt>Was</dt><dd>{change.beforeSummary}</dd></div>
                <div><dt>Now</dt><dd>{change.afterSummary}</dd></div>
              </dl>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * A function seen on this day that has left it, with the changes that
 * concern the day still waiting. Said as a move off the day only when a Diary
 * move put one of its bookings elsewhere; otherwise (cancelled, released, its
 * room taken away) it is no longer on the day, and its changes say the rest.
 * One Got it for all of them, as on the panel.
 */
export function LeftTheDay({ title, movedOff, changes, timeZone, nowMs, onAcknowledge, sending, note }: {
  readonly title: string;
  /** A waiting Diary move put the function on another day. */
  readonly movedOff: boolean;
  readonly changes: readonly FloorChange[];
  readonly timeZone: string;
  readonly nowMs: number;
  /** Null where nothing may be acknowledged (the wall, a role that only reads). */
  readonly onAcknowledge: (() => void) | null;
  readonly sending: boolean;
  /** What the last Got it here came to, when that needs saying. */
  readonly note: string | null;
}): ReactElement {
  return (
    <div className="dayboard-notice dayboard-moved-off" role="status">
      <p className="dayboard-moved-off-head">
        <strong>{title}</strong> {movedOff ? "has moved off this day." : "is no longer on this day."}
      </p>
      <ChangeList changes={changes} timeZone={timeZone} nowMs={nowMs} />
      {onAcknowledge !== null && (
        // Never disabled: a disabled button drops the keyboard's place to the
        // page, and on a failed send nothing would bring it back.
        <button
          type="button"
          className="dayboard-button dayboard-moved-off-ack"
          aria-busy={sending}
          aria-disabled={sending}
          onClick={() => { if (!sending) onAcknowledge(); }}
        >
          {sending && <ActivityIndicator size={14} />}
          {gotItLabel(changes.length)}
        </button>
      )}
      {note !== null && <p className="dayboard-moved-off-note">{note}</p>}
    </div>
  );
}

/**
 * The notices of functions that have left the day. When one leaves under the
 * keyboard (its Got it went through), the keyboard's place goes to the day's
 * sentence, a stable place near the top, not to the document.
 */
export function LeftTheDayList({ children, count, focusAfter }: {
  readonly children: ReactElement[];
  readonly count: number;
  /** Where the keyboard goes once a notice it was in has gone. */
  readonly focusAfter: () => void;
}): ReactElement | null {
  const listRef = useRef<HTMLDivElement>(null);
  const hadFocus = useRef(false);
  const previous = useRef(count);
  useEffect(() => {
    // The notice holding the keyboard has gone: focus fell to the document.
    if (count < previous.current && hadFocus.current && (document.activeElement === null || document.activeElement === document.body)) {
      focusAfter();
    }
    previous.current = count;
  }, [count, focusAfter]);
  if (count === 0) return null;
  return (
    <div
      ref={listRef}
      className="dayboard-moved-off-list"
      onFocus={() => { hadFocus.current = true; }}
      onBlur={(event) => { hadFocus.current = listRef.current?.contains(event.relatedTarget) === true; }}
    >
      {children}
    </div>
  );
}
