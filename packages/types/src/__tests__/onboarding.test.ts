import { describe, expect, it } from "vitest";
import {
  CreateManagedOnboardingSchema,
  VENUE_INVITATION_ROLES,
  WorkspaceEntitlementInputSchema,
  WorkspaceEntitlementSchema,
} from "../onboarding.js";

const NOW = "2026-06-15T12:00:00.000Z";

describe("onboarding contracts", () => {
  it("creates a managed onboarding package without granting platform admin", () => {
    const parsed = CreateManagedOnboardingSchema.parse({
      organisationName: "Trades Hall Trust",
      workspaceName: "Trades Hall deployment",
      venue: {
        name: "Trades Hall Glasgow",
        slug: "trades-hall-glasgow",
        address: "85 Glassford Street, Glasgow G1 1UH",
      },
      ownerInvite: {
        email: "owner@tradeshall.co.uk",
      },
      staffInvites: [
        { email: "events@tradeshall.co.uk", workspaceRole: "staff", venueRole: "staff" },
      ],
      entitlement: {
        planKey: "managed_deployment",
        billingProvider: "none",
      },
    });

    expect(parsed.ownerInvite.workspaceRole).toBe("owner");
    expect(parsed.ownerInvite.venueRole).toBe("staff");
    expect(VENUE_INVITATION_ROLES).not.toContain("admin");
  });

  it("rejects access enforcement until provider verification evidence exists", () => {
    const result = WorkspaceEntitlementInputSchema.safeParse({
      planKey: "managed_deployment",
      billingProvider: "stripe",
      providerVerified: false,
      accessEnforced: true,
    });

    expect(result.success).toBe(false);
  });

  it("requires provider evidence before accepting verified billing state", () => {
    const result = WorkspaceEntitlementInputSchema.safeParse({
      planKey: "managed_deployment",
      billingProvider: "stripe",
      providerVerified: true,
      accessEnforced: false,
    });

    expect(result.success).toBe(false);

    const verified = WorkspaceEntitlementInputSchema.parse({
      planKey: "managed_deployment",
      billingProvider: "manual_invoice",
      providerEvidenceRef: "invoice-2026-001",
      providerVerified: true,
      accessEnforced: true,
    });
    expect(verified.accessEnforced).toBe(true);
  });

  it("rejects duplicate owner and staff invitation emails", () => {
    const result = CreateManagedOnboardingSchema.safeParse({
      organisationName: "Trades Hall Trust",
      venue: {
        name: "Trades Hall Glasgow",
        slug: "trades-hall-glasgow",
        address: "85 Glassford Street, Glasgow G1 1UH",
      },
      ownerInvite: {
        email: "owner@tradeshall.co.uk",
      },
      staffInvites: [
        { email: "OWNER@tradeshall.co.uk", workspaceRole: "staff", venueRole: "staff" },
      ],
      entitlement: {
        planKey: "managed_deployment",
      },
    });

    expect(result.success).toBe(false);
  });

  it("keeps persisted entitlements coherent with access enforcement", () => {
    const invalid = WorkspaceEntitlementSchema.safeParse({
      id: "00000000-0000-4000-8000-000000000001",
      workspaceId: "00000000-0000-4000-8000-000000000002",
      planKey: "managed_deployment",
      status: "active",
      billingProvider: "stripe",
      providerCustomerRef: "cus_test",
      providerEntitlementRef: null,
      providerEvidenceRef: null,
      providerVerificationStatus: "pending",
      providerVerifiedAt: null,
      accessEnforced: true,
      createdBy: null,
      createdAt: NOW,
      updatedAt: NOW,
    });

    expect(invalid.success).toBe(false);
  });
});
