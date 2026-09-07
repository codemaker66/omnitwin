import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OnboardingView } from "../OnboardingView.js";
import type { OnboardingSummary } from "@omnitwin/types";

const mocks = vi.hoisted(() => ({
  createManagedOnboarding: vi.fn(),
  getOnboardingSummary: vi.fn(),
  inviteWorkspaceMembers: vi.fn(),
  revokeWorkspaceInvitation: vi.fn(),
  updateOnboardingProject: vi.fn(),
  verifyWorkspaceEntitlement: vi.fn(),
  addToast: vi.fn(),
}));

vi.mock("../../../api/onboarding.js", () => ({
  createManagedOnboarding: mocks.createManagedOnboarding,
  getOnboardingSummary: mocks.getOnboardingSummary,
  inviteWorkspaceMembers: mocks.inviteWorkspaceMembers,
  revokeWorkspaceInvitation: mocks.revokeWorkspaceInvitation,
  updateOnboardingProject: mocks.updateOnboardingProject,
  verifyWorkspaceEntitlement: mocks.verifyWorkspaceEntitlement,
}));

vi.mock("../../../stores/toast-store.js", () => ({
  useToastStore: (selector: (state: { addToast: typeof mocks.addToast }) => unknown): unknown =>
    selector({ addToast: mocks.addToast }),
}));

const NOW = "2026-06-15T12:00:00.000Z";

function emptySummary(): OnboardingSummary {
  return {
    organisations: [],
    workspaces: [],
    venues: [],
    memberships: [],
    projects: [],
    entitlements: [],
    auditEvents: [],
    invitations: [],
  };
}

