import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVenue } from "../../../api/spaces.js";
import { isTradesHallVenueSlug } from "../../../hooks/use-trades-hall-venue.js";
import { roomPhoto, type RoomPhoto } from "./enquiry-room-photo.js";

export interface VenueRoom {
  readonly name: string;
  /** Null where the venue's own photographs are not held. */
  readonly photo: RoomPhoto | null;
}

/** The room an enquiry asks for; undefined while its venue is being read,
 *  null when the guest chose none, the venue could not be read or the room is
 *  not among its rooms. */
export type RoomLookup = (enquiry: {
  readonly venueId: string;
  readonly spaceId: string;
  readonly roomChosen?: boolean | undefined;
}) => VenueRoom | null | undefined;

/** A venue's rooms as the Enquiries desk's Diary fact reads them. */
export interface VenueDirectory {
  /** Each room's name and slug, by id. */
  readonly rooms: ReadonlyMap<string, { readonly name: string; readonly slug: string }>;
  /** The rooms have published figures: Trades Hall's, under either of its
   *  slugs. Another venue's "Saloon" never borrows them. */
  readonly published: boolean;
}

export interface VenueRooms {
  readonly roomOf: RoomLookup;
  /** A venue's rooms; undefined while it is read, null when it could not be. */
  readonly venueOf: (venueId: string) => VenueDirectory | null | undefined;
}

interface ReadVenue {
  readonly rooms: ReadonlyMap<string, VenueRoom>;
  readonly directory: VenueDirectory;
}

/**
 * The rooms of the venues on the desk, from one read of each venue. A venue
 * that cannot be read is asked again the next time the desk's venues change;
 * until then its enquiries name no room rather than a guessed one.
 */
export function useVenueRooms(venueIds: readonly string[]): VenueRooms {
  const [venues, setVenues] = useState<ReadonlyMap<string, ReadVenue | null>>(() => new Map());
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
          const directory: VenueDirectory = {
            rooms: new Map(venue.spaces.map((space) => [space.id, { name: space.name, slug: space.slug }])),
            published: isTradesHallVenueSlug(venue.slug),
          };
          setVenues((previous) => new Map(previous).set(venueId, { rooms, directory }));
        })
        .catch(() => {
          requested.current.delete(venueId);
          if (mounted.current) setVenues((previous) => new Map(previous).set(venueId, null));
        });
    }
  }, [key]);

  const roomOf = useCallback<RoomLookup>((enquiry) => {
    // An enquiry that named no room is filed under the venue's first room,
    // which is not the guest's choice: it is neither named nor pictured.
    if (enquiry.roomChosen === false) return null;
    const read = venues.get(enquiry.venueId);
    return read === undefined ? undefined : read?.rooms.get(enquiry.spaceId) ?? null;
  }, [venues]);
  const venueOf = useCallback((venueId: string): VenueDirectory | null | undefined => {
    const read = venues.get(venueId);
    return read === undefined ? undefined : read?.directory ?? null;
  }, [venues]);
  return useMemo(() => ({ roomOf, venueOf }), [roomOf, venueOf]);
}
