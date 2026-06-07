import type { Venue } from "../api/spaces.js";

export interface PlannerVenueAccessUser {
  readonly role: string;
  readonly venueId: string | null;
}

export type PlannerVenueResolution =
  | { readonly status: "resolved"; readonly venue: Venue }
  | { readonly status: "empty" }
  | { readonly status: "not_found"; readonly requestedSlug: string }
  | { readonly status: "forbidden"; readonly requestedSlug: string; readonly venue: Venue };

const GLOBAL_VENUE_ROLES = new Set(["admin"]);

function canAccessVenue(user: PlannerVenueAccessUser | null, venue: Venue): boolean {
  if (user === null) return true;
  if (GLOBAL_VENUE_ROLES.has(user.role)) return true;
  if (user.venueId === null) return true;
  return user.venueId === venue.id;
}

export function resolvePlannerVenue(
  venues: readonly Venue[],
  requestedVenueSlug: string | undefined,
  user: PlannerVenueAccessUser | null,
): PlannerVenueResolution {
  const venue = requestedVenueSlug === undefined
    ? venues[0]
    : venues.find((candidate) => candidate.slug === requestedVenueSlug);

  if (venue === undefined) {
    return requestedVenueSlug === undefined
      ? { status: "empty" }
      : { status: "not_found", requestedSlug: requestedVenueSlug };
  }

  if (!canAccessVenue(user, venue)) {
    return {
      status: "forbidden",
      requestedSlug: requestedVenueSlug ?? venue.slug,
      venue,
    };
  }

  return { status: "resolved", venue };
}
