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

type UserRow = typeof users.$inferSelect;
type InvitationRow = typeof userInvitations.$inferSelect;
type MembershipRow = typeof workspaceMemberships.$inferSelect;

const INVITATION_LIFETIME_MS = 30 * 86400_000;

/**
 * The checks every venue grant passes, under the email's advisory lock (the
 * lock the first sign-in takes too, so a grant and its acceptance never
 * interleave): a lapsed pending grant expires; a live grant for another venue,
 * or an account that belongs to another venue, refuses; and a grant never
 * quietly replaces an account's permissions unless it adds administration.
 * Returns the account the email already has, if any, and the time taken under
 * the lock.
 */
async function lockAndCheckVenueGrant(
  tx: OnboardingTransaction,
  venueId: string,
  email: string,
  venueRole: VenueInvitationRole,
): Promise<{ readonly user: UserRow | undefined; readonly now: Date }> {
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
  if (user !== undefined && user.venueId !== null && user.role !== venueRole &&
      venueRole !== "admin" && user.role !== "admin") {
    throw new OnboardingConflict("This grant would replace existing venue permissions. Choose venue administrator to add administration.", "ROLE_CHANGE_CONFLICT");
  }
  return { user, now };
}

/** Records the 30-day grant itself, first revoking this venue's pending grant
 *  for the email so a superseded one cannot win the first sign-in's
 *  older-first lookup. */
async function recordVenueInvitation(
  tx: OnboardingTransaction,
  venueId: string,
  email: string,
  venueRole: VenueInvitationRole,
  now: Date,
): Promise<InvitationRow> {
  await tx.update(userInvitations).set({ status: "revoked", updatedAt: now })
    .where(and(eq(userInvitations.email, email), eq(userInvitations.venueId, venueId),
      eq(userInvitations.status, "pending"), isNull(userInvitations.acceptedAt)));
  const [invitation] = await tx.insert(userInvitations).values({
    email, role: venueRole, venueId, status: "pending", expiresAt: new Date(now.getTime() + INVITATION_LIFETIME_MS),
  }).returning();
  if (invitation === undefined) throw new Error("Invitation insert returned no row");
  return invitation;
}

/** Records a grant; only the recipient's verified auth request accepts it. */
export async function prepareWorkspaceInvitation(
  tx: OnboardingTransaction,
  workspaceId: string,
  venueId: string,
  actorId: string,
  draft: MembershipDraft,
): Promise<MembershipRow> {
  const email = draft.email.trim().toLowerCase();
  const { user, now } = await lockAndCheckVenueGrant(tx, venueId, email, draft.venueRole);
  const [membership] = await tx.select().from(workspaceMemberships)
    .where(and(eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.email, email)))
    .limit(1).for("update");
  if (membership?.status === "suspended") {
    throw new OnboardingConflict("This workspace membership is suspended. Review the suspension before granting access.", "MEMBERSHIP_SUSPENDED");
  }
  // An administrator's account keeps administration: a lower role chosen
  // here was turned back into administrator and reported as saved. Say so
  // instead, and change nothing.
  if (user?.role === "admin" && draft.venueRole !== "admin") {
    throw new OnboardingConflict(
      "This person is a venue administrator, and Manage access cannot lower an administrator's access. Nothing has changed.",
      "ADMIN_DOWNGRADE_UNSUPPORTED",
    );
  }
  const venueRole = user?.role === "admin" ? "admin" : draft.venueRole;
  const workspaceRole = membership?.role === "owner" ? "owner" : draft.workspaceRole;
  if (membership?.status === "active" && membership.venueRole === venueRole &&
      membership.role === workspaceRole && user?.venueId === venueId && user.role === venueRole) return membership;

  const invitation = await recordVenueInvitation(tx, venueId, email, venueRole, now);
  const values = { invitationId: invitation.id, role: workspaceRole, venueRole,
    status: "invited", invitedBy: actorId, updatedAt: now };
  const [prepared] = membership === undefined
    ? await tx.insert(workspaceMemberships).values({ workspaceId, email, ...values }).returning()
    : await tx.update(workspaceMemberships).set(values).where(eq(workspaceMemberships.id, membership.id)).returning();
  if (prepared === undefined) throw new Error("Membership write returned no row");
  return prepared;
}

export type VenueInvitationOutcome =
  | { readonly kind: "invited"; readonly invitation: InvitationRow }
  | { readonly kind: "has_access" };

/**
 * A venue grant with no managed workspace around it: the Team tab's path for
 * a venue that has none. The same checks and the same 30-day grant as a
 * workspace invitation. An account that already holds exactly this access at
 * this venue is reported, not sent an invitation it cannot use.
 */
export async function prepareVenueInvitation(
  tx: OnboardingTransaction,
  venueId: string,
  draft: { readonly email: string; readonly venueRole: VenueInvitationRole },
): Promise<VenueInvitationOutcome> {
  const email = draft.email.trim().toLowerCase();
  const { user, now } = await lockAndCheckVenueGrant(tx, venueId, email, draft.venueRole);
  const venueRole = user?.role === "admin" ? "admin" : draft.venueRole;
  if (user?.venueId === venueId && user.role === venueRole) return { kind: "has_access" };
  return { kind: "invited", invitation: await recordVenueInvitation(tx, venueId, email, venueRole, now) };
}

/**
 * What a membership becomes when its pending grant is withdrawn: a connected
 * account keeps the access it already had (an unaccepted upgrade must not cost
 * it its existing grant); a membership that never connected is removed.
 */
export async function settleCancelledMembership(
  tx: OnboardingTransaction,
  membership: MembershipRow,
  now: Date,
): Promise<MembershipRow> {
  const [user] = membership.userId === null ? [] : await tx.select().from(users)
    .where(eq(users.id, membership.userId)).limit(1);
  const [updated] = await tx.update(workspaceMemberships).set({
    status: user === undefined ? "removed" : "active",
    ...(user === undefined ? {} : { venueRole: user.role, role: membership.role === "owner" ? "owner" : user.role }),
    updatedAt: now,
  }).where(eq(workspaceMemberships.id, membership.id)).returning();
  if (updated === undefined) throw new Error("Membership disappeared during cancellation");
  return updated;
}

/**
 * Withdraws a pending grant at this venue, under the same email lock as its
 * acceptance, so a cancel and a first sign-in cannot both win. Any workspace
 * membership waiting on the grant is settled as above.
 */
export async function cancelVenueInvitation(
  tx: OnboardingTransaction,
  venueId: string,
  invitationId: string,
): Promise<InvitationRow> {
  const [found] = await tx.select().from(userInvitations)
    .where(and(eq(userInvitations.id, invitationId), eq(userInvitations.venueId, venueId))).limit(1);
  if (found?.email === null || found?.email === undefined) {
    throw new OnboardingConflict("Invitation not found", "NOT_FOUND", 404);
  }
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${found.email}))`);
  const now = new Date();
  const [revoked] = await tx.update(userInvitations).set({ status: "revoked", updatedAt: now })
    .where(and(eq(userInvitations.id, found.id), eq(userInvitations.status, "pending"), isNull(userInvitations.acceptedAt)))
    .returning();
  if (revoked === undefined) {
    throw new OnboardingConflict("This invitation has already been accepted or cancelled. Existing account access has not changed.", "INVITATION_NOT_PENDING");
  }
  const waiting = await tx.select().from(workspaceMemberships)
    .where(and(eq(workspaceMemberships.invitationId, found.id), eq(workspaceMemberships.status, "invited")))
    .for("update");
  for (const membership of waiting) await settleCancelledMembership(tx, membership, now);
  return revoked;
}
