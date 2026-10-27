import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AIDraft, AIAssistantStatus } from "@omnitwin/types";
import { ApiError } from "../../../api/client.js";

const { getAIAssistantStatusMock, createAIDraftMock } = vi.hoisted(() => ({
  getAIAssistantStatusMock: vi.fn(),
  createAIDraftMock: vi.fn(),
}));

vi.mock("../../../api/ai-assistant.js", () => ({
  getAIAssistantStatus: getAIAssistantStatusMock,
  createAIDraft: createAIDraftMock,
}));

import { AIDraftPanel } from "../AIDraftPanel.js";

afterEach(() => {
  cleanup();
  getAIAssistantStatusMock.mockReset();
  createAIDraftMock.mockReset();
});

function configuredStatus(): AIAssistantStatus {
  return {
    configured: true,
    provider: "mock",
    model: "draft-model",
    disabledReason: null,
  };
}

function disabledStatus(): AIAssistantStatus {
  return {
    configured: false,
    provider: null,
    model: null,
    disabledReason: "AI drafts are disabled until provider environment is configured.",
  };
}

function draft(): AIDraft {
  return {
    schemaVersion: "ai_assistant.v0",
    useCase: "truth_mode_explanation",
    title: "Truth Mode explanation draft",
    body: "Planning explanation for staff review.",
    blockedUnsafeClaims: [],
    safeLanguageApplied: false,
    humanReviewRequired: true,
    provenance: "ai_generated",
    evidenceStatus: "unverified",
    sendState: "draft_only",
    generatedAt: "2026-06-12T13:00:00.000Z",
    digest: "a".repeat(64),
  };
}

describe("AIDraftPanel", () => {
  it.each(["success", "failure"] as const)("retires generation activity on %s and prevents duplicate requests", async (outcome) => {
    getAIAssistantStatusMock.mockResolvedValue(configuredStatus());
    let finish: ((value: AIDraft) => void) | undefined;
    let fail: ((error: Error) => void) | undefined;
    createAIDraftMock.mockReturnValue(new Promise<AIDraft>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    }));
    render(<AIDraftPanel title="Draft" useCase="truth_mode_explanation" context={{ targetId: "room" }} />);
    // The panel only appears once /ai/status confirms a configured provider.
    const generate = await screen.findByRole<HTMLButtonElement>("button", { name: "Generate draft" });
    expect(generate.disabled).toBe(false);
    fireEvent.click(generate);
    const busy = screen.getByRole<HTMLButtonElement>("button", { name: "Generating draft" });
    expect(busy.disabled).toBe(true);
    expect(busy.querySelector("[data-activity-indicator]")).not.toBeNull();
    fireEvent.click(busy);
    expect(createAIDraftMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      if (outcome === "success") finish?.(draft());
      else fail?.(new Error("Provider unavailable"));
      await Promise.resolve();
    });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Generate draft" }).disabled).toBe(false);
    expect(document.querySelector("[data-activity-indicator]")).toBeNull();
    if (outcome === "failure") expect(screen.getByRole("alert")).toBeDefined();
    else expect(screen.getByDisplayValue(draft().body)).toBeDefined();
  });

  // T-656: a venue whose AI allowance for the month is used is told so in the
  // panel's own words for any failure, and carries on by hand.
  it("answers a used monthly allowance (429 AI_BUDGET_REACHED) calmly, as any failure", async () => {
    getAIAssistantStatusMock.mockResolvedValue(configuredStatus());
    createAIDraftMock.mockRejectedValue(new ApiError(429, "This venue's AI allowance for the month is used", "AI_BUDGET_REACHED"));
    render(<AIDraftPanel title="Draft" useCase="enquiry_summary" context={{ guests: 90 }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Generate draft" }));
    expect((await screen.findByRole("alert")).textContent).toBe("AI draft generation is unavailable. Continue with manual review.");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Generate draft" }).disabled).toBe(false);
    expect(document.querySelector("[data-activity-indicator]")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  // Release audit ai-1: a draft whose context the server builds from its own
  // record (an enquiry's summary) is asked for by that request alone; the
  // screen's context route is never called.
  it("asks a server-built draft by its own request, never sending a context to /ai/drafts", async () => {
    getAIAssistantStatusMock.mockResolvedValue(configuredStatus());
    const request = vi.fn(() => Promise.resolve({ ...draft(), useCase: "enquiry_summary" as const, body: "A wedding for 150." }));
    render(<AIDraftPanel title="Enquiry summary" useCase="enquiry_summary" actionLabel="Draft summary" request={request} />);
    fireEvent.click(await screen.findByRole("button", { name: "Draft summary" }));
    expect(await screen.findByDisplayValue("A wedding for 150.")).toBeDefined();
    expect(request).toHaveBeenCalledTimes(1);
    expect(createAIDraftMock).not.toHaveBeenCalled();
  });

  it("renders nothing and never offers generation when no provider is configured", async () => {
    getAIAssistantStatusMock.mockResolvedValue(disabledStatus());
    const { container } = render(
      <AIDraftPanel
        title="AI Truth Mode draft"
        useCase="truth_mode_explanation"
        context={{ targetId: "room" }}
      />,
    );

    await waitFor(() => { expect(getAIAssistantStatusMock).toHaveBeenCalled(); });
    await waitFor(() => { expect(container.innerHTML).toBe(""); });
    expect(screen.queryByRole("button", { name: "Generate draft" })).toBeNull();
    expect(screen.queryByText("AI drafts are disabled until provider environment is configured.")).toBeNull();
    expect(createAIDraftMock).not.toHaveBeenCalled();
  });

  it("renders nothing when the status check itself fails, rather than a dead control", async () => {
    getAIAssistantStatusMock.mockRejectedValue(new Error("network"));
    const { container } = render(
      <AIDraftPanel
        title="AI Truth Mode draft"
        useCase="truth_mode_explanation"
        context={{ targetId: "room" }}
      />,
    );

    await waitFor(() => { expect(container.innerHTML).toBe(""); });
    expect(createAIDraftMock).not.toHaveBeenCalled();
  });

  it("renders mocked draft output as unverified and human-review-required", async () => {
    getAIAssistantStatusMock.mockResolvedValue(configuredStatus());
    createAIDraftMock.mockResolvedValue(draft());
    render(
      <AIDraftPanel
        title="AI Truth Mode draft"
        useCase="truth_mode_explanation"
        context={{ targetId: "room" }}
      />,
    );

    await waitFor(() => {
      const button = screen.getByRole<HTMLButtonElement>("button", { name: "Generate draft" });
      expect(button.disabled).toBe(false);
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Planning explanation for staff review.")).toBeDefined();
    });
    expect(screen.getByText("ai generated")).toBeDefined();
    expect(screen.getByText("unverified")).toBeDefined();
    expect(screen.getByText(/Human review required/)).toBeDefined();
    expect(screen.queryByRole("button", { name: /send|approve/iu })).toBeNull();
  });

  it("keeps visible UI copy inside safe planning language", async () => {
    getAIAssistantStatusMock.mockResolvedValue(configuredStatus());
    createAIDraftMock.mockResolvedValue(draft());
    render(
      <AIDraftPanel
        title="AI Truth Mode draft"
        useCase="truth_mode_explanation"
        context={{ targetId: "room" }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Generate draft" })).toBeDefined();
    });
    const bodyText = document.body.textContent ?? "";
    expect(bodyText).not.toMatch(/certified safe/iu);
    expect(bodyText).not.toMatch(/legally compliant/iu);
    expect(bodyText).not.toMatch(/approved for occupancy/iu);
  });
});
