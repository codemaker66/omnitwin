import { describe, expect, it } from "vitest";
import {
  AIAssistantStatusSchema,
  CreateAIDraftRequestSchema,
  createReviewGatedAIDraft,
  findUnsafeAIDraftClaims,
  sanitizeAIDraftText,
} from "../ai-assistant.js";

const NOW = "2026-06-12T12:00:00.000Z";

describe("ai assistant draft contracts", () => {
  it("accepts disabled status without exposing provider details", () => {
    const status = AIAssistantStatusSchema.parse({
      configured: false,
      provider: null,
      model: null,
      disabledReason: "AI drafts are disabled until provider environment is configured.",
    });
    expect(status.configured).toBe(false);
  });

  it("validates draft requests as structured planning context", () => {
    const request = CreateAIDraftRequestSchema.parse({
      useCase: "enquiry_summary",
      context: {
        eventType: "Wedding",
        guestCount: 120,
        notes: ["Prefers evening ceremony"],
      },
    });
    expect(request.context["guestCount"]).toBe(120);
  });

  it("scans and replaces unsafe claim wording", () => {
    const unsafe = "This layout is certified safe and legally compliant.";
    expect(findUnsafeAIDraftClaims(unsafe)).toEqual(["certified safe", "legally compliant"]);
    const sanitized = sanitizeAIDraftText(unsafe);
    expect(sanitized.safeLanguageApplied).toBe(true);
    expect(sanitized.text).toContain("requires human review");
    expect(sanitized.text).toContain("not legally certified");
  });

  it("creates only unverified, human-review-required drafts", () => {
    const draft = createReviewGatedAIDraft({
      useCase: "proposal_draft",
      title: "Proposal draft",
      body: "Draft proposal text for review.",
      context: { proposalId: "demo" },
      generatedAt: NOW,
    });

    expect(draft.provenance).toBe("ai_generated");
    expect(draft.evidenceStatus).toBe("unverified");
    expect(draft.humanReviewRequired).toBe(true);
    expect(draft.sendState).toBe("draft_only");
    expect(draft.digest).toMatch(/^[a-f0-9]{64}$/);
  });
});
