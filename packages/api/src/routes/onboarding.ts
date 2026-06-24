import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  CreateManagedOnboardingSchema,
  InviteWorkspaceMembersSchema,
  UpdateOnboardingProjectSchema,
  VerifyWorkspaceEntitlementSchema,
  type ProviderVerificationStatus,
  type VenueInvitationRole,
  type WorkspaceEntitlementInput,
  type WorkspaceEntitlementStatus,
  type WorkspaceMemberRole,
} from "@omnitwin/types";
import {
  onboardingAuditEvents,
  onboardingProjects,
  organisations,
  userInvitations,
  venues,
  workspaceEntitlements,
  workspaceMemberships,
  workspaces,
} from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate, authorizePlatformAdmin } from "../middleware/auth.js";

const WorkspaceIdParam = z.object({ workspaceId: z.string().uuid() });
const ProjectIdParam = z.object({ projectId: z.string().uuid() });
const EntitlementIdParam = z.object({ entitlementId: z.string().uuid() });

type WorkspaceMembershipRow = typeof workspaceMemberships.$inferSelect;

interface MembershipDraft {
  readonly email: string;
  readonly workspaceRole: WorkspaceMemberRole;
  readonly venueRole: VenueInvitationRole;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function addDays(from: Date, days: number): Date {
  const expires = new Date(from);
  expires.setUTCDate(expires.getUTCDate() + days);
  return expires;
}

function providerVerificationStatusFor(input: WorkspaceEntitlementInput): ProviderVerificationStatus {
  if (input.providerVerified) return "provider_verified";
  if (input.billingProvider === "none") return "not_required";
  return "pending";
}

function entitlementStatusFor(input: WorkspaceEntitlementInput): WorkspaceEntitlementStatus {
  return input.providerVerified ? "active" : "pending_provider_verification";
}

function providerVerifiedAtFor(status: ProviderVerificationStatus, now: Date): Date | null {
  return status === "provider_verified" ? now : null;
}

export async function onboardingRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  const platformAdminPreHandler = [authenticate, authorizePlatformAdmin()];

  server.get("/summary", { preHandler: platformAdminPreHandler }, async () => {
    const organisationRows = await db.select()
      .from(organisations)
      .where(isNull(organisations.deletedAt))
      .limit(200);

    const workspaceRows = await db.select()
      .from(workspaces)
      .where(isNull(workspaces.deletedAt))
      .limit(200);

    const venueIds = workspaceRows.map((workspace) => workspace.primaryVenueId);
    const venueRows = venueIds.length === 0
      ? []
      : await db.select()
        .from(venues)
        .where(inArray(venues.id, venueIds))
        .limit(200);

    const [membershipRows, projectRows, entitlementRows, auditRows] = await Promise.all([
      db.select().from(workspaceMemberships).limit(500),
      db.select().from(onboardingProjects).limit(200),
      db.select().from(workspaceEntitlements).limit(200),
      db.select().from(onboardingAuditEvents).limit(500),
    ]);

    return {
      data: {
        organisations: organisationRows,
        workspaces: workspaceRows,
        venues: venueRows,
        memberships: membershipRows,
        projects: projectRows,
        entitlements: entitlementRows,
        auditEvents: auditRows,
      },
    };
  });

