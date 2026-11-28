import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import type { EventAwaitingAcknowledgement, FloorChange } from "@omnitwin/types";
import { ApiError } from "../../../api/client.js";
import { acknowledgeEventPlanChange } from "../../../api/notifications.js";
import { getAwaitingAcknowledgement, type BoardDayWindow } from "../../../api/plan-changes.js";

// ---------------------------------------------------------------------------
// What changed since the floor last looked, for the board's events.
//
// The event change feed already holds every change that needs a hallkeeper's
// acknowledgement: an event edit (guests, hours, details), a phase moved, a
// booking moved in the Diary. The board reads, for its events on its day, the
// ones nobody has acknowledged, and who last acknowledged one. The floor
// acknowledges as one, as the event-day board does: once anyone has, the
// change is in hand for everyone.
//
// One read for all the board's events, again every minute while the board is
// in view, when it is shown again and when the device comes back online. A
// failed read keeps what the board last knew.
//
// Got it is sent from one surface at a time (a slot, or the notice of a
// function that left the day), and what became of it is told there only. The
// surface keeps what it sent, and its working Got it, until the board has
// read the floor's own answer: a change replaced meanwhile is then replaced in
// place by the change that replaced it, so nothing the hallkeeper is on (the
// button, the line that speaks) is taken away under them.
// ---------------------------------------------------------------------------

export const FLOOR_CHANGES_INTERVAL_MS = 60_000;

/** Said where Got it was pressed when a change it named had been replaced by
 *  a newer one first (a booking moved again): the newer change is shown. */
export const CHANGED_AGAIN = "It changed again before your Got it went through. This is where it stands now.";

export interface FloorChangesApi {
  readonly status: "idle" | "loading" | "ready" | "failed";
  /** Each event's waiting changes and its last acknowledgement. */
  readonly byEvent: ReadonlyMap<string, EventAwaitingAcknowledgement>;
  /** Since when the reads have failed (device clock), or null while they land. */
  readonly failedSinceMs: number | null;
  /** The surfaces whose Got it is being sent: a slot's booking id, or a notice's key. */
  readonly sending: ReadonlySet<string>;
  /** What the last Got it on a surface came to, when that needs saying. */
  readonly notes: ReadonlyMap<string, string>;
  /** Acknowledge, for the floor, the named changes waiting on the event, from
   *  one surface. */
  readonly acknowledge: (surface: string, eventId: string, changeIds: readonly string[]) => Promise<void>;
  /** Read again now: the day moved, or someone asked. */
  readonly refresh: () => void;
}

interface Note {
  readonly text: string;
  readonly eventId: string;
  /** The changes it speaks of: a failure, those it could not send; a change
   *  replaced, the change that replaced it. It says nothing once any of them
   *  no longer waits. */
  readonly about: readonly string[];
}

/** What a read came to: the answer it put on the board, a failure, or
 *  nothing (the board stopped reading meanwhile). */
type ReadOutcome =
  | { readonly kind: "read"; readonly answer: ReadonlyMap<string, EventAwaitingAcknowledgement> }
  | { readonly kind: "failed" }
  | { readonly kind: "stopped" };

const NOTHING: ReadonlyMap<string, EventAwaitingAcknowledgement> = new Map();

/** The 409's details: the newer change waiting in the replaced one's place,
 *  or null when none does (the move was taken back, or the newer one is in
 *  hand already). */
const ReplacedDetailsSchema = z.object({ supersededBy: z.string().nullable() });

/** Whether a refused Got it means the change is out of the floor's hands
 *  already, and the next change can be sent; for a change replaced, by what. */
function settledElsewhere(error: unknown): { readonly replacedBy: string | null } | null {
  if (!(error instanceof ApiError)) return null;
  if (error.status === 409 && error.code === "CHANGE_SUPERSEDED") {
    const details = ReplacedDetailsSchema.safeParse(error.details);
    return { replacedBy: details.success ? details.data.supersededBy : null };
  }
  if ((error.status === 422 && error.code === "ACKNOWLEDGEMENT_NOT_REQUIRED") || error.status === 404) return { replacedBy: null };
  return null;
}

