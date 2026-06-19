import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OnboardingView } from "../OnboardingView.js";

const mocks = vi.hoisted(() => ({
  createManagedOnboarding: vi.fn(),
  getOnboardingSummary: vi.fn(),
  inviteWorkspaceMembers: vi.fn(),
  updateOnboardingProject: vi.fn(),
  verifyWorkspaceEntitlement: vi.fn(),
  addToast: vi.fn(),
}));

vi.mock("../../../api/onboarding.js", () => ({
  createManagedOnboarding: mocks.createManagedOnboarding,
  getOnboardingSummary: mocks.getOnboardingSummary,
  inviteWorkspaceMembers: mocks.inviteWorkspaceMembers,
  updateOnboardingProject: mocks.updateOnboardingProject,
  verifyWorkspaceEntitlement: mocks.verifyWorkspaceEntitlement,
}));

vi.mock("../../../stores/toast-store.js", () => ({
  useToastStore: (selector: (state: { addToast: typeof mocks.addToast }) => unknown): unknown =>
    selector({ addToast: mocks.addToast }),
}));

const NOW = "2026-06-15T12:00:00.000Z";

function emptySummary(): Record<string, unknown> {
  return {
    organisations: [],
    workspaces: [],
    venues: [],
    memberships: [],
    projects: [],
    entitlements: [],
    auditEvents: [],
  };
}

function populatedSummary(): Record<string, unknown> {
  const organisationId = "00000000-0000-4000-8000-000000000001";
  const workspaceId = "00000000-0000-4000-8000-000000000002";
  const venueId = "00000000-0000-4000-8000-000000000003";
  return {
    organisations: [{
      id: organisationId,
      name: "Trades Hall Trust",
      status: "onboarding",
      createdBy: null,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    }],
    workspaces: [{
      id: workspaceId,
      organisationId,
      primaryVenueId: venueId,
      name: "Trades Hall rollout",
      status: "onboarding",
      createdBy: null,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    }],
    venues: [{
      id: venueId,
      name: "Trades Hall Glasgow",
      slug: "trades-hall-glasgow",
      address: "85 Glassford Street, Glasgow G1 1UH",
      logoUrl: null,
      brandColour: null,
      timezone: "Europe/London",
      createdAt: NOW,
      updatedAt: NOW,
    }],
    memberships: [{
      id: "00000000-0000-4000-8000-000000000004",
      workspaceId,
      userId: null,
      invitationId: "00000000-0000-4000-8000-000000000005",
      email: "owner@tradeshall.co.uk",
      role: "owner",
      venueRole: "staff",
      status: "invited",
      invitedBy: null,
      acceptedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    }],
    projects: [{
      id: "00000000-0000-4000-8000-000000000006",
      workspaceId,
      venueId,
      status: "admin_invite",
      currentStep: "Workspace owner invitation is pending acceptance.",
      operatorReviewState: "pending_review",
      evidenceNote: "Operator review required.",
      createdBy: null,
      createdAt: NOW,
      updatedAt: NOW,
      completedAt: null,
    }],
    entitlements: [{
      id: "00000000-0000-4000-8000-000000000007",
      workspaceId,
      planKey: "managed_deployment",
      status: "pending_provider_verification",
      billingProvider: "none",
      providerCustomerRef: null,
      providerEntitlementRef: null,
      providerEvidenceRef: null,
      providerVerificationStatus: "not_required",
      providerVerifiedAt: null,
      accessEnforced: false,
      createdBy: null,
      createdAt: NOW,
      updatedAt: NOW,
    }],
    auditEvents: [],
  };
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.getOnboardingSummary.mockResolvedValue(emptySummary());
  mocks.createManagedOnboarding.mockResolvedValue({});
  mocks.inviteWorkspaceMembers.mockResolvedValue({ memberships: [] });
  mocks.updateOnboardingProject.mockResolvedValue({});
  mocks.verifyWorkspaceEntitlement.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
});

