import type { ReactElement } from "react";
import {
  GROUP_ORDER, GROUP_STATUSES, groupTone, groupWords, proposalStatusWords, proposalTone, type ProposalFilter,
} from "./proposals-desk-format.js";

// ---------------------------------------------------------------------------
// The groups across the copper plane: how many proposals stand in each, over
// the whole list. Each count is also its filter.
// ---------------------------------------------------------------------------

const FILTERS: readonly ProposalFilter[] = [...GROUP_ORDER, "all"];

export function ProposalChip({ status, stamped = false }: { readonly status: string; readonly stamped?: boolean }): ReactElement {
  return (
    <span className={`enq-chip${stamped ? " enq-chip--stamped" : ""}`} data-tone={proposalTone(status)}>
      <span className="enq-dot" aria-hidden="true" />
      {proposalStatusWords(status)}
    </span>
  );
}

interface ProposalsStagesProps {
  readonly filter: ProposalFilter;
  /** Every status's count; null until the list has been read. */
  readonly counts: Readonly<Record<string, number>> | null;
  readonly onFilter: (filter: ProposalFilter) => void;
}

export function ProposalsStages({ filter, counts, onFilter }: ProposalsStagesProps): ReactElement {
  return (
    <div className="enq-stages pr-stages" role="group" aria-label="Show proposals by where they stand">
      {FILTERS.map((group) => {
        const count = counts === null ? null
          : group === "all" ? Object.values(counts).reduce((sum, n) => sum + n, 0)
            : GROUP_STATUSES[group].reduce((sum, status) => sum + (counts[status] ?? 0), 0);
        const label = group === "all" ? "All" : groupWords(group);
        const shown = count === null ? "" : count.toLocaleString("en-GB");
        return (
          <button
            key={group}
            type="button"
            className={`enq-stage enq-stage--${group === "all" ? "all" : groupTone(group)}`}
            aria-pressed={filter === group}
            aria-label={count === null ? label : `${label}, ${shown}`}
            onClick={() => { onFilter(group); }}
          >
            <span className={`enq-stage__count${count !== null && count > 0 ? " enq-stage__count--has" : ""}`} aria-hidden="true">
              {shown}
            </span>
            <span className="enq-stage__label" aria-hidden="true">
              {group !== "all" && <span className="enq-dot" data-tone={groupTone(group)} />}
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
