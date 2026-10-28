import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplyAlarm } from "@omnitwin/types";
import { REPLY_ALARM_MAX_WAIT_MS, useReplyAlarm, waitForNextDue } from "../use-reply-alarm.js";

const { getReplyAlarm } = vi.hoisted(() => ({ getReplyAlarm: vi.fn<(signal?: AbortSignal) => Promise<ReplyAlarm>>() }));
vi.mock("../../../../api/enquiries.js", () => ({ getReplyAlarm }));

const NOW = Date.parse("2026-09-24T14:00:00.000Z");
const MINUTE = 60_000;

function alarm(overrides: Partial<ReplyAlarm> = {}): ReplyAlarm {
  return { thresholdHours: 24, overdue: 0, enquiries: [], nextDueAt: null, ...overrides };
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(NOW);
  getReplyAlarm.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("when the alarm is read again", () => {
  it("waits for the next crossing, a beat after it, never longer than six hours", () => {
    expect(waitForNextDue(null, NOW)).toBeNull();
    expect(waitForNextDue("garbled", NOW)).toBeNull();
    expect(waitForNextDue(new Date(NOW + 10 * MINUTE).toISOString(), NOW)).toBe(10 * MINUTE + 1_000);
    expect(waitForNextDue(new Date(NOW - MINUTE).toISOString(), NOW)).toBe(1_000);
    expect(waitForNextDue(new Date(NOW + 20 * 3_600_000).toISOString(), NOW)).toBe(REPLY_ALARM_MAX_WAIT_MS);
  });
});

describe("useReplyAlarm", () => {
  it("reads nothing for someone who records no replies", async () => {
    const { result } = renderHook(() => useReplyAlarm(null, 0));
    await flush();
    expect(getReplyAlarm).not.toHaveBeenCalled();
    expect(result.current.alarm).toBeNull();
  });

  it("reads once, then again only when the next enquiry passes the mark", async () => {
    getReplyAlarm.mockResolvedValueOnce(alarm({ nextDueAt: new Date(NOW + 10 * MINUTE).toISOString() }))
      .mockResolvedValueOnce(alarm({ overdue: 1, enquiries: [{ id: "e-1", arrivedAt: new Date(NOW - 24 * 3_600_000 + 10 * MINUTE).toISOString() }] }));
    const { result } = renderHook(() => useReplyAlarm("venue-1", 0));
    await flush();
    expect(getReplyAlarm).toHaveBeenCalledTimes(1);
    expect(result.current.alarm?.overdue).toBe(0);

    await act(async () => { vi.advanceTimersByTime(10 * MINUTE); await Promise.resolve(); });
    expect(getReplyAlarm).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(1_000); await Promise.resolve(); });
    await flush();
    expect(getReplyAlarm).toHaveBeenCalledTimes(2);
    expect(result.current.alarm?.overdue).toBe(1);
    expect(result.current.overdueSince.get("e-1")).toBe(NOW - 24 * 3_600_000 + 10 * MINUTE);

    // Nothing else is waiting: no timer, so no further reads all day.
    await act(async () => { vi.advanceTimersByTime(24 * 3_600_000); await Promise.resolve(); });
    expect(getReplyAlarm).toHaveBeenCalledTimes(2);
  });

  it("reads again when the desk changes something, and shows no alarm when it cannot be read", async () => {
    getReplyAlarm.mockResolvedValueOnce(alarm({ overdue: 2 })).mockRejectedValueOnce(new Error("Unavailable"));
    const { result, rerender } = renderHook(({ version }: { version: number }) => useReplyAlarm("venue-1", version), { initialProps: { version: 0 } });
    await flush();
    expect(result.current.alarm?.overdue).toBe(2);
    rerender({ version: 1 });
    await flush();
    expect(getReplyAlarm).toHaveBeenCalledTimes(2);
    expect(result.current.alarm).toBeNull();
  });

  it("stops waiting when the desk closes", async () => {
    getReplyAlarm.mockResolvedValue(alarm({ nextDueAt: new Date(NOW + MINUTE).toISOString() }));
    const { unmount } = renderHook(() => useReplyAlarm("venue-1", 0));
    await flush();
    unmount();
    await act(async () => { vi.advanceTimersByTime(10 * MINUTE); await Promise.resolve(); });
    expect(getReplyAlarm).toHaveBeenCalledTimes(1);
    expect(getReplyAlarm.mock.calls[0]?.[0]?.aborted).toBe(true);
  });
});
