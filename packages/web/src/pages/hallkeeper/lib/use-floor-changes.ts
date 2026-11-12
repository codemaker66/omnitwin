import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EventAwaitingAcknowledgement } from "@omnitwin/types";
import { acknowledgeEventPlanChange } from "../../../api/notifications.js";
import { getAwaitingAcknowledgement } from "../../../api/plan-changes.js";

// ---------------------------------------------------------------------------
// What changed since the floor last looked, for the board's events.
//
// The event change feed already holds every change that needs a hallkeeper's
// acknowledgement: an event edit (guests, hours, details), a phase moved, a
// booking moved in the Diary. The board reads, for its events, the ones
// nobody has acknowledged, and who last acknowledged anything. The floor
// acknowledges as one, as the event-day board does: once anyone has, the
// change is in hand for everyone.
//
// One read for all the board's events, again every minute while the board is
// in view, when it is shown again and when the device comes back online. A
// failed read keeps what the board last knew.
// ---------------------------------------------------------------------------

export const FLOOR_CHANGES_INTERVAL_MS = 60_000;

export interface FloorChangesApi {
  readonly status: "idle" | "loading" | "ready" | "failed";
  /** Each event's waiting changes and its last acknowledgement. */
  readonly byEvent: ReadonlyMap<string, EventAwaitingAcknowledgement>;
  /** Since when the reads have failed (device clock), or null while they land. */
  readonly failedSinceMs: number | null;
  /** Events whose acknowledgement is being sent. */
  readonly sending: ReadonlySet<string>;
  /** Why an acknowledgement could not be sent, by event. */
  readonly failures: ReadonlyMap<string, string>;
  /** Acknowledge, for the floor, the given changes waiting on the event
   *  (every one of them when none are named). */
  readonly acknowledge: (eventId: string, changeIds?: readonly string[]) => Promise<void>;
  /** Read again now: the day moved, or someone asked. */
  readonly refresh: () => void;
}

const NOTHING: ReadonlyMap<string, EventAwaitingAcknowledgement> = new Map();

function sameChanges(a: EventAwaitingAcknowledgement | undefined, b: EventAwaitingAcknowledgement | undefined): boolean {
  const left = (a?.changes ?? []).map((change) => change.id).join(",");
  const right = (b?.changes ?? []).map((change) => change.id).join(",");
  return left === right;
}

