import { useId, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { occasionLabel } from "@omnitwin/types";
import type { PipelineOpportunity } from "../../../api/crm.js";
import { formatMinorAsCurrency } from "../../../lib/money-input.js";
import { eventDateLong, eventDateParts, eventLead } from "../enquiries/enquiry-desk-format.js";
import { dealStageWords, dueIsPressing, dueWords, groupByDue, isClosed } from "./pipeline-desk-format.js";
import { DealStageChip } from "./PipelineStages.js";

// ---------------------------------------------------------------------------
// The ledger: deals grouped by when their next step is due, each row led by
// its event's date, because a booker works a pipeline as "what do I owe, on
// which day's event, for whom". One row is in the tab order; the arrow keys
// (or j and k) move between rows and Enter opens one.
// ---------------------------------------------------------------------------

interface PipelineLedgerProps {
  readonly rows: readonly PipelineOpportunity[];
  readonly selectedId: string | null;
  readonly nowMs: number;
  readonly year: number;
  readonly onOpen: (deal: PipelineOpportunity) => void;
}

const MOVE_KEYS: Readonly<Record<string, (index: number, last: number) => number>> = {
  ArrowDown: (index, last) => Math.min(last, index + 1),
  j: (index, last) => Math.min(last, index + 1),
  ArrowUp: (index) => Math.max(0, index - 1),
  k: (index) => Math.max(0, index - 1),
  Home: () => 0,
  End: (_, last) => last,
};

/** "Grand Hall wedding · Ailsa Henderson · 160 guests · £18,400" as its parts. */
export function dealDetails(deal: PipelineOpportunity): string[] {
  return [
    deal.contactName,
    occasionLabel(deal.eventType),
    deal.guestCount === null ? null : `${deal.guestCount.toLocaleString("en-GB")} ${deal.guestCount === 1 ? "guest" : "guests"}`,
    deal.estimatedValueMinor > 0 ? formatMinorAsCurrency(deal.estimatedValueMinor, deal.currency).replace(/\.00$/u, "") : null,
  ].filter((part): part is string => part !== null);
}

export function PipelineLedger({ rows, selectedId, nowMs, year, onOpen }: PipelineLedgerProps): ReactElement {
  const ledgerRef = useRef<HTMLDivElement>(null);
  const headingIds = useId();
  const [focusId, setFocusId] = useState<string | null>(null);
  const groups = groupByDue(rows, nowMs);
  const tabbableId = [focusId, selectedId].find((id) => id !== null && rows.some((row) => row.id === id)) ?? rows[0]?.id;

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const move = MOVE_KEYS[event.key];
    if (move === undefined) return;
    const buttons = [...(ledgerRef.current?.querySelectorAll<HTMLButtonElement>("button[data-deal-id]") ?? [])];
    const index = buttons.findIndex((button) => button === document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    buttons[move(index, buttons.length - 1)]?.focus();
  };

  return (
    <div className="enq-ledger" ref={ledgerRef} onKeyDown={moveFocus}>
      {groups.map((group, index) => (
        <section key={group.key} aria-labelledby={`${headingIds}-${String(index)}`}>
          <h2 className="enq-group" id={`${headingIds}-${String(index)}`} data-due={group.key}>
            {group.label}
            <span className="enq-group__count">
              <span className="vv-sr-only">, </span>
              {group.rows.length.toLocaleString("en-GB")}
            </span>
          </h2>
          <ul className="enq-rows">
            {group.rows.map((deal) => (
              <li key={deal.id}>
                <DealRow deal={deal} selected={deal.id === selectedId} tabbable={deal.id === tabbableId}
                  nowMs={nowMs} year={year} onOpen={onOpen} onFocus={setFocusId} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

interface DealRowProps {
  readonly deal: PipelineOpportunity;
  readonly selected: boolean;
  readonly tabbable: boolean;
  readonly nowMs: number;
  readonly year: number;
  readonly onOpen: (deal: PipelineOpportunity) => void;
  readonly onFocus: (id: string) => void;
}

function DealRow({ deal, selected, tabbable, nowMs, year, onOpen, onFocus }: DealRowProps): ReactElement {
  const date = eventDateParts(deal.preferredDate);
  const passed = eventLead(deal.preferredDate, nowMs) === "date has passed";
  const details = dealDetails(deal);
  const due = dueWords(deal, nowMs);
  const pressing = dueIsPressing(deal, nowMs);
  const label = [
    deal.title,
    dealStageWords(deal.stage),
    date === null ? "no event date yet" : `event ${eventDateLong(deal.preferredDate) ?? date.full}${passed ? ", date has passed" : ""}`,
    ...details,
    isClosed(deal.stage) ? due : `${due.charAt(0).toLowerCase()}${due.slice(1)}: ${deal.nextAction}`,
  ].join(", ");

  return (
    <button
      type="button"
      className="enq-row pl-row"
      data-tone={pressing ? "new" : "other"}
      data-deal-id={deal.id}
      data-testid={`opportunity-${deal.id}`}
      aria-current={selected ? "true" : undefined}
      aria-label={label}
      tabIndex={tabbable ? 0 : -1}
      onClick={() => { onOpen(deal); }}
      onFocus={() => { onFocus(deal.id); }}
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
          <span className="enq-date__month">{date.month}{Number(date.year) === year ? "" : ` ’${date.year.slice(2)}`}</span>
        </span>
      )}
      <span className="enq-row__main" aria-hidden="true">
        <span className="enq-row__title">{deal.title}</span>
        <span className="enq-row__meta">{details.join(" · ")}</span>
        {!isClosed(deal.stage) && <span className="pl-row__next">{deal.nextAction}</span>}
      </span>
      <span className="enq-row__side" aria-hidden="true">
        <DealStageChip stage={deal.stage} />
        <span className={`enq-row__age${pressing ? " pl-row__due" : ""}`}>{due}</span>
      </span>
    </button>
  );
}
