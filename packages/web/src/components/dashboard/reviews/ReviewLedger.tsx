import { useId, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import type { PendingReviewEntry } from "../../../api/configuration-reviews.js";
import { eventDateParts, eventLead } from "../enquiries/enquiry-desk-format.js";
import {
  eventCalendarDate, groupQueue, queueAge, queueDetails, reviewStage, stageLabel, stageTone, type ReviewStage,
} from "./review-desk-format.js";
import { ReviewStageChip } from "./ReviewStages.js";

// ---------------------------------------------------------------------------
// The queue: layouts grouped by stage, each row led by its event's date,
// because a reviewer weighs a submission as "which day, which room, whose
// plan, how long has it waited". One row is in the tab order; the arrow keys
// (or j and k) move between rows and Enter opens one.
// ---------------------------------------------------------------------------

interface ReviewLedgerProps {
  readonly rows: readonly PendingReviewEntry[];
  readonly selectedId: string | null;
  readonly nowMs: number;
  readonly year: number;
  readonly onOpen: (entry: PendingReviewEntry) => void;
}

const MOVE_KEYS: Readonly<Record<string, (index: number, last: number) => number>> = {
  ArrowDown: (index, last) => Math.min(last, index + 1),
  j: (index, last) => Math.min(last, index + 1),
  ArrowUp: (index) => Math.max(0, index - 1),
  k: (index) => Math.max(0, index - 1),
  Home: () => 0,
  End: (_, last) => last,
};

/** How a row's age reads aloud: when it entered its stage. */
const STAGE_ENTERED: Readonly<Record<ReviewStage, string>> = {
  to_start: "submitted",
  in_review: "review started",
  with_planner: "changes asked for",
};

export function ReviewLedger({ rows, selectedId, nowMs, year, onOpen }: ReviewLedgerProps): ReactElement {
  const ledgerRef = useRef<HTMLDivElement>(null);
  const headingIds = useId();
  const [focusId, setFocusId] = useState<string | null>(null);
  const groups = groupQueue(rows);
  const tabbableId = [focusId, selectedId].find((id) => id !== null && rows.some((row) => row.id === id)) ?? rows[0]?.id;

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const move = MOVE_KEYS[event.key];
    if (move === undefined) return;
    const buttons = [...(ledgerRef.current?.querySelectorAll<HTMLButtonElement>("button[data-review-id]") ?? [])];
    const index = buttons.findIndex((button) => button === document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    buttons[move(index, buttons.length - 1)]?.focus();
  };

  return (
    <div className="enq-ledger" ref={ledgerRef} onKeyDown={moveFocus}>
      {groups.map((group, index) => (
        <section key={group.stage} aria-labelledby={`${headingIds}-${String(index)}`}>
          <h2 className="enq-group" id={`${headingIds}-${String(index)}`}>
            {stageLabel(group.stage)}
            <span className="enq-group__count">
              <span className="vv-sr-only">, </span>
              {group.rows.length.toLocaleString("en-GB")}
            </span>
          </h2>
          <ul className="enq-rows">
            {group.rows.map((entry) => (
              <li key={entry.id}>
                <QueueRow entry={entry} selected={entry.id === selectedId} tabbable={entry.id === tabbableId}
                  nowMs={nowMs} year={year} onOpen={onOpen} onFocus={setFocusId} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

interface QueueRowProps {
  readonly entry: PendingReviewEntry;
  readonly selected: boolean;
  readonly tabbable: boolean;
  readonly nowMs: number;
  readonly year: number;
  readonly onOpen: (entry: PendingReviewEntry) => void;
  readonly onFocus: (id: string) => void;
}

function QueueRow({ entry, selected, tabbable, nowMs, year, onOpen, onFocus }: QueueRowProps): ReactElement {
  const stage = reviewStage(entry.reviewStatus);
  const calendarDate = eventCalendarDate(entry);
  const date = eventDateParts(calendarDate);
  const passed = eventLead(calendarDate, nowMs) === "date has passed";
  const details = queueDetails(entry);
  const age = queueAge(entry, nowMs);
  // The reviewer's own wait is copper; a layout with its planner waits on them.
  const waitsOnVenue = stage === "to_start" || stage === "in_review";
  const label = [
    entry.name,
    stage === null ? null : stageLabel(stage),
    date === null ? "no event date yet" : `event ${date.full}${passed ? ", date has passed" : ""}`,
    ...details,
    age === null || stage === null ? null : `${STAGE_ENTERED[stage]} ${age}`,
  ].filter((part): part is string => part !== null).join(", ");

  return (
    <button
      type="button"
      className="enq-row rev-row"
      data-tone={stage === null ? "other" : stageTone(stage)}
      data-review-id={entry.id}
      aria-current={selected ? "true" : undefined}
      aria-label={label}
      tabIndex={tabbable ? 0 : -1}
      onClick={() => { onOpen(entry); }}
      onFocus={() => { onFocus(entry.id); }}
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
        <span className="enq-row__title">{entry.name}</span>
        <span className="enq-row__meta">{details.join(" · ")}</span>
      </span>
      <span className="enq-row__side" aria-hidden="true">
        {stage !== null && <ReviewStageChip stage={stage} />}
        {age !== null && <span className={`enq-row__age${waitsOnVenue ? " rev-row__wait" : ""}`}>{age}</span>}
      </span>
    </button>
  );
}
