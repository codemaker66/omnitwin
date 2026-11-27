import { describe, expect, it } from "vitest";
import {
  EventArchitectOpsReviewArtifactSchema,
  EventArchitectOpsReviewerAuthoritySchema,
} from "../event-architect.js";
import {
  EVENT_ARCHITECT_OPS_REVIEW_AUTHORITY_BY_ROLE,
  EVENT_ARCHITECT_OPS_REVIEW_ROLES,
  eventArchitectOpsReviewerAuthorityFor,
} from "../event-architect-ops-reviewers.js";
import { USER_ROLES } from "../user.js";

// Managers record Event Architect Ops reviews too (Blake, 11 November 2026:
// "Yes, managers too"), under their own authority. The API's gate and the
// web's offer of the form both read this list.

describe("who records an Event Architect Ops review", () => {
  it("is the venue's staff, hallkeepers, managers and administrators, each under its own authority", () => {
    expect(EVENT_ARCHITECT_OPS_REVIEW_AUTHORITY_BY_ROLE).toEqual({
      staff: "venue_staff",
      hallkeeper: "venue_hallkeeper",
      manager: "venue_manager",
      admin: "venue_admin",
    });
    expect([...EVENT_ARCHITECT_OPS_REVIEW_ROLES].sort())
      .toEqual(Object.keys(EVENT_ARCHITECT_OPS_REVIEW_AUTHORITY_BY_ROLE).sort());
  });

  it("answers every user role, and only the listed ones with an authority", () => {
    const byRole: Readonly<Record<string, string>> = EVENT_ARCHITECT_OPS_REVIEW_AUTHORITY_BY_ROLE;
    for (const role of [...USER_ROLES, "owner", "executive", "supplier", ""]) {
      expect(eventArchitectOpsReviewerAuthorityFor(role), role).toBe(byRole[role] ?? null);
    }
    expect(eventArchitectOpsReviewerAuthorityFor("manager")).toBe("venue_manager");
    for (const refused of ["sales", "caterer", "planner", "client", "toString", "constructor"]) {
      expect(eventArchitectOpsReviewerAuthorityFor(refused), refused).toBeNull();
    }
  });

  it("stores no authority the schema does not know, and leaves only the platform's to a platform admin", () => {
    const venueAuthorities = Object.values(EVENT_ARCHITECT_OPS_REVIEW_AUTHORITY_BY_ROLE);
    expect([...venueAuthorities, "platform_admin"].sort())
      .toEqual([...EventArchitectOpsReviewerAuthoritySchema.options].sort());
  });

  it("reads back a review a manager recorded, and no authority outside the list", () => {
    const digest = (letter: string): string => letter.repeat(64);
    const artifact = {
      schemaVersion: "venviewer.event-architect-ops-review.v0",
      artifactId: "00000000-0000-4000-8000-000000000101",
      artifactDigest: digest("f"),
      candidateId: "00000000-0000-4000-8000-000000000102",
      runId: "00000000-0000-4000-8000-000000000103",
      venueId: "00000000-0000-4000-8000-000000000104",
      configurationId: "00000000-0000-4000-8000-000000000105",
      decision: "approved",
      reviewerUserId: "00000000-0000-4000-8000-000000000106",
      reviewerAuthority: "venue_manager",
      requestDigest: digest("a"),
      snapshotDigest: digest("b"),
      proofDigest: digest("c"),
      guestFlowArtifactHash: digest("d"),
      witnesses: (["surveyed_door_positions", "reviewed_route_model", "venue_operations_signoff"] as const).map((kind) => ({
        kind, sourceLabel: "Survey", sourceReference: "fixture://survey", contentDigest: digest("e"),
        observedAt: "2026-11-10T09:00:00.000Z",
      })),
      note: "Doors surveyed and routes walked.",
      reviewedAt: "2026-11-11T09:00:00.000Z",
      validUntil: "2026-11-18T09:00:00.000Z",
    };
    expect(EventArchitectOpsReviewArtifactSchema.parse(artifact).reviewerAuthority).toBe("venue_manager");
    expect(EventArchitectOpsReviewArtifactSchema.safeParse({ ...artifact, reviewerAuthority: "venue_sales" }).success).toBe(false);
  });
});
