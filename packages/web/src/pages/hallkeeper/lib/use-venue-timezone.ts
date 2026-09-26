import { useEffect, useState } from "react";
import { getVenue } from "../../../api/spaces.js";
import { VENUE_TIME_ZONE } from "../../diary/lib/board-time.js";

// ---------------------------------------------------------------------------
// The venue's wall clock, for hallkeeper surfaces.
//
// Every hallkeeper time is a venue-local time: a hallkeeper sets a room for
// the hour printed on the sheet, not for an hour in the browser's zone or in
// UTC. `venues.timezone` has carried the answer since migration 0015, but the
// Day Board and the event-day board printed a hard-coded "Europe/London",
// which is a claim rather than a reading — correct for Trades Hall today and
// silently wrong for the second venue.
//
// The fallback is deliberate and stated: when the venue row cannot be read
// (offline tablet, a fixture without the field) the surfaces keep rendering
// on the existing default rather than blanking every clock face. Callers
// print the zone beside the time, so a reader can always see which clock
// they are looking at.
// ---------------------------------------------------------------------------

export function useVenueTimezone(venueId: string | null): string {
  const [timezone, setTimezone] = useState<string>(VENUE_TIME_ZONE);

  useEffect(() => {
    if (venueId === null) {
      setTimezone(VENUE_TIME_ZONE);
      return;
    }
    let current = true;
    void getVenue(venueId)
      .then((venue) => {
        if (!current) return;
        const zone = venue.timezone;
        if (typeof zone === "string" && zone.length > 0) setTimezone(zone);
      })
      .catch(() => {
        // A venue read failure is not a reason to blank the board; the
        // surface keeps the default and still labels the zone it shows.
        if (current) setTimezone(VENUE_TIME_ZONE);
      });
    return () => { current = false; };
  }, [venueId]);

  return timezone;
}
