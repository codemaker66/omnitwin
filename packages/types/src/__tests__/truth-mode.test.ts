import { describe, expect, it } from "vitest";
import {
  TRUTH_CONFIDENCE_TIERS,
  TRUTH_EVIDENCE_SOURCE_STATES,
  TRUTH_MODE_DISCLOSURE_LEVELS,
  TRUTH_MODE_PERSONA_PRESETS,
  TRUTH_MODE_TOKEN_CATEGORIES,
  TRUTH_STALENESS_STATES,
  TRUTH_VERIFICATION_STATES,
  TruthConfidenceTierSchema,
  TruthEvidenceSourceStateSchema,
  TruthModeDisclosureLevelSchema,
  TruthModePersonaPresetSchema,
  TruthModeTokenCategorySchema,
  TruthStalenessStateSchema,
  TruthVerificationStateSchema,
} from "../truth-mode.js";

function overlap(left: readonly string[], right: readonly string[]): readonly string[] {
  const rightValues = new Set(right);
  return left.filter((value) => rightValues.has(value));
}

describe("Truth Mode vocabulary", () => {
  it("pins evidence/source state values", () => {
    expect(TRUTH_EVIDENCE_SOURCE_STATES).toEqual([
      "scan_observed",
      "sensor_fused",
      "denoised",
      "hole_filled",
      "ai_inferred",
      "ai_generated",
      "human_edited",
      "artist_proxy",
      "procedural_runtime",
      "known_unknown",
      "measured_empty",
    ]);
  });

  it("pins verification state values", () => {
    expect(TRUTH_VERIFICATION_STATES).toEqual([
      "unverified",
      "verified",
      "contested",
      "expired",
      "suppressed",
    ]);
  });

  it("pins confidence tiers as categorical bands", () => {
    expect(TRUTH_CONFIDENCE_TIERS).toEqual([
      "survey_grade",
      "ops_grade",
      "layout_grade",
      "appearance_only",
      "unknown",
    ]);
  });

  it("pins staleness values separately from verification expiry", () => {
    expect(TRUTH_STALENESS_STATES).toEqual([
      "fresh",
      "review_due",
      "stale",
      "unknown",
    ]);
  });

  it("pins persona preset names", () => {
    expect(TRUTH_MODE_PERSONA_PRESETS).toEqual([
      "planner_lite",
      "hallkeeper_verification",
      "developer_qa_debug",
      "client_real_vs_proposed",
    ]);
  });

  it("pins progressive disclosure levels", () => {
    expect(TRUTH_MODE_DISCLOSURE_LEVELS).toEqual(["L1", "L2", "L3", "L4"]);
  });

  it("pins visual token categories", () => {
    expect(TRUTH_MODE_TOKEN_CATEGORIES).toEqual([
      "observed",
      "fused",
      "inferred",
      "ai-generated",
      "human-edited",
      "artist-proxy",
      "verified",
      "contested",
      "stale",
      "known-unknown",
    ]);
  });

  it("keeps source/evidence state separate from verification state", () => {
    expect(overlap(TRUTH_EVIDENCE_SOURCE_STATES, TRUTH_VERIFICATION_STATES)).toEqual([]);
    expect(TruthEvidenceSourceStateSchema.safeParse("verified").success).toBe(false);
    expect(TruthVerificationStateSchema.safeParse("scan_observed").success).toBe(false);
  });

  it("keeps confidence tier separate from verification state", () => {
    expect(overlap(TRUTH_CONFIDENCE_TIERS, TRUTH_VERIFICATION_STATES)).toEqual([]);
    expect(TruthConfidenceTierSchema.safeParse("verified").success).toBe(false);
    expect(TruthVerificationStateSchema.safeParse("layout_grade").success).toBe(false);
  });

  it("keeps staleness separate from source and verification axes", () => {
    expect(overlap(TRUTH_STALENESS_STATES, TRUTH_EVIDENCE_SOURCE_STATES)).toEqual([]);
    expect(overlap(TRUTH_STALENESS_STATES, TRUTH_VERIFICATION_STATES)).toEqual([]);
    expect(TruthStalenessStateSchema.safeParse("stale").success).toBe(true);
    expect(TruthEvidenceSourceStateSchema.safeParse("stale").success).toBe(false);
  });

  it("exposes schemas for presets, disclosure levels, and token categories", () => {
    expect(TruthModePersonaPresetSchema.safeParse("hallkeeper_verification").success).toBe(true);
    expect(TruthModeDisclosureLevelSchema.safeParse("L3").success).toBe(true);
    expect(TruthModeTokenCategorySchema.safeParse("artist-proxy").success).toBe(true);
    expect(TruthModePersonaPresetSchema.safeParse("hallkeeper").success).toBe(false);
    expect(TruthModeDisclosureLevelSchema.safeParse("level_3").success).toBe(false);
    expect(TruthModeTokenCategorySchema.safeParse("artist_proxy").success).toBe(false);
  });
});
