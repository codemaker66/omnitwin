import { describe, expect, it } from "vitest";
import {
  countPhrase,
  deskGreeting,
  deskSummary,
  eventDateParts,
  eventLead,
  eventWeekday,
  groupByReceived,
  guestsPhrase,
  messageExcerpt,
  receivedGroup,
  relativeAge,
  stageLabel,
  stageNouns,
  stageTone,
  summaryText,
  venueMoment,
  venueYear,
} from "../enquiry-desk-format.js";

// Thursday 24 September 2026, 15:00 in Glasgow (BST, UTC+1).
const NOW = Date.parse("2026-09-24T14:00:00.000Z");

describe("stage words", () => {
  it("names each stage as venue sales staff say it", () => {
    expect(["submitted", "under_review", "approved", "rejected", "withdrawn"].map(stageLabel))
      .toEqual(["New", "In review", "Approved", "Declined", "Withdrawn"]);
    expect(stageTone("submitted")).toBe("new");
    expect(stageTone("rejected")).toBe("declined");
    expect(stageLabel("on_hold")).toBe("On hold");
    expect(stageTone("on_hold")).toBe("other");
  });

  it("counts with the right noun for one and many", () => {
    expect(countPhrase(1, "submitted")).toBe("1 new enquiry");
    expect(countPhrase(3, "under_review")).toBe("3 enquiries in review");
    expect(countPhrase(1234, "all")).toBe("1,234 enquiries");
    expect(stageNouns("rejected")).toEqual(["declined enquiry", "declined enquiries"]);
    expect(guestsPhrase(1)).toBe("1 guest");
    expect(guestsPhrase(1200)).toBe("1,200 guests");
  });

  it("puts a client's message on one line, or nothing when it is blank", () => {
    expect(messageExcerpt("  Two lines\n\nof  message ")).toBe("Two lines of message");
    expect(messageExcerpt(" \n ")).toBeNull();
    expect(messageExcerpt(null)).toBeNull();
  });
});

describe("event dates", () => {
  it("reads a calendar date without shifting it across a time zone", () => {
    expect(eventDateParts("2027-06-06")).toEqual({ weekday: "Sun", day: "6", month: "Jun", year: "2027", full: "Sun 6 Jun 2027" });
    expect(eventDateParts("2027-01-01T00:00:00.000Z")?.full).toBe("Fri 1 Jan 2027");
  });

  it("returns nothing for a missing or impossible date", () => {
    expect(eventDateParts(null)).toBeNull();
    expect(eventDateParts("soon")).toBeNull();
    expect(eventDateParts("2027-02-30")).toBeNull();
    expect(eventWeekday("2027-02-30")).toBeNull();
    expect(eventLead(null, NOW)).toBeNull();
  });

  it("names the weekday and how far off the event is from the venue's today", () => {
    expect(eventWeekday("2027-06-05")).toBe("Saturday");
    expect(eventLead("2026-09-24", NOW)).toBe("today");
    expect(eventLead("2026-09-25", NOW)).toBe("tomorrow");
    expect(eventLead("2026-10-02", NOW)).toBe("in 8 days");
    expect(eventLead("2026-11-05", NOW)).toBe("in 6 weeks");
    expect(eventLead("2027-06-05", NOW)).toBe("in 8 months");
    expect(eventLead("2029-01-10", NOW)).toBe("in 2 years");
    expect(eventLead("2026-09-12", NOW)).toBe("date has passed");
    // Just after midnight in Glasgow, the 25th is already today.
    expect(eventLead("2026-09-25", Date.parse("2026-09-24T23:30:00.000Z"))).toBe("today");
    expect(venueYear(Date.parse("2026-12-31T23:30:00.000Z"))).toBe(2026);
  });
});

describe("moments", () => {
  it("shows venue-local time, including summer time", () => {
    expect(venueMoment("2026-09-22T08:14:00.000Z")).toBe("Tue 22 Sep, 09:14");
    expect(venueMoment("2026-12-01T08:14:00.000Z")).toBe("Tue 1 Dec, 08:14");
    expect(venueMoment("not a date")).toBeNull();
  });

  it("says how long ago in plain words, by venue calendar day", () => {
    expect(relativeAge("2026-09-24T13:59:40.000Z", NOW)).toBe("just now");
    expect(relativeAge("2026-09-24T13:48:00.000Z", NOW)).toBe("12 minutes ago");
    expect(relativeAge("2026-09-24T09:00:00.000Z", NOW)).toBe("5 hours ago");
    // 23:30 on the 23rd in Glasgow is yesterday, though under a day ago.
    expect(relativeAge("2026-09-23T22:30:00.000Z", NOW)).toBe("yesterday");
    expect(relativeAge("2026-09-19T10:00:00.000Z", NOW)).toBe("5 days ago");
    expect(relativeAge("2026-09-01T10:00:00.000Z", NOW)).toBe("3 weeks ago");
    expect(relativeAge("2026-06-12T10:00:00.000Z", NOW)).toBe("on 12 Jun 2026");
  });
});

