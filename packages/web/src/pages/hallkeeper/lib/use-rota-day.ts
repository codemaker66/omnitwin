import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rotaWeekStartOf, type RotaPerson, type RotaShift } from "@omnitwin/types";
import { getRotaWeek } from "../../../api/rota.js";

// ---------------------------------------------------------------------------
// The published rota for the day the board shows: the week holding it, or
// both weeks when the day's late hours run into a Monday. Read when the day
// changes and again as the board refreshes, at most every five minutes, since
// a rota changes far less often than a room. A failed read keeps what it last
// knew. Only the whole floor's rota counts: someone who may read only their
// own shifts would see a crew of one, so they see no crew at all.
// ---------------------------------------------------------------------------

export interface RotaDay {
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly shifts: readonly RotaShift[];
  readonly people: readonly RotaPerson[];
  /** Read again, unless it was read in the last five minutes. */
  readonly refresh: () => void;
}

export const ROTA_REREAD_MS = 5 * 60_000;

const NOTHING: { readonly shifts: readonly RotaShift[]; readonly people: readonly RotaPerson[] } = { shifts: [], people: [] };

/** The Mondays of the weeks a board's day touches, on the venue's calendar. */
export function rotaWeeksFor(fromMs: number, toMs: number, timeZone: string): readonly string[] {
  return [...new Set([rotaWeekStartOf(fromMs, timeZone), rotaWeekStartOf(Math.max(fromMs, toMs - 1), timeZone)])];
}

interface Held {
  readonly key: string;
  readonly status: "loading" | "ready" | "error";
  readonly shifts: readonly RotaShift[];
  readonly people: readonly RotaPerson[];
}

export function useRotaDay(
  venueId: string | null,
  range: { readonly fromMs: number; readonly toMs: number },
  timeZone: string,
  enabled: boolean,
): RotaDay {
  const weeks = useMemo(() => rotaWeeksFor(range.fromMs, range.toMs, timeZone).join(","), [range.fromMs, range.toMs, timeZone]);
  const key = venueId === null || !enabled ? "" : `${venueId}|${weeks}`;
  const [held, setHeld] = useState<Held | null>(null);
  const [attempt, setAttempt] = useState(0);
  const readAtMs = useRef<number | null>(null);

  const refresh = useCallback(() => {
    if (readAtMs.current !== null && Date.now() - readAtMs.current < ROTA_REREAD_MS) return;
    setAttempt((count) => count + 1);
  }, []);

  useEffect(() => {
    if (venueId === null || key === "") return;
    const reading = new AbortController();
    readAtMs.current = Date.now();
    setHeld((current) => (current?.key === key ? current : { key, status: "loading", ...NOTHING }));
    Promise.all(weeks.split(",").map((start) => getRotaWeek(venueId, start, reading.signal)))
      .then((read) => {
        if (reading.signal.aborted) return;
        if (read.some((week) => week.access === "own")) {
          setHeld({ key, status: "ready", ...NOTHING });
          return;
        }
        const shifts = new Map<string, RotaShift>();
        const people = new Map<string, RotaPerson>();
        for (const week of read) {
          for (const shift of week.shifts) shifts.set(shift.id, shift);
          for (const person of week.people) people.set(person.id, person);
        }
        setHeld({ key, status: "ready", shifts: [...shifts.values()], people: [...people.values()] });
      })
      .catch(() => {
        if (reading.signal.aborted) return;
        // A failure is read again at the next refresh, not five minutes on.
        readAtMs.current = null;
        setHeld((current) => (current?.key === key ? { ...current, status: "error" } : { key, status: "error", ...NOTHING }));
      });
    return () => { reading.abort(); };
  }, [venueId, key, weeks, attempt]);

  if (key === "") return { status: "idle", ...NOTHING, refresh };
  if (held?.key !== key) return { status: "loading", ...NOTHING, refresh };
  return { status: held.status, shifts: held.shifts, people: held.people, refresh };
}
