import { useId, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import type { Enquiry } from "../../../api/enquiries.js";
import { StageChip } from "./EnquiryStages.js";
import type { RoomLookup } from "./use-venue-rooms.js";
import {
  eventDateParts, eventLead, groupByReceived, guestsPhrase, messageExcerpt, relativeAge, stageLabel, stageTone,
  venueYear,
} from "./enquiry-desk-format.js";

// ---------------------------------------------------------------------------
// The ledger: enquiries grouped by when they arrived, each row led by the
// event date because a booker reads a request as "which day, how many, which
// room". One row is in the tab order; the arrow keys (or j and k) move
// between rows and Enter opens one.
// ---------------------------------------------------------------------------

export interface LedgerStamp {
  readonly id: string;
  /** Changes with every new stamp so the chip replays it. */
  readonly key: number;
}

interface EnquiryLedgerProps {
  readonly rows: readonly Enquiry[];
  readonly selectedId: string | null;
  readonly nowMs: number;
  readonly room: RoomLookup;
  /** Every enquiry the filter holds is listed, so each group's count is whole. */
  readonly complete: boolean;
  readonly stamp: LedgerStamp | null;
  readonly onOpen: (enquiry: Enquiry) => void;
}

const MOVE_KEYS: Readonly<Record<string, (index: number, last: number) => number>> = {
  ArrowDown: (index, last) => Math.min(last, index + 1),
  j: (index, last) => Math.min(last, index + 1),
  ArrowUp: (index) => Math.max(0, index - 1),
  k: (index) => Math.max(0, index - 1),
  Home: () => 0,
  End: (_, last) => last,
};

export function enquiryName(enquiry: Enquiry): string {
  return enquiry.guestName ?? enquiry.name;
}

/** What a booker qualifies a request by, in the order they weigh it. */
export function enquiryDetails(enquiry: Enquiry, roomName: string | null | undefined): string[] {
  const details: string[] = [];
  if (enquiry.eventType !== null && enquiry.eventType.trim() !== "") details.push(enquiry.eventType.trim());
  if (enquiry.estimatedGuests !== null) details.push(guestsPhrase(enquiry.estimatedGuests));
  if (roomName !== null && roomName !== undefined) details.push(roomName);
  if (enquiry.configurationId !== null) details.push("layout attached");
  return details;
}

export function EnquiryLedger({ rows, selectedId, nowMs, room, complete, stamp, onOpen }: EnquiryLedgerProps): ReactElement {
  const ledgerRef = useRef<HTMLDivElement>(null);
  const headingIds = useId();
  const [focusId, setFocusId] = useState<string | null>(null);
  const groups = groupByReceived(rows, nowMs);
  const year = venueYear(nowMs);
  const tabbableId = [focusId, selectedId].find((id) => id !== null && rows.some((row) => row.id === id)) ?? rows[0]?.id;

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const move = MOVE_KEYS[event.key];
    if (move === undefined) return;
    const buttons = [...(ledgerRef.current?.querySelectorAll<HTMLButtonElement>("button[data-enquiry-id]") ?? [])];
    const index = buttons.findIndex((button) => button === document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    buttons[move(index, buttons.length - 1)]?.focus();
  };

  return (
    <div className="enq-ledger" ref={ledgerRef} onKeyDown={moveFocus}>
      {groups.map((group, index) => (
        <section key={group.key} aria-labelledby={`${headingIds}-${String(index)}`}>
          <h2 className="enq-group" id={`${headingIds}-${String(index)}`}>
            {group.label}
            {(complete || index < groups.length - 1) && (
              <span className="enq-group__count">
                <span className="vv-sr-only">, </span>
                {group.rows.length.toLocaleString("en-GB")}
              </span>
            )}
          </h2>
          <ul className="enq-rows">
            {group.rows.map((enquiry) => (
              <li key={enquiry.id}>
                <LedgerRow
                  enquiry={enquiry}
                  selected={enquiry.id === selectedId}
                  tabbable={enquiry.id === tabbableId}
                  nowMs={nowMs}
                  year={year}
                  roomName={room(enquiry)?.name ?? null}
                  stampKey={stamp !== null && stamp.id === enquiry.id ? stamp.key : null}
                  onOpen={onOpen}
                  onFocus={setFocusId}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

interface LedgerRowProps {
  readonly enquiry: Enquiry;
  readonly selected: boolean;
  readonly tabbable: boolean;
  readonly nowMs: number;
  readonly year: number;
  readonly roomName: string | null;
  readonly stampKey: number | null;
  readonly onOpen: (enquiry: Enquiry) => void;
  readonly onFocus: (id: string) => void;
}

function LedgerRow({ enquiry, selected, tabbable, nowMs, year, roomName, stampKey, onOpen, onFocus }: LedgerRowProps): ReactElement {
  const date = eventDateParts(enquiry.preferredDate);
  const passed = eventLead(enquiry.preferredDate, nowMs) === "date has passed";
  const name = enquiryName(enquiry);
  const details = enquiryDetails(enquiry, roomName);
  const quote = messageExcerpt(enquiry.message);
  const age = relativeAge(enquiry.createdAt, nowMs);
  const label = [
    name,
    stageLabel(enquiry.state),
    date === null ? "event date to be confirmed" : `event ${date.full}${passed ? ", date has passed" : ""}`,
    ...details,
    age === null ? null : `received ${age}`,
  ].filter((part): part is string => part !== null).join(", ");

  return (
    <button
      type="button"
      className="enq-row"
      data-tone={stageTone(enquiry.state)}
      data-enquiry-id={enquiry.id}
      aria-current={selected ? "true" : undefined}
      aria-label={label}
      tabIndex={tabbable ? 0 : -1}
      onClick={() => { onOpen(enquiry); }}
      onFocus={() => { onFocus(enquiry.id); }}
    >
      {date === null ? (
        <span className="enq-date enq-date--open" aria-hidden="true">
          <span className="enq-date__weekday">Date</span>
          <span className="enq-date__day">TBC</span>
        </span>
      ) : (
        <span className={`enq-date${passed ? " enq-date--past" : ""}`} aria-hidden="true">
          <span className="enq-date__weekday">{date.weekday}</span>
          <span className="enq-date__day">{date.day}</span>
          <span className="enq-date__month">
            {date.month}{Number(date.year) === year ? "" : ` ’${date.year.slice(2)}`}
          </span>
        </span>
      )}
      <span className="enq-row__main" aria-hidden="true">
        <span className="enq-row__title">{name}</span>
        {details.length > 0 && <span className="enq-row__meta">{details.join(" · ")}</span>}
        {quote !== null && <span className="enq-row__quote">“{quote}”</span>}
      </span>
      <span className="enq-row__side" aria-hidden="true">
        <StageChip key={stampKey ?? "still"} state={enquiry.state} stamped={stampKey !== null} />
        {age !== null && <span className="enq-row__age">{age}</span>}
      </span>
    </button>
  );
}
