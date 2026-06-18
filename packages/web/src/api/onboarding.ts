import {
  CreateManagedOnboardingResultSchema,
  CreateManagedOnboardingSchema,
  InviteWorkspaceMembersResultSchema,
  InviteWorkspaceMembersSchema,
  OnboardingProjectSchema,
  OnboardingSummarySchema,
  UpdateOnboardingProjectSchema,
  VerifyWorkspaceEntitlementSchema,
  WorkspaceEntitlementSchema,
  type CreateManagedOnboarding,
  type CreateManagedOnboardingResult,
  type InviteWorkspaceMembers,
  type InviteWorkspaceMembersResult,
  type OnboardingProject,
  type OnboardingSummary,
  type UpdateOnboardingProject,
  type VerifyWorkspaceEntitlement,
  type WorkspaceEntitlement,
} from "@omnitwin/types";
import { api } from "./client.js";

export async function getOnboardingSummary(): Promise<OnboardingSummary> {
  return api.get("/onboarding/summary", OnboardingSummarySchema);
}
export async function createManagedOnboarding(input: CreateManagedOnboarding): Promise<CreateManagedOnboardingResult> {
  const body = CreateManagedOnboardingSchema.parse(input);
  return api.post("/onboarding/managed-workspaces", body, undefined, CreateManagedOnboardingResultSchema);
}

export async function inviteWorkspaceMembers(
  workspaceId: string,
  input: InviteWorkspaceMembers,
): Promise<InviteWorkspaceMembersResult> {
  const body = InviteWorkspaceMembersSchema.parse(input);
  return api.post(`/onboarding/workspaces/${workspaceId}/invitations`, body, undefined, InviteWorkspaceMembersResultSchema);
}

export async function updateOnboardingProject(
  projectId: string,
  input: UpdateOnboardingProject,
): Promise<OnboardingProject> {
  const body = UpdateOnboardingProjectSchema.parse(input);
  return api.patch(`/onboarding/projects/${projectId}`, body, OnboardingProjectSchema);
}

export async function verifyWorkspaceEntitlement(
  entitlementId: string,
  input: VerifyWorkspaceEntitlement,
): Promise<WorkspaceEntitlement> {
  const body = VerifyWorkspaceEntitlementSchema.parse(input);
  return api.patch(`/onboarding/entitlements/${entitlementId}/provider-verification`, body, WorkspaceEntitlementSchema);
}
