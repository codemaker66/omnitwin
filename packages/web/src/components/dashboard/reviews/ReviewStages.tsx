import type { ReactElement } from "react";
import { REVIEW_STAGES, stageLabel, stageTone, type ReviewFilter, type ReviewStage, type StageCounts } from "./review-desk-format.js";

// ---------------------------------------------------------------------------
// The queue's three stages across the top of the desk: each count is also its
// filter, so the numbers that say where the work is are how you get to it.
// ---------------------------------------------------------------------------

const FILTERS: readonly ReviewFilter[] = [...REVIEW_STAGES, "all"];

export function ReviewStageChip({ stage, stamped = false }: { readonly stage: ReviewStage; readonly stamped?: boolean }): ReactElement {
  return (
    <span className={`enq-chip${stamped ? " enq-chip--stamped" : ""}`} data-tone={stageTone(stage)}>
      <span className="enq-dot" aria-hidden="true" />
      {stageLabel(stage)}
    </span>
  );
}

interface ReviewStagesProps {
  readonly filter: ReviewFilter;
  /** Null until the queue has been read; a stage then shows its name alone. */
  readonly counts: StageCounts | null;
  readonly onFilter: (filter: ReviewFilter) => void;
}

export function ReviewStages({ filter, counts, onFilter }: ReviewStagesProps): ReactElement {
  return (
    <div className="enq-stages rev-stages" role="group" aria-label="Show layouts by stage">
      {FILTERS.map((stage) => {
        const count = counts === null ? null
          : stage === "all" ? counts.to_start + counts.in_review + counts.with_planner : counts[stage];
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
