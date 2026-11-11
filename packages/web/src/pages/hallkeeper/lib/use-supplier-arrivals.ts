import { useCallback, useEffect, useMemo, useState } from "react";
import type { CreateSupplierArrival, SupplierArrival, SupplierArrivalStep, UpdateSupplierArrival } from "@omnitwin/types";
import {
  createSupplierArrival,
  listSupplierArrivals,
  recordSupplierArrivalStep,
  removeSupplierArrival,
  updateSupplierArrival,
} from "../../../api/supplier-arrivals.js";

// ---------------------------------------------------------------------------
// The day's supplier arrivals, for the board (T-692).
//
// One read for the day shown: again every minute while the board is in view,
// when it is shown again and when the device comes back online, so a tap at
// one door reaches every screen within a minute. A failed read keeps what it
// last knew. The office's changes and the floor's taps answer with the
// arrival as it now stands, which replaces the board's copy at once; a
// refusal (someone else changed it first) reads the day again and says so.
// ---------------------------------------------------------------------------

export const SUPPLIER_ARRIVALS_INTERVAL_MS = 60_000;

export interface SupplierArrivalsApi {
  readonly status: "idle" | "loading" | "ready" | "failed";
  readonly arrivals: readonly SupplierArrival[];
  /** Each booking's arrivals, earliest first. */
  readonly byBooking: ReadonlyMap<string, readonly SupplierArrival[]>;
  /** Arrivals with a tap or change on its way. */
  readonly busy: ReadonlySet<string>;
  /** Why the last change or tap could not be made, or null. */
  readonly failure: string | null;
  readonly refresh: () => void;
  readonly step: (arrival: SupplierArrival, step: SupplierArrivalStep) => Promise<boolean>;
  readonly add: (body: CreateSupplierArrival) => Promise<boolean>;
  readonly change: (arrival: SupplierArrival, body: Omit<UpdateSupplierArrival, "expectedRevision">) => Promise<boolean>;
  readonly remove: (arrival: SupplierArrival) => Promise<boolean>;
}

const NONE: readonly SupplierArrival[] = [];

/** The server's words, without a closing full stop the sentence adds back. */
function reason(error: unknown): string {
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
  const [held, setHeld] = useState<{ readonly key: string; readonly status: "loading" | "ready" | "failed"; readonly arrivals: readonly SupplierArrival[] } | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => { setAttempt((count) => count + 1); }, []);

  useEffect(() => {
    if (venueId === null || key === "") return;
    const reading = new AbortController();
    setHeld((current) => (current?.key === key ? current : { key, status: "loading", arrivals: NONE }));
    listSupplierArrivals(venueId, range.fromMs, range.toMs, reading.signal)
      .then((arrivals) => { if (!reading.signal.aborted) setHeld({ key, status: "ready", arrivals: [...arrivals].sort(byStart) }); })
      .catch(() => {
        if (reading.signal.aborted) return;
        setHeld((current) => (current?.key === key ? { ...current, status: "failed" } : { key, status: "failed", arrivals: NONE }));
      });
    return () => { reading.abort(); };
  }, [venueId, key, range.fromMs, range.toMs, attempt]);

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

  /** Put an arrival as it now stands into the day it belongs to. */
  const settle = useCallback((forKey: string, arrival: SupplierArrival | null, removedId?: string) => {
    setHeld((current) => {
      if (current?.key !== forKey) return current;
      const others = current.arrivals.filter((item) => item.id !== (arrival?.id ?? removedId));
      return { ...current, arrivals: arrival === null ? others : [...others, arrival].sort(byStart) };
    });
  }, []);

  const run = useCallback(async (id: string, action: () => Promise<SupplierArrival | null>, removedId?: string): Promise<boolean> => {
    if (venueId === null) return false;
    const forKey = key;
    setBusy((current) => new Set([...current, id]));
    setFailure(null);
    try {
      settle(forKey, await action(), removedId);
      return true;
    } catch (error) {
      setFailure(`Couldn’t save that: ${reason(error)}.`);
      refresh();
      return false;
    } finally {
      setBusy((current) => new Set([...current].filter((item) => item !== id)));
    }
  }, [venueId, key, settle, refresh]);

  const step = useCallback((arrival: SupplierArrival, which: SupplierArrivalStep) =>
    run(arrival.id, () => recordSupplierArrivalStep(venueId ?? "", arrival.id, which)), [run, venueId]);
  const add = useCallback((body: CreateSupplierArrival) =>
    run("new", () => createSupplierArrival(venueId ?? "", body)), [run, venueId]);
  const change = useCallback((arrival: SupplierArrival, body: Omit<UpdateSupplierArrival, "expectedRevision">) =>
    run(arrival.id, () => updateSupplierArrival(venueId ?? "", arrival.id, { ...body, expectedRevision: arrival.revision })), [run, venueId]);
  const remove = useCallback((arrival: SupplierArrival) =>
    run(arrival.id, async () => { await removeSupplierArrival(venueId ?? "", arrival); return null; }, arrival.id), [run, venueId]);

  const arrivals = key !== "" && held?.key === key ? held.arrivals : NONE;
  const byBooking = useMemo(() => {
    const grouped = new Map<string, SupplierArrival[]>();
    for (const arrival of arrivals) grouped.set(arrival.bookingId, [...(grouped.get(arrival.bookingId) ?? []), arrival]);
    return grouped;
  }, [arrivals]);
  const status = key === "" ? "idle" : held?.key === key ? held.status : "loading";
  return { status, arrivals, byBooking, busy, failure, refresh, step, add, change, remove };
}
