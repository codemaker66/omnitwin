import { memo, useCallback, useMemo, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type ReactElement } from "react";
import { AlertTriangle, ArrowRight, CalendarDays, Plus } from "lucide-react";
import type { CalendarBookingEntry, CalendarEntry, CalendarRoom, ConflictSeverity } from "@omnitwin/types";
import { diaryRoomPhoto, DIARY_ROOM_PHOTO_SIZES } from "../../../lib/diary-room-photos.js";
import { TRADES_HALL_ROOM_CAPACITIES, type PublishedRoomSlug } from "../../../lib/trades-hall-venue-truth.js";
import { dayColumns, msToWallInput, type BoardRange } from "../lib/board-time.js";
import { buildOverviewIndex, type OverviewItem } from "../lib/board-overview.js";
import { decisionAge } from "../lib/decision-age.js";
import { NAV_KEYS, overviewMove, type NavPlace } from "../lib/overview-nav.js";
import { BookingState } from "./BookingState.js";
import { BOARD_COPY } from "../board-copy.js";

export interface BoardOverviewProps {
  readonly rooms: readonly CalendarRoom[];
  readonly entries: readonly CalendarEntry[];
  readonly range: BoardRange;
  readonly nowMs: number;
  readonly conflictSeverity: ReadonlyMap<string, ConflictSeverity>;
  readonly onOpenBooking: (entry: CalendarBookingEntry) => void;
  readonly onOpenDay: (startMs: number) => void;
  /** Create-in-context (T-619): open the drawer on this room and this DAY —
   *  a square of the overview is a day, not an instant, so the drawer gives
   *  it the house's default hours. Undefined for a read-only role. */
  readonly onCreateOnDay?: (spaceId: string, dayStartMs: number) => void;
  /** The range is on its way: rooms and days stand, and no room claims a
   *  number of bookings the board has not read. */
  readonly pending?: boolean;
  /** The day Go to date named, marked in the axis. */
  readonly soughtDayMs?: number | null;
}

const NO_ITEMS: readonly OverviewItem[] = [];

/** The keys naming each place the keyboard can land on (roadmap N3). */
const dayKey = (dayMs: number): string => `day:${String(dayMs)}`;
const bookingKey = (entryId: string, dayMs: number): string => `booking:${entryId}:${String(dayMs)}`;
const newKey = (roomId: string, dayMs: number): string => `new:${roomId}:${String(dayMs)}`;

function placeOf(target: EventTarget | null): NavPlace | null {
  if (!(target instanceof HTMLElement) || target.dataset["navKey"] === undefined) return null;
  const { navRow, navCol, navStack } = target.dataset;
  return { row: Number(navRow), col: Number(navCol), stack: Number(navStack) };
}

/** Memoised: the page re-renders for toasts, presence, refresh status and
 *  enquiry loads, none of which change what the overview shows. The index
 *  is rebuilt only when the entries (or the visible days) change, so a render
 *  costs one pass over the visible cards — no per-cell filtering or Intl. */
