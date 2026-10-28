import { useEffect, useMemo, useState } from "react";
import type { ReplyAlarm } from "@omnitwin/types";
import { getReplyAlarm } from "../../../api/enquiries.js";

// ---------------------------------------------------------------------------
// The reply-time alarm on the Enquiries desk (run-first item 3).
//
// Read once when the desk opens, again whenever `version` changes (a decision
// or a recorded reply made here), and again at the moment the API says the
// next waiting enquiry passes the threshold. Never on a timer of its own: the
// production database sleeps when nothing asks it anything, and a desk left
// open all day must not keep it awake.
// ---------------------------------------------------------------------------

/** Never wait longer than this for the next crossing: a stale alarm is worse
 *  than one more read. */
export const REPLY_ALARM_MAX_WAIT_MS = 6 * 3_600_000;
/** A crossing a moment away still waits a beat, so the read finds it past. */
const REPLY_ALARM_MIN_WAIT_MS = 1_000;

export interface ReplyAlarmState {
  /** The alarm as last read; null before the first read, when the reader
   *  records no replies, or when it could not be read (the desk then shows
   *  no alarm rather than a false all-clear). */
  readonly alarm: ReplyAlarm | null;
  /** When each flagged enquiry arrived, by id. */
  readonly overdueSince: ReadonlyMap<string, number>;
}

/** How long to wait before reading the alarm again for `nextDueAt`. */
export function waitForNextDue(nextDueAt: string | null, nowMs: number): number | null {
  if (nextDueAt === null) return null;
  const due = Date.parse(nextDueAt);
  if (!Number.isFinite(due)) return null;
  return Math.min(REPLY_ALARM_MAX_WAIT_MS, Math.max(REPLY_ALARM_MIN_WAIT_MS, due - nowMs + REPLY_ALARM_MIN_WAIT_MS));
}

export function useReplyAlarm(replyVenueId: string | null, version: number): ReplyAlarmState {
  const [alarm, setAlarm] = useState<ReplyAlarm | null>(null);
  const [crossings, setCrossings] = useState(0);

  useEffect(() => {
    if (replyVenueId === null) {
      setAlarm(null);
      return;
    }
    const controller = new AbortController();
    let timer: number | undefined;
    void getReplyAlarm(controller.signal)
      .then((read) => {
        if (controller.signal.aborted) return;
        setAlarm(read);
        const wait = waitForNextDue(read.nextDueAt, Date.now());
        if (wait !== null) timer = window.setTimeout(() => { setCrossings((count) => count + 1); }, wait);
      })
      .catch(() => {
        // The alarm is an aid, never a gate: the desk works without it.
        if (!controller.signal.aborted) setAlarm(null);
      });
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [replyVenueId, version, crossings]);

  const overdueSince = useMemo(() => new Map((alarm?.enquiries ?? [])
    .map((enquiry) => [enquiry.id, Date.parse(enquiry.arrivedAt)] as const)
    .filter(([, ms]) => Number.isFinite(ms))), [alarm]);

  return { alarm, overdueSince };
}
