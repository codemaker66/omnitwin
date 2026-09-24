import { useEffect, useState } from "react";
import { getVenue, type Venue, type VenueDetail } from "../api/spaces.js";
import { createOneShotHandoff } from "../lib/one-shot-handoff.js";

type VenueResult = {
  readonly venueId: string;
  readonly venue: Venue | null;
};

// The /plan bootstrap resolves the venue several requests before the planner
// header mounts, so it requests the header's venue read then; the header's
// first read of that venue joins it instead of starting after the room opens.
const venueHandoff = createOneShotHandoff<Promise<VenueDetail>>(10_000);

/** Start the venue read the planner header will use for this venue. */
export function prefetchPlannerVenue(venueId: string): void {
  const request = getVenue(venueId);
  // Never unhandled; the header makes its own request if this one failed.
  request.catch(() => undefined);
  venueHandoff.offer(venueId, request);
}

/** Bind the planner identity to its selected venue, including during navigation. */
export function usePlannerVenueIdentity(venueId: string | null): {
  readonly name: string;
  readonly logoUrl: string | null;
  readonly loading: boolean;
} {
  const [result, setResult] = useState<VenueResult | null>(null);

  useEffect(() => {
    if (venueId === null) return;
    let current = true;
    const early = venueHandoff.take(venueId);
    const request = early === null ? getVenue(venueId) : early.catch(() => getVenue(venueId));
    void request.then(
      (venue) => {
        if (current) setResult({ venueId, venue: venue.id === venueId ? venue : null });
      },
      () => {
        if (current) setResult({ venueId, venue: null });
      },
    );
    return () => { current = false; };
  }, [venueId]);

  // Hide the previous venue on the first render after selection changes.
  const selected = venueId !== null && result?.venueId === venueId ? result : null;
  const venue = selected?.venue ?? null;
  const tradesHall = venue?.slug === "trades-hall-glasgow";
  return {
    name: tradesHall ? "Trade's Hall of Glasgow" : venue?.name ?? (selected === null ? "Venue planner" : "Venue unavailable"),
    logoUrl: tradesHall ? "/images/venues/trades-hall-glasgow-crest-200.webp" : venue?.logoUrl ?? null,
    loading: venueId !== null && selected === null,
  };
}
