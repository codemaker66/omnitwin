import { describe, expect, it } from "vitest";
import { AI_DRAFT_USE_CASES } from "../ai-assistant.js";
import {
  AI_BUDGET_REACHED,
  AI_USAGE_FEATURES,
  AI_USAGE_OUTCOMES,
  AIUsageSummaryQuerySchema,
  AIUsageSummarySchema,
  type AIUsageSummary,
} from "../ai-usage.js";

// ---------------------------------------------------------------------------
// T-656 — the shared words for AI usage: every feature that calls a model has
// a name the ledger accepts, every way a call can end has one, and the usage
// summary a venue's managers read is closed and counted in whole numbers.
// ---------------------------------------------------------------------------

const VENUE = "00000000-0000-4000-8000-00000000a656";

function summary(overrides: Partial<AIUsageSummary> = {}): AIUsageSummary {
  return {
    venueId: VENUE,
    currency: "USD",
    priceTableVersion: "anthropic-2026-10-13",
    allowance: { month: "2026-10", limitMicroUsd: 50_000_000, spentMicroUsd: 1_234, heldMicroUsd: 0, remainingMicroUsd: 49_998_766 },
    months: [{
      month: "2026-10",
      calls: 1,
      costMicroUsd: 1_234,
      features: [{
        feature: "event_brief",
        calls: 1,
        outcomes: { ok: 1, refusal: 0, max_tokens: 0, error: 0, budget_blocked: 0 },
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        costMicroUsd: 1_234,
      }],
    }],
    ...overrides,
  };
}

describe("AI usage vocabulary", () => {
  it("names every draft use case and typed event briefs as features", () => {
    expect(AI_USAGE_FEATURES).toEqual([...AI_DRAFT_USE_CASES, "event_brief"]);
  });

  it("names the five ways a call ends, the allowance among them", () => {
    expect(AI_USAGE_OUTCOMES).toEqual(["ok", "refusal", "max_tokens", "error", "budget_blocked"]);
    expect(AI_BUDGET_REACHED).toBe("AI_BUDGET_REACHED");
  });
});

describe("AI usage summary", () => {
  it("reads three months unless asked for more, and never more than 24", () => {
    expect(AIUsageSummaryQuerySchema.parse({})).toEqual({ months: 3 });
    expect(AIUsageSummaryQuerySchema.parse({ months: "12" })).toEqual({ months: 12 });
    expect(AIUsageSummaryQuerySchema.safeParse({ months: "25" }).success).toBe(false);
    expect(AIUsageSummaryQuerySchema.safeParse({ months: "0" }).success).toBe(false);
    expect(AIUsageSummaryQuerySchema.safeParse({ months: "1.5" }).success).toBe(false);
    expect(AIUsageSummaryQuerySchema.safeParse({ months: "3", venueId: VENUE }).success).toBe(false);
  });

  it("accepts a summary counted in whole micro-dollars and tokens", () => {
    expect(AIUsageSummarySchema.parse(summary())).toEqual(summary());
  });

  it("refuses fractional or negative amounts, an unknown feature and a malformed month", () => {
    const [month] = summary().months;
    if (month === undefined) throw new Error("fixture month missing");
    const [feature] = month.features;
    if (feature === undefined) throw new Error("fixture feature missing");
    expect(AIUsageSummarySchema.safeParse(summary({ months: [{ ...month, costMicroUsd: 1.5 }] })).success).toBe(false);
    expect(AIUsageSummarySchema.safeParse(summary({ months: [{ ...month, calls: -1 }] })).success).toBe(false);
    expect(AIUsageSummarySchema.safeParse(summary({
      months: [{ ...month, features: [{ ...feature, feature: "free_chat" as "event_brief" }] }],
    })).success).toBe(false);
    expect(AIUsageSummarySchema.safeParse(summary({ months: [{ ...month, month: "2026-13" }] })).success).toBe(false);
  });

  it("carries nothing beyond what it names", () => {
    expect(AIUsageSummarySchema.safeParse({ ...summary(), prompt: "Elaine Crawford" }).success).toBe(false);
  });
});
