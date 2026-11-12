import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CreateSupplierArrival, SupplierArrival, SupplierArrivalStep, UpdateSupplierArrival } from "@omnitwin/types";
import { ApiError } from "../../../api/client.js";
import {
  createSupplierArrival,
  listSupplierArrivals,
  recordSupplierArrivalStep,
  removeSupplierArrival,
  undoSupplierArrivalStep,
  updateSupplierArrival,
} from "../../../api/supplier-arrivals.js";

// ---------------------------------------------------------------------------
// The day's supplier arrivals, for the board (T-692).
//
// One read for the day shown: again every minute while the board is in view,
// when it is shown again and when the device comes back online, so a tap at
// one door reaches every screen within a minute. A failed read keeps what it
// last knew. The office's changes and the floor's taps answer with the
// arrival as it now stands, which replaces the board's copy at once (or takes
// it off a day it has moved off); a read that set out before a change landed
// is read again rather than painted, so it never puts the change back. A
// change made from an old copy is refused ("stale") and the day is read
// again. Why a change failed is kept against its arrival (or the booking's
// add form), for the day it was made on; when the arrival itself has left the
// board meanwhile (removed by a colleague), why is kept against its booking,
// so it is still there to read once the arrival has gone.
// ---------------------------------------------------------------------------

export const SUPPLIER_ARRIVALS_INTERVAL_MS = 60_000;

/** What became of a change: made; refused, as someone changed it first; the
 *  arrival is no longer on the board (said against its booking); or not made. */
export type ArrivalOutcome = "saved" | "stale" | "gone" | "failed";

/** The key a booking's add form keeps its busy state and failure under. */
export function newArrivalKey(bookingId: string): string {
  return `new:${bookingId}`;
}

export interface SupplierArrivalsApi {
  readonly status: "idle" | "loading" | "ready" | "failed";
  /** A read of the day is on its way. */
  readonly reading: boolean;
  readonly arrivals: readonly SupplierArrival[];
  /** Each booking's arrivals, earliest first. */
  readonly byBooking: ReadonlyMap<string, readonly SupplierArrival[]>;
  /** Arrivals (and add forms, by `newArrivalKey`) with a tap or change on its way. */
  readonly busy: ReadonlySet<string>;
  /** Why the last change to an arrival (or add form) could not be made, on this day. */
  readonly failures: ReadonlyMap<string, string>;
  readonly refresh: () => void;
  readonly step: (arrival: SupplierArrival, step: SupplierArrivalStep) => Promise<ArrivalOutcome>;
  readonly undo: (arrival: SupplierArrival, step: SupplierArrivalStep) => Promise<ArrivalOutcome>;
  /** An add, with the key that names it: the same key on a second Save never adds twice. */
  readonly add: (body: CreateSupplierArrival, idempotencyKey: string) => Promise<ArrivalOutcome>;
  /** A change, from the revision the form was opened on. */
  readonly change: (arrival: SupplierArrival, openedRevision: number, body: Omit<UpdateSupplierArrival, "expectedRevision">) => Promise<ArrivalOutcome>;
  readonly remove: (arrival: SupplierArrival) => Promise<ArrivalOutcome>;
}

const NONE: readonly SupplierArrival[] = [];
const NO_FAILURES: ReadonlyMap<string, string> = new Map();

/** Why it failed, in the board's words, without a closing full stop the sentence adds back. */
function reason(error: unknown): string {
  if (error instanceof ApiError && error.code === "STALE_ARRIVAL") return "someone else changed it meanwhile, so it now shows as it stands";
  const words = error instanceof Error ? error.message.trim().replace(/[.\s]+$/u, "") : "";
  return words.length > 0 ? words : "the server refused it";
}

/** The server no longer has the arrival on this venue's board: removed, or its booking gone. */
function isGone(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && error.code === "ARRIVAL_NOT_FOUND";
}

/** What a change is about: said against its booking if the arrival has gone. */
function aboutOf(arrival: SupplierArrival): { readonly bookingId: string; readonly name: string } {
  return { bookingId: arrival.bookingId, name: arrival.supplierName };
}

function byStart(a: SupplierArrival, b: SupplierArrival): number {
  return Date.parse(a.arrivesAt) - Date.parse(b.arrivesAt) || a.supplierName.localeCompare(b.supplierName);
}

