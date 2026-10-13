import { useEffect, useState } from "react";
import { TRADES_HALL_VENUE_SLUG } from "@omnitwin/types";
import { getVenue } from "../api/spaces.js";

// ---------------------------------------------------------------------------
// Whether a venue is Trades Hall, read once per venue per page.
//
// Trades Hall's own surveyed rooms (the Grand Hall's photographed model) must
// never be drawn for another venue's room of the same name. The building has
// two spellings: the twin/asset slug and the seeded database slug.
// ---------------------------------------------------------------------------

const TRADES_HALL_SLUGS: ReadonlySet<string> = new Set([TRADES_HALL_VENUE_SLUG, "trades-hall-glasgow"]);

const reads = new Map<string, Promise<boolean>>();

/** Whether a venue slug is Trades Hall's. */
export function isTradesHallVenueSlug(slug: string): boolean {
  return TRADES_HALL_SLUGS.has(slug);
}

function readTradesHall(venueId: string): Promise<boolean> {
  const existing = reads.get(venueId);
  if (existing !== undefined) return existing;
  const read = getVenue(venueId).then((venue) => isTradesHallVenueSlug(venue.slug));
  reads.set(venueId, read);
  // A failed read may be retried by the next caller.
  void read.catch(() => { reads.delete(venueId); });
  return read;
}

/** Forgets every read; for tests. */
export function resetTradesHallVenueReads(): void {
  reads.clear();
}

/**
 * True or false once the venue has been read; null while it is being read,
 * when it cannot be, or when there is no venue.
 */
export function useTradesHallVenue(venueId: string | null): boolean | null {
  const [result, setResult] = useState<{ readonly venueId: string; readonly tradesHall: boolean } | null>(null);
  useEffect(() => {
    if (venueId === null) return undefined;
    let current = true;
    void readTradesHall(venueId).then(
      (tradesHall) => { if (current) setResult({ venueId, tradesHall }); },
      () => { if (current) setResult(null); },
    );
    return () => { current = false; };
  }, [venueId]);
  return venueId !== null && result?.venueId === venueId ? result.tradesHall : null;
}
