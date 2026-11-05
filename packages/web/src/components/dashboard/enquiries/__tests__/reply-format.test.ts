import { describe, expect, it } from "vitest";
import { REPORTED_RESPONSE_CHANNELS } from "@omnitwin/types";
import { summaryText } from "../enquiry-desk-format.js";
import { REPLY_CHANNEL_CHOICES, replyAlarmSummary, replyRecordLine, waitedFor } from "../reply-format.js";

// Thursday 24 September 2026, 15:00 in Glasgow (BST).
const NOW = Date.parse("2026-09-24T14:00:00.000Z");
const HOUR = 3_600_000;

describe("the first reply's record line", () => {
  it("says how, when in venue time as the timeline does, and 'by you' only for the reader's own reply", () => {
    const at = "2026-09-24T13:02:00.000Z";
    expect(replyRecordLine({ at, channel: "phone", byUserId: "me", viewerId: "me" })).toBe("By phone · Thu 24 Sep, 14:02 · by you");
    expect(replyRecordLine({ at, channel: "email", byUserId: "colleague", viewerId: "me" })).toBe("By email · Thu 24 Sep, 14:02");
    expect(replyRecordLine({ at, channel: "decision", byUserId: null, viewerId: "me" })).toBe("With the decision email · Thu 24 Sep, 14:02");
    expect(replyRecordLine({ at, channel: "proposal", byUserId: null, viewerId: null })).toBe("With a proposal · Thu 24 Sep, 14:02");
  });

  it("names an unknown channel plainly, and nothing for a time it cannot read", () => {
    expect(replyRecordLine({ at: "2025-12-30T10:15:00.000Z", channel: "carrier_pigeon", byUserId: null, viewerId: null }))
      .toBe("Replied · Tue 30 Dec, 10:15");
    expect(replyRecordLine({ at: "not a time", channel: "phone", byUserId: null, viewerId: null })).toBeNull();
  });

  it("offers every channel a person may report, and only those", () => {
    expect(REPLY_CHANNEL_CHOICES.map((choice) => choice.channel).sort()).toEqual([...REPORTED_RESPONSE_CHANNELS].sort());
  });
});

describe("how long an enquiry has waited", () => {
  it("counts whole hours under two days, then whole days", () => {
    expect(waitedFor(NOW - 30 * 60_000, NOW)).toBe("0 hours");
    expect(waitedFor(NOW - HOUR, NOW)).toBe("1 hour");
    expect(waitedFor(NOW - 26.9 * HOUR, NOW)).toBe("26 hours");
    expect(waitedFor(NOW - 47.9 * HOUR, NOW)).toBe("47 hours");
    expect(waitedFor(NOW - 48 * HOUR, NOW)).toBe("2 days");
    expect(waitedFor(NOW - 80 * HOUR, NOW)).toBe("3 days");
    // A clock a little behind never says a negative wait.
    expect(waitedFor(NOW + HOUR, NOW)).toBe("0 hours");
  });
});

describe("the alarm's sentence", () => {
  it("says nothing when nothing is past the mark", () => {
    expect(replyAlarmSummary({ overdue: 0, thresholdHours: 24, longestArrivedAtMs: null, nowMs: NOW })).toBeNull();
  });

  it("counts the waiting enquiries, says the mark, and the longest wait when there are several", () => {
    const one = replyAlarmSummary({ overdue: 1, thresholdHours: 24, longestArrivedAtMs: NOW - 30 * HOUR, nowMs: NOW });
    expect(one === null ? null : summaryText(one)).toBe("1 enquiry has waited more than 24 hours for a first reply.");
    const several = replyAlarmSummary({ overdue: 3, thresholdHours: 24, longestArrivedAtMs: NOW - 80 * HOUR, nowMs: NOW });
    expect(several === null ? null : summaryText(several)).toBe("3 enquiries have waited more than 24 hours for a first reply; the longest, 3 days.");
    expect(several?.[0]).toEqual({ strong: "3 enquiries", tone: "alarm" });
  });
});
