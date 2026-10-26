import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { z } from "zod";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, or } from "drizzle-orm";
import {
  InviteVenueTeamMemberSchema,
  UserRoleSchema,
  VENUE_TEAM_ROLE_LABELS,
  VENUE_TEAM_ROLE_SUMMARIES,
  VENUE_TEAM_ROLES,
  VenueTeamRoleSchema,
  type VenueTeam,
  type VenueTeamEmailDelivery,
  type VenueTeamInvitation,
  type VenueTeamMember,
} from "@omnitwin/types";
import { generalAuditLog, userInvitations, users, venues, workspaceMemberships, workspaces } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { canManageVenueTeam } from "../utils/query.js";
import {
  OnboardingConflict,
  cancelVenueInvitation,
  prepareVenueInvitation,
  prepareWorkspaceInvitation,
} from "../services/workspace-invitations.js";
import { isEmailDeliveryConfigured, sendEmail } from "../services/email.js";
import { formatCalendarDay, venueTeamInvitation } from "../services/email-templates.js";

// ---------------------------------------------------------------------------
// The venue team (Plan 19 L1): a venue administrator sees who has access,
// invites people and cancels an invitation, without a platform admin.
//
// The grant is the one Clients & access records (services/workspace-
// invitations.ts), accepted only by that email's verified first sign-in
// (middleware/auth.ts). When the venue has a managed workspace the grant is
// recorded on it too, so both screens show the same invitation. Every invite
// and cancel is written to general_audit_log, which is also how the list
// names who sent an invitation made here.
// ---------------------------------------------------------------------------

const VenueParams = z.object({ venueId: z.string().uuid() });
const InvitationParams = VenueParams.extend({ invitationId: z.string().uuid() });

const INVITATION_CREATED = "venue_team.invitation_created";
const INVITATION_CANCELLED = "venue_team.invitation_cancelled";
const FORBIDDEN = { error: "Only the venue's administrators manage its team", code: "FORBIDDEN" } as const;

type InvitationRow = typeof userInvitations.$inferSelect;

/** The venue-local day a grant lapses, in the House form the other emails use
 *  ("Tuesday 24 November 2026", formatCalendarDay); London if the venue's
 *  stored zone is not one Intl knows. Only numeric parts come from Intl, so
 *  the wording never depends on the runtime's locale data. */
export function formatOpenUntil(expiresAt: Date | null, timeZone: string): string {
  if (expiresAt === null) return "until it is cancelled";
  const localDay = (zone: string): string => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      year: "numeric", month: "2-digit", day: "2-digit", timeZone: zone,
    }).formatToParts(expiresAt);
    const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
  let isoDay: string;
  try {
    isoDay = localDay(timeZone);
  } catch {
    isoDay = localDay("Europe/London");
  }
  return formatCalendarDay(isoDay) ?? isoDay;
}

function toInvitation(row: InvitationRow, invitedByName: string | null): VenueTeamInvitation | null {
  const role = UserRoleSchema.safeParse(row.role);
  if (!role.success || row.email === null) return null;
  return {
    id: row.id,
    email: row.email,
    role: role.data,
    invitedAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    invitedByName,
  };
}