function populatedSummary(): OnboardingSummary {
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
    invitations: [{ id: "00000000-0000-4000-8000-000000000005", email: "owner@tradeshall.co.uk", venueId,
      role: "staff", status: "pending", expiresAt: "2099-01-01T00:00:00.000Z", acceptedAt: null, acceptedBy: null }],
  };
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.getOnboardingSummary.mockResolvedValue(emptySummary());
  const data = populatedSummary();
  mocks.createManagedOnboarding.mockResolvedValue({ organisation: data.organisations[0], workspace: data.workspaces[0], venue: data.venues[0],
    ownerMembership: data.memberships[0], staffMemberships: [], project: data.projects[0], entitlement: data.entitlements[0] });
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

    expect(await screen.findByText("Clients & access")).toBeTruthy();
    await screen.findByText("People & access");
    expect(screen.getAllByText("Trades Hall rollout").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Provider verification")).toBeTruthy();
    expect(document.body.textContent ?? "").toContain("No email is sent automatically");
  });

  it("submits a managed onboarding package with owner and staff invitations", async () => {
    render(<OnboardingView />);

    await screen.findByText("A venue and its first administrator.");
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
          name: null,
          workspaceRole: "owner",
          venueRole: "admin",
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
        operatorReviewNote: "Review client setup before marking onboarding complete.",
      });
    });
  });

  it("shows onboarding load failures and retries without trapping the admin", async () => {
    mocks.getOnboardingSummary
      .mockRejectedValueOnce(new Error("Onboarding API offline"))
      .mockResolvedValueOnce(emptySummary());

    render(<OnboardingView />);

    expect(await screen.findByText("Client workspaces are unavailable.")).toBeTruthy();
    expect(screen.getByText("Onboarding API offline")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Retry/i }));

    expect(await screen.findByText("A venue and its first administrator.")).toBeTruthy();
  });

  it("invites additional staff from an existing workspace action card", async () => {
    mocks.getOnboardingSummary.mockResolvedValue(populatedSummary());
    render(<OnboardingView />);

    await screen.findByText("People & access");
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "planner@tradeshall.co.uk" } });
    fireEvent.change(screen.getByLabelText("Venue role"), { target: { value: "planner" } });
    fireEvent.click(screen.getByRole("button", { name: "Grant venue access" }));

    await waitFor(() => {
      expect(mocks.inviteWorkspaceMembers).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000002",
        {
          staffInvites: [
            { email: "planner@tradeshall.co.uk", name: null, workspaceRole: "planner", venueRole: "planner" },
          ],
        },
      );
    });
    expect(await screen.findByText(/Access recorded for planner@tradeshall.co.uk/)).toBeTruthy();
  });

  it("updates deployment review and provider gates through real onboarding APIs", async () => {
    mocks.getOnboardingSummary.mockResolvedValue(populatedSummary());
    render(<OnboardingView />);

    await screen.findByText("People & access");
    fireEvent.click(screen.getByText("Setup review and billing"));

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

    await screen.findByText("People & access");
    fireEvent.click(screen.getByText("Setup review and billing"));
    fireEvent.change(screen.getByLabelText("Provider status for Trades Hall rollout"), {
      target: { value: "provider_verified" },
    });

    expect(screen.getByText("Verified provider state requires a real provider plus at least one evidence reference.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save provider gate for Trades Hall rollout" })).toHaveProperty("disabled", true);
  });

  it("links an existing venue and grants its first administrator without creating another venue", async () => {
    const data = populatedSummary();
    mocks.getOnboardingSummary.mockResolvedValue({ ...emptySummary(), venues: data.venues });
    render(<OnboardingView />);
    await screen.findByLabelText("Existing venue");
    fireEvent.change(screen.getByLabelText("Existing venue"), { target: { value: data.venues[0]?.id } });
    fireEvent.change(screen.getByLabelText("First administrator email"), { target: { value: "manager@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Create client workspace" }));
    await waitFor(() => { expect(mocks.createManagedOnboarding).toHaveBeenCalledWith(expect.objectContaining({
      existingVenueId: data.venues[0]?.id, ownerInvite: { email: "manager@example.test", name: null, workspaceRole: "owner", venueRole: "admin" },
    })); });
    expect(mocks.createManagedOnboarding.mock.calls[0]?.[0]).not.toHaveProperty("venue");
  });

  it("distinguishes an expired invitation from a pending invitation with no expiry", async () => {
    const data = populatedSummary();
    const member = data.memberships[0]; const invitation = data.invitations[0];
    if (member === undefined || invitation === undefined) throw new Error("Missing invitation fixture");
    mocks.getOnboardingSummary.mockResolvedValue({ ...data, memberships: [member, { ...member, id: "second", email: "expired@example.test", invitationId: "expired" }],
      invitations: [{ ...invitation, expiresAt: null }, { ...invitation, id: "expired", status: "expired", expiresAt: "2020-01-01T00:00:00.000Z" }] });
    render(<OnboardingView />);
    expect(await screen.findByText("Invitation expired")).toBeTruthy();
    expect(screen.getByText("Awaiting sign-in")).toBeTruthy();
  });

  it("renews a saved invitation with an explicitly selected venue administrator role", async () => {
    mocks.getOnboardingSummary.mockResolvedValue(populatedSummary());
    render(<OnboardingView />);
    fireEvent.click(await screen.findByRole("button", { name: "Manage access for owner@tradeshall.co.uk" }));
    fireEvent.change(screen.getByLabelText("Venue role"), { target: { value: "admin" } });
    fireEvent.click(screen.getByRole("button", { name: "Save venue access" }));
    await waitFor(() => { expect(mocks.inviteWorkspaceMembers).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000002", {
      staffInvites: [{ email: "owner@tradeshall.co.uk", name: null, workspaceRole: "admin", venueRole: "admin" }],
    }); });
  });

  it("keeps a failed cancellation visible and does not remove the member locally", async () => {
    mocks.getOnboardingSummary.mockResolvedValue(populatedSummary());
    mocks.revokeWorkspaceInvitation.mockRejectedValue(new Error("Invitation changed. Refresh before cancelling."));
    render(<OnboardingView />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel invitation for owner@tradeshall.co.uk" }));
    expect(await screen.findByText("Invitation changed. Refresh before cancelling.")).toBeTruthy();
    expect(screen.getByText("Awaiting sign-in")).toBeTruthy();
    expect(mocks.revokeWorkspaceInvitation).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000004");
  });

  it("keeps existing members visible during refresh and reports refresh failure", async () => {
    mocks.getOnboardingSummary.mockResolvedValueOnce(populatedSummary()).mockRejectedValueOnce(new Error("Refresh unavailable"));
    render(<OnboardingView />);
    await screen.findByText("People & access");
    fireEvent.click(screen.getByRole("button", { name: "Refresh clients" }));
    expect(await screen.findByText("The latest access state could not be loaded.")).toBeTruthy();
    expect(screen.getByText("owner@tradeshall.co.uk")).toBeTruthy();
  });

  it("updates the suggested organisation when changing venue while preserving a manually entered name", async () => {
    const data = populatedSummary(); const first = data.venues[0];
    if (first === undefined) throw new Error("Missing venue fixture");
    const second = { ...first, id: "00000000-0000-4000-8000-000000000013", name: "City Rooms", slug: "city-rooms" };
    mocks.getOnboardingSummary.mockResolvedValue({ ...emptySummary(), venues: [first, second] });
    render(<OnboardingView />);
    const chooser = await screen.findByLabelText("Existing venue");
    fireEvent.change(chooser, { target: { value: first.id } });
    expect(screen.getByLabelText("Client organisation")).toHaveProperty("value", first.name);
    fireEvent.change(chooser, { target: { value: second.id } });
    expect(screen.getByLabelText("Client organisation")).toHaveProperty("value", second.name);
    fireEvent.change(screen.getByLabelText("Client organisation"), { target: { value: "Shared venue operator" } });
    fireEvent.change(chooser, { target: { value: first.id } });
    expect(screen.getByLabelText("Client organisation")).toHaveProperty("value", "Shared venue operator");
  });

  it("clears the access editor after cancelling the invitation being edited", async () => {
    const data = populatedSummary(); const member = data.memberships[0];
    if (member === undefined) throw new Error("Missing membership fixture");
    const removed = { ...member, status: "removed" as const };
    mocks.getOnboardingSummary.mockResolvedValueOnce(data).mockResolvedValueOnce({ ...data, memberships: [removed] });
    mocks.revokeWorkspaceInvitation.mockResolvedValue(removed);
    render(<OnboardingView />);
    fireEvent.click(await screen.findByRole("button", { name: `Manage access for ${member.email}` }));
    expect(screen.getByRole("button", { name: "Save venue access" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: `Cancel invitation for ${member.email}` }));
    await screen.findByText(`Invitation cancelled for ${member.email}.`);
    expect(screen.getByLabelText("Email address")).toHaveProperty("value", "");
    expect(screen.queryByRole("button", { name: "Save venue access" })).toBeNull();
    expect(screen.getByRole("button", { name: "Grant venue access" })).toHaveProperty("disabled", true);
    expect(mocks.inviteWorkspaceMembers).not.toHaveBeenCalled();
  });
});
