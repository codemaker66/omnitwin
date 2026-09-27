import { useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from "react";
import type {
  CalendarBookingEntry,
  CalendarConflict,
  CalendarDecisionsDue,
  CalendarNextActionsDue,
  CalendarRoom,
  ConflictReport,
  ConflictSeverity,
} from "@omnitwin/types";
import { BOARD_COPY } from "../board-copy.js";
import { ActivityStatus } from "../../../components/shared/Activity.js";
import { eventDateLong, eventDateParts, eventLead, venueYear } from "../../../components/dashboard/enquiries/enquiry-desk-format.js";
import type { NeedsActionItem } from "../lib/board-layout.js";
import { formatInlineDay } from "../lib/board-time.js";

// ---------------------------------------------------------------------------
// Board side panels (T-493): the venue-wide decisions list (T-619), the
// conflict rail (explanations + honest checks), the needs-attention holding
// tray, the undo toast, and the ink-move confirmation. All crisp and opaque —
// no blur where information lives (the Hallkeeper Test, Canon §18).
// ---------------------------------------------------------------------------

export interface DecisionsDuePanelProps {
  readonly decisions: CalendarDecisionsDue;
  readonly rooms: readonly CalendarRoom[];
  readonly nowMs: number;
  readonly onOpen: (entry: CalendarBookingEntry) => void;
}

/** The quiet, venue-wide list the Diary opens with (Blake, 26 September
 *  2026): provisional holds whose decision date has passed or falls within
 *  the next seven days, whatever the booking's own date. Overdue first, in
 *  copper; each opens its booking where it stands, without moving the board. */
export function DecisionsDuePanel({ decisions, rooms, nowMs, onOpen }: DecisionsDuePanelProps): ReactElement {
  const roomNames = new Map(rooms.map((room) => [room.id, room.name]));
  const overdue = decisions.holds.filter((hold) => hold.decisionAt !== null && Date.parse(hold.decisionAt) < nowMs);
  const soon = decisions.holds.filter((hold) => hold.decisionAt === null || Date.parse(hold.decisionAt) >= nowMs);
  const copy = BOARD_COPY.decisions;

  const group = (label: string, holds: readonly CalendarBookingEntry[], isOverdue: boolean): ReactElement | null => {
    if (holds.length === 0) return null;
    return (
      <div className={`diary-decisions-group${isOverdue ? " is-overdue" : ""}`}>
        <h3 className="diary-decisions-heading">{label}{" "}<span className="diary-decisions-count">{holds.length}</span></h3>
        <ul className="diary-decisions-list">
          {holds.map((hold) => {
            const decisionDay = hold.decisionAt === null ? "" : formatInlineDay(Date.parse(hold.decisionAt), nowMs);
            return (
              <li key={hold.id}>
                <button
                  type="button"
                  className="diary-tray-item diary-decision"
                  onClick={() => { onOpen(hold); }}
                >
                  <span className="diary-decision-title">{hold.title}</span>
                  <span className="diary-decision-meta">
                    {`${roomNames.get(hold.spaceId) ?? copy.roomUnknown} · ${formatInlineDay(Date.parse(hold.startsAt), nowMs)}`}
                  </span>
                  <span className="diary-decision-meta">
                    {`${copy.option(hold.rank, hold.jointFlag)} · ${hold.ownerName ?? copy.noOwner}`}
                  </span>
                  <span className="diary-decision-when">
                    {isOverdue ? copy.wasDue(decisionDay) : copy.decideBy(decisionDay)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  return (
    <section className="diary-panel diary-decisions" aria-label={copy.title}>
      <h2 className="diary-panel-title">
        {copy.title}
        {decisions.total > 0 ? <>{" "}<span className="diary-tray-count">{decisions.total}</span></> : null}
      </h2>
      {decisions.holds.length === 0 ? (
        <p className="diary-panel-empty">{copy.empty}</p>
      ) : (
        <>
          {group(copy.overdue, overdue, true)}
          {group(copy.soon, soon, false)}
        </>
      )}
      {decisions.total > decisions.holds.length ? (
        <p className="diary-tray-more">{copy.more(decisions.holds.length, decisions.total)}</p>
      ) : null}
    </section>
  );
}

const SEVERITY_ORDER: readonly ConflictSeverity[] = ["blocking", "warning", "info"];

export interface ConflictRailProps {
  readonly report: ConflictReport;
  readonly onFocusEntry: (entryId: string) => void;
}

export function ConflictRail({ report, onFocusEntry }: ConflictRailProps): ReactElement {
  const grouped = new Map<ConflictSeverity, CalendarConflict[]>();
  for (const conflict of report.conflicts) {
    const bucket = grouped.get(conflict.severity) ?? [];
    bucket.push(conflict);
    grouped.set(conflict.severity, bucket);
  }

  return (
    <section className="diary-panel diary-conflicts" aria-label={BOARD_COPY.conflicts.title}>
      <h2 className="diary-panel-title">{BOARD_COPY.conflicts.title}</h2>
      {report.conflicts.length === 0 ? (
        <p className="diary-panel-empty">{BOARD_COPY.conflicts.none}</p>
      ) : (
        SEVERITY_ORDER.map((severity) => {
          const bucket = grouped.get(severity);
          if (bucket === undefined || bucket.length === 0) return null;
          return (
            <details key={severity} className={`diary-conflict-group is-${severity}`} open={severity === "blocking"}>
              <summary className="diary-conflict-heading">
                {BOARD_COPY.conflicts.severity[severity]}
                <span className="diary-conflict-count">{bucket.length}</span>
                <span>Review</span>
              </summary>
              <ul className="diary-conflict-list">
                {bucket.map((conflict) => (
                  <li key={conflict.id}>
                    <button
                      type="button"
                      className="diary-conflict-item"
                      onClick={() => {
                        onFocusEntry(conflict.entryIds[0]);
                      }}
                    >
                      {conflict.explanation}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          );
        })
      )}
      <details className="diary-check-details"><summary className="diary-checks-title">{BOARD_COPY.conflicts.checksTitle}</summary>
      <ul className="diary-checks">
        <li className={`diary-check is-${report.checks.turnaround.status}`}>
          {BOARD_COPY.conflicts.turnaround[report.checks.turnaround.status]}
          <span className="diary-check-detail">{report.checks.turnaround.detail}</span>
        </li>
      </ul>
      <p className="diary-disclosure">{BOARD_COPY.disclosure}</p>
      </details>
    </section>
  );
}

export interface TrayEnquiry {
  readonly id: string;
  readonly name: string;
  readonly eventType: string | null;
  readonly estimatedGuests: number | null;
  /** The date the client asked for, "YYYY-MM-DD", or null when open. */
  readonly preferredDate: string | null;
}

export interface HoldingTrayProps {
  readonly items: readonly NeedsActionItem[];
  /** The range's bookings are on their way, so its items are not known:
   *  the tray neither counts them nor says there are none. */
  readonly itemsPending?: boolean;
  readonly onFocusEntry: (entryId: string) => void;
  /** Needs attention across the venue (roadmap N3): holds whose next action
   *  is overdue or due within seven days, whatever the booking's date. An
   *  older server sends none, and the tray then shows the range's own. */
  readonly nextActions?: CalendarNextActionsDue;
  readonly rooms?: readonly CalendarRoom[];
  readonly nowMs?: number;
  /** Opens a listed hold where it stands, without moving the board. */
  readonly onOpenBooking?: (entry: CalendarBookingEntry) => void;
  readonly enquiries: readonly TrayEnquiry[];
  readonly enquiriesLoading?: boolean;
  /** More open enquiries exist than the tray lists (it shows the newest). */
  readonly enquiriesMore?: boolean;
  readonly enquiryError?: string | null;
  readonly onRetryEnquiries?: () => void;
  readonly canConvert: boolean;
  readonly onConvertEnquiry: (enquiryId: string) => void;
  /** Shows the date a slip asks for on the board, with Go to date's answer
   *  for it: `sought` is "YYYY-MM-DD", `typed` how Go to date words it, and
   *  `from` the tile, where focus returns. */
  readonly onShowDate?: (sought: string, typed: string, from: HTMLElement) => void;
  /** Pointer drag from a slip onto a board lane (C1). The Pencil-in button
   *  stays the keyboard/screen-reader path; the drag is an accelerator. */
  readonly onBeginEnquiryDrag?: (
    enquiry: TrayEnquiry,
    event: React.PointerEvent<HTMLElement>,
  ) => void;
  /** A press that travelled was a scroll, not a lift — the page abandons the
   *  ripening long press (T-619). */
  readonly onEnquiryPressMove?: (event: React.PointerEvent<HTMLElement>) => void;
  /** The finger left, or the platform took the gesture back. */
  readonly onEnquiryPressEnd?: () => void;
  /** The slip being carried. Only THAT slip stops the page scrolling; every
   *  other keeps `touch-action: pan-x pan-y`. */
  readonly liftedEnquiryId?: string | null;
}

export function HoldingTray({
  items,
  itemsPending = false,
  onFocusEntry,
  nextActions,
  rooms = [],
  nowMs = Date.now(),
  onOpenBooking,
  enquiries,
  enquiriesLoading = false,
  enquiriesMore = false,
  enquiryError = null,
  onRetryEnquiries,
  canConvert,
  onConvertEnquiry,
  onShowDate,
  onBeginEnquiryDrag,
  onEnquiryPressMove,
  onEnquiryPressEnd,
  liftedEnquiryId = null,
}: HoldingTrayProps): ReactElement {
  return (
    <section className="diary-panel diary-tray" aria-label={BOARD_COPY.tray.title}>
      {nextActions === undefined
        ? <RangeAttention items={items} itemsPending={itemsPending} onFocusEntry={onFocusEntry} />
        : <VenueAttention nextActions={nextActions} items={items} itemsPending={itemsPending} rooms={rooms} nowMs={nowMs}
          onFocusEntry={onFocusEntry} onOpenBooking={onOpenBooking} />}

      <h3 className="diary-checks-title">{BOARD_COPY.trayEnquiries.title}</h3>
      {enquiriesLoading ? <ActivityStatus>Loading open enquiries…</ActivityStatus> : null}
      {enquiryError !== null ? <div role="alert"><p>{enquiryError}</p>
        <button type="button" className="diary-button" onClick={onRetryEnquiries} disabled={enquiriesLoading}>Retry enquiries</button>
      </div> : null}
      {canConvert && onBeginEnquiryDrag !== undefined && enquiries.length > 0 ? (
        <p className="diary-tray-drag-hint">{BOARD_COPY.trayEnquiries.dragHint}</p>
      ) : null}
      {enquiries.length === 0 && !enquiriesLoading && enquiryError === null ? (
        <p className="diary-panel-empty">{BOARD_COPY.trayEnquiries.empty}</p>
      ) : (
        <ul className="diary-tray-list">
          {enquiries.map((enquiry) => (
            <li
              key={enquiry.id}
              className={[
                "diary-tray-enquiry",
                canConvert && onBeginEnquiryDrag !== undefined ? "is-draggable" : "",
                liftedEnquiryId === enquiry.id ? "is-lifted" : "",
              ].filter(Boolean).join(" ")}
              onPointerDown={
                canConvert && onBeginEnquiryDrag !== undefined
                  ? (event) => { onBeginEnquiryDrag(enquiry, event); }
                  : undefined
              }
              onPointerMove={onEnquiryPressMove}
              onPointerUp={onEnquiryPressEnd}
              onPointerCancel={onEnquiryPressEnd}
            >
              <SlipDate preferredDate={enquiry.preferredDate} nowMs={nowMs} onShowDate={onShowDate} />
              <div className="diary-slip-main">
                <span className="diary-tray-item-title">{enquiry.name}</span>
                <span className="diary-tray-item-reason">
                  {BOARD_COPY.trayEnquiries.detail(enquiry.eventType, enquiry.estimatedGuests,
                    eventLead(enquiry.preferredDate, nowMs) ?? BOARD_COPY.trayEnquiries.noDate)}
                </span>
                {canConvert ? (
                  <button
                    type="button"
                    className="diary-button"
                    onClick={() => {
                      onConvertEnquiry(enquiry.id);
                    }}
                  >
                    {BOARD_COPY.trayEnquiries.convert}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {enquiriesMore && enquiries.length > 0 ? (
        <p className="diary-tray-more">{BOARD_COPY.trayEnquiries.more(enquiries.length)}</p>
      ) : null}
    </section>
  );
}

/** The date an enquiry asks for (roadmap N3), as the enquiries desk shows
 *  it: weekday, day and month, with the year only when it is not this one.
 *  Pressing it opens Go to date on that date, so the board and what each
 *  room holds that day are one press from the slip. */
function SlipDate({ preferredDate, nowMs, onShowDate }: {
  readonly preferredDate: string | null;
  readonly nowMs: number;
  readonly onShowDate?: (sought: string, typed: string, from: HTMLElement) => void;
}): ReactElement {
  const date = eventDateParts(preferredDate);
  const spoken = eventDateLong(preferredDate);
  if (preferredDate === null || date === null || spoken === null) {
    // The slip's own line says "date to be confirmed" in words.
    return (
      <span className="diary-slip-date is-open" aria-hidden="true">
        <span className="diary-slip-date-caps">{BOARD_COPY.trayEnquiries.openDate.word}</span>
        <span className="diary-slip-date-tbc">{BOARD_COPY.trayEnquiries.openDate.tbc}</span>
      </span>
    );
  }
  const className = `diary-slip-date${eventLead(preferredDate, nowMs) === "date has passed" ? " is-past" : ""}`;
  const year = Number(date.year) === venueYear(nowMs) ? "" : ` ’${date.year.slice(2)}`;
  const face = (
    <>
      <span className="diary-slip-date-caps" aria-hidden="true">{date.weekday}</span>
      <span className="diary-slip-date-day" aria-hidden="true">{date.day}</span>
      <span className="diary-slip-date-caps" aria-hidden="true">{`${date.month}${year}`}</span>
    </>
  );
  if (onShowDate === undefined) return <span className={className} role="img" aria-label={spoken}>{face}</span>;
  const sought = preferredDate.trim().slice(0, 10);
  return (
    <button
      type="button"
      className={className}
      aria-label={BOARD_COPY.trayEnquiries.showDate(spoken)}
      title={BOARD_COPY.trayEnquiries.showDate(date.full)}
      onClick={(event) => {
        onShowDate(sought, date.full, event.currentTarget);
      }}
    >
      {face}
    </button>
  );
}

/** The range's own holds that need attention, one button each; pressing one
 *  brings its block into view. */
function AttentionItems({ items, onFocusEntry }: { readonly items: readonly NeedsActionItem[]; readonly onFocusEntry: (entryId: string) => void }): ReactElement {
  return (
    <ul className="diary-tray-list">
      {items.map((item) => (
        <li key={item.entry.id}>
          <button
            type="button"
            className="diary-tray-item"
            onClick={() => {
              onFocusEntry(item.entry.id);
            }}
          >
            <span className="diary-tray-item-title">{item.entry.title}</span>
            {item.reasons.map((reason) => (
              <span key={reason} className="diary-tray-item-reason">
                {reason}
              </span>
            ))}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** An older server's Needs attention: what the board's range holds, and no
 *  claim about the rest of the venue. */
function RangeAttention({ items, itemsPending, onFocusEntry }: {
  readonly items: readonly NeedsActionItem[];
  readonly itemsPending: boolean;
  readonly onFocusEntry: (entryId: string) => void;
}): ReactElement {
  return (
    <>
      <h2 className="diary-panel-title">
        {BOARD_COPY.tray.title}
        {!itemsPending && items.length > 0 ? <span className="diary-tray-count">{items.length}</span> : null}
      </h2>
      {itemsPending ? null : items.length === 0 ? (
        <p className="diary-panel-empty">{BOARD_COPY.tray.empty}</p>
      ) : <AttentionItems items={items} onFocusEntry={onFocusEntry} />}
    </>
  );
}

/** Needs attention across the venue (roadmap N3): next actions overdue, then
 *  due within seven days, each opening its booking where it stands; then the
 *  range's holds with no option yet. The venue's list does not wait on the
 *  range: a week on its way still shows it. */
function VenueAttention({ nextActions, items, itemsPending, rooms, nowMs, onFocusEntry, onOpenBooking }: {
  readonly nextActions: CalendarNextActionsDue;
  readonly items: readonly NeedsActionItem[];
  readonly itemsPending: boolean;
  readonly rooms: readonly CalendarRoom[];
  readonly nowMs: number;
  readonly onFocusEntry: (entryId: string) => void;
  readonly onOpenBooking: ((entry: CalendarBookingEntry) => void) | undefined;
}): ReactElement {
  const copy = BOARD_COPY.tray;
  const roomNames = new Map(rooms.map((room) => [room.id, room.name]));
  const dueMs = (hold: CalendarBookingEntry): number => (hold.nextActionDueAt === null ? Number.POSITIVE_INFINITY : Date.parse(hold.nextActionDueAt));
  const overdue = nextActions.holds.filter((hold) => dueMs(hold) < nowMs);
  const soon = nextActions.holds.filter((hold) => dueMs(hold) >= nowMs);
  const unplaced = itemsPending ? [] : items;
  const count = nextActions.total + unplaced.length;

  const group = (label: string, holds: readonly CalendarBookingEntry[], isOverdue: boolean): ReactElement | null => {
    if (holds.length === 0) return null;
    return (
      <div className={`diary-decisions-group${isOverdue ? " is-overdue" : ""}`}>
        <h3 className="diary-decisions-heading">{label}{" "}<span className="diary-decisions-count">{holds.length}</span></h3>
        <ul className="diary-decisions-list">
          {holds.map((hold) => {
            const day = formatInlineDay(dueMs(hold), nowMs);
            return (
              <li key={hold.id}>
                <button
                  type="button"
                  className="diary-tray-item diary-decision"
                  onClick={() => { onOpenBooking?.(hold); }}
                >
                  <span className="diary-decision-title">{hold.title}</span>
                  <span className="diary-decision-meta">
                    {`${roomNames.get(hold.spaceId) ?? BOARD_COPY.decisions.roomUnknown} · ${formatInlineDay(Date.parse(hold.startsAt), nowMs)}`}
                  </span>
                  <span className="diary-decision-meta">{hold.nextAction ?? copy.noActionWritten}</span>
                  <span className="diary-decision-when">
                    {isOverdue ? copy.wasDue(day, hold.ownerName ?? null) : copy.due(day, hold.ownerName ?? null)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  return (
    <>
      <h2 className="diary-panel-title">
        {copy.title}
        {count > 0 ? <span className="diary-tray-count">{count}</span> : null}
      </h2>
      {group(copy.overdue, overdue, true)}
      {group(copy.soon, soon, false)}
      {unplaced.length > 0 ? (
        <div className="diary-decisions-group">
          <h3 className="diary-decisions-heading">{copy.noOption}{" "}<span className="diary-decisions-count">{unplaced.length}</span></h3>
          <AttentionItems items={unplaced} onFocusEntry={onFocusEntry} />
        </div>
      ) : null}
      {nextActions.holds.length === 0 && unplaced.length === 0 ? <p className="diary-panel-empty">{copy.emptyVenue}</p> : null}
      {nextActions.total > nextActions.holds.length ? (
        <p className="diary-tray-more">{copy.more(nextActions.holds.length, nextActions.total)}</p>
      ) : null}
    </>
  );
}

export interface UndoToastProps {
  readonly message: string;
  readonly showUndo: boolean;
  readonly onUndo: () => void;
}

export function UndoToast({ message, showUndo, onUndo }: UndoToastProps): ReactElement {
  return (
    <div className="diary-toast" role="status">
      <span className="diary-toast-message">{message}</span>
      {showUndo ? (
        <button type="button" className="diary-toast-undo" onClick={onUndo}>
          {BOARD_COPY.undo.action}
        </button>
      ) : null}
    </div>
  );
}

export interface InkConfirmProps {
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function InkConfirm({ onConfirm, onCancel }: InkConfirmProps): ReactElement {
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  // Escape dismisses (WAI-ARIA alertdialog convention) and Tab cycles inside
  // the two-button dialog while it is open (review P2).
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const first = confirmRef.current;
    const last = cancelRef.current;
    if (first === null || last === null) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="diary-ink-confirm"
      role="alertdialog"
      aria-label={BOARD_COPY.confirmInk.title}
      aria-describedby="diary-ink-confirm-body"
      onKeyDown={onKeyDown}
    >
      <h2 className="diary-ink-confirm-title">{BOARD_COPY.confirmInk.title}</h2>
      <p id="diary-ink-confirm-body" className="diary-ink-confirm-body">
        {BOARD_COPY.confirmInk.body}
      </p>
      <div className="diary-ink-confirm-actions">
        <button
          type="button"
          className="diary-button is-primary"
          onClick={onConfirm}
          ref={confirmRef}
          autoFocus
        >
          {BOARD_COPY.confirmInk.confirm}
        </button>
        <button type="button" className="diary-button" onClick={onCancel} ref={cancelRef}>
          {BOARD_COPY.confirmInk.cancel}
        </button>
      </div>
    </div>
  );
}
