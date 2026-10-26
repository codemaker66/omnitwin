import { z } from "zod";
import { EmailSchema, UserRoleSchema } from "./user.js";

// ---------------------------------------------------------------------------
// The venue team (Plan 19 L1: the pilot gate "venue admins invite their own
// staff").
//
// A venue administrator invites their own people from the dashboard's Team
// tab. The invitation is the same grant a platform admin records in Clients &
// access (a user_invitations row, accepted when that email signs in verified),
// and an email tells the person to sign up with exactly that address.
//
// Blake, 24 October 2026: venue administrators invite any role, another
// administrator included; managers and staff do not invite. That decision is
// VENUE_TEAM_INVITER_ROLES, which the API's gate and the web's tab both read.
// ---------------------------------------------------------------------------

export const VENUE_TEAM_INVITER_ROLES = ["admin"] as const;

/** The roles a venue's own team holds. Client and planner accounts are the
 *  venue's clients, who arrive through their own journey, never this one. */
export const VENUE_TEAM_ROLES = ["admin", "manager", "staff", "sales", "hallkeeper", "caterer"] as const;
export const VenueTeamRoleSchema = z.enum(VENUE_TEAM_ROLES);
export type VenueTeamRole = z.infer<typeof VenueTeamRoleSchema>;

/** One name per role, shared by the Team page and the invitation email so the
 *  person reads the same words in both. The names match Clients & access. */
export const VENUE_TEAM_ROLE_LABELS: Readonly<Record<VenueTeamRole, string>> = {
  admin: "Venue administrator",
  manager: "Venue manager",
  staff: "Events staff",
  sales: "Sales",
  hallkeeper: "Hallkeeper",
  caterer: "Caterer",
};

/** What each role opens, in a line, mirroring the API's capability gates
 *  (packages/api/src/utils/query.ts). Shown beside the role choice and in the
 *  email, so nobody grants access without seeing what it is. */
export const VENUE_TEAM_ROLE_SUMMARIES: Readonly<Record<VenueTeamRole, string>> = {
  admin: "Everything at the venue, including inviting its team",
  manager: "The venue's settings, inventory, rota and operations",
  staff: "Enquiries, the Diary, layouts and reviews",
  sales: "The enquiry pipeline and proposals",
  hallkeeper: "The room on the day: sheets, setup and requests",
  caterer: "Only the events they are invited to",
};

export const InviteVenueTeamMemberSchema = z.object({
  email: EmailSchema,
  role: VenueTeamRoleSchema,
}).strict();
export type InviteVenueTeamMember = z.infer<typeof InviteVenueTeamMemberSchema>;

const IsoDateTimeSchema = z.iso.datetime();

/** Someone who already has access at the venue. */
export const VenueTeamMemberSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  role: UserRoleSchema,
  joinedAt: IsoDateTimeSchema,
}).strict();
export type VenueTeamMember = z.infer<typeof VenueTeamMemberSchema>;

/** A grant waiting for its person to sign in with that email. */
export const VenueTeamInvitationSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: UserRoleSchema,
  invitedAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema.nullable(),
  /** Null when the record of who sent it predates the Team tab. */
  invitedByName: z.string().nullable(),
}).strict();
export type VenueTeamInvitation = z.infer<typeof VenueTeamInvitationSchema>;

export const VenueTeamSchema = z.object({
  members: z.array(VenueTeamMemberSchema),
  invitations: z.array(VenueTeamInvitationSchema),
}).strict();
export type VenueTeam = z.infer<typeof VenueTeamSchema>;

/**
 * What became of the invitation email, said plainly so the page never claims
 * a delivery that did not happen: "sent" (the provider accepted it),
 * "not_sent" (the provider refused or failed after retries) or
 * "not_configured" (this deployment sends no email). The grant stands in all
 * three; the person can still sign up with that address.
 */
export const VENUE_TEAM_EMAIL_DELIVERIES = ["sent", "not_sent", "not_configured"] as const;
export const VenueTeamEmailDeliverySchema = z.enum(VENUE_TEAM_EMAIL_DELIVERIES);
export type VenueTeamEmailDelivery = z.infer<typeof VenueTeamEmailDeliverySchema>;

export const InviteVenueTeamMemberResultSchema = z.object({
  invitation: VenueTeamInvitationSchema,
  emailDelivery: VenueTeamEmailDeliverySchema,
}).strict();
export type InviteVenueTeamMemberResult = z.infer<typeof InviteVenueTeamMemberResultSchema>;
