import { useEffect, useState } from "react";
import { getEventBriefReaderStatus } from "../api/event-architect.js";

// ---------------------------------------------------------------------------
// useEventBriefReaderAvailable — whether the server reads event briefs (T-650).
//
// The Event Architect offers "Describe the event" only where it can work: the
// server's own status says whether a provider reads briefs, and its "AI is
// off" hides the feature. Asked once per page load and shared; a failed check
// is not cached, so the next mount asks again. Until an answer arrives the
// value is `undefined` and nothing is shown. Mirrors useAIDraftsAvailable,
// which keeps its own answer for proposal drafts.
// ---------------------------------------------------------------------------

let pending: Promise<boolean> | null = null;
const listeners = new Set<(available: boolean) => void>();

/** For the rest of the visit, offers no brief reading: the server said AI
 *  is off (503 AI_ASSISTANT_DISABLED), so a control that cannot work goes. */
export function markEventBriefReaderUnavailable(): void {
  pending = Promise.resolve(false);
  for (const listener of listeners) listener(false);
}

/** Forgets the shared answer. For tests. */
export function resetEventBriefReaderAvailability(): void {
  pending = null;
}

function readerAvailable(): Promise<boolean> {
  pending ??= getEventBriefReaderStatus().then(
    (status) => status.configured,
    (error: unknown) => {
      pending = null;
      throw error;
    },
  );
  return pending;
}

export function useEventBriefReaderAvailable(): boolean | undefined {
  const [available, setAvailable] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    readerAvailable().then(
      (configured) => { if (!cancelled) setAvailable(configured); },
      () => { if (!cancelled) setAvailable(false); },
    );
    listeners.add(setAvailable);
    return () => { cancelled = true; listeners.delete(setAvailable); };
  }, []);
  return available;
}
