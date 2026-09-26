import { afterEach, describe, it, expect, vi } from "vitest";
import { WORKSPACE_COLOURS } from "@omnitwin/types";
import {
  HOLD_REMINDER_STALE_WINDOW_MS,
  daysUntilDecision,
  formatVenueDay,
  selectDueHoldReminders,
  selectOwnerlessDueReminders,
  runHoldReminderPassOnHolds,
  type ReminderHold,
} from "../../services/hold-reminders.js";
import { decisionWhen, holdDecisionReminder, provisionalStatus } from "../../services/email-templates.js";
import type { Database } from "../../db/client.js";

// ---------------------------------------------------------------------------
// Hold-reminder delivery (T-527, Slice 7) — tests written FIRST.
//
// The T-7/3/1 schedule comes from the tested pure core
// (computeHoldReminderInstants); these tests cover the DELIVERY layer:
// which instants are DUE at a given clock, and how a pass turns due
// reminders into idempotent sends through the house email service.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function hold(overrides: Partial<ReminderHold> & { decisionAt: Date }): ReminderHold {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    title: "The Hartley wedding",
    spaceName: "Grand Hall",
    startsAt: new Date("2026-11-14T15:00:00.000Z"),
    rank: 1,
    jointFlag: false,
    ownerEmail: "fiona@tradeshall.example",
    ownerName: "Fiona",
    ...overrides,
  };
}

describe("selectDueHoldReminders", () => {
  const NOW = new Date("2026-07-20T10:00:00.000Z");

  it("marks the T-7 reminder due once its instant passes, within the freshness window", () => {
    // Decision in 6d23h → the T-7 instant fired 1h ago.
    const h = hold({ decisionAt: new Date(NOW.getTime() + 7 * DAY_MS - HOUR_MS) });
    const due = selectDueHoldReminders([h], NOW);
    expect(due).toHaveLength(1);
    expect(due[0]?.daysBefore).toBe(7);
    expect(due[0]?.hold.id).toBe(h.id);
  });

  it("is not due before the instant arrives", () => {
    // Decision in 7d1min → T-7 fires in one minute, not yet.
    const h = hold({ decisionAt: new Date(NOW.getTime() + 7 * DAY_MS + 60_000) });
    expect(selectDueHoldReminders([h], NOW)).toHaveLength(0);
  });

  it("skips instants staler than the freshness window instead of sending late", () => {
    // Decision in 5d → the T-7 instant fired 2d ago (stale); T-3 not yet due.
    const h = hold({ decisionAt: new Date(NOW.getTime() + 5 * DAY_MS) });
    expect(selectDueHoldReminders([h], NOW)).toHaveLength(0);
  });

  it("never marks two instants due at once (the window is narrower than the gaps)", () => {
    // Decision in exactly 3d → T-3 due this instant; T-7 fired 4d ago (stale).
    const h = hold({ decisionAt: new Date(NOW.getTime() + 3 * DAY_MS) });
    const due = selectDueHoldReminders([h], NOW);
    expect(due).toHaveLength(1);
    expect(due[0]?.daysBefore).toBe(3);
  });

  it("marks T-1 due in the final day", () => {
    const h = hold({ decisionAt: new Date(NOW.getTime() + 12 * HOUR_MS) });
    const due = selectDueHoldReminders([h], NOW);
    expect(due).toHaveLength(1);
    expect(due[0]?.daysBefore).toBe(1);
  });

  it("sends nothing once the decision moment has arrived or passed", () => {
    expect(selectDueHoldReminders([hold({ decisionAt: NOW })], NOW)).toHaveLength(0);
    expect(
      selectDueHoldReminders([hold({ decisionAt: new Date(NOW.getTime() - HOUR_MS) })], NOW),
    ).toHaveLength(0);
  });

  it("skips holds without a reachable owner", () => {
    const h = hold({
      decisionAt: new Date(NOW.getTime() + 7 * DAY_MS - HOUR_MS),
      ownerEmail: null,
    });
    expect(selectDueHoldReminders([h], NOW)).toHaveLength(0);
  });

  it("keeps the schedule stable across a Europe/London DST fold", () => {
    // Decision Mon 2026-03-30 12:00Z; the T-7 instant (Mar 23 12:00Z) is
    // exact 24h arithmetic, so clocks springing forward on Mar 29 must not
    // shift it. At Mar 23 12:30Z the T-7 reminder is 30min fresh.
    const decisionAt = new Date("2026-03-30T12:00:00.000Z");
    const now = new Date("2026-03-23T12:30:00.000Z");
    const due = selectDueHoldReminders([hold({ decisionAt })], now);
    expect(due).toHaveLength(1);
    expect(due[0]?.daysBefore).toBe(7);
    expect(due[0]?.at.toISOString()).toBe("2026-03-23T12:00:00.000Z");
  });

  it("exposes a freshness window of exactly one day", () => {
    expect(HOLD_REMINDER_STALE_WINDOW_MS).toBe(DAY_MS);
  });
});

