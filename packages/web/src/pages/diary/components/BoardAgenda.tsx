import { memo, useMemo, type ReactElement } from "react";
import { AlertTriangle, ArrowRight, Plus } from "lucide-react";
import type { CalendarBookingEntry, CalendarEntry, CalendarRoom, ConflictSeverity } from "@omnitwin/types";
import { dayColumns, type BoardRange } from "../lib/board-time.js";
import { buildOverviewIndex, type OverviewItem } from "../lib/board-overview.js";
import { decisionAge } from "../lib/decision-age.js";
import { BookingState } from "./BookingState.js";
import { BOARD_COPY } from "../board-copy.js";

export interface BoardAgendaProps {
  readonly rooms: readonly CalendarRoom[];
  readonly entries: readonly CalendarEntry[];
  readonly range: BoardRange;
  readonly nowMs: number;
  readonly conflictSeverity: ReadonlyMap<string, ConflictSeverity>;
  readonly onOpenBooking: (entry: CalendarBookingEntry) => void;
  readonly onOpenDay: (startMs: number) => void;
  /** Undefined for a read-only role. */
  readonly onCreateOnDay?: (spaceId: string, dayStartMs: number) => void;
  /** The range is on its way: its days stand, and none claims to be empty. */
  readonly pending?: boolean;
  /** The day Go to date named. */
  readonly soughtDayMs?: number | null;
}

interface AgendaItem {
  readonly room: CalendarRoom;
  readonly item: OverviewItem;
}

/** The week on a phone (roadmap N3): day by day, each day's bookings in time
 *  order across the rooms, where the overview's grid was wider than the
 *  screen. The overview's own index, labels and focus anchors, so a booking
 *  opens the same drawer and gets focus back when it closes. */
export const BoardAgenda = memo(function BoardAgenda({ rooms, entries, range, nowMs, conflictSeverity, onOpenBooking, onOpenDay, onCreateOnDay, pending = false, soughtDayMs = null }: BoardAgendaProps): ReactElement {
  const days = useMemo(() => dayColumns(range), [range]);
  const index = useMemo(() => buildOverviewIndex(entries, days), [entries, days]);
  const roomOrder = useMemo(() => new Map(rooms.map((room, position) => [room.id, position])), [rooms]);
  const firstRoom = rooms[0];
  const copy = BOARD_COPY.agenda;

  return <section className="diary-agenda" aria-label={copy.label} aria-busy={pending}>
    <ol className="diary-agenda-days">
      {days.map((day) => {
        const today = nowMs >= day.startMs && nowMs < day.endMs;
        const items: AgendaItem[] = rooms
          .flatMap((room) => (index.cells.get(room.id)?.get(day.startMs) ?? []).map((item) => ({ room, item })))
          .sort((a, b) => a.item.startMs - b.item.startMs
            || (roomOrder.get(a.room.id) ?? 0) - (roomOrder.get(b.room.id) ?? 0)
            || a.item.entry.id.localeCompare(b.item.entry.id));
        return <li key={day.startMs} className={`diary-agenda-day${today ? " is-today" : ""}${day.startMs === soughtDayMs ? " is-sought" : ""}`}>
          <h3 className="diary-agenda-heading">
            <button type="button" className="diary-agenda-dayname" aria-label={copy.openDay(day.label)}
              onClick={() => { onOpenDay(day.startMs); }}>
              <span>{day.label}</span>{today ? <small>{BOARD_COPY.today}</small> : <ArrowRight size={13} aria-hidden="true" />}
            </button>
            {onCreateOnDay === undefined || firstRoom === undefined ? null : (
              <button type="button" className="diary-agenda-add" aria-label={copy.addLabel(day.label)}
                onClick={() => { onCreateOnDay(firstRoom.id, day.startMs); }}>
                <Plus size={13} aria-hidden="true" />{copy.add}
              </button>
            )}
          </h3>
          {items.length === 0 ? (pending ? null : <p className="diary-agenda-free">{copy.free}</p>) : (
            <ul className="diary-agenda-list">
              {items.map(({ room, item }) => {
                if (item.type === "phase") {
                  return <li key={item.entry.id} className="diary-agenda-phase">
                    <time className="diary-agenda-time">{item.timeLabel}</time>
                    <span className="diary-agenda-title">{item.entry.name}</span>
                    <span className="diary-agenda-meta">{`${room.name} · ${BOARD_COPY.legend.phase} · ${item.entry.eventName}`}</span>
                  </li>;
                }
                const { entry, timeLabel, stateLabel } = item;
                const severity = conflictSeverity.get(entry.id);
                const continuation = item.startMs < day.startMs;
                const age = entry.status === "active" && entry.kind === "hold" ? decisionAge(entry.decisionAt, nowMs) : null;
                return <li key={entry.id}>
                  <button type="button"
                    id={item.anchorDayMs === day.startMs ? `diary-block-${entry.id}` : `diary-block-${entry.id}-${String(day.startMs)}`}
                    data-booking-id={entry.id}
                    className={`diary-agenda-booking is-${entry.status === "active" ? entry.kind : "exited"}`}
                    onClick={() => { onOpenBooking(entry); }}
                    aria-label={`${entry.title} — ${stateLabel}, ${timeLabel}, ${room.name}, ${day.label}${age === null ? "" : `, ${age}`}${continuation ? ", continues from an earlier day" : ""}${severity === undefined ? "" : `, ${severity} conflict`}`}>
                    <time className="diary-agenda-time">{timeLabel}</time>
                    <span className="diary-agenda-title">{entry.title}</span>
                    <span className="diary-agenda-meta">
                      <span>{`${room.name} · `}<BookingState entry={entry} />{continuation ? ` · ${copy.continues}` : ""}</span>
                      {age === null ? null : <span className="diary-agenda-age">{age}</span>}
                      {severity === undefined ? null : <span className={`diary-overview-warning is-${severity}`}>
                        <AlertTriangle size={12} aria-hidden="true" />{severity === "blocking" ? "Conflict" : "Review"}</span>}
                    </span>
                  </button>
                </li>;
              })}
            </ul>
          )}
        </li>;
      })}
    </ol>
  </section>;
});
