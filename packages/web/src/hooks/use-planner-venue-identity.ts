import { useEffect, useState } from "react";
import { getVenue, type Venue } from "../api/spaces.js";

type VenueResult = {
  readonly venueId: string;
  readonly venue: Venue | null;
};

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
    void getVenue(venueId).then(
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
    logoUrl: tradesHall ? "/images/venues/trades-hall-glasgow-crest.png" : venue?.logoUrl ?? null,
    loading: venueId !== null && selected === null,
  };
}