export function useFloorChanges(eventIds: readonly string[], enabled: boolean): FloorChangesApi {
  const key = useMemo(() => [...new Set(eventIds)].sort().join(","), [eventIds]);
  const [byEvent, setByEvent] = useState<ReadonlyMap<string, EventAwaitingAcknowledgement>>(NOTHING);
  const [status, setStatus] = useState<FloorChangesApi["status"]>("idle");
  const [failedSinceMs, setFailedSinceMs] = useState<number | null>(null);
  const [sending, setSending] = useState<ReadonlySet<string>>(new Set());
  const [failures, setFailures] = useState<ReadonlyMap<string, string>>(new Map());
  const generation = useRef(0);
  const keyRef = useRef(key);
  keyRef.current = key;
  const byEventRef = useRef(byEvent);
  byEventRef.current = byEvent;

  const read = useCallback(async (): Promise<void> => {
    const ids = keyRef.current === "" ? [] : keyRef.current.split(",");
    // A newer read always wins: whatever a read set out with before it is old.
    const mine = ++generation.current;
    if (ids.length === 0) {
      setByEvent(NOTHING);
      setStatus("ready");
      setFailedSinceMs(null);
      return;
    }
    setStatus((current) => (current === "ready" ? current : "loading"));
    try {
      const answer = await getAwaitingAcknowledgement(ids);
      if (mine !== generation.current) return;
      const next = new Map(answer.map((entry) => [entry.eventId, entry]));
      // A failure to send belongs to the changes it was about: once the
      // floor's waiting changes are different, it no longer says anything.
      const previous = byEventRef.current;
      setFailures((current) => {
        if (current.size === 0) return current;
        const kept = new Map([...current].filter(([eventId]) => sameChanges(previous.get(eventId), next.get(eventId))
          && (next.get(eventId)?.changes.length ?? 0) > 0));
        return kept.size === current.size ? current : kept;
      });
      setByEvent(next);
      setStatus("ready");
      setFailedSinceMs(null);
    } catch {
      if (mine !== generation.current) return;
      setStatus("failed");
      setFailedSinceMs((current) => current ?? Date.now());
    }
  }, []);

  const refresh = useCallback((): void => { void read(); }, [read]);

  useEffect(() => {
    if (!enabled) {
      generation.current += 1;
      setByEvent(NOTHING);
      setStatus("idle");
      setFailedSinceMs(null);
      return;
    }
    void read();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void read();
    }, FLOOR_CHANGES_INTERVAL_MS);
    const onVisible = (): void => { if (document.visibilityState === "visible") void read(); };
    const onOnline = (): void => { void read(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [enabled, key, read]);

  const acknowledge = useCallback(async (eventId: string, changeIds?: readonly string[]): Promise<void> => {
    const named = changeIds === undefined ? null : new Set(changeIds);
    const waiting = (byEventRef.current.get(eventId)?.changes ?? []).filter((change) => named === null || named.has(change.id));
    if (waiting.length === 0) return;
    const sent = new Set(waiting.map((change) => change.id));
    setSending((current) => new Set(current).add(eventId));
    setFailures((current) => {
      if (!current.has(eventId)) return current;
      const next = new Map(current);
      next.delete(eventId);
      return next;
    });
    try {
      // One at a time, oldest first, so a failure part-way leaves the rest
      // waiting rather than an unknown mix.
      for (const change of [...waiting].reverse()) {
        await acknowledgeEventPlanChange(eventId, { changeId: change.id });
      }
      setByEvent((current) => {
        const entry = current.get(eventId);
        if (entry === undefined) return current;
        const next = new Map(current);
        next.set(eventId, {
          ...entry,
          changes: entry.changes.filter((change) => !sent.has(change.id)),
          lastAcknowledgement: { at: new Date().toISOString(), by: "you", byUserId: null },
        });
        return next;
      });
      // Then the floor's own answer, which also outdates any read already
      // under way from before the acknowledgement.
      void read();
    } catch (err) {
      setFailures((current) => new Map(current).set(eventId,
        err instanceof Error && err.message.trim() !== "" ? err.message : "the server did not take it"));
    } finally {
      setSending((current) => {
        const next = new Set(current);
        next.delete(eventId);
        return next;
      });
    }
  }, [read]);

  return { status, byEvent, failedSinceMs, sending, failures, acknowledge, refresh };
}

/**
 * The changes that concern each slot, by booking. A change names its source:
 * a booking moved in the Diary concerns that booking's slot, a phase edited
 * concerns the slot that holds the phase, and an edit to the event itself
 * (its guests, hours or details) concerns every slot of the event. So a
 * wedding across three rooms shows its dinner's move only on the dinner.
 */
export function floorChangesBySlot(
  lanes: readonly { readonly slots: readonly { readonly bookingId: string; readonly eventId: string | null; readonly phases: readonly { readonly id: string }[] }[] }[],
  byEvent: ReadonlyMap<string, EventAwaitingAcknowledgement>,
): ReadonlyMap<string, readonly EventAwaitingAcknowledgement["changes"][number][]> {
  const slots = lanes.flatMap((lane) => lane.slots);
  const owners = new Map<string, Set<string>>();
  for (const slot of slots) {
    if (slot.eventId === null) continue;
    const own = owners.get(slot.eventId) ?? new Set<string>();
    own.add(slot.bookingId);
    for (const phase of slot.phases) own.add(phase.id);
    owners.set(slot.eventId, own);
  }
  const result = new Map<string, EventAwaitingAcknowledgement["changes"][number][]>();
  for (const slot of slots) {
    if (slot.eventId === null) continue;
    const entry = byEvent.get(slot.eventId);
    if (entry === undefined) continue;
    const named = owners.get(slot.eventId) ?? new Set<string>();
    const mine = new Set([slot.bookingId, ...slot.phases.map((phase) => phase.id)]);
    result.set(slot.bookingId, entry.changes.filter((change) => mine.has(change.sourceId) || !named.has(change.sourceId)));
  }
  return result;
}
