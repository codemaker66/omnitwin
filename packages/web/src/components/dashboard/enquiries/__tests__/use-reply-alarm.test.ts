import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplyAlarm } from "@omnitwin/types";
import {
  REPLY_ALARM_FRESH_MS, REPLY_ALARM_MAX_WAIT_MS, REPLY_ALARM_RETRY_MS, useReplyAlarm, waitForNextRead,
} from "../use-reply-alarm.js";

const { getReplyAlarm } = vi.hoisted(() => ({ getReplyAlarm: vi.fn<(signal?: AbortSignal) => Promise<ReplyAlarm>>() }));
vi.mock("../../../../api/enquiries.js", () => ({ getReplyAlarm }));

const NOW = Date.parse("2026-09-24T14:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString();

function alarm(overrides: Partial<ReplyAlarm> = {}): ReplyAlarm {
  return { thresholdHours: 24, asOf: iso(Date.now()), overdue: 0, longest: null, enquiries: [], nextDueAt: null, ...overrides };
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); });
}

async function advance(ms: number): Promise<void> {
  await act(async () => { vi.advanceTimersByTime(ms); await Promise.resolve(); });
  await flush();
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
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
  it("waits for a beat after the next crossing on the server's clock, never longer than six hours", () => {
    const asOf = iso(NOW);
    expect(waitForNextRead({ asOf, nextDueAt: null })).toBe(REPLY_ALARM_MAX_WAIT_MS);
    expect(waitForNextRead({ asOf, nextDueAt: "garbled" })).toBe(REPLY_ALARM_MAX_WAIT_MS);
    expect(waitForNextRead({ asOf, nextDueAt: iso(NOW + 10 * MINUTE) })).toBe(10 * MINUTE + 1_000);
    expect(waitForNextRead({ asOf, nextDueAt: iso(NOW + 20 * HOUR) })).toBe(REPLY_ALARM_MAX_WAIT_MS);
    expect(waitForNextRead({ asOf, nextDueAt: iso(NOW - MINUTE) })).toBe(1_000);
  });

  it("is timed from the server's clock, so a browser clock a minute fast does not read every second", () => {
    vi.setSystemTime(NOW + MINUTE);
    expect(waitForNextRead({ asOf: iso(NOW), nextDueAt: iso(NOW + 30_000) })).toBe(31_000);
  });
});

describe("useReplyAlarm", () => {
  it("reads nothing for someone who records no replies", async () => {
    const { result } = renderHook(() => useReplyAlarm(null, 0));
    await flush();
    expect(getReplyAlarm).not.toHaveBeenCalled();
    expect(result.current.alarm).toBeNull();
  });

  it("reads once, then again when the next enquiry passes the mark, and at least every six hours", async () => {
    getReplyAlarm.mockResolvedValueOnce(alarm({ nextDueAt: iso(NOW + 10 * MINUTE) }))
      .mockResolvedValueOnce(alarm({ overdue: 1, enquiries: [{ id: "e-1", arrivedAt: iso(NOW - 24 * HOUR + 10 * MINUTE) }] }))
      .mockResolvedValue(alarm());
    const { result } = renderHook(() => useReplyAlarm("venue-1", 0));
    await flush();
    expect(getReplyAlarm).toHaveBeenCalledTimes(1);
    expect(result.current.alarm?.overdue).toBe(0);

    await advance(10 * MINUTE);
    expect(getReplyAlarm).toHaveBeenCalledTimes(1);
    await advance(1_000);
    expect(getReplyAlarm).toHaveBeenCalledTimes(2);
    expect(result.current.alarm?.overdue).toBe(1);
    expect(result.current.overdueSince.get("e-1")).toBe(NOW - 24 * HOUR + 10 * MINUTE);

    // Nothing else is due: the next read is the six-hour one, and only that.
    await advance(REPLY_ALARM_MAX_WAIT_MS - 1_000);
    expect(getReplyAlarm).toHaveBeenCalledTimes(2);
    await advance(1_000);
    expect(getReplyAlarm).toHaveBeenCalledTimes(3);
  });

  it("keeps the alarm last read when a read fails, and tries again after five minutes", async () => {
    getReplyAlarm.mockResolvedValueOnce(alarm({ overdue: 2 }))
      .mockRejectedValueOnce(new Error("Unavailable"))
      .mockResolvedValueOnce(alarm({ overdue: 1 }));
    const { result, rerender } = renderHook(({ version }: { version: number }) => useReplyAlarm("venue-1", version), { initialProps: { version: 0 } });
    await flush();
    expect(result.current.alarm?.overdue).toBe(2);
    rerender({ version: 1 });
    await flush();
    expect(getReplyAlarm).toHaveBeenCalledTimes(2);
    expect(result.current.alarm?.overdue).toBe(2);
    await advance(REPLY_ALARM_RETRY_MS);
    expect(getReplyAlarm).toHaveBeenCalledTimes(3);
    expect(result.current.alarm?.overdue).toBe(1);
  });

  it("reads again when the desk is looked at after a while, not when it was just read", async () => {
    getReplyAlarm.mockResolvedValue(alarm());
    renderHook(() => useReplyAlarm("venue-1", 0));
    await flush();
    setVisibility("hidden");
    setVisibility("visible");
    await flush();
    expect(getReplyAlarm).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW + REPLY_ALARM_FRESH_MS);
    setVisibility("hidden");
    setVisibility("visible");
    await flush();
    expect(getReplyAlarm).toHaveBeenCalledTimes(2);
  });

  it("stops waiting when the desk closes", async () => {
    getReplyAlarm.mockResolvedValue(alarm({ nextDueAt: iso(NOW + MINUTE) }));
    const { unmount } = renderHook(() => useReplyAlarm("venue-1", 0));
    await flush();
    unmount();
    await advance(10 * MINUTE);
    setVisibility("visible");
    expect(getReplyAlarm).toHaveBeenCalledTimes(1);
    expect(getReplyAlarm.mock.calls[0]?.[0]?.aborted).toBe(true);
  });
});
