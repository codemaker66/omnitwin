import type { AIUsageFeature, AIUsageFeatureMonth } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// The words the venue's AI use is read in (Venue settings, T-656).
// ---------------------------------------------------------------------------

const FEATURE_WORDS: Readonly<Record<AIUsageFeature, string>> = {
  proposal_draft: "Proposal messages",
  enquiry_summary: "Enquiry summaries",
  event_brief: "Event briefs",
  beo_supplier_instruction_draft: "Handoff wording",
  truth_mode_explanation: "Truth Mode explanations",
  route_conflict_explanation: "Route explanations",
  lead_qualification: "Lead notes",
};

export function featureWords(feature: AIUsageFeature): string {
  return FEATURE_WORDS[feature];
}

const DOLLARS = new Intl.NumberFormat("en-GB", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Millionths of a US dollar as money: "US$0.42", "US$0.00", or "under US$0.01"
 *  for a cost too small to show in cents, so a spend never reads as nothing. */
export function moneyWords(microUsd: number): string {
  if (microUsd > 0 && microUsd < 10_000) return `under ${DOLLARS.format(0.01)}`;
  return DOLLARS.format(microUsd / 1_000_000);
}

const MONTH = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/** "2026-10" as "October 2026". */
export function monthWords(month: string): string {
  const [year, number] = month.split("-").map(Number);
  if (year === undefined || number === undefined || !Number.isInteger(year) || !Number.isInteger(number)) return month;
  return MONTH.format(new Date(Date.UTC(year, number - 1, 1)));
}

/** How much of the allowance is used, 0 to 100, for the bar. */
export function usedPercent(spentMicroUsd: number, heldMicroUsd: number, limitMicroUsd: number): number {
  if (limitMicroUsd <= 0) return 100;
  return Math.min(100, Math.round(((spentMicroUsd + heldMicroUsd) / limitMicroUsd) * 100));
}

/** Calls that came back with something other than an answer: declined, cut
 *  off or failed. Calls refused by the allowance were never made. */
export function unansweredCalls(feature: AIUsageFeatureMonth): number {
  return feature.outcomes.refusal + feature.outcomes.max_tokens + feature.outcomes.error;
}

export function callWords(count: number): string {
  return count === 1 ? "1 call" : `${count.toLocaleString("en-GB")} calls`;
}
