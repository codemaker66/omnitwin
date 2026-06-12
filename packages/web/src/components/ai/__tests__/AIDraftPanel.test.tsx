import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AIDraft, AIAssistantStatus } from "@omnitwin/types";

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
  it("shows disabled state and does not call draft generation", async () => {
    getAIAssistantStatusMock.mockResolvedValue(disabledStatus());
    render(
      <AIDraftPanel
        title="AI Truth Mode draft"
        useCase="truth_mode_explanation"
        context={{ targetId: "room" }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("AI drafts are disabled until provider environment is configured.")).toBeDefined();
    });
    const button = screen.getByRole<HTMLButtonElement>("button", { name: "Generate draft" });
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
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
    expect(screen.getByText("Human review required")).toBeDefined();
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
