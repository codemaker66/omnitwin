import { useCallback, useEffect, useRef, useState } from "react";
import { getVenue } from "../../../api/spaces.js";
import { roomPhoto, type RoomPhoto } from "./enquiry-room-photo.js";

export interface VenueRoom {
  readonly name: string;
  /** Null where the venue's own photographs are not held. */
  readonly photo: RoomPhoto | null;
}

/** The room an enquiry asks for; undefined while its venue is being read,
 *  null when the venue could not be read or the room is not among its rooms. */
export type RoomLookup = (enquiry: { readonly venueId: string; readonly spaceId: string }) => VenueRoom | null | undefined;

/**
 * The rooms of the venues on the desk, from one read of each venue. A venue
 * that cannot be read is asked again the next time the desk's venues change;
 * until then its enquiries name no room rather than a guessed one.
 */
export function useVenueRooms(venueIds: readonly string[]): RoomLookup {
  const [venues, setVenues] = useState<ReadonlyMap<string, ReadonlyMap<string, VenueRoom> | null>>(() => new Map());
  const requested = useRef(new Set<string>());
  const mounted = useRef(true);
  const key = [...new Set(venueIds)].sort().join("\n");

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    for (const venueId of key === "" ? [] : key.split("\n")) {
      if (requested.current.has(venueId)) continue;
      requested.current.add(venueId);
      void getVenue(venueId)
        .then((venue) => {
          if (!mounted.current) return;
          const rooms = new Map(venue.spaces.map((space) => [space.id, { name: space.name, photo: roomPhoto(venue.slug, space.slug) }]));
          setVenues((previous) => new Map(previous).set(venueId, rooms));
        })
        .catch(() => {
          requested.current.delete(venueId);
          if (mounted.current) setVenues((previous) => new Map(previous).set(venueId, null));
        });
    }
  }, [key]);

  return useCallback((enquiry) => {
    const rooms = venues.get(enquiry.venueId);
    return rooms === undefined ? undefined : rooms?.get(enquiry.spaceId) ?? null;
  }, [venues]);
}