export function useFloorChanges(eventIds: readonly string[], enabled: boolean, day: BoardDayWindow | null): FloorChangesApi {
  const key = useMemo(() => [...new Set(eventIds)].sort().join(","), [eventIds]);
  const dayKey = day === null ? "" : `${String(day.fromMs)}-${String(day.toMs)}`;
  const [byEvent, setByEvent] = useState<ReadonlyMap<string, EventAwaitingAcknowledgement>>(NOTHING);
  const [status, setStatus] = useState<FloorChangesApi["status"]>("idle");
  const [failedSinceMs, setFailedSinceMs] = useState<number | null>(null);
  const [sending, setSending] = useState<ReadonlySet<string>>(new Set());
  const [kept, setKept] = useState<ReadonlyMap<string, Note>>(new Map());
  const generation = useRef(0);
  const latestRead = useRef<{ readonly generation: number; readonly outcome: Promise<ReadOutcome> } | null>(null);
  const keyRef = useRef(key);
  keyRef.current = key;
  const dayRef = useRef(day);
  dayRef.current = day;
  const byEventRef = useRef(byEvent);
  byEventRef.current = byEvent;

  const read = useCallback((): Promise<ReadOutcome> => {
    const ids = keyRef.current === "" ? [] : keyRef.current.split(",");
    const boardDay = dayRef.current;
    // A newer read always wins: whatever a read set out with before it is
    // old, and a read overtaken answers with the read that overtook it.
    const mine = ++generation.current;
    const overtaken = (): Promise<ReadOutcome> => {
      const newer = latestRead.current;
      return newer !== null && newer.generation > mine ? newer.outcome : Promise.resolve({ kind: "stopped" });
    };
    const outcome = (async (): Promise<ReadOutcome> => {
      if (ids.length === 0) {
        setByEvent(NOTHING);
        setStatus("ready");
        setFailedSinceMs(null);
        return { kind: "read", answer: NOTHING };
      }
      setStatus((current) => (current === "ready" ? current : "loading"));
      let answer: readonly EventAwaitingAcknowledgement[];
      try {
        answer = await getAwaitingAcknowledgement(ids, boardDay === null ? null : { fromMs: boardDay.fromMs, toMs: boardDay.toMs });
      } catch {
        if (mine !== generation.current) return overtaken();
        setStatus("failed");
        setFailedSinceMs((current) => current ?? Date.now());
        return { kind: "failed" };
      }
      if (mine !== generation.current) return overtaken();
      const next = new Map(answer.map((entry) => [entry.eventId, entry]));
      // A note belongs to the changes it speaks of: once any of them is no
      // longer waiting, it says nothing.
      setKept((current) => {
        if (current.size === 0) return current;
        const still = new Map([...current].filter(([, note]) => {
          const waiting = new Set((next.get(note.eventId)?.changes ?? []).map((change) => change.id));
          return note.about.every((id) => waiting.has(id));
        }));
        return still.size === current.size ? current : still;
      });
      setByEvent(next);
      setStatus("ready");
      setFailedSinceMs(null);
      return { kind: "read", answer: next };
    })();
    latestRead.current = { generation: mine, outcome };
    return outcome;
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
  }, [enabled, key, dayKey, read]);

  const acknowledge = useCallback(async (surface: string, eventId: string, changeIds: readonly string[]): Promise<void> => {
    const named = new Set(changeIds);
    const waiting = (byEventRef.current.get(eventId)?.changes ?? []).filter((change) => named.has(change.id));
    if (waiting.length === 0) return;
    setSending((current) => new Set(current).add(surface));
    setKept((current) => {
      if (!current.has(surface)) return current;
      const next = new Map(current);
      next.delete(surface);
      return next;
    });
    const acknowledged = new Set<string>();
    const settled = new Set<string>();
    const replacedBy = new Set<string>();
    let failure: string | null = null;
    // One at a time, oldest first, so a failure part-way leaves the rest
    // waiting rather than an unknown mix.
    for (const change of [...waiting].reverse()) {
      try {
        await acknowledgeEventPlanChange(eventId, { changeId: change.id });
        acknowledged.add(change.id);
      } catch (err) {
        const elsewhere = settledElsewhere(err);
        if (elsewhere === null) {
          failure = err instanceof Error && err.message.trim() !== "" ? err.message : "the server did not take it";
          break;
        }
        // Replaced by a newer change, no longer needing it, or gone: settled
        // for this change, and the floor's answer below shows what stands now.
        settled.add(change.id);
        if (elsewhere.replacedBy !== null) replacedBy.add(elsewhere.replacedBy);
      }
    }
    // Then the floor's own answer, whatever came of it, which also outdates
    // any read already under way from before. Until it lands the surface keeps
    // what it sent, and its Got it works on.
    const heard = await read();
    const unsent = waiting.map((change) => change.id).filter((id) => !acknowledged.has(id) && !settled.has(id));
    let note: Note | null = null;
    if (heard.kind === "read") {
      const waitingNow = new Set((heard.answer.get(eventId)?.changes ?? []).map((change) => change.id));
      const stillUnsent = unsent.filter((id) => waitingNow.has(id));
      const newer = [...replacedBy].filter((id) => waitingNow.has(id));
      if (failure !== null) {
        if (stillUnsent.length > 0) note = { text: `Couldn’t send that: ${failure}. Try again.`, eventId, about: stillUnsent };
      } else if (newer.length > 0) {
        note = { text: CHANGED_AGAIN, eventId, about: newer };
      }
    } else {
      // Not heard back: what the floor's answers settled leaves the board,
      // the rest stands as last read, and a change that replaced another is
      // not claimed, as the board cannot show it.
      const done = new Set([...acknowledged, ...settled]);
      if (done.size > 0) {
        setByEvent((current) => {
          const entry = current.get(eventId);
          if (entry === undefined) return current;
          const next = new Map(current);
          next.set(eventId, {
            ...entry,
            changes: entry.changes.filter((change) => !done.has(change.id)),
            lastAcknowledgement: acknowledged.size > 0 ? { at: new Date().toISOString(), by: "you", byUserId: null } : entry.lastAcknowledgement,
          });
          return next;
        });
      }
      if (failure !== null && unsent.length > 0) note = { text: `Couldn’t send that: ${failure}. Try again.`, eventId, about: unsent };
    }
    const said = note;
    if (said !== null) setKept((current) => new Map(current).set(surface, said));
    setSending((current) => {
      const next = new Set(current);
      next.delete(surface);
      return next;
    });
  }, [read]);

  const notes = useMemo(() => new Map([...kept].map(([surface, note]) => [surface, note.text] as const)), [kept]);
  return { status, byEvent, failedSinceMs, sending, notes, acknowledge, refresh };
}

