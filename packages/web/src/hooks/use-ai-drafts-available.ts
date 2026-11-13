import { useEffect, useState } from "react";
import type { AIUsageFeature } from "@omnitwin/types";
import { getAIAssistantStatus } from "../api/ai-assistant.js";

// ---------------------------------------------------------------------------
// useAIDraftsAvailable — whether an AI draft is switched on here.
//
// A surface offers AI drafting only where it can work: AIDraftPanel renders
// nothing without a provider, so a disclosure around it would open onto an
// empty body. Each draft is switched on for a venue apart (C1), so the status
// is asked once per page load for each draft and shared, because a desk may
// open dozens of records in a sitting. A failed check is not cached, so the
// next surface that asks tries again; until an answer arrives the value is
// `undefined` and callers show nothing.
// ---------------------------------------------------------------------------

const pending = new Map<AIUsageFeature, Promise<boolean>>();
const listeners = new Set<{ readonly feature: AIUsageFeature; readonly set: (available: boolean) => void }>();

/** For the rest of the visit, offers no AI drafting for `feature`, or for
 *  any draft when none is named (the provider is out of credit): the server
 *  said it is not available now (503), so a control that cannot work is
 *  taken away. */
export function markAIDraftsUnavailable(feature?: AIUsageFeature): void {
  const gone = Promise.resolve(false);
  for (const listener of listeners) {
    if (feature === undefined || listener.feature === feature) {
      pending.set(listener.feature, gone);
      listener.set(false);
    }
  }
  if (feature !== undefined) pending.set(feature, gone);
}

/** Forgets every shared answer. For tests. */
export function resetAIDraftsAvailability(): void {
  pending.clear();
}

function aiDraftsAvailable(feature: AIUsageFeature): Promise<boolean> {
  const known = pending.get(feature);
  if (known !== undefined) return known;
  const asked = getAIAssistantStatus(feature).then(
    (status) => status.configured,
    (error: unknown) => {
      pending.delete(feature);
      throw error;
    },
  );
  pending.set(feature, asked);
  return asked;
}

export function useAIDraftsAvailable(feature: AIUsageFeature): boolean | undefined {
  const [available, setAvailable] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    aiDraftsAvailable(feature).then(
      (configured) => { if (!cancelled) setAvailable(configured); },
      () => { if (!cancelled) setAvailable(false); },
    );
    const listener = { feature, set: setAvailable };
    listeners.add(listener);
    return () => { cancelled = true; listeners.delete(listener); };
  }, [feature]);
  return available;
}
