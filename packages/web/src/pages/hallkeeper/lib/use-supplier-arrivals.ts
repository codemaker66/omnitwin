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
// add form), for the day it was made on.
// ---------------------------------------------------------------------------

export const SUPPLIER_ARRIVALS_INTERVAL_MS = 60_000;

/** What became of a change: made; refused, as someone changed it first; or not made. */
export type ArrivalOutcome = "saved" | "stale" | "failed";

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
  readonly add: (body: CreateSupplierArrival) => Promise<ArrivalOutcome>;
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
    goneId?: string,
  ): Promise<ArrivalOutcome> => {
    if (venueId === null) return "failed";
    const forKey = key;
    const note = (words: string | null): void => {
      setFailures((current) => {
        const byId = new Map(current.key === forKey ? current.byId : NO_FAILURES);
        if (words === null) byId.delete(id);
        else byId.set(id, words);
        return { key: forKey, byId };
      });
    };
    setBusy((current) => new Set([...current, id]));
    note(null);
    try {
      const now = await action();
      landed.current += 1;
      settle(forKey, now, goneId);
      return "saved";
    } catch (error) {
      note(`Couldn’t ${verb}: ${reason(error)}.`);
      refresh();
      return error instanceof ApiError && error.status === 409 ? "stale" : "failed";
    } finally {
      setBusy((current) => new Set([...current].filter((item) => item !== id)));
    }
  }, [venueId, key, settle, refresh]);

  const place = venueId ?? "";
  const step = useCallback((arrival: SupplierArrival, which: SupplierArrivalStep) =>
    run(arrival.id, "mark that", () => recordSupplierArrivalStep(place, arrival.id, which)), [run, place]);
  const undo = useCallback((arrival: SupplierArrival, which: SupplierArrivalStep) =>
    run(arrival.id, "take that back", () => undoSupplierArrivalStep(place, arrival.id, which)), [run, place]);
  const add = useCallback((body: CreateSupplierArrival) =>
    run(newArrivalKey(body.bookingId), "add that", () => createSupplierArrival(place, body)), [run, place]);
  const change = useCallback((arrival: SupplierArrival, openedRevision: number, body: Omit<UpdateSupplierArrival, "expectedRevision">) =>
    run(arrival.id, "save that", () => updateSupplierArrival(place, arrival.id, { ...body, expectedRevision: openedRevision })), [run, place]);
  const remove = useCallback((arrival: SupplierArrival) =>
    run(arrival.id, "remove that", async () => { await removeSupplierArrival(place, arrival); return null; }, arrival.id), [run, place]);

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
