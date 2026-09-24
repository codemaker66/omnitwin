import { describe, expect, it } from "vitest";
import type { Enquiry, EnquiryPage } from "../../../api/enquiries.js";
import {
  appendEnquiryPage, describeEnquiryCount, ENQUIRY_PAGE_OVERLAP, ENQUIRY_PAGE_SIZE, hasMoreEnquiries,
  nextPageWindow, withoutListedEnquiry, type ListedEnquiries,
} from "../enquiry-list-paging.js";

function enquiry(n: number, state = "submitted"): Enquiry {
  return {
    id: `enquiry-${String(n)}`, venueId: "venue-1", spaceId: "space-1", configurationId: null, userId: null,
    guestEmail: null, guestPhone: null, guestName: null, state, name: `Client ${String(n)}`,
    email: `client${String(n)}@example.com`, preferredDate: null, eventType: null, estimatedGuests: null,
    message: null, createdAt: new Date(Date.UTC(2026, 8, 1) + n * 60_000).toISOString(),
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

/** Newest first: the server's list is ids from `newest` down to 1. */
function serverList(newest: number, without: readonly number[] = []): Enquiry[] {
  return Array.from({ length: newest }, (_, index) => enquiry(newest - index))
    .filter((row) => !without.includes(Number(row.id.slice("enquiry-".length))));
}

function pageOf(rows: readonly Enquiry[], window: { offset: number; limit: number }): EnquiryPage {
  return { rows: rows.slice(window.offset, window.offset + window.limit), total: rows.length,
    limit: window.limit, offset: window.offset, order: "created_desc" };
}

function listed(rows: readonly Enquiry[], total: number): ListedEnquiries {
  return { rows, nextOffset: rows.length, total };
}

const ids = (rows: readonly Enquiry[]): string[] => rows.map((row) => row.id);

describe("enquiry list paging windows", () => {
  it("re-reads the last few listed rows ahead of each next page", () => {
    expect(ENQUIRY_PAGE_SIZE).toBe(20);
    expect(nextPageWindow(listed(serverList(57).slice(0, 20), 57))).toEqual({ offset: 20 - ENQUIRY_PAGE_OVERLAP, limit: 25 });
    expect(nextPageWindow(listed(serverList(57).slice(0, 3), 57))).toEqual({ offset: 0, limit: 23 });
    expect(nextPageWindow(listed([], 57))).toEqual({ offset: 0, limit: 20 });
  });

  it("has more only while the server position is short of the total", () => {
    expect(hasMoreEnquiries({ rows: [], nextOffset: 20, total: 57 })).toBe(true);
    expect(hasMoreEnquiries({ rows: [], nextOffset: 57, total: 57 })).toBe(false);
  });
});

describe("appendEnquiryPage", () => {
  it("continues after the last listed row when nothing changed", () => {
    const server = serverList(57);
    const first = listed(server.slice(0, 20), 57);
    const next = appendEnquiryPage(first, pageOf(server, nextPageWindow(first)));
    expect(ids(next.rows)).toEqual(ids(server.slice(0, 40)));
    expect(next).toMatchObject({ nextOffset: 40, total: 57, continuous: true });
  });

  it("never repeats a row when an enquiry was created above the reader's position", () => {
    const first = listed(serverList(57).slice(0, 20), 57);
    const grown = serverList(58); // enquiry 58 arrived at the top; every later row moved down one
    const next = appendEnquiryPage(first, pageOf(grown, nextPageWindow(first)));
    expect(ids(next.rows)).toEqual(ids(serverList(57).slice(0, 39)));
    expect(new Set(ids(next.rows)).size).toBe(next.rows.length);
    expect(next).toMatchObject({ nextOffset: 40, total: 58, continuous: true });
  });

  it("skips no row when an enquiry above the reader's position left the filtered set", () => {
    const original = serverList(57);
    const first = listed(original.slice(0, 20), 57);
    const shrunk = serverList(57, [54]); // listed row 4 (enquiry 54) changed status elsewhere
    const next = appendEnquiryPage(first, pageOf(shrunk, nextPageWindow(first)));
    expect(ids(next.rows)).toEqual(ids(original.slice(0, 41)));
    expect(next.continuous).toBe(true);
  });

  it("continues from an earlier listed row when the last one itself left the set", () => {
    const original = serverList(57);
    const first = listed(original.slice(0, 20), 57);
    const next = appendEnquiryPage(first, pageOf(serverList(57, [38]), nextPageWindow(first)));
    expect(ids(next.rows)).toEqual(ids([...original.slice(0, 20), ...original.slice(20, 41)]));
    expect(next.continuous).toBe(true);
  });

  it("flags a page it cannot join when more rows left than it re-reads", () => {
    const original = serverList(57);
    const first = listed(original.slice(0, 20), 57);
    const next = appendEnquiryPage(first, pageOf(serverList(57, [57, 56, 55, 54, 53, 52]), nextPageWindow(first)));
    expect(next.continuous).toBe(false);
    // The rows it holds are real and appended in order; enquiry 37 was skipped.
    expect(ids(next.rows.slice(20, 21))).toEqual(["enquiry-36"]);
  });

  it("flags an empty page past a list that shrank under the reader", () => {
    const first = listed(serverList(25).slice(0, 20), 25);
    const next = appendEnquiryPage(first, pageOf(serverList(15), nextPageWindow(first)));
    expect(next).toMatchObject({ rows: first.rows, nextOffset: 15, total: 15, continuous: false });
  });

  it("does not append a listed row twice when the server order moved it later", () => {
    const rows = serverList(30);
    const first = listed(rows.slice(0, 20), 30);
    const moved = rows[2];
    if (moved === undefined) throw new Error("fixture");
    // An order on a mutable column (the legacy API) can move a listed row to a later page.
    const page: EnquiryPage = { rows: [...rows.slice(15, 30), moved], total: 30, limit: 25, offset: 15, order: null };
    const next = appendEnquiryPage(first, page);
    expect(ids(next.rows)).toEqual(ids(rows.slice(0, 30)));
  });
});

describe("withoutListedEnquiry", () => {
  it("drops the row and shifts the server position with it", () => {
    const rows = serverList(31).slice(0, 20);
    const after = withoutListedEnquiry(listed(rows, 31), "enquiry-28");
    expect(after.rows).toHaveLength(19);
    expect(after).toMatchObject({ nextOffset: 19, total: 30 });
    expect(nextPageWindow(after)).toEqual({ offset: 14, limit: 25 });
  });

  it("leaves the list alone for an enquiry it does not hold", () => {
    const before = listed(serverList(31).slice(0, 20), 31);
    expect(withoutListedEnquiry(before, "enquiry-1")).toBe(before);
  });
});

describe("describeEnquiryCount", () => {
  it.each([
    [{ shown: 20, total: 57, filter: "all", newestFirst: true }, "Showing 20 of 57 enquiries, newest first"],
    [{ shown: 57, total: 57, filter: "all", newestFirst: true }, "Showing all 57 enquiries, newest first"],
    [{ shown: 1, total: 1, filter: "submitted", newestFirst: true }, "Showing 1 submitted enquiry, newest first"],
    [{ shown: 3, total: 12, filter: "under_review", newestFirst: false }, "Showing 3 of 12 enquiries under review"],
    [{ shown: 0, total: 1, filter: "withdrawn", newestFirst: true }, "Showing 0 of 1 withdrawn enquiry, newest first"],
    [{ shown: 5, total: 4, filter: "approved", newestFirst: true }, "Showing 5 approved enquiries, newest first"],
  ])("describes %j", (input, expected) => {
    expect(describeEnquiryCount(input)).toBe(expected);
  });

  it("has nothing to count for an empty list", () => {
    expect(describeEnquiryCount({ shown: 0, total: 0, filter: "rejected", newestFirst: true })).toBeNull();
  });
});