export const BoardOverview = memo(function BoardOverview({ rooms, entries, range, nowMs, conflictSeverity, onOpenBooking, onOpenDay, onCreateOnDay, pending = false, soughtDayMs = null }: BoardOverviewProps): ReactElement {
  const days = useMemo(() => dayColumns(range), [range]);
  const columns = useMemo(() => days.map((day) => ({ day, date: msToWallInput(day.startMs).slice(0, 10) })), [days]);
  const index = useMemo(() => buildOverviewIndex(entries, days), [entries, days]);
  const writable = onCreateOnDay !== undefined;

  // One Tab stop for the whole grid (roadmap N3): the place last landed on,
  // by click, arrow or a drawer handing focus back, while the board still
  // shows it; otherwise today's heading, or the range's first.
  const [stop, setStop] = useState<string | null>(null);
  const navKeys = useMemo(() => {
    const keys = new Set(days.map((day) => dayKey(day.startMs)));
    for (const room of rooms) {
      const roomCells = index.cells.get(room.id);
      for (const day of days) {
        for (const item of roomCells?.get(day.startMs) ?? NO_ITEMS) if (item.type === "booking") keys.add(bookingKey(item.entry.id, day.startMs));
        if (writable) keys.add(newKey(room.id, day.startMs));
      }
    }
    return keys;
  }, [days, rooms, index, writable]);
  const today = days.find((day) => nowMs >= day.startMs && nowMs < day.endMs) ?? days[0];
  const tabStop = stop !== null && navKeys.has(stop) ? stop : today === undefined ? null : dayKey(today.startMs);
  const nav = (key: string, row: number, col: number, stack: number): Record<string, string | number> => ({
    "data-nav-key": key, "data-nav-row": row, "data-nav-col": col, "data-nav-stack": stack, tabIndex: key === tabStop ? 0 : -1,
  });
  const followFocus = useCallback((event: FocusEvent<HTMLDivElement>): void => {
    const key = event.target instanceof HTMLElement ? event.target.dataset["navKey"] : undefined;
    if (key !== undefined) setStop(key);
  }, []);
  const moveFocus = useCallback((event: KeyboardEvent<HTMLDivElement>): void => {
    if (!NAV_KEYS.has(event.key) || event.altKey || event.metaKey || event.shiftKey) return;
    const from = placeOf(event.target);
    if (from === null) return;
    // The arrows are the grid's own here: nothing scrolls or re-ranges.
    event.preventDefault();
    const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-nav-key]"));
    const places = elements.map((element) => placeOf(element) ?? from);
    const next = overviewMove(places, from, event.key, event.ctrlKey);
    if (next === null) return;
    const target = elements[places.findIndex((place) => place.row === next.row && place.col === next.col && place.stack === next.stack)];
    // Focus alone leaves a place half under the sticky days; nearest honours
    // the scroller's padding and moves no further than it must. Instant: a
    // key press never glides, whatever the page's own scroll behaviour.
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  }, []);

  return <section className={`diary-overview${pending ? " is-pending" : ""}`} aria-label="Booking overview" aria-busy={pending}>
    <div className="diary-overview-intro"><span><CalendarDays size={16} />{days.length === 7 ? "Week overview" : "Booking overview"}</span>
      <p>Open a day for the timeline.</p></div>
    <div className="diary-overview-scroll" role="region" aria-label="Room and day booking summaries">
      <div className={`diary-overview-grid${days.length > 7 ? " is-long-range" : ""}`} style={{ "--diary-days": days.length } as CSSProperties}
        onKeyDown={moveFocus} onFocus={followFocus}>
        <div className="diary-overview-row diary-overview-axis">
          <div className="diary-overview-room-heading">Rooms <span>{rooms.length}</span></div>
          {days.map((day, col) => <button type="button" key={day.startMs} {...nav(dayKey(day.startMs), 0, col, 0)} className={`diary-overview-day${nowMs >= day.startMs && nowMs < day.endMs ? " is-today" : ""}${day.startMs === soughtDayMs ? " is-sought" : ""}`}
            onClick={() => { onOpenDay(day.startMs); }} aria-label={`Open ${day.label} in Day view`}>
            <span>{day.label}</span>{nowMs >= day.startMs && nowMs < day.endMs ? <small>Today</small> : <ArrowRight size={13} />}</button>)}
        </div>
        {rooms.map((room, roomIndex) => {
          const row = roomIndex + 1;
          const photo = diaryRoomPhoto(room.slug);
          const capacity = room.slug in TRADES_HALL_ROOM_CAPACITIES ? TRADES_HALL_ROOM_CAPACITIES[room.slug as PublishedRoomSlug].reception : null;
          const activeCount = index.activeBookings.get(room.id) ?? 0;
          const roomCells = index.cells.get(room.id);
          return <div key={room.id} className="diary-overview-row" data-diary-room={room.id}>
            <div className="diary-overview-room">
              {photo === null ? null : <img src={photo.src} srcSet={photo.srcSet} sizes={DIARY_ROOM_PHOTO_SIZES} alt=""
                width={photo.width} height={photo.height} style={{ objectPosition: photo.objectPosition }} loading="lazy" decoding="async"
                onError={(event) => { event.currentTarget.hidden = true; }} />}
              <div><h2>{room.name}</h2>{capacity !== null ? <span>{capacity} reception</span> : null}
                <small className={pending ? "is-pending" : undefined} aria-hidden={pending || undefined}>{activeCount} {activeCount === 1 ? "booking" : "bookings"}</small></div>
            </div>
            {columns.map(({ day, date }, col) => {
              const items = roomCells?.get(day.startMs) ?? NO_ITEMS;
              const bookings = items.filter((item) => item.type === "booking");
              return <div key={day.startMs} className={`diary-overview-cell${day.isWeekend ? " is-weekend" : ""}`}
              data-diary-day={date} aria-label={`${room.name}, ${day.label}`}>
              {items.map((item) => {
                if (item.type === "phase") return <div key={item.entry.id} className="diary-overview-phase">
                  <span>Occupancy footprint</span><strong>{item.entry.name}</strong><small>{item.entry.eventName}</small><time>{item.timeLabel}</time></div>;
                const { entry, timeLabel, stateLabel } = item;
                const severity = conflictSeverity.get(entry.id);
                const continuation = item.startMs < day.startMs;
                // A live hold's decision age, once a week or less remains
                // (roadmap N3's encoding by luminance).
                const age = entry.status === "active" && entry.kind === "hold" ? decisionAge(entry.decisionAt, nowMs) : null;
                const client = entry.clientName ?? "";
                const guests = entry.guestCount === null || entry.guestCount === undefined ? "" : `${String(entry.guestCount)} guests`;
                const detail = [entry.title, timeLabel, stateLabel, client, guests].filter(Boolean).join(" · ");
                return <button type="button" key={entry.id} {...nav(bookingKey(entry.id, day.startMs), row, col, bookings.indexOf(item))}
                  id={item.anchorDayMs === day.startMs ? `diary-block-${entry.id}` : `diary-block-${entry.id}-${String(day.startMs)}`}
                  data-booking-id={entry.id}
                  className={`diary-overview-booking is-${entry.status === "active" ? entry.kind : "exited"}${severity === undefined ? "" : ` has-${severity}`}`}
                  onClick={() => { onOpenBooking(entry); }}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpenBooking(entry); } }}
                  title={detail}
                  aria-label={`${entry.title} — ${stateLabel}, ${timeLabel}, ${room.name}, ${day.label}${client.length > 0 ? `, ${client}` : ""}${guests.length > 0 ? `, ${guests}` : ""}${age === null ? "" : `, ${age}`}${continuation ? ", continues from an earlier day" : ""}${severity === undefined ? "" : `, ${severity} conflict`}`}>
                  {continuation ? <small className="diary-overview-continuation">Continues</small> : null}
                  <strong>{entry.title}</strong><time>{timeLabel}</time>
                  <span className="diary-overview-meta"><span className="diary-overview-status"><BookingState entry={entry} /></span>
                    {age === null ? null : <span className="diary-overview-age">{age}</span>}
                    {severity !== undefined ? <span className={`diary-overview-warning is-${severity}`}><AlertTriangle size={12} />{severity === "blocking" ? "Conflict" : "Review"}</span> : null}</span>
                </button>;
              })}
              {/* Create-in-context (T-619): the obvious gesture on an empty
                  square of a calendar is to click it. A real <button>, after
                  the day's bookings, taking whatever room they leave. */}
              {onCreateOnDay === undefined ? null : <button type="button" className="diary-overview-new"
                {...nav(newKey(room.id, day.startMs), row, col, bookings.length)}
                aria-label={BOARD_COPY.create.cellLabel(room.name, day.label)}
                onClick={() => { onCreateOnDay(room.id, day.startMs); }}>
                <Plus size={13} aria-hidden="true" /><span>{BOARD_COPY.create.cellHint}</span></button>}
            </div>;
            })}
          </div>;
        })}
      </div>
    </div>
  </section>;
});
