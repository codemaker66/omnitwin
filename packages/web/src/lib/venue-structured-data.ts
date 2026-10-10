import {
  CAPACITY_FORMATS,
  TRADES_HALL_PUBLIC_PROFILE,
  publishedRoomCapacity,
  type PublicVenueProfile,
} from "@omnitwin/types";

// ---------------------------------------------------------------------------
// The front door's schema.org description (T-649): an EventVenue with its
// address, its own website, and each published room as a MeetingRoom carrying
// a maximumAttendeeCapacity — the largest of the venue's published layout
// figures for that room, and only where the venue publishes one.
//
// Built from the shared venue truth (@omnitwin/types), the same module the
// page's capacity table and the API's public MCP endpoint read, and written
// into index.html at build time (venue-structured-data-plugin.ts) so crawlers
// that do not run JavaScript still read it. Every property is checked against
// the schema.org vocabulary in this module's tests.
// ---------------------------------------------------------------------------

export type JsonLdValue = string | number | readonly JsonLdValue[] | { readonly [key: string]: JsonLdValue };
export type JsonLdNode = { readonly [key: string]: JsonLdValue };

/** The largest published figure across the venue's layouts, or null. */
function largestPublishedCapacity(profile: PublicVenueProfile, roomSlug: string): number | null {
  const capacity = publishedRoomCapacity(profile, roomSlug);
  if (capacity === null) return null;
  return Math.max(...CAPACITY_FORMATS.map((format) => capacity[format.key]));
}

export function venueJsonLd(profile: PublicVenueProfile = TRADES_HALL_PUBLIC_PROFILE): JsonLdNode {
  const rooms = Object.entries(profile.publishedRoomNames).map(([slug, name]): JsonLdNode => {
    const largest = largestPublishedCapacity(profile, slug);
    return largest === null
      ? { "@type": "MeetingRoom", name }
      : { "@type": "MeetingRoom", name, maximumAttendeeCapacity: largest };
  });
  return {
    "@context": "https://schema.org",
    "@type": "EventVenue",
    "@id": `${profile.venviewerUrl}#venue`,
    name: profile.name,
    alternateName: profile.alternateName,
    url: profile.venviewerUrl,
    sameAs: [profile.officialWebsite],
    image: profile.image,
    telephone: profile.telephone,
    address: {
      "@type": "PostalAddress",
      streetAddress: profile.address.streetAddress,
      addressLocality: profile.address.addressLocality,
      postalCode: profile.address.postalCode,
      addressCountry: profile.address.addressCountry,
    },
    containsPlace: rooms,
  };
}

/** The `<script type="application/ld+json">` element for index.html. `<` is
 *  escaped so no value can close the script element early. */
export function venueJsonLdScript(profile: PublicVenueProfile = TRADES_HALL_PUBLIC_PROFILE): string {
  const json = JSON.stringify(venueJsonLd(profile), null, 2).replace(/</gu, "\\u003c");
  return `<script type="application/ld+json">\n${json}\n    </script>`;
}
