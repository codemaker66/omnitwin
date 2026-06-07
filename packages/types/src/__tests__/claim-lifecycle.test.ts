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
  CLAIM_LIFECYCLE_ACTOR_CATEGORIES,
  CLAIM_LIFECYCLE_EVENTS,
  CLAIM_LIFECYCLE_SOURCE_CATEGORIES,
  CLAIM_LIFECYCLE_STATES,
  CLAIM_REGENERATION_DECISIONS,
  CLAIM_STALENESS_TRIGGERS,
  ClaimLifecycleActorCategorySchema,
  ClaimLifecycleEventSchema,
  ClaimLifecycleSourceCategorySchema,
  ClaimLifecycleStateSchema,
  ClaimRegenerationDecisionSchema,
  ClaimStalenessTriggerSchema,
} from "../claim-lifecycle.js";

function overlap(left: readonly string[], right: readonly string[]): readonly string[] {
  const rightValues = new Set(right);
  return left.filter((value) => rightValues.has(value));
}

describe("Claim lifecycle metadata vocabulary", () => {
  it("pins lifecycle states from VCL-001", () => {
    expect(CLAIM_LIFECYCLE_STATES).toEqual([
      "created",
      "supported",
      "machine_checked",
      "human_reviewed",
      "verified",
      "contested",
      "superseded",
      "stale",
      "expired",
      "withdrawn",
      "published",
    ]);

    for (const state of CLAIM_LIFECYCLE_STATES) {
      expect(ClaimLifecycleStateSchema.safeParse(state).success).toBe(true);
    }
  });

  it("pins append-only lifecycle event names", () => {
    expect(CLAIM_LIFECYCLE_EVENTS).toEqual([
      "capture_ingested",
      "claim_created",
      "evidence_attached",
      "validator_checked",
      "human_reviewed",
      "user_contested",
      "layout_changed",
      "venue_geometry_changed",
      "policy_changed",
      "validator_changed",
      "capture_refreshed",
      "claim_published",
      "claim_withdrawn",
    ]);

    for (const event of CLAIM_LIFECYCLE_EVENTS) {
      expect(ClaimLifecycleEventSchema.safeParse(event).success).toBe(true);
    }
  });

  it("pins staleness triggers separately from lifecycle events", () => {
    expect(CLAIM_STALENESS_TRIGGERS).toEqual([
      "layout_snapshot_changed",
      "venue_runtime_package_changed",
      "scene_authority_map_changed",
      "policy_bundle_changed",
      "capture_session_superseded",
      "proof_object_superseded",
      "verification_expiry_reached",
      "manual_contestation",
    ]);

    expect(overlap(CLAIM_STALENESS_TRIGGERS, CLAIM_LIFECYCLE_EVENTS)).toEqual([]);
    expect(ClaimStalenessTriggerSchema.safeParse("layout_snapshot_changed").success).toBe(true);
    expect(ClaimStalenessTriggerSchema.safeParse("layout_changed").success).toBe(false);
  });

  it("pins regeneration decisions for stale claim handling", () => {
    expect(CLAIM_REGENERATION_DECISIONS).toEqual([
      "regenerate_automatically",
      "queue_human_review",
      "preserve_stale",
      "mark_contested",
      "create_new_claim_version",
      "mark_superseded",
      "unsupported",
    ]);

    for (const decision of CLAIM_REGENERATION_DECISIONS) {
      expect(ClaimRegenerationDecisionSchema.safeParse(decision).success).toBe(true);
    }
  });

  it("pins actor and source categories for lifecycle audit events", () => {
    expect(CLAIM_LIFECYCLE_ACTOR_CATEGORIES).toEqual([
      "user",
      "venue_staff",
      "hallkeeper",
      "reviewer",
      "validator",
      "system",
      "capture_pipeline",
      "runtime_pipeline",
      "policy_engine",
      "import_job",
      "external_tool",
    ]);

    expect(CLAIM_LIFECYCLE_SOURCE_CATEGORIES).toEqual([
      "capture_session",
      "runtime_package",
      "scene_authority_map",
      "layout_snapshot",
      "policy_bundle",
      "proof_object",
      "evidence_pack",
      "validator_output",
      "human_review_record",
      "user_report",
      "external_source",
    ]);

    expect(ClaimLifecycleActorCategorySchema.safeParse("reviewer").success).toBe(true);
    expect(ClaimLifecycleSourceCategorySchema.safeParse("runtime_package").success).toBe(true);
    expect(ClaimLifecycleActorCategorySchema.safeParse("runtime_package").success).toBe(false);
    expect(ClaimLifecycleSourceCategorySchema.safeParse("reviewer").success).toBe(false);
  });

  it("keeps lifecycle states separate from Truth Mode source and Layout Proof status values", () => {
    expect(ClaimLifecycleStateSchema.safeParse("scan_observed").success).toBe(false);
    expect(ClaimLifecycleStateSchema.safeParse("pass").success).toBe(false);
    expect(TruthEvidenceSourceStateSchema.safeParse("published").success).toBe(false);
    expect(LayoutProofClaimStatusSchema.safeParse("published").success).toBe(false);

    expect(overlap(CLAIM_LIFECYCLE_STATES, TRUTH_EVIDENCE_SOURCE_STATES)).toEqual([]);
    expect(overlap(CLAIM_LIFECYCLE_STATES, LAYOUT_PROOF_CLAIM_STATUSES)).toEqual(["stale"]);
    expect(overlap(CLAIM_LIFECYCLE_STATES, TRUTH_VERIFICATION_STATES)).toEqual([
      "verified",
      "contested",
      "expired",
    ]);
    expect(TruthVerificationStateSchema.safeParse("published").success).toBe(false);
  });

  it("does not encode lifecycle events as current claim states", () => {
    expect(ClaimLifecycleStateSchema.safeParse("claim_published").success).toBe(false);
    expect(ClaimLifecycleEventSchema.safeParse("published").success).toBe(false);
    expect(ClaimLifecycleStateSchema.safeParse("capture_ingested").success).toBe(false);
  });

  it("uses metadata-only string vocabularies", () => {
    const vocabularies = [
      CLAIM_LIFECYCLE_STATES,
      CLAIM_LIFECYCLE_EVENTS,
      CLAIM_STALENESS_TRIGGERS,
      CLAIM_REGENERATION_DECISIONS,
      CLAIM_LIFECYCLE_ACTOR_CATEGORIES,
      CLAIM_LIFECYCLE_SOURCE_CATEGORIES,
    ] as const;

    for (const vocabulary of vocabularies) {
      expect(vocabulary.every((value) => typeof value === "string")).toBe(true);
      expect(new Set(vocabulary).size).toBe(vocabulary.length);
    }
  });
});
