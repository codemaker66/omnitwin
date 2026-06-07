import { describe, expect, it } from "vitest";
import {
  LAYOUT_PROOF_CLAIM_STATUSES,
  LayoutProofClaimStatusSchema,
} from "../layout-proof-object.js";
import {
  TRUTH_EVIDENCE_SOURCE_STATES,
  TRUTH_VERIFICATION_STATES,
  TruthEvidenceSourceStateSchema,
  TruthVerificationStateSchema,
} from "../truth-mode.js";
import {
  DATA_SUFFICIENCY_MESSAGE_KEY_FAMILIES,
  DATA_SUFFICIENCY_OUTCOMES,
  DATA_SUFFICIENCY_REQUIRED_INPUT_CATEGORIES,
  DATA_SUFFICIENCY_SURFACES,
  DataSufficiencyMessageKeyFamilySchema,
  DataSufficiencyOutcomeSchema,
  DataSufficiencyRequiredInputCategorySchema,
  DataSufficiencySurfaceSchema,
} from "../data-sufficiency.js";

function overlap(left: readonly string[], right: readonly string[]): readonly string[] {
  const rightValues = new Set(right);
  return left.filter((value) => rightValues.has(value));
}

describe("Data Sufficiency vocabulary", () => {
  it("pins the four DSC-001 outcomes", () => {
    expect(DATA_SUFFICIENCY_OUTCOMES).toEqual([
      "unsupported_request",
      "not_checked",
      "degraded_evidence",
      "requires_human_review",
    ]);

    for (const outcome of DATA_SUFFICIENCY_OUTCOMES) {
      expect(DataSufficiencyOutcomeSchema.safeParse(outcome).success).toBe(true);
    }
  });

  it("pins the internal surfaces allowed to emit data sufficiency outcomes", () => {
    expect(DATA_SUFFICIENCY_SURFACES).toEqual([
      "validator_kernel",
      "layout_evidence_pack",
      "guest_flow_replay",
      "lighting_context",
      "truth_mode",
    ]);

    for (const surface of DATA_SUFFICIENCY_SURFACES) {
      expect(DataSufficiencySurfaceSchema.safeParse(surface).success).toBe(true);
    }
  });

  it("pins required input categories from the doctrine examples", () => {
    expect(DATA_SUFFICIENCY_REQUIRED_INPUT_CATEGORIES).toEqual([
      "submitted_route",
      "venue_data",
      "probe_data",
      "simulation_assumptions",
      "residual_capture_metadata",
      "provenance",
    ]);

    for (const category of DATA_SUFFICIENCY_REQUIRED_INPUT_CATEGORIES) {
      expect(DataSufficiencyRequiredInputCategorySchema.safeParse(category).success).toBe(true);
    }
  });

  it("does not treat pass and fail verdicts as data sufficiency outcomes", () => {
    expect(DataSufficiencyOutcomeSchema.safeParse("pass").success).toBe(false);
    expect(DataSufficiencyOutcomeSchema.safeParse("fail").success).toBe(false);
    expect(DataSufficiencyOutcomeSchema.safeParse("warn").success).toBe(false);
    expect(LayoutProofClaimStatusSchema.safeParse("unsupported_request").success).toBe(false);
    expect(LayoutProofClaimStatusSchema.safeParse("degraded_evidence").success).toBe(false);
    expect(overlap(DATA_SUFFICIENCY_OUTCOMES, LAYOUT_PROOF_CLAIM_STATUSES)).toEqual([
      "not_checked",
      "requires_human_review",
    ]);
  });

  it("does not reuse Truth Mode source or verification states as outcomes", () => {
    expect(overlap(DATA_SUFFICIENCY_OUTCOMES, TRUTH_VERIFICATION_STATES)).toEqual([]);
    expect(overlap(DATA_SUFFICIENCY_OUTCOMES, TRUTH_EVIDENCE_SOURCE_STATES)).toEqual([]);
    expect(DataSufficiencyOutcomeSchema.safeParse("verified").success).toBe(false);
    expect(DataSufficiencyOutcomeSchema.safeParse("scan_observed").success).toBe(false);
    expect(TruthVerificationStateSchema.safeParse("degraded_evidence").success).toBe(false);
    expect(TruthEvidenceSourceStateSchema.safeParse("unsupported_request").success).toBe(false);
  });

  it("pins data sufficiency message key families", () => {
    expect(DATA_SUFFICIENCY_MESSAGE_KEY_FAMILIES).toEqual([
      "data_sufficiency_unsupported_request",
      "data_sufficiency_not_checked",
      "data_sufficiency_degraded_evidence",
      "data_sufficiency_requires_human_review",
    ]);

    for (const family of DATA_SUFFICIENCY_MESSAGE_KEY_FAMILIES) {
      expect(DataSufficiencyMessageKeyFamilySchema.safeParse(family).success).toBe(true);
    }
  });

  it("uses metadata-only string vocabularies", () => {
    const vocabularies = [
      DATA_SUFFICIENCY_OUTCOMES,
      DATA_SUFFICIENCY_SURFACES,
      DATA_SUFFICIENCY_REQUIRED_INPUT_CATEGORIES,
      DATA_SUFFICIENCY_MESSAGE_KEY_FAMILIES,
    ] as const;

    for (const vocabulary of vocabularies) {
      expect(vocabulary.every((value) => typeof value === "string")).toBe(true);
      expect(new Set(vocabulary).size).toBe(vocabulary.length);
    }
  });
});