  server.post("/managed-workspaces", { preHandler: platformAdminPreHandler }, async (request, reply) => {
    const parsed = CreateManagedOnboardingSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const existing = await db.select({ id: venues.id })
      .from(venues)
      .where(and(eq(venues.slug, parsed.data.venue.slug), isNull(venues.deletedAt)))
      .limit(1);

    if (existing.length > 0) {
      return reply.status(409).send({ error: "Venue slug already exists", code: "SLUG_EXISTS" });
    }

    const created = await db.transaction(async (tx) => {
      const now = new Date();
      const invitationExpiresAt = addDays(now, 30);

      const [organisation] = await tx.insert(organisations).values({
        name: parsed.data.organisationName,
        status: "onboarding",
        createdBy: request.user.id,
      }).returning();
      if (organisation === undefined) throw new Error("organisation insert returned no row");

      const [venue] = await tx.insert(venues).values({
        name: parsed.data.venue.name,
        slug: parsed.data.venue.slug,
        address: parsed.data.venue.address,
        logoUrl: parsed.data.venue.logoUrl ?? null,
        brandColour: parsed.data.venue.brandColour ?? null,
        timezone: parsed.data.venue.timezone,
      }).returning();
      if (venue === undefined) throw new Error("venue insert returned no row");

      const [workspace] = await tx.insert(workspaces).values({
        organisationId: organisation.id,
        primaryVenueId: venue.id,
        name: parsed.data.workspaceName ?? parsed.data.organisationName,
        status: "onboarding",
        createdBy: request.user.id,
      }).returning();
      if (workspace === undefined) throw new Error("workspace insert returned no row");

      const createMembership = async (draft: MembershipDraft): Promise<WorkspaceMembershipRow> => {
        const email = normalizeEmail(draft.email);

        const [existingMembership] = await tx.select()
          .from(workspaceMemberships)
          .where(and(eq(workspaceMemberships.workspaceId, workspace.id), eq(workspaceMemberships.email, email)))
          .limit(1);
        if (existingMembership !== undefined) return existingMembership;

        const [existingInvitation] = await tx.select()
          .from(userInvitations)
          .where(and(
            eq(userInvitations.email, email),
            eq(userInvitations.venueId, venue.id),
            eq(userInvitations.status, "pending"),
          ))
          .limit(1);

        const invitation = existingInvitation ?? (await tx.insert(userInvitations).values({
          email,
          role: draft.venueRole,
          venueId: venue.id,
          status: "pending",
          expiresAt: invitationExpiresAt,
        }).returning())[0];
        if (invitation === undefined) throw new Error("invitation insert returned no row");

        const [membership] = await tx.insert(workspaceMemberships).values({
          workspaceId: workspace.id,
          invitationId: invitation.id,
          email,
          role: draft.workspaceRole,
          venueRole: draft.venueRole,
          status: "invited",
          invitedBy: request.user.id,
        }).returning();
        if (membership === undefined) throw new Error("workspace membership insert returned no row");
        return membership;
      };

      const ownerMembership = await createMembership({
        email: parsed.data.ownerInvite.email,
        workspaceRole: parsed.data.ownerInvite.workspaceRole,
        venueRole: parsed.data.ownerInvite.venueRole,
      });

      const staffMemberships: WorkspaceMembershipRow[] = [];
      for (const invite of parsed.data.staffInvites) {
        staffMemberships.push(await createMembership({
          email: invite.email,
          workspaceRole: invite.workspaceRole,
          venueRole: invite.venueRole,
        }));
      }

      const providerVerificationStatus = providerVerificationStatusFor(parsed.data.entitlement);
      const providerVerifiedAt = providerVerifiedAtFor(providerVerificationStatus, now);
      const [entitlement] = await tx.insert(workspaceEntitlements).values({
        workspaceId: workspace.id,
        planKey: parsed.data.entitlement.planKey,
        status: entitlementStatusFor(parsed.data.entitlement),
        billingProvider: parsed.data.entitlement.billingProvider,
        providerCustomerRef: parsed.data.entitlement.providerCustomerRef ?? null,
        providerEntitlementRef: parsed.data.entitlement.providerEntitlementRef ?? null,
        providerEvidenceRef: parsed.data.entitlement.providerEvidenceRef ?? null,
        providerVerificationStatus,
        providerVerifiedAt,
        accessEnforced: parsed.data.entitlement.accessEnforced,
        createdBy: request.user.id,
      }).returning();
      if (entitlement === undefined) throw new Error("workspace entitlement insert returned no row");

      const [project] = await tx.insert(onboardingProjects).values({
        workspaceId: workspace.id,
        venueId: venue.id,
        status: parsed.data.staffInvites.length > 0 ? "staff_invites" : "admin_invite",
        currentStep: parsed.data.staffInvites.length > 0
          ? "Owner and staff invitations are pending acceptance."
          : "Workspace owner invitation is pending acceptance.",
        operatorReviewState: "pending_review",
        evidenceNote: parsed.data.operatorReviewNote ?? "Operator review required before rollout is marked ready.",
        createdBy: request.user.id,
      }).returning();
      if (project === undefined) throw new Error("onboarding project insert returned no row");

      await tx.insert(onboardingAuditEvents).values([
        {
          workspaceId: workspace.id,
          projectId: project.id,
          eventType: "workspace_created",
          summary: `Workspace created for ${venue.name}`,
          actorUserId: request.user.id,
        },
        {
          workspaceId: workspace.id,
          projectId: project.id,
          eventType: "owner_invited",
          summary: `Workspace owner invited at ${ownerMembership.email}`,
          actorUserId: request.user.id,
        },
        {
          workspaceId: workspace.id,
          projectId: project.id,
          eventType: "entitlement_recorded",
          summary: `Plan ${entitlement.planKey} recorded with ${entitlement.providerVerificationStatus} provider state`,
          actorUserId: request.user.id,
        },
      ]);

      if (staffMemberships.length > 0) {
        await tx.insert(onboardingAuditEvents).values({
          workspaceId: workspace.id,
          projectId: project.id,
          eventType: "staff_invited",
          summary: `${String(staffMemberships.length)} staff invitation(s) recorded`,
          actorUserId: request.user.id,
        });
      }

      return {
        organisation,
        workspace,
        venue,
        ownerMembership,
        staffMemberships,
        project,
        entitlement,
      };
    });

    return reply.status(201).send({ data: created });
  });