describe("received groups", () => {
  it("buckets by venue calendar day and Monday-started weeks", () => {
    expect(receivedGroup("2026-09-24T06:00:00.000Z", NOW).label).toBe("Today");
    expect(receivedGroup("2026-09-23T23:30:00.000Z", NOW).label).toBe("Today");
    expect(receivedGroup("2026-09-23T10:00:00.000Z", NOW).label).toBe("Yesterday");
    expect(receivedGroup("2026-09-21T10:00:00.000Z", NOW).label).toBe("Earlier this week");
    expect(receivedGroup("2026-09-20T10:00:00.000Z", NOW).label).toBe("Last week");
    expect(receivedGroup("2026-09-14T10:00:00.000Z", NOW).label).toBe("Last week");
    expect(receivedGroup("2026-09-13T10:00:00.000Z", NOW).label).toBe("September 2026");
    expect(receivedGroup("2026-08-02T10:00:00.000Z", NOW).label).toBe("August 2026");
  });

  it("keeps a newest-first list in order, one heading per run", () => {
    const rows = [
      { id: "a", createdAt: "2026-09-24T09:00:00.000Z" },
      { id: "b", createdAt: "2026-09-24T07:00:00.000Z" },
      { id: "c", createdAt: "2026-09-22T07:00:00.000Z" },
      { id: "d", createdAt: "2026-08-02T07:00:00.000Z" },
    ];
    expect(groupByReceived(rows, NOW).map((group) => [group.label, group.rows.map((row) => row.id)]))
      .toEqual([["Today", ["a", "b"]], ["Earlier this week", ["c"]], ["August 2026", ["d"]]]);
  });
});

describe("desk summary", () => {
  const sentence = (input: Parameters<typeof deskSummary>[0]): string | null => {
    const parts = deskSummary(input);
    return parts === null ? null : summaryText(parts);
  };

  it("says what is waiting, from real counts only", () => {
    expect(sentence({ newCount: null, reviewCount: 2, longestWaitingCreatedAt: null, nowMs: NOW })).toBeNull();
    expect(sentence({ newCount: 0, reviewCount: 0, longestWaitingCreatedAt: null, nowMs: NOW }))
      .toBe("All caught up: nothing is waiting for a first look or a decision.");
    expect(sentence({ newCount: 0, reviewCount: 2, longestWaitingCreatedAt: null, nowMs: NOW }))
      .toBe("No new enquiries are waiting. 2 enquiries in review are waiting for a decision.");
    expect(sentence({ newCount: 1, reviewCount: 1, longestWaitingCreatedAt: "2026-09-24T09:00:00.000Z", nowMs: NOW }))
      .toBe("1 new enquiry is waiting for a first look; it arrived 5 hours ago. 1 enquiry in review is waiting for a decision.");
    expect(sentence({ newCount: 3, reviewCount: 0, longestWaitingCreatedAt: "2026-09-19T10:00:00.000Z", nowMs: NOW }))
      .toBe("3 new enquiries are waiting for a first look; the longest-waiting arrived 5 days ago.");
  });

  it("sets the counts and the wait apart, the new count in its own tone", () => {
    expect(deskSummary({ newCount: 2, reviewCount: 4, longestWaitingCreatedAt: "2026-09-19T10:00:00.000Z", nowMs: NOW }))
      .toEqual([
        { strong: "2 new enquiries", tone: "new" }, " are waiting for a first look", "; the longest-waiting arrived ",
        { strong: "5 days ago" }, ".", " ", { strong: "4 enquiries in review" }, " are waiting for a decision.",
      ]);
  });
});

describe("desk greeting", () => {
  it("greets by first name for the venue's time of day", () => {
    expect(deskGreeting(NOW, "Elaine MacGregor")).toEqual({ date: "Thursday 24 September", greeting: "Good afternoon, Elaine" });
    expect(deskGreeting(Date.parse("2026-09-24T07:30:00.000Z"), null).greeting).toBe("Good morning");
    expect(deskGreeting(Date.parse("2026-12-31T19:00:00.000Z"), "  ")).toEqual({ date: "Thursday 31 December", greeting: "Good evening" });
  });
});