export function useSupplierArrivals(
  venueId: string | null,
  range: { readonly fromMs: number; readonly toMs: number },
  enabled: boolean,
): SupplierArrivalsApi {
  const key = venueId === null || !enabled ? "" : `${venueId}|${String(range.fromMs)}|${String(range.toMs)}`;
  const [held, setHeld] = useState<{
    readonly key: string;
    readonly status: "loading" | "ready" | "failed";
    readonly arrivals: readonly SupplierArrival[];
    readonly reading: boolean;
  } | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [failures, setFailures] = useState<{ readonly key: string; readonly byId: ReadonlyMap<string, string> }>({ key: "", byId: NO_FAILURES });
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => { setAttempt((count) => count + 1); }, []);
  /** Counts the changes that have landed, so a read that set out before one is not painted. */
  const landed = useRef(0);

  useEffect(() => {
    if (venueId === null || key === "") return;
    const reading = new AbortController();
    const landedBefore = landed.current;
    setHeld((current) => (current?.key === key ? { ...current, reading: true } : { key, status: "loading", arrivals: NONE, reading: true }));
    listSupplierArrivals(venueId, range.fromMs, range.toMs, reading.signal)
      .then((arrivals) => {
        if (reading.signal.aborted) return;
        // A change landed while this read was out: it may predate the change.
        if (landed.current !== landedBefore) { refresh(); return; }
        setHeld({ key, status: "ready", arrivals: [...arrivals].sort(byStart), reading: false });
      })
      .catch(() => {
        if (reading.signal.aborted) return;
        setHeld((current) => (current?.key === key ? { ...current, status: "failed", reading: false } : { key, status: "failed", arrivals: NONE, reading: false }));
      });
    return () => { reading.abort(); };
  }, [venueId, key, range.fromMs, range.toMs, attempt, refresh]);

  // Every minute in view; at once when shown again or back online.
  useEffect(() => {
    if (key === "") return;
    const timer = window.setInterval(() => { if (document.visibilityState !== "hidden") refresh(); }, SUPPLIER_ARRIVALS_INTERVAL_MS);
    const onVisible = (): void => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
    };
  }, [key, refresh]);

  /** Put an arrival as it now stands into the day, or off the day if it is not due on it. */
  const settle = useCallback((forKey: string, arrival: SupplierArrival | null, goneId?: string) => {
    setHeld((current) => {
      if (current?.key !== forKey) return current;
      const others = current.arrivals.filter((item) => item.id !== (arrival?.id ?? goneId));
      const dueMs = arrival === null ? Number.NaN : Date.parse(arrival.arrivesAt);
      const onDay = arrival !== null && dueMs >= range.fromMs && dueMs < range.toMs;
      return { ...current, arrivals: onDay ? [...others, arrival].sort(byStart) : others };
    });
  }, [range.fromMs, range.toMs]);

  const run = useCallback(async (
    id: string,
    verb: string,
    action: () => Promise<SupplierArrival | null>,
    about: { readonly bookingId: string; readonly name: string } | null,
    goneId?: string,
  ): Promise<ArrivalOutcome> => {
    if (venueId === null) return "failed";
    const forKey = key;
    const note = (at: string, words: string | null): void => {
      setFailures((current) => {
        const byId = new Map(current.key === forKey ? current.byId : NO_FAILURES);
        if (words === null) byId.delete(at);
        else byId.set(at, words);
        return { key: forKey, byId };
      });
    };
    setBusy((current) => new Set([...current, id]));
    note(id, null);
    try {
      const now = await action();
      landed.current += 1;
      settle(forKey, now, goneId);
      return "saved";
    } catch (error) {
      refresh();
      // Gone from the board meanwhile: said against its booking, which stays.
      if (about !== null && isGone(error)) {
        note(newArrivalKey(about.bookingId), `Couldn’t ${verb}: ${about.name} is no longer on the board.`);
        return "gone";
      }
      note(id, `Couldn’t ${verb}: ${reason(error)}.`);
      return error instanceof ApiError && error.status === 409 ? "stale" : "failed";
    } finally {
      setBusy((current) => new Set([...current].filter((item) => item !== id)));
    }
  }, [venueId, key, settle, refresh]);

  const place = venueId ?? "";
  const step = useCallback((arrival: SupplierArrival, which: SupplierArrivalStep) =>
    run(arrival.id, "mark that", () => recordSupplierArrivalStep(place, arrival.id, which), aboutOf(arrival)), [run, place]);
  const undo = useCallback((arrival: SupplierArrival, which: SupplierArrivalStep) =>
    run(arrival.id, "take that back", () => undoSupplierArrivalStep(place, arrival.id, which), aboutOf(arrival)), [run, place]);
  const add = useCallback((body: CreateSupplierArrival, idempotencyKey: string) =>
    run(newArrivalKey(body.bookingId), "add that", () => createSupplierArrival(place, body, idempotencyKey), null), [run, place]);
  const change = useCallback((arrival: SupplierArrival, openedRevision: number, body: Omit<UpdateSupplierArrival, "expectedRevision">) =>
    run(arrival.id, "save that", () => updateSupplierArrival(place, arrival.id, { ...body, expectedRevision: openedRevision }), aboutOf(arrival)), [run, place]);
  const remove = useCallback((arrival: SupplierArrival) =>
    run(arrival.id, "remove that", async () => { await removeSupplierArrival(place, arrival); return null; }, aboutOf(arrival), arrival.id), [run, place]);

  const mine = key !== "" && held?.key === key ? held : null;
  const arrivals = mine?.arrivals ?? NONE;
  const byBooking = useMemo(() => {
    const grouped = new Map<string, SupplierArrival[]>();
    for (const arrival of arrivals) grouped.set(arrival.bookingId, [...(grouped.get(arrival.bookingId) ?? []), arrival]);
    return grouped;
  }, [arrivals]);
  return {
    status: key === "" ? "idle" : mine?.status ?? "loading",
    reading: mine?.reading ?? false,
    arrivals,
    byBooking,
    busy,
    failures: failures.key === key ? failures.byId : NO_FAILURES,
    refresh,
    step,
    undo,
    add,
    change,
    remove,
  };
}
