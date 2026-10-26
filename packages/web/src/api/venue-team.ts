import {
  InviteVenueTeamMemberResultSchema,
  InviteVenueTeamMemberSchema,
  VenueTeamSchema,
  type InviteVenueTeamMember,
  type InviteVenueTeamMemberResult,
  type VenueTeam,
} from "@omnitwin/types";
import { api } from "./client.js";

// ---------------------------------------------------------------------------
// The venue team (Plan 19 L1): who has access at a venue, the invitations
// still open, and inviting or cancelling. routes/venue-team.ts answers the
// venue's administrators and platform admins (canManageVenueTeam) and words
// its refusals for people, so callers show an ApiError's message as given.
// ---------------------------------------------------------------------------

function teamPath(venueId: string): string {
  return `/venues/${encodeURIComponent(venueId)}/team`;
}

export function getVenueTeam(venueId: string, signal?: AbortSignal): Promise<VenueTeam> {
  return api.get(teamPath(venueId), VenueTeamSchema, signal);
}

/** Grants one email a role at the venue and says what became of its email. */
export async function inviteVenueTeamMember(venueId: string, input: InviteVenueTeamMember): Promise<InviteVenueTeamMemberResult> {
  const body = InviteVenueTeamMemberSchema.parse(input);
  return api.post(`${teamPath(venueId)}/invitations`, body, undefined, InviteVenueTeamMemberResultSchema);
}

/** Withdraws an invitation not yet used; the API answers 204. */
export async function cancelVenueTeamInvitation(venueId: string, invitationId: string): Promise<void> {
  await api.delete(`${teamPath(venueId)}/invitations/${encodeURIComponent(invitationId)}`);
}
