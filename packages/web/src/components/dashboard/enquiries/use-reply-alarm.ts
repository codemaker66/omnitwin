import { useEffect, useMemo, useRef, useState } from "react";
import type { ReplyAlarm } from "@omnitwin/types";
import { getReplyAlarm } from "../../../api/enquiries.js";

// ---------------------------------------------------------------------------
// The reply-time alarm on the Enquiries desk (run-first item 3).
//
// Read when the desk opens, again whenever `version` changes (a decision, a
// recorded reply or a reload made here), at the moment the API says the next
// waiting enquiry passes the threshold, when the desk is looked at again after
// a while (a colleague may have replied from another desk), and at least every
// six hours. Never on a short timer: the production database sleeps when
// nothing asks it anything, and a desk left open all day must not keep it
// awake. The next read is timed from the server's clock, never the browser's,
// so a clock that runs fast cannot turn the wait into a loop.
// ---------------------------------------------------------------------------

/** Never wait longer than this between reads: a stale alarm is worse than one
 *  more read. */
export const REPLY_ALARM_MAX_WAIT_MS = 6 * 3_600_000;
/** A read that failed is tried again after this; the alarm last read stays. */
export const REPLY_ALARM_RETRY_MS = 5 * 60_000;
/** Looking at the desk again reads the alarm only when it is older than this. */
export const REPLY_ALARM_FRESH_MS = 5 * 60_000;
/** A crossing a moment away still waits a beat, so the read finds it past. */
const REPLY_ALARM_MIN_WAIT_MS = 1_000;

export interface ReplyAlarmState {
  /** The alarm as last read; null before the first read lands, for someone
   *  who records no replies, or when no read has succeeded yet. A failed
   *  re-read keeps the alarm last read. */
  readonly alarm: ReplyAlarm | null;
  /** When each flagged enquiry arrived, by id. */
  readonly overdueSince: ReadonlyMap<string, number>;
}

/** How long to wait before reading the alarm again: until a beat after the
 *  next crossing, measured on the server's clock (`asOf`), and never longer
 *  than REPLY_ALARM_MAX_WAIT_MS. */
export function waitForNextRead(alarm: Pick<ReplyAlarm, "asOf" | "nextDueAt">): number {
  if (alarm.nextDueAt === null) return REPLY_ALARM_MAX_WAIT_MS;
  const due = Date.parse(alarm.nextDueAt);
  const asOf = Date.parse(alarm.asOf);
  if (!Number.isFinite(due) || !Number.isFinite(asOf)) return REPLY_ALARM_MAX_WAIT_MS;
  return Math.min(REPLY_ALARM_MAX_WAIT_MS, Math.max(REPLY_ALARM_MIN_WAIT_MS, due - asOf + REPLY_ALARM_MIN_WAIT_MS));
}

export function useReplyAlarm(replyVenueId: string | null, version: number): ReplyAlarmState {
  const [alarm, setAlarm] = useState<ReplyAlarm | null>(null);
  // Each change asks for another read: a crossing, a retry, a return.
  const [wakes, setWakes] = useState(0);
  const lastReadMs = useRef<number | null>(null);

  useEffect(() => {
    if (replyVenueId === null) {
      setAlarm(null);
      return;
    }
    const controller = new AbortController();
    let timer: number | undefined;
    const wakeAfter = (ms: number): void => {
      timer = window.setTimeout(() => { setWakes((count) => count + 1); }, ms);
    };
    void getReplyAlarm(controller.signal)
      .then((read) => {
        if (controller.signal.aborted) return;
        lastReadMs.current = Date.now();
        setAlarm(read);
        wakeAfter(waitForNextRead(read));
      })
      .catch(() => {
        // The alarm is an aid, never a gate: the desk works without it, and
        // the alarm last read stays until a read succeeds.
        if (!controller.signal.aborted) wakeAfter(REPLY_ALARM_RETRY_MS);
      });
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [replyVenueId, version, wakes]);

  // Looking at the desk again after a while reads the alarm again.
  useEffect(() => {
    if (replyVenueId === null) return;
    const onVisible = (): void => {
      if (document.visibilityState !== "visible") return;
      const last = lastReadMs.current;
      if (last === null || Date.now() - last >= REPLY_ALARM_FRESH_MS) setWakes((count) => count + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => { document.removeEventListener("visibilitychange", onVisible); };
  }, [replyVenueId]);

  const overdueSince = useMemo(() => new Map((alarm?.enquiries ?? [])
    .map((enquiry) => [enquiry.id, Date.parse(enquiry.arrivedAt)] as const)
    .filter(([, ms]) => Number.isFinite(ms))), [alarm]);

  return { alarm, overdueSince };
}
