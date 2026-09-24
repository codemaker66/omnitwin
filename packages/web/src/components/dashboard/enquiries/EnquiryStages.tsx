import type { ReactElement } from "react";
import type { EnquiryStageCounts } from "../../../api/enquiries.js";
import { DESK_STAGES, stageLabel, stageTone, type DeskFilter } from "./enquiry-desk-format.js";

// ---------------------------------------------------------------------------
// The pipeline across the top of the desk: each stage's count is also its
// filter, so the numbers that say where the work is are how you get to it.
// ---------------------------------------------------------------------------

const FILTERS: readonly DeskFilter[] = [...DESK_STAGES, "all"];

interface StageChipProps {
  readonly state: string;
  /** Replays the stamp that marks a status the reader has just set. */
  readonly stamped?: boolean;
}

export function StageChip({ state, stamped = false }: StageChipProps): ReactElement {
  return (
    <span className={`enq-chip${stamped ? " enq-chip--stamped" : ""}`} data-tone={stageTone(state)}>
      <span className="enq-dot" aria-hidden="true" />
      {stageLabel(state)}
    </span>
  );
}

interface EnquiryStagesProps {
  readonly filter: DeskFilter;
  /** Null until the counts are known; a stage then shows its name alone. */
  readonly counts: EnquiryStageCounts | null;
  readonly onFilter: (filter: DeskFilter) => void;
}

export function EnquiryStages({ filter, counts, onFilter }: EnquiryStagesProps): ReactElement {
  return (
    <div className="enq-stages" role="group" aria-label="Show enquiries by stage">
      {FILTERS.map((stage) => {
        const count = counts === null ? null : stage === "all" ? counts.all : counts.byState[stage];
        const label = stage === "all" ? "All" : stageLabel(stage);
        const shown = count === null ? "" : count.toLocaleString("en-GB");
        return (
          <button
            key={stage}
            type="button"
            className={`enq-stage enq-stage--${stage === "all" ? "all" : stageTone(stage)}`}
            aria-pressed={filter === stage}
            aria-label={count === null ? label : `${label}, ${shown}`}
            onClick={() => { onFilter(stage); }}
          >
            <span className={`enq-stage__count${count !== null && count > 0 ? " enq-stage__count--has" : ""}`} aria-hidden="true">
              {shown}
            </span>
            <span className="enq-stage__label" aria-hidden="true">
              {stage !== "all" && <span className="enq-dot" data-tone={stageTone(stage)} />}
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