  server.post("/workspaces/:workspaceId/invitations", { preHandler: platformAdminPreHandler }, async (request, reply) => {
    const params = WorkspaceIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid workspace ID", code: "VALIDATION_ERROR", details: params.error.issues });
    }

    const parsed = InviteWorkspaceMembersSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const [workspace] = await db.select()
      .from(workspaces)
      .where(and(eq(workspaces.id, params.data.workspaceId), isNull(workspaces.deletedAt)))
      .limit(1);
    if (workspace === undefined) {
      return reply.status(404).send({ error: "Workspace not found", code: "NOT_FOUND" });
    }

    const memberships = await db.transaction(async (tx) => {
      const now = new Date();
      const invitationExpiresAt = addDays(now, 30);
      const rows: WorkspaceMembershipRow[] = [];

      for (const invite of parsed.data.staffInvites) {
        const email = normalizeEmail(invite.email);
        const [existingMembership] = await tx.select()
          .from(workspaceMemberships)
          .where(and(eq(workspaceMemberships.workspaceId, workspace.id), eq(workspaceMemberships.email, email)))
          .limit(1);
        if (existingMembership !== undefined) {
          rows.push(existingMembership);
          continue;
        }

        const [invitation] = await tx.insert(userInvitations).values({
          email,
          role: invite.venueRole,
          venueId: workspace.primaryVenueId,
          status: "pending",
          expiresAt: invitationExpiresAt,
        }).returning();
        if (invitation === undefined) throw new Error("invitation insert returned no row");

        const [membership] = await tx.insert(workspaceMemberships).values({
          workspaceId: workspace.id,
          invitationId: invitation.id,
          email,
          role: invite.workspaceRole,
          venueRole: invite.venueRole,
          status: "invited",
          invitedBy: request.user.id,
        }).returning();
        if (membership === undefined) throw new Error("workspace membership insert returned no row");
        rows.push(membership);
      }

      await tx.insert(onboardingAuditEvents).values({
        workspaceId: workspace.id,
        projectId: null,
        eventType: "staff_invited",
        summary: `${String(rows.length)} staff invitation(s) recorded`,
        actorUserId: request.user.id,
      });

      return rows;
    });

    return reply.status(201).send({ data: { memberships } });
  });

  server.patch("/projects/:projectId", { preHandler: platformAdminPreHandler }, async (request, reply) => {
    const params = ProjectIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid project ID", code: "VALIDATION_ERROR", details: params.error.issues });
    }

    const parsed = UpdateOnboardingProjectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.status(400).send({ error: "No changes supplied", code: "VALIDATION_ERROR" });
    }

    const now = new Date();
    const [updated] = await db.update(onboardingProjects).set({
      ...parsed.data,
      updatedAt: now,
      completedAt: parsed.data.status === "ready" ? now : undefined,
    }).where(eq(onboardingProjects.id, params.data.projectId)).returning();

    if (updated === undefined) {
      return reply.status(404).send({ error: "Onboarding project not found", code: "NOT_FOUND" });
    }

    await db.insert(onboardingAuditEvents).values({
      workspaceId: updated.workspaceId,
      projectId: updated.id,
      eventType: "operator_review_updated",
      summary: `Operator review ${updated.operatorReviewState}; project status ${updated.status}`,
      actorUserId: request.user.id,
    });

    return { data: updated };
  });

  server.patch("/entitlements/:entitlementId/provider-verification", { preHandler: platformAdminPreHandler }, async (request, reply) => {
    const params = EntitlementIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid entitlement ID", code: "VALIDATION_ERROR", details: params.error.issues });
    }

    const parsed = VerifyWorkspaceEntitlementSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const now = new Date();
    const [updated] = await db.update(workspaceEntitlements).set({
      billingProvider: parsed.data.billingProvider,
      providerCustomerRef: parsed.data.providerCustomerRef ?? null,
      providerEntitlementRef: parsed.data.providerEntitlementRef ?? null,
      providerEvidenceRef: parsed.data.providerEvidenceRef ?? null,
      providerVerificationStatus: parsed.data.providerVerificationStatus,
      providerVerifiedAt: providerVerifiedAtFor(parsed.data.providerVerificationStatus, now),
      accessEnforced: parsed.data.accessEnforced,
      status: parsed.data.providerVerificationStatus === "provider_verified" ? "active" : "pending_provider_verification",
      updatedAt: now,
    }).where(eq(workspaceEntitlements.id, params.data.entitlementId)).returning();

    if (updated === undefined) {
      return reply.status(404).send({ error: "Workspace entitlement not found", code: "NOT_FOUND" });
    }

    await db.insert(onboardingAuditEvents).values({
      workspaceId: updated.workspaceId,
      projectId: null,
      eventType: "provider_verification_updated",
      summary: `Provider verification state set to ${updated.providerVerificationStatus}`,
      actorUserId: request.user.id,
    });

    return { data: updated };
  });
}