describe("runHoldReminderPassOnHolds", () => {
  const NOW = new Date("2026-07-20T10:00:00.000Z");
  const DB = {} as Database; // passed through to the send layer untouched

  function dueHold(id: string, email = "owner@tradeshall.example"): ReminderHold {
    return hold({
      id,
      decisionAt: new Date(NOW.getTime() + 7 * DAY_MS - HOUR_MS),
      ownerEmail: email,
    });
  }

  it("sends one idempotent email per due reminder with the derived key", async () => {
    const send = vi.fn().mockResolvedValue(true);
    const summary = await runHoldReminderPassOnHolds(
      [dueHold("00000000-0000-4000-8000-00000000000a")],
      { db: DB, now: NOW, send },
    );

    expect(send).toHaveBeenCalledTimes(1);
    const [payload, options] = send.mock.calls[0] as [
      { to: string; subject: string; html: string },
      { idempotencyKey: string },
    ];
    expect(payload.to).toBe("owner@tradeshall.example");
    expect(payload.subject).toContain("7 days");
    expect(payload.subject).toContain("The Hartley wedding");
    expect(payload.html).toContain("Grand Hall");
    // The key carries the decision's venue-local day: a moved decision date
    // earns fresh reminders instead of deduping against the old date's send.
    expect(options.idempotencyKey).toBe(
      "hold-reminder:00000000-0000-4000-8000-00000000000a:2026-07-27:t-7",
    );
    expect(summary).toMatchObject({ scanned: 1, due: 1, sent: 1, failed: 0, dryRun: false });
    expect(summary.reminders[0]?.outcome).toBe("sent");
  });

  it("dryRun reports what would send without calling the send layer", async () => {
    const send = vi.fn().mockResolvedValue(true);
    const summary = await runHoldReminderPassOnHolds(
      [dueHold("00000000-0000-4000-8000-00000000000b")],
      { db: DB, now: NOW, send, dryRun: true },
    );
    expect(send).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ scanned: 1, due: 1, sent: 0, failed: 0, dryRun: true });
    expect(summary.reminders[0]?.outcome).toBe("dry_run");
    expect(summary.reminders[0]?.idempotencyKey).toBe(
      "hold-reminder:00000000-0000-4000-8000-00000000000b:2026-07-27:t-7",
    );
  });

  it("a failed send is counted and does not stop the pass", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const summary = await runHoldReminderPassOnHolds(
      [
        dueHold("00000000-0000-4000-8000-00000000000c", "first@tradeshall.example"),
        dueHold("00000000-0000-4000-8000-00000000000d", "second@tradeshall.example"),
      ],
      { db: DB, now: NOW, send },
    );
    expect(send).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({ scanned: 2, due: 2, sent: 1, failed: 1 });
  });

  it("a throwing send is caught, counted, and the pass continues", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("provider down"))
      .mockResolvedValueOnce(true);
    const summary = await runHoldReminderPassOnHolds(
      [
        dueHold("00000000-0000-4000-8000-00000000000e", "first@tradeshall.example"),
        dueHold("00000000-0000-4000-8000-00000000000f", "second@tradeshall.example"),
      ],
      { db: DB, now: NOW, send },
    );
    expect(summary).toMatchObject({ scanned: 2, due: 2, sent: 1, failed: 1 });
  });

  it("stamps the key with the decision's Europe/London day, not the UTC day", async () => {
    // Decision 2026-07-27T23:30Z = 00:30 on the 28th in BST — the venue's
    // calendar day. A UTC slice() regression would stamp 07-27 and fail here.
    const decisionAt = new Date("2026-07-27T23:30:00.000Z");
    const now = new Date(decisionAt.getTime() - 7 * DAY_MS + HOUR_MS); // T-7, 1h fresh
    const send = vi.fn().mockResolvedValue(true);
    const summary = await runHoldReminderPassOnHolds(
      [hold({ id: "00000000-0000-4000-8000-000000000010", decisionAt })],
      { db: DB, now, send },
    );
    expect(summary.reminders[0]?.idempotencyKey).toBe(
      "hold-reminder:00000000-0000-4000-8000-000000000010:2026-07-28:t-7",
    );
  });

  it("a moved decision date earns a fresh key — the old date's send cannot dedupe it", async () => {
    const id = "00000000-0000-4000-8000-000000000011";
    const send = vi.fn().mockResolvedValue(true);
    const firstDecision = new Date(NOW.getTime() + 7 * DAY_MS - HOUR_MS);
    const first = await runHoldReminderPassOnHolds(
      [hold({ id, decisionAt: firstDecision })],
      { db: DB, now: NOW, send },
    );
    // The client renegotiates: the decision moves out ten days. At the NEW
    // date's T-7 the key must differ from the first send's key.
    const movedDecision = new Date(firstDecision.getTime() + 10 * DAY_MS);
    const laterNow = new Date(movedDecision.getTime() - 7 * DAY_MS + HOUR_MS);
    const second = await runHoldReminderPassOnHolds(
      [hold({ id, decisionAt: movedDecision })],
      { db: DB, now: laterNow, send },
    );
    const firstKey = first.reminders[0]?.idempotencyKey;
    const secondKey = second.reminders[0]?.idempotencyKey;
    expect(firstKey).toBeDefined();
    expect(secondKey).toBeDefined();
    expect(secondKey).not.toBe(firstKey);
  });

  it("holds with nothing due produce an empty, honest summary", async () => {
    const send = vi.fn();
    const quiet = hold({ decisionAt: new Date(NOW.getTime() + 30 * DAY_MS) });
    const summary = await runHoldReminderPassOnHolds([quiet], { db: DB, now: NOW, send });
    expect(send).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ scanned: 1, due: 0, sent: 0, failed: 0 });
    expect(summary.reminders).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T-619 — the dry run Blake checks before the schedule is switched on, the
