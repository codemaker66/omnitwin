import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rotaWeekStartOf, type RotaPerson, type RotaShift } from "@omnitwin/types";
import { getRotaFloorWeek } from "../../../api/rota.js";

// ---------------------------------------------------------------------------
// The published rota for the day the board shows: the week holding it, or
// both weeks when the day's late hours run into a Monday. It is the floor's
// view (`view=floor`): published shifts and the names on them, never the
// records, leave or warnings an administrator's rota carries. Read when the
// day changes, and again each time the board asks: as its clock ticks, at
// most every five minutes, since a rota changes far less often than a room;
// at once when someone presses Refresh. A failed read keeps what it last knew
// and says when that was. Only the whole floor's rota counts: someone who may
// read only their own shifts would see a crew of one, so they see none.
// ---------------------------------------------------------------------------

export interface RotaDay {
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly shifts: readonly RotaShift[];
  readonly people: readonly RotaPerson[];
  /** When what it holds was read; null before the first read lands. */
  readonly readAtMs: number | null;
  /** Read again, unless it was read in the last five minutes; `now` reads at once. */
  readonly refresh: (now?: boolean) => void;
}

export const ROTA_REREAD_MS = 5 * 60_000;

const NOTHING: { readonly shifts: readonly RotaShift[]; readonly people: readonly RotaPerson[]; readonly readAtMs: null } = { shifts: [], people: [], readAtMs: null };

/** The Mondays of the weeks a board's day touches, on the venue's calendar. */
export function rotaWeeksFor(fromMs: number, toMs: number, timeZone: string): readonly string[] {
  return [...new Set([rotaWeekStartOf(fromMs, timeZone), rotaWeekStartOf(Math.max(fromMs, toMs - 1), timeZone)])];
}

interface Held {
  readonly key: string;
  readonly status: "loading" | "ready" | "error";
  readonly shifts: readonly RotaShift[];
  readonly people: readonly RotaPerson[];
  readonly readAtMs: number | null;
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

  const refresh = useCallback((now = false) => {
    if (!now && readAtMs.current !== null && Date.now() - readAtMs.current < ROTA_REREAD_MS) return;
    setAttempt((count) => count + 1);
  }, []);

  // A sick call or a cancelled shift reaches the board within five minutes
  // even when nothing else on it changes: the rota sends no live word.
  useEffect(() => {
    if (key === "") return;
    const timer = setInterval(() => { refresh(); }, 60_000);
    return () => { clearInterval(timer); };
  }, [key, refresh]);

  useEffect(() => {
    if (venueId === null || key === "") return;
    const reading = new AbortController();
    readAtMs.current = Date.now();
    setHeld((current) => (current?.key === key ? current : { key, status: "loading", ...NOTHING }));
    const startedAtMs = Date.now();
    Promise.all(weeks.split(",").map((start) => getRotaFloorWeek(venueId, start, reading.signal)))
      .then((read) => {
        if (reading.signal.aborted) return;
        if (read.some((week) => week.access === "own")) {
          setHeld({ key, status: "ready", ...NOTHING, readAtMs: startedAtMs });
          return;
        }
        const shifts = new Map<string, RotaShift>();
        const people = new Map<string, RotaPerson>();
        for (const week of read) {
          for (const shift of week.shifts) shifts.set(shift.id, shift);
          for (const person of week.people) people.set(person.id, person);
        }
        setHeld({ key, status: "ready", shifts: [...shifts.values()], people: [...people.values()], readAtMs: startedAtMs });
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
  return { status: held.status, shifts: held.shifts, people: held.people, readAtMs: held.readAtMs, refresh };
}
