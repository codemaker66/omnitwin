import { useId, useState, type ReactElement } from "react";
import { ChevronDown } from "lucide-react";
import { sameVenueDay, venueDayOf } from "../../lib/evening-window.js";
import { msToWallInput, wallInputToMs, VENUE_TIME_ZONE } from "../../pages/diary/lib/board-time.js";
import { useHallTimeStore } from "../../stores/hall-time-store.js";
import { QuietKey } from "./Keys.js";
import { Popover, usePopoverState } from "./Popover.js";
import "./chrome.css";
import "./evening.css";

// ---------------------------------------------------------------------------
// The evening's date (T-674, v2 slice 10; spec 6.2): a menu that moves the
// hour to another day at the same time of its evening: the event's day,
// today, or any day typed or picked. The day is the venue's (06:00 to 06:00),
// so 00:30 after a dinner is still that dinner's day.
// ---------------------------------------------------------------------------

const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", { timeZone: VENUE_TIME_ZONE, weekday: "short", day: "numeric", month: "short", year: "numeric" });

/** "Sat 28 Nov 2026", or "Sat 28 Nov" without the year. */
export function dayWords(at: number, withYear: boolean): string {
  const parts = DAY_FORMAT.formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((entry) => entry.type === type)?.value ?? "";
  const day = `${part("weekday")} ${part("day")} ${part("month")}`;
  return withYear ? `${day} ${part("year")}` : day;
}

/** The years the date field takes; a year half typed ("0202") never sends the hall there. */
const FIRST_YEAR = 1900;
const LAST_YEAR = 2200;
const DATE_PATTERN = /^(\d{4})-\d{2}-\d{2}$/u;

export interface EveningDateProps {
  readonly at: number;
  /** The event's start, offered as its day. */
  readonly eventStart: number | null;
  /** The phone's shorter words and 44 px key. */
  readonly compact: boolean;
}

export function EveningDate({ at, eventStart, compact }: EveningDateProps): ReactElement {
  const menu = usePopoverState();
  const fieldId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const day = venueDayOf(at);
  const offset = at - day.start;
  // The venue day's calendar date: the date of its 06:00.
  const dayKey = msToWallInput(day.start, VENUE_TIME_ZONE).slice(0, 10);
  const now = Date.now();

  const moveTo = (dayStart: number, close: boolean): void => {
    useHallTimeStore.getState().setTime(dayStart + offset);
    if (close) menu.close(true);
  };

  return (
    <>
      <button
        ref={menu.triggerRef}
        type="button"
        className={["pc-quiet", "pc-evening__date", compact ? "pc-evening__touch" : ""].filter(Boolean).join(" ")}
        aria-label={`Date: ${dayWords(day.start, true)}`}
        aria-expanded={menu.open}
        {...menu.triggerProps}
        onClick={menu.toggle}
      >
        <span className="pc-num">{dayWords(day.start, !compact)}</span>
        <ChevronDown className="pc-icon pc-evening__chevron" aria-hidden="true" />
      </button>
      <Popover state={menu} label="The date" align="end" side="above" chrome="evening-date" className="pc-evening__date-menu">
        <div className="pc-popover__section">
          {eventStart !== null && !sameVenueDay(eventStart, at) ? (
            <QuietKey label={`${dayWords(eventStart, true)}, the event`} onPress={() => { moveTo(venueDayOf(eventStart).start, true); }} />
          ) : null}
          {!sameVenueDay(now, at) ? <QuietKey label="Today" onPress={() => { moveTo(venueDayOf(now).start, true); }} /> : null}
          <div className="pc-field">
            <label className="pc-field__label" htmlFor={fieldId}>Another day</label>
            <div className="pc-field__well">
              <input
                id={fieldId}
                className="pc-field__input"
                type="date"
                value={draft ?? dayKey}
                onChange={(event) => {
                  const value = event.target.value;
                  setDraft(value);
                  const year = DATE_PATTERN.exec(value)?.[1];
                  if (year === undefined || Number(year) < FIRST_YEAR || Number(year) > LAST_YEAR) return;
                  const noon = wallInputToMs(`${value}T12:00`, VENUE_TIME_ZONE);
                  if (noon !== null) moveTo(venueDayOf(noon).start, false);
                }}
                onBlur={() => { setDraft(null); }}
              />
            </div>
          </div>
        </div>
        <p className="pc-popover__foot pc-meta">The hour stays the same; only the day moves.</p>
      </Popover>
    </>
  );
}
