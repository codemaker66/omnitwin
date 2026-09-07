import { and, eq, isNull, sql } from "drizzle-orm";
import type { VenueInvitationRole, WorkspaceMemberRole } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { userInvitations, users, workspaceMemberships } from "../db/schema.js";

export type OnboardingTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export class OnboardingConflict extends Error {
  constructor(message: string, readonly code: string, readonly statusCode = 409) { super(message); }
}

export interface MembershipDraft {
  readonly email: string;
  readonly workspaceRole: WorkspaceMemberRole;
  readonly venueRole: VenueInvitationRole;
}

/** Records a grant; only the recipient's verified auth request accepts it. */
export async function prepareWorkspaceInvitation(
  tx: OnboardingTransaction,
  workspaceId: string,
  venueId: string,
  actorId: string,
  draft: MembershipDraft,
): Promise<typeof workspaceMemberships.$inferSelect> {
  const email = draft.email.trim().toLowerCase();
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${email}))`);
  const now = new Date();
  const pendingInvitations = await tx.select().from(userInvitations)
    .where(and(eq(userInvitations.email, email), eq(userInvitations.status, "pending"), isNull(userInvitations.acceptedAt)))
    .for("update");
  for (const pending of pendingInvitations) {
    if (pending.expiresAt !== null && pending.expiresAt <= now) {
      await tx.update(userInvitations).set({ status: "expired", updatedAt: now }).where(eq(userInvitations.id, pending.id));
    } else if (pending.venueId !== venueId) {
      throw new OnboardingConflict("This email already has a pending invitation for another venue. Cancel it before granting different venue access.", "INVITATION_VENUE_CONFLICT");
    }
  }
  const [user] = await tx.select().from(users).where(eq(users.email, email)).limit(1).for("update");
  if (user !== undefined && user.venueId !== null && user.venueId !== venueId) {
    throw new OnboardingConflict("This account already belongs to another venue. Its access has not been changed.", "ACCOUNT_VENUE_CONFLICT");
  }
  if (user !== undefined && user.venueId !== null && user.role !== draft.venueRole &&
      draft.venueRole !== "admin" && user.role !== "admin") {
    throw new OnboardingConflict("This grant would replace existing venue permissions. Choose venue administrator to add administration.", "ROLE_CHANGE_CONFLICT");
  }
  const [membership] = await tx.select().from(workspaceMemberships)
    .where(and(eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.email, email)))
    .limit(1).for("update");
  if (membership?.status === "suspended") {
    throw new OnboardingConflict("This workspace membership is suspended. Review the suspension before granting access.", "MEMBERSHIP_SUSPENDED");
  }
  const venueRole = user?.role === "admin" ? "admin" : draft.venueRole;
  const workspaceRole = membership?.role === "owner" ? "owner" : draft.workspaceRole;
  if (membership?.status === "active" && membership.venueRole === venueRole &&
      membership.role === workspaceRole && user?.venueId === venueId && user.role === venueRole) return membership;

  // A superseded invitation must not win an older-email-first lookup.
  await tx.update(userInvitations).set({ status: "revoked", updatedAt: now })
    .where(and(eq(userInvitations.email, email), eq(userInvitations.venueId, venueId),
      eq(userInvitations.status, "pending"), isNull(userInvitations.acceptedAt)));
  const [invitation] = await tx.insert(userInvitations).values({
    email, role: venueRole, venueId, status: "pending", expiresAt: new Date(now.getTime() + 30 * 86400_000),
  }).returning();
  if (invitation === undefined) throw new Error("Invitation insert returned no row");
  const values = { invitationId: invitation.id, role: workspaceRole, venueRole,
    status: "invited", invitedBy: actorId, updatedAt: now };
  const [prepared] = membership === undefined
    ? await tx.insert(workspaceMemberships).values({ workspaceId, email, ...values }).returning()
    : await tx.update(workspaceMemberships).set(values).where(eq(workspaceMemberships.id, membership.id)).returning();
  if (prepared === undefined) throw new Error("Membership write returned no row");
  return prepared;
}
