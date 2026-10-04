import { useEffect, useState } from "react";
import { getAIAssistantStatus } from "../api/ai-assistant.js";

// ---------------------------------------------------------------------------
// useAIDraftsAvailable — whether an AI drafting provider is configured.
//
// A surface offers AI drafting only where it can work: AIDraftPanel renders
// nothing without a provider, so a disclosure around it would open onto an
// empty body. The status is asked once per page load and shared, because a
// desk may open dozens of records in a sitting. A failed check is not cached,
// so the next surface that asks tries again; until an answer arrives the
// value is `undefined` and callers show nothing.
// ---------------------------------------------------------------------------

let pending: Promise<boolean> | null = null;
const listeners = new Set<(available: boolean) => void>();

/** For the rest of the visit, offers no AI drafting: the server said it is
 *  not available now (503), so a control that cannot work is taken away. */
export function markAIDraftsUnavailable(): void {
  pending = Promise.resolve(false);
  for (const listener of listeners) listener(false);
}

function aiDraftsAvailable(): Promise<boolean> {
  pending ??= getAIAssistantStatus().then(
    (status) => status.configured,
    (error: unknown) => {
      pending = null;
      throw error;
    },
  );
  return pending;
}

export function useAIDraftsAvailable(): boolean | undefined {
  const [available, setAvailable] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    aiDraftsAvailable().then(
      (configured) => { if (!cancelled) setAvailable(configured); },
      () => { if (!cancelled) setAvailable(false); },
    );
    listeners.add(setAvailable);
    return () => { cancelled = true; listeners.delete(setAvailable); };
  }, []);
  return available;
}
