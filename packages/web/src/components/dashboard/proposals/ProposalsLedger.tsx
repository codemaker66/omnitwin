import { useId, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import type { DeskProposal } from "../../../api/proposals.js";
import { eventDateLong, eventDateParts, eventLead } from "../enquiries/enquiry-desk-format.js";
import { groupRows, proposalStatusWords, rowDetails, rowWhen } from "./proposals-desk-format.js";
import { ProposalChip } from "./ProposalsStages.js";

// ---------------------------------------------------------------------------
// The ledger: proposals grouped as a booker works them (what the client sent
// back, their own drafts, what is with the client, accepted, closed), each
// row led by its event's date. One row is in the tab order; the arrow keys
// (or j and k) move between rows and Enter opens one.
// ---------------------------------------------------------------------------

interface ProposalsLedgerProps {
  readonly rows: readonly DeskProposal[];
  readonly selectedId: string | null;
  readonly nowMs: number;
  readonly year: number;
  readonly onOpen: (proposal: DeskProposal) => void;
}

const MOVE_KEYS: Readonly<Record<string, (index: number, last: number) => number>> = {
  ArrowDown: (index, last) => Math.min(last, index + 1),
  j: (index, last) => Math.min(last, index + 1),
  ArrowUp: (index) => Math.max(0, index - 1),
  k: (index) => Math.max(0, index - 1),
  Home: () => 0,
  End: (_, last) => last,
};

export function ProposalsLedger({ rows, selectedId, nowMs, year, onOpen }: ProposalsLedgerProps): ReactElement {
  const ledgerRef = useRef<HTMLDivElement>(null);
  const headingIds = useId();
  const [focusId, setFocusId] = useState<string | null>(null);
  const groups = groupRows(rows);
  const tabbableId = [focusId, selectedId].find((id) => id !== null && rows.some((row) => row.id === id)) ?? groups[0]?.rows[0]?.id;

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const move = MOVE_KEYS[event.key];
    if (move === undefined) return;
    const buttons = [...(ledgerRef.current?.querySelectorAll<HTMLButtonElement>("button[data-proposal-id]") ?? [])];
    const index = buttons.findIndex((button) => button === document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    buttons[move(index, buttons.length - 1)]?.focus();
  };

  return (
    <div className="enq-ledger" ref={ledgerRef} onKeyDown={moveFocus} data-testid="proposals-list">
      {groups.map((group, index) => (
        <section key={group.key} aria-labelledby={`${headingIds}-${String(index)}`}>
          <h2 className="enq-group" id={`${headingIds}-${String(index)}`} data-group={group.key}>
            {group.label}
            <span className="enq-group__count">
              <span className="vv-sr-only">, </span>
              {group.rows.length.toLocaleString("en-GB")}
            </span>
          </h2>
          <ul className="enq-rows">
            {group.rows.map((proposal) => (
              <li key={proposal.id}>
                <ProposalRow proposal={proposal} selected={proposal.id === selectedId} tabbable={proposal.id === tabbableId}
                  nowMs={nowMs} year={year} onOpen={onOpen} onFocus={setFocusId} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

interface ProposalRowProps {
  readonly proposal: DeskProposal;
  readonly selected: boolean;
  readonly tabbable: boolean;
  readonly nowMs: number;
  readonly year: number;
  readonly onOpen: (proposal: DeskProposal) => void;
  readonly onFocus: (id: string) => void;
}

function ProposalRow({ proposal, selected, tabbable, nowMs, year, onOpen, onFocus }: ProposalRowProps): ReactElement {
  const date = eventDateParts(proposal.eventDate);
  const passed = eventLead(proposal.eventDate, nowMs) === "date has passed";
  const details = rowDetails(proposal);
  const when = rowWhen(proposal, nowMs);
  const owed = proposal.status === "changes_requested";
  const label = [
    proposal.title,
    proposalStatusWords(proposal.status),
    date === null ? "no event date" : `event ${eventDateLong(proposal.eventDate) ?? date.full}${passed ? ", date has passed" : ""}`,
    ...details,
    `${when.charAt(0).toLowerCase()}${when.slice(1)}`,
  ].join(", ");

  return (
    <button
      type="button"
      className="enq-row pr-row"
      data-tone={owed ? "new" : "other"}
      data-proposal-id={proposal.id}
      data-testid={`proposal-row-${proposal.id}`}
      aria-current={selected ? "true" : undefined}
      aria-label={label}
      tabIndex={tabbable ? 0 : -1}
      onClick={() => { onOpen(proposal); }}
      onFocus={() => { onFocus(proposal.id); }}
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
        <span className="enq-row__title">{proposal.title}</span>
        {details.length > 0 && <span className="enq-row__meta">{details.join(" · ")}</span>}
      </span>
      <span className="enq-row__side" aria-hidden="true">
        <ProposalChip status={proposal.status} />
        <span className="enq-row__age">{when}</span>
      </span>
    </button>
  );
}
