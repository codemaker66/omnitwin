import { describe, it, expect } from "vitest";
import {
  AnthropicGenerationAdapter,
  generateAIDraft,
  type AIGenerationEffort,
  type AIGenerationUsage,
} from "../services/ai-assistant.js";

// Live smoke test against the real Anthropic API. Skipped unless
// AI_ASSISTANT_API_KEY is in the process environment, so `pnpm test` never
// spends money by default. Run it on purpose with:
//   node --env-file=.env node_modules/vitest/vitest.mjs run src/__tests__/ai-assistant-anthropic.live.test.ts
// Two drafts are generated (well under $0.10 at Opus 5.5 low effort); the second
// should read the system block from the prompt cache the first one wrote.

const apiKey = process.env["AI_ASSISTANT_API_KEY"];
const model = process.env["AI_ASSISTANT_MODEL"] ?? "claude-opus-5-5";
const effort = (process.env["AI_ASSISTANT_EFFORT"] ?? "low") as AIGenerationEffort;

// USD per million tokens (first-party API list prices, Oct 2026). Cache writes
// use the 5-minute TTL rate (1.25x input).
const PRICES: Readonly<Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }>> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
};

function estimatedCostUsd(usage: AIGenerationUsage): number | null {
  const price = PRICES[usage.servedByModel];
  if (price === undefined) return null;
  return (
    usage.inputTokens * price.input +
    usage.outputTokens * price.output +
    usage.cacheCreationInputTokens * price.cacheWrite +
    usage.cacheReadInputTokens * price.cacheRead
  ) / 1_000_000;
}

describe.skipIf(apiKey === undefined || apiKey === "")("Anthropic AI drafts (live)", () => {
  it("drafts two review-gated texts and reads the fixed instructions from cache on the second", async () => {
    const usages: AIGenerationUsage[] = [];
    const adapter = new AnthropicGenerationAdapter({
      model,
      apiKey: apiKey ?? "",
      effort,
      onUsage: (usage) => usages.push(usage),
    });

    const first = await generateAIDraft(adapter, {
      useCase: "enquiry_summary",
      context: {
        enquirerName: "Sample Enquirer",
        eventType: "wedding reception",
        preferredDate: "2027-06-12",
        guestCount: 140,
        roomsMentioned: ["Grand Hall"],
        message: "Dinner for 140 then a ceilidh. Two guests use wheelchairs. Is a late licence possible?",
      },
    });
    const second = await generateAIDraft(adapter, {
      useCase: "beo_supplier_instruction_draft",
      context: {
        eventType: "conference dinner",
        date: "2027-03-04",
        guestCount: 90,
        room: "Grand Hall",
        layout: "9 round tables of 10",
        timings: { suppliersArrive: "14:00", guestsArrive: "18:30", dinner: "19:30", finish: "23:00" },
        catering: "Three-course dinner, 4 vegetarian, 2 gluten-free",
      },
    });

    for (const draft of [first, second]) {
      expect(draft.body.length).toBeGreaterThan(0);
      expect(draft.humanReviewRequired).toBe(true);
      expect(draft.sendState).toBe("draft_only");
    }

    let total = 0;
    usages.forEach((usage, index) => {
      const cost = estimatedCostUsd(usage);
      total += cost ?? 0;
      console.info(
        `[live AI draft ${String(index + 1)}] ${usage.useCase} on ${usage.servedByModel} (effort ${effort}): ` +
        `input ${String(usage.inputTokens)}, output ${String(usage.outputTokens)}, ` +
        `cache write ${String(usage.cacheCreationInputTokens)}, cache read ${String(usage.cacheReadInputTokens)}` +
        (cost === null ? " (no price on file for this model)" : `, est. $${cost.toFixed(5)}`),
      );
    });
    console.info(`[live AI draft] estimated total $${total.toFixed(5)}`);
    console.info(`[live AI draft 1 body]\n${first.body}`);

    expect(usages).toHaveLength(2);
    expect((usages[0]?.cacheCreationInputTokens ?? 0) + (usages[0]?.cacheReadInputTokens ?? 0)).toBeGreaterThan(0);
    expect(usages[1]?.cacheReadInputTokens ?? 0).toBeGreaterThan(0);
  }, 240_000);
});
