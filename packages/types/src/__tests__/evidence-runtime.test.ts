import { describe, expect, it } from "vitest";
import {
  CHECK_RESULT_STATUSES,
  type EvidencePackPayload,
  EvidencePackPayloadSchema,
  ReviewGateDecisionInputSchema,
  TruthModeSummarySchema,
  findUnsafePublicClaim,
  safePlanningLanguage,
  evidencePackPayloadDigest,
} from "../evidence-runtime.js";

const snapshotHash = "a".repeat(64);

function validPayload(): EvidencePackPayload {
  return {
    schemaVersion: "evidence_pack.v0",
    snapshotHash,
    layoutCount: 12,
    capacityResult: {
      checkType: "capacity",
      status: "requires_review",
      message: "Capacity is planning evidence and requires human review.",
    },
    routeClearanceResult: {
      checkType: "route_clearance",
      status: "not_checked",
      message: "Route-clearance result is not checked in this evidence pack.",
    },
    runtimeAssetStatus: {
      status: "missing",
      runtimePackageId: null,
      evidenceStatus: null,
      wording: "No runtime asset evidence is linked to this snapshot.",
    },
    assumptions: [
      {
        assumptionType: "guest_count",
        value: 120,
        sourceLabel: "Frozen layout snapshot",
      },
    ],
    reviewGates: [
      {
        gateType: "human_review_required",
        status: "open",
        title: "Human review required",
        description: "Layout evidence is planning support until reviewed.",
      },
    ],
    safeWording: [
      "Planning evidence",
      "Human review required",
      "Not legally certified",
    ],
    humanReviewRequired: true,
  };
}

describe("Evidence runtime contracts", () => {
  it("pins check result statuses", () => {
    expect(CHECK_RESULT_STATUSES).toEqual([
      "passed",
      "failed",
      "not_checked",
      "not_available",
      "requires_review",
    ]);
  });

  it("parses a v0 evidence pack with assumptions and review gates", () => {
    const parsed = EvidencePackPayloadSchema.parse(validPayload());
    expect(parsed.snapshotHash).toBe(snapshotHash);
    expect(parsed.assumptions).toHaveLength(1);
    expect(parsed.reviewGates[0]?.status).toBe("open");
    expect(parsed.humanReviewRequired).toBe(true);
  });

  it("produces deterministic evidence pack payload hashes", () => {
    const left = evidencePackPayloadDigest(validPayload());
    const right = evidencePackPayloadDigest({
      ...validPayload(),
      safeWording: [...validPayload().safeWording],
    });
    expect(left).toMatch(/^[a-f0-9]{64}$/u);
    expect(right).toBe(left);
  });

  it("keeps review gate decisions explicit", () => {
    expect(ReviewGateDecisionInputSchema.safeParse({ status: "approved", note: "Reviewer accepted this planning evidence." }).success).toBe(true);
    expect(ReviewGateDecisionInputSchema.safeParse({ status: "open" }).success).toBe(false);
  });

  it("summarises stale/current state without unsafe claims", () => {
    const summary = TruthModeSummarySchema.parse({
      targetType: "configuration",
      targetId: "00000000-0000-4000-8000-000000000001",
      source: "Frozen layout snapshot",
      confidence: "medium",
      assumption: "One active assumption is linked.",
      evidenceStatus: "partial",
      reviewGate: "One open review gate.",
      staleState: "review_due",
      safeWording: ["Planning evidence", "Human review required"],
      humanReviewRequired: true,
      counts: {
        evidenceItems: 3,
        checkResults: 2,
        assumptions: 1,
        reviewGates: 1,
        staleEvents: 1,
      },
    });
    expect(summary.staleState).toBe("review_due");
    expect(findUnsafePublicClaim(summary.safeWording.join(" "))).toBeNull();
  });

  it("blocks and replaces unsafe public/client wording", () => {
    expect(findUnsafePublicClaim("This layout is certified safe.")).toBe("certified safe");
    const safe = safePlanningLanguage("This layout is certified safe and legally compliant.");
    expect(safe).toContain("requires human review");
    expect(safe).toContain("not legally certified");
    expect(findUnsafePublicClaim(safe)).toBeNull();
    expect(EvidencePackPayloadSchema.safeParse({
      ...validPayload(),
      safeWording: ["fire approved"],
    }).success).toBe(false);
  });
});