async function readTeam(db: Database, venueId: string, now: Date): Promise<VenueTeam> {
  const memberRows = await db.select({
    id: users.id,
    displayName: users.displayName,
    name: users.name,
    email: users.email,
    role: users.role,
    joinedAt: users.createdAt,
  }).from(users)
    .where(and(eq(users.venueId, venueId), inArray(users.role, [...VENUE_TEAM_ROLES])))
    .orderBy(asc(users.name));
  const rank = (role: string): number => VENUE_TEAM_ROLES.findIndex((teamRole) => teamRole === role);
  const members: VenueTeamMember[] = memberRows.flatMap((row) => {
    const role = UserRoleSchema.safeParse(row.role);
    return role.success ? [{
      id: row.id, name: row.displayName ?? row.name, email: row.email, role: role.data, joinedAt: row.joinedAt.toISOString(),
    }] : [];
  }).sort((a, b) => rank(a.role) - rank(b.role));

  const pending = await db.select().from(userInvitations)
    .where(and(
      eq(userInvitations.venueId, venueId),
      eq(userInvitations.status, "pending"),
      isNull(userInvitations.acceptedAt),
      isNotNull(userInvitations.email),
      or(isNull(userInvitations.expiresAt), gt(userInvitations.expiresAt, now)),
    ))
    .orderBy(desc(userInvitations.createdAt));
  const ids = pending.map((row) => row.id);
  const inviters = new Map<string, string>();
  if (ids.length > 0) {
    // Who sent each one: the managed workspace's record (Clients & access),
    // then this route's audit row, which wins when both exist.
    const fromWorkspace = await db.select({ invitationId: workspaceMemberships.invitationId, name: users.name, displayName: users.displayName })
      .from(workspaceMemberships)
      .innerJoin(users, eq(users.id, workspaceMemberships.invitedBy))
      .where(inArray(workspaceMemberships.invitationId, ids));
    for (const row of fromWorkspace) {
      if (row.invitationId !== null) inviters.set(row.invitationId, row.displayName ?? row.name);
    }
    const fromAudit = await db.select({ invitationId: generalAuditLog.targetId, name: users.name, displayName: users.displayName })
      .from(generalAuditLog)
      .innerJoin(users, eq(users.id, generalAuditLog.actorUserId))
      .where(and(eq(generalAuditLog.action, INVITATION_CREATED), inArray(generalAuditLog.targetId, ids)));
    for (const row of fromAudit) inviters.set(row.invitationId, row.displayName ?? row.name);
  }
  const invitations = pending.flatMap((row) => {
    const invitation = toInvitation(row, inviters.get(row.id) ?? null);
    return invitation === null ? [] : [invitation];
  });
  return { members, invitations };
}

/**
 * Sends the invitation and says what became of it. Never throws: the grant
 * has already committed, so a failed render or send is reported as
 * "not_sent" and the person can still sign up with that address.
 */
async function deliverInvitation(
  db: Database,
  logger: FastifyBaseLogger,
  venue: { readonly name: string; readonly timezone: string },
  invitation: InvitationRow,
  inviterName: string,
): Promise<VenueTeamEmailDelivery> {
  const role = VenueTeamRoleSchema.safeParse(invitation.role);
  if (invitation.email === null || !role.success) return "not_sent";
  try {
    const { subject, html } = await venueTeamInvitation({
      venueName: venue.name,
      inviterName,
      email: invitation.email,
      roleLabel: VENUE_TEAM_ROLE_LABELS[role.data],
      roleSummary: VENUE_TEAM_ROLE_SUMMARIES[role.data],
      openUntil: formatOpenUntil(invitation.expiresAt, venue.timezone),
      signUpUrl: `${process.env["FRONTEND_URL"] ?? "http://localhost:5173"}/register`,
    });
    const configured = isEmailDeliveryConfigured();
    const accepted = await sendEmail({ to: invitation.email, subject, html }, {
      db, idempotencyKey: `venue-team-invitation:${invitation.id}`, logger,
    });
    if (!configured) return "not_configured";
    return accepted ? "sent" : "not_sent";
  } catch (error) {
    logger.error({ event: "venue_team.invitation_email_failed", invitationId: invitation.id, err: error }, "venue_team.invitation_email_failed");
    return "not_sent";
  }
}

