import { useEffect, useState } from "react";
import { getEventBriefReaderStatus } from "../api/event-architect.js";

// ---------------------------------------------------------------------------
// useEventBriefReaderAvailable — whether the server reads event briefs (T-650)
// for a venue.
//
// The Event Architect offers "Describe the event" only where it can work: the
// server's own status says whether a provider reads briefs for the venue (each
// venue is switched on apart, C1), and its "AI is off" hides the feature.
// Asked once per page load for each venue and shared; a failed check is not
// cached, so the next mount asks again. Until an answer arrives the value is
// `undefined` and nothing is shown. Mirrors useAIDraftsAvailable, which keeps
// its own answers for the other drafts.
// ---------------------------------------------------------------------------

const pending = new Map<string, Promise<boolean>>();
const listeners = new Set<(available: boolean) => void>();

/** For the rest of the visit, offers no brief reading: the server said AI
 *  is off, or out of credit (503), so a control that cannot work goes. */
export function markEventBriefReaderUnavailable(): void {
  for (const venueId of pending.keys()) pending.set(venueId, Promise.resolve(false));
  for (const listener of listeners) listener(false);
}

/** Forgets the shared answers. For tests. */
export function resetEventBriefReaderAvailability(): void {
  pending.clear();
}

function readerAvailable(venueId: string): Promise<boolean> {
  const known = pending.get(venueId);
  if (known !== undefined) return known;
  const asked = getEventBriefReaderStatus(venueId).then(
    (status) => status.configured,
    (error: unknown) => {
      pending.delete(venueId);
      throw error;
    },
  );
  pending.set(venueId, asked);
  return asked;
}

export function useEventBriefReaderAvailable(venueId: string): boolean | undefined {
  const [available, setAvailable] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    readerAvailable(venueId).then(
      (configured) => { if (!cancelled) setAvailable(configured); },
      () => { if (!cancelled) setAvailable(false); },
    );
    listeners.add(setAvailable);
    return () => { cancelled = true; listeners.delete(setAvailable); };
  }, [venueId]);
  return available;
}
