import { useMemo, type CSSProperties, type ReactElement } from "react";
import { AlertTriangle, ArrowRight, CalendarDays } from "lucide-react";
import type { CalendarBookingEntry, CalendarEntry, CalendarRoom, ConflictSeverity } from "@omnitwin/types";
import { diaryRoomPhoto, DIARY_ROOM_PHOTO_SIZES } from "../../../lib/diary-room-photos.js";
import { TRADES_HALL_ROOM_CAPACITIES, type PublishedRoomSlug } from "../../../lib/trades-hall-venue-truth.js";
import { dayColumns, msToWallInput, type BoardRange } from "../lib/board-time.js";
import { bookingStateLabel, bookingTimeLabel, entriesForDay, firstVisibleDay } from "../lib/board-overview.js";

export interface BoardOverviewProps {
  readonly rooms: readonly CalendarRoom[];
  readonly entries: readonly CalendarEntry[];
  readonly range: BoardRange;
  readonly nowMs: number;
  readonly conflictSeverity: ReadonlyMap<string, ConflictSeverity>;
  readonly onOpenBooking: (entry: CalendarBookingEntry) => void;
  readonly onOpenDay: (startMs: number) => void;
}

export function BoardOverview({ rooms, entries, range, nowMs, conflictSeverity, onOpenBooking, onOpenDay }: BoardOverviewProps): ReactElement {
  const days = useMemo(() => dayColumns(range), [range]);
  const anchors = useMemo(() => new Map(entries.map((entry) => [entry.id, firstVisibleDay(entry, range)])), [entries, range]);
  return <section className="diary-overview" aria-label="Booking overview">
    <div className="diary-overview-intro"><span><CalendarDays size={16} />{days.length === 7 ? "Your week, at a glance" : "Your rooms, day by day"}</span>
      <p>Booking summaries · exact times shown. Open a day for the time scale.</p></div>
    <div className="diary-overview-scroll" role="region" aria-label="Room and day booking summaries" tabIndex={0}>
      <div className={`diary-overview-grid${days.length > 7 ? " is-long-range" : ""}`} style={{ "--diary-days": days.length } as CSSProperties}>
        <div className="diary-overview-row diary-overview-axis">
          <div className="diary-overview-room-heading">Rooms <span>{rooms.length}</span></div>
          {days.map((day) => <button type="button" key={day.startMs} className={`diary-overview-day${nowMs >= day.startMs && nowMs < day.endMs ? " is-today" : ""}`}
            onClick={() => { onOpenDay(day.startMs); }} aria-label={`Open ${day.label} in Day view`}>
            <span>{day.label}</span>{nowMs >= day.startMs && nowMs < day.endMs ? <small>Today</small> : <ArrowRight size={13} />}</button>)}
        </div>
        {rooms.map((room) => {
          const photo = diaryRoomPhoto(room.slug);
          const capacity = room.slug in TRADES_HALL_ROOM_CAPACITIES ? TRADES_HALL_ROOM_CAPACITIES[room.slug as PublishedRoomSlug].reception : null;
          const active = entries.filter((entry) => entry.spaceId === room.id && entry.entryType === "booking" && entry.status === "active");
          return <div key={room.id} className="diary-overview-row" data-diary-room={room.id}>
            <div className="diary-overview-room">
              {photo === null ? null : <img src={photo.src} srcSet={photo.srcSet} sizes={DIARY_ROOM_PHOTO_SIZES} alt=""
                width={photo.width} height={photo.height} style={{ objectPosition: photo.objectPosition }} loading="lazy" decoding="async"
                onError={(event) => { event.currentTarget.hidden = true; }} />}
              <div><h2>{room.name}</h2>{capacity !== null ? <span>{capacity} reception</span> : null}
                <small>{active.length} {active.length === 1 ? "booking" : "bookings"}</small></div>
            </div>
            {days.map((day) => <div key={day.startMs} className={`diary-overview-cell${day.isWeekend ? " is-weekend" : ""}`}
              data-diary-day={msToWallInput(day.startMs).slice(0, 10)} aria-label={`${room.name}, ${day.label}`}>
              {entriesForDay(entries, room.id, day).map((entry) => {
                if (entry.entryType === "phase") return <div key={entry.id} className="diary-overview-phase">
                  <span>Occupancy footprint</span><strong>{entry.name}</strong><small>{entry.eventName}</small><time>{bookingTimeLabel(entry)}</time></div>;
                const severity = conflictSeverity.get(entry.id);
                const continuation = Date.parse(entry.startsAt) < day.startMs;
                const client = entry.clientName ?? "";
                const guests = entry.guestCount === null || entry.guestCount === undefined ? "" : `${String(entry.guestCount)} guests`;
                const detail = [entry.title, bookingTimeLabel(entry), bookingStateLabel(entry), client, guests].filter(Boolean).join(" · ");
                return <button type="button" key={entry.id}
                  id={anchors.get(entry.id) === day.startMs ? `diary-block-${entry.id}` : `diary-block-${entry.id}-${String(day.startMs)}`}
                  data-booking-id={entry.id}
                  className={`diary-overview-booking is-${entry.status === "active" ? entry.kind : "exited"}${severity === undefined ? "" : ` has-${severity}`}`}
                  onClick={() => { onOpenBooking(entry); }}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpenBooking(entry); } }}
                  title={detail}
                  aria-label={`${entry.title} — ${bookingStateLabel(entry)}, ${bookingTimeLabel(entry)}, ${room.name}, ${day.label}${client.length > 0 ? `, ${client}` : ""}${guests.length > 0 ? `, ${guests}` : ""}${continuation ? ", continues from an earlier day" : ""}${severity === undefined ? "" : `, ${severity} conflict`}`}>
                  {continuation ? <small className="diary-overview-continuation">Continues</small> : null}
                  <strong>{entry.title}</strong><time>{bookingTimeLabel(entry)}</time>
                  <span className="diary-overview-meta"><span className="diary-overview-status">{bookingStateLabel(entry)}</span>
                    {severity !== undefined ? <span className={`diary-overview-warning is-${severity}`}><AlertTriangle size={12} />{severity === "blocking" ? "Conflict" : "Review"}</span> : null}</span>
                </button>;
              })}
            </div>)}
          </div>;
        })}
      </div>
    </div>
  </section>;
}
