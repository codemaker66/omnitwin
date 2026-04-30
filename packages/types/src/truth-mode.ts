import { z } from "zod";

export const TRUTH_EVIDENCE_SOURCE_STATES = [
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
] as const;

export const TruthEvidenceSourceStateSchema = z.enum(TRUTH_EVIDENCE_SOURCE_STATES);
export type TruthEvidenceSourceState = z.infer<typeof TruthEvidenceSourceStateSchema>;

export const TRUTH_VERIFICATION_STATES = [
  "unverified",
  "verified",
  "contested",
  "expired",
  "suppressed",
] as const;

export const TruthVerificationStateSchema = z.enum(TRUTH_VERIFICATION_STATES);
export type TruthVerificationState = z.infer<typeof TruthVerificationStateSchema>;

export const TRUTH_CONFIDENCE_TIERS = [
  "survey_grade",
  "ops_grade",
  "layout_grade",
  "appearance_only",
  "unknown",
] as const;

export const TruthConfidenceTierSchema = z.enum(TRUTH_CONFIDENCE_TIERS);
export type TruthConfidenceTier = z.infer<typeof TruthConfidenceTierSchema>;

export const TRUTH_STALENESS_STATES = [
  "fresh",
  "review_due",
  "stale",
  "unknown",
] as const;

export const TruthStalenessStateSchema = z.enum(TRUTH_STALENESS_STATES);
export type TruthStalenessState = z.infer<typeof TruthStalenessStateSchema>;

export const TRUTH_MODE_PERSONA_PRESETS = [
  "planner_lite",
  "hallkeeper_verification",
  "developer_qa_debug",
  "client_real_vs_proposed",
] as const;

export const TruthModePersonaPresetSchema = z.enum(TRUTH_MODE_PERSONA_PRESETS);
export type TruthModePersonaPreset = z.infer<typeof TruthModePersonaPresetSchema>;

export const TRUTH_MODE_DISCLOSURE_LEVELS = ["L1", "L2", "L3", "L4"] as const;

export const TruthModeDisclosureLevelSchema = z.enum(TRUTH_MODE_DISCLOSURE_LEVELS);
export type TruthModeDisclosureLevel = z.infer<typeof TruthModeDisclosureLevelSchema>;

export const TRUTH_MODE_TOKEN_CATEGORIES = [
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
] as const;

export const TruthModeTokenCategorySchema = z.enum(TRUTH_MODE_TOKEN_CATEGORIES);
export type TruthModeTokenCategory = z.infer<typeof TruthModeTokenCategorySchema>;
