import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  CreateManagedOnboardingSchema,
  InviteWorkspaceMembersSchema,
  UpdateOnboardingProjectSchema,
  VerifyWorkspaceEntitlementSchema,
  type ProviderVerificationStatus,
  type WorkspaceEntitlementInput,
  type WorkspaceEntitlementStatus,
} from "@omnitwin/types";
import {
  onboardingAuditEvents,
  onboardingProjects,
  organisations,
  userInvitations,
  users,
  venues,
  workspaceEntitlements,
  workspaceMemberships,
  workspaces,
} from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate, authorizePlatformAdmin } from "../middleware/auth.js";
import { OnboardingConflict, prepareWorkspaceInvitation } from "../services/workspace-invitations.js";

const WorkspaceIdParam = z.object({ workspaceId: z.string().uuid() });
const ProjectIdParam = z.object({ projectId: z.string().uuid() });
const EntitlementIdParam = z.object({ entitlementId: z.string().uuid() });

type WorkspaceMembershipRow = typeof workspaceMemberships.$inferSelect;
const InvitationParam = WorkspaceIdParam.extend({ membershipId: z.string().uuid() });

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

    const workspaceIds = workspaceRows.map((workspace) => workspace.id);
    const venueRows = await db.select().from(venues).where(isNull(venues.deletedAt)).limit(200);

    const [membershipRows, projectRows, entitlementRows, auditRows] = await Promise.all([
      workspaceIds.length === 0 ? [] : db.select().from(workspaceMemberships).where(inArray(workspaceMemberships.workspaceId, workspaceIds)).limit(500),
      workspaceIds.length === 0 ? [] : db.select().from(onboardingProjects).where(inArray(onboardingProjects.workspaceId, workspaceIds)).limit(200),
      workspaceIds.length === 0 ? [] : db.select().from(workspaceEntitlements).where(inArray(workspaceEntitlements.workspaceId, workspaceIds)).limit(200),
      workspaceIds.length === 0 ? [] : db.select().from(onboardingAuditEvents).where(inArray(onboardingAuditEvents.workspaceId, workspaceIds)).limit(500),
    ]);
    const invitationIds = membershipRows.flatMap((member) => member.invitationId === null ? [] : [member.invitationId]);
    const invitationRows = invitationIds.length === 0 ? [] : await db.select({
      id: userInvitations.id, email: userInvitations.email, role: userInvitations.role,
      venueId: userInvitations.venueId, status: userInvitations.status, expiresAt: userInvitations.expiresAt,
      acceptedAt: userInvitations.acceptedAt, acceptedBy: userInvitations.acceptedBy,
    }).from(userInvitations).where(inArray(userInvitations.id, invitationIds));

    return {
      data: {
        organisations: organisationRows,
        workspaces: workspaceRows,
        venues: venueRows,
        memberships: membershipRows,
        projects: projectRows,
        entitlements: entitlementRows,
        auditEvents: auditRows,
        invitations: invitationRows,
      },
    };
  });

  server.post("/managed-workspaces", { preHandler: platformAdminPreHandler }, async (request, reply) => {
    const parsed = CreateManagedOnboardingSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    try {
    const created = await db.transaction(async (tx) => {
      const now = new Date();

      let venue: typeof venues.$inferSelect | undefined;
      if (parsed.data.existingVenueId !== undefined) {
        [venue] = await tx.select().from(venues).where(and(eq(venues.id, parsed.data.existingVenueId), isNull(venues.deletedAt)))
          .limit(1).for("update");
        if (venue === undefined) throw new OnboardingConflict("Venue not found", "NOT_FOUND", 404);
        const [attached] = await tx.select({ id: workspaces.id }).from(workspaces)
          .where(and(eq(workspaces.primaryVenueId, venue.id), isNull(workspaces.deletedAt))).limit(1);
        if (attached !== undefined) throw new OnboardingConflict("This venue already has a workspace. Select it to manage access.", "VENUE_ALREADY_LINKED");
      } else if (parsed.data.venue !== undefined) {
        const input = parsed.data.venue;
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`venue-slug:${input.slug}`}))`);
        const [existing] = await tx.select({ id: venues.id }).from(venues).where(eq(venues.slug, input.slug)).limit(1);
        if (existing !== undefined) throw new OnboardingConflict("Venue slug already exists", "SLUG_EXISTS");
        [venue] = await tx.insert(venues).values({
          name: input.name, slug: input.slug, address: input.address, logoUrl: input.logoUrl ?? null,
          brandColour: input.brandColour ?? null, timezone: input.timezone,
        }).returning();
      }
      if (venue === undefined) throw new Error("Venue insert returned no row");

      const [organisation] = await tx.insert(organisations).values({
        name: parsed.data.organisationName,
        status: "onboarding",
        createdBy: request.user.id,
      }).returning();
      if (organisation === undefined) throw new Error("organisation insert returned no row");

      const [workspace] = await tx.insert(workspaces).values({
        organisationId: organisation.id,
        primaryVenueId: venue.id,
        name: parsed.data.workspaceName ?? parsed.data.organisationName,
        status: "onboarding",
        createdBy: request.user.id,
      }).returning();
      if (workspace === undefined) throw new Error("workspace insert returned no row");

      for (const email of [parsed.data.ownerInvite.email, ...parsed.data.staffInvites.map((invite) => invite.email)]
        .map((email) => email.trim().toLowerCase()).sort()) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${email}))`);
      }

      const ownerMembership = await prepareWorkspaceInvitation(tx, workspace.id, venue.id, request.user.id, {
        email: parsed.data.ownerInvite.email,
        workspaceRole: parsed.data.ownerInvite.workspaceRole,
        venueRole: parsed.data.ownerInvite.venueRole,
      });

      const staffMemberships: WorkspaceMembershipRow[] = [];
      for (const invite of parsed.data.staffInvites) {
        staffMemberships.push(await prepareWorkspaceInvitation(tx, workspace.id, venue.id, request.user.id, {
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
    } catch (error) {
      if (error instanceof OnboardingConflict) return reply.status(error.statusCode).send({ error: error.message, code: error.code });
      throw error;
    }
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

    try {
    const memberships = await db.transaction(async (tx) => {
      const [currentWorkspace] = await tx.select().from(workspaces)
        .where(and(eq(workspaces.id, workspace.id), isNull(workspaces.deletedAt))).limit(1).for("update");
      if (currentWorkspace === undefined || (currentWorkspace.status !== "active" && currentWorkspace.status !== "onboarding")) {
        throw new OnboardingConflict("This workspace is not accepting new access grants", "WORKSPACE_UNAVAILABLE");
      }
      const rows: WorkspaceMembershipRow[] = [];
      for (const invite of [...parsed.data.staffInvites].sort((a, b) => a.email.toLowerCase().localeCompare(b.email.toLowerCase()))) {
        rows.push(await prepareWorkspaceInvitation(tx, workspace.id, workspace.primaryVenueId, request.user.id, invite));
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
    } catch (error) {
      if (error instanceof OnboardingConflict) return reply.status(error.statusCode).send({ error: error.message, code: error.code });
      throw error;
    }
  });

  server.delete("/workspaces/:workspaceId/invitations/:membershipId", { preHandler: platformAdminPreHandler }, async (request, reply) => {
    const parsed = InvitationParam.safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid invitation", code: "VALIDATION_ERROR" });
    try {
      const membership = await db.transaction(async (tx) => {
        const [workspace] = await tx.select().from(workspaces)
          .where(and(eq(workspaces.id, parsed.data.workspaceId), isNull(workspaces.deletedAt))).limit(1).for("update");
        if (workspace === undefined) throw new OnboardingConflict("Workspace not found", "NOT_FOUND", 404);
        const [found] = await tx.select().from(workspaceMemberships)
          .where(and(eq(workspaceMemberships.id, parsed.data.membershipId), eq(workspaceMemberships.workspaceId, workspace.id))).limit(1);
        if (found === undefined) throw new OnboardingConflict("Invitation not found", "NOT_FOUND", 404);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${found.email}))`);
        const [current] = await tx.select().from(workspaceMemberships).where(eq(workspaceMemberships.id, found.id)).limit(1).for("update");
        if (current?.status !== "invited" || current.invitationId === null) {
          throw new OnboardingConflict("This invitation has already been accepted or cancelled. Existing account access has not changed.", "INVITATION_NOT_PENDING");
        }
        const now = new Date();
        const [revoked] = await tx.update(userInvitations).set({ status: "revoked", updatedAt: now })
          .where(and(eq(userInvitations.id, current.invitationId), eq(userInvitations.status, "pending"), isNull(userInvitations.acceptedAt))).returning();
        if (revoked === undefined) throw new OnboardingConflict("Invitation is no longer pending", "INVITATION_NOT_PENDING");
        // Cancelling an unaccepted upgrade must preserve a connected account's
        // existing grant. New, unconnected invitations become removed.
        const [user] = current.userId === null ? [] : await tx.select().from(users)
          .where(eq(users.id, current.userId)).limit(1);
        const [updated] = await tx.update(workspaceMemberships).set({
          status: user === undefined ? "removed" : "active",
          ...(user === undefined ? {} : { venueRole: user.role, role: current.role === "owner" ? "owner" : user.role }),
          updatedAt: now,
        }).where(eq(workspaceMemberships.id, current.id)).returning();
        if (updated === undefined) throw new Error("Membership disappeared during cancellation");
        await tx.insert(onboardingAuditEvents).values({
          workspaceId: workspace.id, eventType: "invitation_revoked", actorUserId: request.user.id,
          summary: `Pending invitation cancelled for ${current.email}; existing account access preserved`,
        });
        return updated;
      });
      return { data: { membership } };
    } catch (error) {
      if (error instanceof OnboardingConflict) return reply.status(error.statusCode).send({ error: error.message, code: error.code });
      throw error;
    }
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
