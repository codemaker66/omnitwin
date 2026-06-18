import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import { z } from "zod";
import {
  onboardingAuditEvents,
  onboardingProjects,
  organisations,
  workspaceEntitlements,
  workspaceMemberships,
  workspaces,
} from "../db/schema.js";

const migrationSql = readFileSync(
  fileURLToPath(new URL("../../drizzle/0037_onboarding_entitlements.sql", import.meta.url)),
  "utf8",
);

const journalRaw = readFileSync(
  fileURLToPath(new URL("../../drizzle/meta/_journal.json", import.meta.url)),
  "utf8",
);

const JournalSchema = z.object({
  entries: z.array(z.object({ idx: z.number().int(), tag: z.string() })),
});
describe("onboarding Drizzle schema", () => {
  it("exposes organisation, workspace, membership, entitlement, project, and audit tables", () => {
    expect(getTableName(organisations)).toBe("organisations");
    expect(getTableName(workspaces)).toBe("workspaces");
    expect(getTableName(workspaceMemberships)).toBe("workspace_memberships");
    expect(getTableName(onboardingProjects)).toBe("onboarding_projects");
    expect(getTableName(workspaceEntitlements)).toBe("workspace_entitlements");
    expect(getTableName(onboardingAuditEvents)).toBe("onboarding_audit_events");
  });

  it("keeps workspace records linked back to the venue authorization boundary", () => {
    const workspaceCols = getTableColumns(workspaces);
    const membershipCols = getTableColumns(workspaceMemberships);
    expect(workspaceCols.primaryVenueId.name).toBe("primary_venue_id");
    expect(membershipCols.venueRole.name).toBe("venue_role");
    expect(membershipCols.invitationId.name).toBe("invitation_id");
  });

  it("stores entitlement access enforcement as an explicit boolean gate", () => {
    const cols = getTableColumns(workspaceEntitlements);
    expect(cols.accessEnforced.getSQLType()).toBe("boolean");
    expect(cols.providerVerificationStatus.name).toBe("provider_verification_status");
    expect(cols.providerVerifiedAt.name).toBe("provider_verified_at");
  });
});

describe("migration 0037_onboarding_entitlements", () => {
  it("creates all onboarding foundation tables idempotently", () => {
    for (const table of [
      "organisations",
      "workspaces",
      "workspace_memberships",
      "onboarding_projects",
      "workspace_entitlements",
      "onboarding_audit_events",
    ]) {
      expect(migrationSql).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
    }
  });

  it("guards customer roles and provider-verified access control", () => {
    expect(migrationSql).toContain('"workspace_memberships_venue_role_check"');
    expect(migrationSql).toContain("'staff', 'hallkeeper', 'planner', 'client'");
    expect(migrationSql).toContain('"workspace_entitlements_provider_ref_gate"');
    expect(migrationSql).toContain('"workspace_entitlements_access_provider_verified"');
    expect(migrationSql).toContain('"access_enforced" = false');
    expect(migrationSql).toContain('"provider_verification_status" = \'provider_verified\'');
  });

  it("is registered after the runtime asset extension migration", () => {
    const parsed: unknown = JSON.parse(journalRaw);
    const journal = JournalSchema.parse(parsed);
    const tags = journal.entries.map((entry) => entry.tag);
    expect(tags.indexOf("0037_onboarding_entitlements")).toBeGreaterThan(tags.indexOf("0036_runtime_asset_sog_lcc2_extensions"));
  });
});
