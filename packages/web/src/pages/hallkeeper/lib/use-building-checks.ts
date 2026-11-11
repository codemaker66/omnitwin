import { useCallback, useEffect, useRef, useState } from "react";
import type { BuildingCheck, BuildingCheckKind, BuildingChecksDay } from "@omnitwin/types";
import { ApiError } from "../../../api/client.js";
import { getBuildingChecks, markBuildingCheck, replaceBuildingChecks, unmarkBuildingCheck } from "../../../api/building-checks.js";

// ---------------------------------------------------------------------------
// The building's checks for one board day (T-693).
//
// One read for the day: again every minute while the board is in view, when
// it is shown again and when the device comes back online, so a tick at one
// door reaches every screen within a minute. A failed read keeps what it last
// knew and says so. A tick answers with the check as it now stands; a read
// that set out before a tick landed is read again rather than painted, so it
// never unticks the box. A list is saved from the list its editor opened on,
// so a colleague's newer list is refused ("stale"), never overwritten. Why a
// change failed is kept against its check (or its list), for that day only.
// ---------------------------------------------------------------------------

export const BUILDING_CHECKS_INTERVAL_MS = 60_000;

/** What became of a change: made; refused, as someone changed it first; or not made. */
export type CheckOutcome = "saved" | "stale" | "failed";

/** The key a list's save keeps its busy state and failure under. */
export function listKey(kind: BuildingCheckKind): string {
  return `list:${kind}`;
}

export interface BuildingChecksApi {
  readonly status: "idle" | "loading" | "ready" | "failed";
  /** A read of the day is on its way. */
  readonly reading: boolean;
  readonly day: BuildingChecksDay | null;
  /** Checks with a tick, and lists (by `listKey`) with a save, on its way. */
  readonly busy: ReadonlySet<string>;
  /** Why the last change to a check, or a list, could not be made, on this day. */
  readonly failures: ReadonlyMap<string, string>;
  readonly refresh: () => void;
  readonly tick: (check: BuildingCheck, done: boolean) => Promise<CheckOutcome>;
  /** A list as it should be, saved from the ids the editor opened on. */
  readonly replace: (
    kind: BuildingCheckKind,
    items: readonly { readonly id?: string; readonly label: string }[],
    expected: readonly string[],
  ) => Promise<CheckOutcome>;
}

const NO_FAILURES: ReadonlyMap<string, string> = new Map();

/** Why it failed, in the board's words, without a closing full stop the sentence adds back. */
function reason(error: unknown): string {
  if (error instanceof ApiError && error.code === "STALE_CHECKS") return "someone else changed this list meanwhile, so it now shows as it stands";
  const words = error instanceof Error ? error.message.trim().replace(/[.\s]+$/u, "") : "";
  return words.length > 0 ? words : "the server refused it";
}

export function useBuildingChecks(venueId: string | null, day: string, enabled: boolean): BuildingChecksApi {
  const key = venueId === null || !enabled || day === "" ? "" : `${venueId}|${day}`;
  const [held, setHeld] = useState<{
    readonly key: string;
    readonly status: "loading" | "ready" | "failed";
    readonly day: BuildingChecksDay | null;
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
    setHeld((current) => (current?.key === key ? { ...current, reading: true } : { key, status: "loading", day: null, reading: true }));
    getBuildingChecks(venueId, day, reading.signal)
      .then((read) => {
        if (reading.signal.aborted) return;
        if (landed.current !== landedBefore) { refresh(); return; }
        setHeld({ key, status: "ready", day: read, reading: false });
      })
      .catch(() => {
        if (reading.signal.aborted) return;
        setHeld((current) => (current?.key === key ? { ...current, status: "failed", reading: false } : { key, status: "failed", day: null, reading: false }));
      });
    return () => { reading.abort(); };
  }, [venueId, key, day, attempt, refresh]);

  useEffect(() => {
    if (key === "") return;
    const timer = window.setInterval(() => { if (document.visibilityState !== "hidden") refresh(); }, BUILDING_CHECKS_INTERVAL_MS);
    const onVisible = (): void => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
    };
  }, [key, refresh]);

  const settle = useCallback((forKey: string, check: BuildingCheck) => {
    setHeld((current) => {
      if (current?.key !== forKey || current.day === null) return current;
      const list = current.day[check.kind].map((item) => (item.id === check.id ? check : item));
      return { ...current, day: { ...current.day, [check.kind]: list } };
    });
  }, []);

  const run = useCallback(async (id: string, verb: string, action: (forKey: string) => Promise<void>): Promise<CheckOutcome> => {
    if (venueId === null || key === "") return "failed";
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
      await action(forKey);
      landed.current += 1;
      return "saved";
    } catch (error) {
      note(`Couldn’t ${verb}: ${reason(error)}.`);
      refresh();
      return error instanceof ApiError && error.status === 409 ? "stale" : "failed";
    } finally {
      setBusy((current) => new Set([...current].filter((item) => item !== id)));
    }
  }, [venueId, key, refresh]);

  const place = venueId ?? "";
  const tick = useCallback((check: BuildingCheck, done: boolean) => run(check.id, done ? "tick that" : "take that tick back", async (forKey) => {
    const now = done ? await markBuildingCheck(place, check.id, day) : await unmarkBuildingCheck(place, check.id, day);
    settle(forKey, now);
  }), [run, place, day, settle]);

  const replace = useCallback((
    kind: BuildingCheckKind,
    items: readonly { readonly id?: string; readonly label: string }[],
    expected: readonly string[],
  ) => run(listKey(kind), "save the list", async () => {
    await replaceBuildingChecks(place, kind, {
      expected: [...expected],
      items: items.map((item) => (item.id === undefined ? { label: item.label } : { id: item.id, label: item.label })),
    });
    refresh();
  }), [run, place, refresh]);

  const mine = key !== "" && held?.key === key ? held : null;
  return {
    status: key === "" ? "idle" : mine?.status ?? "loading",
    reading: mine?.reading ?? false,
    day: mine?.day ?? null,
    busy,
    failures: failures.key === key ? failures.byId : NO_FAILURES,
    refresh,
    tick,
    replace,
  };
}
