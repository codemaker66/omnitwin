import type { Enquiry, EnquiryPage } from "../../api/enquiries.js";

// ---------------------------------------------------------------------------
// Offset paging for the staff Enquiries list.
//
// The list is newest first (created_at DESC, id DESC). An enquiry created
// while staff read it pushes every later row one offset down, so the next
// page would repeat a listed row; one that leaves the filtered set above the
// reader's position pulls them up, so the next page would skip a row. Each
// "load more" therefore re-reads a few listed rows and continues after the
// latest listed row the window still holds. When the window holds none of
// them, rows between the list's end and the new page may be missing, and the
// view says so instead of implying the list is complete.
// ---------------------------------------------------------------------------

export const ENQUIRY_PAGE_SIZE = 20;
/** Listed rows each load-more re-reads to find where the list continues. */
export const ENQUIRY_PAGE_OVERLAP = 5;

export interface ListedEnquiries {
  readonly rows: readonly Enquiry[];
  /** Server offset just past the last row read, as of the latest page. */
  readonly nextOffset: number;
  /** Enquiries matching the filter in the caller's scope, per the latest page. */
  readonly total: number;
}

export interface PageWindow {
  readonly offset: number;
  readonly limit: number;
}

/** The first page of a filter. */
export function firstPageWindow(): PageWindow {
  return { offset: 0, limit: ENQUIRY_PAGE_SIZE };
}

/** The next page, preceded by up to ENQUIRY_PAGE_OVERLAP already-read rows. */
export function nextPageWindow(listed: ListedEnquiries): PageWindow {
  const offset = Math.max(0, listed.nextOffset - ENQUIRY_PAGE_OVERLAP);
  return { offset, limit: ENQUIRY_PAGE_SIZE + listed.nextOffset - offset };
}

export function hasMoreEnquiries(listed: ListedEnquiries): boolean {
  return listed.nextOffset < listed.total;
}

export interface AppendedEnquiries extends ListedEnquiries {
  /** False when nothing proves the new rows follow the listed ones directly. */
  readonly continuous: boolean;
}

/** Joins a page to the list: new rows after the latest listed row the page
 *  holds, never a row that is already listed. */
export function appendEnquiryPage(listed: ListedEnquiries, page: EnquiryPage): AppendedEnquiries {
  const pageIndex = new Map(page.rows.map((row, index) => [row.id, index]));
  let anchor = -1;
  for (let index = listed.rows.length - 1; index >= 0 && anchor < 0; index -= 1) {
    const row = listed.rows[index];
    anchor = row === undefined ? -1 : pageIndex.get(row.id) ?? -1;
  }
  const listedIds = new Set(listed.rows.map((row) => row.id));
  return {
    rows: [...listed.rows, ...page.rows.slice(anchor + 1).filter((row) => !listedIds.has(row.id))],
    nextOffset: page.offset + page.rows.length,
    total: page.total,
    continuous: anchor >= 0 || listed.rows.length === 0 || page.offset === 0,
  };
}

/** A listed enquiry left the filtered set (its status was changed here), so
 *  every later row on the server moved up one offset. */
export function withoutListedEnquiry(listed: ListedEnquiries, id: string): ListedEnquiries {
  if (!listed.rows.some((row) => row.id === id)) return listed;
  return {
    rows: listed.rows.filter((row) => row.id !== id),
    nextOffset: Math.max(0, listed.nextOffset - 1),
    total: Math.max(0, listed.total - 1),
  };
}

const ENQUIRY_NOUNS = ["enquiry", "enquiries"] as const;
const FILTER_NOUNS: Readonly<Record<string, readonly [string, string]>> = {
  submitted: ["submitted enquiry", "submitted enquiries"],
  under_review: ["enquiry under review", "enquiries under review"],
  approved: ["approved enquiry", "approved enquiries"],
  rejected: ["rejected enquiry", "rejected enquiries"],
  withdrawn: ["withdrawn enquiry", "withdrawn enquiries"],
};

/** "Showing 20 of 57 enquiries, newest first" — the order only when the
 *  server confirmed it. Null when there is nothing to count. */
export function describeEnquiryCount(input: {
  readonly shown: number;
  readonly total: number;
  readonly filter: string;
  readonly newestFirst: boolean;
}): string | null {
  const { shown, total, filter, newestFirst } = input;
  if (total === 0 && shown === 0) return null;
  const [singular, plural] = FILTER_NOUNS[filter] ?? ENQUIRY_NOUNS;
  const noun = (count: number): string => (count === 1 ? singular : plural);
  const count = shown < total ? `Showing ${String(shown)} of ${String(total)} ${noun(total)}`
    : shown === 1 ? `Showing 1 ${singular}`
      : shown === total ? `Showing all ${String(total)} ${plural}`
        : `Showing ${String(shown)} ${noun(shown)}`;
  return newestFirst ? `${count}, newest first` : count;
}
