import type { ReactElement } from "react";
import type { Enquiry, EnquiryStageCounts } from "../../../api/enquiries.js";
import { enquiryDetails, enquiryName } from "./EnquiryLedger.js";
import { countPhrase, eventDateParts, relativeAge, type DeskFilter } from "./enquiry-desk-format.js";
import { RoomPhotoBand } from "./EnquiryPanel.js";
import type { RoomLookup } from "./use-venue-rooms.js";

// ---------------------------------------------------------------------------
// The panel with nothing open: the desk's next move, from the real counts.
// A new enquiry waiting is the goal; when nothing is waiting, the desk says
// so plainly and rests.
// ---------------------------------------------------------------------------

interface EnquiryOverviewProps {
  readonly counts: EnquiryStageCounts | null;
  readonly nowMs: number;
  /** Status changes made here since the desk opened. */
  readonly moved: number;
  readonly room: RoomLookup;
  readonly onOpen: (enquiry: Enquiry) => void;
  readonly onFilter: (filter: DeskFilter) => void;
}

export function EnquiryOverview({ counts, nowMs, moved, room, onOpen, onFilter }: EnquiryOverviewProps): ReactElement {
  return (
    <aside className="enq-panel" aria-label="Desk overview">
      <div className="enq-panel__body enq-overview">
        <NextMove counts={counts} nowMs={nowMs} room={room} onOpen={onOpen} onFilter={onFilter} />
        {moved > 0 && (
          <p className="enq-overview__tally">
            <span>{moved.toLocaleString("en-GB")}</span>
            {moved === 1 ? "enquiry" : "enquiries"} moved forward this session
          </p>
        )}
      </div>
    </aside>
  );
}

function NextMove({ counts, nowMs, room, onOpen, onFilter }: Omit<EnquiryOverviewProps, "moved">): ReactElement {
  if (counts === null) {
    return (
      <>
        <h2>Choose an enquiry</h2>
        <p>It opens here, beside the list, so you never lose your place.</p>
      </>
    );
  }

  const newCount = counts.byState.submitted;
  const reviewCount = counts.byState.under_review;
  const next = counts.longestWaiting;

  if (newCount > 0 && next !== null) {
    const age = relativeAge(next.createdAt, nowMs);
    const nextRoom = room(next);
    const details = [eventDateParts(next.preferredDate)?.full ?? "Date to be confirmed", ...enquiryDetails(next, nextRoom?.name)];
    return (
      <>
        {nextRoom?.photo !== undefined && nextRoom.photo !== null && <RoomPhotoBand photo={nextRoom.photo} />}
        <p className="enq-eyebrow">Next up{age === null ? "" : ` · arrived ${age}`}</p>
        <h2>{enquiryName(next)}</h2>
        <p>{details.join(" · ")}</p>
        <div className="enq-actions">
          <button type="button" className="enq-cta" onClick={() => { onOpen(next); }}>Open the longest-waiting enquiry</button>
        </div>
        {newCount > 1 && <p className="enq-next__hint">{countPhrase(newCount - 1, "submitted")} after this one.</p>}
      </>
    );
  }

  if (newCount > 0) {
    return (
      <>
        <p className="enq-eyebrow">Waiting for a first look</p>
        <h2>{countPhrase(newCount, "submitted")}</h2>
        <div className="enq-actions">
          <button type="button" className="enq-cta" onClick={() => { onFilter("submitted"); }}>Show the new enquiries</button>
        </div>
      </>
    );
  }

  if (reviewCount > 0) {
    return (
      <>
        <p className="enq-eyebrow">Nothing new is waiting</p>
        <h2>{countPhrase(reviewCount, "under_review")}</h2>
        <p>{reviewCount === 1 ? "It is" : "Each is"} waiting for a decision.</p>
        <div className="enq-actions">
          <button type="button" className="enq-cta" onClick={() => { onFilter("under_review"); }}>Show the enquiries in review</button>
        </div>
      </>
    );
  }

  return (
    <>
      <Seal />
      <h2>All caught up</h2>
      <p>Nothing is waiting on you. New enquiries appear here as they arrive.</p>
    </>
  );
}

function Seal(): ReactElement {
  return (
    <svg className="enq-seal" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle cx="32" cy="32" r="30" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <circle cx="32" cy="32" r="24.5" fill="none" stroke="currentColor" strokeWidth="0.75" strokeDasharray="1.5 3" />
      <path d="M22 33.5l6.5 6.5L43 25.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