// holds nobody owns, and the email in his hold words.
// ---------------------------------------------------------------------------

describe("the pass summary a dry run prints (T-619)", () => {
  const NOW = new Date("2026-07-20T10:00:00.000Z");
  const DB = {} as Database;

  it("names the hold, room, dates, stage and owner — and carries no email address", async () => {
    const send = vi.fn().mockResolvedValue(true);
    const summary = await runHoldReminderPassOnHolds(
      [hold({
        id: "00000000-0000-4000-8000-000000000020",
        decisionAt: new Date(NOW.getTime() + 3 * DAY_MS - HOUR_MS),
        ownerName: "Fiona Coordinator",
        ownerEmail: "fiona@tradeshall.example",
      })],
      { db: DB, now: NOW, send, dryRun: true },
    );
    expect(send).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ scanned: 1, due: 1, sent: 0, failed: 0, noOwner: 0, dryRun: true });
    expect(summary.reminders).toEqual([{
      bookingId: "00000000-0000-4000-8000-000000000020",
      holdTitle: "The Hartley wedding",
      spaceName: "Grand Hall",
      holdDate: "Saturday 14 November 2026",
      decisionDate: "Thursday 23 July 2026",
      daysBefore: 3,
      ownerName: "Fiona Coordinator",
      idempotencyKey: "hold-reminder:00000000-0000-4000-8000-000000000020:2026-07-23:t-3",
      outcome: "dry_run",
    }]);
    // The workflow prints this summary to a log anyone with read access to
    // the repository can open.
    expect(JSON.stringify(summary)).not.toContain("@");
  });

  it("keeps a real pass's records free of addresses too", async () => {
    const send = vi.fn().mockResolvedValue(true);
    const summary = await runHoldReminderPassOnHolds(
      [hold({ decisionAt: new Date(NOW.getTime() + 7 * DAY_MS - HOUR_MS) })],
      { db: DB, now: NOW, send },
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(summary.reminders[0]?.outcome).toBe("sent");
    expect(JSON.stringify(summary)).not.toContain("@");
  });

  it("lists a due reminder on a hold nobody owns, and sends it to no one", async () => {
    const send = vi.fn().mockResolvedValue(true);
    const summary = await runHoldReminderPassOnHolds(
      [
        hold({ id: "00000000-0000-4000-8000-000000000021", decisionAt: new Date(NOW.getTime() + 7 * DAY_MS - HOUR_MS) }),
        hold({
          id: "00000000-0000-4000-8000-000000000022",
          title: "Ownerless dinner",
          decisionAt: new Date(NOW.getTime() + 7 * DAY_MS - HOUR_MS),
          ownerEmail: null,
          ownerName: null,
        }),
      ],
      { db: DB, now: NOW, send },
    );
    // Only the owned hold is emailed; the client is never the fallback.
    expect(send).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ scanned: 2, due: 1, sent: 1, failed: 0, noOwner: 1 });
    expect(summary.reminders.find((reminder) => reminder.outcome === "no_owner")).toMatchObject({
      bookingId: "00000000-0000-4000-8000-000000000022",
      holdTitle: "Ownerless dinner",
      ownerName: null,
      daysBefore: 7,
    });
  });

  it("selects ownerless reminders by the same schedule as owned ones", () => {
    const ownerless = hold({ decisionAt: new Date(NOW.getTime() + 12 * HOUR_MS), ownerEmail: null });
    expect(selectDueHoldReminders([ownerless], NOW)).toHaveLength(0);
    expect(selectOwnerlessDueReminders([ownerless], NOW).map((due) => due.daysBefore)).toEqual([1]);
    expect(selectOwnerlessDueReminders([hold({ decisionAt: new Date(NOW.getTime() + 12 * HOUR_MS) })], NOW)).toHaveLength(0);
  });
});

