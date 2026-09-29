import type { ReactElement } from "react";
import type { PipelineTask } from "../../../api/crm.js";
import { dueIsPressing, dueWords } from "./pipeline-desk-format.js";

// ---------------------------------------------------------------------------
// Beside the ledger while no deal is open: the follow-ups owed across the
// pipeline, soonest first, each a step from its deal.
// ---------------------------------------------------------------------------

interface PipelineOverviewProps {
  /** The follow-ups owed, or null until the pipeline has been read: nothing
   *  is said to be owed, or not, of a pipeline not yet read. */
  readonly tasks: readonly PipelineTask[] | null;
  /** Every open follow-up, where the page shows only some. */
  readonly total: number | null;
  readonly nowMs: number;
  readonly onOpenDeal: (opportunityId: string) => void;
}

export function PipelineOverview({ tasks, total, nowMs, onOpenDeal }: PipelineOverviewProps): ReactElement {
  const more = total === null || tasks === null ? 0 : Math.max(0, total - tasks.length);
  return (
    <aside className="enq-panel pl-overview" data-register="forest" aria-label="Pipeline overview">
      <div className="enq-panel__body enq-overview">
        <h2>Follow-ups owed</h2>
        {tasks === null ? (
          <p>What is owed shows here once the pipeline is read.</p>
        ) : tasks.length === 0 ? (
          <p>Nothing is owed on any deal. Follow-ups you add to a deal appear here, soonest first.</p>
        ) : (
          <ul className="pl-owed">
            {tasks.map((task) => {
              const due = dueWords({ stage: "new", nextActionDueAt: task.dueAt, closedAt: null, updatedAt: task.updatedAt }, nowMs);
              const pressing = dueIsPressing({ stage: "new", nextActionDueAt: task.dueAt }, nowMs);
              return (
                <li key={task.id}>
                  <button type="button" className="cl-item" onClick={() => { onOpenDeal(task.opportunityId); }}>
                    <span className="cl-item__title">{task.title}</span>
                    <span className="cl-item__detail">
                      <span className={pressing ? "pl-next__due--pressing" : undefined}>{due}</span>
                      {task.opportunityTitle === null ? "" : ` · ${task.opportunityTitle}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {more > 0 && <p className="enq-next__hint">{`${more.toLocaleString("en-GB")} more after these.`}</p>}
        <p className="enq-next__hint">Open a deal to see its next step. <kbd className="cl-key">j</kbd> and <kbd className="cl-key">k</kbd> move through the list.</p>
      </div>
    </aside>
  );
}