export async function venueTeamRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  // GET / — who has access at the venue, and the invitations still open.
  server.get("/", { preHandler: [authenticate] }, async (request, reply) => {
    const params = VenueParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid venue ID", code: "VALIDATION_ERROR" });
    if (!canManageVenueTeam(request.user, params.data.venueId)) return reply.status(403).send(FORBIDDEN);
    return { data: await readTeam(db, params.data.venueId, new Date()) };
  });

  // POST /invitations — grant one email a role at the venue, then email it.
  // Each send is an email from the venue, so an administrator's rate is bounded.
  server.post("/invitations", {
    preHandler: [authenticate],
    config: { rateLimit: { max: 30, timeWindow: "1 hour" } },
  }, async (request, reply) => {
    const params = VenueParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid venue ID", code: "VALIDATION_ERROR" });
    if (!canManageVenueTeam(request.user, params.data.venueId)) return reply.status(403).send(FORBIDDEN);
    const body = InviteVenueTeamMemberSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: body.error.issues });
    }
    const [venue] = await db.select({ id: venues.id, name: venues.name, timezone: venues.timezone }).from(venues)
      .where(and(eq(venues.id, params.data.venueId), isNull(venues.deletedAt))).limit(1);
    if (venue === undefined) return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });

    const { email, role } = body.data;
    const actorId = request.user.id;
    try {
      const invitation = await db.transaction(async (tx) => {
        const [workspace] = await tx.select({ id: workspaces.id }).from(workspaces)
          .where(and(
            eq(workspaces.primaryVenueId, venue.id),
            isNull(workspaces.deletedAt),
            inArray(workspaces.status, ["active", "onboarding"]),
          ))
          .orderBy(asc(workspaces.createdAt)).limit(1).for("no key update");
        let row: InvitationRow | undefined;
        if (workspace === undefined) {
          const outcome = await prepareVenueInvitation(tx, venue.id, { email, venueRole: role });
          if (outcome.kind === "invited") row = outcome.invitation;
        } else {
          const membership = await prepareWorkspaceInvitation(tx, workspace.id, venue.id, actorId, {
            email, workspaceRole: role, venueRole: role,
          });
          if (membership.status === "invited" && membership.invitationId !== null) {
            [row] = await tx.select().from(userInvitations).where(eq(userInvitations.id, membership.invitationId)).limit(1);
          }
        }
        if (row === undefined) {
          throw new OnboardingConflict("This person already has this access at the venue.", "ALREADY_HAS_ACCESS");
        }
        await tx.insert(generalAuditLog).values({
          actorUserId: actorId,
          action: INVITATION_CREATED,
          targetType: "user_invitation",
          targetId: row.id,
          summary: `Invited ${row.email ?? "an address"} as ${row.role} at ${venue.name}`,
          metadata: { venueId: venue.id, role: row.role, workspaceId: workspace?.id ?? null },
        });
        return row;
      });

      // The name people know the administrator by, as the list shows it.
      const [actor] = await db.select({ name: users.name, displayName: users.displayName }).from(users)
        .where(eq(users.id, actorId)).limit(1);
      const inviterName = actor?.displayName ?? actor?.name ?? request.user.name;
      const emailDelivery = await deliverInvitation(db, request.log, venue, invitation, inviterName);
      const shown = toInvitation(invitation, inviterName);
      if (shown === null) throw new Error("A team invitation was recorded without an email or a known role");
      return reply.status(201).send({ data: { invitation: shown, emailDelivery } });
    } catch (error) {
      if (error instanceof OnboardingConflict) return reply.status(error.statusCode).send({ error: error.message, code: error.code });
      throw error;
    }
  });

  // DELETE /invitations/:invitationId — withdraw an invitation not yet used.
  server.delete("/invitations/:invitationId", { preHandler: [authenticate] }, async (request, reply) => {
    const params = InvitationParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid invitation", code: "VALIDATION_ERROR" });
    if (!canManageVenueTeam(request.user, params.data.venueId)) return reply.status(403).send(FORBIDDEN);
    try {
      await db.transaction(async (tx) => {
        const revoked = await cancelVenueInvitation(tx, params.data.venueId, params.data.invitationId);
        await tx.insert(generalAuditLog).values({
          actorUserId: request.user.id,
          action: INVITATION_CANCELLED,
          targetType: "user_invitation",
          targetId: revoked.id,
          summary: `Cancelled the invitation for ${revoked.email ?? "an address"}`,
          metadata: { venueId: params.data.venueId, role: revoked.role },
        });
      });
      return reply.status(204).send();
    } catch (error) {
      if (error instanceof OnboardingConflict) return reply.status(error.statusCode).send({ error: error.message, code: error.code });
      throw error;
    }
  });
}
