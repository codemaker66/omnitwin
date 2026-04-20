import { describe, it, expect } from "vitest";
import {
  CONFIGURATION_REVIEW_STATUSES,
  ConfigurationReviewStatusSchema,
  VALID_CONFIGURATION_REVIEW_TRANSITIONS,
  isValidConfigurationReviewTransition,
  isTerminalReviewStatus,
  isPlannerEditable,
  ReviewHistoryEntrySchema,
  type ConfigurationReviewStatus,
} from "../configuration-review.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_UUID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const VALID_CONFIG_UUID = "d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f80";
const VALID_USER_UUID = "e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8091";
const VALID_DATETIME = "2026-04-18T12:00:00.000Z";

// ---------------------------------------------------------------------------
// CONFIGURATION_REVIEW_STATUSES + ConfigurationReviewStatusSchema
// ---------------------------------------------------------------------------

describe("CONFIGURATION_REVIEW_STATUSES", () => {
  it("has exactly 8 statuses in a stable order", () => {
    expect(CONFIGURATION_REVIEW_STATUSES).toEqual([
      "draft",
      "submitted",
      "under_review",
      "approved",
      "rejected",
      "changes_requested",
      "withdrawn",
      "archived",
    ]);
  });
});

describe("ConfigurationReviewStatusSchema", () => {
  it.each(CONFIGURATION_REVIEW_STATUSES)("accepts '%s'", (status) => {
    expect(ConfigurationReviewStatusSchema.safeParse(status).success).toBe(true);
  });

  it("rejects 'Submitted' (case sensitive)", () => {
    expect(ConfigurationReviewStatusSchema.safeParse("Submitted").success).toBe(false);
  });

  it("rejects legacy enquiry statuses not valid here", () => {
    expect(ConfigurationReviewStatusSchema.safeParse("viewed").success).toBe(false);
    expect(ConfigurationReviewStatusSchema.safeParse("converted").success).toBe(false);
    expect(ConfigurationReviewStatusSchema.safeParse("lost").success).toBe(false);
  });

  it("rejects empty string and null", () => {
    expect(ConfigurationReviewStatusSchema.safeParse("").success).toBe(false);
    expect(ConfigurationReviewStatusSchema.safeParse(null).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// VALID_CONFIGURATION_REVIEW_TRANSITIONS — structure
// ---------------------------------------------------------------------------

describe("VALID_CONFIGURATION_REVIEW_TRANSITIONS", () => {
  it("defines transitions for all 8 statuses", () => {
    expect(Object.keys(VALID_CONFIGURATION_REVIEW_TRANSITIONS)).toHaveLength(8);
  });

  it("draft can only → submitted", () => {
    expect(VALID_CONFIGURATION_REVIEW_TRANSITIONS.draft).toEqual(["submitted"]);
  });

  it("submitted can → under_review | withdrawn", () => {
    expect(VALID_CONFIGURATION_REVIEW_TRANSITIONS.submitted).toEqual(
      ["under_review", "withdrawn"],
    );
  });

  it("under_review can → approved | rejected | changes_requested | withdrawn", () => {
    expect(VALID_CONFIGURATION_REVIEW_TRANSITIONS.under_review).toEqual(
      ["approved", "rejected", "changes_requested", "withdrawn"],
    );
  });

  it("changes_requested can → draft | withdrawn", () => {
    expect(VALID_CONFIGURATION_REVIEW_TRANSITIONS.changes_requested).toEqual(
      ["draft", "withdrawn"],
    );
  });

  it("approved can only → archived", () => {
    expect(VALID_CONFIGURATION_REVIEW_TRANSITIONS.approved).toEqual(["archived"]);
  });

  it("rejected can → draft | archived", () => {
    expect(VALID_CONFIGURATION_REVIEW_TRANSITIONS.rejected).toEqual(["draft", "archived"]);
  });

  it("withdrawn is terminal", () => {
    expect(VALID_CONFIGURATION_REVIEW_TRANSITIONS.withdrawn).toEqual([]);
  });

  it("archived is terminal", () => {
    expect(VALID_CONFIGURATION_REVIEW_TRANSITIONS.archived).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// isValidConfigurationReviewTransition
// ---------------------------------------------------------------------------

describe("isValidConfigurationReviewTransition", () => {
  it("accepts the full happy path draft → submitted → under_review → approved → archived", () => {
    expect(isValidConfigurationReviewTransition("draft", "submitted")).toBe(true);
    expect(isValidConfigurationReviewTransition("submitted", "under_review")).toBe(true);
    expect(isValidConfigurationReviewTransition("under_review", "approved")).toBe(true);
    expect(isValidConfigurationReviewTransition("approved", "archived")).toBe(true);
  });

  it("accepts the re-open loop under_review → changes_requested → draft → submitted", () => {
    expect(isValidConfigurationReviewTransition("under_review", "changes_requested")).toBe(true);
    expect(isValidConfigurationReviewTransition("changes_requested", "draft")).toBe(true);
    expect(isValidConfigurationReviewTransition("draft", "submitted")).toBe(true);
  });

  it("accepts rejection loop under_review → rejected → draft", () => {
    expect(isValidConfigurationReviewTransition("under_review", "rejected")).toBe(true);
    expect(isValidConfigurationReviewTransition("rejected", "draft")).toBe(true);
  });

  it("rejects skipping submitted (draft → approved)", () => {
    expect(isValidConfigurationReviewTransition("draft", "approved")).toBe(false);
  });

  it("rejects skipping under_review (submitted → approved)", () => {
    expect(isValidConfigurationReviewTransition("submitted", "approved")).toBe(false);
  });

  it("rejects self-transitions", () => {
    for (const s of CONFIGURATION_REVIEW_STATUSES) {
      expect(isValidConfigurationReviewTransition(s, s)).toBe(false);
    }
  });

  it("rejects backward transitions from approved", () => {
    expect(isValidConfigurationReviewTransition("approved", "under_review")).toBe(false);
    expect(isValidConfigurationReviewTransition("approved", "draft")).toBe(false);
  });

  it("rejects any transition from withdrawn (terminal)", () => {
    for (const s of CONFIGURATION_REVIEW_STATUSES) {
      expect(isValidConfigurationReviewTransition("withdrawn", s)).toBe(false);
    }
  });

  it("rejects any transition from archived (terminal)", () => {
    for (const s of CONFIGURATION_REVIEW_STATUSES) {
      expect(isValidConfigurationReviewTransition("archived", s)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// isTerminalReviewStatus
// ---------------------------------------------------------------------------

describe("isTerminalReviewStatus", () => {
  it("returns true for withdrawn and archived", () => {
    expect(isTerminalReviewStatus("withdrawn")).toBe(true);
    expect(isTerminalReviewStatus("archived")).toBe(true);
  });

  it("returns false for all active statuses", () => {
    const active: ConfigurationReviewStatus[] = [
      "draft", "submitted", "under_review",
      "approved", "rejected", "changes_requested",
    ];
    for (const s of active) {
      expect(isTerminalReviewStatus(s)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// isPlannerEditable
// ---------------------------------------------------------------------------

describe("isPlannerEditable", () => {
  it("returns true for draft, changes_requested, rejected", () => {
    expect(isPlannerEditable("draft")).toBe(true);
    expect(isPlannerEditable("changes_requested")).toBe(true);
    expect(isPlannerEditable("rejected")).toBe(true);
  });

  it("returns false for submitted, under_review, approved, withdrawn, archived", () => {
    expect(isPlannerEditable("submitted")).toBe(false);
    expect(isPlannerEditable("under_review")).toBe(false);
    expect(isPlannerEditable("approved")).toBe(false);
    expect(isPlannerEditable("withdrawn")).toBe(false);
    expect(isPlannerEditable("archived")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ReviewHistoryEntrySchema
// ---------------------------------------------------------------------------

describe("ReviewHistoryEntrySchema", () => {
  const valid = {
    id: VALID_UUID,
    configurationId: VALID_CONFIG_UUID,
    fromStatus: "submitted" as const,
    toStatus: "under_review" as const,
    changedByName: "Catherine Tait",
    note: null,
    createdAt: VALID_DATETIME,
  };

  it("accepts a minimal valid entry", () => {
    expect(ReviewHistoryEntrySchema.safeParse(valid).success).toBe(true);
  });

  it("accepts a null changedByName (system-automatic transition or deleted user)", () => {
    expect(ReviewHistoryEntrySchema.safeParse({ ...valid, changedByName: null }).success).toBe(true);
  });

  it("rejects a payload missing changedByName — guards against regression to raw UUID exposure", () => {
    const stale = {
      id: VALID_UUID,
      configurationId: VALID_CONFIG_UUID,
      fromStatus: "submitted" as const,
      toStatus: "under_review" as const,
      changedBy: VALID_USER_UUID,
      note: null,
      createdAt: VALID_DATETIME,
    };
    expect(ReviewHistoryEntrySchema.safeParse(stale).success).toBe(false);
  });

  it("accepts a note string", () => {
    expect(ReviewHistoryEntrySchema.safeParse({
      ...valid,
      note: "Staff flagged fire-exit violation — please rework aisles",
    }).success).toBe(true);
  });

  it("rejects non-UUID id", () => {
    expect(ReviewHistoryEntrySchema.safeParse({ ...valid, id: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects invalid fromStatus", () => {
    expect(ReviewHistoryEntrySchema.safeParse({
      ...valid,
      fromStatus: "pending",
    }).success).toBe(false);
  });

  it("rejects non-ISO createdAt", () => {
    expect(ReviewHistoryEntrySchema.safeParse({
      ...valid,
      createdAt: "yesterday",
    }).success).toBe(false);
  });
});