describe("the reminder email (T-619)", () => {
  const NOW = new Date("2026-07-20T10:00:00.000Z");
  const DB = {} as Database;
  const FRONTEND_BEFORE = process.env["FRONTEND_URL"];
  afterEach(() => {
    if (FRONTEND_BEFORE === undefined) delete process.env["FRONTEND_URL"];
    else process.env["FRONTEND_URL"] = FRONTEND_BEFORE;
  });

  async function sentEmail(overrides: Partial<ReminderHold> & { decisionAt: Date }, now = NOW): Promise<{ subject: string; html: string }> {
    const send = vi.fn().mockResolvedValue(true);
    await runHoldReminderPassOnHolds([hold(overrides)], { db: DB, now, send });
    const [payload] = send.mock.calls[0] as [{ subject: string; html: string }];
    return payload;
  }

  function visibleText(html: string): string {
    return html
      .replace(/<style[\s\S]*?<\/style>/gu, " ")
      .replace(/<[^>]+>/gu, " ")
      .replace(/&nbsp;/gu, " ")
      .replace(/\s+/gu, " ");
  }

  it("says the hold's standing in Blake's words and none of the internal ones", async () => {
    const { subject, html } = await sentEmail({ decisionAt: new Date(NOW.getTime() + 7 * DAY_MS - HOUR_MS) });
    const text = `${subject} ${visibleText(html)}`;
    expect(subject).toBe("Decision date in 7 days — The Hartley wedding, Grand Hall");
    expect(text).toContain("Provisional · 1st option");
    expect(text).toContain("Saturday 14 November 2026");
    expect(text).toContain("Monday 27 July 2026");
    expect(text).toContain("the client has not been emailed");
    for (const internal of [/pencil/iu, /\bink/iu, /prospect/iu, /ladder/iu, /hold decision/iu, /joint hold/iu, /\bhold\b/iu]) {
      expect(text, `internal word ${String(internal)}`).not.toMatch(internal);
    }
    // Plain and factual: no exclamation marks, no praise.
    expect(text).not.toContain("!");
    for (const praise of [/great/iu, /well done/iu, /congrat/iu, /amazing/iu, /awesome/iu]) {
      expect(text).not.toMatch(praise);
    }
  });

  it("uses the House workspace colours and a serif heading", async () => {
    const { html } = await sentEmail({ decisionAt: new Date(NOW.getTime() + 7 * DAY_MS - HOUR_MS) });
    for (const key of ["sheet", "ink-1", "ink-2", "forest", "forest-ink-1", "amber-wash", "amber-chip"] as const) {
      expect(html.toLowerCase(), key).toContain(WORKSPACE_COLOURS[key].toLowerCase());
    }
    expect(html).toContain("Newsreader");
    expect(html).toContain("Georgia");
    // The retired platform navy and blue are gone from this email.
    expect(html.toLowerCase()).not.toContain("#1a1a2e");
    expect(html.toLowerCase()).not.toContain("#3b82f6");
  });

  it("is valid table markup, so a mail client keeps the text, button and footer inside the sheet", async () => {
    const { html } = await sentEmail({ decisionAt: new Date(NOW.getTime() + 7 * DAY_MS - HOUR_MS) });
    // A <table> opened straight inside a <tbody> is a parse error that
    // browsers repair by closing the enclosing tables early; the rendered
    // email then lost its padding and its footer fell out of the sheet.
    expect(html).not.toMatch(/<tbody[^>]*>\s*<table/iu);
    expect(html).toMatch(/<tbody[^>]*>\s*<tr[^>]*>\s*<td[^>]*>Booking<\/td>/iu);
  });

  it("names Joint 1st and an unnumbered hold in the same words", () => {
    expect(provisionalStatus(1, true)).toBe("Provisional · Joint 1st");
    expect(provisionalStatus(2, false)).toBe("Provisional · 2nd option");
    expect(provisionalStatus(null, false)).toBe("Provisional");
  });

  it("says today, not tomorrow, when a morning run delivers the last reminder on the day", async () => {
    // Decision at 23:30 BST; the T-1 instant is 23:30 the evening before,
    // and the next morning's run (09:00 BST) is still inside the window.
    const decisionAt = new Date("2026-07-27T22:30:00.000Z");
    const morning = new Date("2026-07-27T08:00:00.000Z");
    expect(daysUntilDecision(morning, decisionAt)).toBe(0);
    const { subject } = await sentEmail({ decisionAt }, morning);
    expect(subject).toBe("Decision date today — The Hartley wedding, Grand Hall");
    expect(decisionWhen(1)).toBe("tomorrow");
    expect(decisionWhen(3)).toBe("in 3 days");
  });

  it("links to the week the booking sits in", async () => {
    process.env["FRONTEND_URL"] = "https://venviewer.example";
    const { html } = await sentEmail({ decisionAt: new Date(NOW.getTime() + 7 * DAY_MS - HOUR_MS) });
    expect(html).toContain("https://venviewer.example/diary?view=week&amp;date=2026-11-14");
  });

  it("greets the owner by name, and simply omits the greeting without one", async () => {
    const named = await holdDecisionReminder({
      holdTitle: "The Hartley wedding", spaceName: "Grand Hall", ownerName: "Fiona",
      holdDate: "Saturday 14 November 2026", decisionDate: "Monday 27 July 2026",
      daysUntilDecision: 7, rank: 1, jointFlag: false, diaryUrl: "https://venviewer.example/diary",
    });
    expect(visibleText(named.html)).toContain("Hi Fiona,");
    const unnamed = await holdDecisionReminder({
      holdTitle: "The Hartley wedding", spaceName: "Grand Hall", ownerName: "  ",
      holdDate: "Saturday 14 November 2026", decisionDate: "Monday 27 July 2026",
      daysUntilDecision: 7, rank: 1, jointFlag: false, diaryUrl: "https://venviewer.example/diary",
    });
    expect(visibleText(unnamed.html)).not.toContain("Hi ");
  });

  it("formats the house long date in the venue's zone, without a comma", () => {
    // 23:30 UTC on the 13th is already the 14th in London (BST).
    expect(formatVenueDay(new Date("2026-06-13T23:30:00.000Z"))).toBe("Sunday 14 June 2026");
  });
});
