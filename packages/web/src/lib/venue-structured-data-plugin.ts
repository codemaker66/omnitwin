import type { Plugin } from "vite";
import { venueJsonLdScript } from "./venue-structured-data.js";

// ---------------------------------------------------------------------------
// Writes the venue's schema.org description into index.html (T-649), in
// development and in every build, from the shared venue truth. index.html
// holds one marker comment where the script belongs; a page without the
// marker is left unchanged, and the tests hold index.html to exactly one.
// ---------------------------------------------------------------------------

export const VENUE_STRUCTURED_DATA_MARKER = "<!-- venue-structured-data -->";

export function injectVenueStructuredData(html: string): string {
  return html.includes(VENUE_STRUCTURED_DATA_MARKER)
    ? html.replace(VENUE_STRUCTURED_DATA_MARKER, venueJsonLdScript())
    : html;
}

export function venueStructuredDataPlugin(): Plugin {
  return {
    name: "venviewer-venue-structured-data",
    transformIndexHtml: {
      order: "pre",
      handler: injectVenueStructuredData,
    },
  };
}
