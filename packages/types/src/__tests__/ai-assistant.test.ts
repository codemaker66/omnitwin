import { describe, expect, it } from "vitest";
import {
  AIAssistantStatusSchema,
  CreateAIDraftRequestSchema,
  createReviewGatedAIDraft,
  findUnsafeAIDraftClaims,
  sanitizeAIDraftText,
} from "../ai-assistant.js";
import { findDraftCommitments } from "../ai-draft-commitments.js";

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

  // Plan 19, L6 release review: the web and the API deploy apart. A draft
  // that took nothing out carries no `withheldCommitments`, so a page built
  // before the field existed (its schema refuses unknown keys) still reads it.
  it("names what was taken out only when something was", () => {
    const clean = createReviewGatedAIDraft({
      useCase: "proposal_draft", title: "Proposal draft", body: "Our events team will confirm the date with you.", context: {}, generatedAt: NOW,
    });
    expect(Object.keys(clean)).not.toContain("withheldCommitments");
    const withheld = createReviewGatedAIDraft({
      useCase: "proposal_draft", title: "Proposal draft", body: "The hall seats 200. Our events team will confirm the date with you.", context: {}, generatedAt: NOW,
    });
    expect(withheld.withheldCommitments).toEqual(["capacity"]);
    expect(withheld.body).toBe("Our events team will confirm the date with you.");
  });

  // Release review: the wording was made safe after the claims were taken
  // out, and a safer word could move a claim the check had read as asked
  // about; the schema then refused the draft. The claims are now taken out
  // of the words as they will be shown.
  it("takes the claims out of the words the draft will show", () => {
    const draft = createReviewGatedAIDraft({
      useCase: "proposal_draft",
      title: "Proposal draft",
      body: "Thank you for your enquiry. Our events team will confirm whether the legally compliant hall is free on the 14th. With best wishes, The Events Team",
      context: {},
      generatedAt: NOW,
    });
    expect(draft.safeLanguageApplied).toBe(true);
    expect(findDraftCommitments(draft.body)).toEqual([]);
  });
});
