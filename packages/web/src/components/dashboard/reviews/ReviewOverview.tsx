import { useId, type ReactElement, type RefObject } from "react";
import type { PendingReviewEntry } from "../../../api/configuration-reviews.js";
import { eventDateParts } from "../enquiries/enquiry-desk-format.js";
import { Seal } from "../enquiries/EnquiryOverview.js";
import { eventCalendarDate, queueAge, queueDetails, stagePhrase, type ReviewFilter, type StageCounts } from "./review-desk-format.js";
import { PanelBar, type PanelNavigation } from "./ReviewPanel.js";

// ---------------------------------------------------------------------------
// The panel with no review open: the queue's next move, from the queue
// itself. After a decision takes a review out of the queue, the panel says
// what happened and offers the next one, so a reviewer working through the
// queue keeps their place and never lands on an empty page.
// ---------------------------------------------------------------------------

/** What happened to the review that just left the queue. */
export interface Recorded {
  readonly id: string;
  readonly name: string;
  /** "Approved. The planner and your hallkeepers are being emailed." */
  readonly outcome: string;
  /** True when someone else moved it on first, so this reviewer's decision was not recorded. */
  readonly movedElsewhere: boolean;
}

interface ReviewOverviewProps {
  /** Null until the queue has been read. */
  readonly counts: StageCounts | null;
  /** The longest-waiting layout to start, if any. */
  readonly next: PendingReviewEntry | null;
  readonly nowMs: number;
  readonly recorded: Recorded | null;
  /** The next review that waits on the venue, from the recorded one's place. */
  readonly after: PendingReviewEntry | null;
  readonly navigation: PanelNavigation | null;
  readonly headingRef: RefObject<HTMLHeadingElement>;
  readonly onOpen: (entry: PendingReviewEntry) => void;
  readonly onFilter: (filter: ReviewFilter) => void;
}

export function ReviewOverview(props: ReviewOverviewProps): ReactElement {
  const { recorded, navigation } = props;
  return (
    <aside className="enq-panel rev-panel" data-register="forest" aria-label={recorded === null ? "Queue overview" : "Review recorded"}>
      <div className="enq-panel__body enq-overview">
        {recorded !== null && navigation !== null && <PanelBar navigation={navigation} closeLabel="Close" />}
        {recorded !== null ? <RecordedMove {...props} recorded={recorded} /> : <NextMove {...props} />}
      </div>
    </aside>
  );
}

function RecordedMove({ recorded, after, headingRef, onOpen }: ReviewOverviewProps & { readonly recorded: Recorded }): ReactElement {
  const nextId = useId();
  return (
    <>
      <p className="enq-eyebrow">{recorded.movedElsewhere ? "Changed while it was open here" : "Recorded"}</p>
      <h2 ref={headingRef} tabIndex={-1} data-testid="review-recorded">{recorded.name}</h2>
      <p role="status">{recorded.outcome}</p>
      {after !== null ? (
        <>
          <div className="enq-actions">
            <button type="button" className="enq-cta" data-primary="true" aria-describedby={nextId} onClick={() => { onOpen(after); }}>
              Open the next review
            </button>
          </div>
          <p className="enq-next__hint" id={nextId}>Next: {after.name}</p>
        </>
      ) : (
        <p className="enq-next__hint">Nothing else is waiting on you.</p>
      )}
    </>
  );
}

function NextMove({ counts, next, nowMs, headingRef, onOpen, onFilter }: ReviewOverviewProps): ReactElement {
  if (counts === null) {
    return (
      <>
        <h2 ref={headingRef} tabIndex={-1}>Choose a layout</h2>
        <p>It opens here, beside the queue, so you never lose your place.</p>
      </>
    );
  }

  if (counts.to_start > 0 && next !== null) {
    const age = queueAge(next, nowMs);
    const date = eventDateParts(eventCalendarDate(next));
    return (
      <>
        <p className="enq-eyebrow">Next up{age === null ? "" : ` · submitted ${age}`}</p>
        <h2 ref={headingRef} tabIndex={-1}>{next.name}</h2>
        <p>{[date?.full ?? "Not in the Diary yet", ...queueDetails(next)].join(" · ")}</p>
        <div className="enq-actions">
          <button type="button" className="enq-cta" onClick={() => { onOpen(next); }}>Open the longest-waiting layout</button>
        </div>
        {counts.to_start > 1 && <p className="enq-next__hint">{stagePhrase(counts.to_start - 1, "to_start")} after this one.</p>}
      </>
    );
  }

  if (counts.in_review > 0) {
    return (
      <>
        <p className="enq-eyebrow">Nothing new is waiting</p>
        <h2 ref={headingRef} tabIndex={-1}>{stagePhrase(counts.in_review, "in_review")}</h2>
        <p>{counts.in_review === 1 ? "It waits" : "Each waits"} for a decision.</p>
        <div className="enq-actions">
          <button type="button" className="enq-cta" onClick={() => { onFilter("in_review"); }}>Show the layouts in review</button>
        </div>
      </>
    );
  }

  return (
    <>
      <Seal />
      <h2 ref={headingRef} tabIndex={-1}>All caught up</h2>
      <p>
        {counts.with_planner > 0
          ? `Nothing is waiting on you. ${stagePhrase(counts.with_planner, "with_planner")} for changes.`
          : "Nothing is waiting on you. Layouts appear here as planners submit them."}
      </p>
    </>
  );
}
