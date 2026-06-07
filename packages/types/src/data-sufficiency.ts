import { z } from "zod";

export const DATA_SUFFICIENCY_OUTCOMES = [
  "unsupported_request",
  "not_checked",
  "degraded_evidence",
  "requires_human_review",
] as const;
export const DataSufficiencyOutcomeSchema = z.enum(DATA_SUFFICIENCY_OUTCOMES);
export type DataSufficiencyOutcome = z.infer<typeof DataSufficiencyOutcomeSchema>;

export const DATA_SUFFICIENCY_SURFACES = [
  "validator_kernel",
  "layout_evidence_pack",
  "guest_flow_replay",
  "lighting_context",
  "truth_mode",
] as const;
export const DataSufficiencySurfaceSchema = z.enum(DATA_SUFFICIENCY_SURFACES);
export type DataSufficiencySurface = z.infer<typeof DataSufficiencySurfaceSchema>;

export const DATA_SUFFICIENCY_REQUIRED_INPUT_CATEGORIES = [
  "submitted_route",
  "venue_data",
  "probe_data",
  "simulation_assumptions",
  "residual_capture_metadata",
  "provenance",
] as const;
export const DataSufficiencyRequiredInputCategorySchema = z.enum(
  DATA_SUFFICIENCY_REQUIRED_INPUT_CATEGORIES,
);
export type DataSufficiencyRequiredInputCategory = z.infer<
  typeof DataSufficiencyRequiredInputCategorySchema
>;

export const DATA_SUFFICIENCY_MESSAGE_KEY_FAMILIES = [
  "data_sufficiency_unsupported_request",
  "data_sufficiency_not_checked",
  "data_sufficiency_degraded_evidence",
  "data_sufficiency_requires_human_review",
] as const;
export const DataSufficiencyMessageKeyFamilySchema = z.enum(
  DATA_SUFFICIENCY_MESSAGE_KEY_FAMILIES,
);
export type DataSufficiencyMessageKeyFamily = z.infer<
  typeof DataSufficiencyMessageKeyFamilySchema
>;
