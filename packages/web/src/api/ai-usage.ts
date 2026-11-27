import { AIUsageSummarySchema, type AIUsageSummary } from "@omnitwin/types";
import { api } from "./client.js";

// ---------------------------------------------------------------------------
// What the venue's AI use has cost (T-656), month by month and feature by
// feature, with this month's allowance. Read by the venue's admin and manager
// (AI_USAGE_READ_ROLES); the API refuses everyone else.
// ---------------------------------------------------------------------------

export function getAIUsage(venueId: string, months: number, signal?: AbortSignal): Promise<AIUsageSummary> {
  return api.get(`/venues/${encodeURIComponent(venueId)}/ai-usage?months=${String(months)}`, AIUsageSummarySchema, signal);
}