describe("OnboardingView", () => {
  it("renders workspace onboarding metrics and provider gate state", async () => {
    mocks.getOnboardingSummary.mockResolvedValue(populatedSummary());
    render(<OnboardingView />);

    expect(await screen.findByText("Workspace onboarding")).toBeTruthy();
    expect(screen.getAllByText("Trades Hall rollout").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Provider verification")).toBeTruthy();
    expect(document.body.textContent ?? "").toContain("Provider-verified only");
  });

  it("submits a managed onboarding package with owner and staff invitations", async () => {
    render(<OnboardingView />);

    await screen.findByText("No managed workspaces have been created yet.");
    fireEvent.change(screen.getByTestId("organisation-name"), { target: { value: "Trades Hall Trust" } });
    fireEvent.change(screen.getByTestId("venue-name"), { target: { value: "Trades Hall Glasgow" } });
    fireEvent.change(screen.getByTestId("venue-address"), { target: { value: "85 Glassford Street, Glasgow G1 1UH" } });
    fireEvent.change(screen.getByTestId("owner-email"), { target: { value: "owner@tradeshall.co.uk" } });
    fireEvent.change(screen.getByTestId("staff-emails"), { target: { value: "events@tradeshall.co.uk\nops@tradeshall.co.uk" } });

    fireEvent.click(screen.getByTestId("create-onboarding-workspace"));

    await waitFor(() => {
      expect(mocks.createManagedOnboarding).toHaveBeenCalledWith({
        organisationName: "Trades Hall Trust",
        workspaceName: undefined,
        venue: {
          name: "Trades Hall Glasgow",
          slug: "trades-hall-glasgow",
          address: "85 Glassford Street, Glasgow G1 1UH",
          logoUrl: null,
          brandColour: null,
          timezone: "Europe/London",
        },
        ownerInvite: {
          email: "owner@tradeshall.co.uk",
          workspaceRole: "owner",
          venueRole: "staff",
        },
        staffInvites: [
          { email: "events@tradeshall.co.uk", workspaceRole: "staff", venueRole: "staff" },
          { email: "ops@tradeshall.co.uk", workspaceRole: "staff", venueRole: "staff" },
        ],
        entitlement: {
          planKey: "managed_deployment",
          billingProvider: "none",
          providerCustomerRef: null,
          providerEntitlementRef: null,
          providerEvidenceRef: null,
          providerVerified: false,
          accessEnforced: false,
        },
        operatorReviewNote: "Operator review required before deployment is marked ready.",
      });
    });
  });

  it("shows onboarding load failures and retries without trapping the admin", async () => {
    mocks.getOnboardingSummary
      .mockRejectedValueOnce(new Error("Onboarding API offline"))
      .mockResolvedValueOnce(emptySummary());

    render(<OnboardingView />);

    expect(await screen.findByText("Onboarding unavailable")).toBeTruthy();
    expect(screen.getByText("Onboarding API offline")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Retry/i }));

    expect(await screen.findByText("No managed workspaces have been created yet.")).toBeTruthy();
  });

  it("invites additional staff from an existing workspace action card", async () => {
    mocks.getOnboardingSummary.mockResolvedValue(populatedSummary());
    render(<OnboardingView />);

    await screen.findByText("Operator action board");
    fireEvent.change(screen.getByLabelText("Invite staff for Trades Hall rollout"), {
      target: { value: "planner@tradeshall.co.uk\nops@tradeshall.co.uk\nplanner@tradeshall.co.uk" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send 2 invite(s)" }));

    await waitFor(() => {
      expect(mocks.inviteWorkspaceMembers).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000002",
        {
          staffInvites: [
            { email: "planner@tradeshall.co.uk", workspaceRole: "staff", venueRole: "staff" },
            { email: "ops@tradeshall.co.uk", workspaceRole: "staff", venueRole: "staff" },
          ],
        },
      );
    });
    expect(mocks.addToast).toHaveBeenCalledWith("2 staff invitation(s) recorded", "success");
  });

  it("updates deployment review and provider gates through real onboarding APIs", async () => {
    mocks.getOnboardingSummary.mockResolvedValue(populatedSummary());
    render(<OnboardingView />);

    await screen.findByText("Operator action board");

    fireEvent.change(screen.getByLabelText("Project status for Trades Hall rollout"), {
      target: { value: "ready" },
    });
    fireEvent.change(screen.getByLabelText("Operator review for Trades Hall rollout"), {
      target: { value: "approved" },
    });
    fireEvent.change(screen.getByLabelText("Current step for Trades Hall rollout"), {
      target: { value: "Ready for staff handoff." },
    });
    fireEvent.change(screen.getByLabelText("Evidence note for Trades Hall rollout"), {
      target: { value: "Owner accepted and staff invite list reviewed." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save project gate for Trades Hall rollout" }));

    await waitFor(() => {
      expect(mocks.updateOnboardingProject).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000006",
        {
          status: "ready",
          operatorReviewState: "approved",
          currentStep: "Ready for staff handoff.",
          evidenceNote: "Owner accepted and staff invite list reviewed.",
        },
      );
    });

    fireEvent.change(screen.getByLabelText("Billing provider for Trades Hall rollout"), {
      target: { value: "manual_invoice" },
    });
    fireEvent.change(screen.getByLabelText("Provider status for Trades Hall rollout"), {
      target: { value: "provider_verified" },
    });
    fireEvent.change(screen.getByLabelText("Provider evidence reference for Trades Hall rollout"), {
      target: { value: "invoice-2026-001" },
    });
    fireEvent.click(screen.getByLabelText("Enforce managed access for Trades Hall rollout"));
    fireEvent.click(screen.getByRole("button", { name: "Save provider gate for Trades Hall rollout" }));

    await waitFor(() => {
      expect(mocks.verifyWorkspaceEntitlement).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000007",
        {
          billingProvider: "manual_invoice",
          providerVerificationStatus: "provider_verified",
          providerCustomerRef: null,
          providerEntitlementRef: null,
          providerEvidenceRef: "invoice-2026-001",
          accessEnforced: true,
        },
      );
    });
  });

  it("keeps provider verification blocked until evidence and provider are present", async () => {
    mocks.getOnboardingSummary.mockResolvedValue(populatedSummary());
    render(<OnboardingView />);

    await screen.findByText("Operator action board");
    fireEvent.change(screen.getByLabelText("Provider status for Trades Hall rollout"), {
      target: { value: "provider_verified" },
    });

    expect(screen.getByText("Verified provider state requires a real provider plus at least one evidence reference.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save provider gate for Trades Hall rollout" })).toHaveProperty("disabled", true);
  });
});