type Lanes = readonly {
  readonly slots: readonly {
    readonly bookingId: string;
    readonly eventId: string | null;
    readonly title: string;
    readonly phases: readonly { readonly id: string }[];
  }[];
}[];

/** What a day's board has shown while it has been open: each event with the
 *  title it was seen under, and the bookings and phases seen on the day. */
export interface SeenOnDay {
  readonly events: ReadonlyMap<string, string>;
  readonly sources: ReadonlySet<string>;
}

/** The day's memory with the lanes shown now added to it. */
export function seenWith(seen: SeenOnDay | undefined, lanes: Lanes): SeenOnDay {
  const events = new Map(seen?.events ?? []);
  const sources = new Set(seen?.sources ?? []);
  for (const slot of lanes.flatMap((lane) => lane.slots)) {
    if (slot.eventId === null) continue;
    if (!events.has(slot.eventId)) events.set(slot.eventId, slot.title);
    sources.add(slot.bookingId);
    for (const phase of slot.phases) sources.add(phase.id);
  }
  return { events, sources };
}

/**
 * Whether a change has no place of its own on the board, so it concerns every
 * slot of its event: as the server says (eventWide: an edit to the event, a
 * booking still an enquiry, a phase no slot holds); in an answer from before
 * the server said, an edit to the event itself, as the board read one then.
 */
function hasNoPlace(eventId: string, change: FloorChange): boolean {
  return change.eventWide ?? change.sourceId === eventId;
}

/**
 * The event's waiting changes that concern this day: those with no place of
 * their own, and a change to a booking or phase seen on the day. A change to a
 * booking or phase of the same event on another day is that day's to show.
 */
export function changesForDay(eventId: string, entry: EventAwaitingAcknowledgement | undefined, seen: SeenOnDay): readonly FloorChange[] {
  return (entry?.changes ?? []).filter((change) => hasNoPlace(eventId, change) || seen.sources.has(change.sourceId));
}

/** Whether a Diary move put its booking wholly outside the day shown. */
export function movedOffDay(change: FloorChange, day: { readonly fromMs: number; readonly toMs: number }): boolean {
  return change.movedTo !== null
    && (Date.parse(change.movedTo.endsAt) <= day.fromMs || Date.parse(change.movedTo.startsAt) >= day.toMs);
}

/**
 * The changes that concern each slot, by booking. A change names its source:
 * a booking moved in the Diary concerns that booking's slot, a phase edited
 * concerns the slot that holds the phase, and a change with no place of its
 * own (an edit to the event itself, its guests, hours or details; a booking
 * still an enquiry; a phase no slot holds) concerns every slot of the event on
 * the day. So a wedding across three rooms shows its dinner's move only on
 * the dinner. A booking or phase seen on this day and no longer on it (moved
 * away, or gone) speaks on the event's slots that remain; one never seen on
 * this day is left to its own day's board.
 */
export function floorChangesBySlot(
  lanes: Lanes,
  byEvent: ReadonlyMap<string, EventAwaitingAcknowledgement>,
  seen: SeenOnDay,
): ReadonlyMap<string, readonly FloorChange[]> {
  const slots = lanes.flatMap((lane) => lane.slots);
  const owners = new Map<string, Set<string>>();
  for (const slot of slots) {
    if (slot.eventId === null) continue;
    const own = owners.get(slot.eventId) ?? new Set<string>();
    own.add(slot.bookingId);
    for (const phase of slot.phases) own.add(phase.id);
    owners.set(slot.eventId, own);
  }
  const result = new Map<string, FloorChange[]>();
  for (const slot of slots) {
    if (slot.eventId === null) continue;
    const eventId = slot.eventId;
    const entry = byEvent.get(eventId);
    if (entry === undefined) continue;
    const day = changesForDay(eventId, entry, seen);
    const named = owners.get(eventId) ?? new Set<string>();
    const mine = new Set([slot.bookingId, ...slot.phases.map((phase) => phase.id)]);
    result.set(slot.bookingId, day.filter((change) => hasNoPlace(eventId, change) || mine.has(change.sourceId) || !named.has(change.sourceId)));
  }
  return result;
}
