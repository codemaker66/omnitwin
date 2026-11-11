import { useCallback, useEffect, useState } from "react";
import type { BuildingCheck, BuildingCheckKind, BuildingChecksDay } from "@omnitwin/types";
import { getBuildingChecks, markBuildingCheck, replaceBuildingChecks, unmarkBuildingCheck } from "../../../api/building-checks.js";

// ---------------------------------------------------------------------------
// The building's checks for the day the board shows (T-693).
//
// One read for the day: again every minute while the board is in view, when
// it is shown again and when the device comes back online, so a tick at one
// door reaches every screen within a minute. A failed read keeps what it last
// knew and says so. A tick answers with the check as it now stands; a
// refusal reads the day again and says why in words.
// ---------------------------------------------------------------------------

export const BUILDING_CHECKS_INTERVAL_MS = 60_000;

export interface BuildingChecksApi {
  readonly status: "idle" | "loading" | "ready" | "failed";
  readonly day: BuildingChecksDay | null;
  /** Checks with a tick, or a list with a change, on its way. */
  readonly busy: ReadonlySet<string>;
  readonly failure: string | null;
  readonly refresh: () => void;
  readonly tick: (check: BuildingCheck, done: boolean) => Promise<boolean>;
  readonly replace: (kind: BuildingCheckKind, items: readonly { readonly id?: string; readonly label: string }[]) => Promise<boolean>;
}

function reason(error: unknown): string {
  const words = error instanceof Error ? error.message.trim().replace(/[.\s]+$/u, "") : "";
  return words.length > 0 ? words : "the server refused it";
}

export function useBuildingChecks(venueId: string | null, day: string, enabled: boolean): BuildingChecksApi {
  const key = venueId === null || !enabled ? "" : `${venueId}|${day}`;
  const [held, setHeld] = useState<{ readonly key: string; readonly status: "loading" | "ready" | "failed"; readonly day: BuildingChecksDay | null } | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => { setAttempt((count) => count + 1); }, []);

  useEffect(() => {
    if (venueId === null || key === "") return;
    const reading = new AbortController();
    setHeld((current) => (current?.key === key ? current : { key, status: "loading", day: null }));
    getBuildingChecks(venueId, day, reading.signal)
      .then((read) => { if (!reading.signal.aborted) setHeld({ key, status: "ready", day: read }); })
      .catch(() => {
        if (reading.signal.aborted) return;
        setHeld((current) => (current?.key === key ? { ...current, status: "failed" } : { key, status: "failed", day: null }));
      });
    return () => { reading.abort(); };
  }, [venueId, key, day, attempt]);

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

  const settle = useCallback((forKey: string, kind: BuildingCheckKind, next: (list: readonly BuildingCheck[]) => readonly BuildingCheck[]) => {
    setHeld((current) => {
      if (current?.key !== forKey || current.day === null) return current;
      return { ...current, day: { ...current.day, [kind]: [...next(current.day[kind])] } };
    });
  }, []);

  const run = useCallback(async (id: string, action: () => Promise<void>): Promise<boolean> => {
    setBusy((current) => new Set([...current, id]));
    setFailure(null);
    try {
      await action();
      return true;
    } catch (error) {
      setFailure(`Couldn’t save that: ${reason(error)}.`);
      refresh();
      return false;
    } finally {
      setBusy((current) => new Set([...current].filter((item) => item !== id)));
    }
  }, [refresh]);

  const tick = useCallback((check: BuildingCheck, done: boolean) => run(check.id, async () => {
    if (venueId === null) return;
    const forKey = key;
    const now = done ? await markBuildingCheck(venueId, check.id, day) : await unmarkBuildingCheck(venueId, check.id, day);
    settle(forKey, check.kind, (list) => list.map((item) => (item.id === now.id ? now : item)));
  }), [run, venueId, key, day, settle]);

  const replace = useCallback((kind: BuildingCheckKind, items: readonly { readonly id?: string; readonly label: string }[]) => run(`list:${kind}`, async () => {
    if (venueId === null) return;
    const seen = held?.key === key && held.day !== null ? held.day[kind].filter((check) => !check.retired).map((check) => check.id) : [];
    await replaceBuildingChecks(venueId, kind, { expected: seen, items: items.map((item) => (item.id === undefined ? { label: item.label } : { id: item.id, label: item.label })) });
    refresh();
  }), [run, venueId, key, held, refresh]);

  const status = key === "" ? "idle" : held?.key === key ? held.status : "loading";
  return { status, day: key !== "" && held?.key === key ? held.day : null, busy, failure, refresh, tick, replace };
}
