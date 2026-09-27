import type { ReactElement } from "react";
import { formatMinorAsCurrency } from "../../../lib/money-input.js";
import { LIVE_STAGES, dealStageTone, dealStageWords, type PipelineFilter } from "./pipeline-desk-format.js";

// ---------------------------------------------------------------------------
// The live stages across the copper plane: how many deals stand at each and
// what they are estimated at. Each count is also its filter, so the figures
// that say where the work is are how you get to it.
// ---------------------------------------------------------------------------

const FILTERS: readonly PipelineFilter[] = [...LIVE_STAGES, "all"];

export function DealStageChip({ stage, stamped = false }: { readonly stage: string; readonly stamped?: boolean }): ReactElement {
  return (
    <span className={`enq-chip${stamped ? " enq-chip--stamped" : ""}`} data-tone={dealStageTone(stage)}>
      <span className="enq-dot" aria-hidden="true" />
      {dealStageWords(stage)}
    </span>
  );
}

interface PipelineStagesProps {
  readonly filter: PipelineFilter;
  /** Null until the pipeline has been read; a stage then shows its name alone. */
  readonly counts: Readonly<Record<string, number>> | null;
  /** Null from an API that does not say what each stage is worth. */
  readonly values: Readonly<Record<string, number>> | null;
  readonly currency: string;
  readonly onFilter: (filter: PipelineFilter) => void;
}

export function PipelineStages({ filter, counts, values, currency, onFilter }: PipelineStagesProps): ReactElement {
  return (
    <div className="enq-stages pl-stages" role="group" aria-label="Show deals by stage">
      {FILTERS.map((stage) => {
        const count = counts === null ? null
          : stage === "all" ? LIVE_STAGES.reduce((sum, live) => sum + (counts[live] ?? 0), 0) : counts[stage] ?? 0;
        const value = values === null ? null
          : stage === "all" ? LIVE_STAGES.reduce((sum, live) => sum + (values[live] ?? 0), 0) : values[stage] ?? 0;
        const label = stage === "all" ? "All open" : dealStageWords(stage);
        const shown = count === null ? "" : count.toLocaleString("en-GB");
        // What the deals are worth, where anyone has put a value on them.
        const worth = value === null || value === 0 ? null : formatMinorAsCurrency(value, currency).replace(/\.00$/u, "");
        return (
          <button
            key={stage}
            type="button"
            className={`enq-stage enq-stage--${stage === "all" ? "all" : dealStageTone(stage)}`}
            aria-pressed={filter === stage}
            aria-label={[label, count === null ? null : shown, worth].filter((part): part is string => part !== null).join(", ")}
            onClick={() => { onFilter(stage); }}
          >
            <span className={`enq-stage__count${count !== null && count > 0 ? " enq-stage__count--has" : ""}`} aria-hidden="true">
              {shown}
            </span>
            <span className="enq-stage__label" aria-hidden="true">
              {stage !== "all" && <span className="enq-dot" data-tone={dealStageTone(stage)} />}
              {label}
            </span>
            <span className="pl-stage__value" aria-hidden="true">{worth}</span>
          </button>
        );
      })}
    </div>
  );
}
