import { describe, it, expect, vi } from "vitest";
import {
  HOLD_REMINDER_STALE_WINDOW_MS,
  selectDueHoldReminders,
  runHoldReminderPassOnHolds,
  type ReminderHold,
} from "../../services/hold-reminders.js";
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

  it("holds with nothing due produce an empty, honest summary", async () => {
    const send = vi.fn();
    const quiet = hold({ decisionAt: new Date(NOW.getTime() + 30 * DAY_MS) });
    const summary = await runHoldReminderPassOnHolds([quiet], { db: DB, now: NOW, send });
    expect(send).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ scanned: 1, due: 0, sent: 0, failed: 0 });
    expect(summary.reminders).toHaveLength(0);
  });
});
