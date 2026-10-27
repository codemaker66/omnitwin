import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIUsageSummary } from "@omnitwin/types";
import { AIUsageSettings } from "../AIUsageSettings.js";
import { moneyWords, monthWords, usedPercent } from "../ai-usage-format.js";

// ---------------------------------------------------------------------------
// The venue's AI use, as its admin and manager read it in Venue settings
// (T-656; Plan 19, L6 "metering live"): this month's spend against the
// allowance, each feature's calls and cost, and the months before. The API's
// summary is the source; nothing is worked out here but the words.
// ---------------------------------------------------------------------------

const { getAIUsage } = vi.hoisted(() => ({ getAIUsage: vi.fn() }));
vi.mock("../../../../api/ai-usage.js", () => ({ getAIUsage }));

const VENUE = "00000000-0000-4000-8000-0000000000a1";

function summary(overrides: Partial<AIUsageSummary> = {}): AIUsageSummary {
  return {
    venueId: VENUE,
    currency: "USD",
    priceTableVersion: "anthropic-2026-10-13",
    allowance: { month: "2026-10", limitMicroUsd: 50_000_000, spentMicroUsd: 420_000, heldMicroUsd: 0, remainingMicroUsd: 49_580_000 },
    months: [
      {
        month: "2026-10",
        calls: 31,
        costMicroUsd: 420_000,
        features: [
          {
            feature: "proposal_draft", calls: 27,
            outcomes: { ok: 25, refusal: 1, max_tokens: 0, error: 1, budget_blocked: 0 },
            inputTokens: 40_000, outputTokens: 9_000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, costMicroUsd: 340_000,
          },
          {
            feature: "enquiry_summary", calls: 4,
            outcomes: { ok: 4, refusal: 0, max_tokens: 0, error: 0, budget_blocked: 2 },
            inputTokens: 4_000, outputTokens: 1_000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, costMicroUsd: 80_000,
          },
        ],
      },
      { month: "2026-09", calls: 0, costMicroUsd: 0, features: [] },
      { month: "2026-08", calls: 3, costMicroUsd: 5_000, features: [] },
    ],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  getAIUsage.mockReset();
});

describe("the venue's AI use", () => {
  it("reads this venue's last three months and shows the allowance, each feature and the months before", async () => {
    getAIUsage.mockResolvedValue(summary());
    render(<AIUsageSettings venueId={VENUE} />);
    expect(screen.getByRole("status").textContent).toContain("Loading AI use");
    const allowance = await screen.findByTestId("ai-usage-allowance");
    expect(getAIUsage).toHaveBeenCalledWith(VENUE, 3, expect.any(AbortSignal));
    expect(allowance.textContent).toContain("US$0.42 of US$50.00 in October 2026");
    expect(allowance.textContent).toContain("US$49.58 left this month.");
    expect(allowance.textContent).toContain("2 drafts were not written because the allowance was used.");

    const table = screen.getByRole("table", { name: "October 2026, by feature" });
    const rows = within(table).getAllByRole("row").slice(1).map((row) => Array.from(row.children).map((cell) => cell.textContent));
    expect(rows).toEqual([
      ["Proposal messages", "27", "2", "US$0.34"],
      ["Enquiry summaries", "4", "0", "US$0.08"],
    ]);

    const earlier = screen.getByLabelText("Earlier months");
    expect(earlier.textContent).toContain("September 2026No calls");
    expect(earlier.textContent).toContain("August 20263 calls, under US$0.01");
  });

  it("says what is set aside for drafts being written, and says plainly when nothing has been used", async () => {
    getAIUsage.mockResolvedValue(summary({
      allowance: { month: "2026-10", limitMicroUsd: 50_000_000, spentMicroUsd: 0, heldMicroUsd: 360_000, remainingMicroUsd: 49_640_000 },
      months: [{ month: "2026-10", calls: 0, costMicroUsd: 0, features: [] }],
    }));
    render(<AIUsageSettings venueId={VENUE} />);
    const allowance = await screen.findByTestId("ai-usage-allowance");
    expect(allowance.textContent).toContain("US$49.64 left this month, with US$0.36 set aside for drafts being written.");
    expect(screen.getByText("No AI drafts or briefs yet in October 2026.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByLabelText("Earlier months")).toBeNull();
  });

  it("says when it could not be read, and reads again when asked", async () => {
    getAIUsage.mockRejectedValueOnce(new Error("network"));
    render(<AIUsageSettings venueId={VENUE} />);
    expect((await screen.findByRole("alert")).textContent).toBe("AI use could not be loaded.");
    getAIUsage.mockResolvedValueOnce(summary());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); await Promise.resolve(); });
    expect(await screen.findByTestId("ai-usage-allowance")).toBeTruthy();
    expect(getAIUsage).toHaveBeenCalledTimes(2);
  });

  it("never shows a venue's use after the reader has moved to another venue", async () => {
    let answerFirst: (value: AIUsageSummary) => void = () => undefined;
    getAIUsage.mockReturnValueOnce(new Promise<AIUsageSummary>((resolve) => { answerFirst = resolve; }));
    const { rerender } = render(<AIUsageSettings venueId={VENUE} />);
    const OTHER = "00000000-0000-4000-8000-0000000000b2";
    getAIUsage.mockResolvedValueOnce(summary({ venueId: OTHER, allowance: { month: "2026-10", limitMicroUsd: 50_000_000, spentMicroUsd: 1_000_000, heldMicroUsd: 0, remainingMicroUsd: 49_000_000 } }));
    rerender(<AIUsageSettings venueId={OTHER} />);
    expect((await screen.findByTestId("ai-usage-allowance")).textContent).toContain("US$1.00 of US$50.00");
    await act(async () => { answerFirst(summary()); await Promise.resolve(); });
    expect(screen.getByTestId("ai-usage-allowance").textContent).toContain("US$1.00 of US$50.00");
  });
});

describe("the words for AI use", () => {
  it("shows money in dollars and a spend too small for cents as under a cent, never as nothing", () => {
    expect(moneyWords(0)).toBe("US$0.00");
    expect(moneyWords(9_600)).toBe("under US$0.01");
    expect(moneyWords(10_000)).toBe("US$0.01");
    expect(moneyWords(50_000_000)).toBe("US$50.00");
  });

  it("names a month and fills the bar to the allowance, never past it", () => {
    expect(monthWords("2026-10")).toBe("October 2026");
    expect(monthWords("2027-01")).toBe("January 2027");
    expect(usedPercent(25_000_000, 0, 50_000_000)).toBe(50);
    expect(usedPercent(49_000_000, 2_000_000, 50_000_000)).toBe(100);
    expect(usedPercent(0, 0, 0)).toBe(100);
  });
});
